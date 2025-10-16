// frontend/src/pages/admin/AdminHotelsTable.jsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../../api";

/* ===== helpers: JWT roles / admin check ===== */
function parseJwtRoles() {
  try {
    const tok =
      localStorage.getItem("token") ||
      localStorage.getItem("providerToken") ||
      "";
    if (!tok.includes(".")) return { roles: [], role: "", type: "", claims: {} };
    const base64 = tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    const claims = JSON.parse(json || "{}");
    const roles = []
      .concat(claims.role || claims.type || [])
      .concat(claims.roles || [])
      .flatMap((r) => String(r).split(","))
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    return { roles, role: String(claims.role || "").toLowerCase(), type: String(claims.type || "").toLowerCase(), claims };
  } catch {
    return { roles: [], role: "", type: "", claims: {} };
  }
}
const isAdminLike = ({ roles, role, type, claims }) =>
  claims?.is_admin === true ||
  String(claims?.is_admin) === "true" ||
  new Set([role, type, ...roles]).has("admin") ||
  new Set([role, type, ...roles]).has("moderator");
const isProviderRole = ({ roles, role, type }) =>
  new Set([role, type, ...roles]).has("provider");

/* ====== api helpers ====== */
async function apiGetMyHotels({ q = "", city = "", page = 1, limit = 200 } = {}) {
  return apiGet("/api/hotels/mine", { params: { q, city, page, limit } });
}
async function apiSearchHotels({ name = "", city = "", limit = 200 } = {}) {
  return apiGet("/api/hotels/search", { params: { name, city, limit } });
}

/* ====== normalize ====== */
const normalizeHotel = (h) => ({
  id:   h.id ?? h.hotel_id ?? null,
  name: h.name ?? "",
  city: h.city ?? h.location ?? "",
});

export default function AdminHotelsTable() {
  // RBAC
  const who = useMemo(() => parseJwtRoles(), []);
  const admin = isAdminLike(who);
  const provider = isProviderRole(who);
  const providerMode = provider && !admin;

  // фильтры
  const [qName, setQName] = useState("");
  const [qCity, setQCity] = useState("");

  // данные
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const reqIdRef = useRef(0);

  // загрузчик
  const load = useCallback(async () => {
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError("");
    try {
      const data = providerMode
        ? await apiGetMyHotels({ q: qName.trim(), city: qCity.trim(), limit: 200 })
        : await apiSearchHotels({ name: qName.trim(), city: qCity.trim(), limit: 200 });

      const rows = (providerMode ? data?.items : Array.isArray(data) ? data : data?.items) || [];
      if (reqIdRef.current === myReq) setItems(rows.map(normalizeHotel));
    } catch (e) {
      if (reqIdRef.current === myReq) setError("Не удалось загрузить список отелей");
    } finally {
      if (reqIdRef.current === myReq) setLoading(false);
    }
  }, [providerMode, qName, qCity]);

  useEffect(() => { load(); }, [load]);

  const onSubmit = (e) => {
    e.preventDefault();
    load();
  };

  return (
    <div className="p-6">
      <div className="max-w-6xl mx-auto bg-white rounded-xl shadow border p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">
            {providerMode ? "Мои отели" : "Отели (админ)"}
          </h1>
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
            className={`px-4 py-2 rounded bg-gray-800 text-white ${
              loading ? "opacity-60 cursor-not-allowed" : "hover:bg-gray-900"
            }`}
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
            <thead className="bg-gray-50">
              <tr className="text-left text-gray-600">
                <th className="px-4 py-3 font-semibold w-[90px]">ID</th>
                <th className="px-4 py-3 font-semibold">Название</th>
                <th className="px-4 py-3 font-semibold w-1/3">Город</th>
                <th className="px-4 py-3 font-semibold w-[220px]">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500">Загрузка…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500">Ничего не найдено</td></tr>
              ) : (
                items.map((h) => (
                  <tr key={h.id ?? `${h.name}-${h.city}`} className="hover:bg-gray-50">
                    <td className="px-4 py-3">{h.id ?? "—"}</td>
                    <td className="px-4 py-3">{h.name}</td>
                    <td className="px-4 py-3">{h.city || "—"}</td>
                    <td className="px-4 py-3">
                      {h.id ? (
                        <div className="flex items-center gap-2">
                          <Link
                            to={`/admin/hotels/${h.id}/edit`}
                            className="inline-flex items-center px-3 py-1.5 rounded border hover:bg-gray-50"
                          >
                            Править
                          </Link>
                          <Link
                            to={`/admin/hotels/${h.id}/seasons`}
                            className="inline-flex items-center px-3 py-1.5 rounded border hover:bg-gray-50"
                          >
                            Сезоны
                          </Link>
                        </div>
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
