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

/* ===================== Page ===================== */
export default function Marketplace() {
  const { t } = useTranslation();

  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const filters = useMemo(
    () => ({ q: q?.trim() || undefined, location: q?.trim() || undefined, category: category || undefined }),
    [q, category]
  );

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  // избранное
  const [favIds, setFavIds] = useState(new Set());

  // простой тост
  const [toast, setToast] = useState(null);
  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => setToast(null), 1800);
  };

  // кэш отзывов по услуге
  const [reviewsCache, setReviewsCache] = useState({});

  async function getServiceReviewsCached(serviceId) {
    if (reviewsCache[serviceId]) return reviewsCache[serviceId];
    try {
      const r = await apiGet(`/api/reviews/service/${serviceId}?limit=6`);
      const data = {
        count: Number(r?.count || 0),
        avg: Number(r?.avg || 0),
        items: Array.isArray(r?.items) ? r.items : [],
      };
      setReviewsCache((p) => ({ ...p, [serviceId]: data }));
      return data;
    } catch {
      const data = { count: 0, avg: 0, items: [] };
      setReviewsCache((p) => ({ ...p, [serviceId]: data }));
      return data;
    }
  }

  // Загрузка листинга
  const search = async (opts = {}) => {
    setLoading(true);
    setError(null);
    try {
      const payload = opts?.all ? {} : filters;
      let res = await apiPost("/api/marketplace/search", payload);
      let list = normalizeList(res);
      if (!list.length && opts?.fallback !== false) {
        res = await apiGet("/api/services/public");
        list = normalizeList(res);
      }
      if (filters.location) list = list.filter((it) => matchesLocation(it, filters.location));
      setItems(list);
    } catch {
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
      const res = await apiPost("/api/wishlist/toggle", { itemId: id });
      let nextIsFav;
      if (typeof res?.added === "boolean") nextIsFav = res.added;
      else if (typeof res?.isFav === "boolean") nextIsFav = res.isFav;
      else if (res?.action === "added") nextIsFav = true;
      else if (res?.action === "removed") nextIsFav = false;
      else nextIsFav = !favIds.has(id);

      setFavIds((prev) => {
        const next = new Set(prev);
        if (nextIsFav) next.add(id);
        else next.delete(id);
        return next;
      });

      showToast(
        nextIsFav
          ? t("toast.addedToFav") || "Добавлено в избранное"
          : t("toast.removedFromFav") || "Удалено из избранного"
      );
    } catch {
      showToast(t("toast.favoriteError") || "Не удалось изменить избранное");
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

  /* ======= small star view ======= */
  const Stars = ({ value = 0 }) => {
    const n = Math.round(value);
    return (
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <svg key={i} width="14" height="14" viewBox="0 0 24 24"
               className="text-yellow-400" fill={i <= n ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.4">
            <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.62L12 2 9.19 8.62 2 9.24l5.46 4.73L5.82 21z"/>
          </svg>
        ))}
      </div>
    );
  };

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
  const accommodation = firstNonEmpty(details.accommodation, details.accommodationCategory);
  const dates = buildDates(details);

  const rating = Number(svc.rating ?? details.rating ?? it.rating ?? 0);
  const statusRaw = (svc.status ?? it.status ?? details.status ?? "").toLowerCase();
  const status = ["draft","inactive"].includes(statusRaw) ? null : statusRaw || null;
  const badge = rating > 0 ? `★ ${rating.toFixed(1)}` : status;

  const isFav = favIds.has(id);

  // reviews state
  const cached = reviewsCache[id];
  const [revOpen, setRevOpen] = useState(false);
  const [rev, setRev] = useState(cached || null);
  const openReviews = async () => {
    setRevOpen(true);
    if (!rev) {
      const data = await getServiceReviewsCached(id);
      setRev(data);
    }
  };

  return (
    // у карточки overflow-visible, чтобы ничего не резалось
    <div className="group relative bg-white border rounded-xl shadow-sm flex flex-col overflow-visible">
      {/* БЛОК ИЗОБРАЖЕНИЯ — скругление и обрезка только тут */}
      <div className="relative aspect-[16/10] bg-gray-100 rounded-t-xl overflow-hidden">
        {image ? (
          <img src={image} alt={title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            <span className="text-sm">{t("favorites.no_image") || "Нет изображения"}</span>
          </div>
        )}

        {/* Верх: бейдж + кнопки */}
        <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none z-[10]">
          <div className="flex items-center gap-2">
            {badge && (
              <span className="pointer-events-auto px-2 py-0.5 rounded-full text-white text-xs bg-black/50 backdrop-blur-md ring-1 ring-white/20">
                {badge}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 pointer-events-auto">
            {/* reviews trigger (только кнопка) */}
            <div
              onMouseEnter={openReviews}
              onFocus={openReviews}
              onMouseLeave={() => setRevOpen(false)}
              className="relative"
            >
              <button
                className="p-1.5 rounded-full bg-black/35 hover:bg-black/45 text-white backdrop-blur-md ring-1 ring-white/20"
                title={t("reviews.title_service") || "Отзывы об услуге"}
                aria-label="Service reviews"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8z"/>
                </svg>
              </button>
              <span className="absolute -right-1 -top-1 text-[10px] leading-none px-1.5 py-0.5 rounded-full bg-white text-gray-900 shadow">
                {Number(rev?.count ?? 0)}
              </span>
            </div>

            {/* сердечко */}
            <button
              className={`p-1.5 rounded-full backdrop-blur-md ring-1 ring-white/20 transition ${
                isFav ? "bg-black/40 text-red-500" : "bg-black/30 text-white hover:bg-black/40"
              }`}
              onClick={(e) => { e.stopPropagation(); toggleFavorite(id); }}
              title={isFav ? t("favorites.removed") || "Удалено из избранного" : t("favorites.added") || "В избранное"}
              aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill={isFav ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8">
                <path d="M12 21s-7-4.534-9.5-8.25C1.1 10.3 2.5 6 6.5 6c2.2 0 3.5 1.6 3.5 1.6S11.8 6 14 6c4 0 5.4 4.3 4 6.75C19 16.466 12 21 12 21z"/>
              </svg>
            </button>
          </div>
        </div>

        {/* тёмный нижний оверлей */}
        <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity z-[5]">
          <div className="absolute inset-x-0 bottom-0 p-3">
            <div className="rounded-lg bg-black/55 text-white text-xs sm:text-sm p-3 ring-1 ring-white/10 shadow-lg">
              <div className="font-semibold line-clamp-2">{title}</div>
              {hotel && (<div><span className="opacity-80">{t("hotel") || "Отель"}: </span><span className="font-medium">{hotel}</span></div>)}
              {accommodation && (<div><span className="opacity-80">{t("accommodation") || "Размещение"}: </span><span className="font-medium">{accommodation}</span></div>)}
              {dates && (<div><span className="opacity-80">{t("date") || "Дата"}: </span><span className="font-medium">{dates}</span></div>)}
              {prettyPrice && (<div><span className="opacity-80">{t("marketplace.price") || "Цена"}: </span><span className="font-semibold">{prettyPrice}</span></div>)}
            </div>
          </div>
        </div>
      </div>

      {/* ПОПАП С ОТЗЫВАМИ — ВНЕ блока изображения, поверх карточки */}
      {revOpen && (
        <div
          className="absolute z-[2000] right-2 top-12 w-72 rounded-lg bg-black/80 text-white ring-1 ring-white/10 shadow-xl p-3"
          onMouseEnter={() => setRevOpen(true)}
          onMouseLeave={() => setRevOpen(false)}
        >
          <div className="text-xs uppercase opacity-80 mb-1">
            {t("reviews.title_service") || "Отзывы об услуге"}
          </div>
          <div className="flex items-center gap-2 mb-2">
            <Stars value={rev?.avg || 0} />
            <div className="text-xs opacity-80">({Number(rev?.count || 0)})</div>
          </div>
          {!rev ? (
            <div className="text-sm opacity-80">…</div>
          ) : rev.items.length ? (
            <ul className="space-y-2 max-h-56 overflow-auto pr-1">
              {rev.items.map((r) => (
                <li key={r.id} className="text-sm">
                  <div className="flex items-center gap-2">
                    <Stars value={r.rating} />
                    <span className="opacity-70 text-xs">
                      {new Date(r.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  {r.text && <div className="mt-0.5 line-clamp-2 opacity-95">{r.text}</div>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm opacity-80">{t("reviews.empty") || "Пока нет отзывов."}</div>
          )}
        </div>
      )}

      {/* тело карточки */}
      <div className="p-3 flex-1 flex flex-col">
        <div className="font-semibold line-clamp-2">{title}</div>
        {prettyPrice && (
          <div className="mt-1 text-sm">
            {t("marketplace.price") || "Цена"}: <span className="font-semibold">{prettyPrice}</span>
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
      {/* тост */}
      {toast && (
        <div className="fixed right-4 top-16 z-[1200]">
          <div className="bg-white shadow-lg border rounded-lg px-4 py-2 text-sm">{toast}</div>
        </div>
      )}

      {/* панель поиска */}
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

      {/* список */}
      <div className="bg-white rounded-xl shadow p-6 border">
        {loading && <div className="text-gray-500">{t("marketplace.searching") || "Поиск..."}</div>}
        {!loading && error && <div className="text-red-600">{error}</div>}
        {!loading && !error && !items.length && (
          <div className="text-gray-500">{t("client.dashboard.noResults") || "Нет результатов"}</div>
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
