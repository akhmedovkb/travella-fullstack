import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import axios from "axios";

const blocks = [
  "ГИД",
  "ТРАНСПОРТ",
  "ОТКАЗНОЙ ТУР",
  "ОТКАЗНОЙ ОТЕЛЬ",
  "ОТКАЗНОЙ АВИАБИЛЕТ",
  "ОТКАЗНОЙ БИЛЕТ"
];

const MarketplaceBoard = () => {
  const { t } = useTranslation();
  const [activeBlock, setActiveBlock] = useState(null);
  const [filters, setFilters] = useState({
    startDate: "",
    endDate: "",
    location: "",
    adults: 1,
    children: 0,
    infants: 0,
    providerType: ""
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
      const res = await axios.post(
        `${import.meta.env.VITE_API_BASE_URL}/api/marketplace/search`,
        filters
      );
      setResults(res.data);
      setCurrentPage(1);
    } catch (err) {
      setError("Ошибка при поиске");
      console.error("Поиск не удался", err);
    } finally {
      setIsLoading(false);
    }
  };

  const indexOfLast = currentPage * resultsPerPage;
  const indexOfFirst = indexOfLast - resultsPerPage;
  const currentResults = results.slice(indexOfFirst, indexOfLast);
  const totalPages = Math.ceil(results.length / resultsPerPage);

  const renderRefusedHotelCard = (item) => {
    const d = item.details || {};
    return (
      <li key={item.id} className="border rounded p-4 bg-gray-50">
        {item.images?.length > 0 && (
          <img
            src={item.images[0]}
            alt="preview"
            className="w-full h-40 object-cover rounded mb-2"
          />
        )}
        <div className="font-bold text-lg">{d.hotelName || "—"}</div>
        <div className="text-sm text-gray-600">
          {d.directionCountry || "—"}, {d.directionTo || "—"}
        </div>
        <div className="text-sm">
          🗓 {d.checkIn || "—"} → {d.checkOut || "—"}
        </div>
        <div className="text-sm">
          💰 {d.netPrice ? `${d.netPrice} USD` : "—"}
        </div>
        <button className="mt-2 text-orange-600 hover:underline">
          {t("marketplace.propose_price")}
        </button>
      </li>
    );
  };

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6 text-center">{t("marketplace.title")}</h1>

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
              let providerType = "";
              if (block === "ГИД") providerType = "guide";
              else if (block === "ТРАНСПОРТ") providerType = "transport";
              else if (
                ["ОТКАЗНОЙ ТУР", "ОТКАЗНОЙ ОТЕЛЬ", "ОТКАЗНОЙ АВИАБИЛЕТ", "ОТКАЗНОЙ БИЛЕТ"].includes(
                  block
                )
              ) {
                providerType = "agent";
              }
              setFilters((prev) => ({ ...prev, providerType }));
            }}
          >
            {block}
          </button>
        ))}
      </div>

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
              { field: "infants", label: t("marketplace.infants") }
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

          {currentResults.length > 0 && (
            <div className="mt-6">
              <h3 className="text-lg font-semibold mb-2">{t("marketplace.results")}:</h3>
              <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {currentResults.map((item) =>
                  activeBlock === "ОТКАЗНОЙ ОТЕЛЬ"
                    ? renderRefusedHotelCard(item)
                    : (
                      <li key={item.id} className="border rounded p-4 bg-gray-50">
                        {item.images?.length > 0 && (
                          <img
                            src={item.images[0]}
                            alt="preview"
                            className="w-full h-40 object-cover rounded mb-2"
                          />
                        )}
                        <div className="font-bold">{item.title}</div>
                        <div>{item.description}</div>
                        <div className="text-sm text-gray-600">{item.category}</div>
                        <div className="text-sm">{t("marketplace.price")}: {item.price} сум</div>
                        <div className="text-sm">{t("marketplace.location")}: {item.location}</div>
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
