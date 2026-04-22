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

/* ======== всплывающее окно с деталями тура (за карточкой) ======== */
function DetailsPopup({ open, anchorRef, onClose, children }) {
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!open) return;

    const update = () => {
      if (!anchorRef?.current) return;
      const r = anchorRef.current.getBoundingClientRect();
      const margin = 12;
      const width = 320;

      const x = Math.min(
        Math.max(margin, r.left),
        window.innerWidth - width - margin
      );
      const y = Math.min(
        window.innerHeight - margin,
        Math.max(margin, r.bottom + 4)
      );
      setPos({ x, y });
    };

    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
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
        <div className="w-[320px] max-w-[95vw] rounded-2xl bg-white shadow-2xl border border-gray-200 p-3 text-xs sm:text-sm max-h-[80vh] overflow-y-auto">
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

  if (!openedId || Number(openedId) !== Number(id)) return;

  setHighlighted(true);

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
}, [id]);
  
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

    if (res?.ok && (res?.unlocked || res?.already)) {
      if (typeof window !== "undefined" && unlockStorageKey) {
        window.localStorage.setItem(unlockStorageKey, "1");
      }

      setUnlocked(true);
      setShowUnlockSuccessModal(true);
      await postUnlockStep("unlock_success_modal_opened", {
        already: Boolean(res?.already),
      });

      window.dispatchEvent(new Event("client:balance:changed"));

      const chargedSum = Number(res?.charged_sum || 0);

      if (res?.already) {
        tSuccess(
          t("marketplace.contacts_already_opened", {
            defaultValue: "Контакты уже были открыты",
          })
        );
      } else {
        tSuccess(
          t("marketplace.contacts_unlocked_success", {
            amount: chargedSum.toLocaleString("ru-RU"),
            defaultValue: `💸 Списано ${chargedSum.toLocaleString("ru-RU")} сум · Контакты разблокированы`,
          })
        );
      }

      return;
    }

    if (res?.ok && res?.need_pay) {
      const nextShortfallSum = Number(
        res?.shortfall_sum || res?.order?.amount_sum || 0
      );

      setUnlockIntroPriceSum(nextShortfallSum);

      setUnlockPayModal({
        open: false,
        shortfallSum: nextShortfallSum,
        shortfallTiyin: Number(
          res?.shortfall_tiyin || res?.order?.amount_tiyin || 0
        ),
        payUrl: String(res?.pay_url || ""),
        orderId: Number(res?.order_id || res?.order?.id || 0) || null,
        serviceId: Number(res?.service_id || id) || Number(id) || null,
      });

      setShowUnlockIntroModal(true);
      await postUnlockStep("unlock_intro_opened", {
        shortfall_sum: nextShortfallSum,
        pay_url_exists: Boolean(res?.pay_url),
      });
      return;
    }

    if (res?.need_pay) {
      const nextShortfallSum = Number(
        res?.shortfall_sum || res?.order?.amount_sum || 0
      );

      setUnlockIntroPriceSum(nextShortfallSum);
      setShowUnlockIntroModal(true);
      await postUnlockStep("unlock_intro_opened", {
        shortfall_sum: nextShortfallSum,
        pay_url_exists: Boolean(res?.pay_url),
      });
      return;
    }

    throw new Error("unlock_failed");
  } catch (err) {
    const data = err?.response?.data || err?.data || {};
    const code = data?.code || data?.error || err?.code;

    if (
      data?.need_pay ||
      code === "INSUFFICIENT_BALANCE" ||
      code === "not_enough_balance"
    ) {
      const shortfallSum = Number(data?.shortfall_sum || data?.order?.amount_sum || 0);

      setUnlockIntroPriceSum(shortfallSum || 0);

      setUnlockPayModal({
        open: false,
        shortfallSum,
        shortfallTiyin: Number(
          data?.shortfall_tiyin || data?.order?.amount_tiyin || 0
        ),
        payUrl: String(data?.pay_url || ""),
        orderId: Number(data?.order_id || data?.order?.id || 0) || null,
        serviceId: Number(data?.service_id || id) || Number(id) || null,
      });

      setShowUnlockIntroModal(true);
      await postUnlockStep("unlock_intro_opened", {
        shortfall_sum: shortfallSum,
        pay_url_exists: Boolean(data?.pay_url),
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
          "group relative border rounded-xl overflow-hidden shadow-sm flex flex-col transition",
          unlocked
            ? "bg-gray-50 border-gray-200 opacity-90"
            : "bg-white border-gray-200",
          highlighted ? "ring-2 ring-orange-400 shadow-xl" : "",
          className,
        ].join(" ")}
        >
        {/* IMAGES */}
        <div
          className="h-48 sm:h-60 bg-gray-100 relative select-none overflow-hidden"
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
            <div className="flex items-center gap-2 ml-0 sm:ml-0 flex-wrap">
              {categorySticker && (
                <span
                  className={[
                    "pointer-events-auto inline-flex items-center rounded-full px-2.5 py-1 text-[10px] sm:text-[11px] font-extrabold uppercase tracking-wide shadow-lg backdrop-blur-md",
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
                <span className="pointer-events-auto inline-flex items-center gap-1 rounded-full bg-emerald-600/95 text-white text-xs px-2 py-0.5 ring-1 ring-white/20 backdrop-blur-md">
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
        <div className="p-3 flex-1 flex flex-col">
          <div className="flex items-start gap-2">
            <div className="font-semibold line-clamp-2">{title}</div>

            {unlocked && isClientViewer && (
              <span className="shrink-0 inline-flex items-center rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[11px] font-semibold">
                {t("marketplace.already_opened", { defaultValue: "Уже открыто" })}
              </span>
            )}
          </div>

          {direction && (
            <div className="mt-1 text-xs text-gray-700">{direction}</div>
          )}
          {dates && (
            <div className="text-xs text-gray-500">
              {t("marketplace.dates_label", { defaultValue: "Даты" })}: {dates}
            </div>
          )}

            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] sm:text-[11px]">
              {viewsCount > 0 && (
                <span className="inline-flex max-w-full items-center rounded-full border border-gray-200 bg-white px-2 py-0.5 text-gray-600">
                  <span className="mr-1">👁</span>
                  <span>{viewsCount}</span>
                </span>
              )}
            
              {watchingNow > 0 && (
                <span className="inline-flex max-w-full items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 font-semibold text-red-600 animate-pulse">
                  <span className="mr-1">⚡</span>
                  <span className="truncate">
                    {watchingNow} {t("marketplace.watching_now", { defaultValue: "смотрят сейчас" })}
                  </span>
                </span>
              )}
            
              {unlocksCount > 0 && (
                <span className="inline-flex max-w-full items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                  <span className="mr-1">🔓</span>
                  <span className="truncate">
                    {unlocksCount} {t("marketplace.opened_contacts_count", { defaultValue: "открыли контакты" })}
                  </span>
                </span>
              )}
            </div>
          
            {prettyPrice && (
              <div className="mt-3 overflow-hidden rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 via-white to-amber-50 shadow-sm">
                <div className="px-3 pt-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-orange-700/70">
                        {t("marketplace.price") || "Цена"}
                      </div>
            
                      <div className="mt-1 flex items-end gap-2">
                        <div className="text-3xl sm:text-[34px] font-black leading-none text-gray-900 tracking-tight">
                          {prettyPrice}
                        </div>
                      
                        <div className="mb-0.5 text-[11px] font-semibold text-orange-700/80">
                          {t("marketplace.price_currency", { defaultValue: "у.е." })}
                        </div>
                      </div>
                    </div>
            
                    {!isExpired && expireAt && (
                      <div className="shrink-0 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-600 animate-pulse">
                        {t("marketplace.hurry_up", { defaultValue: "Успейте" })}
                      </div>
                    )}
                  </div>
            
                  {!unlocked && (
                    <div className="mt-2 text-[11px] font-medium text-orange-700">
                      🔥 {t("marketplace.price_hint", { defaultValue: "Выгодное предложение" })}
                    </div>
                  )}
                </div>
            
                {!unlocked && (
                  <div className="mt-3 flex items-center justify-between border-t border-orange-100 bg-white/70 px-3 py-2">
                    <div className="text-[11px] text-gray-600">
                      {t("marketplace.contacts_inside_hint", {
                        defaultValue: "Контакты откроются сразу после оплаты",
                      })}
                    </div>
            
                  <button
                    onClick={openUnlockIntro}
                    className="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-[12px] font-semibold shadow hover:bg-orange-600 active:scale-95 transition"
                  >
                    🔓 {t("marketplace.open_now", { defaultValue: "Открыть" })}
                  </button>
                  </div>
                )}
              </div>
            )}
          
          {(details.insuranceIncluded || details.earlyCheckIn || details.arrivalFastTrack) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {details.insuranceIncluded && (
                <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 text-[11px] font-medium">
                  🛡 {t("insurance_included")}
                </span>
              )}
          
              {details.earlyCheckIn && (
                <span className="inline-flex items-center rounded-full bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1 text-[11px] font-medium">
                  🏨 {t("early_check_in")}
                </span>
              )}
          
              {details.arrivalFastTrack && (
                <span className="inline-flex items-center rounded-full bg-violet-50 text-violet-700 border border-violet-200 px-2.5 py-1 text-[11px] font-medium">
                  🛬 {t("arrival_fast_track")}
                </span>
              )}
            </div>
          )}

          {hasProof && (
            <div className="mt-3 rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white px-3 py-3 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-emerald-700">
                  {t("marketplace.proof_images", {
                    defaultValue: "Подтверждение подлинности",
                  })}
                </div>
                <div className="text-[11px] text-emerald-700/80">
                  {proofImages.length}{" "}
                  {t("marketplace.proof_images_count", {
                    defaultValue: "фото",
                  })}
                </div>
              </div>

              {canViewProof ? (
                <>
                  <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                    {proofImages.slice(0, 4).map((img, i) => (
                      <button
                        key={`${id}-proof-${i}`}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedProofImage(img);
                        }}
                        className="relative shrink-0 rounded-xl overflow-hidden border border-emerald-200 bg-white hover:opacity-90"
                        title={t("marketplace.open_proof_image", {
                          defaultValue: "Открыть изображение",
                        })}
                      >
                        <img
                          src={img}
                          alt=""
                          className="w-16 h-16 sm:w-20 sm:h-20 object-cover"
                        />
                      </button>
                    ))}

                    {proofImages.length > 4 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetailsOpen(true);
                        }}
                        className="w-16 h-16 sm:w-20 sm:h-20 shrink-0 flex items-center justify-center rounded-xl bg-emerald-700 text-white text-sm font-semibold"
                      >
                        +{proofImages.length - 4}
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    className="mt-2 text-xs font-semibold text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDetailsOpen(true);
                    }}
                  >
                    {t("marketplace.check_authenticity", {
                      defaultValue: "Проверить подлинность",
                    })}
                  </button>
                </>
              ) : (
                <div className="mt-2 rounded-lg bg-white/80 border border-emerald-100 px-3 py-2 text-xs text-gray-700">
                  {t("marketplace.proof_locked_hint", {
                    defaultValue:
                      "Подтверждение есть. Проверка доступна после открытия контактов.",
                  })}
                </div>
              )}
            </div>
          )}

