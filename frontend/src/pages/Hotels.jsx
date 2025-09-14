// frontend/src/pages/Hotels.jsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import HotelCard from "../components/HotelCard";
import { searchHotels } from "../api/hotels";

export default function Hotels() {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [loading, setLoading] = useState(false);
  const [hotels, setHotels] = useState([]);
  const [total, setTotal] = useState(0);

  const runSearch = async (q = name, c = city) => {
    setLoading(true);
    try {
      const res = await searchHotels({ name: q.trim(), city: c.trim() });
      setHotels(res.items || []);
      setTotal(res.total || 0);
    } catch {
      setHotels([]); setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { runSearch("", ""); }, []);

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">{t("hotels.title", { defaultValue: "Отели" })}</h1>

      <div className="bg-white rounded-xl p-4 shadow-sm border mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            className="border rounded px-3 py-2"
            placeholder={t("hotels.search_name", { defaultValue: "Название" })}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="border rounded px-3 py-2"
            placeholder={t("hotels.search_city", { defaultValue: "Город" })}
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
          <button
            onClick={() => runSearch()}
            className="bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded px-4"
          >
            {loading ? t("common.loading", { defaultValue: "Загрузка…" }) : t("common.search", { defaultValue: "Найти" })}
          </button>
        </div>
        <div className="text-xs text-gray-500 mt-2">{t("common.found", { defaultValue: "Найдено" })}: {total}</div>
      </div>

      <div className="space-y-3">
        {hotels.map((h) => <HotelCard key={h.id} hotel={h} />)}
        {!loading && hotels.length === 0 && (
          <div className="text-gray-500 text-sm">{t("hotels.empty", { defaultValue: "Ничего не найдено" })}</div>
        )}
      </div>
    </div>
  );
}
