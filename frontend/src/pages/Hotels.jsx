import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { searchHotels } from "../api/hotels";
import { listRanked } from "../api/hotels";

export default function Hotels() {
  const [items, setItems] = useState([]);
  const [qName, setQName] = useState("");
  const [qCity, setQCity] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("top"); // "top" | "popular" | "new"

  const load = async () => {
    setLoading(true);
    try {
      let res;
      const isSearch = (qName || qCity).trim().length > 0;
      if (isSearch) {
        res = await searchHotels({ name: qName || "", city: qCity || "", limit: 200 });
      } else {
        res = await listRanked({ type: tab, limit: 50 });
      }
      setItems(Array.isArray(res) ? res : res?.items || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);                // первый рендер
  useEffect(() => { if (!(qName || qCity)) load(); }, [tab]); // переключение вкладок без поиска

  const onSearch = (e) => { e.preventDefault(); load(); };
  const clearIfEmpty = () => { if (!qName && !qCity) load(); };

  const labelCol = tab === "new" ? "Добавлен" : "Оценка";
  const fmtDate = (s) => s ? new Date(s).toLocaleDateString() : "—";

  return (
    <div className="max-w-5xl mx-auto bg-white rounded-xl border shadow-sm p-5">
      <div className="flex items-center justify-between gap-4 mb-4">
        <h1 className="text-2xl font-bold">Отели</h1>

        <div className="flex items-center gap-1 rounded-full bg-gray-100 px-1 py-1">
          <button
            className={[
              "px-3 py-1 rounded-full text-sm",
              tab === "top" ? "bg-white shadow font-semibold text-orange-600" : "text-gray-700 hover:text-gray-900"
            ].join(" ")}
            onClick={() => setTab("top")}
            type="button"
          >
            Топ
          </button>
          <button
            className={[
              "px-3 py-1 rounded-full text-sm",
              tab === "popular" ? "bg-white shadow font-semibold text-orange-600" : "text-gray-700 hover:text-gray-900"
            ].join(" ")}
            onClick={() => setTab("popular")}
            type="button"
          >
            Популярные
          </button>
          <button
            className={[
              "px-3 py-1 rounded-full text-sm",
              tab === "new" ? "bg-white shadow font-semibold text-orange-600" : "text-gray-700 hover:text-gray-900"
            ].join(" ")}
            onClick={() => setTab("new")}
            type="button"
          >
            Новые
          </button>
        </div>
      </div>

      <form onSubmit={onSearch} className="flex gap-2 mb-3">
        <input
          className="border rounded px-3 py-2 flex-1"
          placeholder="Поиск по названию"
          value={qName}
          onChange={(e) => setQName(e.target.value)}
          onBlur={clearIfEmpty}
        />
        <input
          className="border rounded px-3 py-2 w-[260px]"
          placeholder="Город"
          value={qCity}
          onChange={(e) => setQCity(e.target.value)}
          onBlur={clearIfEmpty}
        />
        <button className="px-3 py-2 rounded border">Найти</button>
      </form>

      <div className="overflow-auto border rounded">
        <table className="min-w-[800px] text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2 w-[80px]">ID</th>
              <th className="text-left px-3 py-2">Название</th>
              <th className="text-left px-3 py-2 w-[220px]">Город</th>
              <th className="text-left px-3 py-2 w-[140px]">{labelCol}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={4} className="px-3 py-3">Загрузка…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-3">Ничего не найдено</td></tr>
            )}
            {!loading && items.map((h) => (
              <tr key={h.id || `${h.name}-${h.city}`} className="border-t">
                <td className="px-3 py-2">{h.id ?? "—"}</td>
                <td className="px-3 py-2">
                  {h.id
                    ? <Link className="text-orange-600 hover:underline" to={`/hotels/${h.id}`}>{h.name}</Link>
                    : h.name}
                </td>
                <td className="px-3 py-2">{h.city || "—"}</td>
                <td className="px-3 py-2">
                  {tab === "new"
                    ? fmtDate(h.created_at)
                    : (h.score != null ? Number(h.score).toFixed(1) : "—")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(qName || qCity) && (
        <p className="text-xs text-gray-500 mt-2">
          Чтобы снова увидеть рубрику «{tab === "top" ? "Топ" : tab === "popular" ? "Популярные" : "Новые"}», очистите поиск.
        </p>
      )}
    </div>
  );
}
