import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../api";

/* ========= utils ========= */
function normalizeList(res) {
  // поддержка форматов: [], {items:[]}, {data:[]}
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

function safeStr(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

/* ========= page ========= */
export default function Marketplace() {
  const { t } = useTranslation();

  /* data */
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /* filters */
  const [q, setQ] = useState("");                    // свободный текст / локация
  const [from, setFrom] = useState("");              // details.directionFrom
  const [to, setTo] = useState("");                  // details.directionTo
  const [airline, setAirline] = useState("");        // details.airline
  const [hotel, setHotel] = useState("");            // details.hotel
  const [dateFrom, setDateFrom] = useState("");      // details.startDate
  const [dateTo, setDateTo] = useState("");          // details.endDate / returnDate
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("");

  const payload = useMemo(() => {
    const p = {
      q: q?.trim() || undefined,
      category: category || undefined,
      price_min: priceMin || undefined,
      price_max: priceMax || undefined,
      sort: sort || undefined,
      // backend понимает details.* (равенство/like)
      ...(from ? { "details.directionFrom": from } : {}),
      ...(to ? { "details.directionTo": to } : {}),
      ...(airline ? { "details.airline": airline } : {}),
      ...(hotel ? { "details.hotel": hotel } : {}),
      ...(dateFrom ? { "details.startDate": dateFrom } : {}),
      ...(dateTo ? { "details.endDate": dateTo, "details.returnDate": dateTo } : {}),
    };
    return p;
  }, [q, category, priceMin, priceMax, sort, from, to, airline, hotel, dateFrom, dateTo]);

  async function search(opts = {}) {
    setLoading(true);
    setError(null);
    try {
      const body = opts.all ? {} : payload;
      let res = await apiPost("/api/marketplace/search", body);
      let list = normalizeList(res);

      // graceful fallback
      if (!Array.isArray(list) || list.length === 0) {
        const pub = await apiGet("/api/services/public").catch(() => []);
        list = normalizeList(pub);
      }
      setItems(list);
    } catch (e) {
      setItems([]);
      setError(t("common.loading_error") || "Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // автозагрузка всех активных
    search({ all: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleQuickRequest(serviceId) {
    if (!serviceId) return;
    const note =
      window.prompt(
        t("common.note_optional", { defaultValue: "Комментарий к запросу (необязательно):" })
      ) || undefined;
    try {
      await apiPost("/api/requests", { service_id: serviceId, note });
      alert(t("messages.request_sent", { defaultValue: "Запрос отправлен" }));
    } catch {
      alert(t("errors.request_send", { defaultValue: "Не удалось отправить запрос" }));
    }
  }

  /* ========= card ========= */
  function Card({ it }) {
    const svc = it?.service || it; // на всякий случай
    const id = svc.id ?? it.id;

    const title =
      svc.title ||
      svc.name ||
      svc.service_title ||
      t("common.service", { defaultValue: "Услуга" });

    const images = Array.isArray(svc.images) ? svc.images : [];
    const image = images[0] || svc.cover || svc.image || null;

    const details = svc.details || {};
    const direction =
      details.direction ||
      [safeStr(details.directionFrom), "→", safeStr(details.directionTo)].filter(Boolean).join(" ");

    const hotelName = details.hotel || "";
    const accom = details.accommodation || details.accommodationCategory || "";
    const airlineName = details.airline || "";
    const start = details.startDate || details.startFlightDate || "";
    const end =
      details.endDate || details.returnDate || details.endFlightDate || "";
    const price = svc.price ?? details.netPrice ?? it.price ?? it.netPrice;
    const prettyPrice = fmtPrice(price);

    return (
      <div className="relative bg-white border rounded-xl overflow-hidden shadow-sm group flex flex-col">
        <div className="aspect-[16/10] bg-gray-100">
          {image ? (
            <img src={image} alt={title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
              {t("favorites.no_image", { defaultValue: "Нет изображения" })}
            </div>
          )}
        </div>

        <div className="p-3 flex-1 flex flex-col">
          <div className="font-semibold line-clamp-2">{title}</div>
          {direction && (
            <div className="mt-1 text-sm text-gray-600 line-clamp-1">{direction}</div>
          )}
          {prettyPrice && (
            <div className="mt-2 text-sm">
              {t("marketplace.price", { defaultValue: "Цена" })}:{" "}
              <span className="font-semibold">{prettyPrice}</span>
            </div>
          )}

          <div className="mt-auto pt-3 flex gap-2">
            <button
              onClick={() => handleQuickRequest(id)}
              className="flex-1 bg-orange-500 text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-orange-600"
            >
              {t("actions.quick_request", { defaultValue: "Быстрый запрос" })}
            </button>
          </div>
        </div>

        {/* Hover tooltip */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-full group-hover:translate-y-0 transition-all duration-150"
          style={{ zIndex: 2 }}
        >
          <div className="m-2 p-3 rounded-lg bg-white/95 shadow border text-xs leading-5">
            {direction && (
              <div>
                <span className="text-gray-500">{t("marketplace.direction", { defaultValue: "Направление" })}:</span>{" "}
                <span className="font-medium">{direction}</span>
              </div>
            )}
            {(start || end) && (
              <div>
                <span className="text-gray-500">{t("marketplace.dates", { defaultValue: "Даты" })}:</span>{" "}
                <span className="font-medium">
                  {start || "—"} {end ? `→ ${end}` : ""}
                </span>
              </div>
            )}
            {(hotelName || accom) && (
              <div>
                <span className="text-gray-500">{t("marketplace.hotel", { defaultValue: "Отель" })}:</span>{" "}
                <span className="font-medium">
                  {hotelName || "—"} {accom ? `• ${accom}` : ""}
                </span>
              </div>
            )}
            {airlineName && (
              <div>
                <span className="text-gray-500">{t("marketplace.airline", { defaultValue: "Авиакомпания" })}:</span>{" "}
                <span className="font-medium">{airlineName}</span>
              </div>
            )}
            {prettyPrice && (
              <div>
                <span className="text-gray-500">{t("marketplace.price", { defaultValue: "Цена" })}:</span>{" "}
                <span className="font-semibold">{prettyPrice}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ========= ui ========= */

  const categoryOptions = [
    { value: "", label: t("marketplace.select_category", { defaultValue: "Выберите категорию" }) },
    { value: "guide", label: t("category.city_tour_guide", { defaultValue: "Гид" }) },
    { value: "transport", label: t("category.city_tour_transport", { defaultValue: "Транспорт" }) },
    { value: "refused_tour", label: t("category.refused_tour", { defaultValue: "Отказной тур" }) },
    { value: "refused_hotel", label: t("category.refused_hotel", { defaultValue: "Отказной отель" }) },
    { value: "refused_flight", label: t("category.refused_flight", { defaultValue: "Отказной авиабилет" }) },
    { value: "refused_event_ticket", label: t("category.refused_event_ticket", { defaultValue: "Отказной билет на мероприятие" }) },
    { value: "visa_support", label: t("category.visa_support", { defaultValue: "Визовая поддержка" }) },
    { value: "author_tour", label: t("category.author_tour", { defaultValue: "Авторский тур" }) },
    { value: "hotel_room", label: t("category.hotel_room", { defaultValue: "Номер в отеле" }) },
    { value: "hotel_transfer", label: t("category.hotel_transfer", { defaultValue: "Трансфер от/до отеля" }) },
    { value: "hall_rent", label: t("category.hall_rent", { defaultValue: "Аренда зала" }) },
  ];

  const sortOptions = [
    { value: "", label: t("marketplace.sort.default", { defaultValue: "Сортировка" }) },
    { value: "newest", label: t("marketplace.sort.newest", { defaultValue: "Сначала новые" }) },
    { value: "price_asc", label: t("marketplace.sort.price_asc", { defaultValue: "Цена ↑" }) },
    { value: "price_desc", label: t("marketplace.sort.price_desc", { defaultValue: "Цена ↓" }) },
  ];

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6">
      {/* фильтры */}
      <div className="bg-white rounded-xl shadow p-4 border mb-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          <input
            className="md:col-span-3 border rounded-lg px-3 py-2"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("marketplace.location_placeholder", { defaultValue: "Внесите локацию ..." })}
          />

          <input
            className="md:col-span-2 border rounded-lg px-3 py-2"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder={t("marketplace.from", { defaultValue: "Откуда" })}
          />

          <input
            className="md:col-span-2 border rounded-lg px-3 py-2"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder={t("marketplace.to", { defaultValue: "Куда" })}
          />

          <input
            type="date"
            className="md:col-span-2 border rounded-lg px-3 py-2"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            placeholder="ДД.ММ.ГГГГ"
          />

          <input
            type="date"
            className="md:col-span-2 border rounded-lg px-3 py-2"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            placeholder="ДД.ММ.ГГГГ"
          />

          <select
            className="md:col-span-2 border rounded-lg px-3 py-2"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categoryOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <select
            className="md:col-span-2 border rounded-lg px-3 py-2"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            {sortOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <input
            className="md:col-span-2 border rounded-lg px-3 py-2"
            value={hotel}
            onChange={(e) => setHotel(e.target.value)}
            placeholder={t("marketplace.hotel", { defaultValue: "Отель" })}
          />

          <input
            className="md:col-span-2 border rounded-lg px-3 py-2"
            value={airline}
            onChange={(e) => setAirline(e.target.value)}
            placeholder={t("marketplace.airline", { defaultValue: "Авиакомпания" })}
          />

          <input
            className="md:col-span-2 border rounded-lg px-3 py-2"
            value={priceMin}
            onChange={(e) => setPriceMin(e.target.value)}
            placeholder={t("marketplace.price_from", { defaultValue: "Цена от" })}
          />

          <input
            className="md:col-span-2 border rounded-lg px-3 py-2"
            value={priceMax}
            onChange={(e) => setPriceMax(e.target.value)}
            placeholder={t("marketplace.price_to", { defaultValue: "Цена до" })}
          />

          <div className="md:col-span-2 flex gap-2">
            <button
              onClick={() => search()}
              disabled={loading}
              className="flex-1 px-4 py-2 rounded-lg bg-gray-900 text-white font-semibold disabled:opacity-60"
            >
              {t("marketplace.search", { defaultValue: "Найти" })}
            </button>
            <button
              onClick={() => {
                setQ("");
                setFrom("");
                setTo("");
                setAirline("");
                setHotel("");
                setDateFrom("");
                setDateTo("");
                setPriceMin("");
                setPriceMax("");
                setCategory("");
                setSort("");
                search({ all: true });
              }}
              disabled={loading}
              className="px-4 py-2 rounded-lg border"
            >
              {t("back", { defaultValue: "Назад" })}
            </button>
          </div>
        </div>
      </div>

      {/* список */}
      <div className="bg-white rounded-xl shadow p-6 border">
        {loading && (
          <div className="text-gray-500">
            {t("marketplace.searching", { defaultValue: "Поиск..." })}
          </div>
        )}

        {!loading && error && (
          <div className="text-red-600">{error}</div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="text-gray-500">
            {t("client.dashboard.noResults", { defaultValue: "Нет данных" })}
          </div>
        )}

        {!loading && !error && items.length > 0 && (
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
