//frontend/src/pages/Marketplace.jsx

import { useEffect, useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../api";
import QuickRequestModal from "../components/QuickRequestModal";
import ServiceCard from "../components/ServiceCard";
import { apiProviderFavorites, apiToggleProviderFavorite } from "../api/providerFavorites";
import { tSuccess, tInfo, tError } from "../shared/toast";

// актуальная роль из localStorage
function getRole() {
  const hasClient = !!localStorage.getItem("clientToken");
  const hasProvider = !!localStorage.getItem("token") || !!localStorage.getItem("providerToken");
  return hasClient ? "client" : (hasProvider ? "provider" : null);
}

/* ===================== sections (Top/New/Upcoming) ===================== */
const SECTIONS = [
  { key: "top",      labelKey: "marketplace.sections.top",       fallback: "Top" },
  { key: "new",      labelKey: "marketplace.sections.new",       fallback: "Новые" },
  { key: "upcoming", labelKey: "marketplace.sections.upcoming",  fallback: "Ближайшие" },
];
const SECTION_LIMIT = 12;


/* ===================== utils ===================== */

// универсальный нормализатор ответа (ищет массив в любой обёртке)
function normalizeList(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;

  const queue = [];
  const seen = new Set();
  const push = (node) => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    queue.push(node);
  };

  push(res);

  const preferred = [
    "items",
    "data",
    "list",
    "rows",
    "results",
    "result",
    "services",
    "docs",
    "records",
    "hits",
    "content",
    "payload",
  ];

  while (queue.length) {
    const node = queue.shift();

    if (Array.isArray(node)) {
      if (node.some((v) => v && typeof v === "object")) return node;
      continue;
    }
    for (const k of preferred) if (k in node) push(node[k]);
    for (const k of Object.keys(node)) if (!preferred.includes(k)) push(node[k]);
  }
  return [];
}

function pick(obj, keys) {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (v === 0 || (v !== undefined && v !== null && String(v).trim() !== "")) return v;
  }
  return null;
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

// --- Видимость карточки только для Marketplace (учитываем "Актуально" и таймер)
function parseDetails(svc) {
  const d = svc?.details;
  if (!d) return {};
  if (typeof d === "string") {
    try { return JSON.parse(d); } catch { return {}; }
  }
  return d || {};
}

