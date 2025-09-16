// frontend/src/pages/Hotels.jsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { NavLink } from "react-router-dom";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

function normalizeHotel(h) {
  // Унифицируем поля, чтобы таблица не ломалась при разных ответах бэка
  return {
    id:          h.id ?? h.hotel_id ?? h._id ?? Math.random().toString(36).slice(2),
    name:        h.name ?? h.title ?? "",
    city:        h.city ?? h.location ?? h.town ?? "",
    rating:      h.rating ?? h.avg_rating ?? h.average_rating ?? h.stars ?? null,
    views:       h.views ?? h.view_count ?? h.popularity ?? 0,
    created_at:  h.created_at ?? h.createdAt ?? null,
  };
}

export default function HotelsPage() {
  const abortRef = useRef(null);
  const [tab, setTab] = useState("top"); // top | popular | new | search
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ---------------- helpers ----------------
  const limit = 10;

    // один активный запрос; остальные отменяем
  const get = useCallback(async (url, params = {}) => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const r = await axios.get(url, { params, signal: ctrl.signal, timeout: 10000 });
    return Array.isArray(r.data?.items) ? r.data.items : (Array.isArray(r.data) ? r.data : []);
  }, []);
  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);

  // фолбэк-сортировки, если нет спец-эндпоинтов
  const toNum = (v) => (v==null ? null : Number(v));
  const sortByRatingDesc   = (arr) => [...arr].sort((a,b) => (toNum(b.rating) ?? -1) - (toNum(a.rating) ?? -1));
  const sortByViewsDesc    = (arr) => [...arr].sort((a,b) => (b.views  ??  0) - (a.views  ??  0));
  const sortByNewestFirst  = (arr) => [...arr].sort((a,b) => new Date(b.created_at||0) - new Date(a.created_at||0));

  // ---------------- loaders ----------------
  const loadTop = useCallback(async () => {
    // 1) пробуем официальный эндпоинт
    try {
      const rows = await get(`${API_BASE}/api/hotels/top`, { limit });
      return rows.map(normalizeHotel);
    } catch {
      // 2) фолбэк: list + сортировка по рейтингу на клиенте
      try {
        const rows = await get(`${API_BASE}/api/hotels/list`, { limit: 50 });
        return sortByRatingDesc(rows.map(normalizeHotel)).slice(0, limit);
      } catch { return []; }
    }
  }, [get]);

  const loadPopular = useCallback(async () => {
    try {
      const rows = await get(`${API_BASE}/api/hotels/popular`, { limit });
      return rows.map(normalizeHotel);
    } catch {
      try {
        const rows = await get(`${API_BASE}/api/hotels/list`, { limit: 50 });
        return sortByViewsDesc(rows.map(normalizeHotel)).slice(0, limit);
      } catch { return []; }
    }
  }, [get]);

  const loadNew = useCallback(async () => {
    try {
      const rows = await get(`${API_BASE}/api/hotels/new`, { limit });
      return rows.map(normalizeHotel);
    } catch {
      try {
        const rows = await get(`${API_BASE}/api/hotels/list`, { limit: 10 });
        // list на бэке уже идёт ORDER BY id DESC — но подстрахуемся
        return sortByNewestFirst(rows.map(normalizeHotel)).slice(0, limit);
      } catch { return []; }
    }
  }, [get]);

  const loadSearch = useCallback(async () => {
    const params = { name: name || undefined, city: city || undefined, limit: 50, ext: 0 };
    try {
      const rows = await get(`${API_BASE}/api/hotels/search`, params);
      return rows.map(normalizeHotel);
    } catch {
      return [];
    }
  }, [get, name, city]);

  // ---------------- actions ----------------
  const run = useCallback(async (kind) => {
    setLoading(true);
    setError("");
    try {
      let rows = [];
      if (kind === "top")       rows = await loadTop();
      else if (kind === "popular") rows = await loadPopular();
      else if (kind === "new")  rows = await loadNew();
      else                      rows = await loadSearch(); // 'search'
      setItems(rows);
        } catch (e) {
      if (e?.name !== "CanceledError" && e?.code !== "ERR_CANCELED") {
        setError("Не удалось загрузить данные");
        setItems([]);
      }
    } finally {
      setLoading(false);
    }
  }, [loadTop, loadPopular, loadNew, loadSearch]);

  // первичная загрузка (Топ)
  useEffect(() => { run(tab); /* eslint-disable react-hooks/exhaustive-deps */ }, [tab]);

  // ---------------- ui helpers ----------------
  cconst TabBtn = ({ value, children }) => (
  <button
    type="button"
    onClick={() => setTab(value)}
    disabled={loading}
    className={[
      "px-3 py-1.5 rounded-full text-sm font-semibold",
      loading ? "opacity-60 cursor-not-allowed" : "",
      tab === value ? "bg-orange-100 text-orange-700" : "text-gray-600 hover:bg-gray-100",
    ].join(" ")}
  >
    {children}
  </button>
);



  const onFind = async (e) => {
    e.preventDefault();
    setTab("search");      // <-- поиск всегда в своём режиме
    await run("search");   // запускаем загрузку по форме
  };

  const rows = useMemo(() => items, [items]);

  // ---------------- render ----------------
  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto bg-white rounded-xl shadow border p-4 md:p-6">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-2xl font-bold">Отели</h1>
          <div className="flex gap-2">
            <TabBtn value="top">Топ</TabBtn>
            <TabBtn value="popular">Популярные</TabBtn>
            <TabBtn value="new">Новые</TabBtn>
          </div>
        </div>

        {/* Поисковая форма — кнопка «Найти» всегда запускает поиск и не влияет на вкладки */}
        <form onSubmit={onFind} className="flex gap-3 mb-4">
          <input
            type="text"
            value={name}
            onChange={(e)=>setName(e.target.value)}
            placeholder="Поиск по названию"
            className="flex-1 border rounded px-3 py-2"
          />
          <input
            type="text"
            value={city}
            onChange={(e)=>setCity(e.target.value)}
            placeholder="Город"
            className="w-64 border rounded px-3 py-2"
          />
          <button
            type="submit"
             disabled={loading}
             className={`px-4 py-2 rounded bg-gray-800 text-white ${loading ? "opacity-60 cursor-not-allowed" : "hover:bg-gray-900"}`}
          >
            {loading ? "Поиск..." : "Найти"}
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
                <th className="px-4 py-3 font-semibold w-1/2">Название</th>
                <th className="px-4 py-3 font-semibold w-1/4">Город</th>
                <th className="px-4 py-3 font-semibold w-1/4">Оценка</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-gray-500">Загрузка…</td>
                </tr>
              ) : rows.length ? (
                rows.map((h) => (
                  <tr key={h.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <NavLink to={`/hotels/${h.id}`} className="text-blue-600 hover:underline">
                        {h.name}
                      </NavLink>
                    </td>
                    <td className="px-4 py-3">{h.city || "—"}</td>
                    <td className="px-4 py-3">{h.rating != null ? Number(h.rating).toFixed(1) : "—"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-gray-500">
                    Ничего не найдено
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
