import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import axios from "axios";
import { Link } from "react-router-dom";

/* ---------- auth / маршруты ---------- */
const hasClient = !!localStorage.getItem("clientToken");
const hasProvider = !!localStorage.getItem("token") || !!localStorage.getItem("providerToken");
const dashboardPath = hasProvider ? "/dashboard" : hasClient ? "/client/dashboard" : null;

/* ---------- константы визуала (НЕ менял) ---------- */
const blocks = [
  "ГИД",
  "ТРАНСПОРТ",
  "ОТКАЗНОЙ ТУР",
  "ОТКАЗНОЙ ОТЕЛЬ",
  "ОТКАЗНОЙ АВИАБИЛЕТ",
  "ОТКАЗНОЙ БИЛЕТ",
];

/* ---------- небольшие хелперы (логика, без изменения UI) ---------- */
function normalizeList(res) {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.items)) return res.items;
  if (Array.isArray(res?.data)) return res.data;
  return [];
}

function priceOf(item) {
  const d = item?.details || {};
  const raw = d.netPrice ?? item.price;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? new Intl.NumberFormat().format(n) : String(raw);
}

function mapBlockToFilters(block) {
  // что уходит в бэкенд
  switch (block) {
    case "ГИД":
      return { providerType: "guide" };
    case "ТРАНСПОРТ":
      return { providerType: "transport" };
    case "ОТКАЗНОЙ ТУР":
      return { category: "refused_tour" };
    case "ОТКАЗНОЙ ОТЕЛЬ":
      return { category: "refused_hotel" };
    case "ОТКАЗНОЙ АВИАБИЛЕТ":
      return { category: "refused_flight" };
    case "ОТКАЗНОЙ БИЛЕТ":
      return { category: "refused_event_ticket" };
    default:
      return {};
  }
}

