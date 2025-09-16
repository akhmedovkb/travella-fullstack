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
        <table className="w-full table-auto border-collapse">
            <thead>
              <tr className="text-left text-gray-600">
                <th className="px-4 py-3 font-semibold w-1/2">Название</th>
                <th className="px-4 py-3 font-semibold w-1/4">Город</th>
                <th className="px-4 py-3 font-semibold w-1/4">Оценка</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.length ? (
                items.map((h) => (
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
                  <td className="px-4 py-6 text-center text-gray-500" colSpan={3}>
                    Ничего не найдено
                  </td>
                </tr>
              )}
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
