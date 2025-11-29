// frontend/src/components/ServiceCard.jsx
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { apiGet } from "../api";
import WishHeart from "./WishHeart";
const SHOW_REVIEWS = false;

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
    try {
      return JSON.parse(x);
    } catch {
      return null;
    }
  }
  return null;
};
const mergeDetails = (svc, it) => {
  const parts = [
    svc?.details,
    it?.details,
    svc?.detail,
    it?.detail,
    svc?.meta,
    svc?.params,
    svc?.payload,
    svc?.extra,
    svc?.data,
    svc?.info,
  ]
    .map(maybeParse)
    .filter(Boolean);
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
    return firstImageFrom(
      val.url ?? val.src ?? val.href ?? val.link ?? val.path ?? val.data ?? val.base64
    );
  }
  return null;
};

/** Собрать массив изображений из разных мест, убрать дубли */
const collectImages = (...vals) => {
  const out = [];
  const push = (v) => {
    const r = firstImageFrom(v);
    if (r && !out.includes(r)) out.push(r);
  };
  for (const val of vals) {
    if (!val) continue;
    if (typeof val === "string" || (typeof val === "object" && !Array.isArray(val))) {
      push(val);
    } else if (Array.isArray(val)) {
      for (const it of val) push(it);
    }
  }
  return out;
};

/* Тип провайдера/категории: гид/транспорт? */
const isGuideOrTransport = (raw) => {
  if (raw == null) return false;
  const s = String(raw).trim().toLowerCase();
  if (s === "guide" || s === "transport") return true;
  return /(гид|экскур|трансфер|transport|driver|taxi|car|bus|авто|транспорт)/i.test(s);
};

