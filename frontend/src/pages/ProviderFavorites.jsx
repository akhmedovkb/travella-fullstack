// frontend/src/pages/ProviderFavorites.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../api";
import { apiProviderFavorites, apiToggleProviderFavorite } from "../api/providerFavorites";
import WishHeart from "../components/WishHeart";
import QuickRequestModal from "../components/QuickRequestModal";

/* ===================== utils, как в Marketplace ===================== */
function toast(txt) {
  const el = document.createElement("div");
  el.textContent = txt;
  el.className =
    "fixed top-16 right-6 z-[3000] bg-white shadow-xl border rounded-xl px-4 py-2 text-sm";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

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

  // провайдер видит net в приоритете, но показываем и gross если есть
  const rawPriceNet = _firstNonEmpty(details?.netPrice, details?.price, svc.netPrice, svc.price, item?.price);
  const rawPriceGross = _firstNonEmpty(details?.grossPrice, details?.priceGross, svc.grossPrice, svc.price_gross);
  const prettyNet = rawPriceNet == null ? null : new Intl.NumberFormat().format(Number(rawPriceNet));
  const prettyGross = rawPriceGross == null ? null : new Intl.NumberFormat().format(Number(rawPriceGross));

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
    svc, details, title, hotel, accommodation, dates,
    prettyNet, prettyGross, inlineProvider, providerId, status
  };
}

function firstImageFrom(val) {
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
    for (const v of val) { const hit = firstImageFrom(v); if (hit) return hit; }
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
            <path d="M12 .587l3.668 7.431L24 9.748l-6 5.847L19.335 24 12 20.202 4.665 24 6 15.595 0 9.748l8.332-1.73z" />
          </svg>
        );
      })}
    </div>
  );
}
function TooltipPortal({ visible, x, y, children }) {
  if (!visible) return null;
  return createPortal(<div className="fixed z-[3000] pointer-events-none" style={{ top: y, left: x }}>{children}</div>, document.body);
}

