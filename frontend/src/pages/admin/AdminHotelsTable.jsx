// frontend/src/pages/admin/AdminHotelsTable.jsx

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../../api";

export default function AdminHotelsTable() {
  const [items, setItems] = useState([]);
  const [qName, setQName] = useState("");
  const [qCity, setQCity] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      // Без ввода search вернёт локальные записи (см. контроллер searchHotels)
      const res = await apiGet(
        `/api/hotels/search?name=${encodeURIComponent(qName || "")}&city=${encodeURIComponent(
          qCity || ""
        )}&limit=200`
      );
      setItems(Array.isArray(res) ? res : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-5xl mx-auto bg-white rounded-xl border shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Отели</h1>
        <Link to="/admin/hotels/new" className="px-3 py-2 rounded bg-orange-600 text-white">
          + Новый отель
        </Link>
      </div>

      <div className="flex gap-2 mb-3">
        <input
          className="border rounded px-3 py-2 flex-1"
          placeholder="Поиск по названию"
          value={qName}
          onChange={(e) => setQName(e.target.value)}
        />
        <input
          className="border rounded px-3 py-2 flex-1"
          placeholder="Поиск по городу"
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
              <th className="text-left px-3 py-2 w-[140px]">Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="px-3 py-3">
                  Загрузка…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-3">
                  Ничего не найдено
                </td>
              </tr>
            )}
            {!loading &&
              items.map((h) => (
                <tr key={h.id || `${h.name}-${h.city}`} className="border-t">
                  <td className="px-3 py-2">{h.id ?? "—"}</td>
                  <td className="px-3 py-2">{h.name}</td>
                  <td className="px-3 py-2">{h.city || "—"}</td>
                  <td className="px-3 py-2">
                    {h.id ? (
                      <Link to={`/admin/hotels/${h.id}/edit`} className="px-2 py-1 rounded border hover:bg-gray-50">
                        Править
                      </Link>
                    ) : (
                      <span className="text-gray-400">локальная подсказка</span>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
