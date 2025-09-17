// frontend/src/pages/Hotels.jsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { NavLink } from "react-router-dom";
import axios from "axios";
import { useTranslation } from "react-i18next";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

function normalizeHotel(h) {
  return {
    id:          h.id ?? h.hotel_id ?? h._id ?? Math.random().toString(36).slice(2),
    name:        h.name ?? h.title ?? "",
    city:        h.city ?? h.location ?? h.town ?? "",
    rating:      h.rating ?? h.avg_rating ?? h.average_rating ?? h.stars ?? h.score ?? null,
    views:       h.views ?? h.view_count ?? h.popularity ?? h.seen ?? h.hits ?? 0,
    created_at:  h.created_at ?? h.createdAt ?? null,
  };
}

export default function HotelsPage() {
  const { t } = useTranslation();
  const abortRef = useRef(null);

  // ВАЖНО: по умолчанию ничего не грузим, поэтому tab = null
  const [tab, setTab] = useState(null); // 'top' | 'popular' | 'new' | 'worst' | 'search' | null
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showResults, setShowResults] = useState(false); // управляет первичным показом таблицы

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

  const toNum = (v) => (v == null ? null : Number(v));
  const sortByRatingDesc  = (arr) => [...arr].sort((a, b) => (toNum(b.rating) ?? -1) - (toNum(a.rating) ?? -1));
  const sortByRatingAsc   = (arr) => [...arr].sort((a, b) => (toNum(a.rating) ??  1) - (toNum(b.rating) ??  1)); // для "Худшие"
  const sortByViewsDesc   = (arr) => [...arr].sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
  const sortByNewestFirst = (arr) => [...arr].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  // -------- loaders (исправленные эндпоинты + фоллбэки) --------
  const loadRanked = useCallback(async (type) => {
    try {
      // основной корректный эндпоинт
      const rows = await get(`${API_BASE}/api/hotels/ranked`, { type, limit });
      let norm = rows.map(normalizeHotel);

      // если бэк не поддерживает "worst" сортировку — подстрахуемся
      if (type === "worst") norm = sortByRatingAsc(norm);
      return norm;
    } catch {
      // фоллбэк: _list + сортировка на клиенте
      try {
        const rows = await get(`${API_BASE}/api/hotels/_list`, { limit: 50 });
        const norm = rows.map(normalizeHotel);
        if (type === "top")     return sortByRatingDesc(norm).slice(0, limit);
        if (type === "popular") return sortByViewsDesc(norm).slice(0, limit);
        if (type === "worst")   return sortByRatingAsc(norm).slice(0, limit);
        return sortByNewestFirst(norm).slice(0, limit); // new
      } catch {
        return [];
      }
    }
  }, [get]);

  const loadTop      = useCallback(() => loadRanked("top"),     [loadRanked]);
  const loadPopular  = useCallback(() => loadRanked("popular"), [loadRanked]);
  const loadNew      = useCallback(() => loadRanked("new"),     [loadRanked]);
  const loadWorst    = useCallback(() => loadRanked("worst"),   [loadRanked]);

  const loadSearch = useCallback(async () => {
    const params = { name: name || undefined, city: city || undefined, limit: 50, ext: 0 };
    try {
      const rows = await get(`${API_BASE}/api/hotels/search`, params);
      return rows.map(normalizeHotel);
    } catch {
      return [];
    }
  }, [get, name, city]);

  // -------- единая точка запуска --------
  const run = useCallback(async (kind) => {
    setLoading(true);
    setError("");
    try {
      let rows = [];
      if (kind === "top")        rows = await loadTop();
      else if (kind === "popular") rows = await loadPopular();
      else if (kind === "new")   rows = await loadNew();
      else if (kind === "worst") rows = await loadWorst();
      else                       rows = await loadSearch(); // 'search'
      setItems(rows);
    } catch (e) {
      if (e?.name !== "CanceledError" && e?.code !== "ERR_CANCELED") {
        setError(t("common.load_failed", { defaultValue: "Не удалось загрузить данные" }));
        setItems([]);
      }
    } finally {
      setLoading(false);
    }
  }, [loadTop, loadPopular, loadNew, loadWorst, loadSearch, t]);

  // НЕ автоподгружаем при монтировании.
  // Загружаем только если пользователь нажал на таб (не 'search').
  useEffect(() => {
    if (!tab || tab === "search") return;
    setShowResults(true);
    void run(tab);
  }, [tab, run]);

  // -------- ui helpers --------
  const TabBtn = ({ value, children }) => (
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
    setTab("search");      // поиск — отдельный режим
    setShowResults(true);
    await run("search");
  };

  const rows = useMemo(() => items, [items]);

  // -------- render --------
  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto bg-white rounded-xl shadow border p-4 md:p-6">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-2xl font-bold">
            {t("hotels.title", { defaultValue: "Отели" })}
          </h1>
          <div className="flex gap-2">
            <TabBtn value="top">{t("hotels.tabs.top", { defaultValue: "Топ" })}</TabBtn>
            <TabBtn value="popular">{t("hotels.tabs.popular", { defaultValue: "Популярные" })}</TabBtn>
            <TabBtn value="new">{t("hotels.tabs.new", { defaultValue: "Новые" })}</TabBtn>
            <TabBtn value="worst">{t("hotels.tabs.worst", { defaultValue: "Худшие" })}</TabBtn>
          </div>
        </div>

        {/* Поисковая форма */}
        <form onSubmit={onFind} className="flex gap-3 mb-4">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("hotels.search_by_name", { defaultValue: "Поиск по названию" })}
            className="flex-1 border rounded px-3 py-2"
          />
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder={t("hotels.city_placeholder", { defaultValue: "Город" })}
            className="w-64 border rounded px-3 py-2"
          />
          <button
            type="submit"
            disabled={loading}
            className={`px-4 py-2 rounded bg-gray-800 text-white ${loading ? "opacity-60 cursor-not-allowed" : "hover:bg-gray-900"}`}
          >
            {loading ? t("hotels.searching", { defaultValue: "Поиск..." }) : t("hotels.find_btn", { defaultValue: "Найти" })}
          </button>
        </form>

        {error && (
          <div className="mb-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
            {error}
          </div>
        )}

        {/* Таблица показывается только после действия пользователя */}
        {showResults ? (
          <div className="overflow-x-auto">
            <table className="w-full table-auto border-collapse">
              <thead>
                <tr className="text-left text-gray-600">
                  <th className="px-4 py-3 font-semibold w-1/2">{t("hotels.col.name", { defaultValue: "Название" })}</th>
                  <th className="px-4 py-3 font-semibold w-1/4">{t("hotels.col.city", { defaultValue: "Город" })}</th>
                  <th className="px-4 py-3 font-semibold w-1/4">{t("hotels.col.rating", { defaultValue: "Оценка" })}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-gray-500">
                      {t("common.loading", { defaultValue: "Загрузка…" })}
                    </td>
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
                      {t("hotels.empty", { defaultValue: "Ничего не найдено" })}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-gray-500 text-sm py-8">
            {t("hotels.empty_hint", {
              defaultValue: "Выберите вкладку или выполните поиск, чтобы увидеть список отелей.",
            })}
          </div>
        )}
      </div>
    </div>
  );
}