// --- expiry helpers ---
function resolveExpireAt(svc, details) {
  const s = svc || {};
  const d = details || {};
  const cand =
    s.expires_at ??
    s.expire_at ??
    s.expireAt ??
    d.expires_at ??
    d.expire_at ??
    d.expiresAt ??
    d.expiration ??
    d.expiration_at ??
    d.expirationAt ??
    d.expiration_ts ??
    d.expirationTs;
  let ts = null;
  if (cand != null) {
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
function formatLeft(ms, dayLabel = "d") {
  if (ms <= 0) return "00:00:00";
  const total = Math.floor(ms / 1000);
  const dd = Math.floor(total / 86400);
  const hh = Math.floor((total % 86400) / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return dd > 0
    ? `${dd}${dayLabel} ${pad(hh)}:${pad(mm)}`
    : `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

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
      const obj =
        (res && (res.data || res.item || res.profile || res.provider || res.company)) ||
        res;
      if (obj && (obj.id || obj.name || obj.title)) {
        profile = obj;
        break;
      }
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

/* ======== всплывающее окно с деталями тура (за карточкой) ======== */
function DetailsPopup({ open, anchorRef, onClose, children }) {
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!open || !anchorRef?.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const margin = 12;
    const width = 320;
    const x = Math.min(r.left, window.innerWidth - width - margin);
    const y = Math.max(margin, r.bottom + 4);
    setPos({ x, y });
  }, [open, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[2600]"
      onClick={() => {
        onClose?.();
      }}
    >
      <div
        className="absolute pointer-events-auto"
        style={{ top: pos.y, left: pos.x }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-[320px] max-w-[95vw] rounded-2xl bg-white shadow-2xl border border-gray-200 p-3 text-xs sm:text-sm">
          {children}
        </div>
      </div>
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
    svc.title,
    svc.name,
    details?.title,
    details?.name,
    details?.eventName,
    item?.title,
    item?.name
  );

  const rawPrice =
    viewerRole === "provider"
      ? firstNonEmpty(
          details?.netPrice,
          details?.price,
          details?.totalPrice,
          details?.priceNet,
          svc.netPrice,
          svc.price,
          item?.price,
          details?.grossPrice
        )
      : firstNonEmpty(
          details?.grossPrice,
          details?.priceGross,
          details?.totalPrice,
          svc.grossPrice,
          svc.price_gross,
          details?.netPrice,
          details?.price,
          svc.netPrice,
          svc.price
        );

  const prettyPrice =
    rawPrice == null ? null : new Intl.NumberFormat().format(Number(rawPrice));

  const hotel = firstNonEmpty(
    details?.hotel,
    details?.hotelName,
    details?.hotel?.name,
    details?.refused_hotel_name,
    svc.hotel,
    svc.hotel_name,
    svc.refused_hotel_name
  );
  const accommodation = firstNonEmpty(
    details?.accommodation,
    details?.accommodationCategory,
    details?.room,
    details?.roomType,
    details?.room_category,
    svc.accommodation,
    svc.room,
    svc.room_type
  );

  const transfer = firstNonEmpty(
    details?.transfer,
    details?.transferType,
    details?.transfer_type,
    svc.transfer,
    svc.transfer_type
  );

  const left = firstNonEmpty(
    bag.hotel_check_in,
    bag.checkIn,
    bag.startDate,
    bag.start_flight_date,
    bag.startFlightDate,
    bag.departureFlightDate
  );
  const right = firstNonEmpty(
    bag.hotel_check_out,
    bag.checkOut,
    bag.returnDate,
    bag.end_flight_date,
    bag.endFlightDate,
    bag.returnFlightDate
  );
  const dates = left && right ? `${left} → ${right}` : left || right || null;

  const dirFrom = firstNonEmpty(
    details?.directionFrom,
    details?.from,
    details?.cityFrom,
    details?.origin,
    details?.departureCity,
    svc.directionFrom,
    svc.from,
    svc.cityFrom,
    svc.origin,
    svc.departureCity,
    item.directionFrom,
    item.from,
    item.cityFrom,
    item.origin
  );
  const dirTo = firstNonEmpty(
    details?.directionTo,
    details?.to,
    details?.cityTo,
    details?.destination,
    details?.arrivalCity,
    svc.directionTo,
    svc.to,
    svc.cityTo,
    svc.destination,
    svc.arrivalCity,
    item.directionTo,
    item.to,
    item.cityTo,
    item.destination
  );
  const direction = dirFrom && dirTo ? `${dirFrom} → ${dirTo}` : null;

  const inlineProvider =
    firstNonEmpty(
      svc.provider,
      svc.provider_profile,
      svc.supplier,
      svc.vendor,
      svc.agency,
      svc.owner,
      item.provider,
      item.provider_profile,
      item.supplier,
      item.vendor,
      item.agency,
      item.owner,
      details?.provider
    ) || {};

  const providerId = firstNonEmpty(
    svc.provider_id,
    svc.providerId,
    item.provider_id,
    item.providerId,
    details?.provider_id,
    svc.owner_id,
    svc.agency_id,
    inlineProvider?.id,
    inlineProvider?._id
  );

  const flatName = firstNonEmpty(
    bag.provider_name,
    bag.supplier_name,
    bag.vendor_name,
    bag.agency_name,
    bag.company_name,
    bag.providerTitle,
    bag.display_name
  );
  const flatPhone = firstNonEmpty(
    bag.provider_phone,
    bag.supplier_phone,
    bag.vendor_phone,
    bag.agency_phone,
    bag.company_phone,
    bag.contact_phone,
    bag.phone,
    bag.whatsapp,
    bag.whats_app
  );
  const flatTg = firstNonEmpty(
    bag.provider_telegram,
    bag.supplier_telegram,
    bag.vendor_telegram,
    bag.agency_telegram,
    bag.company_telegram,
    bag.telegram,
    bag.tg,
    bag.telegram_username,
    bag.telegram_link,
    bag.provider_social,
    bag.supplier_social,
    bag.vendor_social,
    bag.agency_social,
    bag.company_social,
    bag.social,
    bag.social_link
  );

  const status = firstNonEmpty(svc.status, item.status, details?.status);

  const flightDetails = firstNonEmpty(
    details?.flightDetails,
    details?.flight_details,
    details?.flight_info,
    Array.isArray(details?.flights) ? details.flights.join("\n") : null
  );

  return {
    svc,
    details,
    title,
    hotel,
    accommodation,
    transfer,
    dates,
    direction,
    prettyPrice,
    inlineProvider,
    providerId,
    flatName,
    flatPhone,
    flatTg,
    status,
    flightDetails,
  };
}

/* ============== the card ============== */
export default function ServiceCard({
  item,
  viewerRole = null,
  favoriteIds,
  isFav,
  favActive,
  onToggleFavorite,
  onQuickRequest,
  now = Date.now(),
  className = "",
}) {
  const { t } = useTranslation();

  const {
    svc,
    title,
    hotel,
    accommodation,
    transfer,
    dates,
    direction,
    prettyPrice,
    inlineProvider,
    providerId,
    flatName,
    flatPhone,
    flatTg,
    status: statusRaw,
    details,
    flightDetails,
  } = extractServiceFields(item, viewerRole);

  /* таймер */
  const expireAt = resolveExpireAt(svc, details);
  const leftMs = expireAt ? expireAt - now : null;
  const isExpired = expireAt && leftMs <= 0;
  const dayShort = t("countdown.days_short", { defaultValue: "d" });

  const id = svc.id ?? item.id;

  /* изображения */
  const images = collectImages(
    svc.images,
    details?.images,
    item?.images,
    svc.gallery,
    details?.gallery,
    item?.gallery,
    svc.photos,
    details?.photos,
    item?.photos,
    svc.cover,
    svc.image,
    details?.cover,
    details?.image,
    item?.cover,
    item?.image,
    details?.photo,
    details?.picture,
    details?.imageUrl,
    svc.image_url,
    item?.image_url
  );
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    setIdx(0);
  }, [id]);
  useEffect(() => {
    if (idx >= images.length) setIdx(0);
  }, [images.length]);

  const go = (n) => {
    if (!images.length) return;
    setIdx((p) => (p + n + images.length) % images.length);
  };
  const prev = () => go(-1);
  const next = () => go(+1);

  const onImgError = () => {
    if (!images.length) return;
    setIdx((p) => (p + 1) % images.length);
  };

  // свайп
  const touch = useRef({ x: 0, y: 0, active: false });
  const onTouchStart = (e) => {
    const t = e.touches?.[0];
    if (!t) return;
    touch.current = { x: t.clientX, y: t.clientY, active: true };
  };
  const onTouchEnd = (e) => {
    if (!touch.current.active) return;
    const t = e.changedTouches?.[0];
    if (!t) return;
    const dx = t.clientX - touch.current.x;
    const dy = t.clientY - touch.current.y;
    touch.current.active = false;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) next();
      else prev();
    }
  };

  // provider profile
  const [provider, setProvider] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!providerId) return;
      const p = await fetchProviderProfile(providerId);
      if (alive) setProvider(p);
    })();
    return () => {
      alive = false;
    };
  }, [providerId]);
  const prov = { ...(inlineProvider || {}), ...(provider || {}) };

  const supplierName = firstNonEmpty(
    prov?.name,
    prov?.title,
    prov?.display_name,
    prov?.company_name,
    prov?.brand,
    flatName
  );
  const supplierPhone = firstNonEmpty(
    prov?.phone,
    prov?.phone_number,
    prov?.phoneNumber,
    prov?.tel,
    prov?.mobile,
    prov?.whatsapp,
    prov?.whatsApp,
    prov?.phones?.[0],
    prov?.contacts?.phone,
    prov?.contact_phone,
    flatPhone
  );
  const supplierTg = (() => {
    const value = firstNonEmpty(
      prov?.telegram,
      prov?.tg,
      prov?.telegram_username,
      prov?.telegram_link,
      prov?.contacts?.telegram,
      prov?.socials?.telegram,
      prov?.social,
      prov?.social_link,
      flatTg
    );
    if (!value) return null;
    const s = String(value).trim();
    if (/^https?:\/\//i.test(s)) return { href: s, label: s };
    if (s.startsWith("@")) return { href: `https://t.me/${s.slice(1)}`, label: s };
    if (/^[A-Za-z0-9_]+$/.test(s)) return { href: `https://t.me/${s}`, label: `@${s}` };
    return { href: null, label: s };
  })();

  const rating = Number(svc.rating ?? item.rating ?? 0);
  const statusLower = typeof statusRaw === "string" ? statusRaw.toLowerCase() : null;
  const statusForBadge =
    statusLower === "draft" || statusLower === "published" ? null : statusRaw;
  const badge = rating > 0 ? `★ ${rating.toFixed(1)}` : statusForBadge;

  // бронь vs быстрый запрос
  const serviceLooksBookable = isGuideOrTransport(
    svc.category || details?.category || item?.category
  );
  const providerLooksBookable = isGuideOrTransport(
    prov?.type || prov?.provider_type || prov?.category
  );
  const showBookButton = !!providerId && (providerLooksBookable || serviceLooksBookable);

  // tooltip reviews (выключено)
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
      const data = (res && typeof res === "object" ? res : {}) || {};
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
      : favoriteIds
      ? favoriteIds.has(String(id))
      : false;

  // popup деталей тура
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsBtnRef = useRef(null);

  const hasDetailsBlock =
    direction || dates || hotel || accommodation || transfer || flightDetails;

  return (
    <>
      <div
        className={[
          "group relative bg-white border rounded-xl overflow-hidden shadow-sm flex flex-col",
          className,
        ].join(" ")}
      >
        {/* IMAGES */}
        <div
          className="aspect-[16/10] bg-gray-100 relative select-none"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {images.length ? (
            <>
              <img
                key={images[idx]}
                src={images[idx]}
                alt={title || t("marketplace.no_image")}
                className="w-full h-full object-cover"
                onError={onImgError}
                draggable={false}
              />

              {images.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label="Previous"
                    onClick={(e) => {
                      e.stopPropagation();
                      prev();
                    }}
                    className="absolute left-2 top-1/2 -translate-y-1/2 z-30 hidden sm:inline-flex items-center justify-center w-9 h-9 rounded-full bg-black/40 hover:bg-black/55 text-white ring-1 ring-white/20"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    aria-label="Next"
                    onClick={(e) => {
                      e.stopPropagation();
                      next();
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 z-30 hidden sm:inline-flex items-center justify-center w-9 h-9 rounded-full bg-black/40 hover:bg-black/55 text-white ring-1 ring-white/20"
                  >
                    ›
                  </button>
                </>
              )}

              {images.length > 1 && (
                <div className="absolute bottom-2 left-0 right-0 z-30 flex items-center justify-center gap-1.5">
                  {images.map((src, i) => (
                    <button
                      key={src + i}
                      onClick={(e) => {
                        e.stopPropagation();
                        setIdx(i);
                      }}
                      className={[
                        "relative w-2.5 h-2.5 rounded-full ring-1 ring-white/40 transition-opacity",
                        i === idx
                          ? "bg-white/95 opacity-100"
                          : "bg-white/60 opacity-60 hover:opacity-90",
                      ].join(" ")}
                      title={`${i + 1}/${images.length}`}
                      onMouseEnter={(e) => {
                        const preview = e.currentTarget.querySelector("img");
                        if (preview) preview.style.opacity = "1";
                      }}
                      onMouseLeave={(e) => {
                        const preview = e.currentTarget.querySelector("img");
                        if (preview) preview.style.opacity = "0";
                      }}
                    >
                      <img
                        src={src}
                        alt=""
                        className="pointer-events-none opacity-0 transition-opacity duration-150 hidden md:block absolute -top-16 left-1/2 -translate-x-1/2 w-20 h-12 object-cover rounded-md ring-1 ring-white/30 shadow-lg"
                      />
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400">
              <span className="text-sm">
                {t("marketplace.no_image") || "Нет изображения"}
              </span>
            </div>
          )}

          {/* top overlay: таймер + бейдж + избранное */}
          <div className="absolute top-2 left-2 right-2 z-20 flex items-center justify-between pointer-events-none">
            <div className="flex items-center gap-2">
              {expireAt &&
                (isExpired ? (
                  <span className="pointer-events-auto px-2 py-0.5 rounded-full text-white text-xs bg-black/50 backdrop-blur-md ring-1 ring-white/20">
                    {t("countdown.expired", { defaultValue: "Expired" })}
                  </span>
                ) : (
                  <span
                    className="pointer-events-auto px-2 py-0.5 rounded-full text-white text-xs bg-black/50 backdrop-blur-md ring-1 ring-white/20"
                    title={t("countdown.until_end", { defaultValue: "Time left" })}
                  >
                    ⏳ {formatLeft(leftMs, dayShort)}
                  </span>
                ))}
              {badge && (
                <span className="pointer-events-auto px-2 py-0.5 rounded-full text-white text-xs bg-black/50 backdrop-blur-md ring-1 ring-white/20">
                  {badge}
                </span>
              )}
            </div>

            <div className="pointer-events-auto">
              <WishHeart
                active={activeFav}
                onClick={() => onToggleFavorite?.(id)}
                size={36}
                titleAdd={t("favorites.add") || "Добавить в избранное"}
                titleRemove={t("favorites.remove_from") || "Удалить из избранного"}
              />
            </div>
          </div>
        </div>

        {/* reviews tooltip (если включим) */}
        {SHOW_REVIEWS && (
          <TooltipPortal visible={revOpen} x={revPos.x} y={revPos.y}>
            <div className="pointer-events-none max-w-xs rounded-lg bg-black/85 text-white text-xs p-3 shadow-2xl ring-1 ring-white/10">
              <div className="mb-1 font-semibold">
                {t("marketplace.reviews") || "Отзывы об услуге"}
              </div>
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
          {/* заголовок */}
          <div className="font-semibold line-clamp-2">{title}</div>

          {/* коротко: направление + дата одной строкой, чтобы не растягивать карточку */}
          {direction && (
            <div className="mt-1 text-xs text-gray-700">{direction}</div>
          )}
          {dates && (
            <div className="text-xs text-gray-500">
              {t("common.date") || "Дата"}: {dates}
            </div>
          )}

          {/* цена */}
          {prettyPrice && (
            <div className="mt-1 text-sm">
              {t("marketplace.price") || "Цена"}:{" "}
              <span className="font-semibold">{prettyPrice}</span>
            </div>
          )}

          {/* поставщик / контакты */}
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
                      onClick={(e) => e.stopPropagation()}
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
                  <span className="text-gray-500">
                    {t("marketplace.phone") || "Телефон"}:{" "}
                  </span>
                  <a
                    href={`tel:${String(supplierPhone).replace(/\s+/g, "")}`}
                    className="underline"
                  >
                    {supplierPhone}
                  </a>
                </div>
              )}

              {supplierTg?.label && (
                <div>
                  <span className="text-gray-500">
                    {t("marketplace.telegram") || "Телеграм"}:{" "}
                  </span>
                  {supplierTg.href ? (
                    <a
                      href={supplierTg.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      {supplierTg.label}
                    </a>
                  ) : (
                    <span className="font-medium">{supplierTg.label}</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ссылка на всплывающее окно с подробностями тура */}
          {hasDetailsBlock && (
            <button
              ref={detailsBtnRef}
              type="button"
              className="mt-2 text-xs font-semibold text-orange-600 underline underline-offset-2 hover:text-orange-700"
              onClick={(e) => {
                e.stopPropagation();
                setDetailsOpen(true);
              }}
            >
              {t("marketplace.more_details") || "Подробнее о туре"}
            </button>
          )}

          {/* кнопка действия */}
          <div className="mt-auto pt-3">
            {showBookButton ? (
              <a
                href={`/profile/provider/${providerId}?service=${id}#book`}
                className="w-full inline-flex items-center justify-center bg-orange-500 text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-orange-600"
                onClick={(e) => e.stopPropagation()}
              >
                {t("actions.book") || "Бронировать"}
              </a>
            ) : (
              <button
                onClick={() => onQuickRequest?.(id, providerId, title)}
                className="w-full bg-orange-500 text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-orange-600"
              >
                {t("actions.quick_request") || "Быстрый запрос"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* POPUP с подробной информацией о туре (за карточкой) */}
      <DetailsPopup
        open={detailsOpen}
        anchorRef={detailsBtnRef}
        onClose={() => setDetailsOpen(false)}
      >
        <div className="font-semibold mb-1">
          {t("marketplace.tour_details") || "Детали тура"}
        </div>

        {direction && (
          <div className="text-xs sm:text-sm mb-1">
            <span className="text-gray-500">
              {t("marketplace.route", { defaultValue: "Маршрут" })}:{" "}
            </span>
            <span className="font-medium">{direction}</span>
          </div>
        )}
        {dates && (
          <div className="text-xs sm:text-sm mb-1">
            <span className="text-gray-500">
              {t("common.date") || "Дата"}:{" "}
            </span>
            <span className="font-medium">{dates}</span>
          </div>
        )}
        {hotel && (
          <div className="text-xs sm:text-sm mb-1">
            <span className="text-gray-500">
              {t("marketplace.hotel_label", { defaultValue: "Отель" })}:{" "}
            </span>
            <span className="font-medium">{hotel}</span>
          </div>
        )}
        {accommodation && (
          <div className="text-xs sm:text-sm mb-1">
            <span className="text-gray-500">
              {t("marketplace.accommodation", { defaultValue: "Размещение" })}:{" "}
            </span>
            <span className="font-medium">{accommodation}</span>
          </div>
        )}
        {transfer && (
          <div className="text-xs sm:text-sm mb-1">
            <span className="text-gray-500">
              {t("marketplace.transfer", { defaultValue: "Трансфер" })}:{" "}
            </span>
            <span className="font-medium">{transfer}</span>
          </div>
        )}
        {prettyPrice && (
          <div className="text-xs sm:text-sm mb-2">
            <span className="text-gray-500">
              {t("marketplace.price") || "Цена"}:{" "}
            </span>
            <span className="font-semibold">{prettyPrice}</span>
          </div>
        )}

        {flightDetails && (
          <div className="mt-2 text-xs sm:text-sm text-gray-800 bg-gray-50 rounded-lg p-2 whitespace-pre-wrap leading-snug">
            <div className="font-semibold mb-1">
              {t("marketplace.flight_details", {
                defaultValue: "Детали рейса",
              })}
            </div>
            {String(flightDetails || "").replace(/\r\n/g, "\n")}
          </div>
        )}
      </DetailsPopup>
    </>
  );
}
