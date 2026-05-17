// frontend/src/components/ServiceCard.jsx
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../api";
import { tSuccess } from "../shared/toast";
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

/* стикер на карточку - "отказной" */
const getMarketplaceSticker = (rawCategory, t) => {
  const category = String(rawCategory || "").trim().toLowerCase();

  switch (category) {
    case "refused_tour":
      return {
        label: t("marketplace.stickers.refused_tour", {
          defaultValue: "ОТКАЗНОЙ ТУР",
        }),
        className:
          "bg-amber-500/95 text-white ring-1 ring-white/20",
      };

    case "refused_hotel":
      return {
        label: t("marketplace.stickers.refused_hotel", {
          defaultValue: "ОТКАЗНОЙ ОТЕЛЬ",
        }),
        className:
          "bg-sky-600/95 text-white ring-1 ring-white/20",
      };

    case "refused_flight":
      return {
        label: t("marketplace.stickers.refused_flight", {
          defaultValue: "ОТКАЗНОЙ АВИАБИЛЕТ",
        }),
        className:
          "bg-violet-600/95 text-white ring-1 ring-white/20",
      };

    case "refused_ticket":
      return {
        label: t("marketplace.stickers.refused_ticket", {
          defaultValue: "ОТКАЗНОЙ БИЛЕТ",
        }),
        className:
          "bg-emerald-600/95 text-white ring-1 ring-white/20",
      };

    default:
      return null;
  }
};
// --- expiry helpers ---
function resolveExpireAt(svc, details) {
  const s = svc || {};
  const d = details || {};
  const cand =
    s.expiration_at ??
    s.expirationAt ??
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

async function fetchProviderProfile(providerId, serviceId) {
  if (!providerId) return null;

  const cacheKey = `${providerId}:${serviceId || ""}`;
  if (providerCache.has(cacheKey)) return providerCache.get(cacheKey);

  const endpoints = [
    `/api/providers/${providerId}${serviceId ? `?serviceId=${serviceId}` : ""}`,
    `/api/provider/${providerId}${serviceId ? `?serviceId=${serviceId}` : ""}`,
    `/api/suppliers/${providerId}${serviceId ? `?serviceId=${serviceId}` : ""}`,
    `/api/supplier/${providerId}${serviceId ? `?serviceId=${serviceId}` : ""}`,
    `/api/agencies/${providerId}${serviceId ? `?serviceId=${serviceId}` : ""}`,
    `/api/agency/${providerId}${serviceId ? `?serviceId=${serviceId}` : ""}`,
    `/api/companies/${providerId}${serviceId ? `?serviceId=${serviceId}` : ""}`,
    `/api/company/${providerId}${serviceId ? `?serviceId=${serviceId}` : ""}`,
    `/api/users/${providerId}${serviceId ? `?serviceId=${serviceId}` : ""}`,
    `/api/user/${providerId}${serviceId ? `?serviceId=${serviceId}` : ""}`,
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

  providerCache.set(cacheKey, profile || null);
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

/* ======== premium popup с деталями тура / mobile sheet ======== */
function DetailsPopup({ open, onClose, children }) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[2600] flex items-end justify-center bg-slate-950/55 px-0 pt-8 backdrop-blur-sm sm:items-center sm:px-4 sm:py-8"
      onClick={() => onClose?.()}
    >
      <div
        className="relative flex max-h-[92vh] w-full max-w-[760px] flex-col overflow-hidden rounded-t-[2rem] border border-white/40 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.30)] sm:max-h-[88vh] sm:rounded-[2rem]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => onClose?.()}
          className="absolute right-3 top-3 z-30 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/35 text-lg font-black text-white shadow-lg ring-1 ring-white/20 backdrop-blur-md transition hover:bg-black/50"
          aria-label="Close"
        >
          ×
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ============== field extractor ============== */
function extractServiceFields(item, viewerRole, t) {
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
  bag.endDate,
  bag.end_flight_date,
  bag.endFlightDate,
  bag.returnFlightDate,
  bag.returnDate
);

function formatDateShort(value) {
  if (!value) return null;

  const s = String(value).trim();

  // если строка уже формата YYYY-MM-DD
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    return `${m[3]}.${m[2]}`;
  }

  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return s;

  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}`;
}

function parseDateOnly(value) {
  if (!value) return null;

  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return null;

  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

const leftDate = parseDateOnly(left);
const rightDate = parseDateOnly(right);

const nightsCount =
  leftDate && rightDate
    ? Math.max(
        0,
        Math.round((rightDate.getTime() - leftDate.getTime()) / 86400000) - 1
      )
    : null;

const dates =
  left && right
    ? `${formatDateShort(left)} - ${formatDateShort(right)}${
        nightsCount > 0
          ? ` • ${nightsCount} ${t("marketplace.nights_short", { defaultValue: "ноч." })}`
          : ""
      }`
    : left
    ? formatDateShort(left)
    : right
    ? formatDateShort(right)
    : null;

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
    insuranceIncluded: details?.insuranceIncluded,
    earlyCheckIn: details?.earlyCheckIn,
    arrivalFastTrack: details?.arrivalFastTrack,
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
  const navigate = useNavigate();

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
  } = extractServiceFields(item, viewerRole, t);

  const isProviderViewer = viewerRole === "provider";
  const isAdminViewer = viewerRole === "admin";

  /* таймер */
  const expireAt = resolveExpireAt(svc, details);
  const leftMs = expireAt ? expireAt - now : null;
  const isExpired = expireAt && leftMs <= 0;
  const dayShort = t("countdown.days_short", { defaultValue: "d" });

  const id = svc.id ?? item.id;

  // provider profile
  const [provider, setProvider] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!providerId) return;
      const p = await fetchProviderProfile(providerId, id);
      if (alive) setProvider(p);
    })();
    return () => {
      alive = false;
    };
  }, [providerId, id]);
  const prov = { ...(inlineProvider || {}), ...(provider || {}) };

  const unlockStorageKey = id ? `marketplace:unlocked:${id}` : null;
  const unlockedFromStorage =
    typeof window !== "undefined" &&
    unlockStorageKey &&
    window.localStorage.getItem(unlockStorageKey) === "1";

  const initialUnlocked =
    viewerRole === "provider" ||
    viewerRole === "admin" ||
    unlockedFromStorage ||
    [
      svc?.unlocked,
      item?.unlocked,
      item?.service?.unlocked,
      item?.is_unlocked,
      item?.service?.is_unlocked,
      svc?.contacts_unlocked,
      item?.contacts_unlocked,
      item?.service?.contacts_unlocked,
      provider?.contacts_unlocked,
    ].some((v) => v === true);

  const [unlocked, setUnlocked] = useState(initialUnlocked);
  const [unlockLoading, setUnlockLoading] = useState(false);

  useEffect(() => {
    const localUnlocked =
      typeof window !== "undefined" &&
      unlockStorageKey &&
      window.localStorage.getItem(unlockStorageKey) === "1";

    setUnlocked(
      Boolean(
        localUnlocked ||
          [
            svc?.unlocked,
            item?.unlocked,
            item?.service?.unlocked,
            item?.is_unlocked,
            item?.service?.is_unlocked,
            svc?.contacts_unlocked,
            item?.contacts_unlocked,
            item?.service?.contacts_unlocked,
            provider?.contacts_unlocked,
          ].some((v) => v === true) ||
          viewerRole === "provider" ||
          viewerRole === "admin"
      )
    );
  }, [
    id,
    unlockStorageKey,
    viewerRole,
    svc?.unlocked,
    svc?.contacts_unlocked,
    item?.unlocked,
    item?.contacts_unlocked,
    item?.is_unlocked,
    item?.service?.unlocked,
    item?.service?.is_unlocked,
    item?.service?.contacts_unlocked,
    provider?.contacts_unlocked,
  ]);

  /* изображения услуги */
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

  /* proof-изображения отдельно */
  const proofImages = collectImages(
    details?.proofImages,
    details?.proof_images,
    svc?.proofImages,
    svc?.proof_images,
    item?.proofImages,
    item?.proof_images
  );
  const hasProof = proofImages.length > 0;
  const canViewProof = hasProof && (isProviderViewer || isAdminViewer || unlocked);
  const showProofBadgeOnly = hasProof && !canViewProof;

  const [idx, setIdx] = useState(0);
  const [selectedProofImage, setSelectedProofImage] = useState(null);

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

  const categorySticker = getMarketplaceSticker(
    svc.category || details?.category || item?.category,
    t
  );
  
  // бронь vs быстрый запрос
  const serviceLooksBookable = isGuideOrTransport(
    svc.category || details?.category || item?.category
  );
  const providerLooksBookable = isGuideOrTransport(
    prov?.type || prov?.provider_type || prov?.category
  );
  const showBookButton = !!providerId && (providerLooksBookable || serviceLooksBookable);

  const isClientViewer = viewerRole === "client";
  const hasUnlockTarget = Boolean(providerId && id);

  const canShowUnlockButton =
    !unlocked &&
    !isProviderViewer &&
    !isAdminViewer &&
    hasUnlockTarget;

  const canShowContacts =
    isProviderViewer ||
    isAdminViewer ||
    unlocked;

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

// highlight after return from payment
const cardRef = useRef(null);
const [highlighted, setHighlighted] = useState(false);

// modals
const [showBalancePrompt, setShowBalancePrompt] = useState(false);
const [showLoginModal, setShowLoginModal] = useState(false);
const [unlockPayModal, setUnlockPayModal] = useState({
  open: false,
  shortfallSum: 0,
  shortfallTiyin: 0,
  payUrl: "",
  orderId: null,
  serviceId: null,
});
const [showUnlockIntroModal, setShowUnlockIntroModal] = useState(false);
const [unlockIntroPriceSum, setUnlockIntroPriceSum] = useState(null);
const [unlockIntroLoading, setUnlockIntroLoading] = useState(false);
const hasDetailsBlock =
  direction ||
  dates ||
  hotel ||
  accommodation ||
  transfer ||
  flightDetails ||
  hasProof ||
  details.insuranceIncluded ||
  details.earlyCheckIn ||
  details.arrivalFastTrack;
  
const [showUnlockSuccessModal, setShowUnlockSuccessModal] = useState(false);
const [copiedPhone, setCopiedPhone] = useState(false);
const [copiedTelegram, setCopiedTelegram] = useState(false);
const [viewsCount, setViewsCount] = useState(0);
const [watchingNow, setWatchingNow] = useState(0);
const [unlocksCount, setUnlocksCount] = useState(0);
const postUnlockStep = async (step, meta = {}) => {
  try {
    const clientToken = localStorage.getItem("clientToken");
    if (!clientToken || !id) return;

    await apiPost(
      "/api/client/unlock-funnel-step",
      {
        service_id: id,
        step,
        meta,
      },
      "client"
    );
  } catch (err) {
    console.error("unlock funnel step error:", err);
  }
};

const closeUnlockPayModal = async () => {
  await postUnlockStep("unlock_pay_modal_closed");

  setUnlockPayModal({
    open: false,
    shortfallSum: 0,
    shortfallTiyin: 0,
    payUrl: "",
    orderId: null,
    serviceId: null,
  });
};

const copyTextSafe = async (text, type) => {
  try {
    await navigator.clipboard.writeText(text);

    if (type === "phone") {
      setCopiedPhone(true);
      setTimeout(() => setCopiedPhone(false), 1500);
    }

    if (type === "tg") {
      setCopiedTelegram(true);
      setTimeout(() => setCopiedTelegram(false), 1500);
    }
  } catch (e) {
    console.error("Copy failed", e);
  }
};

const normalizePhoneHref = (phone) => {
  if (!phone) return "";
  return `tel:${phone.replace(/\s+/g, "")}`;
};

const normalizeTelegramHref = (tg) => {
  if (!tg) return "";
  const clean = tg.replace("@", "");
  return `https://t.me/${clean}`;
};
  
useEffect(() => {
  const params = new URLSearchParams(window.location.search);

  const openedId = Number(params.get("opened"));
  const unlockSuccess = params.get("unlock") === "success";

  if (!openedId || Number(openedId) !== Number(id)) return;

  setHighlighted(true);

  // автоматически считаем карточку открытой
  setUnlocked(true);

  if (typeof window !== "undefined" && unlockStorageKey) {
    window.localStorage.setItem(unlockStorageKey, "1");
  }

  // success modal
  if (unlockSuccess) {
    setShowUnlockSuccessModal(true);
  }

  setTimeout(() => {
    cardRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, 150);

  const timer = setTimeout(() => {
    setHighlighted(false);
  }, 2500);

  return () => clearTimeout(timer);
}, [id, unlockStorageKey]);
  
useEffect(() => {
  if (!id) return;

  let cancelled = false;

  const storageKey = "travella:viewerKey";
  let viewerKey = "";
  try {
    viewerKey = localStorage.getItem(storageKey) || "";
    if (!viewerKey) {
      viewerKey =
        (typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `vk_${Math.random().toString(36).slice(2)}${Date.now()}`);
      localStorage.setItem(storageKey, viewerKey);
    }
  } catch {
    viewerKey = `vk_${Math.random().toString(36).slice(2)}${Date.now()}`;
  }
  
const registerView = async () => {
  try {
    await fetch(`/api/service-stats/${id}/view`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-viewer-key": viewerKey,
      },
      body: JSON.stringify({}),
    });
  } catch (err) {
    console.error("register view error:", err);
  }
};

  const loadStats = async () => {
    try {
      const res = await apiGet(`/api/service-stats/${id}`);
      const data = res?.data || res || {};
      if (cancelled) return;

      setViewsCount(Number(data.viewsLast24h || data.viewsCount || 0));
      setWatchingNow(Number(data.watchingNow || 0));
      setUnlocksCount(Number(data.unlocksLast24h || data.unlocksCount || 0));
    } catch (err) {
      console.error("load service stats error:", err);
    }
  };

  registerView();
  loadStats();

  const interval = setInterval(loadStats, 15000);

  return () => {
    cancelled = true;
    clearInterval(interval);
  };
}, [id]);

