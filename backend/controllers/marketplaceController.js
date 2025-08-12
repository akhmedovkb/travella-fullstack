import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import axios from "axios";
import { Link } from "react-router-dom";

/** определяем, куда вести “назад в кабинет” */
const hasClient = !!localStorage.getItem("clientToken");
const hasProvider =
  !!localStorage.getItem("token") || !!localStorage.getItem("providerToken");
const dashboardPath = hasProvider ? "/dashboard" : hasClient ? "/client/dashboard" : null;

/** вкладки */
const blocks = [
  "ГИД",
  "ТРАНСПОРТ",
  "ОТКАЗНОЙ ТУР",
  "ОТКАЗНОЙ ОТЕЛЬ",
  "ОТКАЗНОЙ АВИАБИЛЕТ",
  "ОТКАЗНОЙ БИЛЕТ",
];

export default function Marketplace() {
  const { t } = useTranslation();

  const [activeBlock, setActiveBlock] = useState(null);
  const [filters, setFilters] = useState({
    startDate: "",
    endDate: "",
    location: "",
    adults: 1,
    children: 0,
    infants: 0,
    providerType: "",
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
    setFilters((p) => ({ ...p, [field]: p[field] + 1 }));
  };
  const handleDecrement = (field) => {
    setFilters((p) => ({ ...p, [field]: Math.max(0, p[field] - 1) }));
  };

  const handleSearch = async () => {
    setIsLoading(true);
    setError("");
    try {
      const res = await axios.post(
        `${import.meta.env.VITE_API_BASE_URL}/api/marketplace/search`,
        filters
      );
      // Поддержка обоих форматов: {items:[]} и []
      const list = Array.isArray(res.data)
        ? res.data
        : Array.isArray(res.data?.items)
        ? res.data.items
        : [];
      setResults(list);
      setCurrentPage(1);
    } catch (err) {
      console.error(err);
      setError(t("common.loading_error") || "Ошибка при поиске");
    } finally {
      setIsLoading(false);
    }
  };

  const indexOfLast = currentPage * resultsPerPage;
  const indexOfFirst = indexOfLast - resultsPerPage;
  const currentResults = results.slice(indexOfFirst, indexOfLast);
  const totalPages = Math.max(1, Math.ceil(results.length / resultsPerPage));

  const renderRefusedHotelCard = (item) => {
    const d = item?.details || {};
    return (
      <li key={item.id} className="border rounded p-4 bg-gray-50">
        {item?.images?.length > 0 && (
          <img
            src={item.images[0]}
            alt="preview"
            className="w-full h-40 object-cover rounded mb-2"
          />
        )}
        <div className="font-bold text-lg">{d.hotelName || "—"}</div>
        <div className="text-sm text-gray-600">
          {d.directionCountry || "—"}
          {d.directionCountry && (d.directionTo ? ", " : "")}
          {d.directionTo || ""}
        </div>
        <div className="text-sm">
          🗓 {d.checkIn || "—"} → {d.checkOut || "—"}
        </div>
        <div className="text-sm">
          💰 {d.netPrice ? `${d.netPrice} USD` : "—"}
        </div>
        <button className="mt-2 text-orange-600 hover:underline">
          {t("marketplace.propose_price") || "Предложить цену"}
        </button>
      </li>
    );
  };

  const onTabClick = (block) => {
    setActiveBlock(block);
    let providerType = "";
    if (block === "ГИД") providerType = "guide";
    else if (block === "ТРАНСПОРТ") providerType = "transport";
    else if (
      ["ОТКАЗНОЙ ТУР", "ОТКАЗНОЙ ОТЕЛЬ", "ОТКАЗНОЙ АВИАБИЛЕТ", "ОТКАЗНОЙ БИЛЕТ"].includes(block)
    ) {
      providerType = "agent";
    }
    setFilters((prev) => ({ ...prev, providerType }));
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
          <span>{t("common.backToDashboard") || "в Личный кабинет"}</span>
        </Link>
      )}

      <h1 className="text-3xl font-bold mb-6 text-center">
        {t("marketplace.title") || "Доска объявлений"}
      </h1>

      {/* ВКЛАДКИ */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 mb-6">
        {blocks.map((block) => (
          <button
            key={block}
            onClick={() => onTabClick(block)}
            className={`p-4 rounded-xl shadow text-center font-semibold transition ${
              activeBlock === block
                ? "bg-orange-500 text-white"
                : "bg-white border border-gray-300 hover:bg-gray-100"
            }`}
          >
            {block}
          </button>
        ))}
      </div>

      {/* ФОРМА ПОИСКА */}
      {activeBlock && (
        <div className="bg-white rounded-xl p-6 shadow-md">
          <h2 className="text-xl font-semibold mb-4">
            {t("marketplace.search_in", { category: activeBlock }) ||
              `Поиск по ${activeBlock}:`}
          </h2>

          <div className="grid md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                {t("marketplace.start_date") || "Дата начала"}
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
                {t("marketplace.end_date") || "Дата окончания"}
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
                {t("marketplace.location") || "Локация"}
              </label>
              <input
                type="text"
                name="location"
                placeholder={t("marketplace.location_placeholder") || "Введите локацию ..."}
                value={filters.location}
                onChange={handleInputChange}
                className="border px-3 py-2 rounded w-full"
              />
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {[
              { field: "adults", label: t("marketplace.adults") || "Взрослые (12+)" },
              { field: "children", label: t("marketplace.children") || "Дети (2–11)" },
              { field: "infants", label: t("marketplace.infants") || "Младенцы (0–1)" },
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
              {isLoading
                ? t("marketplace.searching") || "Поиск…"
                : t("marketplace.search") || "Найти"}
            </button>
          </div>

          {error && <p className="text-red-500 mt-4">{error}</p>}

          {/* РЕЗУЛЬТАТЫ */}
          {currentResults.length > 0 && (
            <div className="mt-6">
              <h3 className="text-lg font-semibold mb-2">
                {t("marketplace.results") || "Результаты:"}
              </h3>

              <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {currentResults.map((item) =>
                  activeBlock === "ОТКАЗНОЙ ОТЕЛЬ" ? (
                    renderRefusedHotelCard(item)
                  ) : (
                    <li key={item.id} className="border rounded p-4 bg-gray-50">
                      {item?.images?.length > 0 && (
                        <img
                          src={item.images[0]}
                          alt="preview"
                          className="w-full h-40 object-cover rounded mb-2"
                        />
                      )}
                      <div className="font-bold">{item.title}</div>
                      {item.description && (
                        <div className="text-sm text-gray-700">{item.description}</div>
                      )}
                      <div className="text-sm text-gray-600">{item.category}</div>
                      {item.price != null && (
                        <div className="text-sm">
                          {t("marketplace.price") || "Цена"}: {item.price}
                        </div>
                      )}
                      {item.location && (
                        <div className="text-sm">
                          {t("marketplace.location") || "Локация"}: {item.location}
                        </div>
                      )}
                      <button className="mt-2 text-orange-600 hover:underline">
                        {t("marketplace.propose_price") || "Предложить цену"}
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
}
