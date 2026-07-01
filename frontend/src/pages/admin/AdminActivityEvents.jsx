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

function num(x) {
  const n = Number(x || 0);
  return Number.isFinite(n) ? n.toLocaleString("ru-RU") : "0";
}

function roleBadge(role) {
  const r = String(role || "unknown").toLowerCase();
  const cls =
    r === "client"
      ? "bg-blue-50 text-blue-700 ring-blue-100"
      : r === "provider"
        ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
        : r === "admin"
          ? "bg-purple-50 text-purple-700 ring-purple-100"
          : "bg-slate-50 text-slate-700 ring-slate-100";
  return <span className={`rounded-full px-2 py-1 text-[11px] font-bold ring-1 ${cls}`}>{r}</span>;
}

function MiniBar({ value, max }) {
  const pct = max > 0 ? Math.max(4, Math.min(100, (Number(value || 0) / max) * 100)) : 0;
  return (
    <div className="h-2 w-full rounded-full bg-slate-100">
      <div className="h-2 rounded-full bg-orange-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

function Card({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-black text-slate-950">{num(value)}</div>
      {hint ? <div className="mt-1 text-xs text-slate-400">{hint}</div> : null}
    </div>
  );
}

function RecentEvents({ rows, onTimeline }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="font-bold text-slate-950">Live Activity</h3>
        <div className="text-xs text-slate-400">rows: {rows.length}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-bold text-slate-500">
            <tr>
              <th className="px-3 py-3">Время</th>
              <th className="px-3 py-3">Кто</th>
              <th className="px-3 py-3">Источник</th>
              <th className="px-3 py-3">Событие</th>
              <th className="px-3 py-3">Что сделал</th>
              <th className="px-3 py-3">Страница / услуга</th>
              <th className="px-3 py-3">Действие</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="align-top hover:bg-orange-50/30">
                <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-500">{fmtDate(r.created_at)}</td>
                <td className="px-3 py-3">
                  {roleBadge(r.actor_role)}
                  <div className="mt-1 font-semibold text-slate-800">{r.actor_name || r.client_name || "—"}</div>
                  <div className="text-xs text-slate-400">ID: {r.actor_id || r.client_id || "—"}</div>
                  {(r.actor_phone || r.client_phone) ? <div className="text-xs text-slate-500">{r.actor_phone || r.client_phone}</div> : null}
                </td>
                <td className="px-3 py-3 font-mono text-xs text-slate-500">{r.source || "—"}</td>
                <td className="px-3 py-3">
                  <div className="font-mono text-xs font-bold text-slate-900">{r.event_name}</div>
                  <div className="text-xs text-slate-400">{r.event_type}</div>
                </td>
                <td className="max-w-sm px-3 py-3">
                  <div className="font-medium text-slate-800">{r.element_text || "—"}</div>
                  {r.element_href ? <div className="mt-1 max-w-xs truncate text-xs text-slate-400">{r.element_href}</div> : null}
                </td>
                <td className="max-w-md px-3 py-3 text-xs text-slate-600">
                  <div>{r.page_path || "—"}</div>
                  {r.service_id ? <div className="mt-1 font-bold text-orange-700">#{r.service_id} {r.service_title || ""}</div> : null}
                </td>
                <td className="px-3 py-3">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold hover:bg-slate-50"
                    onClick={() => onTimeline(r)}
                  >
                    Timeline
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length ? <tr><td className="px-3 py-10 text-center text-slate-400" colSpan="7">Нет данных</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdminActivityEvents() {
  const [rows, setRows] = React.useState([]);
  const [sessions, setSessions] = React.useState([]);
  const [overview, setOverview] = React.useState({});
  const [funnel, setFunnel] = React.useState([]);
  const [hotLeads, setHotLeads] = React.useState([]);
  const [services, setServices] = React.useState([]);
  const [timeline, setTimeline] = React.useState([]);
  const [timelineTitle, setTimelineTitle] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [mode, setMode] = React.useState("live");
  const [filters, setFilters] = React.useState({ role: "", type: "", source: "", q: "", since_hours: 168, limit: 150 });

  async function load() {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v).trim() !== "") qs.set(k, v);
      });
      const [ev, ov, ss, fu, hl, sv] = await Promise.all([
        apiGet(`/api/admin/activity-events?${qs.toString()}`, "admin"),
        apiGet(`/api/admin/activity-events/overview?since_hours=${filters.since_hours || 168}`, "admin"),
        apiGet(`/api/admin/activity-events/sessions?since_hours=${filters.since_hours || 168}&limit=${filters.limit || 150}`, "admin"),
        apiGet(`/api/admin/activity-events/funnel?since_hours=${filters.since_hours || 168}`, "admin"),
        apiGet(`/api/admin/activity-events/hot-leads?since_hours=${filters.since_hours || 168}&limit=100`, "admin"),
        apiGet(`/api/admin/activity-events/services?since_hours=${filters.since_hours || 168}&limit=100`, "admin"),
      ]);
      setRows(Array.isArray(ev.rows) ? ev.rows : []);
      setOverview(ov || {});
      setSessions(Array.isArray(ss.rows) ? ss.rows : []);
      setFunnel(Array.isArray(fu.steps) ? fu.steps : []);
      setHotLeads(Array.isArray(hl.rows) ? hl.rows : []);
      setServices(Array.isArray(sv.rows) ? sv.rows : []);
    } finally {
      setLoading(false);
    }
  }

  async function openTimeline(seed) {
    const qs = new URLSearchParams({ since_hours: String(filters.since_hours || 168), limit: "250" });
    if (seed.session_id) qs.set("session_id", seed.session_id);
    else if (seed.actor_role && seed.actor_id) {
      qs.set("actor_role", seed.actor_role);
      qs.set("actor_id", seed.actor_id);
    } else if (seed.service_id) qs.set("service_id", seed.service_id);
    setTimelineTitle(seed.actor_name || seed.session_id || (seed.service_id ? `Услуга #${seed.service_id}` : "Timeline"));
    const data = await apiGet(`/api/admin/activity-events/timeline?${qs.toString()}`, "admin");
    setTimeline(Array.isArray(data.rows) ? data.rows : []);
    setMode("timeline");
  }

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = overview.summary || {};
  const maxFunnel = Math.max(...funnel.map((x) => Number(x.count || 0)), 1);

  const Tab = ({ id, children }) => (
    <button
      type="button"
      className={`rounded-xl px-4 py-2 text-sm font-bold ${mode === id ? "bg-black text-white" : "border border-slate-200 bg-white text-slate-700"}`}
      onClick={() => setMode(id)}
    >
      {children}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-950">Event Bus Travella</h2>
            <p className="mt-1 text-sm text-slate-500">
              Единый центр наблюдения: web, bot, API, платежи, интерес к услугам и горячие участники.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" value={filters.role} onChange={(e) => setFilters((p) => ({ ...p, role: e.target.value }))}>
              <option value="">Все роли</option><option value="client">Клиенты</option><option value="provider">Поставщики</option><option value="admin">Админы</option>
            </select>
            <select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" value={filters.source} onChange={(e) => setFilters((p) => ({ ...p, source: e.target.value }))}>
              <option value="">Все источники</option><option value="web">Web</option><option value="telegram_bot">Telegram bot</option><option value="api">API</option>
            </select>
            <select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" value={filters.type} onChange={(e) => setFilters((p) => ({ ...p, type: e.target.value }))}>
              <option value="">Все типы</option><option value="click">Клики</option><option value="page_view">Страницы</option><option value="telegram_update">Telegram</option><option value="api_request">API</option><option value="telegram_error">Ошибки TG</option>
            </select>
            <input className="w-64 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" placeholder="Поиск: имя, телефон, кнопка, услуга" value={filters.q} onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))} />
            <select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" value={filters.since_hours} onChange={(e) => setFilters((p) => ({ ...p, since_hours: e.target.value }))}>
              <option value="24">24 часа</option><option value="72">3 дня</option><option value="168">7 дней</option><option value="720">30 дней</option>
            </select>
            <input className="w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" type="number" min="1" max="500" value={filters.limit} onChange={(e) => setFilters((p) => ({ ...p, limit: e.target.value }))} />
            <button type="button" onClick={load} className="rounded-xl bg-black px-4 py-2 text-sm font-bold text-white disabled:opacity-60" disabled={loading}>{loading ? "Обновляю..." : "Обновить"}</button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Card label="Событий" value={summary.total_events} />
        <Card label="Сессии" value={summary.sessions} />
        <Card label="Участники" value={summary.actors} />
        <Card label="Web" value={summary.web_events} />
        <Card label="Telegram" value={summary.telegram_events} />
        <Card label="Оплата/контакты" value={summary.payment_related} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Tab id="live">Live</Tab>
        <Tab id="funnel">Воронка</Tab>
        <Tab id="hot">Горячие</Tab>
        <Tab id="sessions">Сессии</Tab>
        <Tab id="services">Услуги</Tab>
        <Tab id="timeline">Timeline</Tab>
      </div>

      {mode === "live" ? <RecentEvents rows={rows} onTimeline={openTimeline} /> : null}

      {mode === "funnel" ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="font-bold text-slate-950">Воронка действий</h3>
          <div className="mt-4 space-y-3">
            {funnel.map((s, idx) => (
              <div key={s.key} className="grid grid-cols-1 gap-2 md:grid-cols-[220px_1fr_90px] md:items-center">
                <div className="text-sm font-bold text-slate-700">{idx + 1}. {s.label}</div>
                <MiniBar value={s.count} max={maxFunnel} />
                <div className="text-right text-sm font-black text-slate-900">{num(s.count)}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {mode === "hot" ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3"><h3 className="font-bold text-slate-950">Горячие участники / кого дожимать</h3></div>
          <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs font-bold text-slate-500"><tr><th className="px-3 py-3">Score</th><th className="px-3 py-3">Кто</th><th className="px-3 py-3">Интерес</th><th className="px-3 py-3">Последние действия</th><th className="px-3 py-3">Действие</th></tr></thead><tbody className="divide-y divide-slate-100">
            {hotLeads.map((x) => <tr key={`${x.session_id}-${x.actor_role}-${x.actor_id}`} className="align-top hover:bg-orange-50/30"><td className="px-3 py-3 text-2xl font-black text-orange-600">{num(x.lead_score)}</td><td className="px-3 py-3">{roleBadge(x.actor_role)}<div className="mt-1 font-bold">{x.actor_name || "—"}</div><div className="text-xs text-slate-400">ID: {x.actor_id || "—"}</div><div className="text-xs text-slate-500">{x.actor_phone || ""}</div></td><td className="px-3 py-3 text-xs"><div>событий: <b>{x.events_count}</b></div><div>клики: <b>{x.clicks_count}</b></div><div>контакты: <b>{x.contact_intents}</b></div><div>оплаты: <b>{x.payment_intents}</b></div></td><td className="px-3 py-3"><div className="flex max-w-xl flex-wrap gap-1">{(x.recent_events || []).slice(0, 8).map((e, i) => <span key={`${e}-${i}`} className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">{e}</span>)}</div></td><td className="px-3 py-3"><button className="rounded-lg border px-2 py-1 text-xs font-bold" onClick={() => openTimeline(x)}>Timeline</button></td></tr>)}
          </tbody></table></div>
        </div>
      ) : null}

      {mode === "sessions" ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3"><h3 className="font-bold text-slate-950">Сессии: где остановились</h3></div>
          <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs font-bold text-slate-500"><tr><th className="px-3 py-3">Последний визит</th><th className="px-3 py-3">Пользователь</th><th className="px-3 py-3">Событий</th><th className="px-3 py-3">Последняя страница</th><th className="px-3 py-3">Последние действия</th><th className="px-3 py-3">Дожим</th></tr></thead><tbody className="divide-y divide-slate-100">
            {sessions.map((s) => { const recent = Array.isArray(s.recent_events) ? s.recent_events.slice(0, 7) : []; const push = Number(s.money_intent_count || 0) > 0 ? "Горячий: связаться быстро" : Number(s.clicks_count || 0) > 2 ? "Тёплый: предложить помощь" : "Наблюдать"; return <tr key={s.session_id} className="align-top hover:bg-orange-50/30"><td className="whitespace-nowrap px-3 py-3 text-xs text-slate-500">{fmtDate(s.last_seen_at)}</td><td className="px-3 py-3">{roleBadge(s.actor_role)}<div className="mt-1 font-semibold">{s.actor_name || "—"}</div><div className="text-xs text-slate-400">ID: {s.actor_id || "—"}</div></td><td className="px-3 py-3"><div className="font-black">{s.events_count}</div><div className="text-xs text-slate-400">клики: {s.clicks_count}</div></td><td className="max-w-sm px-3 py-3 text-xs text-slate-600">{s.last_page || "—"}</td><td className="px-3 py-3"><div className="flex max-w-xl flex-wrap gap-1">{recent.map((e, idx) => <span key={`${e}-${idx}`} className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">{e}</span>)}</div></td><td className="px-3 py-3"><div className="font-bold text-orange-700">{push}</div><button className="mt-2 rounded-lg border px-2 py-1 text-xs font-bold" onClick={() => openTimeline(s)}>Timeline</button></td></tr>; })}
          </tbody></table></div>
        </div>
      ) : null}

      {mode === "services" ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3"><h3 className="font-bold text-slate-950">Аналитика услуг</h3></div>
          <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs font-bold text-slate-500"><tr><th className="px-3 py-3">Услуга</th><th className="px-3 py-3">Поставщик</th><th className="px-3 py-3">Events</th><th className="px-3 py-3">Views</th><th className="px-3 py-3">Clicks</th><th className="px-3 py-3">Requests</th><th className="px-3 py-3">Contacts</th><th className="px-3 py-3">Последнее</th></tr></thead><tbody className="divide-y divide-slate-100">
            {services.map((s) => <tr key={s.service_id} className="hover:bg-orange-50/30"><td className="px-3 py-3"><div className="font-bold">#{s.service_id} {s.service_title || "—"}</div><div className="text-xs text-slate-400">{s.service_category || ""}</div></td><td className="px-3 py-3">{s.provider_name || "—"}</td><td className="px-3 py-3 font-black">{s.events_count}</td><td className="px-3 py-3">{s.views}</td><td className="px-3 py-3">{s.clicks}</td><td className="px-3 py-3">{s.quick_requests}</td><td className="px-3 py-3 font-bold text-orange-700">{s.contact_intents}</td><td className="px-3 py-3 text-xs text-slate-500">{fmtDate(s.last_event_at)}</td></tr>)}
          </tbody></table></div>
        </div>
      ) : null}

      {mode === "timeline" ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><h3 className="font-bold text-slate-950">Timeline: {timelineTitle || "выберите событие"}</h3><div className="text-xs text-slate-400">rows: {timeline.length}</div></div>
          <div className="divide-y divide-slate-100">
            {timeline.map((r) => <div key={r.id} className="grid grid-cols-1 gap-2 p-3 md:grid-cols-[180px_170px_1fr]"><div className="text-xs text-slate-500">{fmtDate(r.created_at)}</div><div>{roleBadge(r.actor_role)}<div className="mt-1 text-xs text-slate-500">{r.source}</div></div><div><div className="font-mono text-xs font-bold">{r.event_name}</div><div className="mt-1 text-sm text-slate-700">{r.element_text || r.page_path || "—"}</div>{r.service_id ? <div className="mt-1 text-xs font-bold text-orange-700">#{r.service_id} {r.service_title || ""}</div> : null}</div></div>)}
            {!timeline.length ? <div className="p-10 text-center text-slate-400">Выберите событие, сессию или горячего участника</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