async function openUnlockIntro() {
  const clientToken = localStorage.getItem("clientToken");

  if (!clientToken) {
    setShowLoginModal(true);
    return;
  }

  if (!id) return;

  try {
    setUnlockIntroLoading(true);

    const res = await apiPost(
      "/api/client/unlock-auto",
      { service_id: id },
      "client"
    );

    if (
      res?.ok &&
      (res?.unlocked ||
        res?.already ||
        res?.already_unlocked ||
        res?.alreadyUnlocked)
    ) {
      if (typeof window !== "undefined" && unlockStorageKey) {
        window.localStorage.setItem(unlockStorageKey, "1");
      }

      setUnlocked(true);
      setShowUnlockSuccessModal(true);

      await postUnlockStep("unlock_success_modal_opened", {
        already: Boolean(
          res?.already || res?.already_unlocked || res?.alreadyUnlocked
        ),
      });

      window.dispatchEvent(new Event("client:balance:changed"));

      tSuccess(
        t("marketplace.contacts_unlocked_success", {
          defaultValue: "Контакты разблокированы",
        })
      );

      return;
    }

    const payUrl = String(res?.pay_url || res?.order?.pay_url || "").trim();

    if (res?.ok && payUrl) {
      const amountSum = Number(
        res?.shortfall_sum ||
          res?.amount_sum ||
          res?.order?.amount_sum ||
          0
      );

      const amountTiyin = Number(
        res?.shortfall_tiyin ||
          res?.amount_tiyin ||
          res?.order?.amount_tiyin ||
          0
      );

      const orderId = Number(res?.order_id || res?.order?.id || 0) || null;

      setUnlockIntroPriceSum(amountSum);

      setUnlockPayModal({
        open: true,
        shortfallSum: amountSum,
        shortfallTiyin: amountTiyin,
        payUrl,
        orderId,
        serviceId: Number(res?.service_id || id) || Number(id) || null,
      });

      await postUnlockStep("unlock_pay_modal_opened", {
        order_id: orderId,
        shortfall_sum: amountSum,
        pay_url_exists: true,
        requires_payment: Boolean(res?.requires_payment || res?.need_pay),
        reused: Boolean(res?.reused),
      });

      return;
    }

    throw new Error("unlock_failed");
  } catch (err) {
    const data = err?.response?.data || err?.data || {};
    const payUrl = String(data?.pay_url || data?.order?.pay_url || "").trim();

    if (payUrl) {
      const amountSum = Number(
        data?.shortfall_sum ||
          data?.amount_sum ||
          data?.order?.amount_sum ||
          0
      );

      setUnlockPayModal({
        open: true,
        shortfallSum: amountSum,
        shortfallTiyin: Number(
          data?.shortfall_tiyin ||
            data?.amount_tiyin ||
            data?.order?.amount_tiyin ||
            0
        ),
        payUrl,
        orderId: Number(data?.order_id || data?.order?.id || 0) || null,
        serviceId: Number(data?.service_id || id) || Number(id) || null,
      });

      return;
    }

    if (err?.response?.status === 401 || err?.response?.status === 403) {
      setShowLoginModal(true);
      return;
    }

    console.error("unlock intro error:", err);
    alert(
      t("marketplace.unlock_error", {
        defaultValue: "Не удалось открыть контакты",
      })
    );
  } finally {
    setUnlockIntroLoading(false);
  }
}
  
