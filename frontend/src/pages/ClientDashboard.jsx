// frontend/src/pages/ClientDashboard.jsx
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { apiGet, apiPut, apiPost, apiDelete } from "../api";
import { createPortal } from "react-dom";
import QuickRequestModal from "../components/QuickRequestModal";
import ConfirmModal from "../components/ConfirmModal";
import ServiceCard from "../components/ServiceCard";
import { tSuccess, tError, tInfo } from "../shared/toast";

const FAV_PAGE_SIZE = 8;

/* ===================== Helpers ===================== */
function initials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || "";
  const second = parts[1]?.[0] || "";
  return (first + second).toUpperCase() || "U";
}
function toDataUrl(b64OrDataUrl, mime = "image/jpeg") {
  if (!b64OrDataUrl) return null;
  return String(b64OrDataUrl).startsWith("data:") ? b64OrDataUrl : `data:${mime};base64,${b64OrDataUrl}`;
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
          canvas.width = size; canvas.height = size;
          const ctx = canvas.getContext("2d");
          ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
          const dataUrl = canvas.toDataURL("image/jpeg", quality);
          resolve(dataUrl);
        };
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    } catch (e) { reject(e); }
  });
}

/* ===== value helpers ===== */
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
function pick(obj, keys) {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (v === 0 || (v !== undefined && v !== null && String(v).trim() !== "")) return v;
  }
  return null;
}
function buildDates(d = {}) {
  const hotelIn = d.hotel_check_in || d.checkIn || d.startDate || d.start_flight_date || d.startFlightDate || d.departureFlightDate;
  const hotelOut = d.hotel_check_out || d.checkOut || d.returnDate || d.end_flight_date || d.endFlightDate || d.returnFlightDate;
  if (hotelIn && hotelOut) return `${hotelIn} → ${hotelOut}`;
  if (hotelIn) return String(hotelIn);
  if (hotelOut) return String(hotelOut);
  return null;
}
/* форматирование Telegram */
function renderTelegram(value) {
  if (!value) return null;
  const s = String(value).trim();
  let href = null, label = s;
  if (/^https?:\/\//i.test(s)) href = s;
  else if (s.startsWith("@")) { href = `https://t.me/${s.slice(1)}`; label = s; }
  else if (/^[A-Za-z0-9_]+$/.test(s)) { href = `https://t.me/${s}`; label = `@${s}`; }
  return { href, label };
}

/* ============ Портал (подсказка) ============ */
function TooltipPortal({ visible, x, y, width, children }) {
  if (!visible) return null;
  return createPortal(
    <div className="fixed z-10 pointer-events-none" style={{ left: x, top: y, width, opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(-4px)", transition: "opacity 120ms ease, transform 120ms ease" }}>{children}</div>,
    document.body
  );
}

/* ======== provider fetch (cache + fallbacks) ======== */
const providerCache = new Map();
async function fetchProviderProfile(providerId) {
  if (!providerId) return null;
  if (providerCache.has(providerId)) return providerCache.get(providerId);
  const endpoints = [
    `/api/providers/${providerId}`, `/api/provider/${providerId}`,
    `/api/suppliers/${providerId}`, `/api/supplier/${providerId}`,
    `/api/agencies/${providerId}`, `/api/agency/${providerId}`,
    `/api/companies/${providerId}`, `/api/company/${providerId}`,
    `/api/users/${providerId}`, `/api/user/${providerId}`,
  ];
  let profile = null;
  for (const url of endpoints) {
    try {
      const res = await apiGet(url);
      const obj = (res && (res.data || res.item || res.profile || res.provider || res.company)) || res;
      if (obj && (obj.id || obj.name || obj.title)) { profile = obj; break; }
    } catch {}
  }
  providerCache.set(providerId, profile || null);
  return profile;
}

/* ===== Универсальный парсер полей услуги ===== */
function _firstNonEmpty(...args) { for (const v of args) if (v === 0 || (v !== undefined && v !== null && String(v).trim() !== "")) return v; return null; }
function _maybeParse(obj) { if (!obj) return null; if (typeof obj === "string") { try { return JSON.parse(obj); } catch { return null; } } return typeof obj === "object" ? obj : null; }
function _mergeDetails(svc, it) {
  const cands = [svc?.details, it?.details, svc?.detail, it?.detail, svc?.meta, svc?.params, svc?.payload, svc?.extra, svc?.data, svc?.info]
    .map(_maybeParse).filter(Boolean);
  return Object.assign({}, ...cands);
}
function extractServiceFields(item) {
  const svc = item?.service || item || {};
  const details = _mergeDetails(svc, item);
  const bag = { ...details, ...svc, ...item };

  const title = _firstNonEmpty(svc.title, svc.name, details?.title, details?.name, details?.eventName, item?.title, item?.name);

  const rawPrice = _firstNonEmpty(details?.netPrice, details?.price, details?.totalPrice, details?.priceNet, details?.grossPrice, svc.netPrice, svc.price, item?.price);
  const prettyPrice = rawPrice == null ? null : new Intl.NumberFormat().format(Number(rawPrice));

  const hotel = _firstNonEmpty(details?.hotel, details?.hotelName, details?.hotel?.name, details?.refused_hotel_name, svc.hotel, svc.hotel_name, svc.refused_hotel_name);
  const accommodation = _firstNonEmpty(details?.accommodation, details?.accommodationCategory, details?.room, details?.roomType, details?.room_category, svc.accommodation, svc.room, svc.room_type);

  const left = _firstNonEmpty(bag.hotel_check_in, bag.checkIn, bag.startDate, bag.start_flight_date, bag.startFlightDate, bag.departureFlightDate);
  const right = _firstNonEmpty(bag.hotel_check_out, bag.checkOut, bag.returnDate, bag.end_flight_date, bag.endFlightDate, bag.returnFlightDate);
  const dates = left && right ? `${left} → ${right}` : left || right || null;

  const inlineProvider = _firstNonEmpty(svc.provider, svc.provider_profile, svc.supplier, svc.vendor, svc.agency, svc.owner, item.provider, item.provider_profile, item.supplier, item.vendor, item.agency, item.owner, details?.provider) || {};

  const providerId = _firstNonEmpty(svc.provider_id, svc.providerId, item.provider_id, item.providerId, details?.provider_id, svc.owner_id, svc.agency_id, inlineProvider?.id, inlineProvider?._id);

  const flatName  = _firstNonEmpty(pick(bag, ["provider_name","supplier_name","vendor_name","agency_name","company_name","providerTitle","display_name"]));
  const flatPhone = _firstNonEmpty(pick(bag, ["provider_phone","supplier_phone","vendor_phone","agency_phone","company_phone","contact_phone","phone","whatsapp","whats_app"]));
  const flatTg = _firstNonEmpty(
    pick(bag, [
      "provider_telegram","supplier_telegram","vendor_telegram","agency_telegram","company_telegram",
      "telegram","tg","telegram_username","telegram_link",
      "provider_social","supplier_social","vendor_social","agency_social","company_social",
      "social","social_link"
    ])
  );

  const status = _firstNonEmpty(svc.status, item.status, details?.status);

  return { svc, details, title, hotel, accommodation, dates, rawPrice, prettyPrice, inlineProvider, providerId, flatName, flatPhone, flatTg, status };
}

/* ===================== API fallbacks ===================== */
const arrify = (res) =>
  Array.isArray(res) ? res : res?.items || res?.data || res?.list || res?.results || [];

// «мои» заявки
async function fetchClientRequestsSafe(myId) {
  const candidates = [
    "/api/requests/my",
    "/api/requests/mine",
    "/api/my/requests",
    "/api/client/requests",
    "/api/clients/requests",
    "/api/requests?mine=1",
    "/api/requests?me=1",
    "/api/requests",
  ];
  for (const url of candidates) {
    try {
      const r = await apiGet(url);
      let list = arrify(r);
      if (url === "/api/requests" && myId) {
        list = list.filter((x) => {
          const ids = [x.client_id, x.clientId, x.user_id, x.userId, x.created_by, x.createdBy, x.owner_id, x.ownerId]
            .filter((v) => v !== undefined && v !== null);
          return ids.some((v) => String(v) === String(myId));
        });
      }
      return list;
    } catch {}
  }
  return [];
}

// «мои» брони
async function fetchClientBookingsSafe() {
  const candidates = [
    "/api/bookings/my",
    "/api/bookings/mine",
    "/api/my/bookings",
    "/api/client/bookings",
    "/api/clients/bookings",
    "/api/bookings?mine=1",
    "/api/bookings?me=1",
  ];
  for (const url of candidates) {
    try { return arrify(await apiGet(url)); } catch {}
  }
  return [];
}

/* ===================== Локальные черновики (без бэка) ===================== */
const draftsKey = (id) => (id ? `client:req:drafts:${id}` : `client:req:drafts:anon`);
const loadDrafts = (id) => {
  try { const raw = localStorage.getItem(draftsKey(id)); const arr = raw ? JSON.parse(raw) : []; return Array.isArray(arr) ? arr : []; }
  catch { return []; }
};
const saveDrafts = (id, arr) => {
  try { localStorage.setItem(draftsKey(id), JSON.stringify(arr)); } catch {}
};
const mergeRequests = (apiArr = [], draftArr = []) => {
  const map = new Map();
  apiArr.forEach((x) => map.set(String(x.id ?? x._id ?? Math.random()), { ...x }));
  draftArr.forEach((d) => map.set(String(d.id ?? `d_${d.created_at}`), { ...d }));
  // хотим черновики сверху
  const drafts = [...draftArr];
  const api    = [...apiArr].filter(a => !drafts.some(d => String(d.id) === String(a.id)));
  return [...drafts, ...api];
};
const makeDraft = ({ serviceId, title }) => ({
  id: `d_${Date.now()}`,
  service_id: serviceId,
  title: title || "Запрос",
  status: "new",
  created_at: new Date().toISOString(),
  is_draft: true,
});

/* ===================== Mini Components ===================== */

function Stars({ value = 0, size = 18, className = "" }) {
  const full = Math.floor(value);
  const half = value - full >= 0.5;
  const total = 5;
  const starPath = "M12 .587l3.668 7.428 8.2 1.733-5.934 5.78 1.402 8.472L12 19.548 4.664 24l1.402-8.472L.132 9.748l8.2-1.733z";
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {Array.from({ length: total }).map((_, i) => {
        const filled = i < full;
        const showHalf = i === full && half;
        return (
          <div key={i} className="relative" style={{ width: size, height: size }}>
            <svg viewBox="0 0 24 24" width={size} height={size} className={filled ? "text-yellow-400" : "text-gray-300"} fill="currentColor"><path d={starPath} /></svg>
            {showHalf && (
              <svg viewBox="0 0 24 24" width={size} height={size} className="absolute inset-0 text-yellow-400 overflow-hidden" style={{ clipPath: "inset(0 50% 0 0)" }} fill="currentColor"><path d={starPath} /></svg>
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
      <div className="w-full bg-gray-200 rounded-full h-3"><div className="h-3 bg-orange-500 rounded-full transition-all" style={{ width: `${pct}%` }} title={`${pct}%`} /></div>
      <div className="mt-1 text-xs text-gray-500">{value} / {max} ({pct}%)</div>
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

      <div className="mt-4"><Progress value={points} max={next} label={t("stats.bonus_progress", { defaultValue: "Bonus progress" })} /></div>

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
      <div className="text-gray-600">{t("favorites.empty_desc", { defaultValue: "Добавляйте интересные услуги в избранное и возвращайтесь позже." })}</div>
    </div>
  );
}

/** ==================== НОВЫЙ FavoritesList: рендер через ServiceCard ==================== */
function FavoritesList({
  items,
  page,
  perPage = 8,
  onPageChange,
  favIds,
  onToggleFavorite,
  onQuickRequest,
  now,
}) {
  const { t } = useTranslation();
  const total = items?.length || 0;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * perPage;
  const pageItems = items.slice(start, start + perPage);

  // helper для id услуги внутри элемента избранного
  const getServiceId = (row) => {
    const svc = row?.service || row || {};
    return (
      svc.id ??
      row?.service_id ??
      row?.serviceId ??
      svc._id ??
      row?._id ??
      null
    );
  };

  return (
    <div>
      {total === 0 ? (
        <EmptyFavorites />
      ) : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {pageItems.map((row) => {
              const sid = getServiceId(row);
              return (
                <ServiceCard
                  key={sid || JSON.stringify(row)}
                  item={row?.service ?? row}
                  now={now}
                  viewerRole="client"
                  favActive={sid ? favIds?.has(String(sid)) : false}
                  onToggleFavorite={() => sid && onToggleFavorite?.(sid)}
                  onQuickRequest={(serviceId, providerId, title) =>
                    onQuickRequest?.(serviceId ?? sid, { title })
                  }
                />
              );
            })}
          </div>

          {/* Пагинация */}
          {total > perPage && (
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
                    className={`px-3 py-1.5 rounded-lg border ${
                      active ? "bg-gray-900 text-white" : "bg-white"
                    }`}
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
          )}
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

  // минутный таймер для «ровного» отсчёта без мерцаний
  const [nowMin, setNowMin] = useState(() => Math.floor(Date.now() / 60000));
  useEffect(() => {
    const id = setInterval(() => setNowMin(Math.floor(Date.now() / 60000)), 60000);
    return () => clearInterval(id);
  }, []);
  const now = nowMin * 60000;

  // Profile
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [telegram, setTelegram] = useState("");
  const [avatarBase64, setAvatarBase64] = useState(null);
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

  const [actingReqId, setActingReqId] = useState(null);

  const [bookingUI, setBookingUI] = useState({ open: false, serviceId: null });
  
  // Quick Request (единый модал)
  const [qrOpen, setQrOpen] = useState(false);
  const [qrServiceId, setQrServiceId] = useState(null);
  const [qrTitle, setQrTitle] = useState(""); // только для локального «черновика»

  const [bkDate, setBkDate] = useState("");
  const [bkTime, setBkTime] = useState("");
  const [bkPax, setBkPax] = useState(1);
  const [bkNote, setBkNote] = useState("");
  const [bkSending, setBkSending] = useState(false);

  // мой id из профиля (для фильтрации/ключа черновиков)
  const [myId, setMyId] = useState(null);

  // удаление моих запросов
  const [delUI, setDelUI] = useState({ open: false, id: null, isDraft: false, sending: false });

  // 🔴 Set of избранных serviceId (для сердечек и мгновенного hidden)
  const [favIds, setFavIds] = useState(new Set());

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", activeTab);
    if (activeTab === "favorites") params.set("page", String(favPage));
    else params.delete("page");
    setSearchParams(params, { replace: true });
  }, [activeTab, favPage]); // eslint-disable-line

  useEffect(() => {
    (async () => {
      try {
        setLoadingProfile(true);
        const me = await apiGet("/api/clients/me");
        setName(me?.name || "");
        setPhone(me?.phone || "");
        setTelegram(me?.telegram || "");
        setAvatarBase64(me?.avatar_base64 ? toDataUrl(me.avatar_base64) : null);
        setAvatarServerUrl(me?.avatar_url || null);
        setRemoveAvatar(false);
        setMyId(me?.id || me?._id || me?.user_id || me?.client_id || null);
      } catch {
        setError(t("errors.profile_load", { defaultValue: "Не удалось загрузить профиль" }));
      } finally {
        setLoadingProfile(false);
      }
    })();
  }, [t]);

  // миграция «anon» черновиков в «мой» ключ, как только узнали myId
  useEffect(() => {
    if (!myId) return;
    const anon = loadDrafts(null);
    if (anon.length) {
      const mine = loadDrafts(myId);
      saveDrafts(myId, mergeRequests(mine, anon));
      saveDrafts(null, []);
      // если открыт таб запросов — сразу подмерджим в стейт
      setRequests(prev => mergeRequests(prev, anon));
    }
  }, [myId]);

  // загружаем статистику
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

  // загрузка данных табов + подмешивание черновиков
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingTab(true);
        if (activeTab === "requests") {
          const apiList = await fetchClientRequestsSafe(myId);
          const drafts  = [...loadDrafts(myId), ...loadDrafts(null)];
          if (!cancelled) setRequests(mergeRequests(apiList, drafts));
        } else if (activeTab === "bookings") {
          const data = await fetchClientBookingsSafe();
          if (!cancelled) setBookings(data);
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
    return () => { cancelled = true; };
  }, [activeTab, t, myId]);

  // подгружаем ids избранного (для сердечка) при входе на таб
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (activeTab !== "favorites") return;
      try {
        const ids = await apiGet("/api/wishlist/ids");
        const arr = Array.isArray(ids) ? ids : [];
        if (!cancelled) setFavIds(new Set(arr.map(String)));
      } catch { if (!cancelled) setFavIds(new Set()); }
    })();
    return () => { cancelled = true; };
  }, [activeTab]);

  // слушаем событие мгновенного создания (в т.ч. из маркетплейса) + синхронизация между вкладками
  useEffect(() => {
    const onCreated = (e) => {
      const { service_id, title } = e.detail || {};
      if (!service_id) return;
      const draft = makeDraft({ serviceId: service_id, title });
      const keyId = myId || null;
      const current = loadDrafts(keyId);
      saveDrafts(keyId, [draft, ...current]);
      setRequests((prev) => [draft, ...prev]);
    };
    const onStorage = (ev) => {
      if (!ev.key) return;
      if (ev.key === draftsKey(myId) || ev.key === draftsKey(null)) {
        const drafts = [...loadDrafts(myId), ...loadDrafts(null)];
        setRequests(prev => mergeRequests(prev.filter(x => !x.is_draft), drafts));
      }
    };
    window.addEventListener("request:created", onCreated);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("request:created", onCreated);
      window.removeEventListener("storage", onStorage);
    };
  }, [myId]);

  const handleUploadClick = () => fileRef.current?.click();
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await cropAndResizeToDataURL(file, 512, 0.9);
      setAvatarBase64(dataUrl); setAvatarServerUrl(null); setRemoveAvatar(false);
    } catch { setError(t("errors.image_process", { defaultValue: "Не удалось обработать изображение" })); }
    finally { e.target.value = ""; }
  };
  const handleRemovePhoto = () => { setAvatarBase64(null); setAvatarServerUrl(null); setRemoveAvatar(true); };

  const handleSaveProfile = async () => {
    try {
      setSavingProfile(true); setMessage(null); setError(null);
      const payload = { name, phone, telegram };
      if (avatarBase64) payload.avatar_base64 = stripDataUrlPrefix(avatarBase64);
      if (removeAvatar) payload.remove_avatar = true;
      const res = await apiPut("/api/clients/me", payload);
      setMessage(t("messages.profile_saved", { defaultValue: "Профиль сохранён" }));
      tSuccess(t("messages.profile_saved") || "Профиль сохранён", { autoClose: 1800 });
      setName(res?.name ?? name);
      setPhone(res?.phone ?? phone);
      setTelegram(res?.telegram ?? telegram);
      if (res?.avatar_base64) { setAvatarBase64(toDataUrl(res.avatar_base64)); setAvatarServerUrl(null); }
      else if (res?.avatar_url) { setAvatarServerUrl(res.avatar_url); setAvatarBase64(null); }
      setRemoveAvatar(false);
    } catch {
   setError(t("errors.profile_save", { defaultValue: "Не удалось сохранить профиль" }));
   tError(t("errors.profile_save") || "Не удалось сохранить профиль", { autoClose: 2000 });
 }
    finally { setSavingProfile(false); }
  };

  const handleChangePassword = async () => {
    if (!newPassword || newPassword.length < 6) { setError(t("client.dashboard.passwordTooShort", { defaultValue: "Пароль должен быть не короче 6 символов" })); return; }
    try {
      setChangingPass(true); setError(null);
      await apiPost("/api/clients/change-password", { password: newPassword });
      setMessage(t("client.dashboard.passwordChanged", { defaultValue: "Пароль изменён" }));
      tSuccess(t("client.dashboard.passwordChanged") || "Пароль изменён", { autoClose: 1800 });
     } catch {
   setError(t("errors.password_change", { defaultValue: "Не удалось изменить пароль" }));
   tError(t("errors.password_change") || "Не удалось изменить пароль", { autoClose: 2000 });
 }
    finally { setChangingPass(false); }
  };

   const handleLogout = () => {
   try {
     localStorage.removeItem("clientToken");
     localStorage.removeItem("token");
   } finally {
     window.location.href = "/client/login";
   }
 };

  // старый remove по itemId (оставляю — может вызывать из других мест)
  const handleRemoveFavorite = async (itemId) => {
    try { await apiPost("/api/wishlist/toggle", { itemId }); } catch {}
    setFavorites((prev) => prev.filter((x) => x.id !== itemId));
    setMessage(t("messages.favorite_removed", { defaultValue: "Удалено из избранного" }));
    tInfo(t("favorites.removed_toast") || "Удалено из избранного", { autoClose: 1500 });
  };

  // 🔴 новый тоггл по serviceId для сердечка ServiceCard
  const toggleFavoriteClient = async (serviceId) => {
  const key = String(serviceId || "");

  if (!key) {
    tError(t("toast.favoriteError") || "Не удалось изменить избранное", { autoClose: 2000 });
    setError(t("toast.favoriteError", { defaultValue: "Не удалось изменить избранное" }));
    return;
  }

  try {
    // сервер может вернуть либо { added: true/false }, либо завернуть это в data
    const res = await apiPost("/api/wishlist/toggle", { serviceId });
    const added = !!(res?.added ?? res?.data?.added);

    // тост, как у провайдера
    (added ? tSuccess : tInfo)(
      added
        ? (t("favorites.added_toast") || "Добавлено в избранное")
        : (t("favorites.removed_toast") || "Удалено из избранного"),
      { autoClose: 1800, toastId: `fav-${key}-${added ? "add" : "rem"}` }
    );

    // синхронизируем Set избранных id
    setFavIds((prev) => {
      const next = new Set(prev);
      if (added) next.add(key);
      else next.delete(key);
      return next;
    });

    // при снятии избранного — удаляем карточку из списка и корректируем пагинацию
    if (!added) {
      let newLen = 0;
      setFavorites((prev) => {
        const updated = prev.filter((row) => {
          const sid =
            row?.service?.id ??
            row?.service_id ??
            row?.serviceId ??
            row?.id ??
            null;
          return String(sid) !== key;
        });
        newLen = updated.length;
        return updated;
      });

      setFavPage((p) => {
        const maxPage = Math.max(1, Math.ceil(newLen / FAV_PAGE_SIZE));
        return Math.min(p, maxPage);
      });
    }

    // для старого UI, где есть message/error-лента — оставим текст
    setMessage(
      added
        ? t("messages.favorite_added", { defaultValue: "Добавлено в избранное" })
        : t("messages.favorite_removed", { defaultValue: "Удалено из избранного" })
    );
  } catch (err) {
    // аккуратно разбираем ошибку
    const status =
      err?.status ||
      err?.response?.status ||
      err?.data?.status ||
      (typeof err?.message === "string" && /(^|\s)4\d\d(\s|$)/.test(err.message) ? 400 : undefined);

    if (status === 401 || status === 403) {
      tInfo(t("auth.login_required") || "Войдите, чтобы использовать избранное", {
        autoClose: 2200,
        toastId: "login-required",
      });
    } else {
      tError(t("toast.favoriteError") || "Не удалось изменить избранное", { autoClose: 2000 });
    }

    setError(t("toast.favoriteError", { defaultValue: "Не удалось изменить избранное" }));
  }
};

  // quick request из «Избранного» (+локальный черновик) — оставил как было
  const handleQuickRequest = async (serviceId, meta = {}) => {
    if (!serviceId) { setError(t("errors.service_unknown", { defaultValue: "Не удалось определить услугу" })); return; }
    const note = window.prompt(t("common.note_optional", { defaultValue: "Комментарий к запросу (необязательно):" })) || undefined;

    try {
      await apiPost("/api/requests", { service_id: serviceId, note });
      setMessage(t("messages.request_sent", { defaultValue: "Запрос отправлен" }));
      tSuccess(t("messages.request_sent") || "Запрос отправлен", { autoClose: 1800 });

      const title = meta.title ||
        favorites.find((f) => {
          const sid =
            f?.service?.id ?? f?.service_id ?? f?.serviceId ??
            f?.id ?? null;
          return String(sid) === String(serviceId);
        })?.service?.title || "Запрос";

      const draft = makeDraft({ serviceId, title });
      const keyId = myId || null;
      saveDrafts(keyId, [draft, ...loadDrafts(keyId)]);
      setRequests((prev) => [draft, ...prev]);
      window.dispatchEvent(new CustomEvent("request:created", { detail: { service_id: serviceId, title } }));

      setActiveTab("requests");

      try {
        const apiList = await fetchClientRequestsSafe(myId);
        const drafts  = [...loadDrafts(myId), ...loadDrafts(null)];
        setRequests(mergeRequests(apiList, drafts));
      } catch {}
     } catch (err) {
   setError(t("errors.request_send", { defaultValue: "Не удалось отправить запрос" }));
   const msg = (err?.response?.data?.error || err?.data?.error || err?.message || "").toString().toLowerCase();
   if (msg.includes("self_request_forbidden")) {
     tInfo(t("errors.self_request_forbidden") || "Вы не можете отправить себе быстрый запрос!", { toastId: "self-req", autoClose: 2200 });
   } else {
     tError(t("errors.request_send") || "Не удалось отправить запрос", { autoClose: 1800 });
   }
 }
  };

  const handleAcceptProposal = async (id) => {
    try {
      setActingReqId(id); setError(null);
      await apiPost(`/api/requests/${id}/accept`, {});
      setMessage(t("client.dashboard.accepted", { defaultValue: "Предложение принято" }));
      const [r, b] = await Promise.allSettled([fetchClientRequestsSafe(myId), fetchClientBookingsSafe()]);
      if (r.status === "fulfilled") setRequests(mergeRequests(r.value, [...loadDrafts(myId), ...loadDrafts(null)]));
      if (b.status === "fulfilled") setBookings(b.value);
      setActiveTab("bookings");
     } catch (e) {
   setError(e?.message || t("errors.action_failed", { defaultValue: "Не удалось выполнить действие" }));
   tError(t("errors.action_failed") || "Не удалось выполнить действие", { autoClose: 2000 });
 }
    finally { setActingReqId(null); }
  };

  const handleRejectProposal = async (id) => {
    try {
      setActingReqId(id); setError(null);
      await apiPost(`/api/requests/${id}/reject`, {});
      setMessage(t("client.dashboard.rejected", { defaultValue: "Предложение отклонено" }));
      tInfo(t("client.dashboard.rejected") || "Предложение отклонено", { autoClose: 1800 });
      const data = await fetchClientRequestsSafe(myId);
      setRequests(mergeRequests(data, [...loadDrafts(myId), ...loadDrafts(null)]));
    } catch (e) { setError(e?.message || t("errors.action_failed", { defaultValue: "Не удалось выполнить действие" })); }
    finally { setActingReqId(null); }
  };

  // Удаление заявки (API или локальный черновик)
  function askDeleteRequest(id) {
    if (!id) return;
    setDelUI({ open: true, id, isDraft: String(id).startsWith("d_"), sending: false });
  }

  async function confirmDeleteRequest() {
    if (!delUI.id) return;
    setDelUI((s) => ({ ...s, sending: true }));
    try {
      if (delUI.isDraft) {
        const keyId = myId || null;
        const updated = loadDrafts(keyId).filter((d) => String(d.id) !== String(delUI.id));
        saveDrafts(keyId, updated);
        setRequests((prev) => prev.filter((x) => String(x.id) !== String(delUI.id)));
      } else {
        await apiDelete(`/api/requests/${delUI.id}`);
        setRequests((prev) => prev.filter((x) => x.id !== delUI.id));
        setMessage(t("client.dashboard.requestDeleted", { defaultValue: "Заявка удалена" }));
      }
    } catch {
      setError(t("client.dashboard.requestDeleteFailed", { defaultValue: "Не удалось удалить заявку" }));
    } finally {
      setDelUI({ open: false, id: null, isDraft: false, sending: false });
    }
  }

  function closeDeleteModal() {
    setDelUI({ open: false, id: null, isDraft: false, sending: false });
  }

  function openQuickRequestModal(serviceId, meta = {}) {
    if (!serviceId) return;
    setQrServiceId(serviceId);
    setQrTitle(meta.title || "");
    setQrOpen(true);
  }
  function closeQuickRequestModal() {
    setQrOpen(false);
    setQrServiceId(null);
    setQrTitle("");
  }
  async function submitQuickRequest(note) {
    if (!qrServiceId) return;
    try {
      await apiPost("/api/requests", { service_id: qrServiceId, note: note || undefined });
      setMessage(t("messages.request_sent", { defaultValue: "Запрос отправлен" }));

      const draft = makeDraft({ serviceId: qrServiceId, title: qrTitle || "Запрос" });
      const keyId = myId || null;
      saveDrafts(keyId, [draft, ...loadDrafts(keyId)]);
      setRequests((prev) => [draft, ...prev]);
      window.dispatchEvent(new CustomEvent("request:created", { detail: { service_id: qrServiceId, title: qrTitle } }));

      setActiveTab("requests");

      try {
        const apiList = await fetchClientRequestsSafe(myId);
        const drafts  = [...loadDrafts(myId), ...loadDrafts(null)];
        setRequests(mergeRequests(apiList, drafts));
      } catch {}
    } catch {
      setError(t("errors.request_send", { defaultValue: "Не удалось отправить запрос" }));
    } finally {
      closeQuickRequestModal();
    }
  }

  function openBooking(serviceId) { setBookingUI({ open: true, serviceId }); setBkDate(""); setBkTime(""); setBkPax(1); setBkNote(""); }
  function closeBooking() { setBookingUI({ open: false, serviceId: null }); }
  async function createBooking() {
    if (!bookingUI.serviceId) return;
    setBkSending(true);
    try {
      const details = { date: bkDate || undefined, time: bkTime || undefined, pax: Number(bkPax) || 1, note: bkNote || undefined };
      await apiPost("/api/bookings", { service_id: bookingUI.serviceId, details });
      closeBooking(); setMessage(t("messages.booking_created", { defaultValue: "Бронирование отправлено" })); setActiveTab("bookings");
      try { setBookings(await fetchClientBookingsSafe()); } catch {}
    } catch (e) { setError(e?.message || t("errors.booking_create", { defaultValue: "Не удалось создать бронирование" })); }
    finally { setBkSending(false); }
  }

  /* -------- Render helpers -------- */

  const Avatar = () => {
    const src = avatarBase64 || avatarServerUrl || null;
    if (src) return <img src={src} alt="" className="w-24 h-24 rounded-full object-cover border" />;
    return <div className="w-24 h-24 rounded-full bg-gray-200 border flex items-center justify-center text-xl font-semibold text-gray-600">{initials(name)}</div>;
  };

  const TabButton = ({ tabKey, children }) => {
    const active = activeTab === tabKey;
    return (
      <button onClick={() => setActiveTab(tabKey)} className={`px-4 py-2 rounded-lg border-b-2 font-medium ${active ? "border-gray-900 text-gray-900" : "border-transparent text-gray-500"}`}>
        {children}
      </button>
    );
  };

  const RequestsList = () => {
    const { t } = useTranslation();
    const statusLabel = (code) =>
      t(`status.${String(code ?? "").toLowerCase()}`, { defaultValue: code });
    if (loadingTab) return <div className="text-gray-500">{t("common.loading", { defaultValue: "Загрузка..." })}</div>;
    if (!requests?.length) return <div className="text-gray-500">{t("empty.no_requests", { defaultValue: "Пока нет запросов." })}</div>;
    return (
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {requests.map((r) => {
  const serviceTitle = r?.service?.title || r?.service_title || r?.title || t("common.request", { defaultValue: "Запрос" });
  const status = r?.status || "new";
  const created = r?.created_at ? new Date(r.created_at).toLocaleString() : "";
  const expireAt = resolveRequestExpireAt(r);
  const leftMs = expireAt ? Math.max(0, expireAt - now) : null;
  const hasTimer = !!expireAt;
  const timerText = hasTimer ? formatLeft(leftMs) : null;

  return (
    <div key={r.id} className={`bg-white border rounded-xl p-4 ${r.is_draft ? "ring-1 ring-orange-200" : ""}`}>
      <div className="font-semibold">{serviceTitle}</div>

      <div className="text-sm text-gray-500 mt-1">
        {t("common.status", { defaultValue: "Статус" })}: {statusLabel(status)}
      </div>

      {hasTimer && (
        <div className="mt-2">
          <span
            className={`inline-block px-2 py-0.5 rounded-full text-white text-xs ${leftMs > 0 ? "bg-orange-600" : "bg-gray-400"}`}
            title={leftMs > 0 ? t("countdown.until_end", { defaultValue: "До окончания" }) : t("countdown.expired", { defaultValue: "Время истекло" })}
          >
            {timerText}
          </span>
        </div>
      )}

      {created && <div className="text-xs text-gray-400 mt-1">{t("common.created", { defaultValue: "Создан" })}: {created}</div>}
      {r?.note && <div className="text-sm text-gray-600 mt-2">{t("common.comment", { defaultValue: "Комментарий" })}: {r.note}</div>}

      {/* действия */}
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => openQuickEdit(r)}          // ← новая модалка (ниже)
          className="px-3 py-1.5 rounded border hover:bg-gray-50"
        >
          {t("actions.edit", { defaultValue: "Править" })}
        </button>
        <button
            onClick={() => askDeleteRequest(r.id)}
            className="px-3 py-1.5 rounded border hover:bg-gray-50 text-red-600"
          >
            {t("client.dashboard.deleteRequest", { defaultValue: "Удалить" })}
          </button>
      </div>
    </div>
  );
})}

      </div>
    );
  };

  const BookingsList = () => {
    const { t } = useTranslation();
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
        perPage={FAV_PAGE_SIZE}
        favIds={favIds}
        onToggleFavorite={toggleFavoriteClient}
        onQuickRequest={(id, meta) => openQuickRequestModal(id, meta)}
        onPageChange={(p) => setFavPage(p)}
        now={now}
      />
    );
  };

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
                  {avatarBase64 || avatarServerUrl ? t("client.dashboard.changePhoto", { defaultValue: "Сменить фото" }) : t("client.dashboard.uploadPhoto", { defaultValue: "Загрузить фото" })}
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
                <input className="mt-1 w-full border rounded-lg px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("client.dashboard.name", { defaultValue: "Ваше имя" })} />
              </div>
              <div>
                <label className="text-sm text-gray-600">{t("client.dashboard.phone", { defaultValue: "Телефон" })}</label>
                <input className="mt-1 w-full border rounded-lg px-3 py-2" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998 ..." />
              </div>
              <div>
                <label className="text-sm text-gray-600">{t("telegram", { defaultValue: "Telegram" })}</label>
                <input className="mt-1 w-full border rounded-lg px-3 py-2" value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="@username" />
              </div>

              <div className="pt-2">
                <button onClick={handleSaveProfile} disabled={savingProfile || loadingProfile} className="w-full bg-orange-500 text-white rounded-lg px-4 py-2 font-semibold disabled:opacity-60">
                  {savingProfile ? t("common.saving", { defaultValue: "Сохранение..." }) : t("client.dashboard.saveBtn", { defaultValue: "Сохранить" })}
                </button>
              </div>
            </div>

            <div className="mt-8 border-t pt-6">
              <div className="text-sm text-gray-600 mb-2">{t("client.dashboard.changePassword", { defaultValue: "Смена пароля" })}</div>
              <div className="flex gap-2">
                <input type="password" className="flex-1 border rounded-lg px-3 py-2" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={t("client.dashboard.newPassword", { defaultValue: "Новый пароль" })} />
                <button onClick={handleChangePassword} disabled={changingPass} className="px-4 py-2 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-60">{changingPass ? "..." : t("client.dashboard.changeBtn", { defaultValue: "Сменить" })}</button>
              </div>
            </div>

            <div className="mt-8">
              <button onClick={handleLogout} className="w-full px-4 py-2 rounded-lg border text-red-600 hover:bg-red-50">{t("client.dashboard.logout", { defaultValue: "Выйти" })}</button>
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
                        const apiList = await fetchClientRequestsSafe(myId);
                        const drafts  = [...loadDrafts(myId), ...loadDrafts(null)];
                        setRequests(mergeRequests(apiList, drafts));
                      } else if (activeTab === "bookings") {
                        setBookings(await fetchClientBookingsSafe());
                      } else {
                        const data = await apiGet("/api/wishlist?expand=service");
                        const arr = Array.isArray(data) ? data : data?.items || [];
                        setFavorites(arr);
                        try {
                          const ids = await apiGet("/api/wishlist/ids");
                          const list = Array.isArray(ids) ? ids : [];
                          setFavIds(new Set(list.map(String)));
                        } catch {}
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
            {activeTab === "favorites" && (
              <FavoritesList
                items={favorites}
                page={favPage}
                perPage={FAV_PAGE_SIZE}
                favIds={favIds}
                onToggleFavorite={toggleFavoriteClient}
                onQuickRequest={(id, meta) => openQuickRequestModal(id, meta)}
                onPageChange={(p) => setFavPage(p)}
                now={now}
              />
            )}
          </div>
        </div>
      </div>

      {/* Booking modal */}
      {bookingUI.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md bg-white rounded-xl shadow p-5">
            <div className="text-lg font-semibold mb-3">{t("booking.title", { defaultValue: "Быстрое бронирование" })}</div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-gray-600">{t("booking.date", { defaultValue: "Дата" })}</label>
                  <input type="date" className="mt-1 w-full border rounded-lg px-3 py-2" value={bkDate} onChange={(e) => setBkDate(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm text-gray-600">{t("booking.time", { defaultValue: "Время" })}</label>
                  <input type="time" className="mt-1 w-full border rounded-lg px-3 py-2" value={bkTime} onChange={(e) => setBkTime(e.target.value)} />
                </div>
              </div>

              <div>
                <label className="text-sm text-gray-600">{t("booking.pax", { defaultValue: "Кол-во людей" })}</label>
                <input type="number" min="1" className="mt-1 w-full border rounded-lg px-3 py-2" value={bkPax} onChange={(e) => setBkPax(e.target.value)} />
              </div>

              <div>
                <label className="text-sm text-gray-600">{t("common.note_optional", { defaultValue: "Комментарий (необязательно)" })}</label>
                <textarea rows={3} className="mt-1 w-full border rounded-lg px-3 py-2" value={bkNote} onChange={(e) => setBkNote(e.target.value)} />
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button onClick={createBooking} disabled={bkSending} className="flex-1 bg-orange-500 text-white rounded-lg px-4 py-2 font-semibold disabled:opacity-60">
                {bkSending ? t("common.sending", { defaultValue: "Отправка..." }) : t("booking.submit", { defaultValue: "Забронировать" })}
              </button>
              <button onClick={closeBooking} className="px-4 py-2 rounded-lg border">{t("actions.cancel", { defaultValue: "Отмена" })}</button>
            </div>
          </div>
        </div>
      )}
      <QuickRequestModal
        open={qrOpen}
        onClose={closeQuickRequestModal}
        onSubmit={submitQuickRequest}
      />
      <ConfirmModal
        open={delUI.open}
        danger
        busy={delUI.sending}
        title={t("actions.delete", { defaultValue: "Удалить" })}
        message={t("client.dashboard.confirmDeleteRequest", { defaultValue: "Удалить эту заявку?" })}
        confirmLabel={t("actions.delete", { defaultValue: "Удалить" })}
        cancelLabel={t("actions.cancel", { defaultValue: "Отмена" })}
        onConfirm={confirmDeleteRequest}
        onClose={closeDeleteModal}
      />
    </div>
  );
}

