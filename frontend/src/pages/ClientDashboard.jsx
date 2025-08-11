import { useEffect, useState, useRef } from "react";
import { apiGet, apiPut, apiPost } from "../api";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

/** === helpers === */
function initials(name = "") {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || "").join("");
}

/** crop + resize image to square dataURL (default 512x512) */
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
  canvas.width = size;
  canvas.height = size;
  ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", quality);
}

/** === small UI bits for stats block === */
function Stars({ value = 0 }) {
  const full = Math.floor(value);
  const half = value - full >= 0.5;
  return (
    <div className="flex items-center gap-1">
      {[...Array(5)].map((_, i) => (
        <svg
          key={i}
          width="18"
          height="18"
          viewBox="0 0 24 24"
          className={
            i < full
              ? "text-yellow-500"
              : half && i === full
              ? "text-yellow-400"
              : "text-gray-300"
          }
          fill="currentColor"
        >
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
      <div
        className="h-2 bg-orange-500 rounded-full"
        style={{ width: `${pct}%` }}
      />
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

/** === right column: progress / bonuses / stats === */
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

  const left =
    data.tier === "Platinum"
      ? 0
      : Math.max(0, (data.next_tier_at || 0) - (data.points || 0));

  return (
    <div className="bg-white p-6 rounded-xl shadow">
      <h2 className="text-xl font-bold mb-4">
        {t("client.progress.title", "Мой прогресс")}
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="border rounded-lg p-4">
          <div className="text-sm text-gray-500 mb-1">
            {t("client.progress.rating", "Рейтинг")}
          </div>
          <Stars value={data.rating || 0} />
          <div className="mt-3 text-xs text-gray-500">
            {t("client.progress.completed", "Завершено")}:{" "}
            {data.bookings_completed || 0} ·{" "}
            {t("client.progress.cancelled", "Отменено")}:{" "}
            {data.bookings_cancelled || 0}
          </div>
        </div>

        <div className="border rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-sm text-gray-500">
                {t("client.progress.points", "Бонусы")}
              </div>
              <div className="text-lg font-semibold">
                {data.points || 0} pts · {data.tier || "Bronze"}
              </div>
            </div>
            <span className="text-xs text-gray-500">
              {data.tier === "Platinum"
                ? t("client.progress.maxed", "макс.")
                : left > 0
                ? t("client.progress.toNext", "{{left}} pts до уровня", { left })
                : t("client.progress.upgrade", "апгрейд!")}
            </span>
          </div>
          <Progress value={data.points || 0} max={data.next_tier_at || 1000} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatBox
          label={t("client.progress.requestsTotal", "Запросов")}
          value={data.requests_total}
        />
        <StatBox
          label={t("client.progress.requestsActive", "Активных")}
          value={data.requests_active}
        />
        <StatBox
          label={t("client.progress.bookingsTotal", "Бронирований")}
          value={data.bookings_total}
        />
        <StatBox
          label={t("client.progress.bookingsCompleted", "Выполнено")}
          value={data.bookings_completed}
        />
      </div>
    </div>
  );
}

/** === main page === */
export default function ClientDashboard() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const fileInputRef = useRef(null);

  const [profile, setProfile] = useState({
    name: "",
    phone: "",
    avatar_url: "",
  });
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
        if (me)
          setProfile((p) => ({
            ...p,
            name: me.name ?? "",
            phone: me.phone ?? "",
            avatar_url: me.avatar_url ?? "",
          }));
      } catch {}
    })();
    loadTab(tpar === "book" ? "book" : tpar === "fav" ? "fav" : "req");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === "req" && myRequests.length === 0) loadTab("req");
    if (tab === "book" && myBookings.length === 0) loadTab("book");
    // "fav" подгружается внутри FavoritesList
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
      const me = await apiGet("/api/clients/me");
      if (me)
        setProfile((p) => ({
          ...p,
          name: me.name ?? "",
          phone: me.phone ?? "",
          avatar_url: me.avatar_url ?? "",
        }));
      setAvatarPreview("");
      setAvatarBase64("");
      setAvatarRemoved(false);
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
      await apiPost(
        "/api/clients/change-password",
        { password: newPass },
        "client"
      );
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
      setAvatarBase64(dataURL.split(",")[1]);
      setAvatarRemoved(false);
    } catch {
      alert("Failed to process image");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeAvatar() {
    setAvatarPreview("");
    setAvatarBase64("");
    setAvatarRemoved(true);
  }

  const showAvatar = avatarPreview || profile.avatar_url || "";

  return (
    <div className="max-w-6xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Профиль */}
        <div className="bg-white p-6 rounded-xl shadow">
          <h2 className="text-xl font-bold mb-4">
            {t("client.dashboard.profileTitle")}
          </h2>

          <div className="flex items-center gap-4 mb-4">
            <div className="w-32 h-32 rounded-full bg-gray-100 ring-2 ring-white shadow overflow-hidden flex items-center justify-center text-2xl font-semibold text-gray-600">
              {showAvatar ? (
                <img
                  src={showAvatar}
                  alt="avatar"
                  className="w-full h-full object-cover"
                />
              ) : (
                <span>{initials(profile.name) || "🙂"}</span>
              )}
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
                {showAvatar
                  ? t("client.dashboard.changePhoto")
                  : t("client.dashboard.uploadPhoto")}
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
              onChange={(e) =>
                setProfile({ ...profile, name: e.target.value })
              }
            />
            <input
              className="w-full border rounded px-3 py-2"
              placeholder={t("client.dashboard.phone")}
              value={profile.phone}
              onChange={(e) =>
                setProfile({ ...profile, phone: e.target.value })
              }
            />
            <button
              type="submit"
              disabled={saving}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2 rounded transition"
            >
              {saving ? t("common.loading") : t("client.dashboard.saveBtn")}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t">
            <div className="font-semibold mb-2">
              {t("client.dashboard.changePassword")}
            </div>
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

          <div className="mt-6">
            <button
              onClick={logout}
              className="w-full border border-red-300 text-red-700 hover:bg-red-50 rounded py-2 font-semibold"
            >
              {t("client.dashboard.logout")}
            </button>
          </div>
        </div>

        {/* Прогресс / бонусы */}
        <ClientStatsBlock />
      </div>

      {/* Вкладки */}
      <div className="bg-white p-6 rounded-xl shadow mt-6">
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setTab("req")}
            className={`px-3 py-1 rounded-full text-sm ${
              tab === "req"
                ? "bg-orange-500 text-white"
                : "bg-gray-100 text-gray-800"
            }`}
          >
            {t("client.dashboard.tabs.myRequests")}
          </button>
          <button
            onClick={() => setTab("book")}
            className={`px-3 py-1 rounded-full text-sm ${
              tab === "book"
                ? "bg-orange-500 text-white"
                : "bg-gray-100 text-gray-800"
            }`}
          >
            {t("client.dashboard.tabs.myBookings")}
          </button>
          <button
            onClick={() => setTab("fav")}
            className={`px-3 py-1 rounded-full text-sm ${
              tab === "fav"
                ? "bg-orange-500 text-white"
                : "bg-gray-100 text-gray-800"
            }`}
          >
            {t("client.dashboard.tabs.favorites", "Избранное")}
          </button>
        </div>

        {tab === "req" && (
          loadingTab ? (
            <div className="text-sm text-gray-500">{t("common.loading")}</div>
          ) : myRequests.length === 0 ? (
            <div className="text-sm text-gray-500">
              {t("client.dashboard.noRequests")}
            </div>
          ) : (
            <ul className="space-y-2">
              {myRequests.map((r) => (
                <li key={r.id} className="border rounded p-3">
                  <div className="font-semibold">
                    Request #{r.id} · Service #{r.service_id}
                  </div>
                  <div className="text-sm text-gray-600">
                    {r.status} ·{" "}
                    {r.created_at
                      ? new Date(r.created_at).toLocaleString()
                      : ""}
                  </div>
                </li>
              ))}
            </ul>
          )
        )}

        {tab === "book" && (
          loadingTab ? (
            <div className="text-sm text-gray-500">{t("common.loading")}</div>
          ) : myBookings.length === 0 ? (
            <div className="text-sm text-gray-500">
              {t("client.dashboard.noBookings")}
            </div>
          ) : (
            <ul className="space-y-2">
              {myBookings.map((b) => (
                <li key={b.id} className="border rounded p-3">
                  <div className="font-semibold">
                    Booking #{b.id} · Service #{b.service_id}
                  </div>
                  <div className="text-sm text-gray-600">
                    {b.status || ""}{" "}
                    {b.created_at
                      ? `· ${new Date(b.created_at).toLocaleString()}`
                      : ""}
                  </div>
                </li>
              ))}
            </ul>
          )
        )}

        {tab === "fav" && <FavoritesList />}
      </div>
    </div>
  );
}