return (
    <>
      <div
        ref={cardRef}
        className={[
          "group relative overflow-hidden rounded-[1.65rem] border shadow-sm flex flex-col transition-all duration-500 ease-out hover:-translate-y-1 hover:shadow-[0_24px_55px_rgba(15,23,42,0.15)]",
          unlocked
            ? "bg-gray-50 border-gray-200 opacity-95"
            : "bg-white border-gray-100/90 hover:border-orange-100",
          highlighted ? "ring-2 ring-orange-400 shadow-[0_0_0_6px_rgba(251,146,60,0.16),0_24px_60px_rgba(249,115,22,0.30)] animate-[pulse_1.8s_ease-in-out_2]" : "",
          className,
        ].join(" ")}
        >
        {/* IMAGES */}
        <div
          className="h-44 sm:h-48 bg-gray-100 relative select-none overflow-hidden"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {images.length ? (
            <>
              <img
                key={images[idx]}
                src={images[idx]}
                alt={title || t("marketplace.no_image")}
                className="w-full h-full object-cover saturate-[1.04] contrast-[1.02] transition-transform duration-700 ease-out group-hover:scale-[1.045]"
                onError={onImgError}
                draggable={false}
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-black/5 to-black/10 opacity-45 transition-opacity duration-500 group-hover:opacity-65" />

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
            <div className="flex items-center gap-2 ml-0 sm:ml-0 flex-wrap">
              {categorySticker && (
                <span
                  className={[
                    "pointer-events-auto inline-flex items-center rounded-full px-2.5 py-1 text-[10px] sm:text-[11px] font-black uppercase tracking-[0.03em] shadow-[0_8px_18px_rgba(15,23,42,0.16)] backdrop-blur-md",
                    categorySticker.className,
                  ].join(" ")}
                >
                  {categorySticker.label}
                </span>
              )}
          
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
              {hasProof && (
                <span className="pointer-events-auto inline-flex items-center gap-1 rounded-full bg-emerald-600/90 text-white text-[11px] px-2 py-0.5 shadow-[0_8px_18px_rgba(5,150,105,0.22)] ring-1 ring-white/25 backdrop-blur-md">
                  ✔ {t("marketplace.verified_proof", { defaultValue: "Проверено" })}
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
        <div className="p-3.5 flex-1 flex flex-col bg-gradient-to-b from-white via-white to-gray-50/35">
          {/* Primary information */}
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[15px] sm:text-[16px] font-black leading-snug text-gray-950 line-clamp-2 tracking-[-0.01em]">
                  {title}
                </div>

                {(direction || dates) && (
                  <div className="mt-2.5 space-y-1.5">
                    {direction && (
                      <div className="flex items-center gap-1.5 text-[12px] font-bold leading-4 text-gray-700 line-clamp-1">
                        <span className="text-gray-400">✈️</span>
                        <span className="truncate">{direction}</span>
                      </div>
                    )}
                    {dates && (
                      <div className="inline-flex max-w-full items-center gap-1.5 rounded-xl bg-gray-950/5 px-2.5 py-1.5 text-[12px] font-black leading-4 text-gray-900 ring-1 ring-gray-200/70">
                        <span className="text-gray-500">🗓</span>
                        <span className="truncate">{dates}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {unlocked && isClientViewer && (
                <span className="shrink-0 inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 px-2.5 py-1 text-[11px] font-bold">
                  {t("marketplace.already_opened", { defaultValue: "Уже открыто" })}
                </span>
              )}
            </div>

            {(viewsCount > 0 || watchingNow > 0 || unlocksCount > 0) && (
              <div className="flex flex-wrap items-center gap-1.5 text-[10px] sm:text-[11px] text-gray-500">
                {viewsCount > 0 && (
                  <span
                    className="inline-flex max-w-full items-center rounded-full bg-gray-50 px-2 py-1 text-gray-600 ring-1 ring-gray-100"
                    title={t("marketplace.stats_views_tooltip", { defaultValue: "Просмотры этого тура за последние 24 часа" })}
                  >
                    <span className="mr-1">👁</span>
                    <span>{viewsCount}</span>
                  </span>
                )}

                {watchingNow > 0 && (
                  <span
                    className="inline-flex max-w-full items-center rounded-full bg-red-50 px-2 py-1 font-bold text-red-600 ring-1 ring-red-100 animate-[pulse_2.8s_ease-in-out_infinite]"
                    title={t("marketplace.stats_watching_tooltip", { defaultValue: "Пользователи, которые сейчас рассматривают этот тур" })}
                  >
                    <span className="mr-1">⚡</span>
                    <span className="truncate">
                      {watchingNow} {t("marketplace.watching_now_short", { defaultValue: "сейчас" })}
                    </span>
                  </span>
                )}

                {unlocksCount > 0 && (
                  <span
                    className="inline-flex max-w-full items-center rounded-full bg-emerald-50 px-2 py-1 font-semibold text-emerald-700 ring-1 ring-emerald-100"
                    title={t("marketplace.stats_unlocks_tooltip", { defaultValue: "Количество пользователей, которые уже открыли контакты поставщика" })}
                  >
                    <span className="mr-1">🔓</span>
                    <span className="truncate">
                      {unlocksCount} {t("marketplace.opened_contacts_count_short", { defaultValue: "открыли" })}
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Price as hero block */}
          {prettyPrice && (
            <div className="mt-2.5 rounded-[1.15rem] bg-[radial-gradient(circle_at_top_left,_rgba(251,146,60,0.15),_transparent_34%),linear-gradient(135deg,#080e1a,#111827)] px-3.5 py-2.5 text-white shadow-[0_14px_30px_rgba(15,23,42,0.19)] ring-1 ring-white/10">
              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/55">
                    {t("marketplace.price", { defaultValue: "Цена" })}
                  </div>
                  <div className="mt-1 flex items-end gap-2">
                    <div className="truncate text-[29px] sm:text-[32px] font-black leading-none tracking-[-0.035em] drop-shadow-sm">
                      {prettyPrice}
                    </div>
                    <div className="mb-1 text-[12px] font-bold text-orange-300">
                      {t("marketplace.price_currency", { defaultValue: "у.е." })}
                    </div>
                  </div>
                </div>

                {!isExpired && expireAt && (
                  <div className="shrink-0 rounded-full bg-orange-400/15 px-2.5 py-1 text-[11px] font-bold text-orange-200 ring-1 ring-orange-300/20">
                    {t("marketplace.hurry_up", { defaultValue: "Успейте" })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Included / value chips */}
          {(details.insuranceIncluded || details.earlyCheckIn || details.arrivalFastTrack) && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {details.insuranceIncluded && (
                <span className="inline-flex items-center rounded-full bg-emerald-50/70 text-emerald-700 ring-1 ring-emerald-100/80 px-2 py-0.5 text-[10px] font-bold">
                  🛡 {t("insurance_included", { defaultValue: "Страховка" })}
                </span>
              )}

              {details.earlyCheckIn && (
                <span className="inline-flex items-center rounded-full bg-blue-50/70 text-blue-700 ring-1 ring-blue-100/80 px-2 py-0.5 text-[10px] font-bold">
                  🏨 {t("early_check_in", { defaultValue: "Раннее заселение" })}
                </span>
              )}

              {details.arrivalFastTrack && (
                <span className="inline-flex items-center rounded-full bg-violet-50/70 text-violet-700 ring-1 ring-violet-100/80 px-2 py-0.5 text-[10px] font-bold">
                  🛬 {t("arrival_fast_track", { defaultValue: "Fast Track" })}
                </span>
              )}
            </div>
          )}

          {/* Proof signal: compact materials row */}
          {hasProof && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDetailsOpen(true);
              }}
              className="
                mt-2
                flex
                w-full
                items-center
                gap-2
                rounded-xl
                bg-emerald-50/45
                px-2
                py-1
                text-left
                text-emerald-800/85
                ring-1
                ring-emerald-100/60
                transition
                hover:bg-emerald-50
              "
            >
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-[11px] ring-1 ring-emerald-100">
                📄
              </span>
          
              <span
                className="truncate text-[11px] font-semibold text-emerald-700"
                title={
                  canViewProof
                    ? t(
                        "marketplace.details_proof_available_tooltip",
                        {
                          defaultValue:
                            "Материалы проверки доступны для просмотра",
                        }
                      )
                    : t(
                        "marketplace.details_proof_locked_tooltip",
                        {
                          defaultValue:
                            "Материалы проверки откроются после получения доступа",
                        }
                      )
                }
              >
                {canViewProof
                  ? t(
                      "marketplace.details_proof_available",
                      {
                        defaultValue:
                          "Материалы проверки доступны",
                      }
                    )
                  : t(
                      "marketplace.proof_after_unlock_short",
                      {
                        defaultValue:
                          "Материалы доступны после открытия",
                      }
                    )}
              </span>
            </button>
          )}

          {/* Contact / paywall area */}
          <div className="mt-auto pt-2.5 space-y-1.5">
            {(unlocked || isProviderViewer || isAdminViewer) &&
              (supplierName || supplierPhone || supplierTg?.label) && (
                <div className="space-y-1 border-t border-gray-100/80 pt-2">
                  {supplierName && (
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[10px] font-black uppercase tracking-wide text-gray-400">
                        {t("marketplace.supplier", { defaultValue: "Поставщик" })}
                      </div>

                      {providerId ? (
                        <a
                          href={`/profile/provider/${providerId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="min-w-0 max-w-[68%] truncate text-[12px] font-black text-gray-900 hover:underline"
                        >
                          {supplierName}
                        </a>
                      ) : (
                        <span className="min-w-0 max-w-[68%] truncate text-[12px] font-black text-gray-900">
                          {supplierName}
                        </span>
                      )}
                    </div>
                  )}

                  {unlocked ? (
                    <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                      {supplierPhone && (
                        <a
                          href={normalizePhoneHref(supplierPhone)}
                          onClick={(e) => {
                            e.stopPropagation();
                            postUnlockStep("unlock_phone_clicked", {
                              source: "card_contacts",
                              has_phone: true,
                              has_telegram: Boolean(supplierTg?.href),
                            });
                          }}
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-2.5 py-2 text-[12px] font-black text-white shadow-sm transition active:scale-[0.98] hover:bg-emerald-700"
                          title={supplierPhone}
                        >
                          <span>📞</span>
                          <span>{t("marketplace.call", { defaultValue: "Позвонить" })}</span>
                        </a>
                      )}

                      {supplierTg?.href && (
                        <a
                          href={supplierTg.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => {
                            e.stopPropagation();
                            postUnlockStep("unlock_telegram_clicked", {
                              source: "card_contacts",
                              has_phone: Boolean(supplierPhone),
                              has_telegram: true,
                            });
                          }}
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#229ED9] px-2.5 py-2 text-[12px] font-black text-white shadow-sm transition active:scale-[0.98] hover:bg-[#1d8ecf]"
                          title={
                            supplierTg.label ||
                            t("common.telegram", { defaultValue: "Telegram" })
                          }
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            width="16"
                            height="16"
                            className="shrink-0"
                            aria-hidden="true"
                          >
                            <circle cx="12" cy="12" r="12" fill="white" />
                            <path
                              fill="#229ED9"
                              d="M17.52 7.18 6.98 11.25c-.72.29-.71.69-.13.87l2.7.84 6.24-3.94c.29-.18.56-.08.34.12l-5.05 4.56-.19 2.67c.28 0 .41-.13.56-.28l1.31-1.27 2.73 2.02c.5.28.86.14.98-.46l1.8-8.5c.17-.73-.28-1.06-.82-.7Z"
                            />
                          </svg>
                          <span>{t("common.telegram", { defaultValue: "Telegram" })}</span>
                        </a>
                      )}
                    </div>
                  ) : (
                    (supplierPhone || supplierTg?.label) && (
                      <div className="rounded-xl bg-gray-50 px-2.5 py-1.5 text-[11px] font-medium leading-4 text-gray-500 ring-1 ring-gray-100">
                        {t("marketplace.contacts_locked", {
                          defaultValue:
                            "Контакты скрыты. Откройте доступ для связи.",
                        })}
                      </div>
                    )
                  )}
                </div>
              )}

            {!unlocked && !isProviderViewer && !isAdminViewer && (
              <div className="rounded-2xl bg-gradient-to-br from-orange-50/80 via-amber-50/55 to-white px-3 py-1.5 text-[11px] leading-4 text-orange-800 ring-1 ring-orange-100/70 shadow-[0_8px_18px_rgba(251,146,60,0.07)]">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5">🔒</span>
                  <div>
                    <div className="font-black">
                      {t("marketplace.unlock_supplier_hint_title", {
                        defaultValue: "Контакты закрыты",
                      })}
                    </div>
                    <div className="mt-0.5 font-medium text-orange-700/90 line-clamp-2">
                      {t("marketplace.unlock_supplier_hint", {
                        defaultValue:
                          "После открытия вы сможете связаться с поставщиком.",
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}


            {canShowUnlockButton && (
              <>
                <button
                  type="button"
                  onClick={openUnlockIntro}
                  disabled={unlockLoading || unlockIntroLoading}
                  className="group/cta relative w-full overflow-hidden rounded-2xl bg-gradient-to-r from-orange-500 via-amber-500 to-orange-400 px-4 py-2.5 text-sm font-black text-white shadow-[0_12px_26px_rgba(249,115,22,0.24)] ring-1 ring-orange-200/60 transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.03] hover:shadow-[0_20px_44px_rgba(249,115,22,0.42)] hover:saturate-110 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100 active:translate-y-0 active:scale-[0.98] animate-[pulse_2.4s_ease-in-out_infinite]"
                >
                  <span className="pointer-events-none absolute inset-0 bg-orange-200/25 opacity-0 blur-xl transition-opacity duration-300 group-hover/cta:opacity-100" />
                  {unlockLoading || unlockIntroLoading ? (
                    <span className="relative z-10">{t("marketplace.unlocking", { defaultValue: "Открытие..." })}</span>
                  ) : (
                    <span className="relative z-10 inline-flex items-center justify-center">
                      {t("marketplace.unlock_contacts_cta_primary", {
                        defaultValue: "Открыть контакты",
                      })}
                    </span>
                  )}
                </button>

                <p className="mt-1 text-center text-[10px] font-medium leading-4 text-gray-400/85">
                  {t("marketplace.unlock_contacts_cta_hint", {
                    defaultValue: "После оплаты контакты откроются автоматически",
                  })}
                </p>
              </>
            )}

            <div className="grid grid-cols-2 gap-1.5 pt-0.5">
              {hasDetailsBlock && (
                <button
                  ref={detailsBtnRef}
                  type="button"
                  className="inline-flex items-center justify-center rounded-xl border border-gray-200/70 bg-white/80 px-2.5 py-1.5 text-[12px] font-bold text-gray-500 transition hover:border-gray-300 hover:bg-white hover:text-gray-700 hover:shadow-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDetailsOpen(true);
                  }}
                >
                  {t("marketplace.more_details", { defaultValue: "Подробнее о туре" })}
                </button>
              )}

              {showBookButton ? (
                <a
                  href={`/profile/provider/${providerId}?service=${id}#book`}
                  className="w-full inline-flex items-center justify-center rounded-xl border border-orange-100 bg-white/80 px-2.5 py-1.5 text-[12px] font-bold text-orange-700 transition hover:bg-orange-50 hover:border-orange-200 hover:shadow-sm"
                  onClick={(e) => e.stopPropagation()}
                >
                  {t("actions.book", { defaultValue: "Бронировать" })}
                </a>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();

                    if (!unlocked && !isProviderViewer && !isAdminViewer) {
                      postUnlockStep("quick_request_locked_clicked", {
                        source: "card_footer",
                        has_pay_url: Boolean(unlockPayModal?.payUrl),
                      });
                      openUnlockIntro();
                      return;
                    }

                    onQuickRequest?.(id, providerId, title);
                  }}
                  className={[
                    "w-full rounded-xl border px-2.5 py-1.5 text-[12px] font-bold transition hover:shadow-sm",
                    !unlocked && !isProviderViewer && !isAdminViewer
                      ? "border-orange-200 bg-orange-50/70 text-orange-700 hover:bg-orange-100/70 hover:border-orange-300"
                      : "border-orange-100 bg-white/80 text-orange-700 hover:bg-orange-50 hover:border-orange-200",
                  ].join(" ")}
                  title={
                    !unlocked && !isProviderViewer && !isAdminViewer
                      ? t("marketplace.quick_request_after_access_hint", {
                          defaultValue: "Быстрый запрос доступен после открытия доступа",
                        })
                      : t("actions.quick_request", { defaultValue: "Быстрый запрос" })
                  }
                >
                  {!unlocked && !isProviderViewer && !isAdminViewer ? (
                    <span className="inline-flex items-center justify-center gap-1.5">
                      <span>🔒</span>
                      <span>
                        {t("marketplace.quick_request_after_access", {
                          defaultValue: "Быстрый запрос",
                        })}
                      </span>
                    </span>
                  ) : (
                    t("actions.quick_request", { defaultValue: "Быстрый запрос" })
                  )}
                </button>
              )}
            </div>
          </div>
        </div>      </div>

      <DetailsPopup
        open={detailsOpen}
        anchorRef={detailsBtnRef}
        onClose={() => setDetailsOpen(false)}
      >
        <div className="relative">
          {/* Premium hero */}
          <div className="relative h-56 overflow-hidden bg-gradient-to-br from-slate-100 via-orange-50 to-amber-50 sm:h-64">
            {images.length ? (
              <img
                src={images[idx]}
                alt={title || t("marketplace.no_image", { defaultValue: "Нет изображения" })}
                className="h-full w-full object-cover saturate-[1.08] contrast-[1.03]"
                onError={onImgError}
                draggable={false}
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-slate-400">
                <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-white/80 text-3xl shadow-sm ring-1 ring-slate-200/70">
                  🏝️
                </div>
                <div className="text-sm font-black text-slate-500">
                  {t("marketplace.photo_coming_soon", { defaultValue: "Фото появится позже" })}
                </div>
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/20 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-5 text-white sm:p-6">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {categorySticker && (
                  <span className="inline-flex rounded-full bg-white/18 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white ring-1 ring-white/25 backdrop-blur-md">
                    {categorySticker.label}
                  </span>
                )}
                {hasProof && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/90 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white ring-1 ring-white/25 backdrop-blur-md">
                    ✔ {t("marketplace.verified_proof", { defaultValue: "Проверено" })}
                  </span>
                )}
                {expireAt && !isExpired && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-black/35 px-2.5 py-1 text-[10px] font-black text-white ring-1 ring-white/20 backdrop-blur-md">
                    ⏳ {formatLeft(leftMs, dayShort)}
                  </span>
                )}
              </div>

              <h2 className="line-clamp-2 text-2xl font-black leading-tight tracking-[-0.04em] drop-shadow-sm sm:text-3xl">
                {hotel || title}
              </h2>
              {hotel && title && hotel !== title && (
                <div className="mt-1 line-clamp-1 text-sm font-bold text-white/80">
                  {title}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4 p-4 pb-5 sm:p-6 sm:pb-6">
            {/* Decision summary */}
            <div className="grid gap-3 sm:grid-cols-3">
              {dates && (
                <div className="rounded-2xl bg-slate-950 px-4 py-3 text-white shadow-[0_16px_34px_rgba(15,23,42,0.18)] sm:col-span-2">
                  <div className="text-[10px] font-black uppercase tracking-[0.14em] text-white/45">
                    {t("marketplace.details_dates_title", { defaultValue: "Даты поездки" })}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-lg font-black leading-tight tracking-[-0.03em]">
                    <span>🗓</span>
                    <span>{dates}</span>
                  </div>
                </div>
              )}

              {prettyPrice && (
                <div className="rounded-2xl bg-gradient-to-br from-orange-500 to-amber-400 px-4 py-3 text-white shadow-[0_16px_34px_rgba(249,115,22,0.24)]">
                  <div className="text-[10px] font-black uppercase tracking-[0.14em] text-white/70">
                    {t("marketplace.price", { defaultValue: "Цена" })}
                  </div>
                  <div className="mt-1 text-2xl font-black leading-none tracking-[-0.05em]">
                    {prettyPrice}
                  </div>
                  <div className="mt-0.5 text-xs font-black text-white/85">
                    {t("marketplace.price_currency", { defaultValue: "у.е." })}
                  </div>
                </div>
              )}
            </div>

            {(direction || accommodation || transfer || details.insuranceIncluded || details.earlyCheckIn || details.arrivalFastTrack) && (
              <div className="rounded-3xl border border-slate-200/80 bg-white p-4 shadow-[0_16px_40px_rgba(15,23,42,0.06)]">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-slate-950">
                      {t("marketplace.details_trip_summary", { defaultValue: "Что входит в предложение" })}
                    </div>
                    <div className="text-xs font-medium text-slate-500">
                      {t("marketplace.details_trip_summary_hint", { defaultValue: "Ключевые детали для быстрого решения" })}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {direction && (
                    <div className="rounded-2xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
                      <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">
                        {t("marketplace.route", { defaultValue: "Маршрут" })}
                      </div>
                      <div className="mt-1 text-sm font-black text-slate-900">✈️ {direction}</div>
                    </div>
                  )}
                  {accommodation && (
                    <div className="rounded-2xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
                      <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">
                        {t("marketplace.accommodation", { defaultValue: "Размещение" })}
                      </div>
                      <div className="mt-1 text-sm font-black text-slate-900">🛏 {accommodation}</div>
                    </div>
                  )}
                  {transfer && (
                    <div className="rounded-2xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
                      <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">
                        {t("marketplace.transfer", { defaultValue: "Трансфер" })}
                      </div>
                      <div className="mt-1 text-sm font-black text-slate-900">🚐 {transfer}</div>
                    </div>
                  )}
                  {details.insuranceIncluded && (
                    <div className="rounded-2xl bg-emerald-50 px-3 py-2.5 text-emerald-800 ring-1 ring-emerald-100">
                      <div className="text-[10px] font-black uppercase tracking-wide text-emerald-600/70">
                        {t("insurance_included", { defaultValue: "Страховка" })}
                      </div>
                      <div className="mt-1 text-sm font-black">🛡 {t("marketplace.included", { defaultValue: "Включено" })}</div>
                    </div>
                  )}
                  {details.earlyCheckIn && (
                    <div className="rounded-2xl bg-blue-50 px-3 py-2.5 text-blue-800 ring-1 ring-blue-100">
                      <div className="text-[10px] font-black uppercase tracking-wide text-blue-600/70">
                        {t("early_check_in", { defaultValue: "Раннее заселение" })}
                      </div>
                      <div className="mt-1 text-sm font-black">🏨 {t("marketplace.included", { defaultValue: "Включено" })}</div>
                    </div>
                  )}
                  {details.arrivalFastTrack && (
                    <div className="rounded-2xl bg-violet-50 px-3 py-2.5 text-violet-800 ring-1 ring-violet-100">
                      <div className="text-[10px] font-black uppercase tracking-wide text-violet-600/70">
                        {t("arrival_fast_track", { defaultValue: "Fast Track" })}
                      </div>
                      <div className="mt-1 text-sm font-black">🛬 {t("marketplace.included", { defaultValue: "Включено" })}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {flightDetails && (
              <div className="rounded-3xl border border-sky-100 bg-gradient-to-br from-sky-50 to-white p-4 shadow-[0_16px_40px_rgba(14,165,233,0.08)]">
                <div className="mb-2 flex items-center gap-2 text-sm font-black text-slate-950">
                  <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-sky-500 text-white shadow-sm">✈️</span>
                  {t("marketplace.flight_details", { defaultValue: "Детали рейса" })}
                </div>
                <div className="whitespace-pre-wrap rounded-2xl bg-white/80 p-3 text-sm font-semibold leading-relaxed text-slate-700 ring-1 ring-sky-100">
                  {String(flightDetails || "").replace(/\r\n/g, "\n")}
                </div>
              </div>
            )}

            {hasProof && (
              <div className="rounded-3xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-[0_16px_40px_rgba(16,185,129,0.08)]">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-emerald-900">
                      {t("marketplace.proof_images", { defaultValue: "Подтверждение подлинности" })}
                    </div>
                    <div className="text-xs font-semibold text-emerald-700/75">
                      {canViewProof
                        ? t("marketplace.details_proof_available", { defaultValue: "Можно открыть и проверить материалы" })
                        : t("marketplace.details_proof_locked", { defaultValue: "Материалы проверки доступны после открытия доступа" })}
                    </div>
                  </div>
                  <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-[10px] font-black text-white shadow-sm">
                    {proofImages.length} {t("marketplace.proof_images_count", { defaultValue: "фото" })}
                  </span>
                </div>

                {canViewProof ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {proofImages.map((img, i) => (
                      <button
                        key={`${id}-proof-popup-${i}`}
                        type="button"
                        className="group/proof relative h-24 overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:h-28"
                        onClick={() => setSelectedProofImage(img)}
                      >
                        <img src={img} alt="" className="h-full w-full object-cover transition duration-500 group-hover/proof:scale-105" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-white p-3">
                    <div className="grid grid-cols-3 gap-2 opacity-55 blur-[1.5px]">
                      {proofImages.slice(0, 3).map((img, i) => (
                        <div key={`${id}-proof-blur-${i}`} className="h-20 overflow-hidden rounded-xl bg-emerald-50">
                          <img src={img} alt="" className="h-full w-full object-cover" />
                        </div>
                      ))}
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-[1px]">
                      <div className="rounded-2xl bg-white px-4 py-3 text-center shadow-lg ring-1 ring-emerald-100">
                        <div className="text-xl">🔒</div>
                        <div className="text-xs font-black text-emerald-900">
                          {t("marketplace.details_proof_unlock_cta", { defaultValue: "Откройте доступ, чтобы проверить" })}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {(viewsCount > 0 || watchingNow > 0 || unlocksCount > 0) && (
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-2xl bg-slate-50 px-3 py-2 text-center ring-1 ring-slate-100">
                  <div className="text-lg font-black text-slate-900">{viewsCount || 0}</div>
                  <div className="text-[10px] font-bold text-slate-400">{t("marketplace.views", { defaultValue: "просмотров" })}</div>
                </div>
                <div className="rounded-2xl bg-orange-50 px-3 py-2 text-center ring-1 ring-orange-100">
                  <div className="text-lg font-black text-orange-700">{watchingNow || 0}</div>
                  <div className="text-[10px] font-bold text-orange-500">{t("marketplace.considering_now", { defaultValue: "сейчас" })}</div>
                </div>
                <div className="rounded-2xl bg-emerald-50 px-3 py-2 text-center ring-1 ring-emerald-100">
                  <div className="text-lg font-black text-emerald-700">{unlocksCount || 0}</div>
                  <div className="text-[10px] font-bold text-emerald-500">{t("marketplace.unlocked_count_short", { defaultValue: "открыли" })}</div>
                </div>
              </div>
            )}
          </div>

          {canShowUnlockButton && (
            <div className="sticky bottom-0 z-20 border-t border-slate-200/80 bg-white/92 p-4 shadow-[0_-18px_42px_rgba(15,23,42,0.10)] backdrop-blur-xl sm:p-5">
              <div className="mb-3 rounded-2xl bg-orange-50 px-3 py-2 text-xs font-bold text-orange-800 ring-1 ring-orange-100">
                ⚡ {t("marketplace.details_unlock_value_anchor", { defaultValue: "После открытия вы сможете связаться напрямую, отправить быстрый запрос и проверить материалы." })}
              </div>
              <button
                type="button"
                onClick={openUnlockIntro}
                disabled={unlockLoading || unlockIntroLoading}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-orange-500 via-amber-500 to-orange-400 px-5 py-3.5 text-sm font-black text-white shadow-[0_18px_42px_rgba(249,115,22,0.28)] ring-1 ring-orange-200/70 transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.015] hover:shadow-[0_24px_56px_rgba(249,115,22,0.42)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100 active:translate-y-0 active:scale-[0.99] animate-[pulse_2.6s_ease-in-out_infinite]"
              >
                <span>🔓</span>
                <span>
                  {unlockLoading || unlockIntroLoading
                    ? t("marketplace.unlocking", { defaultValue: "Открытие..." })
                    : t("marketplace.details_unlock_cta", { defaultValue: "Получить доступ к поставщику" })}
                </span>
              </button>
              <div className="mt-2 text-center text-[11px] font-semibold text-slate-400">
                {t("marketplace.unlock_contacts_cta_hint", { defaultValue: "После оплаты контакты откроются автоматически" })}
              </div>
            </div>
          )}
        </div>
      </DetailsPopup>
      
      {showUnlockIntroModal &&
        createPortal(
          <div
            className="fixed inset-0 z-[3940] flex items-center justify-center bg-black/55 px-4 py-5 backdrop-blur-sm animate-[fadeIn_.18s_ease-out]"
            onClick={async () => {
              await postUnlockStep("unlock_intro_closed");
              setShowUnlockIntroModal(false);
            }}
          >
            <div
              className="w-full max-w-md overflow-hidden rounded-[28px] bg-white shadow-[0_30px_90px_rgba(15,23,42,0.35)] border border-white/70 animate-[scaleIn_.18s_ease-out]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.38),_transparent_34%),linear-gradient(135deg,#ff7a18,#f6b311)] px-5 py-5 text-white">
                <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/15 blur-2xl" />
                <div className="relative flex items-center gap-3">
                  <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20 text-2xl shadow-inner ring-1 ring-white/25">
                    <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[11px] shadow-sm">📞</span>
                    <span aria-hidden="true">🛡️</span>
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-black leading-tight tracking-[-0.02em]">
                      {t("marketplace.unlock_intro_title", {
                        defaultValue: "Свяжитесь с поставщиком напрямую",
                      })}
                    </h3>
                    <p className="mt-0.5 text-sm font-medium leading-snug text-white/90">
                      {t("marketplace.unlock_intro_subtitle", {
                        defaultValue: "Выгодные отказные туры могут быстро уйти",
                      })}
                    </p>
                  </div>
                </div>
              </div>

              <div className="max-h-[78vh] overflow-y-auto px-5 py-5">
                <div className="rounded-2xl border border-orange-100 bg-gradient-to-br from-orange-50 via-white to-amber-50 px-4 py-4 shadow-[0_10px_26px_rgba(249,115,22,0.08)]">
                  {title && (
                    <div className="text-base font-black leading-snug tracking-[-0.01em] text-gray-950">
                      {title}
                    </div>
                  )}

                  {direction && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-gray-600">
                      <span>✈️</span>
                      <span className="truncate">{direction}</span>
                    </div>
                  )}

                  {dates && (
                    <div className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1 text-xs font-bold text-gray-700 ring-1 ring-orange-100">
                      <span>🗓</span>
                      <span className="truncate">
                        {t("marketplace.dates_label", { defaultValue: "Даты" })}: {dates}
                      </span>
                    </div>
                  )}

                  {prettyPrice && (
                    <div className="mt-3 rounded-2xl bg-white/80 px-3 py-2.5 ring-1 ring-orange-100">
                      <div className="text-[10px] font-black uppercase tracking-[0.14em] text-orange-600/70">
                        {t("marketplace.tour_price_label", { defaultValue: "Стоимость тура" })}
                      </div>
                      <div className="mt-0.5 flex items-end gap-1.5">
                        <div className="text-2xl font-black leading-none tracking-[-0.04em] text-gray-950">
                          {prettyPrice}
                        </div>
                        <div className="pb-0.5 text-xs font-black text-orange-600">
                          {t("marketplace.price_currency", { defaultValue: "у.е." })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 rounded-2xl border border-gray-200 bg-gradient-to-br from-slate-50 to-white px-4 py-4 shadow-sm">
                  <div className="text-sm font-black text-gray-950">
                    {t("marketplace.unlock_intro_whats_inside", {
                      defaultValue: "После открытия вы получите:",
                    })}
                  </div>

                  <div className="mt-3 space-y-2.5 text-sm font-medium text-gray-700">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-base ring-1 ring-emerald-100">📞</span>
                      <span>
                        {t("marketplace.unlock_intro_phone", {
                          defaultValue: "Прямой номер поставщика",
                        })}
                      </span>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-base ring-1 ring-sky-100">✈️</span>
                      <span>
                        {t("marketplace.unlock_intro_telegram", {
                          defaultValue: "Telegram для быстрой связи",
                        })}
                      </span>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-base ring-1 ring-orange-100">⚡</span>
                      <span>
                        {t("marketplace.unlock_intro_fast_booking", {
                          defaultValue: "Возможность сразу обсудить бронь",
                        })}
                      </span>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-base ring-1 ring-amber-100">💬</span>
                      <span>
                        {t("marketplace.unlock_intro_quick_request", {
                          defaultValue: "Быстрый запрос поставщику",
                        })}
                      </span>
                    </div>

                    {hasProof && (
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-base ring-1 ring-violet-100">🛡️</span>
                        <span>
                          {t("marketplace.unlock_intro_benefit_proof", {
                            defaultValue: "Материалы проверки / proof",
                          })}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 via-orange-50 to-white px-4 py-3">
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 text-lg">🔥</span>
                    <div>
                      <div className="text-sm font-black text-amber-900">
                        {watchingNow > 0
                          ? t("marketplace.unlock_intro_urgency_watching_title", {
                              count: watchingNow,
                              defaultValue: `Сейчас этот тур рассматривают ${watchingNow} чел.`,
                            })
                          : unlocksCount > 0
                          ? t("marketplace.unlock_intro_urgency_unlocked_title", {
                              count: unlocksCount,
                              defaultValue: `Контакты уже открывали ${unlocksCount} раз`,
                            })
                          : t("marketplace.unlock_intro_urgency", {
                              defaultValue: "Выгодные варианты долго не держатся",
                            })}
                      </div>

                      <div className="mt-1 text-xs font-medium leading-snug text-amber-800/85">
                        {watchingNow > 0
                          ? t("marketplace.unlock_intro_dynamic_watching", {
                              count: watchingNow,
                              defaultValue: "Свяжитесь раньше других, пока предложение актуально.",
                            })
                          : unlocksCount > 0
                          ? t("marketplace.unlock_intro_dynamic_unlocked", {
                              count: unlocksCount,
                              defaultValue: "Другие клиенты уже проявляли интерес к этому варианту.",
                            })
                          : t("marketplace.unlock_intro_dynamic_default", {
                              defaultValue:
                                "Отказной тур может стать неактуальным в любой момент — лучше связаться сразу.",
                            })}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 overflow-hidden rounded-2xl border border-orange-200 bg-white shadow-[0_16px_36px_rgba(249,115,22,0.12)]">
                  <div className="bg-gradient-to-br from-white via-orange-50/70 to-amber-50 px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] font-black uppercase tracking-[0.12em] text-orange-700/70">
                          {t("marketplace.unlock_intro_price_label", {
                            defaultValue: "Доступ к контактам",
                          })}
                        </div>

                        <div className="mt-1.5 flex items-end gap-2">
                          <div className="text-[34px] font-black leading-none tracking-[-0.05em] text-gray-950">
                            {Number(unlockIntroPriceSum || unlockPayModal.shortfallSum || 0).toLocaleString("ru-RU")}
                          </div>

                          <div className="mb-1 text-base font-black text-orange-700">
                            {t("marketplace.unlock_intro_access_currency", {
                              defaultValue: "сум",
                            })}
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0 rounded-2xl bg-orange-500 px-3 py-2 text-center text-white shadow-[0_10px_24px_rgba(249,115,22,0.22)]">
                        <div className="text-[10px] font-black uppercase leading-none">
                          {t("marketplace.unlock_intro_once", {
                            defaultValue: "1 раз",
                          })}
                        </div>
                        <div className="mt-1 text-[10px] font-semibold leading-none text-white/85">
                          {t("marketplace.unlock_intro_no_subscription", {
                            defaultValue: "без подписки",
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-1.5 text-center text-[10px] font-bold text-gray-600">
                      <div className="rounded-xl bg-white/80 px-2 py-2 ring-1 ring-orange-100">
                        🔒 {t("marketplace.unlock_intro_trust_no_subs", { defaultValue: "Без подписок" })}
                      </div>
                      <div className="rounded-xl bg-white/80 px-2 py-2 ring-1 ring-orange-100">
                        ⚡ {t("marketplace.unlock_intro_trust_instant", { defaultValue: "Сразу" })}
                      </div>
                      <div className="rounded-xl bg-white/80 px-2 py-2 ring-1 ring-orange-100">
                        🛡 {t("marketplace.unlock_intro_trust_saved", { defaultValue: "Доступ ваш" })}
                      </div>
                    </div>

                    <div className="mt-3 rounded-xl bg-white/80 px-3 py-2 text-[11px] font-medium leading-snug text-gray-600 ring-1 ring-orange-100">
                      {t("marketplace.unlock_intro_value_anchor", {
                        defaultValue:
                          "Это небольшая стоимость полного доступа к поставщику: телефон, Telegram и быстрый запрос без лишних шагов.",
                      })}
                    </div>
                  </div>

                  <div className="border-t border-orange-100 bg-white px-4 py-2 text-[11px] font-medium text-gray-500">
                    {t("marketplace.unlock_intro_price_subhint", {
                      defaultValue: "После оплаты телефон, Telegram и быстрый запрос станут доступны в этой карточке.",
                    })}
                  </div>
                </div>

                <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
                  <button
                    type="button"
                    onClick={async () => {
                      await postUnlockStep("unlock_intro_closed");
                      setShowUnlockIntroModal(false);
                    }}
                    className="inline-flex w-full items-center justify-center rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-700 transition hover:bg-gray-50"
                  >
                    {t("common.cancel", { defaultValue: "Отмена" })}
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      setShowUnlockIntroModal(false);

                      await postUnlockStep("unlock_intro_continue_clicked", {
                        shortfall_sum: Number(unlockIntroPriceSum || unlockPayModal.shortfallSum || 0),
                        pay_url_exists: Boolean(unlockPayModal?.payUrl),
                      });

                      if (unlockPayModal?.payUrl) {
                        setUnlockPayModal((prev) => ({ ...prev, open: true }));
                        return;
                      }

                      setShowBalancePrompt(true);
                    }}
                    className="inline-flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-orange-500 via-amber-500 to-orange-400 px-4 py-3 text-sm font-black text-white shadow-[0_16px_34px_rgba(249,115,22,0.30)] ring-1 ring-orange-200/70 transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-[0_24px_54px_rgba(249,115,22,0.42)] active:translate-y-0 active:scale-[0.99] animate-[pulse_2.5s_ease-in-out_infinite]"
                  >
                    {unlockLoading
                      ? t("marketplace.unlocking", { defaultValue: "Открытие..." })
                      : t("marketplace.unlock_intro_cta", {
                          defaultValue: "Получить доступ",
                        })}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

        {showUnlockSuccessModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-5 backdrop-blur-sm animate-[fadeIn_.18s_ease-out]"
            onClick={() => setShowUnlockSuccessModal(false)}
          >
            <div
              className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.35)] animate-[scaleIn_.22s_ease-out]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="pointer-events-none absolute -left-12 -top-12 h-36 w-36 rounded-full bg-emerald-300/25 blur-3xl" />
              <div className="pointer-events-none absolute -right-14 top-32 h-32 w-32 rounded-full bg-orange-300/20 blur-3xl" />
              <div className="relative overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.42),_transparent_34%),linear-gradient(135deg,#10b981,#22c55e)] px-6 py-6 text-white">
                <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/15 blur-2xl" />
                <div className="relative flex flex-col items-center text-center">
                  <div className="relative mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-white/20 shadow-inner ring-1 ring-white/30">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-white/25 animate-ping" />
                    <span className="absolute inline-flex h-14 w-14 rounded-full bg-emerald-200/35 animate-[ping_1.1s_ease-in-out_1]" />
                    <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-white text-4xl text-emerald-600 shadow-lg animate-[bounce_.75s_ease-in-out_1]">
                      ✓
                    </span>
                    <span className="absolute -left-5 top-1 text-lg animate-[bounce_1.1s_ease-in-out_1]">✨</span>
                    <span className="absolute -right-4 top-5 text-base animate-[bounce_1.25s_ease-in-out_1]">🎉</span>
                  </div>

                  <h2 className="text-xl font-black leading-tight tracking-[-0.02em]">
                    {t("marketplace.unlock_success_title", {
                      defaultValue: "Контакты открыты",
                    })}
                  </h2>

                  <p className="mt-1 text-sm font-medium leading-snug text-white/90">
                    {t("marketplace.unlock_success_subtitle", {
                      defaultValue: "Можно сразу связаться с поставщиком",
                    })}
                  </p>
                </div>
              </div>

              <div className="relative px-5 py-5">
                <div className="mb-3 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                  <div className="inline-flex items-center justify-center gap-1 rounded-xl bg-emerald-50 px-2 py-1.5 text-[10px] font-black text-emerald-700 ring-1 ring-emerald-100">
                    <span>✓</span>
                    <span>{t("marketplace.unlock_success_trust_saved", { defaultValue: "Доступ сохранён" })}</span>
                  </div>
                  <div className="inline-flex items-center justify-center gap-1 rounded-xl bg-sky-50 px-2 py-1.5 text-[10px] font-black text-sky-700 ring-1 ring-sky-100">
                    <span>☎</span>
                    <span>{t("marketplace.unlock_success_trust_direct", { defaultValue: "Связь напрямую" })}</span>
                  </div>
                  <div className="inline-flex items-center justify-center gap-1 rounded-xl bg-orange-50 px-2 py-1.5 text-[10px] font-black text-orange-700 ring-1 ring-orange-100">
                    <span>🔒</span>
                    <span>{t("marketplace.unlock_success_trust_no_repeat", { defaultValue: "Без повторной оплаты" })}</span>
                  </div>
                </div>

                {supplierName && (
                  <div className="mb-3 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.14em] text-gray-400">
                      {t("marketplace.supplier", { defaultValue: "Поставщик" })}
                    </div>
                    <div className="mt-1 truncate text-sm font-black text-gray-950">
                      {supplierName}
                    </div>
                  </div>
                )}

                <div className="space-y-2.5">
                  {supplierPhone && (
                    <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white px-3 py-3 shadow-sm transition-all duration-300 hover:scale-[1.01] hover:shadow-md">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex items-center gap-2.5">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">📞</span>
                          <div className="min-w-0">
                            <div className="text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700/70">
                              {t("marketplace.pay_modal_phone", { defaultValue: "Телефон" })}
                            </div>
                            <div className="truncate text-sm font-black text-gray-950">{supplierPhone}</div>
                          </div>
                        </div>

                        <div className="flex shrink-0 gap-1.5">
                          <button
                            type="button"
                            onClick={() => copyTextSafe(supplierPhone, "phone")}
                            className="rounded-xl bg-white px-2.5 py-2 text-[11px] font-black text-gray-700 ring-1 ring-gray-200 transition hover:bg-gray-50 active:scale-[0.98]"
                          >
                            {copiedPhone
                              ? t("common.copied", { defaultValue: "Скопировано" })
                              : t("common.copy", { defaultValue: "Копировать" })}
                          </button>

                          <a
                            href={normalizePhoneHref(supplierPhone)}
                            onClick={() =>
                              postUnlockStep("unlock_phone_clicked", {
                                source: "success_modal",
                                has_phone: true,
                                has_telegram: Boolean(supplierTg?.href),
                              })
                            }
                            className="rounded-xl bg-emerald-600 px-2.5 py-2 text-[11px] font-black text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98]"
                          >
                            {t("marketplace.call", { defaultValue: "Позвонить" })}
                          </a>
                        </div>
                      </div>
                    </div>
                  )}

                  {supplierTg?.label && (
                    <div className="rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-white px-3 py-3 shadow-sm transition-all duration-300 hover:scale-[1.01] hover:shadow-md">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex items-center gap-2.5">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#229ED9] text-white shadow-sm">✈️</span>
                          <div className="min-w-0">
                            <div className="text-[10px] font-black uppercase tracking-[0.12em] text-sky-700/70">
                              {t("common.telegram", { defaultValue: "Telegram" })}
                            </div>
                            <div className="truncate text-sm font-black text-gray-950">{supplierTg.label}</div>
                          </div>
                        </div>

                        <div className="flex shrink-0 gap-1.5">
                          <button
                            type="button"
                            onClick={() => copyTextSafe(supplierTg.label, "tg")}
                            className="rounded-xl bg-white px-2.5 py-2 text-[11px] font-black text-gray-700 ring-1 ring-gray-200 transition hover:bg-gray-50 active:scale-[0.98]"
                          >
                            {copiedTelegram
                              ? t("common.copied", { defaultValue: "Скопировано" })
                              : t("common.copy", { defaultValue: "Копировать" })}
                          </button>

                          {supplierTg.href && (
                            <a
                              href={supplierTg.href}
                              onClick={() =>
                                postUnlockStep("unlock_telegram_clicked", {
                                  source: "success_modal",
                                  has_phone: Boolean(supplierPhone),
                                  has_telegram: true,
                                })
                              }
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-xl bg-[#229ED9] px-2.5 py-2 text-[11px] font-black text-white shadow-sm transition hover:bg-[#1d8ecf] active:scale-[0.98]"
                            >
                              {t("common.telegram", { defaultValue: "Telegram" })}
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 via-orange-50 to-white px-4 py-3 text-center">
                  <p className="text-sm font-bold leading-6 text-amber-900">
                    {t("marketplace.unlock_success_action_text", {
                      defaultValue: "Свяжитесь сейчас, пока предложение ещё актуально.",
                    })}
                  </p>
                  <div className="mt-1 text-[11px] font-medium leading-4 text-amber-800/75">
                    {t("marketplace.unlock_success_saved_hint", {
                      defaultValue: "Контакты получены после успешной оплаты и уже сохранены в этой карточке",
                    })}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowUnlockSuccessModal(false)}
                  className="mt-5 w-full rounded-2xl bg-gray-950 px-4 py-3 text-sm font-black text-white shadow-[0_14px_32px_rgba(15,23,42,0.22)] transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.01] hover:bg-black active:translate-y-0 active:scale-[0.99]"
                >
                  {t("common.close", { defaultValue: "Закрыть" })}
                </button>
              </div>
            </div>
          </div>
        )}
      {showLoginModal &&
        createPortal(
          <div
            className="fixed inset-0 z-[3950] flex items-center justify-center bg-black/50 px-4 animate-[fadeIn_.18s_ease-out]"
            onClick={() => setShowLoginModal(false)}
          >
            <div
              className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl border border-gray-200 animate-[scaleIn_.18s_ease-out]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-gradient-to-r from-orange-500 to-amber-400 px-6 py-5 text-white">
                <div className="flex items-center gap-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 text-3xl shadow-[0_14px_34px_rgba(255,255,255,0.18)] ring-1 ring-white/25 backdrop-blur-sm">
                    💬
                  </div>
                  <div>
                    <h3 className="text-lg font-bold leading-tight">
                      {t("marketplace.login_modal_title", {
                        defaultValue: "Открытие контактов",
                      })}
                    </h3>
                    <p className="text-sm text-white/90">
                      {t("marketplace.login_modal_subtitle", {
                        defaultValue: "Войдите как клиент, чтобы продолжить",
                      })}
                    </p>
                  </div>
                </div>
              </div>

              <div className="px-6 py-5">
                <p className="text-sm leading-6 text-gray-600">
                  {t("marketplace.login_modal_text", {
                    defaultValue:
                      "Чтобы открыть телефон и Telegram поставщика, сначала выполните вход в клиентский аккаунт.",
                  })}
                </p>

                <div className="mt-4 rounded-2xl border border-orange-100 bg-orange-50 px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 text-lg">💡</div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        {t("marketplace.login_modal_hint_title", {
                          defaultValue: "Что будет дальше",
                        })}
                      </p>
                      <p className="mt-1 text-sm text-gray-600">
                        {t("marketplace.login_modal_hint_text", {
                          defaultValue:
                            "После входа вы сможете открыть контакты и связаться с поставщиком напрямую.",
                        })}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => setShowLoginModal(false)}
                    className="inline-flex w-full items-center justify-center rounded-2xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                  >
                    {t("common.cancel", { defaultValue: "Отмена" })}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowLoginModal(false);
                      navigate("/client/login");
                    }}
                    className="inline-flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-orange-500 via-amber-500 to-orange-400 px-4 py-3 text-sm font-black text-white shadow-[0_16px_36px_rgba(249,115,22,0.32)] ring-1 ring-orange-200/70 transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-[0_24px_54px_rgba(249,115,22,0.44)] active:translate-y-0 active:scale-[0.99] animate-[pulse_2.4s_ease-in-out_infinite]"
                  >
                    {t("marketplace.login_as_client", {
                      defaultValue: "Войти как клиент",
                    })}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {unlockPayModal.open &&
        createPortal(
          <div
            className="fixed inset-0 z-[3925] bg-black/45 backdrop-blur-[2px] flex items-center justify-center p-4 animate-[fadeIn_.18s_ease-out]"
            onClick={closeUnlockPayModal}
          >
            <div
              className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl border border-gray-200 animate-[scaleIn_.18s_ease-out]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-gradient-to-r from-orange-500 to-amber-400 px-6 py-5 text-white">
                <div className="flex items-center gap-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 text-3xl shadow-[0_14px_34px_rgba(255,255,255,0.18)] ring-1 ring-white/25 backdrop-blur-sm">
                    💬
                  </div>
                  <div>
                    <h3 className="text-lg font-bold leading-tight">
                      {t("marketplace.pay_modal_title", {
                        defaultValue: "Открытие контактов поставщика",
                      })}
                    </h3>
                    <p className="text-sm text-white/90">
                      {t("marketplace.pay_modal_subtitle", {
                        defaultValue: "После оплаты контакты откроются автоматически",
                      })}
                    </p>
                  </div>
                </div>
              </div>

              <div className="px-6 py-5">
                <div className="rounded-2xl border border-orange-100 bg-orange-50 px-4 py-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-orange-700/80">
                    {t("marketplace.pay_modal_amount_label", {
                      defaultValue: "ФИКСИРОВАННАЯ СТОИМОСТЬ ОТКРЫТИЯ",
                    })}
                  </div>
                  <div className="mt-1 text-4xl font-extrabold tracking-tight text-gray-950">
                    {Number(unlockPayModal.shortfallSum || 0).toLocaleString("ru-RU")}
                    <span className="ml-1 align-baseline text-xl font-bold text-gray-700">
                      {t("common.sum_currency", { defaultValue: "сум" })}
                    </span>
                  </div>
                  {!!unlockPayModal.orderId && (
                    <div className="mt-2 text-sm text-gray-600">
                      {t("marketplace.pay_modal_order", {
                        defaultValue: "Заказ",
                      })}: #{unlockPayModal.orderId}
                    </div>
                  )}
                </div>

                <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 text-lg">✨</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900">
                        {t("marketplace.pay_modal_hint_title", {
                          defaultValue: "Что откроется для вас",
                        })}
                      </p>

                      <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-gray-700 sm:grid-cols-2">
                        <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white px-3 py-2 shadow-sm">
                          <span className="text-base">📞</span>
                          <span>{t("marketplace.pay_modal_phone", { defaultValue: "Телефон" })}</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-sky-800 shadow-sm">
                          <span className="text-base">✈️</span>
                          <span>{t("marketplace.pay_modal_telegram", { defaultValue: "Telegram" })}</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-gradient-to-br from-green-50 to-emerald-100 px-3 py-2 font-semibold text-green-800 shadow-sm">
                          <span className="text-base">💬</span>
                          <span>{t("marketplace.pay_modal_whatsapp", { defaultValue: "WhatsApp" })}</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-xl border border-orange-200 bg-gradient-to-br from-orange-50 via-amber-50 to-white px-3 py-2 font-semibold text-orange-800 shadow-sm">
                          <span className="text-base">🤝</span>
                          <span>{t("marketplace.pay_modal_direct", { defaultValue: "Прямой контакт" })}</span>
                        </div>
                      </div>

                      <p className="mt-3 rounded-xl bg-white/80 px-3 py-2 text-sm font-semibold leading-5 text-gray-700 ring-1 ring-gray-100">
                        {t("marketplace.pay_modal_hint_text", {
                          defaultValue:
                            "После открытия вы сможете напрямую связаться с поставщиком без посредников.",
                        })}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-[11px] font-semibold leading-4 text-gray-500">
                  <span>✓ {t("marketplace.pay_modal_trust_instant", {
                    defaultValue: "Откроется сразу после оплаты",
                  })}</span>
                  <span className="text-gray-300">•</span>
                  <span>✓ {t("marketplace.pay_modal_trust_forever", {
                    defaultValue: "Повторная оплата не нужна",
                  })}</span>
                  <span className="text-gray-300">•</span>
                  <span>✓ {t("marketplace.pay_modal_trust_saved", {
                    defaultValue: "Доступ сохранится",
                  })}</span>
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={closeUnlockPayModal}
                    className="inline-flex w-full items-center justify-center rounded-2xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                  >
                    {t("common.cancel", { defaultValue: "Отмена" })}
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      const url = String(unlockPayModal.payUrl || "").trim();
                      if (!url) return;

                      await postUnlockStep("unlock_pay_modal_continue_clicked", {
                        order_id: unlockPayModal.orderId || null,
                        shortfall_sum: Number(unlockPayModal.shortfallSum || 0),
                      });

                      window.location.href = url;
                    }}
                    className="group/pay relative inline-flex w-full overflow-hidden items-center justify-center rounded-2xl bg-gradient-to-r from-orange-500 via-amber-500 to-orange-400 px-4 py-3 text-sm font-black text-white shadow-[0_16px_36px_rgba(249,115,22,0.32)] ring-1 ring-orange-200/70 transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.03] hover:shadow-[0_24px_54px_rgba(249,115,22,0.48)] active:translate-y-0 active:scale-[0.98] animate-[pulse_2.4s_ease-in-out_infinite]"
                  >
                    <span className="pointer-events-none absolute inset-0 bg-orange-200/25 opacity-0 blur-xl transition-opacity duration-300 group-hover/pay:opacity-100" />
                    <span className="relative z-10">
                      {t("marketplace.go_to_payment", {
                        defaultValue: "Оплатить и открыть",
                      })}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {showBalancePrompt &&
        createPortal(
          <div
            className="fixed inset-0 z-[3900] bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4 animate-[fadeIn_.18s_ease-out]"
            onClick={() => setShowBalancePrompt(false)}
          >
            <div
              className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-gray-200 overflow-hidden animate-[scaleIn_.18s_ease-out]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-orange-100 bg-gradient-to-r from-orange-50 to-white">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-600">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      width="20"
                      height="20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 8v5" />
                      <path d="M12 16h.01" />
                    </svg>
                  </div>

                  <div>
                    <div className="text-lg font-semibold text-gray-900">
                      {t("marketplace.balance_modal_title", {
                        defaultValue: "Недостаточно средств",
                      })}
                    </div>

                    <div className="mt-1 text-sm leading-6 text-gray-600">
                      {t("marketplace.balance_modal_text", {
                        defaultValue:
                          "Для открытия контактов на балансе недостаточно средств. Пополните баланс и вернитесь к этой карточке.",
                      })}
                    </div>
                  </div>
                </div>
              </div>
              <div className="px-5 py-4 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowBalancePrompt(false)}
                  className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  {t("common.cancel", { defaultValue: "Отмена" })}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowBalancePrompt(false);
                    navigate(`/client/balance?service_id=${id}`);
                  }}
                  className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-orange-200 transition hover:bg-orange-600 hover:shadow-orange-300 active:scale-[0.98]"
                >
                  {t("marketplace.go_to_balance", {
                    defaultValue: "Пополнить баланс",
                  })}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      <style>
        {`
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }

          @keyframes scaleIn {
            from { opacity: 0; transform: scale(0.96) translateY(8px); }
            to { opacity: 1; transform: scale(1) translateY(0); }
          }
        `}
      </style>

      {selectedProofImage &&
        createPortal(
          <div
            className="fixed inset-0 z-[4000] bg-black/85 flex items-center justify-center p-4"
            onClick={() => setSelectedProofImage(null)}
          >
            <div
              className="relative max-w-[95vw] max-h-[95vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="absolute -top-3 -right-3 w-9 h-9 rounded-full bg-white text-black shadow-lg text-lg font-semibold"
                onClick={() => setSelectedProofImage(null)}
                aria-label={t("common.close", { defaultValue: "Закрыть" })}
              >
                ×
              </button>
              <img
                src={selectedProofImage}
                alt=""
                className="max-w-[95vw] max-h-[95vh] object-contain rounded-2xl shadow-2xl"
              />
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
