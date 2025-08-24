//frontend/src/components/ServiceCard.jsx
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { apiGet } from "../api";
import WishHeart from "./WishHeart";
const SHOW_REVIEWS = false; // выключаем блок «Отзывы об услуге»


/* ============== small utils ============== */
const firstNonEmpty = (...vals) => {
  for (const v of vals) {
    if (v === 0) return 0;
    if (v !== undefined && v !== null && String(v).trim?.() !== "") return v;
  }
  return null;
};
const maybeParse = (x) => {
  if (!x) return null;
  if (typeof x === "object") return x;
  if (typeof x === "string") {
    try { return JSON.parse(x); } catch { return null; }
  }
  return null;
};
const mergeDetails = (svc, it) => {
  const parts = [
    svc?.details, it?.details, svc?.detail, it?.detail,
    svc?.meta, svc?.params, svc?.payload, svc?.extra, svc?.data, svc?.info,
  ].map(maybeParse).filter(Boolean);
  return Object.assign({}, ...parts);
};
const firstImageFrom = (val) => {
  if (!val) return null;
  if (typeof val === "string") {
    let s = val.trim();
    if (!s) return null;
    if (/^data:image\//i.test(s)) {
      s = s.replace(/\s+/g, "");
      if (/;base64(?!,)/i.test(s)) s = s.replace(/;base64/i, ";base64,");
      return s;
    }
    if (/^[A-Za-z0-9+/=\s]+$/.test(s) && s.replace(/\s+/g, "").length > 100) {
      return `data:image/jpeg;base64,${s.replace(/\s+/g, "")}`;
    }
    if (/^(https?:|blob:|file:|\/)/i.test(s)) return s;
    return `${window.location.origin}/${s.replace(/^\.?\//, "")}`;
  }
  if (Array.isArray(val)) {
    for (const v of val) {
      const r = firstImageFrom(v);
      if (r) return r;
    }
    return null;
  }
  if (typeof val === "object") {
    return firstImageFrom(val.url ?? val.src ?? val.href ?? val.link ?? val.path ?? val.data ?? val.base64);
  }
  return null;
};
const resolveExpireAt = (service) => {
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
};
const formatLeft = (ms) => {
  if (ms <= 0) return "00:00:00";
  const total = Math.floor(ms / 1000);
  const dd = Math.floor(total / 86400);
  const hh = Math.floor((total % 86400) / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (dd > 0) return `${dd}д ${pad(hh)}:${pad(mm)}`;
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
};
const renderTelegram = (value) => {
  if (!value) return null;
  const s = String(value).trim();
  let href = null;
  let label = s;
  if (/^https?:\/\//i.test(s)) href = s;
  else if (s.startsWith("@")) { href = `https://t.me/${s.slice(1)}`; label = s; }
  else if (/^[A-Za-z0-9_]+$/.test(s)) { href = `https://t.me/${s}`; label = `@${s}`; }
  return { href, label };
};

/* ============== provider profile cache ============== */
const providerCache = new Map();
async function fetchProviderProfile(providerId) {
  if (!providerId) return null;
  if (providerCache.has(providerId)) return providerCache.get(providerId);
  const endpoints = [
    `/api/providers/${providerId}`,
    `/api/provider/${providerId}`,
    `/api/suppliers/${providerId}`,
    `/api/supplier/${providerId}`,
    `/api/agencies/${providerId}`,
    `/api/agency/${providerId}`,
    `/api/companies/${providerId}`,
    `/api/company/${providerId}`,
    `/api/users/${providerId}`,
    `/api/user/${providerId}`,
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

/* ============== stars + tooltip ============== */
function Stars({ value = 0, size = 14 }) {
  const full = Math.round(Number(value) * 2) / 2;
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => {
        const filled = i + 1 <= full;
        return (
          <svg
            key={i}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            className={filled ? "text-amber-400" : "text-gray-400"}
            fill={filled ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M12 .587l3.668 7.431L24 9.748l-6 5.847L19.335 24 12 20.202 4.665 24 6 15.595 0 9.748l8.332-1.73z" />
          </svg>
        );
      })}
    </div>
  );
}
function TooltipPortal({ visible, x, y, children }) {
  if (!visible) return null;
  return createPortal(
    <div className="fixed z-[3000] pointer-events-none" style={{ top: y, left: x }}>
      {children}
    </div>,
    document.body
  );
}

/* ============== field extractor ============== */
function extractServiceFields(item, viewerRole) {
  const svc = item?.service || item || {};
  const details = mergeDetails(svc, item);
  const bag = { ...details, ...svc, ...item };

  const title = firstNonEmpty(
    svc.title, svc.name, details?.title, details?.name, details?.eventName, item?.title, item?.name
  );

  const rawPrice = viewerRole === "client"
    ? firstNonEmpty(details?.grossPrice, details?.priceGross, details?.totalPrice, svc.grossPrice, svc.price_gross)
    : firstNonEmpty(details?.netPrice, details?.price, details?.totalPrice, details?.priceNet, svc.netPrice, svc.price, item?.price, details?.grossPrice);

  const prettyPrice = rawPrice == null ? null : new Intl.NumberFormat().format(Number(rawPrice));

  const hotel = firstNonEmpty(
    details?.hotel, details?.hotelName, details?.hotel?.name, details?.refused_hotel_name,
    svc.hotel, svc.hotel_name, svc.refused_hotel_name
  );
  const accommodation = firstNonEmpty(
    details?.accommodation, details?.accommodationCategory, details?.room, details?.roomType, details?.room_category,
    svc.accommodation, svc.room, svc.room_type
  );

  const left = firstNonEmpty(
    bag.hotel_check_in, bag.checkIn, bag.startDate, bag.start_flight_date, bag.startFlightDate, bag.departureFlightDate
  );
  const right = firstNonEmpty(
    bag.hotel_check_out, bag.checkOut, bag.returnDate, bag.end_flight_date, bag.endFlightDate, bag.returnFlightDate
  );
  const dates = left && right ? `${left} → ${right}` : left || right || null;
  
    // ---------- direction (for refused_flight, etc.) ----------
  const dirFrom = firstNonEmpty(
    details?.directionFrom, details?.from, details?.cityFrom, details?.origin, details?.departureCity,
    svc.directionFrom, svc.from, svc.cityFrom, svc.origin, svc.departureCity,
    item.directionFrom, item.from, item.cityFrom, item.origin
  );
  const dirTo = firstNonEmpty(
    details?.directionTo, details?.to, details?.cityTo, details?.destination, details?.arrivalCity,
    svc.directionTo, svc.to, svc.cityTo, svc.destination, svc.arrivalCity,
    item.directionTo, item.to, item.cityTo, item.destination
  );
  const direction = dirFrom && dirTo ? `${dirFrom} → ${dirTo}` : null;
  
  const inlineProvider = firstNonEmpty(
    svc.provider, svc.provider_profile, svc.supplier, svc.vendor, svc.agency, svc.owner,
    item.provider, item.provider_profile, item.supplier, item.vendor, item.agency, item.owner,
    details?.provider
  ) || {};

  const providerId = firstNonEmpty(
    svc.provider_id, svc.providerId, item.provider_id, item.providerId, details?.provider_id,
    svc.owner_id, svc.agency_id, inlineProvider?.id, inlineProvider?._id
  );

  const flatName = firstNonEmpty(
    bag.provider_name, bag.supplier_name, bag.vendor_name, bag.agency_name, bag.company_name, bag.providerTitle, bag.display_name
  );
  const flatPhone = firstNonEmpty(
    bag.provider_phone, bag.supplier_phone, bag.vendor_phone, bag.agency_phone, bag.company_phone, bag.contact_phone, bag.phone, bag.whatsapp, bag.whats_app
  );
  const flatTg = firstNonEmpty(
    bag.provider_telegram, bag.supplier_telegram, bag.vendor_telegram, bag.agency_telegram, bag.company_telegram,
    bag.telegram, bag.tg, bag.telegram_username, bag.telegram_link,
    bag.provider_social, bag.supplier_social, bag.vendor_social, bag.agency_social, bag.company_social,
    bag.social, bag.social_link
  );

  const status = firstNonEmpty(svc.status, item.status, details?.status);

  return {
    svc, details, title, hotel, accommodation, dates, direction,
    rawPrice, prettyPrice,
    inlineProvider, providerId, flatName, flatPhone, flatTg, status
  };
}

/* ============== the card ============== */
export default function ServiceCard({
  item,
  viewerRole = null,        // 'client' | 'provider' | null
  favoriteIds,              // Set<string> (optional)
  isFav,                    // boolean (optional; overrides favoriteIds)
  favActive,
  onToggleFavorite,         // (serviceId) => void|Promise<void>
  onQuickRequest,           // (serviceId, providerId, title) => void
  now = Date.now(),
  className = "",
}) {
  const { t } = useTranslation();

  const {
    svc,
    title,
    hotel,
    accommodation,
    dates,
    prettyPrice,
    inlineProvider,
    providerId,
    flatName,
    flatPhone,
    flatTg,
    status: statusRaw,
    details,
    direction
  } = extractServiceFields(item, viewerRole);

  const id = svc.id ?? item.id;

  const image = firstImageFrom([
    svc.images, details?.images, item?.images,
    svc.cover, svc.image, details?.cover, details?.image, item?.cover, item?.image,
    details?.photo, details?.picture, details?.imageUrl,
    svc.image_url, item?.image_url,
  ]);

  // provider profile enrichment
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

  const supplierName = firstNonEmpty(
    prov?.name, prov?.title, prov?.display_name, prov?.company_name, prov?.brand, flatName
  );
  const supplierPhone = firstNonEmpty(
    prov?.phone, prov?.phone_number, prov?.phoneNumber, prov?.tel, prov?.mobile,
    prov?.whatsapp, prov?.whatsApp, prov?.phones?.[0], prov?.contacts?.phone, prov?.contact_phone, flatPhone
  );
  const supplierTg = renderTelegram(firstNonEmpty(
    prov?.telegram, prov?.tg, prov?.telegram_username, prov?.telegram_link,
    prov?.contacts?.telegram, prov?.socials?.telegram,
    prov?.social, prov?.social_link, flatTg
  ));

  const rating = Number(svc.rating ?? item.rating ?? 0);
  const status = typeof statusRaw === "string" && statusRaw.toLowerCase() === "draft" ? null : statusRaw;
  const badge = rating > 0 ? `★ ${rating.toFixed(1)}` : status;

  const expireAt = resolveExpireAt(svc);
  const leftMs = expireAt ? Math.max(0, expireAt - now) : null;
  const hasTimer = !!expireAt;
  const timerText = hasTimer ? formatLeft(leftMs) : null;

  // reviews tooltip
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

   const activeFav =
   typeof isFav === "boolean"
     ? isFav
     : typeof favActive === "boolean"
       ? favActive
       : (favoriteIds ? favoriteIds.has(String(id)) : false);

  return (
    <div className={["group relative bg-white border rounded-xl overflow-hidden shadow-sm flex flex-col", className].join(" ")}>
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

        {/* top overlay */}
        <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none">
          <div className="flex items-center gap-2">
            {hasTimer && (
              <span
                className={`pointer-events-auto px-2 py-0.5 rounded-full text-white text-xs backdrop-blur-md ring-1 ring-white/20 shadow ${
                  leftMs > 0 ? "bg-orange-600/95" : "bg-gray-400/90"
                }`}
                title={leftMs > 0 ? (t("countdown.until_end") || "До окончания") : (t("countdown.expired") || "Время истекло")}
              >
                {timerText}
              </span>
            )}

            {!hasTimer && badge && (
              <span className="pointer-events-auto px-2 py-0.5 rounded-full text-white text-xs bg-black/50 backdrop-blur-md ring-1 ring-white/20">
                {badge}
              </span>
            )}

            {SHOW_REVIEWS && (
            <button
              ref={revBtnRef}
              className="pointer-events-auto p-1.5 rounded-full bg-black/30 hover:bg-black/40 text-white backdrop-blur-md ring-1 ring-white/20 relative"
              onMouseEnter={openReviews}
              onMouseLeave={closeReviews}
              title={t("marketplace.reviews") || "Отзывы об услуге"}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M21 15a4 4 0 0 1-4 4H8l-4 4V7a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4z" />
              </svg>
            </button>
            )}
          </div>

          {/* HEART */}
          <div className="pointer-events-auto">
            <WishHeart
              active={!!activeFav}
              onClick={() => onToggleFavorite?.(id)}
              size={36}
              titleAdd={t("favorites.add") || "Добавить в избранное"}
              titleRemove={t("favorites.remove_from") || "Удалить из избранного"}
            />
          </div>
        </div>

        {/* hover info overlay */}
        <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="absolute inset-x-0 bottom-0 p-3">
            <div className="rounded-lg bg-black/55 backdrop-blur-md text-white text-xs sm:text-sm p-3 ring-1 ring-white/15 shadow-lg">
              <div className="font-semibold line-clamp-2">{title}</div>
                            {/* Направление только для отказных авиабилетов */}
              {svc?.category === "refused_flight" && direction && (
                <div>
                  <span className="opacity-80">{t("common.direction") || "Направление"}: </span>
                  <span className="font-medium">{direction}</span>
                </div>
              )}
              {hotel && (
                <div>
                  <span className="opacity-80">Отель: </span>
                  <span className="font-medium">{hotel}</span>
                </div>
              )}
              {accommodation && (
                <div>
                  <span className="opacity-80">Размещение: </span>
                  <span className="font-medium">{accommodation}</span>
                </div>
              )}
              {dates && (
                <div>
                  <span className="opacity-80">{t("common.date") || "Дата"}: </span>
                  <span className="font-medium">{dates}</span>
                </div>
              )}
              {prettyPrice && (
                <div>
                  <span className="opacity-80">{t("marketplace.price") || "Цена"}: </span>
                  <span className="font-semibold">{prettyPrice}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* reviews tooltip portal */}
      {SHOW_REVIEWS && (
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
                  <li key={r.id} className="line-clamp-2 opacity-90">
                    {r.text || ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </TooltipPortal>
      )}
      {/* BODY */}
      <div className="p-3 flex-1 flex flex-col">
        <div className="font-semibold line-clamp-2">{title}</div>
        {prettyPrice && (
          <div className="mt-1 text-sm">
            {t("marketplace.price") || "Цена"}: <span className="font-semibold">{prettyPrice}</span>
          </div>
        )}

        {(supplierName || supplierPhone || supplierTg?.label) && (
          <div className="mt-2 text-sm space-y-0.5">
            {supplierName && (
              <div>
                <span className="text-gray-500">
                  {t("marketplace.supplier") || "Поставщик"}:{" "}
                </span>
            
                {providerId ? (
                  <a
                    href={`/profile/provider/${providerId}`}
                    className="underline hover:text-gray-900"
                    onClick={(e) => e.stopPropagation()} // чтобы клик по ссылке не триггерил клики карточки
                  >
                    {supplierName}
                  </a>
                ) : (
                  <span className="font-medium">{supplierName}</span>
                )}
              </div>
            )}

            {supplierPhone && (
              <div>
                <span className="text-gray-500">{t("marketplace.phone") || "Телефон"}: </span>
                <a href={`tel:${String(supplierPhone).replace(/\s+/g, "")}`} className="underline">
                  {supplierPhone}
                </a>
              </div>
            )}
            {supplierTg?.label && (
              <div>
                <span className="text-gray-500">{t("marketplace.telegram") || "Телеграм"}: </span>
                {supplierTg.href ? (
                  <a href={supplierTg.href} target="_blank" rel="noopener noreferrer" className="underline">
                    {supplierTg.label}
                  </a>
                ) : (
                  <span className="font-medium">{supplierTg.label}</span>
                )}
              </div>
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