{(unlocked || isProviderViewer || isAdminViewer) &&
  (supplierName || supplierPhone || supplierTg?.label) && (
    <div className="mt-2 text-sm space-y-2">
      {supplierName && (
        <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2">
          <div className="text-[11px] text-gray-500">
            {t("marketplace.supplier") || "Поставщик"}
          </div>

          {providerId ? (
            <a
              href={`/profile/provider/${providerId}`}
              onClick={(e) => e.stopPropagation()}
              className="max-w-[60%] truncate text-sm font-semibold text-gray-900 hover:underline"
            >
              {supplierName}
            </a>
          ) : (
            <span className="max-w-[60%] truncate text-sm font-semibold text-gray-900">
              {supplierName}
            </span>
          )}
        </div>
      )}

      {unlocked ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
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
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-green-500 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition active:scale-[0.98] hover:bg-green-600"
              title={supplierPhone}
            >
              <span>📞</span>
              <span>
                {t("marketplace.call", { defaultValue: "Позвонить" })}
              </span>
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
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#229ED9] px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition active:scale-[0.98] hover:bg-[#1d8ecf]"
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
              <span>
                {t("common.telegram", { defaultValue: "Telegram" })}
              </span>
            </a>
          )}
        </div>
      ) : (
        (supplierPhone || supplierTg?.label) && (
          <div className="rounded-lg bg-gray-50 border px-3 py-2 text-xs text-gray-600">
            {t("marketplace.contacts_locked", {
              defaultValue:
                "Контакты поставщика скрыты. Откройте контакты, чтобы увидеть телефон и Telegram.",
            })}
          </div>
        )
      )}
    </div>
  )}

