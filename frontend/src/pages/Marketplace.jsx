// frontend/src/pages/Marketplace.jsx
import React, { useEffect, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";

const Marketplace = () => {
  const { t } = useTranslation();
  const [services, setServices] = useState([]);
  const [filter, setFilter] = useState({
    type: "all", // guide, transport, hotel, agent
    category: "",
    location: "",
  });

  useEffect(() => {
    axios.get(`${import.meta.env.VITE_API_BASE_URL}/api/marketplace`)
      .then((res) => setServices(res.data))
      .catch((err) => console.error("❌ Ошибка загрузки витрины:", err));
  }, []);

  const filtered = services.filter((s) => {
    const matchType = filter.type === "all" || s.provider_type === filter.type;
    const matchCategory = !filter.category || s.category === filter.category;
    const matchLocation = !filter.location || s.location.toLowerCase().includes(filter.location.toLowerCase());
    return matchType && matchCategory && matchLocation;
  });

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <h1 className="text-3xl font-bold mb-6">{t("marketplace.title")}</h1>

      {/* Фильтры */}
      <div className="flex flex-wrap gap-4 mb-6">
        <select
          value={filter.type}
          onChange={(e) => setFilter({ ...filter, type: e.target.value })}
          className="border px-3 py-2 rounded"
        >
          <option value="all">{t("marketplace.filters.all")}</option>
          <option value="guide">{t("marketplace.filters.guide")}</option>
          <option value="transport">{t("marketplace.filters.transport")}</option>
          <option value="agent">{t("marketplace.filters.agent")}</option>
          <option value="hotel">{t("marketplace.filters.hotel")}</option>
        </select>
        <input
          type="text"
          placeholder={t("marketplace.filters.category")}
          value={filter.category}
          onChange={(e) => setFilter({ ...filter, category: e.target.value })}
          className="border px-3 py-2 rounded"
        />
        <input
          type="text"
          placeholder={t("marketplace.filters.location")}
          value={filter.location}
          onChange={(e) => setFilter({ ...filter, location: e.target.value })}
          className="border px-3 py-2 rounded"
        />
      </div>

      {/* Список услуг */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.length > 0 ? filtered.map((s) => (
          <div key={s.id} className="bg-white rounded-xl shadow p-4">
            <img
              src={s.images?.[0] || "https://via.placeholder.com/400x200"}
              alt={s.title}
              className="w-full h-48 object-cover rounded mb-3"
            />
            <h2 className="text-xl font-semibold">{s.title}</h2>
            <p className="text-sm text-gray-600">{s.category}</p>
            <p className="text-sm text-gray-600">{s.location}</p>
            <p className="text-lg font-bold mt-2">{s.price} сум</p>

            {/* 👉 Предложить свою цену */}
            <button className="mt-4 w-full bg-blue-600 text-white rounded py-2 font-semibold">
              {t("marketplace.propose_price")}
            </button>
          </div>
        )) : (
          <p>{t("marketplace.no_results")}</p>
        )}
      </div>
    </div>
  );
};

export default Marketplace;
