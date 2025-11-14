// frontend/src/pages/ClientDashboard.jsx

import { useEffect, useRef, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams, Link } from "react-router-dom";
import { apiGet, apiPut, apiPost, apiDelete } from "../api";
import QuickRequestModal from "../components/QuickRequestModal";
import ConfirmModal from "../components/ConfirmModal";
import ServiceCard from "../components/ServiceCard";
import { tSuccess, tError, tInfo } from "../shared/toast";
import ClientBookings from "./ClientBookings";

const FAV_PAGE_SIZE = 6;

/* ===================== Helpers ===================== */

// --- helpers для типа поставщика ---
const maybeParse = (x) => {
  if (!x) return null;
  if (typeof x === "object") return x;
  if (typeof x === "string") {
    const s = x.trim();
    if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
      try { return JSON.parse(s); } catch {}
    }
  }
  return null;
};

const providerTypeKey = (raw) => {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  const byCode = { "1": "agent", "2": "guide", "3": "transport", "4": "hotel" };
  if (byCode[s]) return byCode[s];
  const direct = {
    agent:"agent","travel_agent":"agent","travelagent":"agent","тур агент":"agent","турагент":"agent","tour_agent":"agent",
    guide:"guide","tour_guide":"guide","tourguide":"guide","гид":"guide","экскурсовод":"guide",
    transport:"transport","transfer":"transport","car":"transport","driver":"transport","taxi":"transport","авто":"transport","транспорт":"transport","трансфер":"transport",
    hotel:"hotel","guesthouse":"hotel","accommodation":"hotel","otel":"hotel","отель":"hotel",
  };
  if (direct[s]) return direct[s];
  if (/guide|гид|экскур/.test(s)) return "guide";
  if (/hotel|guest|accom|otel|отел/.test(s)) return "hotel";
  if (/trans|taxi|driver|car|bus|авто|трансфер|транспорт/.test(s)) return "transport";
  if (/agent|agency|travel|тур|агент/.test(s)) return "agent";
  return null;
};

const providerTypeLabel = (raw, t) => {
  const key = providerTypeKey(raw);
  if (!key) return raw || "";
  const fallback = { agent: "Турагент", guide: "Гид", transport: "Транспорт", hotel: "Отель" }[key];
  return t(`provider.types.${key}`, { defaultValue: fallback });
};

// аккуратно пробуем несколько эндпоинтов, чтобы вытащить провайдера
async function fetchProviderProfileForType(axios, API_BASE, id) {
  const urls = [
    `${API_BASE}/api/providers/${id}`,
    `${API_BASE}/api/provider/${id}`,
    `${API_BASE}/api/companies/${id}`,
    `${API_BASE}/api/company/${id}`,
  ];
  for (const u of urls) {
    try {
      const { data } = await axios.get(u);
      if (data) return data;
    } catch {}
  }
  return null;
}

function initials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || "";
  const second = parts[1]?.[0] || "";
  return (first + second).toUpperCase() || "U";
}

