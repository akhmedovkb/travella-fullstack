// frontend/src/pages/ClientDashboard.jsx
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { apiGet, apiPut, apiPost } from "../api";
import { createPortal } from "react-dom";

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
  const flatTg    = _firstNonEmpty(pick(bag, ["provider_telegram","supplier_telegram","vendor_telegram","agency_telegram","company_telegram","telegram","tg","telegram_username","telegram_link"]));

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
          <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
            {pageItems.map((it) => {
              const {
                svc, title, hotel, accommodation, dates, prettyPrice,
                inlineProvider, providerId, flatName, flatPhone, flatTg,
              } = extractServiceFields(it);

              // расширенное определение serviceId
              const serviceId =
                svc.id ?? svc._id ?? svc.service_id ?? svc.serviceId ??
                it.service_id ?? it.serviceId ?? it.service?.id ?? null;

              const image =
                (Array.isArray(svc.images) && svc.images[0]) ||
                svc.cover || svc.cover_url || svc.image ||
                it.cover || it.cover_url || it.image || null;

              // (оставляю твои «хуки в map», чтоб ничего не ломать)
              const [provider, setProvider] = useState(null);
              useEffect(() => {
                let alive = true;
                (async () => {
                  if (!providerId) return;
                  const p = await fetchProviderProfile(providerId);
                  if (alive) setProvider(p);
                })();
                return () => { alive = false; };
              }, [providerId]);

              const prov = { ...(inlineProvider || {}), ...(provider || {}) };

              const supplierName = _firstNonEmpty(
                prov?.name, prov?.title, prov?.display_name, prov?.company_name, prov?.brand,
                flatName
              );
              const supplierPhone = _firstNonEmpty(
                prov?.phone, prov?.phone_number, prov?.phoneNumber, prov?.tel, prov?.mobile, prov?.whatsapp, prov?.whatsApp,
                prov?.phones?.[0], prov?.contacts?.phone, prov?.contact_phone,
                flatPhone
              );
              const supplierTgRaw = _firstNonEmpty(
                prov?.telegram, prov?.tg, prov?.telegram_username, prov?.telegram_link, prov?.contacts?.telegram, prov?.socials?.telegram,
                flatTg
              );
              const supplierTg = renderTelegram(supplierTgRaw);
              const expireAt = resolveExpireAt(svc);
              const baseNow = Date.now();
              const leftMs = expireAt ? Math.max(0, expireAt - baseNow) : null;
              const hasTimer = !!expireAt;
              const timerText = hasTimer ? formatLeft(leftMs) : null;

              // подсказка (портал)
              const imgRef = useRef(null);
              const [tipOpen, setTipOpen] = useState(false);
              const [tipPos, setTipPos] = useState({ x: 0, y: 0, w: 0 });
              const computePos = () => {
                const r = imgRef.current?.getBoundingClientRect();
                if (!r) return;
                setTipPos({ x: r.left, y: r.top + 40, w: Math.floor(r.width) });
              };

              return (
                <div key={it.id} className="group relative w-full bg-white border rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col">
                  <div
                    className="aspect-[4/3] bg-gray-100 relative"
                    ref={imgRef}
                    onMouseEnter={() => { computePos(); setTipOpen(true); }}
                    onMouseMove={computePos}
                    onMouseLeave={() => setTipOpen(false)}
                  >
                    {image ? (
                      <img src={image} alt={title || "Service"} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400">
                        <span className="text-sm">{t("favorites.no_image", { defaultValue: "Нет изображения" })}</span>
                      </div>
                    )}

                    {hasTimer && (
                      <span
                        className={`absolute top-2 left-2 z-20 pointer-events-none px-2 py-0.5 rounded-full text-white text-xs backdrop-blur-md ring-1 ring-white/20 shadow ${leftMs > 0 ? "bg-orange-600/95" : "bg-gray-400/90"}`}
                        title={leftMs > 0 ? t("countdown.until_end", { defaultValue: "До окончания" }) : t("countdown.expired", { defaultValue: "Время истекло" })}
                      >
                        {timerText}
                      </span>
                    )}

                    {/* Сердечко (удаление) */}
                    <div className="absolute top-2 right-2 z-20">
                      <div className="relative group/heart">
                        <button
                          onClick={() => onRemove?.(it.id)}
                          className="p-1.5 rounded-full bg-black/30 hover:bg-black/40 text-red-500 backdrop-blur-md ring-1 ring-white/20"
                          aria-label={t("favorites.remove_from", { defaultValue: "Удалить из Избранного" })}
                          title={t("favorites.remove_from", { defaultValue: "Удалить из Избранного" })}
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 21s-7-4.534-9.5-8.25C1.1 10.3 2.5 6 6.5 6c2.2 0 3.5 1.6 3.5 1.6S11.8 6 14 6c4 0 5.4 4.3 4 6.75C19 16.466 12 21 12 21z" />
                          </svg>
                        </button>
                        <div className="absolute -top-2 right-8 -translate-y-full opacity-0 group-hover/heart:opacity-100 transition-opacity pointer-events-none">
                          <div className="relative bg-black/80 text-white text-xs px-2 py-1 rounded-md shadow backdrop-blur-md">
                            {t("favorites.remove_from", { defaultValue: "Удалить из Избранного" })}
                            <div className="absolute -bottom-1 right-2 w-2 h-2 bg-black/80 rotate-45" />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* стеклянная подсказка (портал) */}
                    <TooltipPortal visible={tipOpen} x={tipPos.x} y={tipPos.y} width={tipPos.w}>
                      <div className="pointer-events-none select-none rounded-2xl bg-gradient-to-b from-black/70 to-black/40 text-white text-xs sm:text-sm p-3 ring-1 ring-white/15 shadow-2xl backdrop-blur-md">
                        <div className="font-semibold line-clamp-2">{title}</div>
                        {hotel && (<div><span className="opacity-80">{t("hotel", { defaultValue: "Отель" })}: </span><span className="font-medium">{hotel}</span></div>)}
                        {accommodation && (<div><span className="opacity-80">{t("accommodation", { defaultValue: "Размещение" })}: </span><span className="font-medium">{accommodation}</span></div>)}
                        {dates && (<div><span className="opacity-80">{t("date", { defaultValue: "Дата" })}: </span><span className="font-medium">{dates}</span></div>)}
                        {prettyPrice && (<div><span className="opacity-80">{t("marketplace.price", { defaultValue: "Цена" })}: </span><span className="font-semibold">{prettyPrice}</span></div>)}
                      </div>
                    </TooltipPortal>
                  </div>

                  {/* Тело карточки */}
                  <div className="p-3 flex-1 flex flex-col">
                    <div className="font-semibold line-clamp-2">{title}</div>
                    {prettyPrice && (<div className="mt-1 text-sm">{t("marketplace.price", { defaultValue: "Цена" })}: <span className="font-semibold">{prettyPrice}</span></div>)}

                    {(supplierName || supplierPhone || supplierTg?.label) && (
                      <div className="mt-2 text-sm space-y-0.5">
                        {supplierName && (<div><span className="text-gray-500">{t("supplier", { defaultValue: "Поставщик" })}: </span><span className="font-medium">{supplierName}</span></div>)}
                        {supplierPhone && (
                          <div>
                            <span className="text-gray-500">{t("phone", { defaultValue: "Телефон" })}: </span>
                            <a href={`tel:${String(supplierPhone).replace(/\s+/g, "")}`} className="underline" onClick={(e) => e.stopPropagation()}>{supplierPhone}</a>
                          </div>
                        )}
                        {supplierTg?.label && (
                          <div>
                            <span className="text-gray-500">{t("telegram", { defaultValue: "Телеграм" })}: </span>
                            {supplierTg.href ? (
                              <a href={supplierTg.href} target="_blank" rel="noopener noreferrer" className="underline" onClick={(e) => e.stopPropagation()}>{supplierTg.label}</a>
                            ) : (<span className="font-medium">{supplierTg.label}</span>)}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="mt-auto pt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {serviceId && (
                        <>
                          <button
                            onClick={() => onQuickRequest?.(serviceId, { title })}
                            className="w-full bg-orange-500 text-white rounded-lg px-3 py-2 text-sm sm:text-[13px] leading-tight whitespace-normal break-words min-h-[40px] font-semibold hover:bg-orange-600"
                          >
                            {t("actions.quick_request", { defaultValue: "Быстрый запрос" })}
                          </button>
                          <button
                            onClick={() => onBook?.(serviceId)}
                            className="w-full border rounded-lg px-3 py-2 text-sm sm:text-[13px] leading-tight whitespace-normal break-words min-h-[40px] hover:bg-gray-50"
                          >
                            {t("actions.book_now", { defaultValue: "Забронировать" })}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-center gap-2 mt-6">
            <button className="px-3 py-1.5 rounded-lg border disabled:opacity-40" onClick={() => onPageChange?.(current - 1)} disabled={current <= 1}>{t("pagination.prev", { defaultValue: "←" })}</button>
            {Array.from({ length: pages }).map((_, i) => {
              const p = i + 1; const active = p === current;
              return (<button key={p} onClick={() => onPageChange?.(p)} className={`px-3 py-1.5 rounded-lg border ${active ? "bg-gray-900 text-white" : "bg-white"}`}>{p}</button>);
            })}
            <button className="px-3 py-1.5 rounded-lg border disabled:opacity-40" onClick={() => onPageChange?.(current + 1)} disabled={current >= pages}>{t("pagination.next", { defaultValue: "→" })}</button>
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
  const [bkDate, setBkDate] = useState("");
  const [bkTime, setBkTime] = useState("");
  const [bkPax, setBkPax] = useState(1);
  const [bkNote, setBkNote] = useState("");
  const [bkSending, setBkSending] = useState(false);

  // мой id из профиля (для фильтрации/ключа черновиков)
  const [myId, setMyId] = useState(null);

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

  // слушаем событие мгновенного создания (в т.ч. из маркетплейса)
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
      // синхронизация между вкладками
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
      setName(res?.name ?? name);
      setPhone(res?.phone ?? phone);
      setTelegram(res?.telegram ?? telegram);
      if (res?.avatar_base64) { setAvatarBase64(toDataUrl(res.avatar_base64)); setAvatarServerUrl(null); }
      else if (res?.avatar_url) { setAvatarServerUrl(res.avatar_url); setAvatarBase64(null); }
      setRemoveAvatar(false);
    } catch { setError(t("errors.profile_save", { defaultValue: "Не удалось сохранить профиль" })); }
    finally { setSavingProfile(false); }
  };

  const handleChangePassword = async () => {
    if (!newPassword || newPassword.length < 6) { setError(t("client.dashboard.passwordTooShort", { defaultValue: "Пароль должен быть не короче 6 символов" })); return; }
    try {
      setChangingPass(true); setError(null);
      await apiPost("/api/clients/change-password", { password: newPassword });
      setMessage(t("client.dashboard.passwordChanged", { defaultValue: "Пароль изменён" })); setNewPassword("");
    } catch { setError(t("errors.password_change", { defaultValue: "Не удалось изменить пароль" })); }
    finally { setChangingPass(false); }
  };

  const handleLogout = () => { try { localStorage.removeItem("clientToken"); } finally { window.location.href = "/client/login"; } };

  const handleRemoveFavorite = async (itemId) => {
    try { await apiPost("/api/wishlist/toggle", { itemId }); } catch {}
    setFavorites((prev) => prev.filter((x) => x.id !== itemId));
    setMessage(t("messages.favorite_removed", { defaultValue: "Удалено из избранного" }));
  };

  // quick request из «Избранного» (+локальный черновик)
  const handleQuickRequest = async (serviceId, meta = {}) => {
    if (!serviceId) { setError(t("errors.service_unknown", { defaultValue: "Не удалось определить услугу" })); return; }
    const note = window.prompt(t("common.note_optional", { defaultValue: "Комментарий к запросу (необязательно):" })) || undefined;

    try {
      await apiPost("/api/requests", { service_id: serviceId, note });
      setMessage(t("messages.request_sent", { defaultValue: "Запрос отправлен" }));

      // мгновенно кладём черновик (даже если GET 404)
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

      // попробуем ещё раз дотянуть API и смёрджить
      try {
        const apiList = await fetchClientRequestsSafe(myId);
        const drafts  = [...loadDrafts(myId), ...loadDrafts(null)];
        setRequests(mergeRequests(apiList, drafts));
      } catch {}
    } catch {
      setError(t("errors.request_send", { defaultValue: "Не удалось отправить запрос" }));
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
    } catch (e) { setError(e?.message || t("errors.action_failed", { defaultValue: "Не удалось выполнить действие" })); }
    finally { setActingReqId(null); }
  };

  const handleRejectProposal = async (id) => {
    try {
      setActingReqId(id); setError(null);
      await apiPost(`/api/requests/${id}/reject`, {});
      setMessage(t("client.dashboard.rejected", { defaultValue: "Предложение отклонено" }));
      const data = await fetchClientRequestsSafe(myId);
      setRequests(mergeRequests(data, [...loadDrafts(myId), ...loadDrafts(null)]));
    } catch (e) { setError(e?.message || t("errors.action_failed", { defaultValue: "Не удалось выполнить действие" })); }
    finally { setActingReqId(null); }
  };

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
            <div key={r.id} className={`bg-white border rounded-xl p-4 ${r.is_draft ? "ring-1 ring-orange-200" : ""}`}>
              <div className="font-semibold">{serviceTitle}</div>
              <div className="text-sm text-gray-500 mt-1">
                {t("common.status", { defaultValue: "Статус" })}: {status}
                {r.is_draft && <span className="ml-2 text-orange-600 text-xs">draft</span>}
              </div>
              {created && <div className="text-xs text-gray-400 mt-1">{t("common.created", { defaultValue: "Создан" })}: {created}</div>}
              {r?.note && <div className="text-sm text-gray-600 mt-2">{t("common.comment", { defaultValue: "Комментарий" })}: {r.note}</div>}

              {p ? (
                <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm">
                  <div className="font-medium mb-1">{t("client.dashboard.offer", { defaultValue: "Предложение" })}</div>
                  <div>{t("client.dashboard.price", { defaultValue: "Цена" })}: {p.price} {p.currency || "USD"}</div>
                  {p.hotel && <div>Отель: {p.hotel}</div>}
                  {p.room && <div>Размещение: {p.room}</div>}
                  {p.terms && <div>Условия: {p.terms}</div>}
                  {p.message && <div>Сообщение: {p.message}</div>}

                  {status !== "accepted" && status !== "rejected" && (
                    <div className="mt-3 flex gap-2">
                      <button onClick={() => handleAcceptProposal(r.id)} disabled={actingReqId === r.id} className="px-3 py-1.5 rounded bg-orange-600 text-white disabled:opacity-60">
                        {t("client.dashboard.accept", { defaultValue: "Принять" })}
                      </button>
                      <button onClick={() => handleRejectProposal(r.id)} disabled={actingReqId === r.id} className="px-3 py-1.5 rounded border disabled:opacity-60">
                        {t("client.dashboard.reject", { defaultValue: "Отклонить" })}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-2 text-sm text-gray-500">{t("client.dashboard.waitingOffer", { defaultValue: "Ожидает предложения…" })}</div>
              )}
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
        perPage={8}
        onRemove={handleRemoveFavorite}
        onQuickRequest={(id, meta) => handleQuickRequest(id, meta)}
        onBook={(serviceId) => openBooking(serviceId)}
        onPageChange={(p) => setFavPage(p)}
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
                {bkSending ? t("common.sending", { defaultValue: "Отправка..." })} : {t("booking.submit", { defaultValue: "Забронировать" })}
              </button>
              <button onClick={closeBooking} className="px-4 py-2 rounded-lg border">{t("actions.cancel", { defaultValue: "Отмена" })}</button>
            </div>
          </div>
        </div>
      )}
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
  const ts = Number(cand) || Date.parse(cand);
  return Number.isFinite(ts) ? ts : null;
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
