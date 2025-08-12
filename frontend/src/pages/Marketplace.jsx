import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../api";

/* ================= utils ================= */
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

function truthy(obj) {
  const out = {};
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (v === "" || v === undefined || v === null) return;
    out[k] = v;
  });
  return out;
}

/* ================ main ================== */
export default function Marketplace() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  // простые + расширенные фильтры
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");

  const [directionFrom, setDirectionFrom] = useState("");
  const [directionTo, setDirectionTo] = useState("");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [hotel, setHotel] = useState("");
  const [airline, setAirline] = useState("");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [sort, setSort] = useState(""); // newest | price_asc | price_desc

  // локально отмечаем лайки (визуально)
  const [fav, setFav] = useState(() => new Set());

  // модалка бронирования
  const [bookingUI, setBookingUI] = useState({ open: false, serviceId: null });
  const [bkDate, setBkDate] = useState("");
  const [bkTime, setBkTime] = useState("");
  const [bkPax, setBkPax] = useState(1);
  const [bkNote, setBkNote] = useState("");
  const [bkSending, setBkSending] = useState(false);

  const filters = useMemo(() => {
    const base = {
      q: q?.trim() || undefined,
      category: category || undefined,
      price_min: priceMin || undefined,
      price_max: priceMax || undefined,
      sort: sort || undefined,
      "details.directionFrom": directionFrom || undefined,
      "details.directionTo": directionTo || undefined,
      "details.startDate": dateStart || undefined,
      "details.endDate": dateEnd || undefined,
      "details.hotel": hotel || undefined,
      "details.airline": airline || undefined,
      only_active: true,
    };
    return truthy(base);
  }, [q, category, priceMin, priceMax, sort, directionFrom, directionTo, dateStart, dateEnd, hotel, airline]);

  const search = async (opts = {}) => {
    setLoading(true);
    setError(null);
    try {
      const payload = opts?.all ? {} : filters;

      // Путь 1: общий поиск по маркетплейсу
      let res = await apiPost("/api/marketplace/search", payload);
      let list = normalizeList(res);

      // Путь 2 (fallback): если эндпоинта нет — публичный список услуг
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
  };

  // авто-поиск всего при первом открытии
  useEffect(() => {
    search({ all: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleQuickRequest = async (serviceId) => {
    if (!serviceId) return;
    const note = window.prompt(t("common.note_optional") || "Комментарий (необязательно)") || undefined;
    try {
      await apiPost("/api/requests", { service_id: serviceId, note });
      alert((t("actions.quick_request") || "Запрос") + " ✓");
    } catch {
      alert(t("common.loading_error") || "Не удалось отправить запрос");
    }
  };

  const handleOpenBooking = (serviceId) => {
    setBookingUI({ open: true, serviceId });
    setBkDate("");
    setBkTime("");
    setBkPax(1);
    setBkNote("");
  };
  const closeBooking = () => setBookingUI({ open: false, serviceId: null });

  const createBooking = async () => {
    if (!bookingUI.serviceId) return;
    setBkSending(true);
    try {
      const details = {
        date: bkDate || undefined,
        time: bkTime || undefined,
        pax: Number(bkPax) || 1,
        note: bkNote || undefined,
      };
      await apiPost("/api/bookings", { service_id: bookingUI.serviceId, details });
      closeBooking();
      alert(t("messages.booking_created", { defaultValue: "Бронирование отправлено" }));
    } catch {
      alert(t("errors.booking_create", { defaultValue: "Не удалось создать бронирование" }));
    } finally {
      setBkSending(false);
    }
  };

  const toggleFavorite = async (serviceId) => {
    try {
      // пробуем оба варианта поля на бекенде
      await apiPost("/api/wishlist/toggle", { service_id: serviceId }).catch(() =>
        apiPost("/api/wishlist/toggle", { serviceId })
      );
      setFav((prev) => {
        const next = new Set(prev);
        if (next.has(serviceId)) next.delete(serviceId);
        else next.add(serviceId);
        return next;
      });
    } catch {
      alert(t("errors.favorite_toggle", { defaultValue: "Не удалось добавить/удалить из избранного" }));
    }
  };

  /* ============== Card ============== */
  const Card = ({ it }) => {
    const svc = it?.service || it;
    const id = svc.id ?? it.id;

    const title =
      svc.title ||
      svc.name ||
      svc.service_title ||
      t("title") ||
      "Service";

    const images = Array.isArray(svc.images) ? svc.images : [];
    const image = images[0] || svc.cover || svc.image || null;

    const d = svc.details || {};
    const comp = {
      directionFrom: d.directionFrom || svc.direction_from || d.from || null,
      directionTo: d.directionTo || svc.direction_to || d.to || d.directionTo || null,
      startDate: d.startDate || svc.start_date || d.departureDate || null,
      endDate: d.endDate || svc.end_date || d.returnDate || null,
      hotel: d.hotel || svc.hotel || null,
      accommodation: d.accommodation || d.room || svc.room || null,
      airline: d.airline || svc.airline || null,
      price: d.netPrice ?? svc.price ?? it.price ?? it.net_price ?? null,
    };

    const prettyPrice = fmtPrice(comp.price);
    const location =
      svc.location ||
      svc.city ||
      comp.directionTo ||
      svc.direction ||
      null;

    const isFav = fav.has(id);

    return (
      <div className="group relative bg-white border rounded-xl overflow-hidden shadow-sm flex flex-col">
        <div className="aspect-[16/10] bg-gray-100">
          {image ? (
            <img src={image} alt={title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
              {t("favorites_no_image") || "No image"}
            </div>
          )}
        </div>

        <div className="p-3 flex-1 flex flex-col">
          <div className="font-semibold line-clamp-2">{title}</div>
          {location && <div className="mt-1 text-sm text-gray-500">{location}</div>}
          {prettyPrice && (
            <div className="mt-2 text-sm">
              {t("marketplace.price") || "Price"}:{" "}
              <span className="font-semibold">{prettyPrice} USD</span>
            </div>
          )}

          <div className="mt-auto pt-3 flex gap-2">
            <button
              onClick={() => handleQuickRequest(id)}
              className="flex-1 bg-orange-500 text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-orange-600"
            >
              {t("actions.quick_request") || "Quick request"}
            </button>
            <button
              onClick={() => handleOpenBooking(id)}
              className="flex-1 border rounded-lg px-3 py-2 text-sm hover:bg-gray-50"
            >
              {t("actions.book_now", { defaultValue: "Забронировать" })}
            </button>
            <button
              onClick={() => toggleFavorite(id)}
              className={`px-3 py-2 text-sm rounded-lg border hover:bg-gray-50 ${isFav ? "bg-yellow-50 border-yellow-300" : ""}`}
              title={isFav ? t("favorites.remove", { defaultValue: "Убрать из избранного" }) : t("favorites.add", { defaultValue: "В избранное" })}
            >
              {isFav ? "★" : "☆"}
            </button>
          </div>
        </div>

        {/* Hover overlay with composition */}
        <div className="pointer-events-none absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="absolute inset-x-0 bottom-0 p-3 text-white text-xs leading-5">
            <div className="font-semibold mb-1">
              {t("marketplace.composition", { defaultValue: "Состав услуги" })}
            </div>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
              {comp.directionFrom && <li>{t("from", { defaultValue: "Откуда" })}: {comp.directionFrom}</li>}
              {comp.directionTo && <li>{t("to", { defaultValue: "Куда" })}: {comp.directionTo}</li>}
              {comp.startDate && <li>{t("departure_date", { defaultValue: "Дата вылета" })}: {comp.startDate}</li>}
              {comp.endDate && <li>{t("return_date", { defaultValue: "Дата возврата" })}: {comp.endDate}</li>}
              {comp.hotel && <li>{t("hotel", { defaultValue: "Отель" })}: {comp.hotel}</li>}
              {comp.accommodation && <li>{t("accommodation", { defaultValue: "Размещение" })}: {comp.accommodation}</li>}
              {comp.airline && <li>{t("airline", { defaultValue: "Авиакомпания" })}: {comp.airline}</li>}
              {prettyPrice && <li>{t("price", { defaultValue: "Цена" })}: {prettyPrice} USD</li>}
            </ul>
          </div>
        </div>
      </div>
    );
  };

  /* ============== render ============== */
  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6">
      {/* Поисковая панель (расширенная, но лёгкая) */}
      <div className="bg-white rounded-xl shadow p-4 border mb-4 space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("marketplace.location_placeholder") || "Введите запрос..."}
            className="flex-1 border rounded-lg px-3 py-2"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full md:w-56 border rounded-lg px-3 py-2"
          >
            <option value="">{t("marketplace.select_category") || "Категория"}</option>
            <option value="guide">{t("guide") || "Гид"}</option>
            <option value="transport">{t("transport") || "Транспорт"}</option>
            <option value="refused_tour">{t("refused_tour") || "Отказной тур"}</option>
            <option value="refused_hotel">{t("refused_hotel") || "Отказной отель"}</option>
            <option value="refused_flight">{t("refused_ticket") || "Отказной билет"}</option>
            <option value="refused_event_ticket">{t("refused_event") || "Событие"}</option>
            <option value="visa_support">{t("visa_support") || "Виза"}</option>
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="w-full md:w-44 border rounded-lg px-3 py-2"
          >
            <option value="">{t("sort", { defaultValue: "Сортировка" })}</option>
            <option value="newest">{t("sort_newest", { defaultValue: "Сначала новые" })}</option>
            <option value="price_asc">{t("sort_price_asc", { defaultValue: "Цена ↑" })}</option>
            <option value="price_desc">{t("sort_price_desc", { defaultValue: "Цена ↓" })}</option>
          </select>
        </div>

        <div className="grid md:grid-cols-4 gap-3">
          <input
            className="border rounded-lg px-3 py-2"
            placeholder={t("from", { defaultValue: "Откуда" })}
            value={directionFrom}
            onChange={(e) => setDirectionFrom(e.target.value)}
          />
          <input
            className="border rounded-lg px-3 py-2"
            placeholder={t("to", { defaultValue: "Куда" })}
            value={directionTo}
            onChange={(e) => setDirectionTo(e.target.value)}
          />
          <input
            type="date"
            className="border rounded-lg px-3 py-2"
            value={dateStart}
            onChange={(e) => setDateStart(e.target.value)}
            title={t("departure_date", { defaultValue: "Дата вылета" })}
          />
          <input
            type="date"
            className="border rounded-lg px-3 py-2"
            value={dateEnd}
            onChange={(e) => setDateEnd(e.target.value)}
            title={t("return_date", { defaultValue: "Дата возврата" })}
          />
          <input
            className="border rounded-lg px-3 py-2"
            placeholder={t("hotel", { defaultValue: "Отель" })}
            value={hotel}
            onChange={(e) => setHotel(e.target.value)}
          />
          <input
            className="border rounded-lg px-3 py-2"
            placeholder={t("airline", { defaultValue: "Авиакомпания" })}
            value={airline}
            onChange={(e) => setAirline(e.target.value)}
          />
          <input
            type="number"
            className="border rounded-lg px-3 py-2"
            placeholder={t("price_min", { defaultValue: "Цена от" })}
            value={priceMin}
            onChange={(e) => setPriceMin(e.target.value)}
          />
          <input
            type="number"
            className="border rounded-lg px-3 py-2"
            placeholder={t("price_max", { defaultValue: "Цена до" })}
            value={priceMax}
            onChange={(e) => setPriceMax(e.target.value)}
          />
        </div>

        <div className="flex gap-2">
          <button onClick={() => search()} className="px-4 py-2 rounded-lg bg-gray-900 text-white" disabled={loading}>
            {t("marketplace.search") || "Search"}
          </button>
          <button
            onClick={() => {
              setQ("");
              setCategory("");
              setDirectionFrom("");
              setDirectionTo("");
              setDateStart("");
              setDateEnd("");
              setHotel("");
              setAirline("");
              setPriceMin("");
              setPriceMax("");
              setSort("");
              search({ all: true });
            }}
            className="px-4 py-2 rounded-lg border"
            disabled={loading}
          >
            {t("back") || "Reset"}
          </button>
        </div>
      </div>

      {/* Список */}
      <div className="bg-white rounded-xl shadow p-6 border">
        {loading && <div className="text-gray-500">{t("marketplace.searching") || "Searching..."}</div>}
        {!loading && error && <div className="text-red-600">{error}</div>}
        {!loading && !error && !items.length && (
          <div className="text-gray-500">{t("client.dashboard.noResults") || "No results"}</div>
        )}
        {!loading && !error && !!items.length && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {items.map((it) => (
              <Card key={it.id || it.service?.id || JSON.stringify(it)} it={it} />
            ))}
          </div>
        )}
      </div>

      {/* модалка бронирования */}
      {bookingUI.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md bg-white rounded-xl shadow p-5">
            <div className="text-lg font-semibold mb-3">
              {t("booking.title", { defaultValue: "Быстрое бронирование" })}
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-gray-600">{t("booking.date", { defaultValue: "Дата" })}</label>
                  <input
                    type="date"
                    className="mt-1 w-full border rounded-lg px-3 py-2"
                    value={bkDate}
                    onChange={(e) => setBkDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-600">{t("booking.time", { defaultValue: "Время" })}</label>
                  <input
                    type="time"
                    className="mt-1 w-full border rounded-lg px-3 py-2"
                    value={bkTime}
                    onChange={(e) => setBkTime(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="text-sm text-gray-600">{t("booking.pax", { defaultValue: "Кол-во людей" })}</label>
                <input
                  type="number"
                  min="1"
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={bkPax}
                  onChange={(e) => setBkPax(e.target.value)}
                />
              </div>

              <div>
                <label className="text-sm text-gray-600">
                  {t("common.note_optional", { defaultValue: "Комментарий (необязательно)" })}
                </label>
                <textarea
                  rows={3}
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={bkNote}
                  onChange={(e) => setBkNote(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={createBooking}
                disabled={bkSending}
                className="flex-1 bg-orange-500 text-white rounded-lg px-4 py-2 font-semibold disabled:opacity-60"
              >
                {bkSending ? t("common.sending", { defaultValue: "Отправка..." }) : t("booking.submit", { defaultValue: "Забронировать" })}
              </button>
              <button onClick={closeBooking} className="px-4 py-2 rounded-lg border">
                {t("actions.cancel", { defaultValue: "Отмена" })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
