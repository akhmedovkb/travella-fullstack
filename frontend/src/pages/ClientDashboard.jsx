import { useEffect, useState, useRef } from "react";
import { apiGet, apiPut, apiPost } from "../api";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

/** initials */
function initials(name = "") {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]?.toUpperCase() || "").join("");
}
/** crop+resize to dataURL */
async function cropAndResizeToDataURL(file, size = 512, quality = 0.9) {
  const dataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const minSide = Math.min(img.width, img.height);
  const sx = (img.width - minSide) / 2;
  const sy = (img.height - minSide) / 2;
  canvas.width = size; canvas.height = size;
  ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", quality);
}

/* Stars / Progress / StatBox from stats block */
function Stars({ value = 0 }) {
  const full = Math.floor(value);
  const half = value - full >= 0.5;
  return (
    <div className="flex items-center gap-1">
      {[...Array(5)].map((_, i) => (
        <svg key={i} width="18" height="18" viewBox="0 0 24 24"
             className={i < full ? "text-yellow-500" : half && i === full ? "text-yellow-400" : "text-gray-300"}
             fill="currentColor">
          <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
        </svg>
      ))}
      <span className="ml-1 text-sm text-gray-600">{value.toFixed(1)}</span>
    </div>
  );
}
function Progress({ value, max }) {
  const pct = Math.min(100, Math.round(((value || 0) / (max || 1)) * 100));
  return (
    <div className="w-full bg-gray-100 rounded-full h-2">
      <div className="h-2 bg-orange-500 rounded-full" style={{ width: `${pct}%` }} />
    </div>
  );
}
function StatBox({ label, value }) {
  return (
    <div className="border rounded-lg p-3 text-center">
      <div className="text-2xl font-bold">{value ?? 0}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
function ClientStatsBlock() {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const res = await apiGet("/api/clients/stats", true);
        setData(res);
      } catch (e) {
        setErr(e.message || "Error");
      }
    })();
  }, []);
  if (err) return <div className="text-sm text-red-600">{err}</div>;
  if (!data) return <div className="text-sm text-gray-500">{t("common.loading")}</div>;
  const left = data.tier === "Platinum" ? 0 : Math.max(0, (data.next_tier_at || 0) - (data.points || 0));
  return (
    <div className="bg-white p-6 rounded-xl shadow">
      <h2 className="text-xl font-bold mb-4">{t("client.progress.title", "Мой прогресс")}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="border rounded-lg p-4">
          <div className="text-sm text-gray-500 mb-1">{t("client.progress.rating", "Рейтинг")}</div>
          <Stars value={data.rating || 0} />
          <div className="mt-3 text-xs text-gray-500">
            {t("client.progress.completed", "Завершено")}: {data.bookings_completed || 0} ·{" "}
            {t("client.progress.cancelled", "Отменено")}: {data.bookings_cancelled || 0}
          </div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-sm text-gray-500">{t("client.progress.points", "Бонусы")}</div>
              <div className="text-lg font-semibold">{data.points || 0} pts · {data.tier || "Bronze"}</div>
            </div>
            <span className="text-xs text-gray-500">
              {data.tier === "Platinum" ? t("client.progress.maxed","макс.")
               : left > 0 ? t("client.progress.toNext","{{left}} pts до уровня",{left})
               : t("client.progress.upgrade","апгрейд!")}
            </span>
          </div>
          <Progress value={data.points || 0} max={data.next_tier_at || 1000} />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatBox label={t("client.progress.requestsTotal","Запросов")} value={data.requests_total} />
        <StatBox label={t("client.progress.requestsActive","Активных")} value={data.requests_active} />
        <StatBox label={t("client.progress.bookingsTotal","Бронирований")} value={data.bookings_total} />
        <StatBox label={t("client.progress.bookingsCompleted","Выполнено")} value={data.bookings_completed} />
      </div>
    </div>
  );
}

