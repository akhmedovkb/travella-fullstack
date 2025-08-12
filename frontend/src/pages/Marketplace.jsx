import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../api";

/* ================= helpers ================= */

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

function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return null;
}

function buildDates(d = {}) {
  // Приоритет: тур/виза: startDate–endDate | авиаперелёт: startFlightDate–endFlightDate | отель: hotel_check_in–hotel_check_out | событие: eventDate
  const s1 = firstNonEmpty(d.startDate, d.departure_date, d.start_flight_date, d.startFlightDate, d.hotel_check_in);
  const e1 = firstNonEmpty(d.endDate, d.returnDate, d.end_flight_date, d.endFlightDate, d.hotel_check_out);
  const ev = firstNonEmpty(d.eventDate, d.event_date);

  if (s1 && e1) return `${s1} → ${e1}`;
  if (s1) return `${s1}`;
  if (ev) return `${ev}`;
  return null;
}

/* ================= main ================= */

export default function Marketplace() {
  const { t } = useTranslation();

  // filters
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const filters = useMemo(
    () => ({
      q: q?.trim() || undefined,
      category: category || undefined,
    }),
    [q, category]
  );

  // data state
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  // tooltip state (id -> bool) можно и без state, но так предсказуемо
  const [hoverId, setHoverId] = useState(null);

  async function search(opts = {}) {
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
      setItems(list);
    } catch (e) {
      setError(t("common.loading_error") || "Не удалось загрузить данные");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    search({ all: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      alert(t("requests.sent") || "Запрос отправлен");
    } catch {
      alert(t("requests.error") || "Не удалось отправить запрос");
    }
  };

  /* ================= card ================= */

  const Card = ({ it }) => {
    const svc = it?.service || it;
    const id = svc.id ?? it.id;
    const details = svc.details || it.details || {};
    const title =
      svc.title ||
      svc.name ||
      details.eventName ||
      t("title") ||
      "Service";

    const images = Array.isArray(svc.images) ? svc.images : [];
    const image = images[0] || svc.cover || svc.image || null;
    const price = firstNonEmpty(details.netPrice, svc.price, it.price);
    const prettyPrice = fmtPrice(price);

    // tooltip fields
    const hotel = firstNonEmpty(details.hotel, details.refused_hotel_name);
    const accommodation = firstNonEmpty(
      details.accommodation,
      details.accommodationCategory
    );
    const dates = buildDates(details);

    return (
      <div
        className="group relative bg-white border rounded-xl overflow-hidden shadow-sm flex flex-col"
        onMouseEnter={() => setHoverId(id)}
        onMouseLeave={() => setHoverId((prev) => (prev === id ? null : prev))}
      >
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

          {/* Tooltip overlay */}
          <div
            className={`pointer-events-none absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity`}
          >
            <div className="absolute left-0 right-0 bottom-0 p-3">
              <div className="rounded-lg bg-black/60 text-white text-xs sm:text-sm p-3 space-y-1">
                <div className="font-semibold line-clamp-2">{title}</div>
                {hotel && (
                  <div>
                    <span className="opacity-75">{t("hotel") || "Отель"}: </span>
                    <span className="font-medium">{hotel}</span>
                  </div>
                )}
                {accommodation && (
                  <div>
                    <span className="opacity-75">
                      {t("accommodation") || "Размещение"}:{" "}
                    </span>
                    <span className="font-medium">{accommodation}</span>
                  </div>
                )}
                {dates && (
                  <div>
                    <span className="opacity-75">{t("date") || "Дата"}: </span>
                    <span className="font-medium">{dates}</span>
                  </div>
                )}
                {prettyPrice && (
                  <div>
                    <span className="opacity-75">
                      {t("marketplace.price") || "Цена"}:{" "}
                    </span>
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

  /* ================= render ================= */

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6">
      {/* Панель поиска — БЕЗ кнопки «Назад» */}
      <div className="bg-white rounded-xl shadow p-4 border mb-4 flex flex-col md:flex-row gap-3">
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
          <option value="">{t("marketplace.select_category") || "Выберите категорию"}</option>
          <option value="guide">{t("marketplace.guide") || "Гид"}</option>
          <option value="transport">{t("marketplace.transport") || "Транспорт"}</option>
          <option value="refused_tour">{t("category.refused_tour") || "Отказной тур"}</option>
          <option value="refused_hotel">{t("category.refused_hotel") || "Отказной отель"}</option>
          <option value="refused_flight">{t("category.refused_flight") || "Отказной авиабилет"}</option>
          <option value="refused_event_ticket">
            {t("category.refused_event_ticket") || "Отказной билет на мероприятие"}
          </option>
          <option value="visa_support">{t("category.visa_support") || "Визовая поддержка"}</option>
        </select>

        <button
          onClick={() => search()}
          className="px-4 py-2 rounded-lg bg-gray-900 text-white"
          disabled={loading}
        >
          {t("marketplace.search") || "Найти"}
        </button>
      </div>

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