/* ===================== страница ===================== */
export default function ProviderFavorites() {
  const { t } = useTranslation();

  // список
  const [items, setItems] = useState([]);
  const [favIds, setFavIds] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // таймер (как в маркетплейсе)
  const [nowMin, setNowMin] = useState(() => Math.floor(Date.now() / 60000));
  useEffect(() => { const id = setInterval(() => setNowMin(Math.floor(Date.now() / 60000)), 60000); return () => clearInterval(id); }, []);
  const now = nowMin * 60000;

  // модалка быстрого запроса
  const [qrOpen, setQrOpen] = useState(false);
  const [qrServiceId, setQrServiceId] = useState(null);
  const [qrProviderId, setQrProviderId] = useState(null);
  const [qrServiceTitle, setQrServiceTitle] = useState("");
  const openQuickRequest = (serviceId, providerId, serviceTitle) => {
    setQrServiceId(serviceId); setQrProviderId(providerId || null); setQrServiceTitle(serviceTitle || ""); setQrOpen(true);
  };
  const submitQuickRequest = async (note) => {
    try {
      await apiPost("/api/requests", { service_id: qrServiceId, provider_id: qrProviderId || undefined, service_title: qrServiceTitle || undefined, note: note || undefined });
      toast(t("messages.request_sent") || "Запрос отправлен");
    } catch { toast(t("errors.request_send") || "Не удалось отправить запрос"); }
    finally { setQrOpen(false); setQrServiceId(null); setQrProviderId(null); setQrServiceTitle(""); }
  };

  // загрузка избранного
  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const list = await apiProviderFavorites();
        const arr = Array.isArray(list) ? list : [];
        setItems(arr);
        const ids = arr.map(x => x.service_id ?? x.service?.id ?? x.id).filter(Boolean).map(x => String(x));
        setFavIds(new Set(ids));
      } catch { setError(t("common.loading_error") || "Не удалось загрузить данные"); }
      finally { setLoading(false); }
    })();
  }, []);

  // тоггл сердца
  const toggleFavorite = async (serviceId) => {
    const key = String(serviceId);
    const flipTo = !favIds.has(key); // оптимистично
    setFavIds(prev => { const next = new Set(prev); if (flipTo) next.add(key); else next.delete(key); return next; });
    if (!flipTo) {
      // из списка на этой странице удаляем сразу
      setItems(prev => prev.filter(it => String(it.service_id ?? it.service?.id ?? it.id) !== key));
    }
    try {
      const res = await apiToggleProviderFavorite(serviceId);
      // если бэкенд прислал flag и он не совпал — поправим
      if (typeof res?.added === "boolean" && res.added !== flipTo) {
        setFavIds(prev => { const next = new Set(prev); if (res.added) next.add(key); else next.delete(key); return next; });
        if (!res.added) setItems(prev => prev.filter(it => String(it.service_id ?? it.service?.id ?? it.id) !== key));
      }
      window.dispatchEvent(new Event("provider:favorites:changed"));
      toast(flipTo ? (t("favorites.added_toast") || "Добавлено в избранное") : (t("favorites.removed_toast") || "Удалено из избранного"));
    } catch (e) {
      // откатим оптимизм
      setFavIds(prev => { const next = new Set(prev); if (flipTo) next.delete(key); else next.add(key); return next; });
      setItems(prev => {
        const exists = prev.some(it => String(it.service_id ?? it.service?.id ?? it.id) === key);
        return exists ? prev : [{ id: serviceId }, ...prev];
      });
      const msg = (e && (e.status || e.code || e.message)) || "";
      const needLogin = String(msg).includes("401") || String(msg).includes("403");
      toast(needLogin ? (t("auth.provider_login_required") || "Войдите как поставщик") : (t("toast.favoriteError") || "Не удалось изменить избранное"));
    }
  };

  /* карточка как в маркетплейсе */
  const Card = ({ it }) => {
    const svc = it?.service || it || {};
    const {
      title, hotel, accommodation, dates,
      prettyNet, prettyGross, inlineProvider, providerId, status
    } = extractServiceFields(it);

    const id = svc.id ?? it.id ?? it.service_id;
    const details = _maybeParse(svc.details) || {};
    const image = firstImageFrom([
      svc.images, details.images, it.images,
      svc.cover, svc.image, details.cover, details.image, it.cover, it.image,
      details.photo, details.picture, details.imageUrl,
      svc.image_url, it.image_url
    ]);

    const rating = Number(svc.rating ?? it.rating ?? 0);
    const badge = rating > 0 ? `★ ${rating.toFixed(1)}` : status;

    const expireAt = resolveExpireAt(svc);
    const leftMs = expireAt ? Math.max(0, expireAt - now) : null;
    const hasTimer = !!expireAt;
    const timerText = hasTimer ? formatLeft(leftMs) : null;

    const isFav = favIds.has(String(id));

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
            <img src={image} alt={title || "image"} className="w-full h-full object-cover"
                 onError={(e) => { e.currentTarget.src = ""; }} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400">
              <span className="text-sm">Нет изображения</span>
            </div>
          )}

          <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none">
            <div className="flex items-center gap-2">
              {hasTimer && (
                <span
                  className={`pointer-events-auto px-2 py-0.5 rounded-full text-white text-xs backdrop-blur-md ring-1 ring-white/20 shadow ${
                    leftMs > 0 ? "bg-orange-600/95" : "bg-gray-400/90"
                  }`}
                  title={leftMs > 0 ? "До окончания" : "Время истекло"}
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
                title="Отзывы об услуге"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M21 15a4 4 0 0 1-4 4H8l-4 4V7a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4z" />
                </svg>
              </button>
            </div>

            <div className="pointer-events-auto p-1.5 rounded-full bg-black/30 hover:bg-black/40 text-white backdrop-blur-md ring-1 ring-white/20">
              <WishHeart
                active={isFav}
                onClick={(e) => { e.stopPropagation(); toggleFavorite(id); }}
                size={18}
                className="!p-0 !hover:bg-transparent"
              />
            </div>
          </div>

          <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="absolute inset-x-0 bottom-0 p-3">
              <div className="rounded-lg bg-black/55 backdrop-blur-md text-white text-xs sm:text-sm p-3 ring-1 ring-white/15 shadow-lg">
                <div className="font-semibold line-clamp-2">{title}</div>
                {hotel && (<div><span className="opacity-80">Отель: </span><span className="font-medium">{hotel}</span></div>)}
                {accommodation && (<div><span className="opacity-80">Размещение: </span><span className="font-medium">{accommodation}</span></div>)}
                {dates && (<div><span className="opacity-80">Дата: </span><span className="font-medium">{dates}</span></div>)}
                {(prettyNet || prettyGross) && (
                  <div>
                    <span className="opacity-80">Цена: </span>
                    <span className="font-semibold">
                      {prettyNet ? `Net ${prettyNet}` : ""}{prettyNet && prettyGross ? " • " : ""}{prettyGross ? `Gross ${prettyGross}` : ""}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* тултип отзывов */}
        <TooltipPortal visible={revOpen} x={revPos.x} y={revPos.y}>
          <div className="pointer-events-none max-w-xs rounded-lg bg-black/85 text-white text-xs p-3 shadow-2xl ring-1 ring-white/10">
            <div className="mb-1 font-semibold">Отзывы об услуге</div>
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

        {/* тело */}
        <div className="p-3 flex-1 flex flex-col">
          <div className="font-semibold line-clamp-2">{title}</div>
          {(prettyNet || prettyGross) && (
            <div className="mt-1 text-sm">
              Цена: <span className="font-semibold">
                {prettyNet ? `Net ${prettyNet}` : ""}{prettyNet && prettyGross ? " • " : ""}{prettyGross ? `Gross ${prettyGross}` : ""}
              </span>
            </div>
          )}
          <div className="mt-auto pt-3">
            <button
              onClick={() => openQuickRequest(id, providerId, title)}
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
      <h2 className="text-xl font-semibold mb-4">{t("provider.favorites.tab") || "Избранное"}</h2>

      <div className="bg-white rounded-xl shadow p-6 border">
        {loading && <div className="text-gray-500">{t("common.loading") || "Загрузка…"}.</div>}
        {!loading && error && <div className="text-red-600">{error}</div>}
        {!loading && !error && !items.length && (
          <div className="text-gray-500">{t("common.empty") || "Избранного пока нет."}</div>
        )}
        {!loading && !error && !!items.length && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {items.map((it) => {
              const key = it.id || it.service?.id || it.service_id || JSON.stringify(it);
              return <Card key={key} it={it} />;
            })}
          </div>
        )}
      </div>

      <QuickRequestModal open={qrOpen} onClose={() => setQrOpen(false)} onSubmit={submitQuickRequest} />
    </div>
  );
}