const MarketplaceBoard = () => {
  const { t } = useTranslation();

  const [activeBlock, setActiveBlock] = useState(null);

  // фильтры формы (НЕ менял поля формы и вёрстку)
  const [filters, setFilters] = useState({
    startDate: "",
    endDate: "",
    location: "",
    adults: 1,
    children: 0,
    infants: 0,
    providerType: "",
    category: "",
  });

  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const resultsPerPage = 6;

  const handleInputChange = (e) => {
    setFilters({ ...filters, [e.target.name]: e.target.value });
  };

  const handleIncrement = (field) => {
    setFilters((prev) => ({ ...prev, [field]: prev[field] + 1 }));
  };

  const handleDecrement = (field) => {
    setFilters((prev) => ({ ...prev, [field]: Math.max(0, prev[field] - 1) }));
  };

  const handleSearch = async () => {
    setIsLoading(true);
    setError("");
    try {
      // минимально-достаточный payload под наш marketplaceController:
      const payload = {
        q: filters.location?.trim() || undefined,
        category: filters.category || undefined,
        only_active: true,
        // можно расширять: price_min/price_max/sort/etc.
        // даты оставляем на будущее (бек пока их не читает)
      };

      const res = await axios.post(
        `${import.meta.env.VITE_API_BASE_URL}/api/marketplace/search`,
        payload
      );

      const list = normalizeList(res.data);
      setResults(list);
      setCurrentPage(1);
    } catch (err) {
      console.error("Поиск не удался", err);
      // fallback: публичные услуги, чтобы страница не пустела
      try {
        const alt = await axios.get(`${import.meta.env.VITE_API_BASE_URL}/api/services/public`);
        setResults(normalizeList(alt.data));
      } catch (e2) {
        setResults([]);
        setError(t("common.loading_error") || "Ошибка при поиске");
      }
    } finally {
      setIsLoading(false);
    }
  };

  /* ---------- пагинация (НЕ менял разметку) ---------- */
  const indexOfLast = currentPage * resultsPerPage;
  const indexOfFirst = indexOfLast - resultsPerPage;
  const currentResults = results.slice(indexOfFirst, indexOfLast);
  const totalPages = Math.ceil(results.length / resultsPerPage);

  /* ---------- карточка отказного отеля (чуть умнее чтение details, UI тот же) ---------- */
  const renderRefusedHotelCard = (item) => {
    const d = item.details || {};
    const img = Array.isArray(item.images) && item.images.length ? item.images[0] : null;
    const hotelName = d.hotel || d.hotelName || "—";
    const country = d.directionCountry || d.direction || "—";
    const city = d.directionTo || d.location || "—";
    const start = d.startDate || d.checkIn || "";
    const end = d.endDate || d.checkOut || "";
    const prettyPrice = priceOf(item);

    return (
      <li key={item.id} className="border rounded p-4 bg-gray-50">
        {img && (
          <img
            src={img}
            alt="preview"
            className="w-full h-40 object-cover rounded mb-2"
          />
        )}
        <div className="font-bold text-lg">{hotelName}</div>
        <div className="text-sm text-gray-600">
          {country}, {city}
        </div>
        <div className="text-sm">
          🗓 {start || "—"} → {end || "—"}
        </div>
        <div className="text-sm">
          💰 {prettyPrice ? `${prettyPrice} USD` : "—"}
        </div>
        <button className="mt-2 text-orange-600 hover:underline">
          {t("marketplace.propose_price")}
        </button>
      </li>
    );
  };

  return (
    <div className="p-6">
      {dashboardPath && (
        <Link
          to={dashboardPath}
          className="inline-flex items-center gap-2 text-gray-600 hover:text-orange-600 mb-3"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M15 19l-7-7 7-7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>{t("common.backToDashboard")}</span>
        </Link>
      )}

      <h1 className="text-3xl font-bold mb-6 text-center">{t("marketplace.title")}</h1>

      {/* блоки (вёрстка сохранена) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 mb-6">
        {blocks.map((block, idx) => (
          <button
            key={idx}
            className={`p-4 rounded-xl shadow text-center font-semibold transition ${
              activeBlock === block
                ? "bg-orange-500 text-white"
                : "bg-white border border-gray-300 hover:bg-gray-100"
            }`}
            onClick={() => {
              setActiveBlock(block);
              const mapped = mapBlockToFilters(block);
              setFilters((prev) => ({ ...prev, ...mapped }));
            }}
          >
            {block}
          </button>
        ))}
      </div>

      {/* форма поиска (вёрстка сохранена) */}
      {activeBlock && (
        <div className="bg-white rounded-xl p-6 shadow-md">
          <h2 className="text-xl font-semibold mb-4">
            {t("marketplace.search_in", { category: activeBlock })}
          </h2>

          <div className="grid md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                {t("marketplace.start_date")}
              </label>
              <input
                type="date"
                name="startDate"
                value={filters.startDate}
                onChange={handleInputChange}
                className="border px-3 py-2 rounded w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                {t("marketplace.end_date")}
              </label>
              <input
                type="date"
                name="endDate"
                value={filters.endDate}
                onChange={handleInputChange}
                className="border px-3 py-2 rounded w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                {t("marketplace.location")}
              </label>
              <input
                type="text"
                name="location"
                placeholder={t("marketplace.location_placeholder")}
                value={filters.location}
                onChange={handleInputChange}
                className="border px-3 py-2 rounded w-full"
              />
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {[
              { field: "adults", label: t("marketplace.adults") },
              { field: "children", label: t("marketplace.children") },
              { field: "infants", label: t("marketplace.infants") },
            ].map(({ field, label }) => (
              <div key={field} className="flex items-center justify-between">
                <span className="font-medium">{label}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleDecrement(field)}
                    className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300"
                  >
                    −
                  </button>
                  <span className="w-6 text-center">{filters[field]}</span>
                  <button
                    onClick={() => handleIncrement(field)}
                    className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300"
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 text-right">
            <button
              onClick={handleSearch}
              className="bg-orange-500 text-white px-6 py-2 rounded font-semibold"
            >
              {isLoading ? t("marketplace.searching") : t("marketplace.search")}
            </button>
          </div>

          {error && <p className="text-red-500 mt-4">{error}</p>}

          {/* Результаты (вёрстка сохранена) */}
          {currentResults.length > 0 && (
            <div className="mt-6">
              <h3 className="text-lg font-semibold mb-2">{t("marketplace.results")}:</h3>

              <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {currentResults.map((item) =>
                  activeBlock === "ОТКАЗНОЙ ОТЕЛЬ" ? (
                    renderRefusedHotelCard(item)
                  ) : (
                    <li key={item.id} className="border rounded p-4 bg-gray-50">
                      {Array.isArray(item.images) && item.images.length > 0 && (
                        <img
                          src={item.images[0]}
                          alt="preview"
                          className="w-full h-40 object-cover rounded mb-2"
                        />
                      )}
                      <div className="font-bold">{item.title}</div>
                      <div>{item.description}</div>
                      <div className="text-sm text-gray-600">{item.category}</div>
                      <div className="text-sm">
                        {t("marketplace.price")}: {priceOf(item) ?? "—"}
                      </div>
                      <div className="text-sm">
                        {t("marketplace.location")}: {(item.details?.location || item.location || "—")}
                      </div>
                      <button className="mt-2 text-orange-600 hover:underline">
                        {t("marketplace.propose_price")}
                      </button>
                    </li>
                  )
                )}
              </ul>

              {totalPages > 1 && (
                <div className="mt-4 flex justify-center gap-2">
                  {Array.from({ length: totalPages }, (_, i) => (
                    <button
                      key={i}
                      onClick={() => setCurrentPage(i + 1)}
                      className={`px-3 py-1 rounded border font-medium ${
                        currentPage === i + 1
                          ? "bg-orange-500 text-white"
                          : "bg-white text-gray-700"
                      }`}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MarketplaceBoard;
