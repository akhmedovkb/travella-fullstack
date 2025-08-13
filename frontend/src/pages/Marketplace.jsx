// src/pages/Marketplace.jsx
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../api";

/* ===================== Helpers ===================== */
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
    d.hotel_check_in || d.checkIn || d.startDate || d.start_flight_date || d.startFlightDate;
  const hotelOut =
    d.hotel_check_out || d.checkOut || d.returnDate || d.end_flight_date || d.endFlightDate;
  if (hotelIn && hotelOut) return `${hotelIn} → ${hotelOut}`;
  if (hotelIn) return String(hotelIn);
  if (hotelOut) return String(hotelOut);
  return null;
}

/* маленький клиент-сайд фильтр локации на случай, если бэкенд не отфильтровал */
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

/* ===================== Reviews Button ===================== */
// Маленькая кнопка «Отзывы»; лениво подгружает 2 последних отзыва по услуге
function ReviewsButton({ serviceId, initialRating = 0, t }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({
    avg: Number(initialRating) || 0,
    count: 0,
    latest: [],
    loaded: false,
  });

  const load = async () => {
    if (loading || data.loaded || !serviceId) return;
    try {
      setLoading(true);
      const res = await apiGet(`/api/reviews/service/${serviceId}`);
      const list = normalizeList(res);
      const count = list.length;
      const avg = count
        ? list.reduce((s, r) => s + (Number(r.rating) || 0), 0) / count
        : Number(initialRating) || 0;
      setData({ avg, count, latest: list.slice(0, 2), loaded: true });
    } catch {
      // молча игнорируем; покажем «0 отзывов»
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="relative pointer-events-auto group/rev"
      onMouseEnter={load}
      onFocus={load}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="p-1.5 rounded-full bg-black/30 hover:bg-black/40 text-white backdrop-blur-md ring-1 ring-white/20 flex items-center gap-1"
        title={t("reviews.title") || "Отзывы"}
      >
        {/* иконка-комментарий */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M20 2H4a2 2 0 0 0-2 2v14l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z" />
        </svg>
        <span className="text-[11px] font-semibold leading-none">{data.count}</span>
      </button>

      {/* тултип/подсказка */}
      <div
        className={`absolute right-0 mt-2 w-72 rounded-lg bg-white/95 backdrop-blur-md text-gray-900 shadow-lg ring-1 ring-black/10 p-3 transition opacity-0 group-hover/rev:opacity-100 ${
          open ? "opacity-100" : ""
        }`}
        style={{ pointerEvents: "none" }}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="text-yellow-500">★</span>
          <span className="font-semibold">{data.avg ? data.avg.toFixed(1) : "—"}</span>
          <span className="text-xs text-gray-500">
            {data.count} {t("reviews.count") || "отзыв(ов)"}
          </span>
        </div>
        {loading && (
          <div className="text-xs text-gray-500">{t("common.loading") || "Загрузка..."}</div>
        )}
        {!loading && data.latest.length === 0 && (
          <div className="text-xs text-gray-500">
            {t("reviews.no_reviews") || "Отзывов пока нет"}
          </div>
        )}
        {!loading &&
          data.latest.map((r, i) => (
            <div key={i} className="text-xs border-top border-gray-200 pt-2 mt-2">
              <div className="flex items-center gap-1 text-yellow-500 mb-0.5">
                {"★".repeat(Math.round(Number(r.rating) || 0))}
              </div>
              <div className="line-clamp-3">{r.comment || r.text}</div>
            </div>
          ))}
      </div>
    </div>
  );
}

/* ===================== Карточка + страница ===================== */

export default function Marketplace() {
  const { t } = useTranslation();

  // Поисковые фильтры
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

  // Данные
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  // избранное (локальный set для мгновенной реакции)
  const [favIds, setFavIds] = useState(new Set());

  // Загрузка
  const search = async (opts = {}) => {
    setLoading(true);
    setError(null);
    try {
      const payload = opts?.all ? {} : filters;
      let res = await apiPost("/api/marketplace/search", payload);
      let list = normalizeList(res);

      // Фолбэк: публичные услуги, если эндпоинт ещё не доступен
      if (!list.length && opts?.fallback !== false) {
        res = await apiGet("/api/services/public");
        list = normalizeList(res);
      }

      // Клиентский фильтр по локации (подстраховка)
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

  // Быстрый запрос
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

  // Избранное
  const toggleFavorite = async (id) => {
    try {
      await apiPost("/api/wishlist/toggle", { itemId: id });
      setFavIds((prev) => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });
    } catch {
      alert(t("toast.favoriteError") || "Не удалось изменить избранное");
    }
  };

  /* ===================== UI: Селект категорий ===================== */
  const categoryOptions = [
    { value: "", label: t("marketplace.select_category") || "Выберите категорию" },
    // провайдеры
    { value: "guide", label: t("marketplace.guide") || "Гид" },
    { value: "transport", label: t("marketplace.transport") || "Транспорт" },
    // «отказные»
    { value: "refused_tour", label: t("marketplace.package") || t("category.refused_tour") || "Отказной тур" },
    { value: "refused_hotel", label: t("marketplace.hotel") || t("category.refused_hotel") || "Отказной отель" },
    { value: "refused_flight", label: t("marketplace.flight") || t("category.refused_flight") || "Отказной авиабилет" },
    { value: "refused_event_ticket", label: t("marketplace.refused_event") || t("category.refused_event_ticket") || "Отказной билет" },
    { value: "visa_support", label: t("category.visa_support") || "Визовая поддержка" },
  ];

  /* ===================== Card ===================== */
  const Card = ({ it }) => {
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

    return (
      <div className="group relative bg-white border rounded-xl overflow-hidden shadow-sm flex flex-col">
        <div className="aspect-[16/10] bg-gray-100 relative">
          {image ? (
            <img src={image} alt={title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400">
              <span className="text-sm">{t("favorites.no_image") || "Нет изображения"}</span>
            </div>
          )}

          {/* Верх: бейдж + отзывы + сердечко */}
          <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none">
            <div className="flex items-center gap-2">
              {badge && (
                <span className="pointer-events-auto px-2 py-0.5 rounded-full text-white text-xs bg-black/50 backdrop-blur-md ring-1 ring-white/20">
                  {badge}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {/* Кнопка отзывов */}
              <ReviewsButton serviceId={id} initialRating={rating} t={t} />

              {/* Сердечко */}
              <button
                className="pointer-events-auto p-1.5 rounded-full bg-black/30 hover:bg-black/40 text-white backdrop-blur-md ring-1 ring-white/20"
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
          </div>

          {/* «Стеклянный» тултип при наведении */}
          <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="absolute inset-x-0 bottom-0 p-3">
              <div className="rounded-lg bg-white/10 backdrop-blur-md text-white text-xs sm:text-sm p-3 ring-1 ring-white/15 shadow-lg">
                <div className="font-semibold line-clamp-2">{title}</div>
                {hotel && (
                  <div>
                    <span className="opacity-80">{t("hotel") || "Отель"}: </span>
                    <span className="font-medium">{hotel}</span>
                  </div>
                )}
                {accommodation && (
                  <div>
                    <span className="opacity-80">{t("accommodation") || "Размещение"}: </span>
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
                    <span className="opacity-80">{t("marketplace.price") || "Цена"}: </span>
                    <span className="font-semibold">{prettyPrice}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

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

  /* ===================== Layout ===================== */
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
        {/* Кнопку «Назад» убрали */}
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
              <Card key={it.id || it.service?.id || JSON.stringify(it)} it={it} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