export default function ClientDashboard() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const fileInputRef = useRef(null);

  const [profile, setProfile] = useState({ name: "", phone: "", avatar_url: "" });
  const [saving, setSaving] = useState(false);

  const [avatarPreview, setAvatarPreview] = useState("");
  const [avatarBase64, setAvatarBase64] = useState("");
  const [avatarRemoved, setAvatarRemoved] = useState(false);

  const [newPass, setNewPass] = useState("");
  const [changing, setChanging] = useState(false);

  const [tab, setTab] = useState("req"); // req | book | fav
  const [myRequests, setMyRequests] = useState([]);
  const [myBookings, setMyBookings] = useState([]);
  const [loadingTab, setLoadingTab] = useState(false);

  useEffect(() => {
    const tpar = params.get("tab");
    setTab(tpar === "book" ? "book" : tpar === "fav" ? "fav" : "req");
    (async () => {
      try {
        const me = await apiGet("/api/clients/me");
        if (me) setProfile(p => ({ ...p, name: me.name ?? "", phone: me.phone ?? "", avatar_url: me.avatar_url ?? "" }));
      } catch {}
    })();
    loadTab(tpar === "book" ? "book" : tpar === "fav" ? "fav" : "req");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === "req" && myRequests.length === 0) loadTab("req");
    if (tab === "book" && myBookings.length === 0) loadTab("book");
    if (tab === "fav") {/* список подгружается внутри блока ниже */}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function loadTab(which) {
    setLoadingTab(true);
    try {
      if (which === "req") {
        const rows = await apiGet("/api/requests/my").catch(() => []);
        setMyRequests(Array.isArray(rows) ? rows : []);
      } else if (which === "book") {
        const rows = await apiGet("/api/bookings/my").catch(() => []);
        setMyBookings(Array.isArray(rows) ? rows : []);
      }
    } finally {
      setLoadingTab(false);
    }
  }

  async function saveProfile(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { name: profile.name, phone: profile.phone };
      if (avatarBase64) payload.avatar_base64 = avatarBase64;
      if (avatarRemoved) payload.remove_avatar = true;
      await apiPut("/api/clients/me", payload);
      // refresh
      const me = await apiGet("/api/clients/me");
      if (me) setProfile(p => ({ ...p, name: me.name ?? "", phone: me.phone ?? "", avatar_url: me.avatar_url ?? "" }));
      setAvatarPreview(""); setAvatarBase64(""); setAvatarRemoved(false);
    } catch (e2) {
      alert(e2.message || "Error");
    } finally {
      setSaving(false);
    }
  }
  async function changePassword() {
    if (!newPass || newPass.length < 6) { alert(t("client.dashboard.passwordTooShort")); return; }
    setChanging(true);
    try {
      await apiPost("/api/clients/change-password", { password: newPass }, "client");
      setNewPass(""); alert(t("client.dashboard.passwordChanged"));
    } catch (e) { alert(e.message || "Error"); } finally { setChanging(false); }
  }
  function logout() { localStorage.removeItem("clientToken"); window.location.href = "/client/login"; }

  async function onSelectAvatar(e) {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const dataURL = await cropAndResizeToDataURL(file, 512, 0.9);
      setAvatarPreview(dataURL); setAvatarBase64(dataURL.split(",")[1]); setAvatarRemoved(false);
    } catch { alert("Failed to process image"); } finally { if (fileInputRef.current) fileInputRef.current.value = ""; }
  }
  function removeAvatar() { setAvatarPreview(""); setAvatarBase64(""); setAvatarRemoved(true); }

  const showAvatar = avatarPreview || profile.avatar_url || "";

  return (
    <div className="max-w-6xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Профиль */}
        <div className="bg-white p-6 rounded-xl shadow">
          <h2 className="text-xl font-bold mb-4">{t("client.dashboard.profileTitle")}</h2>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-32 h-32 rounded-full bg-gray-100 ring-2 ring-white shadow overflow-hidden flex items-center justify-center text-2xl font-semibold text-gray-600">
              {showAvatar ? <img src={showAvatar} alt="avatar" className="w-full h-full object-cover" /> : <span>{initials(profile.name) || "🙂"}</span>}
            </div>
            <div className="flex flex-col gap-2">
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onSelectAvatar} />
              <button className="px-4 py-2 rounded bg-gray-900 text-white font-semibold hover:opacity-90" onClick={() => fileInputRef.current?.click()}>
                {showAvatar ? t("client.dashboard.changePhoto") : t("client.dashboard.uploadPhoto")}
              </button>
              {showAvatar && (
                <button className="px-4 py-2 rounded border border-gray-300 text-gray-800 hover:bg-gray-50" onClick={removeAvatar}>
                  {t("client.dashboard.removePhoto")}
                </button>
              )}
            </div>
          </div>
          <form onSubmit={saveProfile} className="space-y-3">
            <input className="w-full border rounded px-3 py-2" placeholder={t("client.dashboard.name")} value={profile.name}
                   onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
            <input className="w-full border rounded px-3 py-2" placeholder={t("client.dashboard.phone")} value={profile.phone}
                   onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
            <button type="submit" disabled={saving} className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2 rounded transition">
              {saving ? t("common.loading") : t("client.dashboard.saveBtn")}
            </button>
          </form>
          <div className="mt-6 pt-6 border-t">
            <div className="font-semibold mb-2">{t("client.dashboard.changePassword")}</div>
            <div className="flex gap-2">
              <input type="password" className="flex-1 border rounded px-3 py-2" placeholder={t("client.dashboard.newPassword")}
                     value={newPass} onChange={(e) => setNewPass(e.target.value)} />
              <button onClick={changePassword} disabled={changing} className="px-4 bg-gray-900 text-white rounded font-semibold">
                {changing ? t("common.loading") : t("client.dashboard.changeBtn")}
              </button>
            </div>
          </div>
          <div className="mt-6">
            <button onClick={logout} className="w-full border border-red-300 text-red-700 hover:bg-red-50 rounded py-2 font-semibold">
              {t("client.dashboard.logout")}
            </button>
          </div>
        </div>

        {/* Прогресс */}
        <ClientStatsBlock />
      </div>

      {/* Вкладки */}
      <div className="bg-white p-6 rounded-xl shadow mt-6">
        <div className="flex gap-2 mb-3">
          <button onClick={() => setTab("req")}  className={`px-3 py-1 rounded-full text-sm ${tab==="req" ?"bg-orange-500 text-white":"bg-gray-100 text-gray-800"}`}>
            {t("client.dashboard.tabs.myRequests")}
          </button>
          <button onClick={() => setTab("book")} className={`px-3 py-1 rounded-full text-sm ${tab==="book"?"bg-orange-500 text-white":"bg-gray-100 text-gray-800"}`}>
            {t("client.dashboard.tabs.myBookings")}
          </button>
          <button onClick={() => setTab("fav")}  className={`px-3 py-1 rounded-full text-sm ${tab==="fav" ?"bg-orange-500 text-white":"bg-gray-100 text-gray-800"}`}>
            {t("client.dashboard.tabs.favorites","Избранное")}
          </button>
        </div>

        {tab === "req" && (
          loadingTab ? <div className="text-sm text-gray-500">{t("common.loading")}</div> :
          myRequests.length === 0 ? <div className="text-sm text-gray-500">{t("client.dashboard.noRequests")}</div> :
          <ul className="space-y-2">
            {myRequests.map((r) => (
              <li key={r.id} className="border rounded p-3">
                <div className="font-semibold">Request #{r.id} · Service #{r.service_id}</div>
                <div className="text-sm text-gray-600">{r.status} · {r.created_at ? new Date(r.created_at).toLocaleString() : ""}</div>
              </li>
            ))}
          </ul>
        )}

        {tab === "book" && (
          loadingTab ? <div className="text-sm text-gray-500">{t("common.loading")}</div> :
          myBookings.length === 0 ? <div className="text-sm text-gray-500">{t("client.dashboard.noBookings")}</div> :
          <ul className="space-y-2">
            {myBookings.map((b) => (
              <li key={b.id} className="border rounded p-3">
                <div className="font-semibold">Booking #{b.id} · Service #{b.service_id}</div>
                <div className="text-sm text-gray-600">{b.status || ""} {b.created_at ? `· ${new Date(b.created_at).toLocaleString()}` : ""}</div>
              </li>
            ))}
          </ul>
        )}

        {tab === "fav" && <FavoritesList />}
      </div>
    </div>
  );
}

/* Список избранного (expand=service) */
function FavoritesList() {
  const { t } = useTranslation();
  const [items, setItems] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const res = await apiGet("/api/wishlist?expand=service", true);
        setItems(res || []);
      } catch {
        setItems([]);
      }
    })();
  }, []);
  if (!items) return <div className="text-sm text-gray-500">{t("common.loading")}</div>;
  if (items.length === 0) return <div className="text-sm text-gray-500">{t("client.dashboard.noFavorites","Нет избранного.")}</div>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {items.map(s => (
        <div key={s.id} className="border rounded p-3">
          <div className="font-semibold">{s.title || s.name || `#${s.id}`}</div>
          {s.net_price && <div className="text-sm text-gray-600">Net: {s.net_price} {s.currency || "USD"}</div>}
          <div className="mt-2">
            <a href={`/marketplace?highlight=${s.id}`} className="text-orange-600 hover:underline">
              {t("client.dashboard.openOnMarketplace","Открыть на витрине")}
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}
