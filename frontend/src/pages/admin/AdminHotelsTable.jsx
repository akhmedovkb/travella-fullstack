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
async function apiHotelReadiness({ name = "", city = "", filter = "all", sort = "name", dir = "asc", limit = 50, page = 1, providerMode = false } = {}) {
  const qs = new URLSearchParams({ name, city, filter, sort, dir, limit, page }).toString();
  return apiGet(`/api/hotels/readiness?${qs}`, providerMode ? "provider" : "admin");
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
  myOfferId: h.my_offer_id ?? null,
  myOfferStatus: h.my_offer_status || "",
  myOfferDirect: h.my_offer_is_direct === true,
  pendingOwnershipClaimCount: Number(h.pending_ownership_claim_count || 0),
  pendingOwnershipClaimProviderId: h.pending_claim_provider_id ?? null,
  pendingOwnershipClaimProviderName: normalizeText(h.pending_claim_provider_name),
  currency: normalizeText(h.currency),
  inspectionCount: Number(h.approved_inspection_count || 0),
  verifiedInspectionCount: Number(h.verified_inspection_count || 0),
  readiness: h.readiness || null,
  raw: h,
});

function hotelCompleteness(h) {
  if (h.readiness) {
    const dimensions = [
      h.readiness.profile_ready,
      h.readiness.pricing_ready,
      h.readiness.has_owner || h.readiness.has_active_offer,
      h.readiness.passport_ready,
    ];
    const percent = Math.round((dimensions.filter(Boolean).length / dimensions.length) * 100);
    if (h.readiness.tour_builder_ready) return { label: "Готов", tone: "emerald", percent };
    return { label: "Нужно исправить", tone: "amber", percent };
  }
  const checks = [
    Boolean(h.name),
    Boolean(h.city),
    Boolean(h.country),
    Boolean(h.stars),
    Number(h.providerId) > 0,
    Boolean(h.currency),
  ];
  const done = checks.filter(Boolean).length;
  const percent = Math.round((done / checks.length) * 100);
  if (percent >= 84) return { label: "Заполнен", tone: "emerald", percent };
  if (percent >= 50) return { label: "Проверить", tone: "amber", percent };
  return { label: "Черновик", tone: "rose", percent };
}

const issueLabels = {
  "profile:name": "нет названия",
  "profile:city": "нет города",
  "profile:country": "нет страны",
  "profile:address": "нет адреса",
  "profile:stars": "нет категории",
  "profile:images": "нет фото",
  owner_missing: "нет владельца",
  rooms_missing: "нет номеров",
  rates_missing: "нет цен",
  currency_invalid: "неверная валюта",
  passport_missing: "нет опубликованной инспекции",
};

