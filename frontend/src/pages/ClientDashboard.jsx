import { useEffect, useState, useRef } from "react";
import { apiGet, apiPut, apiPost } from "../api";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

/** утилита: инициалы по имени */
function initials(name = "") {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]?.toUpperCase() || "").join("");
}

/** утилита: кадрирование и ресайз в квадрат dataURL (jpeg) */
async function cropAndResizeToDataURL(file, size = 512, quality = 0.9) {
  const dataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const minSide = Math.min(img.width, img.height);
  const sx = (img.width - minSide) / 2;
  const sy = (img.height - minSide) / 2;

  canvas.width = size;
  canvas.height = size;
  ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);

  return canvas.toDataURL("image/jpeg", quality);
}

export default function ClientDashboard() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const fileInputRef = useRef(null);

  // профиль
  const [profile, setProfile] = useState({
    name: "",
    phone: "",
    avatar_url: ""
  });
  const [saving, setSaving] = useState(false);

  // аватар
  const [avatarPreview, setAvatarPreview] = useState("");      // dataURL для показа
  const [avatarBase64, setAvatarBase64] = useState("");        // чистый base64 для API
  const [avatarRemoved, setAvatarRemoved] = useState(false);   // пометили удаление

  // смена пароля
  const [newPass, setNewPass] = useState("");
  const [changing, setChanging] = useState(false);

  // отказные туры
  const [refused, setRefused] = useState([]);
  const [loadingRefused, setLoadingRefused] = useState(false);

  // вкладки
  const [tab, setTab] = useState("req");
  const [myRequests, setMyRequests] = useState([]);
  const [myBookings, setMyBookings] = useState([]);
  const [loadingTab, setLoadingTab] = useState(false);

  // ----- loaders -----
  async function loadProfile() {
    try {
      const me = await apiGet("/api/clients/me");
      if (me) {
        setProfile(p => ({
          ...p,
          name: me.name ?? "",
          phone: me.phone ?? "",
          avatar_url: me.avatar_url ?? ""
        }));
        // при загрузке профиля сбрасываем превью/флаги
        setAvatarPreview("");
        setAvatarBase64("");
        setAvatarRemoved(false);
      }
    } catch (e) {
      console.warn("profile load:", e.message);
    }
  }

  async function loadRefused() {
    setLoadingRefused(true);
    try {
      const rows = await apiGet("/api/marketplace/refused").catch(() => []);
      setRefused(Array.isArray(rows) ? rows : []);
    } finally {
      setLoadingRefused(false);
    }
  }

  async function loadTab(which) {
    setLoadingTab(true);
    try {
      if (which === "req") {
        const rows = await apiGet("/api/requests/my").catch(() => []);
        setMyRequests(Array.isArray(rows) ? rows : []);
      } else {
        const rows = await apiGet("/api/bookings/my").catch(() => []);
        setMyBookings(Array.isArray(rows) ? rows : []);
      }
    } finally {
      setLoadingTab(false);
    }
  }

  // init
  useEffect(() => {
    const tpar = params.get("tab");
    setTab(tpar === "book" ? "book" : "req");
    loadProfile();
    loadRefused();
    loadTab(tpar === "book" ? "book" : "req");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === "req" && myRequests.length === 0) loadTab("req");
    if (tab === "book" && myBookings.length === 0) loadTab("book");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function saveProfile(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: profile.name,
        phone: profile.phone
      };
      if (avatarBase64) payload.avatar_base64 = avatarBase64; // новый аватар
      if (avatarRemoved) payload.remove_avatar = true;         // удалить текущий

      await apiPut("/api/clients/me", payload);
      await loadProfile();
    } catch (e2) {
      alert(e2.message || "Error");
    } finally {
      setSaving(false);
    }
  }

  async function changePassword() {
    if (!newPass || newPass.length < 6) {
      alert(t("client.dashboard.passwordTooShort"));
      return;
    }
    setChanging(true);
    try {
      await apiPost("/api/clients/change-password", { password: newPass }, "client");
      setNewPass("");
      alert(t("client.dashboard.passwordChanged"));
    } catch (e) {
      alert(e.message || "Error");
    } finally {
      setChanging(false);
    }
  }

  function logout() {
    localStorage.removeItem("clientToken");
    window.location.href = "/client/login";
  }

  async function onSelectAvatar(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataURL = await cropAndResizeToDataURL(file, 512, 0.9);
      setAvatarPreview(dataURL);
      setAvatarBase64(dataURL.split(",")[1]); // чистый base64 после запятой
      setAvatarRemoved(false);
    } catch (err) {
      console.error(err);
      alert("Failed to process image");
    } finally {
      // обнулим, чтобы можно было выбрать тот же файл повторно
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeAvatar() {
    setAvatarPreview("");
    setAvatarBase64("");
    setAvatarRemoved(true);
  }

  const showAvatar =
    avatarPreview || profile.avatar_url || ""; // приоритет: превью -> url -> пусто

  return (
    <div className="max-w-6xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Профиль + аватар + смена пароля + выход */}
        <div className="bg-white p-6 rounded-xl shadow">
          <h2 className="text-xl font-bold mb-4">{t("client.dashboard.profileTitle")}</h2>

          {/* Аватар */}
          <div className="flex items-center gap-4 mb-4">
            <div className="relative">
              <div className="w-32 h-32 rounded-full bg-gray-100 ring-2 ring-white shadow overflow-hidden flex items-center justify-center text-2xl font-semibold text-gray-600">
                {showAvatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={showAvatar}
                    alt="avatar"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span>{initials(profile.name) || "🙂"}</span>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onSelectAvatar}
              />
              <button
                className="px-4 py-2 rounded bg-gray-900 text-white font-semibold hover:opacity-90"
                onClick={() => fileInputRef.current?.click()}
              >
                {showAvatar ? t("client.dashboard.changePhoto") : t("client.dashboard.uploadPhoto")}
              </button>
              {showAvatar && (
                <button
                  className="px-4 py-2 rounded border border-gray-300 text-gray-800 hover:bg-gray-50"
                  onClick={removeAvatar}
                >
                  {t("client.dashboard.removePhoto")}
                </button>
              )}
            </div>
          </div>

          <form onSubmit={saveProfile} className="space-y-3">
            <input
              className="w-full border rounded px-3 py-2"
              placeholder={t("client.dashboard.name")}
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            />
            <input
              className="w-full border rounded px-3 py-2"
              placeholder={t("client.dashboard.phone")}
              value={profile.phone}
              onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
            />

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2 rounded transition"
            >
              {saving ? t("common.loading") : t("client.dashboard.saveBtn")}
            </button>
          </form>

          {/* Смена пароля */}
          <div className="mt-6 pt-6 border-t">
            <div className="font-semibold mb-2">{t("client.dashboard.changePassword")}</div>
            <div className="flex gap-2">
              <input
                type="password"
                className="flex-1 border rounded px-3 py-2"
                placeholder={t("client.dashboard.newPassword")}
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
              />
              <button
                onClick={changePassword}
                disabled={changing}
                className="px-4 bg-gray-900 text-white rounded font-semibold"
              >
                {changing ? t("common.loading") : t("client.dashboard.changeBtn")}
              </button>
            </div>
          </div>

          {/* Выйти */}
          <div className="mt-6">
            <button
              onClick={logout}
              className="w-full border border-red-300 text-red-700 hover:bg-red-50 rounded py-2 font-semibold"
            >
              {t("client.dashboard.logout")}
            </button>
          </div>
        </div>

        {/* Отказные туры */}
        <div className="bg-white p-6 rounded-xl shadow">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">{t("client.dashboard.refusedTours")}</h2>
            <button
              onClick={loadRefused}
              className="text-orange-600 hover:underline"
              disabled={loadingRefused}
            >
              {t("client.dashboard.refresh")}
            </button>
          </div>

          {loadingRefused ? (
            <div className="text-sm text-gray-500">{t("common.loading")}</div>
          ) : refused.length === 0 ? (
            <div className="text-sm text-gray-500">{t("client.dashboard.noResults")}</div>
          ) : (
            <ul className="space-y-2">
              {refused.map((it) => (
                <li key={it.id} className="border rounded p-3">
                  <div className="font-semibold">{it.title || it.name || `#${it.id}`}</div>
                  {it.price && <div className="text-sm text-gray-600">Net: {it.price}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* нижние вкладки */}
      <div className="bg-white p-6 rounded-xl shadow mt-6">
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setTab("req")}
            className={`px-3 py-1 rounded-full text-sm ${
              tab === "req" ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-800"
            }`}
          >
            {t("client.dashboard.tabs.myRequests")}
          </button>
          <button
            onClick={() => setTab("book")}
            className={`px-3 py-1 rounded-full text-sm ${
              tab === "book" ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-800"
            }`}
          >
            {t("client.dashboard.tabs.myBookings")}
          </button>
        </div>

        {loadingTab ? (
          <div className="text-sm text-gray-500">{t("common.loading")}</div>
        ) : tab === "req" ? (
          myRequests.length === 0 ? (
            <div className="text-sm text-gray-500">{t("client.dashboard.noRequests")}</div>
          ) : (
            <ul className="space-y-2">
              {myRequests.map((r) => (
                <li key={r.id} className="border rounded p-3">
                  <div className="font-semibold">
                    Request #{r.id} · Service #{r.service_id}
                  </div>
                  <div className="text-sm text-gray-600">
                    {r.status} · {r.created_at ? new Date(r.created_at).toLocaleString() : ""}
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : myBookings.length === 0 ? (
          <div className="text-sm text-gray-500">{t("client.dashboard.noBookings")}</div>
        ) : (
          <ul className="space-y-2">
            {myBookings.map((b) => (
              <li key={b.id} className="border rounded p-3">
                <div className="font-semibold">
                  Booking #{b.id} · Service #{b.service_id}
                </div>
                <div className="text-sm text-gray-600">
                  {b.status || ""} {b.created_at ? `· ${new Date(b.created_at).toLocaleString()}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