/* ---------- срок действия / обратный счёт ---------- */
function resolveExpireAt(service) {
  const s = service || {};
  const d = s.details || {};
  const cand = [
    s.expires_at, s.expire_at, s.expireAt,
    d.expires_at, d.expire_at, d.expiresAt,
    d.expiration, d.expiration_at, d.expirationAt,
    d.expiration_ts, d.expirationTs,
  ].find((v) => v !== undefined && v !== null && String(v).trim?.() !== "");

  if (!cand) {
    const ttl = d.ttl_hours || d.ttlHours || s.ttl_hours || s.ttlHours;
    if (ttl) {
      let ts = null;
      if (d.created_at || s.created_at) {
        const created = Date.parse(d.created_at || s.created_at);
        if (!Number.isNaN(created)) ts = created + Number(ttl) * 3600 * 1000;
      }
      return ts;
    }
    return null;
  }

  let ts = null;
  if (typeof cand === "number") {
    // если меньше 1e12 — это секунды, домножаем до мс
    ts = cand > 1e12 ? cand : cand * 1000;
  } else {
    const n = Number(cand);
    if (Number.isFinite(n)) {
      ts = n > 1e12 ? n : n * 1000;
    } else {
      const parsed = Date.parse(String(cand));
      ts = Number.isNaN(parsed) ? null : parsed;
    }
  }
  return (typeof ts === "number" && Number.isFinite(ts)) ? ts : null;
}

function resolveRequestExpireAt(r) {
  if (!r) return null;
  // Явная дата
  if (r.expires_at) {
    const ts = Number(r.expires_at) || Date.parse(r.expires_at);
    if (Number.isFinite(ts)) return ts;
  }
  // TTL в часах + created_at
  const details = typeof r.details === "string" ? (() => { try { return JSON.parse(r.details); } catch { return {}; } })() : (r.details || {});
  const ttl = r.ttl_hours || r.ttlHours || details.ttl_hours || details.ttlHours;
  if (ttl && r.created_at) {
    const created = Date.parse(r.created_at);
    if (!Number.isNaN(created)) return created + Number(ttl) * 3600 * 1000;
  }
  return null;
}

function formatLeft(ms) {
  if (ms <= 0) return "00:00:00";
  const total = Math.floor(ms / 1000);
  const dd = Math.floor(total / 86400);
  const hh = Math.floor((total % 86400) / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (dd > 0) return `${dd}д ${pad(hh)}:${pad(mm)}`;
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}
