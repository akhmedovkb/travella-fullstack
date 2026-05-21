// frontend/src/pages/admin/AdminHotelsTable.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../../api";

// компонент поддерживает внешний onNew/onEdit и режим "provider"

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
    return {
      roles,
      role: String(claims.role || "").toLowerCase(),
      type: String(claims.type || "").toLowerCase(),
      claims,
    };
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
  const qs = new URLSearchParams({ q, city, page, limit }).toString();
  return apiGet(`/api/hotels/mine?${qs}`, "provider");
}

async function apiSearchHotels({ name = "", city = "", limit = 200 } = {}) {
  const qs = new URLSearchParams({ name, city, limit }).toString();
  return apiGet(`/api/hotels/search?${qs}`, true);
}

/* ====== normalize ====== */
const normalizeText = (v) => String(v ?? "").trim();

const normalizeHotel = (h) => ({
  id: h.id ?? h.hotel_id ?? null,
  name: normalizeText(h.name || h.label),
  city: normalizeText(h.city || h.city_local || h.city_en || h.location),
  country: normalizeText(h.country || h.country_name),
  stars: h.stars ?? h.star_rating ?? "",
  providerId: h.provider_id ?? h.providerId ?? "",
  currency: normalizeText(h.currency),
  raw: h,
});

function hotelCompleteness(h) {
  const checks = [
    Boolean(h.name),
    Boolean(h.city),
    Boolean(h.country),
    Boolean(h.stars),
    Boolean(h.providerId || h.providerId === 0),
    Boolean(h.currency),
  ];
  const done = checks.filter(Boolean).length;
  const percent = Math.round((done / checks.length) * 100);
  if (percent >= 84) return { label: "Заполнен", tone: "emerald", percent };
  if (percent >= 50) return { label: "Проверить", tone: "amber", percent };
  return { label: "Черновик", tone: "rose", percent };
}