function parseDateFlexible(val) {
  if (!val) return null;

  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? null : val;
  }

  const s = String(val).trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    let [, y, a, b] = m;
    let mm = Number(a);
    let dd = Number(b);

    if (mm > 12 && dd >= 1 && dd <= 12) {
      [mm, dd] = [dd, mm];
    }

    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const d = new Date(`${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}T00:00:00`);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }

  m = s.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  if (m) {
    const [, y, mm, dd] = m;
    const d = new Date(`${y}-${mm}-${dd}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) {
    const [, dd, mm, y] = m;
    const d = new Date(`${y}-${mm}-${dd}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (/^\d{10,13}$/.test(s)) {
    const num = Number(s);
    const d = new Date(s.length === 13 ? num : num * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function hasTimePart(val) {
  if (!val) return false;
  return /[T ]\d{2}:\d{2}/.test(String(val).trim());
}

function formatYmdInTashkent(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const map = {};
  for (const p of parts) map[p.type] = p.value;

  if (!map.year || !map.month || !map.day) return null;
  return `${map.year}-${map.month}-${map.day}`;
}

function todayYmdInTashkent() {
  return formatYmdInTashkent(new Date());
}

function dateOnlyIsPast(raw) {
  const parsed = parseDateFlexible(raw);
  if (!parsed) return false;

  const candidateYmd =
    typeof raw === "string" && /^\d{4}[-.]\d{2}[-.]\d{2}$/.test(raw.trim())
      ? raw.trim().replace(/\./g, "-")
      : formatYmdInTashkent(parsed);

  const todayYmd = todayYmdInTashkent();
  if (!candidateYmd || !todayYmd) return false;

  return candidateYmd < todayYmd;
}

function dateTimeIsPast(raw) {
  const parsed = parseDateFlexible(raw);
  if (!parsed) return false;
  return parsed.getTime() < Date.now();
}

function isMomentPassed(raw) {
  if (!raw) return false;
  return hasTimePart(raw) ? dateTimeIsPast(raw) : dateOnlyIsPast(raw);
}

function pickPrimaryServiceDate(svc, d) {
  const category = String(svc?.category || d?.category || "").toLowerCase();

  if (category === "refused_tour") {
    return (
      d?.endDate ||
      d?.end_date ||
      d?.returnFlightDate ||
      d?.returnDate ||
      d?.startDate ||
      d?.start_date
    );
  }

  if (category === "refused_hotel") {
    return (
      d?.checkOut ||
      d?.check_out ||
      d?.hotel_check_out ||
      d?.endDate ||
      d?.end_date ||
      d?.checkIn ||
      d?.check_in ||
      d?.hotel_check_in
    );
  }

  if (category === "refused_flight") {
    return (
      d?.returnFlightDate ||
      d?.return_flight_date ||
      d?.endFlightDate ||
      d?.end_flight_date ||
      d?.departureFlightDate ||
      d?.departure_date ||
      d?.startDate
    );
  }

  if (category === "refused_ticket" || category === "refused_event_ticket") {
    return (
      d?.eventDate ||
      d?.event_date ||
      d?.startDate ||
      d?.start_date ||
      d?.date
    );
  }

  return (
    d?.endDate ||
    d?.end_date ||
    d?.checkOut ||
    d?.check_out ||
    d?.hotel_check_out ||
    d?.returnFlightDate ||
    d?.eventDate ||
    d?.startDate ||
    d?.date
  );
}

function isMarketplaceVisible(it, nowTs = Date.now()) {
  const svc = it?.service || it || {};
  const d = parseDetails(svc);

  if (d.isActive === false) return false;

  const primaryDate = pickPrimaryServiceDate(svc, d);
  if (primaryDate && isMomentPassed(primaryDate)) return false;

  const exp = resolveExpireAt(svc);
  if (exp && nowTs > exp) return false;

  return true;
}

/* ---------- маленький компонент звёзд ---------- */
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

/* ---------- тултип через портал (над карточкой) ---------- */
function TooltipPortal({ visible, x, y, children }) {
  if (!visible) return null;
  return createPortal(
    <div className="fixed z-[3000] pointer-events-none" style={{ top: y, left: x }}>
      {children}
    </div>,
    document.body
  );
}

/* --- форматирование Telegram --- */
function renderTelegram(value) {
  if (!value) return null;
  const s = String(value).trim();
  let href = null;
  let label = s;
  if (/^https?:\/\//i.test(s)) href = s;
  else if (s.startsWith("@")) { href = `https://t.me/${s.slice(1)}`; label = s; }
  else if (/^[A-Za-z0-9_]+$/.test(s)) { href = `https://t.me/${s}`; label = `@${s}`; }
  return { href, label };
}

/* ======== provider fetch (cache + fallbacks) ======== */

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

/* ===== Универсальный парсер полей услуги ===== */
function _firstNonEmpty(...args) {
  for (const v of args) if (v === 0 || (v !== undefined && v !== null && String(v).trim() !== "")) return v;
  return null;
}
function _maybeParse(obj) {
  if (!obj) return null;
  if (typeof obj === "string") { try { return JSON.parse(obj); } catch { return null; } }
  return typeof obj === "object" ? obj : null;
}
function _mergeDetails(svc, it) {
  const cands = [
    svc?.details, it?.details, svc?.detail, it?.detail,
    svc?.meta, svc?.params, svc?.payload, svc?.extra, svc?.data, svc?.info,
  ].map(_maybeParse).filter(Boolean);
  return Object.assign({}, ...cands);
}
function extractServiceFields(item, viewerRole = getRole()) {
  const svc = item?.service || item || {};
  const details = _mergeDetails(svc, item);
  const bag = { ...details, ...svc, ...item };

  const title = _firstNonEmpty(
    svc.title, svc.name, details?.title, details?.name, details?.eventName, item?.title, item?.name
  );

  const rawPrice = (viewerRole === "client")
    ? _firstNonEmpty(
        details?.grossPrice, details?.priceGross, details?.totalPrice, svc.grossPrice, svc.price_gross
      )
    : _firstNonEmpty(
        details?.netPrice, details?.price, details?.totalPrice, details?.priceNet,
        svc.netPrice, svc.price, item?.price, details?.grossPrice // last fallback
      );
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

  // inline объект, если есть
  const inlineProvider = _firstNonEmpty(
    svc.provider, svc.provider_profile, svc.supplier, svc.vendor, svc.agency, svc.owner,
    item.provider, item.provider_profile, item.supplier, item.vendor, item.agency, item.owner,
    details?.provider
  ) || {};

  // id провайдера (включая id из inline-объекта)
  const providerId = _firstNonEmpty(
    svc.provider_id, svc.providerId, item.provider_id, item.providerId, details?.provider_id,
    svc.owner_id, svc.agency_id, inlineProvider?.id, inlineProvider?._id
  );

  // плоские поля — как запасной вариант
  const flatName = _firstNonEmpty(
    pick(bag, ["provider_name","supplier_name","vendor_name","agency_name","company_name","providerTitle","display_name"])
  );
  const flatPhone = _firstNonEmpty(
    pick(bag, ["provider_phone","supplier_phone","vendor_phone","agency_phone","company_phone","contact_phone","phone","whatsapp","whats_app"])
  );
  const flatTg = _firstNonEmpty(
  pick(bag, [
    "provider_telegram","supplier_telegram","vendor_telegram","agency_telegram","company_telegram",
    "telegram","tg","telegram_username","telegram_link",
    // + варианты с social
    "provider_social","supplier_social","vendor_social","agency_social","company_social",
    "social","social_link"
  ])
);


  const status = _firstNonEmpty(svc.status, item.status, details?.status);

  return {
    svc, details, title, hotel, accommodation, dates, rawPrice, prettyPrice,
    inlineProvider, providerId, flatName, flatPhone, flatTg, status
  };
}

/* ---------- резолвер картинки (с санитизацией) ---------- */
function firstImageFrom(val) {
  // строка
  if (typeof val === "string") {
    let s = val.trim();
    if (!s) return null;

    // data:image/... — чистим пробелы/переносы и добавляем запятую после ;base64 при необходимости
    if (/^data:image\//i.test(s)) {
      s = s.replace(/\s+/g, "");
      if (/;base64(?!,)/i.test(s)) s = s.replace(/;base64/i, ";base64,");
      return s;
    }

    // «голая» base64 (включая строки с пробелами/переносами)
    if (/^[A-Za-z0-9+/=\s]+$/.test(s) && s.replace(/\s+/g, "").length > 100) {
      return `data:image/jpeg;base64,${s.replace(/\s+/g, "")}`;
    }

    // полноценный src (URL, blob, file, абсолютный /)
    if (/^(https?:|blob:|file:|\/)/i.test(s)) return s;

    // относительный путь без начального / — тащим к корню сайта
    // (чтобы не получилось /marketplace/uploads/..., если приложение на роуте)
    return `${window.location.origin}/${s.replace(/^\.?\//, "")}`;
  }

  // массив
  if (Array.isArray(val)) {
    for (const v of val) {
      const hit = firstImageFrom(v);
      if (hit) return hit;
    }
    return null;
  }

  // объект {url|src|href|link|path|data|base64}
  if (val && typeof val === "object") {
    return firstImageFrom(
      val.url ?? val.src ?? val.href ?? val.link ?? val.path ?? val.data ?? val.base64
    );
  }

  return null;
}


/* ===================== страница ===================== */

export default function Marketplace() {
  
  const { t } = useTranslation();
  
    // авторизация: считаем залогиненным, если есть любой из токенов
  const [isLoggedIn, setIsLoggedIn] = useState(
    !!(localStorage.getItem("token") || localStorage.getItem("clientToken"))
  );
  useEffect(() => {
    const onStorage = () =>
      setIsLoggedIn(!!(localStorage.getItem("token") || localStorage.getItem("clientToken")));
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  
    const [role, setRole] = useState(getRole());
  // обновляем роль при изменении localStorage (логин/логаут в этом/другом табе)
  useEffect(() => {
    const onAuthChanged = () => setRole(getRole());
    window.addEventListener("storage", onAuthChanged);
    window.addEventListener("auth:changed", onAuthChanged); // см. ниже про ClientLogin
    return () => {
      window.removeEventListener("storage", onAuthChanged);
      window.removeEventListener("auth:changed", onAuthChanged);
    };
  }, []);

  // модалка быстрого запроса
  const [qrOpen, setQrOpen] = useState(false);
  const [qrServiceId, setQrServiceId] = useState(null);
  const [qrProviderId, setQrProviderId] = useState(null);
  const [qrServiceTitle, setQrServiceTitle] = useState("");

  const openQuickRequest = (serviceId, providerId, serviceTitle) => {
    setQrServiceId(serviceId);
    setQrProviderId(providerId || null);
    setQrServiceTitle(serviceTitle || "");
    setQrOpen(true);
  };

  function getMyProviderId() {
  // 1) сначала пробуем JSON-записи
  for (const key of ["user", "profile", "me", "auth"]) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const o = JSON.parse(raw);
      const cand =
        o?.provider_id ?? o?.providerId ?? o?.provider?.id ??
        o?.company?.id ?? o?.id;
      if (cand != null) return Number(cand);
    } catch {}
  }
  // 2) затем — плоские ключи
  for (const key of ["provider_id", "providerId", "owner_id", "id"]) {
    const v = localStorage.getItem(key);
    if (v != null) return Number(v);
  }
  return null;
}

  const submitQuickRequest = async (note) => {
  // мгновенный клиентский блок: свой же provider_id
  const myProviderId = getMyProviderId();
  if (qrProviderId && myProviderId && Number(qrProviderId) === myProviderId) {
    tInfo(t("errors.self_request_forbidden") || "Вы не можете отправить запрос самому себе!", {
      autoClose: 2200,
      toastId: "self-req",
    });
    setQrOpen(false);
    setQrServiceId(null);
    setQrProviderId(null);
    setQrServiceTitle("");
    return;
  }

  try {
    await apiPost("/api/requests", {
      service_id: qrServiceId,
      provider_id: qrProviderId || undefined,
      service_title: qrServiceTitle || undefined,
      note: note || undefined,
    });
    tSuccess(t("messages.request_sent") || "Запрос отправлен", { autoClose: 1800 });
    window.dispatchEvent(new CustomEvent("request:created", {
      detail: { service_id: qrServiceId, title: qrServiceTitle },
    }));
  } catch (err) {
    const status =
      err?.status || err?.response?.status || err?.data?.status;
    const code =
      err?.response?.data?.error || err?.data?.error || err?.error || err?.code || err?.message || "";
    const msgStr = String(code).toLowerCase();
        // Повторный быстрый запрос на ту же услугу
    if (status === 409 || msgStr.includes("request_already_sent") || msgStr.includes("already")) {
      tInfo(t("errors.request_already_sent") || "Вы уже отправляли запрос", {
        autoClose: 2000,
        toastId: "req-already",
      });
      return;
    }

    const isSelfByStatus =
      status === 400 && qrProviderId && myProviderId && Number(qrProviderId) === myProviderId;

    if (msgStr.includes("self_request_forbidden") || isSelfByStatus) {
      tInfo(t("errors.self_request_forbidden") || "Вы не можете отправить запрос самому себе!", {
        autoClose: 2200,
        toastId: "self-req",
      });
      return;
    }

    if (status === 401 || status === 403 || msgStr.includes("unauthorized")) {
      tInfo(t("auth.login_required") || "Войдите, чтобы отправить запрос", {
        autoClose: 2000,
        toastId: "login-required",
      });
      return;
    }

    // request_create_failed и прочее
    tError(t("errors.request_send") || "Не удалось отправить запрос", { autoClose: 1800 });
  } finally {
    setQrOpen(false);
    setQrServiceId(null);
    setQrProviderId(null);
    setQrServiceTitle("");
  }
};



  const [nowMin, setNowMin] = useState(() => Math.floor(Date.now() / 60000));
  useEffect(() => {
    const id = setInterval(() => setNowMin(Math.floor(Date.now() / 60000)), 60000);
    return () => clearInterval(id);
  }, []);
  const now = nowMin * 60000;

  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
    // подсказки поиска
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const suggestTimer = useRef(null);

      // ===== Режимы и состояние лент секций (Top/New/Upcoming) =====
  const [searchMode, setSearchMode] = useState(false);
  const [sec, setSec] = useState({
    top:      { items: [], loading: false, error: null, page: 1, total: 0 },
    new:      { items: [], loading: false, error: null, page: 1, total: 0 },
    upcoming: { items: [], loading: false, error: null, page: 1, total: 0 },
  });
  const setSecPart = (key, patch) =>
    setSec((s) => ({ ...s, [key]: { ...s[key], ...patch } }));

  const filters = useMemo(
    () => ({
      q: q?.trim() || undefined,
      //location: q?.trim() || undefined,
      category: category || undefined,
    }),
    [q, category]
  );

// --- normalize & transliterate helpers ---
const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[ё]/g, "е")
    .replace(/[`ʼʻ’']/g, "'") // единый апостроф
    .replace(/\s+/g, " ")   // схлопываем
    .trim();

const cyr2lat = (s) =>
  norm(s)
    .replace(/shch/g, "shch") // защита от повторной замены
    .replace(/щ/g, "shch")
    .replace(/ш/g, "sh")
    .replace(/ч/g, "ch")
    .replace(/ж/g, "zh")
    .replace(/ю/g, "yu")
    .replace(/я/g, "ya")
    .replace(/й/g, "y")
    .replace(/ё/g, "e")
    .replace(/ъ|’|ʻ|`/g, "")
    .replace(/ь/g, "")
        // RU
    .replace(/х/g, "kh")
    .replace(/ц/g, "ts")
    // UZ cyr → lat
    .replace(/қ/g, "q")
    .replace(/ғ/g, "g'")
    .replace(/ў/g, "o'")
    .replace(/ҳ/g, "h")
    .replace(/а/g, "a").replace(/б/g, "b").replace(/в/g, "v").replace(/г/g, "g")
    .replace(/д/g, "d").replace(/е/g, "e").replace(/з/g, "z").replace(/и/g, "i")
    .replace(/к/g, "k").replace(/л/g, "l").replace(/м/g, "m").replace(/н/g, "n")
    .replace(/о/g, "o").replace(/п/g, "p").replace(/р/g, "r").replace(/с/g, "s")
    .replace(/т/g, "t").replace(/у/g, "u").replace(/ф/g, "f").replace(/ы/g, "y");

const lat2cyr = (s) => {
  let x = norm(s)
    .replace(/shch/g, "щ").replace(/sch/g, "щ")   // RU
    .replace(/sh/g, "ш").replace(/ch/g, "ч").replace(/zh/g, "ж")
    .replace(/ya/g, "я").replace(/yu/g, "ю").replace(/yo/g, "ё")
    .replace(/kh/g, "х").replace(/ts/g, "ц");
  // UZ lat → cyr (апострофы унифицированы выше)
  x = x
    .replace(/g'|gʼ|g‘/g, "ғ")
    .replace(/o'|oʼ|o‘/g, "ў")
    .replace(/q/g, "қ")
    .replace(/x/g, "х")   // в узбекском x ~ «х»
    .replace(/h/g, "ҳ");  // обычный h → «ҳ»
  // Остальные латинские буквы (общая кириллизация)
  x = x
    .replace(/a/g, "а").replace(/b/g, "б").replace(/v/g, "в").replace(/g/g, "г")
    .replace(/d/g, "д").replace(/e/g, "е").replace(/z/g, "з").replace(/i/g, "и")
    .replace(/j/g, "й").replace(/k/g, "к").replace(/l/g, "л").replace(/m/g, "м")
    .replace(/n/g, "н").replace(/o/g, "о").replace(/p/g, "п").replace(/r/g, "р")
    .replace(/s/g, "с").replace(/t/g, "т").replace(/u/g, "у").replace(/f/g, "ф")
    .replace(/y/g, "ы").replace(/c/g, "к").replace(/w/g, "в");
  return x;
};

// обёртка над buildHaystack для нормализованных вариантов
const buildSearchIndex = (it) => {
  const raw = buildHaystack(it);      // ваша текущая сборка полей
  const n   = norm(raw);
  return { n, n_lat: cyr2lat(n), n_cyr: lat2cyr(n) };
};

// токенизированный матчинг с RU⇄EN
const matchQuery = (query, it) => {
  const idx = buildSearchIndex(it);
  const tokens = norm(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  return tokens.every((tok) => {
    const t1 = tok;
    const t2 = cyr2lat(tok);
    const t3 = lat2cyr(tok);
    return (
      idx.n.includes(t1)     || idx.n.includes(t2)     || idx.n.includes(t3) ||
      idx.n_lat.includes(t1) || idx.n_lat.includes(t2) || idx.n_lat.includes(t3) ||
      idx.n_cyr.includes(t1) || idx.n_cyr.includes(t2) || idx.n_cyr.includes(t3)
    );
  });
};

  
  function buildHaystack(it) {
    const s = it?.service || it || {};
    const d =
      (typeof s.details === "string"
        ? (() => {
            try {
              return JSON.parse(s.details);
            } catch {
              return {};
            }
          })()
        : s.details) || {};

    const p =
      s.provider || s.provider_profile || it.provider || it.provider_profile || d.provider || {};

    const flatNames = [
      it.provider_name,
      it.supplier_name,
      it.vendor_name,
      it.agency_name,
      it.company_name,
      s.provider_name,
      s.supplier_name,
      d.provider_name,
      d.supplier_name,
    ];

    return [
      s.title,
      s.name,
      s.city,
      s.country,
      s.location,
      s.direction,
      s.direction_to,
      s.directionTo,
      d.direction,
      d.directionCountry,
      d.direction_from,
      d.directionFrom,
      d.direction_to,
      d.directionTo,
      d.location,
      d.eventName,
      d.hotel,
      d.hotel_name,
      d.airline,
      p.name,
      p.title,
      p.display_name,
      p.company_name,
      p.brand,
      ...flatNames,
      p.telegram,
      p.tg,
      p.telegram_username,
      p.telegram_link,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [favIds, setFavIds] = useState(new Set());
  const inputRef = useRef(null);
  // единый helper для id услуги
  const getServiceId = (it) => {
    const svc = it?.service || it || {};
    return svc.id ?? it?.id ?? svc._id ?? it?._id ?? null;
  };

  /* ---------- авто-категория из текста запроса ---------- */
const CATEGORY_KEYWORDS = {
  guide: [
    "гид","гид анг","гид английский","экскурсия","экскурсовод",
    "guide","gid","tour guide"
  ],
  transport: [
    "транспорт","трансфер","машина","водитель","авто","микроавтобус","такси",
    "transport","transfer","driver","car","minivan","bus"
  ],
  refused_tour: ["отказной тур","пакет","package","package tour","refused tour"],
  refused_hotel: ["отказной отель","отель","hotel","room","номер"],
  refused_flight: ["авиабилет","билет на самолёт","flight","ticket","refused flight"],
  visa_support: ["виза","визовая","visa","visa support"]
};
function detectCategoryFromQuery(q) {
  const nq = norm(q);
  if (!nq) return null;
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (words.some(w => nq.includes(norm(w)) || norm(cyr2lat(w)).includes(nq))) {
      return cat;
    }
  }
  return null;
}

/* ---------- скоринг результата ---------- */
function scoreItem(query, it) {
  const { title, hotel, inlineProvider, flatName, details, svc } = extractServiceFields(it, getRole());
  const providerName =
    flatName ||
    inlineProvider?.display_name ||
    inlineProvider?.company_name ||
    inlineProvider?.brand ||
    inlineProvider?.name ||
    "";
  const city =
    norm(
      _firstNonEmpty(
        details?.city, svc?.city, details?.location, svc?.location,
        details?.direction, details?.direction_to, details?.directionFrom
      ) || ""
    );

  const idx = buildSearchIndex(it); // { n, n_lat, n_cyr }
  const tokens = norm(query).split(/\s+/).filter(Boolean);
  let score = 0;

  const adds = (str, tok, inc = 6, start = 14) => {
    if (!str) return 0;
    const s = norm(str);
    if (s.startsWith(tok)) return start;
    return s.includes(tok) ? inc : 0;
  };

  tokens.forEach((tokRaw) => {
   const vars = [tokRaw, cyr2lat(tokRaw), lat2cyr(tokRaw)].map(norm);
    for (const tok of vars) {
      score += adds(title || "", tok, 12, 25);
      score += adds(providerName, tok, 9, 18);
      score += adds(hotel || "", tok, 7, 14);
      score += adds(city, tok, 8, 14);
      // общий хейстек
      if (idx.n.includes(tok) || idx.n_lat.includes(tok) || idx.n_cyr.includes(tok)) score += 6;
    }
  });

  const detected = detectCategoryFromQuery(query);
  const cat = svc?.category || details?.category || details?.type || "";
  if (detected && String(cat).toLowerCase().includes(detected)) score += 30;

  // лёгкий бонус свежим «upcoming» (если есть дата истечения в будущем)
  const exp = resolveExpireAt(it?.service || it || {});
  if (exp && exp > Date.now()) {
    const hoursLeft = Math.max(0, (exp - Date.now()) / 3600000);
    score += Math.min(12, 12 - Math.min(12, Math.floor(hoursLeft / 24))); // чем ближе дедлайн — тем выше
  }

  return score;
}

  /* ===================== search ===================== */
const search = async (opts = {}) => {
  setLoading(true);
  setError(null);

  try {
        // авто-категория, если юзер не выбрал явно
    const autoCat = !category && filters?.q ? detectCategoryFromQuery(filters.q) : null;
    const rawPayload = opts?.all ? {} : { ...filters, ...(autoCat ? { category: autoCat } : {}) };
    const payload = Object.fromEntries(
      Object.entries(rawPayload).filter(([, v]) =>
        v != null && (typeof v === "number" ? true : String(v).trim() !== "")
      )
    );

    // 1) основной вызов
    let res;
    try {
      res = await apiPost("/api/marketplace/search", payload);
    } catch (e) {
      if (opts?.fallback !== false) {
        const qs = new URLSearchParams(
          Object.entries(payload).filter(([, v]) => v != null && String(v).trim() !== "")
        ).toString();
        res = await apiGet(`/api/marketplace/search?${qs}`);
      } else {
        throw e;
      }
    }

    let list = normalizeList(res);
    console.log('[MP] server items:', list?.length, list?.slice?.(0,3));

       // 🎯 Marketplace: только опубликованные и актуальные
    list = list.filter((it) => {
      const svc = it?.service || it || {};
      const st = String(svc.status || "").toLowerCase();
      const published = !st || ["published", "active", "approved"].includes(st);
      return published && isMarketplaceVisible(it, now);
    });

    // Сортировка по релевантности при наличии текстового запроса
    if (filters?.q) {
      const qLocal = filters.q;
      list.sort((a, b) => scoreItem(qLocal, b) - scoreItem(qLocal, a));
    }
    setItems(list);

  } catch {
    setItems([]);
    setError(t("common.loading_error") || "Не удалось загрузить данные");
  } finally {
    setLoading(false);
    setShowSuggest(false);
  }
};


   // стартовая загрузка лент секций
  useEffect(() => {
    ["top","new","upcoming"].forEach((k) => loadSection(k, 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


      // универсальная загрузка секции
  const loadSection = async (key, nextPage = 1) => {
    setSecPart(key, { loading: true, error: null });
    try {
      const qs = new URLSearchParams({
        page: String(nextPage),
        limit: String(SECTION_LIMIT),
        ...(category ? { category } : {}),
      }).toString();
      const res = await apiGet(`/api/marketplace/sections/${key}?${qs}`);
      const list = normalizeList(res).filter((it) => isMarketplaceVisible(it, now));
      const total = (res?.total ?? res?.data?.total ?? res?.count ?? res?.total_count ?? 0) | 0;
      const page  = (res?.page ?? res?.data?.page ?? nextPage) | 0;
      setSecPart(key, { items: list, total, page });
        } catch (e) {
      console.error(`loadSection ${key} error:`, e);
      setSecPart(key, { items: [], total: 0, error: t("common.loading_error") || "Не удалось загрузить данные" });
    } finally {
      setSecPart(key, { loading: false });
    }
  };

  // При смене категории перегружаем ленты, если не в режиме поиска
  useEffect(() => {
    if (!searchMode) ["top","new","upcoming"].forEach((k) => loadSection(k, 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);
 

  useEffect(() => {
      (async () => {
        try {
          if (role === "client") {
            // клиентское избранное (как было)
            const ids = await apiGet("/api/wishlist/ids");
            const arr = Array.isArray(ids) ? ids : [];
            setFavIds(new Set(arr.map(x => String(x))));
          } else if (role === "provider") {
            // провайдерское избранное
            const list = await apiProviderFavorites();
            const ids =
              (Array.isArray(list) ? list : [])
                .map(x => x.service_id ?? x.service?.id ?? x.id) // берём id услуги
                .filter(Boolean)
            .map(x => String(x));
            setFavIds(new Set(ids));
          } else {
            // гость — пусто
            setFavIds(new Set());
          }
        } catch {
          setFavIds(new Set());
        }
      })();
    }, [role]);

  // тут тоггл сердечка из маркетплэйс *
  
  const toggleFavorite = async (id) => {
  const key = String(id);

  // ----- КЛИЕНТ -----
  if (role === "client") {
    try {
      const res = await apiPost("/api/wishlist/toggle", { serviceId: id });
      const added = !!res?.added;
      setFavIds((prev) => {
        const next = new Set(prev);
        if (added) next.add(key); else next.delete(key);
        return next;
      });
      tSuccess(
        added
          ? t("favorites.added_toast") || "Добавлено в избранное"
          : t("favorites.removed_toast") || "Удалено из избранного"
      );
    } catch (e) {
      const msg = (e && (e.status || e.code || e.message)) || "";
      const needLogin = String(msg).includes("401") || String(msg).includes("403");
      tError(
        needLogin
          ? (t("auth.login_required") || "Войдите как клиент")
          : (t("toast.favoriteError") || "Не удалось изменить избранное")
      );
    }
    return;
  }

  // ----- ПРОВАЙДЕР -----
  if (role === "provider") {
    // оптимистично переворачиваем локальное состояние
    const flipTo = !favIds.has(key);
    setFavIds((prev) => {
      const next = new Set(prev);
      if (flipTo) next.add(key); else next.delete(key);
      return next;
    });

    try {
      const res = await apiToggleProviderFavorite(id);

      // если сервер явно прислал added — синхронизируемся
      if (typeof res?.added === "boolean" && res.added !== flipTo) {
        setFavIds((prev) => {
          const next = new Set(prev);
          if (res.added) next.add(key); else next.delete(key);
          return next;
        });
      }

      // обновим бейдж в шапке
      window.dispatchEvent(new Event("provider:favorites:changed"));

      (flipTo ? tSuccess : tInfo)(
        flipTo
          ? t("favorites.added_toast") || "Добавлено в избранное"
          : t("favorites.removed_toast") || "Удалено из избранного",
        { autoClose: 1800, toastId: `fav-${id}-${flipTo ? "add" : "rem"}` }
      );
    } catch (e) {
      // откат при ошибке
      setFavIds((prev) => {
        const next = new Set(prev);
        if (flipTo) next.delete(key); else next.add(key);
        return next;
      });

      const msg = (e && (e.status || e.code || e.message)) || "";
      const needLogin = String(msg).includes("401") || String(msg).includes("403");
      tError(
        needLogin
          ? (t("auth.provider_login_required") || "Войдите как поставщик")
          : (t("toast.favoriteError") || "Не удалось изменить избранное"),
        { autoClose: 1800, toastId: `fav-${id}-${flipTo ? "add" : "rem"}` }
      );
    }
    return;
  }

  // ----- ГОСТЬ -----
  tInfo(t("auth.login_required") || "Войдите как клиент/поставщик", { autoClose: 1800 });
};


  const categoryOptions = [
    { value: "", label: t("marketplace.select_category") || "Выберите категорию" },
    { value: "guide", label: t("marketplace.guide") || "Гид" },
    { value: "transport", label: t("marketplace.transport") || "Транспорт" },
    {
      value: "refused_tour",
      label: t("marketplace.package") || t("category.refused_tour") || "Отказной тур",
    },
    {
      value: "refused_hotel",
      label: t("marketplace.hotel") || t("category.refused_hotel") || "Отказной отель",
    },
    {
      value: "refused_flight",
      label: t("marketplace.flight") || t("category.refused_flight") || "Отказной авиабилет",
    },
    {
      value: "refused_event_ticket",
      label:
        t("marketplace.refused_event") ||
        t("category.refused_event_ticket") ||
        "Отказной билет",
    },
    { value: "visa_support", label: t("category.visa_support") || "Визовая поддержка" },
  ];

        // ====== Рендер блока секции (как отдельная карточка) ======
  const renderSectionBlock = (key) => {
    const meta = SECTIONS.find((s) => s.key === key) || { labelKey: key, fallback: key };
    const data = sec[key];
    const title = t(meta.labelKey) || meta.fallback;

    return (
      <section key={key} className="mb-8">
        <div className="rounded-xl border bg-white shadow-sm">
          {/* Хедер секции */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50 rounded-t-xl">
            <h2 className="text-base font-semibold text-gray-800">{title}</h2>

            {data.total > SECTION_LIMIT && (
              <div className="flex items-center gap-2">
                <button
                  className="px-3 py-1.5 border rounded bg-white hover:bg-gray-50 disabled:opacity-50"
                  onClick={() => loadSection(key, data.page - 1)}
                  disabled={data.page <= 1 || data.loading}
                  aria-label={t("pagination.prev") || "Предыдущая"}
                >
                  «
                </button>
                <span className="text-sm text-gray-600">
                  {data.page} / {Math.max(1, Math.ceil(data.total / SECTION_LIMIT))}
                </span>
                <button
                  className="px-3 py-1.5 border rounded bg-white hover:bg-gray-50 disabled:opacity-50"
                  onClick={() => loadSection(key, data.page + 1)}
                  disabled={data.page >= Math.ceil(data.total / SECTION_LIMIT) || data.loading}
                  aria-label={t("pagination.next") || "Следующая"}
                >
                  »
                </button>
              </div>
            )}
          </div>

          {/* Контент секции */}
          <div className="p-4">
            {data.loading && (
              <div className="text-gray-500">{t("common.loading") || "Загрузка…"}.</div>
            )}
            {!data.loading && data.error && <div className="text-red-600">{data.error}</div>}
            {!data.loading && !data.error && data.items.length === 0 && (
              <div className="text-gray-500">{t("marketplace.no_results") || "Нет результатов"}</div>
            )}
            {!data.loading && !data.error && !!data.items.length && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {data.items.map((it) => {
                  const sid = getServiceId(it);
                  return (
                    <ServiceCard
                      key={sid || JSON.stringify(it)}
                      item={it}
                      now={now}
                      viewerRole={role}
                      isFav={sid ? favIds.has(String(sid)) : false}
                      onToggleFavorite={() => sid && toggleFavorite(sid)}
                      onQuickRequest={(serviceId, providerId, title) =>
                        openQuickRequest(serviceId ?? sid, providerId, title)
                      }
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
    );
  };
 
  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6">
      
            {/* Top login button for guests */}
      
      {!isLoggedIn && (
          <div className="mb-4 flex justify-end gap-2">
            <a
              href={`/client/login?redirect=${encodeURIComponent(location.pathname + location.search)}`}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50 text-sm font-medium shadow-sm"
            >
              {t("auth.login_client") || "Войти как клиент"}
            </a>
            <a
              href={`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50 text-sm font-medium shadow-sm"
            >
              {t("auth.login_provider") || "Войти как поставщик"}
            </a>
          </div>
        )}

      {/* Панель поиска */}
      <div className="bg-white rounded-xl shadow p-4 border mb-4">
        <div className="flex flex-col md:flex-row gap-3 items-stretch relative">
          <input
            ref={inputRef}
            value={q}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const wantSearch = !!(q.trim() || category);
               setSearchMode(wantSearch);
                wantSearch ? search() : ["top","new","upcoming"].forEach((k)=>loadSection(k,1));
              }
            }}
            onChange={(e) => {
              const val = e.target.value;
              setQ(val);
              // debounce подсказок
              clearTimeout(suggestTimer.current);
              if (!val.trim()) {
                setSuggestions([]);
                setShowSuggest(false);
                return;
              }
              suggestTimer.current = setTimeout(async () => {
                try {
                  // 1) бек-энд подсказки
                  const resp = await apiGet(
                    `/api/marketplace/suggest?q=${encodeURIComponent(val)}&limit=8`
                  );
                  let list = normalizeList(resp)
                    .map((x) => String(x.title || x.name || x).trim())
                    .filter(Boolean);
                  // 2) fallback: берём секции и строим подсказки локально
                  if (!list.length) {
                    const pool = []
                      .concat(sec.top.items, sec.new.items, sec.upcoming.items)
                      .slice(0, 60);
                    const seen = new Set();
                    list = pool
                      .map((it) => {
                       const { title, inlineProvider } = extractServiceFields(it, role);
                        const prov =
                          inlineProvider?.display_name ||
                          inlineProvider?.company_name ||
                          inlineProvider?.name ||
                          "";
                        return [title, prov];
                      })
                      .flat()
                      .filter(Boolean)
                      .filter((s) => matchQuery(val, { service: { title: s } }))
                      .filter((s) => (seen.has(s) ? false : (seen.add(s), true)))
                      .slice(0, 8);
                  }
                  setSuggestions(list);
                  setShowSuggest(true);
                } catch {
                  setSuggestions([]);
                  setShowSuggest(false);
                }
              }, 250);
            }}
          placeholder={t("marketplace.search_placeholder") || "Поиск по услугам, странам, городам…"}
          className="flex-1 border rounded-lg px-3 py-2"
                    onFocus={() => suggestions.length && setShowSuggest(true)}
            onBlur={() => setTimeout(() => setShowSuggest(false), 120)}
          />
          {/* выпадающий список подсказок */}
          {showSuggest && suggestions.length > 0 && (
            <ul className="absolute z-20 left-0 right-0 top-11 md:top-[42px] bg-white border rounded-lg shadow max-h-72 overflow-auto">
              {suggestions.map((sug, i) => (
                <li
                  key={`${sug}-${i}`}
                  className="px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer"
                  onMouseDown={() => {
                    setQ(sug);
                    setShowSuggest(false);
                    search({ fallback: true });
                  }}
                >
                  {sug}
                </li>
              ))}
            </ul>
          )}
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full md:w-64 border rounded-lg px-3 py-2"
        >
          {categoryOptions.map((opt) => (
            <option key={opt.value || "root"} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <button
          onClick={() => {
            const wantSearch = !!(q.trim() || category);
            setSearchMode(wantSearch);
            if (wantSearch) {
              search();
            } else {
              ["top","new","upcoming"].forEach((k) => loadSection(k, 1));
            }
          }}
          className="px-5 py-2 rounded-lg bg-gray-900 text-white"
          disabled={loading}
        >
          {t("common.find") || "Найти"}
        </button>
      </div>
    </div>

            {/* Список / секции */}
      {searchMode ? (
        <div className="bg-white rounded-xl shadow p-6 border">
          {loading && <div className="text-gray-500">{t("common.loading") || "Загрузка…"}.</div>}
          {!loading && error && <div className="text-red-600">{error}</div>}
          {!loading && !error && !items.length && (
            <div className="text-gray-500">{t("marketplace.no_results") || "Нет результатов"}</div>
          )}
          {!loading && !error && !!items.length && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {items.map((it) => {
                const sid = getServiceId(it);
                return (
                  <ServiceCard
                    key={sid || JSON.stringify(it)}
                    item={it}
                    now={now}
                    viewerRole={role}
                    highlightQuery={q}             // 🔍 подсветка
                    isFav={sid ? favIds.has(String(sid)) : false}
                    onToggleFavorite={() => sid && toggleFavorite(sid)}
                    onQuickRequest={(serviceId, providerId, title) =>
                      openQuickRequest(serviceId ?? sid, providerId, title)
                    }
                  />
                );
              })}
            </div>
          )}
       </div>
      ) : (
        <>
          {renderSectionBlock("top")}
          {renderSectionBlock("new")}
          {renderSectionBlock("upcoming")}
        </>
      )}
     {/* Модалка быстрого запроса */}
      <QuickRequestModal open={qrOpen} onClose={() => setQrOpen(false)} onSubmit={submitQuickRequest} />
    </div>
  );
}
