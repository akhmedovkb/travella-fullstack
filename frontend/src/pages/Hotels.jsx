// frontend/src/pages/Hotels.jsx
import { useEffect, useState } from "react";
import { searchHotels } from "../api/hotels"; // <-- используем централизованный API-клиент
import { Link } from "react-router-dom";

export default function Hotels() {
  const [items, setItems] = useState([]);
  const [qName, setQName] = useState("");
  const [qCity, setQCity] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await searchHotels({
        name: qName || "",
        city: qCity || "",
        limit: 200,
      });
      setItems(Array.isArray(res) ? res : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // первичная загрузка

  return (
    <div className="max-w-5xl mx-auto bg-white rounded-xl border shadow-sm p-5">
      <h1 className="text-2xl font-bold mb-4">Отели</h1>

      <div className="flex gap-2 mb-3">
        <input
          className="border rounded px-3 py-2 flex-1"
          placeholder="Поиск по названию"
          value={qName}
          onChange={(e) => setQName(e.target.value)}
        />
        <input
          className="border rounded px-3 py-2 flex-1"
          placeholder="Город"
          value={qCity}
          onChange={(e) => setQCity(e.target.value)}
        />
        <button onClick={load} className="px-3 py-2 rounded border">
          Найти
        </button>
      </div>

      <div className="overflow-auto border rounded">
        <table className="min-w-[800px] text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2 w-[80px]">ID</th>
              <th className="text-left px-3 py-2">Название</th>
              <th className="text-left px-3 py-2 w-[220px]">Город</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={3} className="px-3 py-3">Загрузка…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={3} className="px-3 py-3">Ничего не найдено</td></tr>
            )}
            {!loading && items.map((h) => (
                <tr key={h.id || `${h.name}-${h.city}`} className="border-t">
                  <td className="px-3 py-2">{h.id ?? "—"}</td>
                  <td className="px-3 py-2">
                    {h.id ? (
                      <Link to={`/hotels/${h.id}`} className="text-orange-600 hover:underline">
                        {h.name}
                      </Link>
                    ) : (
                      h.name
                    )}
                  </td>
                  <td className="px-3 py-2">{h.city || "—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