function Badge({ children, tone = "slate" }) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    rose: "bg-rose-50 text-rose-700 ring-rose-100",
    orange: "bg-orange-50 text-orange-700 ring-orange-100",
    slate: "bg-slate-50 text-slate-600 ring-slate-200",
    sky: "bg-sky-50 text-sky-700 ring-sky-100",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${tones[tone] || tones.slate}`}>
      {children}
    </span>
  );
}

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-black tracking-tight text-slate-950">{value}</div>
      {hint ? <div className="mt-1 text-xs font-medium text-slate-500">{hint}</div> : null}
    </div>
  );
}

export default function AdminHotelsTable({
  scope = "admin", // "admin" | "provider"
  providerId, // оставлено для совместимости
  onEdit, // (row) => void
  onNew, // () => void
} = {}) {
  void providerId;

  const who = useMemo(() => parseJwtRoles(), []);
  const admin = isAdminLike(who);
  const provider = isProviderRole(who);
  const providerMode = scope === "provider" ? true : provider && !admin;

  const [qName, setQName] = useState("");
  const [qCity, setQCity] = useState("");
  const [quickFilter, setQuickFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState("asc");

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const reqIdRef = useRef(0);

  const load = useCallback(async () => {
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError("");
    try {
      const data = providerMode
        ? await apiGetMyHotels({ q: qName.trim(), city: qCity.trim(), limit: 200 })
        : await apiSearchHotels({ name: qName.trim(), city: qCity.trim(), limit: 200 });

      const rows =
        (providerMode ? data?.items : Array.isArray(data) ? data : data?.items) || [];
      if (reqIdRef.current === myReq) setItems(rows.map(normalizeHotel));
    } catch (e) {
      if (reqIdRef.current === myReq) setError("Не удалось загрузить список отелей");
    } finally {
      if (reqIdRef.current === myReq) setLoading(false);
    }
  }, [providerMode, qName, qCity]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const h = () => load();
    window.addEventListener("provider-hotels:reload", h);
    return () => window.removeEventListener("provider-hotels:reload", h);
  }, [load]);

  const stats = useMemo(() => {
    const cities = new Set(items.map((h) => h.city).filter(Boolean));
    const withoutCity = items.filter((h) => !h.city).length;
    const withoutOwner = items.filter((h) => !(h.providerId || h.providerId === 0)).length;
    const needsCheck = items.filter((h) => hotelCompleteness(h).percent < 84).length;
    return { total: items.length, cities: cities.size, withoutCity, withoutOwner, needsCheck };
  }, [items]);

  const visibleItems = useMemo(() => {
    let rows = [...items];

    if (quickFilter === "needs_check") rows = rows.filter((h) => hotelCompleteness(h).percent < 84);
    if (quickFilter === "without_city") rows = rows.filter((h) => !h.city);
    if (quickFilter === "without_owner") rows = rows.filter((h) => !(h.providerId || h.providerId === 0));

    const dir = sortDir === "desc" ? -1 : 1;
    rows.sort((a, b) => {
      const av = sortBy === "id" ? Number(a.id || 0) : normalizeText(a[sortBy]).toLowerCase();
      const bv = sortBy === "id" ? Number(b.id || 0) : normalizeText(b[sortBy]).toLowerCase();
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });

    return rows;
  }, [items, quickFilter, sortBy, sortDir]);

  const onSubmit = (e) => {
    e.preventDefault();
    load();
  };

  const changeSort = (key) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(key);
    setSortDir(key === "id" ? "desc" : "asc");
  };

  const SortButton = ({ id, children }) => (
    <button
      type="button"
      onClick={() => changeSort(id)}
      className="inline-flex items-center gap-1 font-black text-slate-600 transition hover:text-slate-950"
    >
      {children}
      <span className="text-[10px] text-slate-400">
        {sortBy === id ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="inline-flex rounded-full bg-orange-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-orange-600 ring-1 ring-orange-100">
                Travella Hotels
              </div>
              <h1 className="mt-3 text-2xl font-black tracking-[-0.03em] text-slate-950">
                {providerMode ? "Мои отели" : "Отели (админ)"}
              </h1>
              <p className="mt-1 max-w-2xl text-sm font-medium leading-6 text-slate-600">
                Быстрый контроль базы отелей: карточки, города, владельцы и сезонные цены.
              </p>
            </div>

            {onNew ? (
              <button
                type="button"
                onClick={onNew}
                className="inline-flex items-center justify-center rounded-2xl bg-orange-600 px-4 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-orange-700"
              >
                + Новый отель
              </button>
            ) : (
              <Link
                to="/admin/hotels/new"
                className="inline-flex items-center justify-center rounded-2xl bg-orange-600 px-4 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-orange-700"
              >
                + Новый отель
              </Link>
            )}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Всего" value={stats.total} hint="загружено в список" />
          <StatCard label="Города" value={stats.cities} hint="уникальные города" />
          <StatCard label="Проверить" value={stats.needsCheck} hint="неполные карточки" />
          <StatCard label="Без города" value={stats.withoutCity} hint="нужно дополнить" />
          <StatCard label="Без владельца" value={stats.withoutOwner} hint="provider_id пустой" />
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <form onSubmit={onSubmit} className="grid gap-3 lg:grid-cols-[1fr_260px_auto]">
            <div>
              <label className="mb-1 block text-xs font-black uppercase tracking-[0.12em] text-slate-400">
                Название
              </label>
              <input
                className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium outline-none transition placeholder:text-slate-400 focus:border-orange-300 focus:ring-4 focus:ring-orange-50"
                placeholder="Например, Afrasiyob Regency"
                value={qName}
                onChange={(e) => setQName(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-black uppercase tracking-[0.12em] text-slate-400">
                Город
              </label>
              <input
                className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium outline-none transition placeholder:text-slate-400 focus:border-orange-300 focus:ring-4 focus:ring-orange-50"
                placeholder="Tashkent, Bukhara..."
                value={qCity}
                onChange={(e) => setQCity(e.target.value)}
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                type="submit"
                disabled={loading}
                className={`h-11 rounded-2xl bg-slate-950 px-5 text-sm font-black text-white transition ${
                  loading ? "cursor-not-allowed opacity-60" : "hover:bg-slate-800"
                }`}
              >
                {loading ? "Ищу…" : "Найти"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setQName("");
                  setQCity("");
                  setQuickFilter("all");
                }}
                className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
              >
                Сброс
              </button>
            </div>
          </form>

          <div className="mt-4 flex flex-wrap gap-2">
            {[
              ["all", "Все"],
              ["needs_check", "Проверить"],
              ["without_city", "Без города"],
              ["without_owner", "Без владельца"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setQuickFilter(id)}
                className={`rounded-full px-3 py-1.5 text-xs font-black ring-1 transition ${
                  quickFilter === id
                    ? "bg-orange-600 text-white ring-orange-600"
                    : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {error && (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
              {error}
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div className="text-sm font-black text-slate-900">
              Найдено: {visibleItems.length}
            </div>
            <div className="text-xs font-medium text-slate-500">
              Сортировка: {sortBy} / {sortDir === "asc" ? "A→Z" : "Z→A"}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] table-auto border-collapse">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs uppercase tracking-[0.08em] text-slate-500">
                  <th className="w-[90px] px-4 py-3"><SortButton id="id">ID</SortButton></th>
                  <th className="px-4 py-3"><SortButton id="name">Отель</SortButton></th>
                  <th className="w-[220px] px-4 py-3"><SortButton id="city">Локация</SortButton></th>
                  <th className="w-[110px] px-4 py-3">Звёзды</th>
                  <th className="w-[140px] px-4 py-3">Владелец</th>
                  <th className="w-[150px] px-4 py-3">Статус</th>
                  <th className="w-[260px] px-4 py-3 text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                      Загрузка…
                    </td>
                  </tr>
                ) : visibleItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                      Ничего не найдено
                    </td>
                  </tr>
                ) : (
                  visibleItems.map((h) => {
                    const completeness = hotelCompleteness(h);
                    return (
                      <tr key={h.id ?? `${h.name}-${h.city}`} className="transition hover:bg-orange-50/25">
                        <td className="px-4 py-3 text-sm font-black text-slate-500">{h.id ?? "—"}</td>
                        <td className="px-4 py-3">
                          <div className="font-black text-slate-950">{h.name || "Без названия"}</div>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {h.currency ? <Badge tone="sky">{h.currency}</Badge> : <Badge>валюта не указана</Badge>}
                            {h.country ? <Badge>{h.country}</Badge> : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm font-bold text-slate-700">
                          {h.city || <span className="text-rose-500">город не указан</span>}
                        </td>
                        <td className="px-4 py-3 text-sm font-bold text-slate-700">
                          {h.stars ? `${h.stars}★` : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-sm font-bold text-slate-700">
                          {h.providerId || h.providerId === 0 ? h.providerId : <span className="text-amber-600">нет</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1.5">
                            <Badge tone={completeness.tone}>{completeness.label}</Badge>
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full rounded-full bg-slate-900"
                                style={{ width: `${completeness.percent}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {h.id ? (
                            <div className="flex items-center justify-end gap-2">
                              {onEdit ? (
                                <button
                                  type="button"
                                  onClick={() => onEdit(h)}
                                  className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50"
                                >
                                  Карточка
                                </button>
                              ) : (
                                <Link
                                  to={`/admin/hotels/${h.id}/edit`}
                                  className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50"
                                >
                                  Карточка
                                </Link>
                              )}
                              <Link
                                to={`/admin/hotels/${h.id}/seasons`}
                                className="inline-flex items-center rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white transition hover:bg-slate-800"
                              >
                                Сезоны
                              </Link>
                            </div>
                          ) : (
                            <span className="text-sm font-medium text-slate-400">локальная подсказка</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
