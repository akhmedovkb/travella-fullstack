import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { apiGet } from "../api";

/* ========== утилиты ========== */
function _firstNonEmpty(...args) {
  for (const v of args)
    if (v === 0 || (v !== undefined && v !== null && String(v).trim() !== ""))
      return v;
  return null;
}
function _maybeParse(obj) {
  if (!obj) return null;
  if (typeof obj === "string") {
    try { return JSON.parse(obj); } catch { return null; }
  }
  return typeof obj === "object" ? obj : null;
}
function _mergeDetails(svc, it) {
  const cands = [
    svc?.details, it?.details, svc?.detail, it?.detail,
    svc?.meta, svc?.params, svc?.payload, svc?.extra, svc?.data, svc?.info,
  ].map(_maybeParse).filter(Boolean);
  return Object.assign({}, ...cands);
}
function extractServiceFields(item, viewerRole) {
  const svc = item?.service || item || {};
  const details = _mergeDetails(svc, item);
  const bag = { ...details, ...svc, ...item };

  const title = _firstNonEmpty(
    svc.title, svc.name, details?.title, details?.name, details?.eventName, item?.title, item?.name
  );

  const rawPrice = (viewerRole === "client")
    ? _firstNonEmpty(details?.grossPrice, details?.priceGross, details?.totalPrice, svc.grossPrice, svc.price_gross)
    : _firstNonEmpty(details?.netPrice, details?.price, details?.totalPrice, details?.priceNet, svc.netPrice, svc.price, item?.price, details?.grossPrice);
  const prettyPrice = rawPrice == null ? null : new Intl.NumberFormat().format(Number(rawPrice));

  const hotel = _firstNonEmpty(
    details?.hotel, details?.hotelName, details?.hotel?.name, details?.refused_hotel_name,
    svc.hotel, svc.hotel_name, svc.refused_hotel_name
  );
  const accommodation = _firstNonEmpty(
    details?.accommodation, details?.accommodationCategory, details?.room, details?.roomType, details?.room_category,
    svc.accommodation, svc.room, svc.room_type
  );

  const left = _firstNonEmpty(
    bag.hotel_check_in, bag.checkIn, bag.startDate, bag.start_flight_date, bag.startFlightDate, bag.departureFlightDate
  );
  const right = _firstNonEmpty(
    bag.hotel_check_out, bag.checkOut, bag.returnDate, bag.end_flight_date, bag.endFlightDate, bag.returnFlightDate
  );
  const dates = left && right ? `${left} → ${right}` : left || right || null;

  const inlineProvider = _firstNonEmpty(
    svc.provider, svc.provider_profile, svc.supplier, svc.vendor, svc.agency, svc.owner,
    item.provider, item.provider_profile, item.supplier, item.vendor, item.agency, item.owner,
    details?.provider
  ) || {};

  const providerId = _firstNonEmpty(
    svc.provider_id, svc.providerId, item.provider_id, item.providerId, details?.provider_id,
    svc.owner_id, svc.agency_id, inlineProvider?.id, inlineProvider?._id
  );

  const status = _firstNonEmpty(svc.status, item.status, details?.status);

  return {
    svc, details, title, hotel, accommodation, dates, prettyPrice,
    inlineProvider, providerId, status
  };
}
function firstImageFrom(val) {
  if (typeof val === "string") {
    let s = val.trim(); if (!s) return null;
    if (/^data:image\//i.test(s)) {
      s = s.replace(/\s+/g, "");
      if (/;base64(?!,)/i.test(s)) s = s.replace(/;base64/i, ";base64,");
      return s;
    }
    if (/^[A-Za-z0-9+/=\s]+$/.test(s) && s.replace(/\s+/g, "").length > 100)
      return `data:image/jpeg;base64,${s.replace(/\s+/g, "")}`;
    if (/^(https?:|blob:|file:|\/)/i.test(s)) return s;
    return `${window.location.origin}/${s.replace(/^\.?\//, "")}`;
  }
  if (Array.isArray(val)) {
    for (const v of val) { const r = firstImageFrom(v); if (r) return r; }
    return null;
  }
  if (val && typeof val === "object") {
    return firstImageFrom(val.url ?? val.src ?? val.href ?? val.link ?? val.path ?? val.data ?? val.base64);
  }
  return null;
}
function resolveExpireAt(service) {
  const s = service || {};
  const d = s.details || {};
  const cand = [
    s.expires_at, s.expire_at, s.expireAt,
    d.expires_at, d.expire_at, d.expiresAt,
    d.expiration, d.expiration_at, d.expirationAt,
    d.expiration_ts, d.expirationTs,
  ].find((v) => v !== undefined && v !== null && String(v).trim?.() !== "");
  let ts = null;
  if (cand !== undefined && cand !== null) {
    if (typeof cand === "number") ts = cand > 1e12 ? cand : cand * 1000;
    else {
      const parsed = Date.parse(String(cand));
      if (!Number.isNaN(parsed)) ts = parsed;
    }
  }
  if (!ts) {
    const ttl = d.ttl_hours ?? d.ttlHours ?? s.ttl_hours ?? null;
    if (ttl && Number(ttl) > 0 && s.created_at) {
      const created = Date.parse(s.created_at);
      if (!Number.isNaN(created)) ts = created + Number(ttl) * 3600 * 1000;
    }
  }
  return ts;
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
function Stars({ value = 0, size = 14 }) {
  const full = Math.round(Number(value) * 2) / 2;
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => {
        const filled = i + 1 <= full;
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 24 24"
               className={filled ? "text-amber-400" : "text-gray-400"}
               fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5">
            <path d="M12 .587l3.668 7.431L24 9.748l-6 5.847L19.335 24 12 20.202 4.665 24 6 15.595 0 9.748l8.332-1.73z"/>
          </svg>
        );
      })}
    </div>
  );
}
function TooltipPortal({ visible, x, y, children }) {
  if (!visible) return null;
  return createPortal(
    <div className="fixed z-[3000] pointer-events-none" style={{ top: y, left: x }}>{children}</div>,
    document.body
  );
}
function renderTelegram(value) {
  if (!value) return null;
  const s = String(value).trim();
  let href = null; let label = s;
  if (/^https?:\/\//i.test(s)) href = s;
  else if (s.startsWith("@")) { href = `https://t.me/${s.slice(1)}`; label = s; }
  else if (/^[A-Za-z0-9_]+$/.test(s)) { href = `https://t.me/${s}`; label = `@${s}`; }
  return { href, label };
}

/* ========== сама карточка ========== */
export default function ServiceCard({
  item,
  viewerRole = "client",       // "client" | "provider"
  isFavorite = false,          // boolean
  onToggleFavorite,            // (serviceId) => void|Promise
  onQuickRequest,              // (serviceId, providerId, title) => void
  now = Date.now(),            // number (ms)
}) {
  const { t } = useTranslation();
  const { svc, details, title, hotel, accommodation, dates, prettyPrice, inlineProvider, providerId } =
    extractServiceFields(item, viewerRole);
  const id = svc.id ?? item.id;

  const image = firstImageFrom([
    svc.images, details?.images, item?.images,
    svc.cover, svc.image, details?.cover, details?.image, item?.cover, item?.image,
    details?.photo, details?.picture, details?.imageUrl,
    svc.image_url, item?.image_url
  ]);

  const [revOpen, setRevOpen] = useState(false);
  const [revPos, setRevPos] = useState({ x: 0, y: 0 });
  const [revData, setRevData] = useState({ avg: 0, count: 0, items: [] });
  const revBtnRef = useRef(null);

  const openReviews = async () => {
    if (revBtnRef.current) {
      const r = revBtnRef.current.getBoundingClientRect();
      setRevPos({ x: r.left - 8, y: r.top - 8 });
    }
    setRevOpen(true);
    try {
      const res = await apiGet(`/api/reviews/service/${id}?limit=3`);
      const data = res && typeof res === "object" ? res : {};
      setRevData({
        avg: Number(data.avg) || 0,
        count: Number(data.count) || 0,
        items: Array.isArray(data.items) ? data.items : [],
      });
    } catch {
      setRevData({ avg: 0, count: 0, items: [] });
    }
  };
  const closeReviews = () => setRevOpen(false);

  const expireAt = resolveExpireAt(svc);
  const leftMs = expireAt ? Math.max(0, expireAt - now) : null;
  const hasTimer = !!expireAt;
  const timerText = hasTimer ? formatLeft(leftMs) : null;

  const tg = renderTelegram(
    inlineProvider?.telegram || inlineProvider?.tg || inlineProvider?.telegram_username ||
    inlineProvider?.telegram_link || inlineProvider?.contacts?.telegram || inlineProvider?.socials?.telegram
  );

  return (
    <div className="group relative bg-white border rounded-xl overflow-hidden shadow-sm flex flex-col">
      <div className="aspect-[16/10] bg-gray-100 relative">
        {image ? (
          <img
            src={image}
            alt={title || t("marketplace.no_image")}
            className="w-full h-full object-cover"
            onError={(e) => { e.currentTarget.src = ""; }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            <span className="text-sm">{t("marketplace.no_image") || "Нет изображения"}</span>
          </div>
        )}

        <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none">
          <div className="flex items-center gap-2">
            {hasTimer && (
              <span
                className={`pointer-events-auto px-2 py-0.5 rounded-full text-white text-xs backdrop-blur-md ring-1 ring-white/20 shadow ${leftMs > 0 ? "bg-orange-600/95" : "bg-gray-400/90"}`}
                title={leftMs > 0 ? t("countdown.until_end") || "До окончания" : t("countdown.expired") || "Время истекло"}
              >
                {timerText}
              </span>
            )}
            <button
              ref={revBtnRef}
              type="button"
              className="pointer-events-auto p-1.5 rounded-full bg-black/30 hover:bg-black/40 text-white backdrop-blur-md ring-1 ring-white/20 relative"
              onMouseEnter={openReviews}
              onMouseLeave={closeReviews}
              title={t("marketplace.reviews") || "Отзывы об услуге"}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M21 15a4 4 0 0 1-4 4H8l-4 4V7a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4z" />
              </svg>
            </button>
          </div>

          {/* круглое сердце с градиентом */}
          <div className="pointer-events-auto">
            <button
              type="button"
              className="relative inline-flex items-center justify-center w-9 h-9 rounded-full focus:outline-none"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFavorite?.(id); }}
              aria-label={isFavorite ? (t("favorites.remove_from") || "Удалить из избранного") : (t("favorites.add") || "В избранное")}
              title={isFavorite ? (t("favorites.remove_from") || "Удалить из избранного") : (t("favorites.add") || "В избранное")}
            >
              <span className="absolute inset-0 rounded-full shadow-[inset_0_1px_3px_rgba(255,255,255,.35),inset_0_-2px_6px_rgba(0,0,0,.25)] bg-[radial-gradient(115%_115%_at_25%_20%,#eef1f5_0%,#cfd3d8_38%,#aeb4bb_62%,#8f959d_100%)]" />
              <svg width="18" height="18" viewBox="0 0 24 24"
                   className="relative"
                   fill={isFavorite ? "#ef4444" : "none"}
                   stroke={isFavorite ? "#ef4444" : "currentColor"} strokeWidth="2">
                <path d="M12 21s-6.716-4.35-9.192-7.2C.818 11.48 1.04 8.72 2.88 7.2a5 5 0 0 1 6.573.33L12 9.08l2.547-1.55a5 5 0 0 1 6.573.33c1.84 1.52 2.062 4.28.072 6.6C18.716 16.65 12 21 12 21Z"/>
              </svg>
            </button>
          </div>
        </div>

        {/* hover-слой с данными */}
        <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="absolute inset-x-0 bottom-0 p-3">
            <div className="rounded-lg bg-black/55 backdrop-blur-md text-white text-xs sm:text-sm p-3 ring-1 ring-white/15 shadow-lg">
              <div className="font-semibold line-clamp-2">{title}</div>
              {hotel && (
                <div><span className="opacity-80">Отель: </span><span className="font-medium">{hotel}</span></div>
              )}
              {accommodation && (
                <div><span className="opacity-80">Размещение: </span><span className="font-medium">{accommodation}</span></div>
              )}
              {dates && (
                <div><span className="opacity-80">{t("common.date") || "Дата"}: </span><span className="font-medium">{dates}</span></div>
              )}
              {prettyPrice && (
                <div><span className="opacity-80">{t("marketplace.price") || "Цена"}: </span><span className="font-semibold">{prettyPrice}</span></div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* тултип отзывов */}
      <TooltipPortal visible={revOpen} x={revPos.x} y={revPos.y}>
        <div className="pointer-events-none max-w-xs rounded-lg bg-black/85 text-white text-xs p-3 shadow-2xl ring-1 ring-white/10">
          <div className="mb-1 font-semibold">{t("marketplace.reviews") || "Отзывы об услуге"}</div>
          <div className="flex items-center gap-2">
            <Stars value={revData.avg} />
            <span className="opacity-80">({revData.count || 0})</span>
          </div>
          <div className="mt-1">
            {!revData.items?.length ? (
              <span className="opacity-80">—</span>
            ) : (
              <ul className="list-disc ml-4 space-y-1">
                {revData.items.slice(0, 2).map((r) => (
                  <li key={r.id} className="line-clamp-2 opacity-90">{r.text || ""}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </TooltipPortal>

      {/* тело карточки */}
      <div className="p-3 flex-1 flex flex-col">
        <div className="font-semibold line-clamp-2">{title}</div>
        {prettyPrice && (
          <div className="mt-1 text-sm">
            {t("marketplace.price") || "Цена"}: <span className="font-semibold">{prettyPrice}</span>
          </div>
        )}

        {/* (минимальные контакты выводим, если есть) */}
        {tg?.label && (
          <div className="mt-2 text-sm">
            <span className="text-gray-500">{t("marketplace.telegram") || "Телеграм"}: </span>
            {tg.href ? (
              <a href={tg.href} target="_blank" rel="noopener noreferrer" className="underline">
                {tg.label}
              </a>
            ) : (
              <span className="font-medium">{tg.label}</span>
            )}
          </div>
        )}

        <div className="mt-auto pt-3">
          <button
            onClick={() => onQuickRequest?.(id, providerId, title)}
            className="w-full bg-orange-500 text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-orange-600"
          >
            {t("actions.quick_request") || "Быстрый запрос"}
          </button>
        </div>
      </div>
    </div>
  );
}
