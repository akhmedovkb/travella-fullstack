// frontend/src/pages/admin/AdminHotelsTable.jsx
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiGet } from "../../api";

/* ===== helpers: JWT roles / admin check ===== */
function parseJwtRoles() {
  try {
    const tok =
      localStorage.getItem("token") ||
      localStorage.getItem("providerToken") ||
      "";
    if (!tok.includes(".")) return { roles: [], role: "", type: "" };
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
    return { roles: [], role: "", type: "" };
  }
}
const isAdminLike = ({ roles, role, type, claims }) => {
  const pool = new Set([role, type, ...roles]);
  if (claims?.is_admin === true || String(claims?.is_admin) === "true") return true;
  return pool.has("admin") || pool.has("moderator");
};
const isProviderRole = ({ roles, role, type }) => {
  const pool = new Set([role, type, ...roles]);
  return pool.has("provider");
};

function normalizeHotel(h) {
  return {
    id:   h.id ?? h.hotel_id ?? h._id ?? null,
    name: h.name ?? h.title ?? "",
    city: h.city ?? h.location ?? h.town ?? "",
  };
}

export default function AdminHotelsTable() {
  const nav = useNavigate();

  // RBAC
  const who = useMemo(() => parseJwtRoles(), []);
  const admin = isAdminLike(who);
  const provider = isProviderRole(who);

  // провайдерский режим
  const [meLoading, setMeLoading] = useState(false);
  const [meError, setMeError] = useState("");
  const [myHotelId, setMyHotelId] = useState(null);

  // список (для админа/модера)
  const [items, setItems] = useState([]);
  const [qName, setQName] = useState("");
  const [qCity, setQCity] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const reqIdRef = useRef(0);

  const url = useMemo(() => {
    const p = new URLSearchParams({
      name: qName || "",
      city: qCity || "",
      limit: "200",
    });
    return `/api/hotels/search?${p.toString()}`;
  }, [qName, qCity]);

  const load = useCallback(async () => {
    if (!admin) return; // провайдеру список не загружаем
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError("");
    try {
      const res = await apiGet(url);
      const data = Array.isArray(res) ? res : (Array.isArray(res?.items) ? res.items : []);
      const rows = data.map(normalizeHotel);
      if (reqIdRef.current === myReq) setItems(rows);
    } catch (_e) {
      if (reqIdRef.current === myReq) {
        setItems([]);
        setError("Не удалось загрузить список отелей");
      }
    } finally {
      if (reqIdRef.current === myReq) setLoading(false);
    }
  }, [url, admin]);

  // первичная загрузка: админ — список, провайдер — свой hotel_id
  useEffect(() => {
    if (admin) {
      load();
      return;
    }
    if (provider) {
      (async () => {
        try {
          setMeLoading(true);
          setMeError("");
          const me = await apiGet("/api/providers/profile"); // { id, hotel_id }
          setMyHotelId(me?.hotel_id ?? null);
        } catch (e) {
          setMeError("Не удалось получить данные провайдера");
        } finally {
          setMeLoading(false);
        }
      })();
    }
  }, [admin, provider, load]);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (admin) load();
  };

  /* ===================== RENDER ===================== */
  // --- провайдер видит только свой отель (или создание) ---
  if (provider && !admin) {
    return (
      <div className="p-6">
        <div className="max-w-3xl mx-auto bg-white rounded-xl shadow border p-4 md:p-6">
          <h1 className="text-2xl font-bold mb-4">Мой отель</h1>
          {meLoading ? (
            <div className="text-gray-500">Загрузка…</div>
          ) : meError ? (
            <div className="mb-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
              {meError}
            </div>
          ) : myHotelId ? (
            <div className="flex items-center gap-3">
              <Link
                to={`/admin/hotels/${myHotelId}/edit`}
                className="px-4 py-2 rounded bg-gray-800 text-white hover:bg-gray-900"
              >
                Править мой отель
              </Link>
              <Link
                to={`/admin/hotels/${myHotelId}/seasons`}
                className="px-4 py-2 rounded border hover:bg-gray-50"
              >
                Сезоны
              </Link>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Link
                to="/admin/hotels/new"
                className="px-4 py-2 rounded bg-orange-600 text-white hover:bg-orange-700"
              >
                + Создать отель
              </Link>
              <span className="text-gray-500 text-sm">
                Отель ещё не создан
              </span>
            </div>
          )}
          <div className="mt-6">
            <button
              onClick={() => nav(-1)}
              className="text-sm text-gray-600 hover:underline"
            >
              ← Назад
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- админ/модер: полный список + создание ---
  return (
    <div className="p-6">
      <div className="max-w-6xl mx-auto bg-white rounded-xl shadow border p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Отели (админ)</h1>
          {/* кнопку «Новый отель» показываем только админу/модеру */}
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
            <thead>
              <tr className="text-left text-gray-600">
                <th className="px-4 py-3 font-semibold w-[90px]">ID</th>
                <th className="px-4 py-3 font-semibold">Название</th>
                <th className="px-4 py-3 font-semibold w-1/3">Город</th>
                <th className="px-4 py-3 font-semibold w-[220px]">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                    Загрузка…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                    Ничего не найдено
                  </td>
                </tr>
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
