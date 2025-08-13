import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { apiGet, apiPut, apiPost } from "../api";

/* ===================== Helpers ===================== */
function initials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || "";
  const second = parts[1]?.[0] || "";
  return (first + second).toUpperCase() || "U";
}

function toDataUrl(b64OrDataUrl, mime = "image/jpeg") {
  if (!b64OrDataUrl) return null;
  return String(b64OrDataUrl).startsWith("data:")
    ? b64OrDataUrl
    : `data:${mime};base64,${b64OrDataUrl}`;
}

function stripDataUrlPrefix(dataUrl) {
  if (!dataUrl) return null;
  const m = String(dataUrl).match(/^data:[^;]+;base64,(.*)$/);
  return m ? m[1] : dataUrl;
}

/** Crop image -> square 512x512, return dataURL (jpeg) */
function cropAndResizeToDataURL(file, size = 512, quality = 0.9) {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const minSide = Math.min(img.width, img.height);
          const sx = Math.max(0, (img.width - minSide) / 2);
          const sy = Math.max(0, (img.height - minSide) / 2);
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
          const dataUrl = canvas.toDataURL("image/jpeg", quality);
          resolve(dataUrl);
        };
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    } catch (e) {
      reject(e);
    }
  });
}

/* ===== NEW: tiny helpers for price formatting (используются в избранном) ===== */
function fmtPrice(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (Number.isFinite(n)) return new Intl.NumberFormat().format(n);
  return String(v);
}
function firstNonEmpty(...args) {
  for (const v of args) {
    if (v === 0) return 0;
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return null;
}
/* ============================================================================ */

/* ===================== Mini Components ===================== */

function Stars({ value = 0, size = 18, className = "" }) {
  const full = Math.floor(value);
  const half = value - full >= 0.5;
  const total = 5;
  const starPath =
    "M12 .587l3.668 7.428 8.2 1.733-5.934 5.78 1.402 8.472L12 19.548 4.664 24l1.402-8.472L.132 9.748l8.2-1.733z";
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {Array.from({ length: total }).map((_, i) => {
        const filled = i < full;
        const showHalf = i === full && half;
        return (
          <div key={i} className="relative" style={{ width: size, height: size }}>
            <svg viewBox="0 0 24 24" width={size} height={size} className={filled ? "text-yellow-400" : "text-gray-300"} fill="currentColor">
              <path d={starPath} />
            </svg>
            {showHalf && (
              <svg
                viewBox="0 0 24 24"
                width={size}
                height={size}
                className="absolute inset-0 text-yellow-400 overflow-hidden"
                style={{ clipPath: "inset(0 50% 0 0)" }}
                fill="currentColor"
              >
                <path d={starPath} />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Progress({ value = 0, max = 100, label }) {
  const pct = Math.max(0, Math.min(100, Math.round((value / (max || 1)) * 100)));
  return (
    <div>
      {label && <div className="mb-1 text-sm text-gray-600">{label}</div>}
      <div className="w-full bg-gray-200 rounded-full h-3">
        <div className="h-3 bg-orange-500 rounded-full transition-all" style={{ width: `${pct}%` }} title={`${pct}%`} />
      </div>
      <div className="mt-1 text-xs text-gray-500">
        {value} / {max} ({pct}%)
      </div>
    </div>
  );
}

function StatBox({ title, value }) {
  return (
    <div className="p-4 bg-white border rounded-xl shadow-sm flex flex-col">
      <div className="text-sm text-gray-500">{title}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

function ClientStatsBlock({ stats }) {
  const { t } = useTranslation();
  const rating = Number(stats?.rating || 0);
  const points = Number(stats?.points || 0);
  const next = Number(stats?.next_tier_at || 100);
  const tier = stats?.tier || t("stats.tier", { defaultValue: "Tier" });

  return (
    <div className="bg-white rounded-xl shadow p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm text-gray-500">{t("stats.tier", { defaultValue: "Tier" })}</div>
          <div className="text-xl font-semibold">{tier}</div>
        </div>
        <div className="text-right">
          <div className="text-sm text-gray-500">{t("stats.rating", { defaultValue: "Rating" })}</div>
          <div className="flex items-center justify-end gap-2">
            <Stars value={rating} size={20} />
            <span className="text-sm text-gray-600">{rating.toFixed(1)}</span>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <Progress value={points} max={next} label={t("stats.bonus_progress", { defaultValue: "Bonus progress" })} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-6">
        <StatBox title={t("stats.requests_total", { defaultValue: "Requests (total)" })} value={stats?.requests_total ?? 0} />
        <StatBox title={t("stats.requests_active", { defaultValue: "Requests (active)" })} value={stats?.requests_active ?? 0} />
        <StatBox title={t("stats.bookings_total", { defaultValue: "Bookings (total)" })} value={stats?.bookings_total ?? 0} />
        <StatBox title={t("stats.completed", { defaultValue: "Completed" })} value={stats?.bookings_completed ?? 0} />
        <StatBox title={t("stats.cancelled", { defaultValue: "Cancelled" })} value={stats?.bookings_cancelled ?? 0} />
      </div>
    </div>
  );
}

function EmptyFavorites() {
  const { t } = useTranslation();
  return (
    <div className="p-8 text-center bg-white border rounded-xl">
      <div className="text-lg font-semibold mb-2">{t("favorites.empty_title", { defaultValue: "Избранное пусто" })}</div>
      <div className="text-gray-600">
        {t("favorites.empty_desc", {
          defaultValue: "Добавляйте интересные услуги в избранное и возвращайтесь позже.",
        })}
      </div>
    </div>
  );
}

function FavoritesList({ items, page, perPage = 8, onPageChange, onRemove, onQuickRequest, onBook }) {
  const { t } = useTranslation();
  const total = items?.length || 0;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * perPage;
  const pageItems = items.slice(start, start + perPage);

  return (
    <div>
      {total === 0 ? (
        <EmptyFavorites />
      ) : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {pageItems.map((it) => {
              const s = it.service || {};
              const serviceId = s.id ?? it.service_id ?? null;
              const title = s.title || s.name || t("common.service", { defaultValue: "Услуга" });
              const image = Array.isArray(s.images) && s.images.length ? s.images[0] : null;

              // NEW: аккуратный вывод цены (если есть)
              const details = s.details || {};
              const price = firstNonEmpty(details.netPrice, s.price, it.price);
              const prettyPrice = fmtPrice(price);

              return (
                <div
                  key={it.id}
                  className="group relative bg-white border rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col"
                >
                  <div className="aspect-[16/10] bg-gray-100 relative">
                    {image ? (
                      <img src={image} alt={title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400">
                        <span className="text-sm">
                          {t("favorites.no_image", { defaultValue: "Нет изображения" })}
                        </span>
                      </div>
                    )}

                    {/* NEW: иконка-удаление (сердечко) */}
                    <button
                      onClick={() => onRemove?.(it.id)}
                      className="absolute top-2 right-2 p-1.5 rounded-full bg-black/30 hover:bg-black/40 text-white backdrop-blur-md ring-1 ring-white/20"
                      title={t("favorites.removed", { defaultValue: "Удалить из избранного" })}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 21s-7-4.534-9.5-8.25C1.1 10.3 2.5 6 6.5 6c2.2 0 3.5 1.6 3.5 1.6S11.8 6 14 6c4 0 5.4 4.3 4 6.75C19 16.466 12 21 12 21z" />
                      </svg>
                    </button>

                    {/* NEW: стеклянный тёмный тултип снизу при ховере */}
                    <div className="pointer-events-none absolute inset-x-2 bottom-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="rounded-lg bg-black/55 backdrop-blur-md text-white text-xs sm:text-sm p-3 ring-1 ring-white/15 shadow-lg">
                        <div className="font-semibold line-clamp-2">{title}</div>
                        {prettyPrice && (
                          <div className="mt-1">
                            <span className="opacity-80">
                              {t("marketplace.price", { defaultValue: "Цена" })}:{" "}
                            </span>
                            <span className="font-semibold">{prettyPrice}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="p-3 flex-1 flex flex-col">
                    <div className="font-semibold line-clamp-2">{title}</div>
                    {prettyPrice && (
                      <div className="mt-1 text-sm">
                        {t("marketplace.price", { defaultValue: "Цена" })}:{" "}
                        <span className="font-semibold">{prettyPrice}</span>
                      </div>
                    )}
                    <div className="mt-auto flex gap-2 pt-3">
                      {serviceId && (
                        <>
                          <button
                            onClick={() => onQuickRequest?.(serviceId)}
                            className="flex-1 bg-orange-500 text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-orange-600"
                          >
                            {t("actions.quick_request", { defaultValue: "Быстрый запрос" })}
                          </button>
                          <button
                            onClick={() => onBook?.(serviceId)}
                            className="flex-1 border rounded-lg px-3 py-2 text-sm hover:bg-gray-50"
                          >
                            {t("actions.book_now", { defaultValue: "Забронировать" })}
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => onRemove?.(it.id)}
                        className="px-3 py-2 text-sm rounded-lg border hover:bg-gray-50"
                        title={t("actions.delete", { defaultValue: "Удалить" })}
                      >
                        {t("actions.delete", { defaultValue: "Удалить" })}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-center gap-2 mt-6">
            <button
              className="px-3 py-1.5 rounded-lg border disabled:opacity-40"
              onClick={() => onPageChange?.(current - 1)}
              disabled={current <= 1}
            >
              {t("pagination.prev", { defaultValue: "←" })}
            </button>
            {Array.from({ length: pages }).map((_, i) => {
              const p = i + 1;
              const active = p === current;
              return (
                <button
                  key={p}
                  onClick={() => onPageChange?.(p)}
                  className={`px-3 py-1.5 rounded-lg border ${active ? "bg-gray-900 text-white" : "bg-white"}`}
                >
                  {p}
                </button>
              );
            })}
            <button
              className="px-3 py-1.5 rounded-lg border disabled:opacity-40"
              onClick={() => onPageChange?.(current + 1)}
              disabled={current >= pages}
            >
              {t("pagination.next", { defaultValue: "→" })}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ===================== Main Page ===================== */

export default function ClientDashboard() {
  const { t } = useTranslation();
  const fileRef = useRef(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Profile
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarBase64, setAvatarBase64] = useState(null); // data URL for UI
  const [avatarServerUrl, setAvatarServerUrl] = useState(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);

  // Password
  const [newPassword, setNewPassword] = useState("");
  const [changingPass, setChangingPass] = useState(false);

  // Stats
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);

  // Tabs
  const tabs = [
    { key: "requests", label: t("tabs.my_requests", { defaultValue: "Мои запросы" }) },
    { key: "bookings", label: t("tabs.my_bookings", { defaultValue: "Мои бронирования" }) },
    { key: "favorites", label: t("tabs.favorites", { defaultValue: "Избранное" }) },
  ];
  const initialTab = searchParams.get("tab") || "requests";
  const [activeTab, setActiveTab] = useState(tabs.some((t) => t.key === initialTab) ? initialTab : "requests");

  // Data for tabs
  const [requests, setRequests] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [loadingTab, setLoadingTab] = useState(false);

  // UI messages
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const favPageFromUrl = Number(searchParams.get("page") || 1);
  const [favPage, setFavPage] = useState(isNaN(favPageFromUrl) ? 1 : favPageFromUrl);

  // действия по офферу
  const [actingReqId, setActingReqId] = useState(null);

  // booking modal state
  const [bookingUI, setBookingUI] = useState({ open: false, serviceId: null });
  const [bkDate, setBkDate] = useState("");
  const [bkTime, setBkTime] = useState("");
  const [bkPax, setBkPax] = useState(1);
  const [bkNote, setBkNote] = useState("");
  const [bkSending, setBkSending] = useState(false);

  /* -------- Effects -------- */

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", activeTab);
    if (activeTab === "favorites") params.set("page", String(favPage));
    else params.delete("page");
    setSearchParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, favPage]);

  useEffect(() => {
    (async () => {
      try {
        setLoadingProfile(true);
        const me = await apiGet("/api/clients/me");
        setName(me?.name || "");
        setPhone(me?.phone || "");
        setAvatarBase64(me?.avatar_base64 ? toDataUrl(me.avatar_base64) : null);
        setAvatarServerUrl(me?.avatar_url || null);
        setRemoveAvatar(false);
      } catch {
        setError(t("errors.profile_load", { defaultValue: "Не удалось загрузить профиль" }));
      } finally {
        setLoadingProfile(false);
      }
    })();
  }, [t]);

  useEffect(() => {
    (async () => {
      try {
        setLoadingStats(true);
        const data = await apiGet("/api/clients/stats");
        setStats(data || {});
      } catch {
        setStats({});
      } finally {
        setLoadingStats(false);
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingTab(true);
        if (activeTab === "requests") {
          const data = await apiGet("/api/requests/my");
          if (!cancelled) setRequests(Array.isArray(data) ? data : data?.items || []);
        } else if (activeTab === "bookings") {
          const data = await apiGet("/api/bookings/my");
          if (!cancelled) setBookings(Array.isArray(data) ? data : data?.items || []);
        } else if (activeTab === "favorites") {
          const data = await apiGet("/api/wishlist?expand=service");
          const arr = Array.isArray(data) ? data : data?.items || [];
          if (!cancelled) {
            setFavorites(arr);
            const maxPage = Math.max(1, Math.ceil(arr.length / 8));
            setFavPage((p) => Math.min(Math.max(1, p), maxPage));
          }
        }
      } catch {
        if (activeTab === "favorites") setFavorites([]);
        else setError(t("errors.tab_load", { defaultValue: "Ошибка загрузки данных" }));
      } finally {
        if (!cancelled) setLoadingTab(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, t]);

  /* -------- Handlers -------- */

  const handleUploadClick = () => fileRef.current?.click();

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await cropAndResizeToDataURL(file, 512, 0.9);
      setAvatarBase64(dataUrl);
      setAvatarServerUrl(null);
      setRemoveAvatar(false);
    } catch {
      setError(t("errors.image_process", { defaultValue: "Не удалось обработать изображение" }));
    } finally {
      e.target.value = "";
    }
  };

  const handleRemovePhoto = () => {
    setAvatarBase64(null);
    setAvatarServerUrl(null);
    setRemoveAvatar(true);
  };

  const handleSaveProfile = async () => {
    try {
      setSavingProfile(true);
      setMessage(null);
      setError(null);
      const payload = { name, phone };
      if (avatarBase64) payload.avatar_base64 = stripDataUrlPrefix(avatarBase64);
      if (removeAvatar) payload.remove_avatar = true;

      const res = await apiPut("/api/clients/me", payload);
      setMessage(t("messages.profile_saved", { defaultValue: "Профиль сохранён" }));
      setName(res?.name ?? name);
      setPhone(res?.phone ?? phone);

      if (res?.avatar_base64) {
        setAvatarBase64(toDataUrl(res.avatar_base64));
        setAvatarServerUrl(null);
      } else if (res?.avatar_url) {
        setAvatarServerUrl(res.avatar_url);
        setAvatarBase64(null);
      }
      setRemoveAvatar(false);
    } catch {
      setError(t("errors.profile_save", { defaultValue: "Не удалось сохранить профиль" }));
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      setError(
        t("client.dashboard.passwordTooShort", { defaultValue: "Пароль должен быть не короче 6 символов" })
      );
      return;
    }
    try {
      setChangingPass(true);
      setError(null);
      await apiPost("/api/clients/change-password", { password: newPassword });
      setMessage(t("client.dashboard.passwordChanged", { defaultValue: "Пароль изменён" }));
      setNewPassword("");
    } catch {
      setError(t("errors.password_change", { defaultValue: "Не удалось изменить пароль" }));
    } finally {
      setChangingPass(false);
    }
  };

  const handleLogout = () => {
    try {
      localStorage.removeItem("clientToken");
      window.location.href = "/client/login";
    } catch {
      window.location.href = "/client/login";
    }
  };

  const handleRemoveFavorite = async (itemId) => {
    try {
      await apiPost("/api/wishlist/toggle", { itemId });
      setFavorites((prev) => prev.filter((x) => x.id !== itemId));
      setMessage(t("messages.favorite_removed", { defaultValue: "Удалено из избранного" }));
    } catch {
      setError(t("errors.favorite_remove", { defaultValue: "Не удалось удалить из избранного" }));
    }
  };

  const handleQuickRequest = async (serviceId) => {
    if (!serviceId) {
      setError(t("errors.service_unknown", { defaultValue: "Не удалось определить услугу" }));
      return;
    }
    const note =
      window.prompt(t("common.note_optional", { defaultValue: "Комментарий к запросу (необязательно):" })) ||
      undefined;
    try {
      await apiPost("/api/requests", { service_id: serviceId, note });
      setMessage(t("messages.request_sent", { defaultValue: "Запрос отправлен" }));
      setActiveTab("requests");
      try {
        const data = await apiGet("/api/requests/my");
        setRequests(Array.isArray(data) ? data : data?.items || []);
      } catch {}
    } catch {
      setError(t("errors.request_send", { defaultValue: "Не удалось отправить запрос" }));
    }
  };

  // accept/reject предложения
  const handleAcceptProposal = async (id) => {
    try {
      setActingReqId(id);
      setError(null);
      await apiPost(`/api/requests/${id}/accept`, {});
      setMessage(t("client.dashboard.accepted", { defaultValue: "Предложение принято" }));
      const [r, b] = await Promise.allSettled([apiGet("/api/requests/my"), apiGet("/api/bookings/my")]);
      if (r.status === "fulfilled") setRequests(Array.isArray(r.value) ? r.value : r.value?.items || []);
      if (b.status === "fulfilled") setBookings(Array.isArray(b.value) ? b.value : b.value?.items || []);
      setActiveTab("bookings");
    } catch (e) {
      setError(e?.message || t("errors.action_failed", { defaultValue: "Не удалось выполнить действие" }));
    } finally {
      setActingReqId(null);
    }
  };

  const handleRejectProposal = async (id) => {
    try {
      setActingReqId(id);
      setError(null);
      await apiPost(`/api/requests/${id}/reject`, {});
      setMessage(t("client.dashboard.rejected", { defaultValue: "Предложение отклонено" }));
      const data = await apiGet("/api/requests/my");
      setRequests(Array.isArray(data) ? data : data?.items || []);
    } catch (e) {
      setError(e?.message || t("errors.action_failed", { defaultValue: "Не удалось выполнить действие" }));
    } finally {
      setActingReqId(null);
    }
  };

  // booking
  function openBooking(serviceId) {
    setBookingUI({ open: true, serviceId });
    setBkDate(""); setBkTime(""); setBkPax(1); setBkNote("");
  }
  function closeBooking() {
    setBookingUI({ open: false, serviceId: null });
  }
  async function createBooking() {
    if (!bookingUI.serviceId) return;
    setBkSending(true);
    try {
      const details = {
        date: bkDate || undefined,
        time: bkTime || undefined,
        pax: Number(bkPax) || 1,
        note: bkNote || undefined,
      };
      await apiPost("/api/bookings", { service_id: bookingUI.serviceId, details });
      closeBooking();
      setMessage(t("messages.booking_created", { defaultValue: "Бронирование отправлено" }));
      setActiveTab("bookings"); // триггерит загрузку бронирований
      try {
        const data = await apiGet("/api/bookings/my");
        setBookings(Array.isArray(data) ? data : data?.items || []);
      } catch {}
    } catch (e) {
      setError(e?.message || t("errors.booking_create", { defaultValue: "Не удалось создать бронирование" }));
    } finally {
      setBkSending(false);
    }
  }

  /* -------- Render helpers -------- */

  const Avatar = () => {
    const src = avatarBase64 || avatarServerUrl || null;
    if (src) {
      return <img src={src} alt="" className="w-24 h-24 rounded-full object-cover border" />;
    }
    return (
      <div className="w-24 h-24 rounded-full bg-gray-200 border flex items-center justify-center text-xl font-semibold text-gray-600">
        {initials(name)}
      </div>
    );
  };

  const TabButton = ({ tabKey, children }) => {
    const active = activeTab === tabKey;
    return (
      <button
        onClick={() => setActiveTab(tabKey)}
        className={`px-4 py-2 rounded-lg border-b-2 font-medium ${active ? "border-gray-900 text-gray-900" : "border-transparent text-gray-500"}`}
      >
        {children}
      </button>
    );
  };

  const RequestsList = () => {
    if (loadingTab) return <div className="text-gray-500">{t("common.loading", { defaultValue: "Загрузка..." })}</div>;
    if (!requests?.length) return <div className="text-gray-500">{t("empty.no_requests", { defaultValue: "Пока нет запросов." })}</div>;
    return (
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {requests.map((r) => {
          const serviceTitle = r?.service?.title || r?.service_title || r?.title || t("common.request", { defaultValue: "Запрос" });
          const status = r?.status || "new";
          const created = r?.created_at ? new Date(r.created_at).toLocaleString() : "";
          const p = r?.proposal || null;

          return (
            <div key={r.id} className="bg-white border rounded-xl p-4">
              <div className="font-semibold">{serviceTitle}</div>
              <div className="text-sm text-gray-500 mt-1">
                {t("common.status", { defaultValue: "Статус" })}: {status}
              </div>
              {created && (
                <div className="text-xs text-gray-400 mt-1">
                  {t("common.created", { defaultValue: "Создан" })}: {created}
                </div>
              )}
              {r?.note && (
                <div className="text-sm text-gray-600 mt-2">
                  {t("common.comment", { defaultValue: "Комментарий" })}: {r.note}
                </div>
              )}

              {/* Предложение от провайдера */}
              {p ? (
                <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm">
                  <div className="font-medium mb-1">
                    {t("client.dashboard.offer", { defaultValue: "Предложение" })}
                  </div>
                  <div>
                    {t("client.dashboard.price", { defaultValue: "Цена" })}: {p.price} {p.currency || "USD"}
                  </div>
                  {p.hotel && <div>Отель: {p.hotel}</div>}
                  {p.room && <div>Размещение: {p.room}</div>}
                  {p.terms && <div>Условия: {p.terms}</div>}
                  {p.message && <div>Сообщение: {p.message}</div>}

                  {status !== "accepted" && status !== "rejected" && (
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => handleAcceptProposal(r.id)}
                        disabled={actingReqId === r.id}
                        className="px-3 py-1.5 rounded bg-orange-600 text-white disabled:opacity-60"
                      >
                        {t("client.dashboard.accept", { defaultValue: "Принять" })}
                      </button>
                      <button
                        onClick={() => handleRejectProposal(r.id)}
                        disabled={actingReqId === r.id}
                        className="px-3 py-1.5 rounded border disabled:opacity-60"
                      >
                        {t("client.dashboard.reject", { defaultValue: "Отклонить" })}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-2 text-sm text-gray-500">
                  {t("client.dashboard.waitingOffer", { defaultValue: "Ожидает предложения…" })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const BookingsList = () => {
    if (loadingTab) return <div className="text-gray-500">{t("common.loading", { defaultValue: "Загрузка..." })}</div>;
    if (!bookings?.length) return <div className="text-gray-500">{t("empty.no_bookings", { defaultValue: "Пока нет бронирований." })}</div>;
    return (
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {bookings.map((b) => {
          const serviceTitle = b?.service?.title || b?.service_title || b?.title || t("common.booking", { defaultValue: "Бронирование" });
          const status = b?.status || "new";
          const date = b?.date || b?.created_at;
          const when = date ? new Date(date).toLocaleString() : "";
          return (
            <div key={b.id} className="bg-white border rounded-xl p-4">
              <div className="font-semibold">{serviceTitle}</div>
              <div className="text-sm text-gray-500 mt-1">{t("common.status", { defaultValue: "Статус" })}: {status}</div>
              {when && <div className="text-xs text-gray-400 mt-1">{t("common.date", { defaultValue: "Дата" })}: {when}</div>}
              {b?.price && <div className="text-sm text-gray-600 mt-2">{t("common.amount", { defaultValue: "Сумма" })}: {b.price}</div>}
            </div>
          );
        })}
      </div>
    );
  };

  const FavoritesTab = () => {
    if (loadingTab) return <div className="text-gray-500">{t("common.loading", { defaultValue: "Загрузка..." })}</div>;
    return (
      <FavoritesList
        items={favorites}
        page={favPage}
        perPage={8}
        onRemove={handleRemoveFavorite}
        onQuickRequest={handleQuickRequest}
        onBook={(serviceId) => openBooking(serviceId)}
        onPageChange={(p) => setFavPage(p)}
      />
    );
  };

  /* -------- Layout -------- */

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left: Profile */}
        <div className="md:col-span-1">
          <div className="bg-white rounded-xl shadow p-6 border">
            <div className="flex items-center gap-4">
              <Avatar />
              <div className="flex flex-col gap-2">
                <button onClick={handleUploadClick} className="px-3 py-2 text-sm bg-gray-900 text-white rounded-lg">
                  {avatarBase64 || avatarServerUrl
                    ? t("client.dashboard.changePhoto", { defaultValue: "Сменить фото" })
                    : t("client.dashboard.uploadPhoto", { defaultValue: "Загрузить фото" })}
                </button>
                {(avatarBase64 || avatarServerUrl) && (
                  <button onClick={handleRemovePhoto} className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50">
                    {t("client.dashboard.removePhoto", { defaultValue: "Удалить фото" })}
                  </button>
                )}
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <div>
                <label className="text-sm text-gray-600">{t("client.dashboard.name", { defaultValue: "Наименование" })}</label>
                <input
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("client.dashboard.name", { defaultValue: "Ваше имя" })}
                />
              </div>
              <div>
                <label className="text-sm text-gray-600">{t("client.dashboard.phone", { defaultValue: "Телефон" })}</label>
                <input
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+998 ..."
                />
              </div>

              <div className="pt-2">
                <button
                  onClick={handleSaveProfile}
                  disabled={savingProfile || loadingProfile}
                  className="w-full bg-orange-500 text-white rounded-lg px-4 py-2 font-semibold disabled:opacity-60"
                >
                  {savingProfile ? t("common.saving", { defaultValue: "Сохранение..." }) : t("client.dashboard.saveBtn", { defaultValue: "Сохранить" })}
                </button>
              </div>
            </div>

            <div className="mt-8 border-t pt-6">
              <div className="text-sm text-gray-600 mb-2">{t("client.dashboard.changePassword", { defaultValue: "Смена пароля" })}</div>
              <div className="flex gap-2">
                <input
                  type="password"
                  className="flex-1 border rounded-lg px-3 py-2"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t("client.dashboard.newPassword", { defaultValue: "Новый пароль" })}
                />
                <button onClick={handleChangePassword} disabled={changingPass} className="px-4 py-2 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-60">
                  {changingPass ? "..." : t("client.dashboard.changeBtn", { defaultValue: "Сменить" })}
                </button>
              </div>
            </div>

            <div className="mt-8">
              <button onClick={handleLogout} className="w-full px-4 py-2 rounded-lg border text-red-600 hover:bg-red-50">
                {t("client.dashboard.logout", { defaultValue: "Выйти" })}
              </button>
            </div>

            {(message || error) && (
              <div className="mt-4 text-sm">
                {message && <div className="text-green-600 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{message}</div>}
                {error && <div className="text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2">{error}</div>}
              </div>
            )}
          </div>
        </div>

        {/* Right: Stats + Tabs */}
        <div className="md:col-span-2">
          {loadingStats ? (
            <div className="bg-white rounded-xl shadow p-6 border text-gray-500">{t("common.loading", { defaultValue: "Загрузка..." })}</div>
          ) : (
            <ClientStatsBlock stats={stats} />
          )}

          <div className="mt-6 bg-white rounded-xl shadow p-6 border">
            <div className="flex items-center gap-3 border-b pb-3 mb-4">
              <TabButton tabKey="requests">{t("tabs.my_requests", { defaultValue: "Мои запросы" })}</TabButton>
              <TabButton tabKey="bookings">{t("tabs.my_bookings", { defaultValue: "Мои бронирования" })}</TabButton>
              <TabButton tabKey="favorites">{t("tabs.favorites", { defaultValue: "Избранное" })}</TabButton>
              <div className="ml-auto">
                <button
                  onClick={async () => {
                    try {
                      setLoadingTab(true);
                      if (activeTab === "requests") {
                        const data = await apiGet("/api/requests/my");
                        setRequests(Array.isArray(data) ? data : data?.items || []);
                      } else if (activeTab === "bookings") {
                        const data = await apiGet("/api/bookings/my");
                        setBookings(Array.isArray(data) ? data : data?.items || []);
                      } else {
                        const data = await apiGet("/api/wishlist?expand=service");
                        const arr = Array.isArray(data) ? data : data?.items || [];
                        setFavorites(arr);
                      }
                    } finally {
                      setLoadingTab(false);
                    }
                  }}
                  className="text-orange-600 hover:underline text-sm"
                >
                  {t("client.dashboard.refresh", { defaultValue: "Обновить" })}
                </button>
              </div>
            </div>

            {activeTab === "requests" && <RequestsList />}
            {activeTab === "bookings" && <BookingsList />}
            {activeTab === "favorites" && <FavoritesTab />}
          </div>
        </div>
      </div>

      {/* Booking modal */}
      {bookingUI.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md bg-white rounded-xl shadow p-5">
            <div className="text-lg font-semibold mb-3">
              {t("booking.title", { defaultValue: "Быстрое бронирование" })}
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-gray-600">{t("booking.date", { defaultValue: "Дата" })}</label>
                  <input type="date" className="mt-1 w-full border rounded-lg px-3 py-2"
                    value={bkDate} onChange={(e) => setBkDate(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm text-gray-600">{t("booking.time", { defaultValue: "Время" })}</label>
                  <input type="time" className="mt-1 w-full border rounded-lg px-3 py-2"
                    value={bkTime} onChange={(e) => setBkTime(e.target.value)} />
                </div>
              </div>

              <div>
                <label className="text-sm text-gray-600">{t("booking.pax", { defaultValue: "Кол-во людей" })}</label>
                <input type="number" min="1" className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={bkPax} onChange={(e) => setBkPax(e.target.value)} />
              </div>

              <div>
                <label className="text-sm text-gray-600">{t("common.note_optional", { defaultValue: "Комментарий (необязательно)" })}</label>
                <textarea rows={3} className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={bkNote} onChange={(e) => setBkNote(e.target.value)} />
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button onClick={createBooking} disabled={bkSending}
                className="flex-1 bg-orange-500 text-white rounded-lg px-4 py-2 font-semibold disabled:opacity-60">
                {bkSending ? t("common.sending", { defaultValue: "Отправка..." }) : t("booking.submit", { defaultValue: "Забронировать" })}
              </button>
              <button onClick={closeBooking} className="px-4 py-2 rounded-lg border">
                {t("actions.cancel", { defaultValue: "Отмена" })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