const readinessIssueText = (hotel, { showOwnership = true } = {}) =>
  (hotel.readiness?.issues || [])
    .filter((issue) => showOwnership || issue !== "owner_missing")
    .map((issue) => issueLabels[issue] || issue)
    .join(", ");

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
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 50 });
  const [summary, setSummary] = useState({});
  const [canCreateHotel, setCanCreateHotel] = useState(!providerMode);
  const [canAttachExistingHotel, setCanAttachExistingHotel] = useState(!providerMode);
  const reqIdRef = useRef(0);

  const load = useCallback(async ({ silent = false } = {}) => {
    const myReq = ++reqIdRef.current;
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const data = await apiHotelReadiness({
        name: qName.trim(), city: qCity.trim(), filter: quickFilter, sort: sortBy, dir: sortDir,
        limit: 50, page, providerMode,
      });
      const rows = data?.items || [];
      if (reqIdRef.current === myReq) {
        setItems(rows.map(normalizeHotel));
        setPagination(data?.pagination || { page, pages: 1, total: rows.length, limit: 50 });
        setSummary(data?.summary || {});
        setCanCreateHotel(!providerMode || data?.permissions?.can_create_hotel === true);
        setCanAttachExistingHotel(!providerMode || data?.permissions?.can_attach_existing_hotel === true);
      }
    } catch (e) {
      if (reqIdRef.current === myReq) setError("Не удалось загрузить список отелей");
    } finally {
      if (reqIdRef.current === myReq) setLoading(false);
    }
  }, [providerMode, qName, qCity, quickFilter, sortBy, sortDir, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) load({ silent: true });
    };
    const timer = window.setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  useEffect(() => {
    const h = () => load({ silent: true });
    window.addEventListener("provider-hotels:reload", h);
    return () => window.removeEventListener("provider-hotels:reload", h);
  }, [load]);

  const stats = useMemo(() => {
    return {
      total: Number(summary.total || 0),
      withoutCity: Number(summary.without_city || 0),
      withoutOwner: Number(summary.without_owner || 0),
      profileReady: Number(summary.profile_ready || 0),
      pricingReady: Number(summary.pricing_ready || 0),
      passportReady: Number(summary.passport_ready || 0),
      tourBuilderReady: Number(summary.tour_builder_ready || 0),
    };
  }, [summary]);

  const visibleItems = useMemo(() => {
    return items;
  }, [items]);

  const onSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    load();
  };

  const changeSort = (key) => {
    setPage(1);
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
                {providerMode
                  ? "Быстрый контроль карточек, городов и тарифных предложений ваших отелей."
                  : "Быстрый контроль базы отелей: карточки, города, владельцы и тарифные предложения."}
              </p>
            </div>

            {(canCreateHotel || canAttachExistingHotel) && onNew ? (
              <button
                type="button"
                onClick={onNew}
                className="inline-flex items-center justify-center rounded-2xl bg-orange-600 px-4 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-orange-700"
              >
                {canCreateHotel ? "+ Новый отель" : "+ Добавить из базы"}
              </button>
            ) : (canCreateHotel || canAttachExistingHotel) ? (
              <Link
                to={providerMode ? "/dashboard/hotels/new" : "/admin/hotels/new"}
                className="inline-flex items-center justify-center rounded-2xl bg-orange-600 px-4 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-orange-700"
              >
                {providerMode
                  ? (canCreateHotel ? "+ Добавить отель" : "+ Добавить из базы")
                  : "+ Новый отель"}
              </Link>
            ) : null}
          </div>
        </div>

        <div className={`grid gap-3 md:grid-cols-2 ${providerMode ? "xl:grid-cols-5" : "xl:grid-cols-6"}`}>
          <StatCard label="Всего" value={stats.total} hint="загружено в список" />
          <StatCard label="Профиль готов" value={stats.profileReady} hint="карточка заполнена" />
          <StatCard label="Цены готовы" value={stats.pricingReady} hint="опубликованные тарифы" />
          <StatCard label="Tour Builder" value={stats.tourBuilderReady} hint="можно рассчитывать" />
          <StatCard label="Инспекция" value={stats.passportReady} hint="проверка опубликована" />
          {!providerMode ? <StatCard label="Без владельца" value={stats.withoutOwner} hint="provider_id пустой" /> : null}
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
                  setPage(1);
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
              ["tour_builder", "Готовы для Tour Builder"],
              ["without_rates", "Без цен"],
              ["without_passport", "Без инспекции"],
              ["without_city", "Без города"],
              ...(!providerMode ? [["without_owner", "Без владельца"]] : []),
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => { setQuickFilter(id); setPage(1); }}
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
              Найдено: {pagination.total} · на странице {visibleItems.length}
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
                  {!providerMode ? <th className="w-[140px] px-4 py-3">Владелец</th> : null}
                  <th className="w-[260px] px-4 py-3">Готовность</th>
                  <th className="w-[260px] px-4 py-3 text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={providerMode ? 6 : 7} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                      Загрузка…
                    </td>
                  </tr>
                ) : visibleItems.length === 0 ? (
                  <tr>
                    <td colSpan={providerMode ? 6 : 7} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
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
                        {!providerMode ? <td className="px-4 py-3 text-sm font-bold text-slate-700">
                          {!providerMode && h.pendingOwnershipClaimCount > 0 ? (
                            <div><span className="text-blue-700">заявка на владение</span><div className="text-[11px] font-medium text-slate-500">{h.pendingOwnershipClaimProviderName || `#${h.pendingOwnershipClaimProviderId}`}</div></div>
                          ) : Number(h.providerId) > 0 ? h.providerId : <span className="text-amber-600">нет</span>}
                        </td> : null}
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1.5">
                            <Badge tone={completeness.tone}>{completeness.label}</Badge>
                            <div className="flex flex-wrap gap-1">
                              <Badge tone={h.readiness?.profile_ready ? "emerald" : "rose"}>Профиль</Badge>
                              <Badge tone={h.readiness?.pricing_ready ? "emerald" : "rose"}>Цены</Badge>
                              <Badge tone={h.readiness?.passport_ready ? "sky" : "slate"}>
                                {h.readiness?.passport_ready
                                  ? `Проверен${h.inspectionCount > 1 ? ` · ${h.inspectionCount}` : ""}`
                                  : "Не проверен"}
                              </Badge>
                            </div>
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full rounded-full bg-slate-900"
                                style={{ width: `${completeness.percent}%` }}
                              />
                            </div>
                            {!h.readiness?.tour_builder_ready ? (
                              <div className="max-w-[250px] text-[11px] font-semibold leading-4 text-rose-600">
                                {readinessIssueText(h, { showOwnership: !providerMode })}
                              </div>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {h.id ? (
                            <div className="flex items-center justify-end gap-2">
                              {onEdit && (!providerMode || Number(h.providerId) === Number(providerId)) ? (
                                <button
                                  type="button"
                                  onClick={() => onEdit(h)}
                                  className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50"
                                >
                                  Карточка
                                </button>
                              ) : !providerMode ? (
                                <Link
                                  to={`/admin/hotels/${h.id}/edit`}
                                  className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50"
                                >
                                  Карточка
                                </Link>
                              ) : <Link to={`/hotels/${h.id}`} className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50">Карточка</Link>}
                              <Link
                                to={providerMode ? `/provider/hotels/${h.id}/offer` : `/admin/hotels/${h.id}/offers`}
                                className={`inline-flex items-center rounded-xl px-3 py-2 text-xs font-black text-white transition ${!providerMode && h.pendingOwnershipClaimCount > 0 ? "bg-blue-700 hover:bg-blue-800" : "bg-orange-600 hover:bg-orange-700"}`}
                              >
                                {providerMode ? "Мои тарифы" : h.pendingOwnershipClaimCount > 0 ? "Проверить заявку" : "Предложения"}
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
          {pagination.pages > 1 ? <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
            <button type="button" disabled={loading || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-black text-slate-700 disabled:opacity-40">Назад</button>
            <div className="text-sm font-bold text-slate-600">Страница {pagination.page} из {pagination.pages}</div>
            <button type="button" disabled={loading || page >= pagination.pages} onClick={() => setPage((value) => Math.min(pagination.pages, value + 1))} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-black text-slate-700 disabled:opacity-40">Далее</button>
          </div> : null}
        </div>
      </div>
    </div>
  );
}
