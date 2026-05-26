// frontend/src/pages/admin/AdminActivityEvents.jsx

import React from "react";
import { apiGet } from "../../api";

function fmtDate(x) {
  if (!x) return "—";
  try {
    return new Date(x).toLocaleString("ru-RU");
  } catch {
    return String(x);
  }
}

function roleBadge(role) {
  const r = String(role || "unknown").toLowerCase();
  const cls =
    r === "client"
      ? "bg-blue-50 text-blue-700 ring-blue-100"
      : r === "provider"
        ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
        : "bg-slate-50 text-slate-700 ring-slate-100";
  return <span className={`rounded-full px-2 py-1 text-[11px] font-bold ring-1 ${cls}`}>{r}</span>;
}

export default function AdminActivityEvents() {
  const [rows, setRows] = React.useState([]);
  const [sessions, setSessions] = React.useState([]);
  const [summary, setSummary] = React.useState({});
  const [loading, setLoading] = React.useState(false);
  const [filters, setFilters] = React.useState({ role: "", type: "", q: "", limit: 150 });
  const [mode, setMode] = React.useState("events");

  async function load() {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v).trim() !== "") qs.set(k, v);
      });
      const data = await apiGet(`/api/admin/activity-events?${qs.toString()}`, "admin");
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setSummary(data.summary || {});

      const s = await apiGet(`/api/admin/activity-events/sessions?limit=${filters.limit || 150}`, "admin");
      setSessions(Array.isArray(s.rows) ? s.rows : []);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const card = (label, value, hint) => (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-black text-slate-950">{value ?? 0}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-950">Клики и поведение</h2>
            <p className="mt-1 text-sm text-slate-500">
              Здесь видно, что нажимают клиенты и поставщики, где они останавливаются и кого нужно дожимать.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              value={filters.role}
              onChange={(e) => setFilters((p) => ({ ...p, role: e.target.value }))}
            >
              <option value="">Все роли</option>
              <option value="client">Клиенты</option>
              <option value="provider">Поставщики</option>
            </select>
            <select
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              value={filters.type}
              onChange={(e) => setFilters((p) => ({ ...p, type: e.target.value }))}
            >
              <option value="">Все события</option>
              <option value="click">Клики</option>
              <option value="page_view">Просмотры страниц</option>
              <option value="form_submit">Отправки форм</option>
            </select>
            <input
              className="w-64 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              placeholder="Поиск: клиент, телефон, кнопка, страница"
              value={filters.q}
              onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))}
            />
            <input
              className="w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              type="number"
              min="1"
              max="500"
              value={filters.limit}
              onChange={(e) => setFilters((p) => ({ ...p, limit: e.target.value }))}
            />
            <button
              type="button"
              onClick={load}
              className="rounded-xl bg-black px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
              disabled={loading}
            >
              {loading ? "Обновляю..." : "Обновить"}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {card("Всего за 7 дней", summary.total)}
        {card("Клики", summary.clicks)}
        {card("Сессии", summary.sessions)}
        {card("Клиентские события", summary.client_events)}
        {card("Поставщики", summary.provider_events)}
        {card("Намерение оплаты", summary.payment_intent_events, "unlock/payme")}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className={`rounded-xl px-4 py-2 text-sm font-bold ${mode === "events" ? "bg-black text-white" : "border bg-white"}`}
          onClick={() => setMode("events")}
        >
          Список событий
        </button>
        <button
          type="button"
          className={`rounded-xl px-4 py-2 text-sm font-bold ${mode === "sessions" ? "bg-black text-white" : "border bg-white"}`}
          onClick={() => setMode("sessions")}
        >
          Сессии / где остановились
        </button>
      </div>

      {mode === "events" ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h3 className="font-bold text-slate-950">Каждый клик / событие</h3>
            <div className="text-xs text-slate-400">rows: {rows.length}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-bold text-slate-500">
                <tr>
                  <th className="px-3 py-3">Время</th>
                  <th className="px-3 py-3">Кто</th>
                  <th className="px-3 py-3">Событие</th>
                  <th className="px-3 py-3">Что нажал</th>
                  <th className="px-3 py-3">Страница</th>
                  <th className="px-3 py-3">Услуга</th>
                  <th className="px-3 py-3">IP / устройство</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top hover:bg-orange-50/30">
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-500">{fmtDate(r.created_at)}</td>
                    <td className="px-3 py-3">
                      <div>{roleBadge(r.actor_role)}</div>
                      <div className="mt-1 font-semibold text-slate-800">{r.actor_name || r.client_name || "—"}</div>
                      <div className="text-xs text-slate-400">ID: {r.actor_id || r.client_id || "—"}</div>
                      {(r.actor_phone || r.client_phone) && <div className="text-xs text-slate-500">{r.actor_phone || r.client_phone}</div>}
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-mono text-xs font-bold text-slate-900">{r.event_name}</div>
                      <div className="text-xs text-slate-400">{r.event_type}</div>
                    </td>
                    <td className="max-w-sm px-3 py-3">
                      <div className="font-medium text-slate-800">{r.element_text || "—"}</div>
                      <div className="text-xs text-slate-400">{r.element_tag || ""} {r.element_role || ""}</div>
                      {r.element_href && <div className="truncate text-xs text-blue-600">{r.element_href}</div>}
                    </td>
                    <td className="max-w-xs px-3 py-3 text-xs text-slate-600">{r.page_path || "—"}</td>
                    <td className="max-w-xs px-3 py-3">
                      <div className="font-medium text-slate-800">{r.service_title || "—"}</div>
                      <div className="text-xs text-slate-400">#{r.service_id || "—"} {r.service_category || ""}</div>
                      {r.provider_company_name && <div className="text-xs text-slate-500">{r.provider_company_name}</div>}
                    </td>
                    <td className="max-w-xs px-3 py-3 text-xs text-slate-500">
                      <div>{r.ip || "—"}</div>
                      <div className="line-clamp-2">{r.user_agent || ""}</div>
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr><td className="px-3 py-10 text-center text-slate-400" colSpan="7">Нет данных</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h3 className="font-bold text-slate-950">Сессии: где пользователь остановился</h3>
            <div className="text-xs text-slate-400">rows: {sessions.length}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-bold text-slate-500">
                <tr>
                  <th className="px-3 py-3">Последний визит</th>
                  <th className="px-3 py-3">Пользователь</th>
                  <th className="px-3 py-3">Событий</th>
                  <th className="px-3 py-3">Последняя страница</th>
                  <th className="px-3 py-3">Последние действия</th>
                  <th className="px-3 py-3">Дожим</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sessions.map((s) => {
                  const recent = Array.isArray(s.recent_events) ? s.recent_events.slice(0, 6) : [];
                  const last = recent[0] || "";
                  const push = last.includes("unlock") || last.includes("pay")
                    ? "Горячий: связаться быстро"
                    : s.clicks_count > 2
                      ? "Тёплый: напомнить/предложить помощь"
                      : "Наблюдать";
                  return (
                    <tr key={s.session_id} className="align-top hover:bg-orange-50/30">
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-500">{fmtDate(s.last_seen_at)}</td>
                      <td className="px-3 py-3">
                        {roleBadge(s.actor_role)}
                        <div className="mt-1 font-semibold">{s.actor_name || "—"}</div>
                        <div className="text-xs text-slate-400">ID: {s.actor_id || "—"}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-black">{s.events_count}</div>
                        <div className="text-xs text-slate-400">клики: {s.clicks_count}</div>
                      </td>
                      <td className="max-w-sm px-3 py-3 text-xs text-slate-600">{s.last_page || "—"}</td>
                      <td className="px-3 py-3">
                        <div className="flex max-w-xl flex-wrap gap-1">
                          {recent.map((e, idx) => (
                            <span key={`${e}-${idx}`} className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">{e}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-3 font-bold text-orange-700">{push}</td>
                    </tr>
                  );
                })}
                {!sessions.length && (
                  <tr><td className="px-3 py-10 text-center text-slate-400" colSpan="6">Нет данных</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