function normalizeTelegram(v) {
  if (!v) return null;
  let s = String(v).trim();
  if (!s) return null;

  s = s.replace(/\s+/g, "");

  const mResolve = s.match(/tg:\/\/resolve\?domain=([\w\d_]+)/i);
  if (mResolve) {
    const u = mResolve[1];
    return { href: `https://t.me/${u}`, label: `@${u}` };
  }

  const mInvite = s.match(
    /(?:https?:\/\/)?(?:t\.me|telegram\.me|telegram\.dog)\/(joinchat\/[A-Za-z0-9_-]+|\+[A-Za-z0-9_-]+)/i
  );
  if (mInvite) {
    const p = mInvite[1];
    return { href: `https://t.me/${p}`, label: `t.me/${p}` };
  }

  const mUrl = s.match(
    /(?:https?:\/\/)?(?:t\.me|telegram\.me|telegram\.dog)\/(@?[\w\d_]+)/i
  );
  if (mUrl) {
    const u = mUrl[1].replace(/^@/, "");
    return { href: `https://t.me/${u}`, label: `@${u}` };
  }

  const mUser = s.match(/^@?([\w\d_]{3,})$/);
  if (mUser) {
    const u = mUser[1];
    return { href: `https://t.me/${u}`, label: `@${u}` };
  }

  return { href: `https://t.me/${s.replace(/^@/, "")}`, label: s };
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

  const flatType = _firstNonEmpty(pick(bag, ["provider_type","type","category"]));
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
          <div className="grid sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
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
// --- MyInsideCard: карточка статуса India Inside (клиент не завершает сам)
function MyInsideCard({ inside, loading, t, onJoined, now }) {
  const [lastReq, setLastReq] = useState(null);   // ⬅️ последняя заявка на завершение главы
  const [loadingReq, setLoadingReq] = useState(true);

  // ⬇️ НОВОЕ: ближайшая глава (для всех клиентов, у кого есть кабинет)
  const [nextChapter, setNextChapter] = useState(null);
  const [loadingNext, setLoadingNext] = useState(true);

  // заголовки глав по ключам (оставляю как у тебя)
  const chapterTitle = (key) => {
    const map = {
      royal:   t("landing.inside.chapters.royal.title", "Золотой Треугольник"),
      silence: t("landing.inside.chapters.silence.title", "Приключения в Раджастане"),
      modern:  t("landing.inside.chapters.modern.title", "Мумбаи + Гоа — лучшие воспоминания"),
      kerala:  t("landing.inside.chapters.kerala.title", "Керала: Рай на Земле"),
    };
    return map[key] || key || "Глава";
  };

  // метка статуса заявки
  const statusPill = (st) => {
    const map = {
      pending:  t("inside.status_pending",  { defaultValue: "Ожидает подтверждения" }),
      approved: t("inside.status_approved", { defaultValue: "Подтверждено" }),
      rejected: t("inside.status_rejected", { defaultValue: "Отклонено" }),
    };
    const cls =
      st === "pending"
        ? "bg-amber-50 text-amber-800 border-amber-200"
        : st === "approved"
        ? "bg-emerald-50 text-emerald-800 border-emerald-200"
        : st === "rejected"
        ? "bg-rose-50 text-rose-800 border-rose-200"
        : "bg-slate-50 text-slate-700 border-slate-200";

    return <span className={`text-xs px-2 py-1 rounded-full border ${cls}`}>{map[st] ?? st}</span>;
  };

  // ⬇️ НОВОЕ: мини-компонент баннера ближайшей главы с обратным отсчётом и местами
  const NextChapterBanner = () => {
    if (!nextChapter) return null;

    const startsAt = nextChapter.starts_at ? new Date(nextChapter.starts_at) : null;
    const nowMs = typeof now === "number" ? now : Date.now();
    const diffMs = startsAt ? startsAt.getTime() - nowMs : null;
    const placesLeft = Number(nextChapter.places_left ?? 0);

    return (
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">
              {t("inside.next_chapter.label", { defaultValue: "Ближайшая глава" })}
            </div>
            <div className="font-medium">
              {nextChapter.title || chapterTitle(nextChapter.chapter_key)}
            </div>
            {startsAt && (
              <div className="text-xs text-slate-500">
                {t("inside.next_chapter.starts_at", { defaultValue: "Старт:" })}{" "}
                {startsAt.toLocaleString()}
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-1">
            {diffMs != null && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-mono ${
                  diffMs > 0 ? "bg-black text-white" : "bg-emerald-600 text-white"
                }`}
              >
                {diffMs > 0
                  ? t("inside.next_chapter.countdown", { defaultValue: "До начала" })
                  : t("inside.next_chapter.enrollment_open", {
                      defaultValue: "Набор идёт",
                    })}
                {diffMs > 0 && <span>{formatLeft(diffMs)}</span>}
              </span>
            )}
            <span className="text-xs text-slate-700">
              {t("inside.next_chapter.places_left", {
                defaultValue: "Свободных мест: {{count}}",
                count: placesLeft,
              })}
            </span>
          </div>
        </div>
      </div>
    );
  };

  // загрузка последней заявки (когда inside есть)
  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!inside) { setLastReq(null); setLoadingReq(false); return; }
      try {
        setLoadingReq(true);
        const r = await apiGet("/api/inside/my-request");
        if (!cancel) setLastReq(r || null);
      } catch {
        if (!cancel) setLastReq(null);
      } finally {
        if (!cancel) setLoadingReq(false);
      }
    })();
    return () => { cancel = true; };
  }, [inside]);

  // ⬇️ НОВОЕ: загрузка ближайшей главы (общая для всех клиентов)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingNext(true);
        const res = await apiGet("/api/inside/chapters/next");
        if (!cancelled) {
          setNextChapter(res || null);
        }
      } catch {
        if (!cancelled) setNextChapter(null);
      } finally {
        if (!cancelled) setLoadingNext(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow p-6 border animate-pulse">
        <div className="h-5 w-48 bg-gray-200 rounded" />
        <div className="mt-4 h-4 w-80 bg-gray-200 rounded" />
        <div className="mt-6 h-3 w-full bg-gray-200 rounded" />
      </div>
    );
  }

  // если пользователь ещё не участник — показываем приглашение
  if (!inside) {
    async function handleJoin() {
      try {
        const res = await apiPost("/api/inside/join");
        if (res && (res.ok || res.status === "ok" || res.joined)) {
          const me = await apiGet("/api/inside/me");
          onJoined?.(me?.data ?? me ?? null);
          tSuccess(t("inside.toast.joined") || "Вы присоединились к India Inside!", { autoClose: 1600 });
          return;
        }
        const me = await apiGet("/api/inside/me");
        if (me && (me.status && me.status !== "none")) {
          onJoined?.(me);
          tSuccess(t("inside.toast.joined") || "Вы присоединились к India Inside!", { autoClose: 1600 });
          return;
        }
        tError(t("inside.toast.join_failed") || "Не удалось присоединиться");
      } catch (e) {
        window.open("/landing/india-inside", "_blank", "noreferrer");
      }
    }

    return (
      <div className="bg-white rounded-xl shadow p-6 border">
        <div className="text-xl font-semibold">
          {t("inside.invite.title", { defaultValue: "Присоединиться к India Inside" })}
        </div>
        <p className="mt-2 text-gray-600">
          {t("inside.invite.sub", { defaultValue: "Личный куратор, главы и статус Guru после 4 глав." })}
        </p>

        {/* 🔔 Баннер ближайшей главы виден даже до вступления */}
        {!loadingNext && <NextChapterBanner />}

        <div className="mt-4 flex gap-2">
          <button
            onClick={handleJoin}
            className="inline-flex items-center rounded-lg bg-orange-500 px-4 py-2 text-white font-semibold"
          >
            {t("inside.invite.join_now", { defaultValue: "Присоединиться" })}
          </button>
          <a
            href="/landing/india-inside"
            className="inline-flex items-center rounded-lg border px-4 py-2 font-medium hover:bg-gray-50"
            target="_blank"
            rel="noreferrer"
          >
            {t("inside.invite.cta", { defaultValue: "Узнать больше" })}
          </a>
        </div>
      </div>
    );
  }

  const cur = Number(inside.progress_current ?? 0);
  const total = Number(inside.progress_total ?? 4);
  const pct = Math.max(0, Math.min(100, Math.round((cur / (total || 1)) * 100)));
  const curator = inside.curator_telegram || "@akhmedovkb";
  const chapterKey = inside.current_chapter || "royal";
  const chapterMeta = inside?.chapter || {};
  const capacity = Number(chapterMeta.capacity || 0);
  const enrolled = Number(chapterMeta.enrolled_count || 0);
  const remaining = Math.max(0, capacity - enrolled);

  const startsAtRaw =
    chapterMeta.starts_at ||
    inside.chapter_starts_at ||
    null;

  let countdown = null;
  if (startsAtRaw) {
    const ts = Date.parse(startsAtRaw);
    if (!Number.isNaN(ts)) {
      const diff = ts - (now ?? Date.now());
      if (diff > 0) {
        countdown = formatLeft(diff);
      }
    }
  }

  async function requestCompletion() {
    try {
      const res = await apiPost("/api/inside/request-completion", { chapter: chapterKey });

      if (res?.already) {
        // уже есть «pending» — фиксируем локально
        setLastReq((prev) =>
          prev?.status === "pending"
            ? prev
            : {
                id: prev?.id || undefined,
                chapter: chapterKey,
                status: "pending",
                requested_at: new Date().toISOString(),
              }
        );
        tInfo(
          t("inside.toast.already_pending") || "Заявка уже отправлена и ожидает подтверждения",
          { autoClose: 2200 }
        );
        return;
      }

      if (res?.item) {
        setLastReq(res.item);
      }
      tSuccess(t("inside.toast.requested") || "Запрос на завершение отправлен", { autoClose: 1600 });
    } catch (e) {
      const msg = (e?.response?.data?.error || e?.message || "").toString().toLowerCase();
      if (e?.response?.status === 401 || e?.response?.status === 403 || msg.includes("unauthorized")) {
        tError(t("auth.login_required") || "Войдите заново и повторите попытку", { autoClose: 2200 });
      } else {
        tError(t("inside.errors.request_failed") || "Не удалось отправить запрос на завершение", { autoClose: 2200 });
      }
      const wantTg = window.confirm(
        t("inside.errors.ask_open_telegram", { defaultValue: "Открыть чат куратора в Telegram?" })
      );
      if (wantTg) window.open(`https://t.me/${curator.replace(/^@/, "")}`, "_blank", "noreferrer");
    }
  }

  return (
    <section className="bg-white rounded-xl shadow p-6 border">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm text-gray-500">India Inside</div>
          <h2 className="text-xl font-semibold">
            {t("inside.my.title", { defaultValue: "Моя программа" })}
          </h2>
        </div>
        <span className="text-xs px-2 py-1 rounded-full border bg-slate-50 text-slate-700">
          {t("inside.status", { defaultValue: "Активна" })}
        </span>
      </div>

      {/* 🔔 Баннер ближайшей главы под шапкой */}
      {!loadingNext && <NextChapterBanner />}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="text-gray-700">
          <div className="text-sm text-gray-500">{t("inside.current_chapter", { defaultValue: "Текущая глава" })}</div>
          <div className="font-medium">{chapterTitle(chapterKey)}</div>
        </div>
        <div className="text-gray-700">
          <div className="text-sm text-gray-500">{t("inside.progress", { defaultValue: "Прогресс" })}</div>
          <div className="font-medium">{cur} / {total}</div>
        </div>
      </div>

      <div className="mt-3">
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div className="h-2 bg-orange-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 text-xs text-gray-500">{pct}%</div>
      </div>
      {/* Новый блок: дата старта + обратный отсчёт + места */}
      {(startsAtRaw || capacity > 0) && (
        <div className="mt-3 space-y-1 text-sm text-gray-700">
          {startsAtRaw && (
            <div>
              {t("inside.chapter_start_at", { defaultValue: "Старт набора:" })}{" "}
              <span className="font-medium">
                {new Date(startsAtRaw).toLocaleString()}
              </span>
            </div>
          )}
          {countdown && (
            <div>
              {t("inside.chapter_countdown", { defaultValue: "До старта главы осталось:" })}{" "}
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-black text-white text-xs">
                {countdown}
              </span>
            </div>
          )}
          {capacity > 0 && (
            <div>
              {t("inside.chapter_seats_left", { defaultValue: "Свободных мест:" })}{" "}
              <span className="font-medium">
                {remaining} / {capacity}
              </span>
            </div>
          )}
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={`/india/inside?chapter=${encodeURIComponent(chapterKey)}#chapters`}
          className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50"
          target="_blank" rel="noreferrer"
        >
          {t("inside.actions.view_program", { defaultValue: "Смотреть программу" })}
        </a>
        <a
          href={`https://t.me/${curator.replace(/^@/, "")}`}
          target="_blank" rel="noreferrer"
          className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50"
        >
          {t("inside.actions.contact_curator", { defaultValue: "Связаться с куратором" })}
        </a>
        <button
          onClick={requestCompletion}
          disabled={lastReq?.status === "pending"}
          className={`rounded-lg px-4 py-2 text-sm text-white ${
            lastReq?.status === "pending" ? "bg-gray-400 cursor-not-allowed" : "bg-black"
          }`}
        >
          {lastReq?.status === "pending"
            ? (t("inside.actions.request_sent", { defaultValue: "Запрос отправлен" }))
            : (t("inside.actions.request_completion", { defaultValue: "Запросить завершение" }))}
        </button>
      </div>

      <div className="mt-2 text-xs text-gray-500">
        {t("inside.note.by_curator", { defaultValue: "Завершение главы подтверждает куратор." })}
      </div>

      {/* Статус последней заявки */}
      {lastReq && (
        <div className="mt-2 text-sm flex items-center gap-2">
          {statusPill(lastReq.status)}
          <span className="text-gray-500">
            {lastReq.status === "pending"  && t("inside.msg.waiting_curator", { defaultValue: "Заявка ожидает подтверждения куратором" })}
            {lastReq.status === "approved" && t("inside.msg.approved", { defaultValue: "Глава засчитана" })}
            {lastReq.status === "rejected" && t("inside.msg.rejected", { defaultValue: "Заявка отклонена" })}
          </span>
        </div>
      )}
    </section>
  );
}


/* ===================== Main Page ===================== */

export default function ClientDashboard() {
  const { t } = useTranslation();
  const [me, setMe] = useState(null);
  const fileRef = useRef(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // минутный таймер — для «ровного» отсчёта без мерцаний
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
  const [favorites, setFavorites] = useState([]);
  const [loadingTab, setLoadingTab] = useState(false);

  // UI messages
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const favPageFromUrl = Number(searchParams.get("page") || 1);
  const [favPage, setFavPage] = useState(isNaN(favPageFromUrl) ? 1 : favPageFromUrl);

  const [actingReqId, setActingReqId] = useState(null);

  // мой id из профиля (для фильтрации/ключа черновиков)
  const [myId, setMyId] = useState(null);

  // удаление моих запросов
  const [delUI, setDelUI] = useState({ open: false, id: null, isDraft: false, sending: false });

  // избранные id для сердечка
  const [favIds, setFavIds] = useState(new Set());

  // подписка на типы поставщиков (для бейджей)
  const [authorProvTypes, setAuthorProvTypes] = useState({});

  // рефреш для вкладки «Мои бронирования»
  const [bookingsRefreshKey, setBookingsRefreshKey] = useState(0);
  
  // India Inside
  const [inside, setInside] = useState(null);
  const [loadingInside, setLoadingInside] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", activeTab);
    if (activeTab === "favorites") params.set("page", String(favPage));
    else params.delete("page");
    setSearchParams(params, { replace: true });
  }, [activeTab, favPage]); // eslint-disable-line

  // synch state with URL params
  useEffect(() => {
    const tabParam = searchParams.get("tab");
    const pageParamRaw = searchParams.get("page");
    const pageParam = Number(pageParamRaw || 1);

    if (tabParam && tabParam !== activeTab && tabs.some((t) => t.key === tabParam)) {
      setActiveTab(tabParam);
    }
    if (tabParam === "favorites") {
      const np = isNaN(pageParam) ? 1 : pageParam;
      if (np !== favPage) setFavPage(np);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

    useEffect(() => {
    (async () => {
      try {
        setLoadingProfile(true);
        const profile = await apiGet("/api/clients/me");
        setMe(profile); // <-- сохраняем в стейт
        setName(profile?.name || "");
        setPhone(profile?.phone || "");
        setTelegram(profile?.telegram || "");
        setAvatarBase64(profile?.avatar_base64 ? toDataUrl(profile.avatar_base64) : null);
        setAvatarServerUrl(profile?.avatar_url || null);
        setRemoveAvatar(false);
        setMyId(profile?.id || profile?._id || profile?.user_id || profile?.client_id || null);
      } catch {
        setError(t("errors.profile_load", { defaultValue: "Не удалось загрузить профиль" }));
      } finally {
        setLoadingProfile(false);
      }
    })();
  }, [t]);

  // 1) Имя бота — пробуем несколько источников
const botUser =
  import.meta.env.VITE_TG_BOT_USERNAME ||
  import.meta.env.VITE_TELEGRAM_BOT_USERNAME ||
  import.meta.env.VITE_TELEGRAM_BOT ||
  (window.__APP_CONFIG__ && window.__APP_CONFIG__.telegram_bot_username) ||
  localStorage.getItem("telegramBotUsername") ||
  "";

// 2) Клиентский id для payload
const clientId =
  me?.id || me?._id || me?.client_id || me?.user_id;

// 3) Привязка к боту — учитываем больше названий полей
const rawDetails =
  typeof me?.details === "string"
    ? (() => { try { return JSON.parse(me.details); } catch { return {}; } })()
    : (me?.details || {});

const chatId =
  me?.telegram_chat_id ??
  me?.tg_chat_id ??
  me?.telegramChatId ??
  me?.tgChatId ??
  me?.chat_id ??
  me?.chatId ??
  rawDetails?.telegram_chat_id ??
  rawDetails?.tg_chat_id ??
  rawDetails?.chat_id ??
  null;

const isTgLinked = Boolean(chatId);

// 4) Deep-link строим, если знаем имя бота и clientId
const tgDeepLink = useMemo(() => {
  if (!botUser || !clientId) return null;
  return `https://t.me/${botUser}?start=c_${clientId}`;
}, [botUser, clientId]);


  // миграция «anon» черновиков
  useEffect(() => {
    if (!myId) return;
    const anon = loadDrafts(null);
    if (anon.length) {
      const mine = loadDrafts(myId);
      saveDrafts(myId, mergeRequests(mine, anon));
      saveDrafts(null, []);
      setRequests(prev => mergeRequests(prev, anon));
    }
  }, [myId]);

  // статистика
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

// ✅ useEffect загрузки статуса участия в India Inside
useEffect(() => {
  let cancelled = false;
  (async () => {
    if (!me) return;
    setLoadingInside(true);
    const tryGet = async (url) => {
      try {
        const r = await apiGet(url);
        return r?.data ?? r?.item ?? r ?? null;
      } catch { return null; }
    };

    // разные бэкенд-варианты
    const userId = me?.id || me?._id || me?.client_id || me?.user_id;
    const attempt =
      (await tryGet("/api/inside/me")) ||
      (userId && (await tryGet(`/api/inside/${userId}`))) ||
      (await tryGet("/api/inside/status"));

    if (!cancelled) {
      setInside(attempt && attempt.status !== "none" ? attempt : null);
      setLoadingInside(false);
    }
  })();
  return () => { cancelled = true; };
}, [me]);

  // загрузка данных табов (+черновики), без «bookings»
  useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const isExternalTab = activeTab === "requests" || activeTab === "favorites";
      if (isExternalTab) setLoadingTab(true);

      if (activeTab === "requests") {
        const apiList = await fetchClientRequestsSafe(myId);
        const drafts  = [...loadDrafts(myId), ...loadDrafts(null)];
        if (!cancelled) setRequests(mergeRequests(apiList, drafts));
      } else if (activeTab === "favorites") {
        const data = await apiGet("/api/wishlist?expand=service");
        const arr = Array.isArray(data) ? data : data?.items || [];
        if (!cancelled) setFavorites(arr);
      }
      // bookings управляет <ClientBookings />
    } catch {
      if (activeTab === "favorites") setFavorites([]);
      else setError(t("errors.tab_load", { defaultValue: "Ошибка загрузки данных" }));
    } finally {
      const isExternalTab = activeTab === "requests" || activeTab === "favorites";
      if (!cancelled && isExternalTab) setLoadingTab(false);
    }
  })();
  return () => { cancelled = true; };
}, [activeTab, t, myId]);


  // подгрузка типов провайдеров для заявок
  useEffect(() => {
    // уникальные providerId из заявок
    const ids = Array.from(
      new Set(
        (requests || [])
          .map((r) =>
            r?.provider?.id ??
            r?.service?.provider_id ?? r?.service?.providerId ??
            r?.provider_id ?? r?.providerId ?? null
          )
          .filter(Boolean)
          .map(Number)
      )
    );

    const need = ids.filter((id) => !authorProvTypes[id]);
    if (!need.length) return;

    let cancelled = false;
    (async () => {
      const map = {};
      for (const pid of need) {
        try {
          const p = await fetchProviderProfile(pid);
          const d =
            typeof p?.details === "string"
              ? (() => {
                  try { return JSON.parse(p.details); } catch { return {}; }
                })()
              : (p?.details || {});
          const rawType =
            p?.type ?? p?.provider_type ?? p?.category ??
            d?.type ?? d?.provider_type ?? d?.category;

          map[pid] =
            providerTypeLabel(rawType, t) ||
            t("roles.provider", { defaultValue: "Поставщик" });
        } catch {
          // ignore
        }
      }
      if (!cancelled && Object.keys(map).length) {
        setAuthorProvTypes((prev) => ({ ...prev, ...map }));
      }
    })();

    return () => { cancelled = true; };
  }, [requests, t, authorProvTypes]);

  // ids избранного для сердечек
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

  // синхронизация заявок между вкладками/окнами
  useEffect(() => {
    let mounted = true;

    const onCreated = async () => {
      try {
        const apiList = await fetchClientRequestsSafe(myId);
        const drafts  = [...loadDrafts(myId), ...loadDrafts(null)];
        if (mounted) setRequests(mergeRequests(apiList, drafts));
      } catch {}
    };

    const onStorage = (ev) => {
      if (!ev.key) return;
      if (ev.key === draftsKey(myId) || ev.key === draftsKey(null)) {
        const drafts = [...loadDrafts(myId), ...loadDrafts(null)];
        if (mounted) setRequests(prev => mergeRequests(prev.filter(x => !x.is_draft), drafts));
      }
    };

    window.addEventListener("request:created", onCreated);
    window.addEventListener("storage", onStorage);
    return () => {
      mounted = false;
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

  // тоггл по serviceId для сердечка ServiceCard
  const toggleFavoriteClient = async (serviceId) => {
    const key = String(serviceId || "");
    if (!key) {
      tError(t("toast.favoriteError") || "Не удалось изменить избранное", { autoClose: 2000 });
      setError(t("toast.favoriteError", { defaultValue: "Не удалось изменить избранное" }));
      return;
    }

    try {
      const res = await apiPost("/api/wishlist/toggle", { serviceId });
      const added = !!(res?.added ?? res?.data?.added);

      (added ? tSuccess : tInfo)(
        added
          ? (t("favorites.added_toast") || "Добавлено в избранное")
          : (t("favorites.removed_toast") || "Удалено из избранного"),
        { autoClose: 1800, toastId: `fav-${key}-${added ? "add" : "rem"}` }
      );

      setFavIds((prev) => {
        const next = new Set(prev);
        if (added) next.add(key);
        else next.delete(key);
        return next;
      });

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

      setMessage(
        added
          ? t("messages.favorite_added", { defaultValue: "Добавлено в избранное" })
          : t("messages.favorite_removed", { defaultValue: "Удалено из избранного" })
      );
    } catch (err) {
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

  // quick request из «Избранного»
  const handleQuickRequest = async (serviceId, meta = {}) => {
    if (!serviceId) {
      setError(t("errors.service_unknown", { defaultValue: "Не удалось определить услугу" }));
      return;
    }

    const note = window.prompt(
      t("common.note_optional", { defaultValue: "Комментарий к запросу (необязательно):" })
    ) || undefined;

    try {
      await apiPost("/api/requests", { service_id: serviceId, note });
      tSuccess(t("messages.request_sent") || "Запрос отправлен", { autoClose: 1800 });
      setMessage(t("messages.request_sent", { defaultValue: "Запрос отправлен" }));

      setActiveTab("requests");

      const apiList = await fetchClientRequestsSafe(myId);
      const drafts  = [...loadDrafts(myId), ...loadDrafts(null)];
      setRequests(mergeRequests(apiList, drafts));
    } catch (err) {
      setError(t("errors.request_send", { defaultValue: "Не удалось отправить запрос" }));

      const status =
        err?.status || err?.response?.status || err?.data?.status;
      const code =
        err?.response?.data?.error || err?.data?.error || err?.error || err?.code || err?.message || "";
      const msg = String(code).toLowerCase();

      if (status === 409 || msg.includes("request_already_sent") || msg.includes("already")) {
        tInfo(t("errors.request_already_sent") || "Вы уже отправляли запрос", {
          autoClose: 2000,
          toastId: "req-already",
        });
        return;
      }

      if (msg.includes("self_request_forbidden")) {
        tInfo(t("errors.self_request_forbidden") || "Вы не можете отправить себе быстрый запрос!", {
          toastId: "self-req",
          autoClose: 2200,
        });
      } else if (status === 401 || status === 403 || msg.includes("unauthorized")) {
        tInfo(t("auth.login_required") || "Войдите, чтобы отправить запрос", {
          toastId: "login-required",
          autoClose: 2000,
        });
      } else {
        tError(t("errors.request_send") || "Не удалось отправить запрос", { autoClose: 1800 });
      }
    }
  };

  // удаление заявки
  function askDeleteRequest(id) {
    if (!id) return;
    const isDraftFromState = Array.isArray(requests) && requests.some(
      (x) => String(x.id) === String(id) && x.is_draft
    );
    const isDraft = String(id).startsWith("d_") || !!isDraftFromState;
    setDelUI({ open: true, id, isDraft, sending: false });
  }

  async function confirmDeleteRequest() {
    if (!delUI.id) return;
    setDelUI((s) => ({ ...s, sending: true }));
    try {
      if (delUI.isDraft || String(delUI.id).startsWith("d_")) {
        const keyId = myId || null;
        const updated = loadDrafts(keyId).filter((d) => String(d.id) !== String(delUI.id));
        saveDrafts(keyId, updated);
        setRequests((prev) => prev.filter((x) => String(x.id) !== String(delUI.id)));
        setMessage(t("client.dashboard.requestDeleted", { defaultValue: "Заявка удалена" }));
        tSuccess(t("client.dashboard.requestDeleted") || "Заявка удалена", { autoClose: 1500 });
      } else {
        await apiDelete(`/api/requests/${delUI.id}`);
        setRequests((prev) => prev.filter((x) => x.id !== delUI.id));
        setMessage(t("client.dashboard.requestDeleted", { defaultValue: "Заявка удалена" }));
        tSuccess(t("client.dashboard.requestDeleted") || "Заявка удалена", { autoClose: 1500 });
      }
    } catch (err) {
      const status = err?.status || err?.response?.status;
      const msgText = (err?.response?.data?.error || err?.data?.error || err?.message || "").toString().toLowerCase();
      if (status === 404 || msgText.includes("not found")) {
        setRequests((prev) => prev.filter((x) => String(x.id) !== String(delUI.id)));
        setMessage(t("client.dashboard.requestDeleted", { defaultValue: "Заявка удалена" }));
        tInfo(t("client.dashboard.requestDeleted") || "Заявка удалена (уже была удалена)", {
          autoClose: 1600, toastId: `req-del-${delUI.id}-404`
        });
      } else {
        setError(t("client.dashboard.requestDeleteFailed", { defaultValue: "Не удалось удалить заявку" }));
        tError(t("client.dashboard.requestDeleteFailed") || "Не удалось удалить заявку", { autoClose: 1800 });
      }
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

  // Quick Request (единый модал)
  const [qrOpen, setQrOpen] = useState(false);
  const [qrServiceId, setQrServiceId] = useState(null);
  const [qrTitle, setQrTitle] = useState("");
  const [qrSending, setQrSending] = useState(false);

  async function submitQuickRequest(note) {
    if (!qrServiceId || qrSending) return;
    setQrSending(true);

    try {
      await apiPost("/api/requests", { service_id: qrServiceId, note: note || undefined });
      tSuccess(t("messages.request_sent") || "Запрос отправлен", { autoClose: 1800 });
      setMessage(t("messages.request_sent", { defaultValue: "Запрос отправлен" }));

      setActiveTab("requests");

      const apiList = await fetchClientRequestsSafe(myId);
      const drafts  = [...loadDrafts(myId), ...loadDrafts(null)];
      setRequests(mergeRequests(apiList, drafts));
    } catch (err) {
      setError(t("errors.request_send", { defaultValue: "Не удалось отправить запрос" }));

      const status =
        err?.status || err?.response?.status || err?.data?.status;
      const code =
        err?.response?.data?.error || err?.data?.error || err?.error || err?.code || err?.message || "";
      const msg = String(code).toLowerCase();

      if (status === 409 || msg.includes("request_already_sent") || msg.includes("already")) {
        tInfo(t("errors.request_already_sent") || "Вы уже отправляли запрос", {
          toastId: "req-already",
          autoClose: 2000,
        });
        return;
      }
      if (msg.includes("self_request_forbidden") || status === 400) {
        tInfo(t("errors.self_request_forbidden") || "Вы не можете отправить себе быстрый запрос!", {
          toastId: "self-req",
          autoClose: 2200,
        });
      } else if (status === 401 || status === 403 || msg.includes("unauthorized")) {
        tInfo(t("auth.login_required") || "Войдите, чтобы отправить запрос", {
          toastId: "login-required",
          autoClose: 2000,
        });
      } else {
        tError(t("errors.request_send") || "Не удалось отправить запрос", { autoClose: 1800 });
      }
    } finally {
      setQrSending(false);
      closeQuickRequestModal();
    }
  }

  function openQuickEdit() {
    tInfo(t("wip.edit_soon", { defaultValue: "Редактирование скоро будет" }), { autoClose: 1500 });
  }

  // Avatar block
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

          const providerId =
            r?.provider?.id ??
            r?.service?.provider_id ?? r?.service?.providerId ??
            r?.provider_id ?? r?.providerId ?? null;
          const providerName =
            r?.provider?.name ?? r?.provider_name ?? r?.service?.provider_name ?? r?.service?.providerTitle ?? null;
          const providerType =
            r?.provider?.type ?? r?.provider_type ?? r?.service?.provider_type ?? null;
          const providerPhone =
            r?.provider?.phone ?? r?.provider_phone ?? r?.phone ?? null;
          const providerTg =
            r?.provider?.telegram ?? r?.provider?.social ?? r?.provider_telegram ?? r?.telegram ?? null;

          return (
            <div key={r.id} className={`bg-white border rounded-xl p-4 overflow-hidden ${r.is_draft ? "ring-1 ring-orange-200" : ""}`}>
              <div className="font-semibold leading-tight break-words line-clamp-2">{serviceTitle}</div>

              {providerId && (
                <div className="mt-2 text-sm text-gray-700 min-w-0">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/profile/provider/${providerId}`}
                      className="underline hover:no-underline block max-w-full truncate"
                    >
                      {providerName || "—"}
                    </Link>
                    {(providerType || authorProvTypes[providerId]) && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-slate-700">
                        {providerType
                          ? providerTypeLabel(providerType, t)
                          : authorProvTypes[providerId] ||
                            t("roles.provider", { defaultValue: "Поставщик" })}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-4 mt-1">
                    {providerPhone && (
                      <a
                        className="hover:underline break-all"
                        href={`tel:${String(providerPhone).replace(/[^+\d]/g, "")}`}
                      >
                        {providerPhone}
                      </a>
                    )}
                    {(() => {
                      const tg = normalizeTelegram(providerTg);
                      return tg ? (
                        <a
                          className="hover:underline break-all"
                          href={tg.href}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {tg.label}
                        </a>
                      ) : null;
                    })()}
                  </div>
                </div>
              )}

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

              {r?.note && (
                <div className="text-sm text-gray-600 mt-2 whitespace-pre-wrap break-words">
                  {t("common.comment", { defaultValue: "Комментарий" })}: {r.note}
                </div>
              )}

              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => openQuickEdit(r)}
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

  const handleRefreshClick = async () => {
    try {
      if (activeTab === "requests") {
        setLoadingTab(true);
        const apiList = await fetchClientRequestsSafe(myId);
        const drafts  = [...loadDrafts(myId), ...loadDrafts(null)];
        setRequests(mergeRequests(apiList, drafts));
      } else if (activeTab === "favorites") {
        setLoadingTab(true);
        const data = await apiGet("/api/wishlist?expand=service");
        const arr = Array.isArray(data) ? data : data?.items || [];
        setFavorites(arr);
        try {
          const ids = await apiGet("/api/wishlist/ids");
          const list = Array.isArray(ids) ? ids : [];
          setFavIds(new Set(list.map(String)));
        } catch {}
      } else if (activeTab === "bookings") {
        // даём сигнал компоненту <ClientBookings /> на перезагрузку
        setBookingsRefreshKey((x) => x + 1);
        window.dispatchEvent(new Event("client:bookings:refresh"));
      }
    } finally {
      if (activeTab !== "bookings") setLoadingTab(false);
    }
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
                    {/* Баннер «Подключить Telegram», показываем только если ещё не привязано */}
                {!isTgLinked && (
                    <div className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900 ring-1 ring-blue-200">
                      <div className="font-medium mb-1">
                        {t("telegram.enable_title", { defaultValue: "Уведомления в Telegram" })}
                      </div>
                  
                      {/* Текст всегда показываем, даже если deep-link не построился */}
                      <div className="mb-2">
                        {t("telegram.enable_text", {
                          defaultValue:
                            "Нажмите кнопку ниже, чтобы привязать Telegram и получать уведомления о заявках и бронированиях.",
                        })}
                      </div>
                  
                      {tgDeepLink ? (
                        <a
                          href={tgDeepLink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 font-semibold text-white hover:bg-blue-700"
                        >
                          {t("telegram.connect_button", { defaultValue: "Подключить Telegram" })}
                        </a>
                      ) : (
                        <div className="text-blue-700/90">
                          {/* Фолбэк, если имя бота не задано в .env */}
                          {botUser ? (
                            <a
                              href={`https://t.me/${botUser}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 font-semibold text-white hover:bg-blue-700"
                            >
                              {t("telegram.open_bot", { defaultValue: "Открыть бота в Telegram" })}
                            </a>
                          ) : (
                            <span className="inline-block">
                              {t("telegram.bot_missing", {
                                defaultValue:
                                  "Имя Telegram-бота не настроено. Обратитесь к администратору, чтобы указать VITE_TG_BOT_USERNAME.",
                              })}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}


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
        <MyInsideCard
          inside={inside}
          loading={loadingInside}
          t={t}
          now={now}
          onJoined={(data) => setInside(data && data.status === "none" ? null : data)}
        />
        <div className="mt-6" />
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
                  <button onClick={handleRefreshClick} className="text-orange-600 hover:underline text-sm">
                    {t("client.dashboard.refresh", { defaultValue: "Обновить" })}
                  </button>
                </div>
              </div>

            {activeTab === "requests"  && <RequestsList />}
            {activeTab === "bookings"  && <ClientBookings refreshKey={bookingsRefreshKey} />}
            {activeTab === "favorites" && <FavoritesTab />}
          </div>
        </div>
      </div>

      {/* Quick Request modal */}
      <QuickRequestModal
        open={qrOpen}
        onClose={closeQuickRequestModal}
        onSubmit={submitQuickRequest}
        busy={qrSending}
      />

      {/* Delete confirm */}
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
function resolveRequestExpireAt(r) {
  if (!r) return null;
  if (r.expires_at) {
    const ts = Number(r.expires_at) || Date.parse(r.expires_at);
    if (Number.isFinite(ts)) return ts;
  }
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
