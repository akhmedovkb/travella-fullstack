// frontend/src/pages/admin/AdminHotelsTable.jsx

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../../api";
import { Link } from "react-router-dom";

function normalizeHotel(h) {
  return {
    id:         h.id ?? h.hotel_id ?? h._id ?? null,
    name:       h.name ?? h.title ?? "",
    city:       h.city ?? h.location ?? h.town ?? "",
  };
}

export default function AdminHotelsTable() {
  const [items, setItems]   = useState([]);
  const [qName, setQName]   = useState("");
  const [qCity, setQCity]   = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const reqIdRef = useRef(0); // защита от «гонок» ответов

  const url = useMemo(() => {
    const p = new URLSearchParams({
      name: qName || "",
      city: qCity || "",
      limit: "200",
    });
    return `/api/hotels/search?${p.toString()}`;
  }, [qName, qCity]);

  const load = useCallback(async () => {
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError("");
    try {
      const res  = await apiGet(url);
      const data = Array.isArray(res) ? res : (Array.isArray(res?.items) ? res.items : []);
      const rows = data.map(normalizeHotel);
      if (reqIdRef.current === myReq) setItems(rows);
    } catch (e) {
      if (reqIdRef.current === myReq) {
        setItems([]);
        setError("Не удалось загрузить список отелей");
      }
    } finally {
      if (reqIdRef.current === myReq) setLoading(false);
    }
  }, [url]);

  useEffect(() => { load(); }, []); // первичная загрузка

  const onSubmit = async (e) => {
    e.preventDefault();
    load();
  };

  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto bg-white rounded-xl shadow border p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Отели (админ)</h1>
          <Link
            to="/admin/hotels/new"
            className="px-3 py-2 rounded bg-orange-600 text-white hover:bg-orange-700"
          >
            + Новый отель
          </Link>
        </div>

        {/* Поиск */}
        <form onSubmit={onSubmit} className="flex gap-3 mb-4">
          <input
            className="flex-1 border rounded px-3 py-2"
            placeholder="Поиск по названию"
            value={qName}
            onChange={(e) => setQName(e.target.value)}
          />
          <input
            className="w-64 border rounded px-3 py-2"
            placeholder="Поиск по городу"
            value={qCity}
            onChange={(e) => setQCity(e.target.value)}
          />
          <button
            type="submit"
            disabled={loading}
            className={`px-4 py-2 rounded bg-gray-800 text-white ${loading ? "opacity-60 cursor-not-allowed" : "hover:bg-gray-900"}`}
          >
            {loading ? "Поиск…" : "Найти"}
          </button>
        </form>

        {error && (
          <div className="mb-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
            {error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full table-auto border-collapse">
            <thead>
              <tr className="text-left text-gray-600">
                <th className="px-4 py-3 font-semibold w-[90px]">ID</th>
                <th className="px-4 py-3 font-semibold">Название</th>
                <th className="px-4 py-3 font-semibold w-1/3">Город</th>
                <th className="px-4 py-3 font-semibold w-[160px]">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-500">Загрузка…</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-500">Ничего не найдено</td>
                </tr>
              ) : (
                items.map((h) => (
                  <tr key={h.id ?? `${h.name}-${h.city}`} className="hover:bg-gray-50">
                    <td className="px-4 py-3">{h.id ?? "—"}</td>
                    <td className="px-4 py-3">{h.name}</td>
                    <td className="px-4 py-3">{h.city || "—"}</td>
                    <td className="px-4 py-3">
                      {h.id ? (
                        <Link
                          to={`/admin/hotels/${h.id}/edit`}
                          className="inline-flex items-center px-3 py-1.5 rounded border hover:bg-gray-50"
                        >
                          Править
                        </Link>
                        <Link
                          to={`/admin/hotels/${row.id}/seasons`}
                          className="px-2 py-1 border rounded text-sm hover:bg-gray-50"
                        >
                          Сезоны
                        </Link>
                      ) : (
                        <span className="text-gray-400">локальная подсказка</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