/** === Favorites with pagination + quick request === */
function FavoritesList() {
  const { t } = useTranslation();

  const [items, setItems] = useState(null);
  const [removing, setRemoving] = useState(null);

  // pagination
  const PAGE_SIZE = 8;
  const [page, setPage] = useState(1);

  // quick request
  const [quickId, setQuickId] = useState(null);
  const [quickNote, setQuickNote] = useState("");
  const [sending, setSending] = useState(false);

  async function load() {
    try {
      const res = await apiGet("/api/wishlist?expand=service", true);
      const raw = Array.isArray(res) ? res : res?.items || [];
      const normalized = raw.map((x) => x.service || x);
      setItems(normalized);
      setPage(1);
    } catch {
      setItems([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function removeFromFav(id) {
    try {
      setRemoving(id);
      // если у тебя другой эндпоинт — обнови строку ниже
      await apiPost("/api/wishlist/toggle", { itemId: id });
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch (e) {
      alert(e.message || "Не удалось удалить из избранного");
    } finally {
      setRemoving(null);
    }
  }

  async function sendQuickRequest(serviceId) {
    if (!serviceId) return;
    if (sending) return;
    setSending(true);
    try {
      // при необходимости замени эндпоинт/поля на свои
      await apiPost("/api/requests", {
        service_id: serviceId,
        note: quickNote?.trim() || undefined,
      });
      alert(t("client.dashboard.requestSent", "Запрос отправлен"));
      setQuickId(null);
      setQuickNote("");
    } catch (e) {
      alert(e.message || "Не удалось отправить запрос");
    } finally {
      setSending(false);
    }
  }

  // paging helpers
  const total = items?.length || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageItems = (items || []).slice(start, end);

  if (!items) return <div className="text-sm text-gray-500">{t("common.loading")}</div>;
  if (items.length === 0) return <EmptyFavorites />;

  return (
    <div className="space-y-4">
      {/* grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {pageItems.map((s) => (
          <div key={s.id} className="border rounded p-3 bg-white">
            {s.images?.length ? (
              <img
                src={s.images[0]}
                alt=""
                className="w-full h-40 object-cover rounded mb-2"
              />
            ) : null}

            <div className="font-semibold">{s.title || s.name || `#${s.id}`}</div>
            {s.location && (
              <div className="text-sm text-gray-600">{s.location}</div>
            )}
            {s.net_price != null && (
              <div className="text-sm text-gray-600 mt-1">
                Net: {s.net_price} {s.currency || "USD"}
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2 items-center justify-between">
              <a
                href={`/marketplace?highlight=${s.id}`}
                className="text-orange-600 hover:underline"
              >
                {t("client.dashboard.openOnMarketplace", "Открыть на витрине")}
              </a>

              <div className="flex gap-2">
                <button
                  disabled={removing === s.id}
                  onClick={() => removeFromFav(s.id)}
                  className="text-gray-500 hover:text-red-600 disabled:opacity-60"
                  title={t("client.dashboard.removeFromFav", "Удалить")}
                >
                  {removing === s.id
                    ? t("common.loading")
                    : t("client.dashboard.remove", "Удалить")}
                </button>

                <button
                  onClick={() => {
                    setQuickId(quickId === s.id ? null : s.id);
                    setQuickNote("");
                  }}
                  className="px-3 py-1 rounded bg-orange-500 text-white hover:bg-orange-600"
                >
                  {quickId === s.id
                    ? t("client.dashboard.cancel", "Отмена")
                    : t("client.dashboard.quickRequest", "Запросить")}
                </button>
              </div>
            </div>

            {/* inline quick request */}
            {quickId === s.id && (
              <div className="mt-3 border-t pt-3">
                <label className="block text-sm text-gray-600 mb-1">
                  {t("client.dashboard.noteOptional", "Заметка (необязательно)")}
                </label>
                <textarea
                  rows={3}
                  className="w-full border rounded px-3 py-2"
                  placeholder={t(
                    "client.dashboard.notePlaceholder",
                    "Например: нужны даты, состав, пожелания…"
                  )}
                  value={quickNote}
                  onChange={(e) => setQuickNote(e.target.value)}
                />
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    onClick={() => setQuickId(null)}
                    className="px-3 py-1 rounded border text-gray-700 hover:bg-gray-50"
                  >
                    {t("client.dashboard.cancel", "Отмена")}
                  </button>
                  <button
                    onClick={() => sendQuickRequest(s.id)}
                    disabled={sending}
                    className="px-4 py-1 rounded bg-gray-900 text-white disabled:opacity-60"
                  >
                    {sending
                      ? t("common.loading")
                      : t("client.dashboard.send", "Отправить")}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1 rounded border bg-white hover:bg-gray-50"
            disabled={safePage === 1}
          >
            ‹
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`px-3 py-1 rounded border font-medium ${
                p === safePage ? "bg-orange-500 text-white" : "bg-white"
              }`}
            >
              {p}
            </button>
          ))}
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="px-3 py-1 rounded border bg-white hover:bg-gray-50"
            disabled={safePage === totalPages}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}

/** Пустой стейт «Избранного» */
function EmptyFavorites() {
  const { t } = useTranslation();
  return (
    <div className="w-full flex flex-col items-center justify-center py-14">
      <div className="w-20 h-20 rounded-full bg-orange-50 flex items-center justify-center mb-4 ring-1 ring-orange-100">
        {/* Heart icon */}
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 21s-6.716-4.35-9.192-7.2C.818 11.48 1.04 8.72 2.88 7.2a4.998 4.998 0 0 1 6.573.33L12 9.08l2.547-1.55a4.998 4.998 0 0 1 6.573-.33c1.84 1.52 2.062 4.28.072 6.6C18.716 16.65 12 21 12 21Z"
            stroke="#f97316"
            strokeWidth="1.6"
            fill="none"
          />
        </svg>
      </div>

      <div className="text-lg font-semibold text-gray-900">
        {t("client.dashboard.favEmptyTitle", "В избранном пока пусто")}
      </div>
      <div className="text-sm text-gray-500 mt-1 text-center max-w-sm">
        {t(
          "client.dashboard.favEmptySub",
          "Поставьте «лайк» на понравившихся услугах — мы соберём их здесь для быстрого доступа."
        )}
      </div>

      <a
        href="/marketplace"
        className="mt-5 inline-flex items-center gap-2 bg-orange-500 text-white px-4 py-2 rounded-lg font-semibold hover:bg-orange-600"
      >
        {t("client.dashboard.goToMarketplace", "Перейти на витрину")}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 12h14M13 5l7 7-7 7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </a>
    </div>
  );
}
