//frontend/src/pages/Marketplace.jsx

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../api";

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
function buildDates(d = {}) {
  const hotelIn =
    d.hotel_check_in ||
    d.checkIn ||
    d.startDate ||
    d.start_flight_date ||
    d.startFlightDate;
  const hotelOut =
    d.hotel_check_out ||
    d.checkOut ||
    d.returnDate ||
    d.end_flight_date ||
    d.endFlightDate;
  if (hotelIn && hotelOut) return `${hotelIn} → ${hotelOut}`;
  if (hotelIn) return String(hotelIn);
  if (hotelOut) return String(hotelOut);
  return null;
}
function matchesLocation(it, q) {
  if (!q) return true;
  const svc = it?.service || it;
  const d = svc.details || {};
  const hay = [
    svc.location,
    svc.city,
    svc.direction_to,
    svc.directionTo,
    d.direction_to,
    d.directionTo,
    d.direction_to_city,
    d.directionToCity,
    d.location,
    d.direction,
    d.directionTo || d.direction_to,
    d.directionFrom || d.direction_from,
    d.eventName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(String(q).toLowerCase());
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

/** Пытаемся извлечь timestamp истечения (ms) из разных возможных полей */
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
    if (typeof cand === "number") {
      ts = cand > 1e12 ? cand : cand * 1000;
    } else {
      const parsed = Date.parse(String(cand));
      if (!Number.isNaN(parsed)) ts = parsed;
    }
  }

  // альтернатива: ttl_hours от created_at
  if (!ts) {
    const ttl = d.ttl_hours ?? d.ttlHours ?? s.ttl_hours ?? null;
    if (ttl && Number(ttl) > 0 && s.created_at) {
      const created = Date.parse(s.created_at);
      if (!Number.isNaN(created)) ts = created + Number(ttl) * 3600 * 1000;
    }
  }

  return ts; // ms или null
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
  const full = Math.round(Number(value) * 2) / 2; // шаг 0.5
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => {
        const filled = i + 1 <= full;
        const half = !filled && i + 0.5 === full;
        return (
          <svg
            key={i}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            className={filled || half ? "text-amber-400" : "text-gray-400"}
            fill={filled ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M12 .587l3.668 7.431L24 9.748l-6 5.847L19.335 24 12 20.202 4.665 24 6 15.595 0 9.748l8.332-1.73z" />
            {half && (
              <clipPath id={`half-${i}`}>
                <rect x="0" y="0" width="12" height="24" />
              </clipPath>
            )}
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
    <div
      className="fixed z-[3000] pointer-events-none"
      style={{ top: y, left: x }}
    >
      {children}
    </div>,
    document.body
  );
}

/* ===================== страница ===================== */

export default function Marketplace() {
  const { t } = useTranslation();

  // глобальные "часы" для всех карточек (обновление раз в секунду)
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // фильтры
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const filters = useMemo(
    () => ({
      q: q?.trim() || undefined,
      location: q?.trim() || undefined,
      category: category || undefined,
    }),
    [q, category]
  );

  // данные
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  // избранное (множество id)
  const [favIds, setFavIds] = useState(new Set());

  // загрузка списка
  const search = async (opts = {}) => {
    setLoading(true);
    setError(null);
    try {
      const payload = opts?.all ? {} : filters;
      let res = await apiPost("/api/marketplace/search", payload);
      let list = normalizeList(res);

      // фолбэк на публичные услуги, если поиск ещё не готов
      if (!list.length && opts?.fallback !== false) {
        res = await apiGet("/api/services/public");
        list = normalizeList(res);
      }

      // подстраховка локации
      if (filters.location) {
        list = list.filter((it) => matchesLocation(it, filters.location));
      }

      setItems(list);
    } catch (e) {
      setError(t("common.loading_error") || "Не удалось загрузить данные");
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    search({ all: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // при заходе подгружаем реальные избранные
  useEffect(() => {
    (async () => {
      try {
        const ids = await apiGet("/api/wishlist/ids");
        const arr = Array.isArray(ids) ? ids : [];
        setFavIds(new Set(arr));
      } catch {
        // не залогинен клиентом — игнор
      }
    })();
  }, []);

  // быстрый запрос
  const handleQuickRequest = async (serviceId) => {
    if (!serviceId) return;
    const note =
      window.prompt(
        t("requests.note_prompt") ||
          t("client.dashboard.noResults") ||
          "Комментарий (необязательно)"
      ) || undefined;
    try {
      await apiPost("/api/requests", { service_id: serviceId, note });
      alert(t("requests.sent") || (t("actions.quick_request") + " ✓"));
    } catch {
      alert(t("requests.error") || "Не удалось отправить запрос");
    }
  };

  // избранное — переключение строго после ответа сервера
  const toggleFavorite = async (id) => {
    try {
      const res = await apiPost("/api/wishlist/toggle", { serviceId: id });
      const added = !!res?.added;

      setFavIds((prev) => {
        const next = new Set(prev);
        if (added) next.add(id);
        else next.delete(id);
        return next;
      });

      toast(
        added
          ? t("toast.addedToFav") || "Добавлено в избранное"
          : t("toast.removedFromFav") || "Удалено из избранного"
      );
    } catch (e) {
      const msg = (e && (e.status || e.code || e.message)) || "";
      if (String(msg).includes("401") || String(msg).includes("403")) {
        toast("Войдите как клиент");
      } else {
        toast(t("toast.favoriteError") || "Не удалось изменить избранное");
      }
    }
  };

  /* ---------- опции категорий ---------- */
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

  /* ===================== карточка ===================== */

  const Card = ({ it, now }) => {
    const svc = it?.service || it;
    const id = svc.id ?? it.id;
    const details = svc.details || it.details || {};
    const title =
      svc.title || svc.name || details.eventName || t("title") || "Service";

    const images = Array.isArray(svc.images) ? svc.images : [];
    const image = images[0] || svc.cover || svc.image || null;

    const price = firstNonEmpty(details.netPrice, svc.price, it.price);
    const prettyPrice = fmtPrice(price);

    const hotel = firstNonEmpty(details.hotel, details.refused_hotel_name);
    const accommodation = firstNonEmpty(
      details.accommodation,
      details.accommodationCategory
    );
    const dates = buildDates(details);

    const rating = Number(svc.rating ?? details.rating ?? it.rating ?? 0);
    const status = svc.status ?? it.status ?? details.status ?? null;
    const badge = rating > 0 ? `★ ${rating.toFixed(1)}` : status;

    const isFav = favIds.has(id);

    // срок действия
    const expireAt = resolveExpireAt(svc);
    const leftMs = expireAt ? Math.max(0, expireAt - now) : null;
    const hasTimer = !!expireAt;
    const timerText = hasTimer ? formatLeft(leftMs) : null;

    // ----- отзывы: тултип через портал -----
    const [revOpen, setRevOpen] = useState(false);
    const [revPos, setRevPos] = useState({ x: 0, y: 0 });
    const [revData, setRevData] = useState({ avg: 0, count: 0, items: [] });
    const revBtnRef = useRef(null);

    const openReviews = async () => {
      if (revBtnRef.current) {
        const r = revBtnRef.current.getBoundingClientRect();
        setRevPos({ x: r.left - 8, y: r.top - 8 }); // чуточку левее/выше
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
            <img src={image} alt={title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400">
              <span className="text-sm">
                {t("favorites.no_image") || "Нет изображения"}
              </span>
            </div>
          )}

          {/* Верх: иконки */}
          <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none">
            <div className="flex items-center gap-2">
              {/* Таймер (если есть срок) */}
              {hasTimer && (
                <span
                  className={`pointer-events-auto px-2 py-0.5 rounded-full text-white text-xs backdrop-blur-md ring-1 ring-white/20 shadow
                    ${leftMs > 0 ? "bg-orange-600/95" : "bg-gray-400/90"}`}
                  title={leftMs > 0 ? "До окончания" : "Время истекло"}
                >
                  {timerText}
                </span>
              )}

              {/* Рейтинг/статус — показываем, если таймера нет (чтобы не дублировать) */}
              {!hasTimer && badge && (
                <span className="pointer-events-auto px-2 py-0.5 rounded-full text-white text-xs bg-black/50 backdrop-blur-md ring-1 ring-white/20">
                  {badge}
                </span>
              )}

              {/* Иконка отзывов */}
              <button
                ref={revBtnRef}
                className="pointer-events-auto p-1.5 rounded-full bg-black/30 hover:bg-black/40 text-white backdrop-blur-md ring-1 ring-white/20 relative"
                onMouseEnter={openReviews}
                onMouseLeave={closeReviews}
                title={t("reviews.title_service") || "Отзывы об услуге"}
              >
                {/* bubble icon */}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M21 15a4 4 0 0 1-4 4H8l-4 4V7a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4z" />
                </svg>
              </button>
            </div>

            {/* сердечко */}
            <button
              className={`pointer-events-auto p-1.5 rounded-full bg-black/30 hover:bg-black/40 text-white backdrop-blur-md ring-1 ring-white/20 ${
                isFav ? "text-red-500" : ""
              }`}
              onClick={(e) => {
                e.stopPropagation();
                toggleFavorite(id);
              }}
              title={
                isFav
                  ? t("favorites.removed") || "Удалить из избранного"
                  : t("favorites.added") || "В избранное"
              }
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill={isFav ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="M12 21s-7-4.534-9.5-8.25C1.1 10.3 2.5 6 6.5 6c2.2 0 3.5 1.6 3.5 1.6S11.8 6 14 6c4 0 5.4 4.3 4 6.75C19 16.466 12 21 12 21z" />
              </svg>
            </button>
          </div>

          {/* Нижняя стекляшка (тёмная) */}
          <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="absolute inset-x-0 bottom-0 p-3">
              <div className="rounded-lg bg-black/55 backdrop-blur-md text-white text-xs sm:text-sm p-3 ring-1 ring-white/15 shadow-lg">
                <div className="font-semibold line-clamp-2">{title}</div>
                {hotel && (
                  <div>
                    <span className="opacity-80">{t("hotel") || "Отель"}: </span>
                    <span className="font-medium">{hotel}</span>
                  </div>
                )}
                {accommodation && (
                  <div>
                    <span className="opacity-80">
                      {t("accommodation") || "Размещение"}:{" "}
                    </span>
                    <span className="font-medium">{accommodation}</span>
                  </div>
                )}
                {dates && (
                  <div>
                    <span className="opacity-80">{t("date") || "Дата"}: </span>
                    <span className="font-medium">{dates}</span>
                  </div>
                )}
                {prettyPrice && (
                  <div>
                    <span className="opacity-80">
                      {t("marketplace.price") || "Цена"}:{" "}
                    </span>
                    <span className="font-semibold">{prettyPrice}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* тултип отзывов — через портал, поверх карточки */}
        <TooltipPortal visible={revOpen} x={revPos.x} y={revPos.y}>
          <div className="pointer-events-none max-w-xs rounded-lg bg-black/85 text-white text-xs p-3 shadow-2xl ring-1 ring-white/10">
            <div className="mb-1 font-semibold">
              {(t("reviews.title_service") || "Отзывы об услуге").toUpperCase()}
            </div>
            <div className="flex items-center gap-2">
              <Stars value={revData.avg} />
              <span className="opacity-80">({revData.count || 0})</span>
            </div>
            <div className="mt-1">
              {!revData.items?.length ? (
                <span className="opacity-80">{t("reviews.empty") || "Пока нет отзывов."}</span>
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

        <div className="p-3 flex-1 flex flex-col">
          <div className="font-semibold line-clamp-2">{title}</div>
          {prettyPrice && (
            <div className="mt-1 text-sm">
              {t("marketplace.price") || "Цена"}:{" "}
              <span className="font-semibold">{prettyPrice}</span>
            </div>
          )}
          <div className="mt-auto pt-3">
            <button
              onClick={() => handleQuickRequest(id)}
              className="w-full bg-orange-500 text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-orange-600"
            >
              {t("actions.quick_request") || "Быстрый запрос"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  /* ===================== layout ===================== */
  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6">
      {/* Панель поиска */}
      <div className="bg-white rounded-xl shadow p-4 border mb-4 flex flex-col md:flex-row gap-3 items-stretch">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("marketplace.location_placeholder") || "Внесите локацию ..."}
          className="flex-1 border rounded-lg px-3 py-2"
        />
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
          onClick={() => search()}
          className="px-5 py-2 rounded-lg bg-gray-900 text-white"
          disabled={loading}
        >
          {t("marketplace.search") || "Найти"}
        </button>
      </div>

      {/* Список */}
      <div className="bg-white rounded-xl shadow p-6 border">
        {loading && (
          <div className="text-gray-500">
            {t("marketplace.searching") || "Поиск..."}
          </div>
        )}
        {!loading && error && <div className="text-red-600">{error}</div>}
        {!loading && !error && !items.length && (
          <div className="text-gray-500">
            {t("client.dashboard.noResults") || "Нет результатов"}
          </div>
        )}
        {!loading && !error && !!items.length && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {items.map((it) => (
              <Card key={it.id || it.service?.id || JSON.stringify(it)} it={it} now={now} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