{!unlocked && !isProviderViewer && !isAdminViewer && (
  <div className="mt-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-3 text-sm text-orange-700 font-medium">
    🔒{" "}
    {t("marketplace.unlock_supplier_hint", {
      defaultValue:
        "Поставщик скрыт. Откройте контакты, чтобы увидеть и связаться напрямую.",
    })}
  </div>
)}

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

          {!unlocked && !isProviderViewer && !isAdminViewer && (
            <div className="mt-3 space-y-2">
              {unlocksCount > 0 && (
                <div className="flex items-center gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  <span className="text-base leading-none">✅</span>
                  <span className="font-medium">
                    {t("marketplace.opened_contacts_cta", {
                      count: unlocksCount,
                      defaultValue: `Уже открыли контакты: ${unlocksCount}`,
                    })}
                  </span>
                </div>
              )}
          
              {expireAt && !isExpired && (
                <div className="flex items-center gap-2 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  <span className="text-base leading-none">⏳</span>
                  <span className="font-medium">
                    {t("marketplace.offer_may_expire_anytime", {
                      defaultValue: "Предложение может стать неактуальным в любой момент",
                    })}
                  </span>
                </div>
              )}
            </div>
          )}
          <div className="mt-auto pt-3 space-y-2">
              {canShowUnlockButton && (
                <>
                  <button
                    type="button"
                    onClick={openUnlockIntro}
                    disabled={unlockLoading || unlockIntroLoading}
                    className={[
                      "w-full rounded-2xl px-4 py-3.5 text-sm font-semibold text-white transition disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.99]",
                      !isExpired && expireAt
                        ? "bg-gradient-to-r from-orange-500 via-orange-500 to-red-500 shadow-lg shadow-orange-200 hover:from-orange-600 hover:via-orange-600 hover:to-red-600"
                        : "bg-black hover:bg-gray-900",
                    ].join(" ")}
                  >
                    {unlockLoading || unlockIntroLoading ? (
                      t("marketplace.unlocking", { defaultValue: "Открытие..." })
                    ) : (
                      <span className="inline-flex items-center justify-center gap-2">
                        <span>🔓</span>
                        <span>
                        {t("marketplace.unlock_contacts_cta_primary", {
                          defaultValue: "Открыть телефон и Telegram",
                        })}
                        </span>
                      </span>
                    )}
                  </button>
              
                  <p className="text-[12px] leading-5 text-gray-500">
                    {t("marketplace.unlock_contacts_cta_hint", {
                      defaultValue: "Контакты откроются сразу после оплаты",
                    })}
                  </p>
                </>
              )}

              {showBookButton ? (
                <a
                  href={`/profile/provider/${providerId}?service=${id}#book`}
                  className="w-full inline-flex items-center justify-center rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5 text-sm font-semibold text-orange-700 transition hover:bg-orange-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  {t("actions.book") || "Бронировать"}
                </a>
              ) : (
              <button
                onClick={() => onQuickRequest?.(id, providerId, title)}
                className="w-full rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5 text-sm font-semibold text-orange-700 transition hover:bg-orange-100"
              >
                {t("actions.quick_request") || "Быстрый запрос"}
              </button>
            )}
          </div>
        </div>
      </div>

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
              {t("marketplace.dates_label", { defaultValue: "Даты" })}:{" "}
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
        {details.insuranceIncluded && (
          <div className="text-xs sm:text-sm mb-1">
            <span className="text-gray-500">
              {t("insurance_included")}:{" "}
            </span>
            <span className="font-medium">✓</span>
          </div>
        )}
        {details.earlyCheckIn && (
          <div className="text-xs sm:text-sm mb-1">
            <span className="text-gray-500">
              {t("early_check_in")}:{" "}
            </span>
            <span className="font-medium">✓</span>
          </div>
        )}
        {details.arrivalFastTrack && (
          <div className="text-xs sm:text-sm mb-1">
            <span className="text-gray-500">
              {t("arrival_fast_track")}:{" "}
            </span>
            <span className="font-medium">✓</span>
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

        {hasProof && (
          <div className="mt-3 mb-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="font-semibold text-emerald-700">
                {t("marketplace.proof_images", {
                  defaultValue: "Подтверждение подлинности",
                })}
              </div>
              <div className="text-[11px] text-emerald-700/80">
                {proofImages.length}{" "}
                {t("marketplace.proof_images_count", {
                  defaultValue: "фото",
                })}
              </div>
            </div>

            {canViewProof ? (
              <div className="grid grid-cols-2 gap-2">
                {proofImages.map((img, i) => (
                  <button
                    key={`${id}-proof-popup-${i}`}
                    type="button"
                    className="rounded-xl overflow-hidden border border-emerald-200 bg-white hover:opacity-90"
                    onClick={() => setSelectedProofImage(img)}
                  >
                    <img
                      src={img}
                      alt=""
                      className="w-full h-24 object-cover"
                    />
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-lg bg-white/80 border border-emerald-100 px-3 py-2 text-xs text-gray-700">
                {t("marketplace.proof_locked_hint", {
                  defaultValue:
                    "Подтверждение есть. Проверка доступна после открытия контактов.",
                })}
              </div>
            )}
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
      
      {showUnlockIntroModal &&
        createPortal(
          <div
            className="fixed inset-0 z-[3940] flex items-center justify-center bg-black/50 px-4 animate-[fadeIn_.18s_ease-out]"
            onClick={async () => {
              await postUnlockStep("unlock_intro_closed");
              setShowUnlockIntroModal(false);
            }}
          >
            <div
              className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl border border-gray-200 animate-[scaleIn_.18s_ease-out]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-gradient-to-r from-orange-500 to-amber-400 px-6 py-5 text-white">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 text-2xl">
                    ⚡
                  </div>
                  <div>
                    <h3 className="text-lg font-bold leading-tight">
                      {t("marketplace.unlock_intro_title", {
                        defaultValue: "Открытие контактов",
                      })}
                    </h3>
                    <p className="text-sm text-white/90">
                      {t("marketplace.unlock_intro_subtitle", {
                        defaultValue: "Этот вариант могут забрать в любой момент",
                      })}
                    </p>
                  </div>
                </div>
              </div>
      
              <div className="px-6 py-5">
                <div className="rounded-2xl border border-orange-100 bg-orange-50 px-4 py-4">
                  {title && (
                    <div className="text-base font-bold text-gray-900 leading-snug">
                      {title}
                    </div>
                  )}
      
                  {direction && (
                    <div className="mt-1 text-sm text-gray-600">
                      {direction}
                    </div>
                  )}
      
                  {dates && (
                    <div className="mt-1 text-sm text-gray-600">
                      {t("marketplace.dates_label", { defaultValue: "Даты" })}: {dates}
                    </div>
                  )}
      
                  {prettyPrice && (
                    <div className="mt-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-orange-700/80">
                        {t("marketplace.price", { defaultValue: "Цена" })}
                      </div>
                      <div className="text-2xl font-bold text-gray-900">
                        {prettyPrice}
                      </div>
                    </div>
                  )}
                </div>
      
                <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
                  <div className="text-sm font-semibold text-gray-900">
                    {t("marketplace.unlock_intro_whats_inside", {
                      defaultValue: "Что откроется после оплаты",
                    })}
                  </div>
      
              <div className="mt-3 space-y-2 text-sm text-gray-700">
  <div className="flex items-center gap-2">
    <span className="text-base">📞</span>
    <span>
      {t("marketplace.unlock_intro_phone", {
        defaultValue: "Телефон поставщика",
      })}
    </span>
  </div>

  <div className="flex items-center gap-2">
    <span className="text-base">✈️</span>
    <span>
      {t("marketplace.unlock_intro_fast_booking", {
        defaultValue: "Быстрая связь для бронирования",
      })}
    </span>
  </div>

  <div className="flex items-center gap-2">
    <span className="text-base">💬</span>
    <span>
      {t("marketplace.unlock_intro_telegram", {
        defaultValue: "Telegram поставщика",
      })}
    </span>
  </div>

  {hasProof && (
    <div className="flex items-center gap-2">
      <span className="text-base">🛡️</span>
      <span>
        {t("marketplace.unlock_intro_benefit_proof", {
          defaultValue: "Подтверждение / proof",
        })}
      </span>
    </div>
  )}
</div>              </div>
      
                <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3">
                  <div className="text-sm font-semibold text-red-700">
                    {watchingNow > 0
                      ? t("marketplace.unlock_intro_urgency_watching_title", {
                          count: watchingNow,
                          defaultValue: `Сейчас смотрят: ${watchingNow}`,
                        })
                      : unlocksCount > 0
                      ? t("marketplace.unlock_intro_urgency_unlocked_title", {
                          count: unlocksCount,
                          defaultValue: `Уже открыли контакты: ${unlocksCount}`,
                        })
                      : t("marketplace.unlock_intro_urgency", {
                          defaultValue: "Такие варианты часто бронируют очень быстро",
                        })}
                  </div>
                
                  <div className="mt-1 text-xs text-red-600">
                    {watchingNow > 0
                      ? t("marketplace.unlock_intro_dynamic_watching", {
                          count: watchingNow,
                          defaultValue: `Сейчас эту услугу смотрят ${watchingNow} чел.`,
                        })
                      : unlocksCount > 0
                      ? t("marketplace.unlock_intro_dynamic_unlocked", {
                          count: unlocksCount,
                          defaultValue: `Контакты уже открывали ${unlocksCount} раз`,
                        })
                      : t("marketplace.unlock_intro_dynamic_default", {
                          defaultValue:
                            "Такие варианты могут быстро стать неактуальными, лучше связаться с поставщиком сразу.",
                        })}
                  </div>
                </div>
      
                <div className="mt-4 overflow-hidden rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 via-white to-amber-50 shadow-sm">
                  <div className="px-4 py-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-orange-700/70">
                      {t("marketplace.unlock_intro_price_label", {
                        defaultValue: "Стоимость открытия",
                      })}
                    </div>
                
                    <div className="mt-2 flex items-end gap-2">
                      <div className="text-4xl font-black tracking-tight leading-none text-gray-900">
                        {Number(unlockIntroPriceSum || unlockPayModal.shortfallSum || 0).toLocaleString("ru-RU")}
                      </div>
                
                    <div className="mb-1 text-base font-semibold text-orange-700/80">
                      {t("marketplace.price_currency", { defaultValue: "у.е." })}
                    </div>
                    </div>
                
                    <div className="mt-2 inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-600 animate-pulse">
                      🔥 {t("marketplace.unlock_intro_price_hint", {
                        defaultValue: "Открывается сразу после оплаты",
                      })}
                    </div>
                  </div>
                
                  <div className="border-t border-orange-100 bg-white/70 px-4 py-2 text-[11px] text-gray-600">
                    {t("marketplace.unlock_intro_price_subhint", {
                      defaultValue: "После оплаты телефон и Telegram поставщика станут доступны в этой карточке.",
                    })}
                  </div>
                </div>
      
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={async () => {
                      await postUnlockStep("unlock_intro_closed");
                      setShowUnlockIntroModal(false);
                    }}
                    className="inline-flex w-full items-center justify-center rounded-2xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
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
                    className="inline-flex w-full items-center justify-center rounded-2xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-200 transition hover:bg-orange-600"
                  >
                    {unlockLoading
                      ? t("marketplace.unlocking", { defaultValue: "Открытие..." })
                      : t("marketplace.unlock_intro_cta", {
                          defaultValue: "Продолжить",
                        })}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
        {showUnlockSuccessModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-[95%] max-w-md p-6 animate-[scaleIn_0.25s_ease]">
        
              {/* HEADER */}
              <div className="flex flex-col items-center text-center mb-4">
                <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mb-3 animate-pulse">
                  <span className="text-green-600 text-2xl">✔</span>
                </div>
        
                <h2 className="text-lg font-semibold">
                  {t("marketplace.unlock_success_title", {
                    defaultValue: "Контакты открыты",
                  })}
                </h2>
        
                <p className="text-sm text-gray-500">
                  {t("marketplace.unlock_success_subtitle", {
                    defaultValue: "Можно сразу связаться с поставщиком",
                  })}
                </p>
              </div>
        
              {/* CONTACTS */}
              <div className="space-y-3">
        
                {/* NAME */}
                {supplierName && (
                  <div className="text-sm text-gray-800 font-medium">
                    {supplierName}
                  </div>
                )}
        
                {/* PHONE */}
                {supplierPhone && (
                  <div className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
                    <span className="text-sm">{supplierPhone}</span>
        
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => copyTextSafe(supplierPhone, "phone")}
                        className="text-xs px-2 py-1 bg-gray-200 rounded-lg"
                      >
                        {copiedPhone
                          ? t("common.copied", { defaultValue: "Скопировано" })
                          : t("common.copy", { defaultValue: "Копировать" })}
                      </button>
        
                      <a
                        href={normalizePhoneHref(supplierPhone)}
                        onClick={() =>
                          postUnlockStep("unlock_phone_clicked", {
                            has_phone: true,
                            has_telegram: Boolean(supplierTg?.href),
                          })
                        }
                        className="text-xs px-2 py-1 bg-green-500 text-white rounded-lg"
                      >
                        {t("marketplace.call", { defaultValue: "Позвонить" })}
                      </a>
                    </div>
                  </div>
                )}
        
                {/* TELEGRAM */}
                {supplierTg?.label && (
                  <div className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
                    <span className="text-sm">{supplierTg.label}</span>
        
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => copyTextSafe(supplierTg.label, "tg")}
                        className="text-xs px-2 py-1 bg-gray-200 rounded-lg"
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
                              has_phone: Boolean(supplierPhone),
                              has_telegram: true,
                            })
                          }
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs px-2 py-1 bg-blue-500 text-white rounded-lg"
                        >
                          {t("common.telegram", { defaultValue: "Telegram" })}
                        </a>
                      )}
                    </div>
                  </div>
                )}
        
              </div>
        
              <p className="mt-4 text-sm leading-6 text-gray-600 text-center">
                {t("marketplace.unlock_success_action_text", {
                  defaultValue: "Свяжитесь сейчас, пока предложение ещё актуально.",
                })}
              </p>
        
              <div className="mt-3 text-xs text-gray-500 text-center">
                {t("marketplace.unlock_success_saved_hint", {
                  defaultValue: "Контакты получены после успешной оплаты и уже сохранены в этой карточке",
                })}
              </div>
        
              {/* ACTION */}
              <button
                type="button"
                onClick={() => setShowUnlockSuccessModal(false)}
                className="mt-5 w-full bg-black text-white py-2 rounded-xl font-medium"
              >
                {t("common.close", { defaultValue: "Закрыть" })}
              </button>
        
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
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 text-2xl">
                    🔓
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
                    className="inline-flex w-full items-center justify-center rounded-2xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-200 transition hover:bg-orange-600"
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
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 text-2xl">
                    💳
                  </div>
                  <div>
                    <h3 className="text-lg font-bold leading-tight">
                      {t("marketplace.pay_modal_title", {
                        defaultValue: "Пополнение для открытия контактов",
                      })}
                    </h3>
                    <p className="text-sm text-white/90">
                      {t("marketplace.pay_modal_subtitle", {
                        defaultValue: "Перед оплатой проверьте сумму пополнения",
                      })}
                    </p>
                  </div>
                </div>
              </div>

              <div className="px-6 py-5">
                <div className="rounded-2xl border border-orange-100 bg-orange-50 px-4 py-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-orange-700/80">
                  {t("marketplace.pay_modal_amount_label", {
                    defaultValue: "Сумма для мгновенного открытия контактов",
                  })}
                  </div>
                  <div className="mt-1 text-3xl font-bold tracking-tight text-gray-900">
                    {Number(unlockPayModal.shortfallSum || 0).toLocaleString("ru-RU")} 
                    <span className="text-xl font-semibold text-gray-700">
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

                <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 text-lg">✨</div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        {t("marketplace.pay_modal_hint_title", {
                          defaultValue: "Что будет после оплаты",
                        })}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-gray-600">
                        {t("marketplace.pay_modal_hint_text", {
                          defaultValue:
                            "После успешной оплаты контакты поставщика откроются автоматически, и вы вернётесь к этой карточке.",
                        })}
                      </p>
                    </div>
                  </div>
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
                    className="inline-flex w-full items-center justify-center rounded-2xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-200 transition hover:bg-orange-600"
                  >
                    {t("marketplace.go_to_payment", {
                      defaultValue: "Перейти к оплате",
                    })}
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
