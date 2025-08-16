import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../api";
import QuickRequestModal from "../components/QuickRequestModal";
import WishHeart from "../components/WishHeart";

/* ===================== utils ===================== */

function normalizeList(res) {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.items)) return res.items;
  if (Array.isArray(res?.data)) return res.data;
  return [];
}

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
function toast(txt) {
  const el = document.createElement("div");
  el.textContent = txt;
  el.className =
    "fixed top-16 right-6 z-[3000] bg-white shadow-xl border rounded-xl px-4 py-2 text-sm";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
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
function extractServiceFields(item) {
  const svc = item?.service || item || {};
  const details = _mergeDetails(svc, item);
  const bag = { ...details, ...svc, ...item };

  const title = _firstNonEmpty(
    svc.title, svc.name, details?.title, details?.name, details?.eventName, item?.title, item?.name
  );

  const rawPrice = _firstNonEmpty(
    details?.netPrice, details?.price, details?.totalPrice, details?.priceNet, details?.grossPrice,
    svc.netPrice, svc.price, item?.price
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
    pick(bag, ["provider_telegram","supplier_telegram","vendor_telegram","agency_telegram","company_telegram","telegram","tg","telegram_username","telegram_link"])
  );

  const status = _firstNonEmpty(svc.status, item.status, details?.status);

  return {
    svc, details, title, hotel, accommodation, dates, rawPrice, prettyPrice,
    inlineProvider, providerId, flatName, flatPhone, flatTg, status
  };
}

/* ===================== страница ===================== */

export default function Marketplace() {
  const { t } = useTranslation();

  // модалка быстрого запроса
  const [qrOpen, setQrOpen] = useState(false);
  const [qrServiceId, setQrServiceId] = useState(null);
  const [qrProviderId, setQrProviderId] = useState(null);
  const [qrServiceTitle, setQrServiceTitle] = useState(""); // NEW: снэпшот названия услуги

  // NEW: открытие модалки с передачей всех нужных полей
  const openQuickRequest = (serviceId, providerId, serviceTitle) => {
    setQrServiceId(serviceId);
    setQrProviderId(providerId || null);
    setQrServiceTitle(serviceTitle || "");
    setQrOpen(true);
  };

  // NEW: отправка быстрого запроса (без axios/API_BASE/activeService)
  const submitQuickRequest = async (note) => {
    try {
      await apiPost("/api/requests", {
        service_id: qrServiceId,
        provider_id: qrProviderId || undefined,      // на случай, если бэку так проще
        service_title: qrServiceTitle || undefined,  // снэпшот названия услуги
        note: note || undefined,
      });
      toast(t("messages.request_sent") || "Запрос отправлен");
      window.dispatchEvent(new CustomEvent("request:created", { detail: { service_id: qrServiceId, title: qrServiceTitle } }));
    } catch {
      toast(t("errors.request_send") || "Не удалось отправить запрос");
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
  
  const filters = useMemo(() => ({
    q: q?.trim() || undefined,
    //location: q?.trim() || undefined,
    category: category || undefined,
  }), [q, category]);

  function buildHaystack(it) {
  const s = it?.service || it || {};
  const d = (typeof s.details === "string" ? (()=>{try{return JSON.parse(s.details)}catch{return {}}})() : s.details) || {};

  // попробуем найти объект поставщика в разных местах
  const p =
    s.provider || s.provider_profile ||
    it.provider || it.provider_profile ||
    d.provider || {};

  // плоские варианты названия поставщика
  const flatNames = [
    it.provider_name, it.supplier_name, it.vendor_name, it.agency_name, it.company_name,
    s.provider_name, s.supplier_name,
    d.provider_name, d.supplier_name,
  ];

  return [
    // поля услуги
    s.title, s.name,
    s.city, s.country, s.location, s.direction, s.direction_to, s.directionTo,
    d.direction, d.directionCountry, d.direction_from, d.directionFrom,
    d.direction_to, d.directionTo, d.location, d.eventName,
    d.hotel, d.hotel_name, d.airline,

    // 👇 поля поставщика — вот это и решает вашу проблему
    p.name, p.title, p.display_name, p.company_name, p.brand,
    ...flatNames,

    // опционально: ищем и по контактам
    p.telegram, p.tg, p.telegram_username, p.telegram_link,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}



  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  const [favIds, setFavIds] = useState(new Set());

  const search = async (opts = {}) => {
  setLoading(true);
  setError(null);
  try {
    const rawPayload = opts?.all ? {} : filters;
    const payload = Object.fromEntries(
      Object.entries(rawPayload).filter(([, v]) =>
        v != null && (typeof v === "number" ? true : String(v).trim() !== "")
      )
    );
      
    let res;
    try {
      res = await apiPost("/api/marketplace/search", payload);
    } catch (e) {
      if (opts?.fallback !== false) {
        const qs = new URLSearchParams(
          Object.entries(payload).filter(([,v]) => v != null && String(v).trim() !== "")
        ).toString();
        res = await apiGet(`/api/marketplace/search?${qs}`);
      } else {
        throw e;
      }
    }

    let list = normalizeList(res);

    // локальный «умный» поиск по направлению/городу/стране и т.д.
    if (filters.q) {
      const needle = filters.q.toLowerCase();
      list = list.filter((it) => buildHaystack(it).includes(needle));
    }

    if (!list.length && opts?.fallback !== false) {
        try {
          const res2 = await apiPost("/api/marketplace/search", {}); // всё публичное
          let list2 = normalizeList(res2);
          if (filters.q) {
            const needle = filters.q.toLowerCase();
            list2 = list2.filter((it) => buildHaystack(it).includes(needle));
          }
          list = list2;
        } catch {}
      }


    setItems(list);
  } catch {
    setError(t("common.loading_error") || "Не удалось загрузить данные");
    setItems([]);
  } finally {
    setLoading(false);
  }
};



  useEffect(() => { search({ all: true }); }, []); // eslint-disable-line

  useEffect(() => {
    (async () => {
      try {
        const ids = await apiGet("/api/wishlist/ids");
        const arr = Array.isArray(ids) ? ids : [];
        setFavIds(new Set(arr));
      } catch {}
    })();
  }, []);

  const toggleFavorite = async (id) => {
    try {
      const res = await apiPost("/api/wishlist/toggle", { serviceId: id });
      const added = !!res?.added;
      setFavIds((prev) => {
        const next = new Set(prev);
        if (added) next.add(id); else next.delete(id);
        return next;
      });
      toast(added ? (t("favorites.added_toast") || "Добавлено в избранное")
                  : (t("favorites.removed_toast") || "Удалено из избранного"));
    } catch (e) {
      const msg = (e && (e.status || e.code || e.message)) || "";
      if (String(msg).includes("401") || String(msg).includes("403")) toast(t("auth.login_required") || "Войдите как клиент");
      else toast(t("toast.favoriteError") || "Не удалось изменить избранное");
    }
  };

  const categoryOptions = [
    { value: "", label: t("marketplace.select_category") || "Выберите категорию" },
    { value: "guide", label: t("marketplace.guide") || "Гид" },
    { value: "transport", label: t("marketplace.transport") || "Транспорт" },
    { value: "refused_tour", label: t("marketplace.package") || t("category.refused_tour") || "Отказной тур" },
    { value: "refused_hotel", label: t("marketplace.hotel") || t("category.refused_hotel") || "Отказной отель" },
    { value: "refused_flight", label: t("marketplace.flight") || t("category.refused_flight") || "Отказной авиабилет" },
    { value: "refused_event_ticket", label: t("marketplace.refused_event") || t("category.refused_event_ticket") || "Отказной билет" },
    { value: "visa_support", label: t("category.visa_support") || "Визовая поддержка" },
  ];

  const Card = ({ it, now }) => {
    const {
      svc, title, hotel, accommodation, dates, prettyPrice,
      inlineProvider, providerId, flatName, flatPhone, flatTg, status: statusRaw,
    } = extractServiceFields(it);

    const id = svc.id ?? it.id;

    const images = Array.isArray(svc.images) ? svc.images : [];
    const image = images[0] || svc.cover || svc.image || null;

    /* --------- Поставщик: inline + подгрузка по id --------- */
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
    /* ------------------------------------------------------- */

    const rating = Number(svc.rating ?? it.rating ?? 0);
    const status = (typeof statusRaw === "string" && statusRaw.toLowerCase() === "draft") ? null : statusRaw;
    const badge = rating > 0 ? `★ ${rating.toFixed(1)}` : status;

    const isFav = (svc.id && favIds.has(svc.id)) || favIds.has(it.id);

    const expireAt = resolveExpireAt(svc);
    const leftMs = expireAt ? Math.max(0, expireAt - now) : null;
    const hasTimer = !!expireAt;
    const timerText = hasTimer ? formatLeft(leftMs) : null;

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

    return (
      <div className="group relative bg-white border rounded-xl overflow-hidden shadow-sm flex flex-col">
        <div className="aspect-[16/10] bg-gray-100 relative">
          {image ? (
            <img src={image} alt={title || t("marketplace.no_image")} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400">
              <span className="text-sm">{t("marketplace.no_image") || "Нет изображения"}</span>
            </div>
          )}

          <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none">
            <div className="flex items-center gap-2">
              {hasTimer && (
                <span
                  className={`pointer-events-auto px-2 py-0.5 rounded-full text-white text-xs backdrop-blur-md ring-1 ring-white/20 shadow
                    ${leftMs > 0 ? "bg-orange-600/95" : "bg-gray-400/90"}`}
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
            </div>

            {/* Сердце: WishHeart внутри такого же «стеклянного» контейнера */}
            <div className="pointer-events-auto p-1.5 rounded-full bg-black/30 hover:bg-black/40 text-white backdrop-blur-md ring-1 ring-white/20">
              <WishHeart
                active={isFav}
                onClick={(e) => { e.stopPropagation(); toggleFavorite(id); }}
                size={18}
                className="!p-0 !hover:bg-transparent"
              />
            </div>
          </div>

          {/* стеклянная подсказка при ховере */}
          <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="absolute inset-x-0 bottom-0 p-3">
              <div className="rounded-lg bg-black/55 backdrop-blur-md text-white text-xs sm:text-sm p-3 ring-1 ring-white/15 shadow-lg">
                <div className="font-semibold line-clamp-2">{title}</div>
                {hotel && (<div><span className="opacity-80">Отель: </span><span className="font-medium">{hotel}</span></div>)}
                {accommodation && (<div><span className="opacity-80">Размещение: </span><span className="font-medium">{accommodation}</span></div>)}
                {dates && (<div><span className="opacity-80">{t("common.date") || "Дата"}: </span><span className="font-medium">{dates}</span></div>)}
                {prettyPrice && (<div><span className="opacity-80">{t("marketplace.price") || "Цена"}: </span><span className="font-semibold">{prettyPrice}</span></div>)}
              </div>
            </div>
          </div>
        </div>

        {/* тултип отзывов — через портал */}
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

        {/* ТЕЛО КАРТОЧКИ */}
        <div className="p-3 flex-1 flex flex-col">
          <div className="font-semibold line-clamp-2">{title}</div>
          {prettyPrice && (<div className="mt-1 text-sm">{t("marketplace.price") || "Цена"}: <span className="font-semibold">{prettyPrice}</span></div>)}

          {/* === блок поставщика под ценой === */}
          {(supplierName || supplierPhone || supplierTg?.label) && (
            <div className="mt-2 text-sm space-y-0.5">
              {supplierName && (<div><span className="text-gray-500">{t("marketplace.supplier") || "Поставщик"}: </span><span className="font-medium">{supplierName}</span></div>)}
              {supplierPhone && (
                <div>
                  <span className="text-gray-500">{t("marketplace.phone") || "Телефон"}: </span>
                  <a href={`tel:${String(supplierPhone).replace(/\s+/g, "")}`} className="underline">{supplierPhone}</a>
                </div>
              )}
              {supplierTg?.label && (
                <div>
                  <span className="text-gray-500">{t("marketplace.telegram") || "Телеграм"}: </span>
                  {supplierTg.href ? (
                    <a href={supplierTg.href} target="_blank" rel="noopener noreferrer" className="underline">{supplierTg.label}</a>
                  ) : (<span className="font-medium">{supplierTg.label}</span>)}
                </div>
              )}
            </div>
          )}
          {/* === /блок поставщика === */}

          <div className="mt-auto pt-3">
            <button
              onClick={() => openQuickRequest(id, providerId, title)} // NEW: передаём title
              className="w-full bg-orange-500 text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-orange-600"
            >
              {t("actions.quick_request") || "Быстрый запрос"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6">
      {/* Панель поиска */}
      <div className="bg-white rounded-xl shadow p-4 border mb-4 flex flex-col md:flex-row gap-3 items-stretch">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("marketplace.search_placeholder") || "Поиск по услугам, странам, городам…"}
          className="flex-1 border rounded-lg px-3 py-2"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full md:w-64 border rounded-lg px-3 py-2"
        >
          {categoryOptions.map((opt) => (
            <option key={opt.value || "root"} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <button onClick={() => search()} className="px-5 py-2 rounded-lg bg-gray-900 text-white" disabled={loading}>
          {t("common.find") || "Найти"}
        </button>
      </div>

      {/* Список */}
      <div className="bg-white rounded-xl shadow p-6 border">
        {loading && <div className="text-gray-500">{t("common.loading") || "Загрузка…"}.</div>}
        {!loading && error && <div className="text-red-600">{error}</div>}
        {!loading && !error && !items.length && (<div className="text-gray-500">{t("marketplace.no_results") || "Нет результатов"}</div>)}
        {!loading && !error && !!items.length && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {items.map((it) => (<Card key={it.id || it.service?.id || JSON.stringify(it)} it={it} now={now} />))}
          </div>
        )}
      </div>

      {/* Модалка быстрого запроса */}
      <QuickRequestModal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        onSubmit={submitQuickRequest}
      />
    </div>
  );
}
