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

function fmtTime(x) {
  if (!x) return "—";
  try {
    return new Date(x).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return String(x);
  }
}

function num(x) {
  const n = Number(x || 0);
  return Number.isFinite(n) ? n.toLocaleString("ru-RU") : "0";
}

function safeLower(x) {
  return String(x || "").toLowerCase();
}

function cleanPath(path) {
  const p = String(path || "").trim();
  if (!p) return "—";
  if (p.startsWith("/api/service-stats/") && p.endsWith("/view")) return "Просмотр карточки услуги";
  if (p.startsWith("/admin/finance")) return "Админка финансов / аналитики";
  if (p === "/" || p === "") return "Главная / marketplace";
  if (p.includes("marketplace")) return "Marketplace";
  if (p.includes("dashboard")) return "Кабинет поставщика";
  if (p.includes("client")) return "Кабинет клиента";
  return p;
}

function actionLabel(r) {
  const name = safeLower(r.event_name);
  const type = safeLower(r.event_type);
  const source = safeLower(r.source);
  const text = String(r.element_text || "").trim();
  const path = String(r.page_path || "").trim();
  const meta = r.meta || {};

  if (name.includes("successful_payment") || name.includes("paid") || meta.status === "paid") return "✅ Оплата успешно завершена";
  if (name.includes("complete")) return "✅ Click/Payme: Complete принят";
  if (name.includes("prepare")) return "🧾 Click: Prepare принят";
  if (name.includes("payment") || name.includes("payme") || name.includes("click") || type === "payment") return "💳 Действие с оплатой";
  if (name.includes("unlock") || name.includes("contact") || text.toLowerCase().includes("контакт")) return "🔓 Интерес к контактам";
  if (text.toLowerCase().includes("быстрый запрос") || name.includes("request")) return "⚡ Быстрый запрос";
  if (text.toLowerCase().includes("подробнее") || name.includes("detail")) return "📌 Открыл подробности";
  if (path.startsWith("/api/service-stats/") || name.includes("service_stats") || name.includes("view")) return "👀 Просмотр карточки услуги";
  if (name === "page_view" || type === "page_view") return "📄 Открыл страницу";
  if (type === "click" || name === "click" || name === "link_click") return text ? `👆 Нажал: ${text}` : "👆 Клик по элементу";
  if (source === "telegram_bot" && (name === "telegram_message" || type.includes("telegram"))) return text ? `🤖 Telegram: ${text}` : "🤖 Сообщение/кнопка в Telegram";
  if (source === "api") return "⚙️ Системное API-действие";
  if (name.includes("error") || type.includes("error")) return "❌ Ошибка";
  return text || r.event_name || "Событие";
}

function simpleEventName(name) {
  const r = { event_name: name, event_type: name, element_text: "", page_path: "" };
  return actionLabel(r).replace(/^[^А-ЯA-Za-z0-9]+\s*/, "");
}

function pct(part, total) {
  const a = Number(part || 0);
  const b = Number(total || 0);
  if (!b) return "0%";
  return `${Math.round((a / b) * 1000) / 10}%`;
}

function actionKind(r) {
  const label = actionLabel(r);
  if (label.startsWith("✅")) return "success";
  if (label.startsWith("❌")) return "danger";
  if (label.startsWith("💳") || label.startsWith("🔓") || label.startsWith("⚡")) return "hot";
  if (label.startsWith("🤖")) return "telegram";
  if (label.startsWith("⚙️")) return "system";
  return "normal";
}

function recommendationForLead(x) {
  const score = Number(x.lead_score || 0);
  const contacts = Number(x.contact_intents || 0);
  const payments = Number(x.payment_intents || 0);
  const requests = Number(x.quick_requests || 0);
  const errors = Number(x.errors_count || 0);
  if (payments > 0 || contacts > 0) return "Срочно дожать: был интерес к оплате/контактам";
  if (errors > 0) return "Проверить: у пользователя были ошибки";
  if (requests > 0) return "Связаться: отправлял быстрый запрос";
  if (score >= 20) return "Тёплый: предложить помощь";
  return "Наблюдать";
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
  const label = r === "client" ? "client" : r === "provider" ? "provider" : r === "admin" ? "admin" : "unknown";
  return <span className={`rounded-full px-2 py-1 text-[11px] font-bold ring-1 ${cls}`}>{label}</span>;
}

function SourceBadge({ source }) {
  const s = safeLower(source || "unknown");
  const label = s === "telegram_bot" ? "Telegram" : s === "web" ? "Web" : s === "api" ? "API" : s || "—";
  return <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600">{label}</span>;
}

function ActionPill({ event }) {
  const kind = actionKind(event);
  const cls =
    kind === "success"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-100"
      : kind === "danger"
        ? "bg-red-50 text-red-800 ring-red-100"
        : kind === "hot"
          ? "bg-orange-50 text-orange-800 ring-orange-100"
          : kind === "telegram"
            ? "bg-sky-50 text-sky-800 ring-sky-100"
            : kind === "system"
              ? "bg-slate-50 text-slate-600 ring-slate-100"
              : "bg-white text-slate-800 ring-slate-200";
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ring-1 ${cls}`}>{actionLabel(event)}</span>;
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

function ActorBlock({ r }) {
  return (
    <div>
      {roleBadge(r.actor_role)}
      <div className="mt-1 font-semibold text-slate-800">{r.actor_name || r.client_name || "—"}</div>
      <div className="text-xs text-slate-400">ID: {r.actor_id || r.client_id || "—"}</div>
      {(r.actor_phone || r.client_phone) ? <div className="text-xs text-slate-500">{r.actor_phone || r.client_phone}</div> : null}
    </div>
  );
}

function ObjectBlock({ r }) {
  if (r.service_id) {
    return (
      <div>
        <div className="font-bold text-orange-700">Услуга #{r.service_id}</div>
        <div className="max-w-sm text-sm font-semibold text-slate-800">{r.service_title || "Название не подтянулось"}</div>
        {r.provider_company_name ? <div className="text-xs text-slate-500">{r.provider_company_name}</div> : null}
      </div>
    );
  }
  return <div className="text-xs text-slate-600">{cleanPath(r.page_path)}</div>;
}

function RecentEvents({ rows, onTimeline }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div>
          <h3 className="font-bold text-slate-950">Live Monitor</h3>
          <p className="text-xs text-slate-500">Живая лента понятных действий без технического шума.</p>
        </div>
        <div className="text-xs text-slate-400">rows: {rows.length}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-bold text-slate-500">
            <tr>
              <th className="px-3 py-3">Время</th>
              <th className="px-3 py-3">Кто</th>
              <th className="px-3 py-3">Источник</th>
              <th className="px-3 py-3">Понятное действие</th>
              <th className="px-3 py-3">Объект</th>
              <th className="px-3 py-3">Технически</th>
              <th className="px-3 py-3">Timeline</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="align-top hover:bg-orange-50/30">
                <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-500">{fmtDate(r.created_at)}</td>
                <td className="px-3 py-3"><ActorBlock r={r} /></td>
                <td className="px-3 py-3"><SourceBadge source={r.source} /></td>
                <td className="max-w-md px-3 py-3">
                  <ActionPill event={r} />
                  {r.element_text && actionLabel(r) !== r.element_text ? <div className="mt-2 text-xs text-slate-500">Кнопка/текст: {r.element_text}</div> : null}
                </td>
                <td className="max-w-md px-3 py-3"><ObjectBlock r={r} /></td>
                <td className="max-w-xs px-3 py-3 text-xs text-slate-400">
                  <div>{r.event_name}</div>
                  <div>{r.event_type}</div>
                  {r.page_path ? <div className="truncate">{r.page_path}</div> : null}
                </td>
                <td className="px-3 py-3">
                  <button type="button" className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold hover:bg-slate-50" onClick={() => onTimeline(r)}>Открыть</button>
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

function OnlineNow({ rows, onTimeline }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="font-bold text-slate-950">Онлайн сейчас</h3>
        <p className="text-xs text-slate-500">Последние 10 минут: кто на сайте/в боте, где находится и кого нужно быстро дожать.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-bold text-slate-500"><tr><th className="px-3 py-3">Был</th><th className="px-3 py-3">Кто</th><th className="px-3 py-3">Где сейчас</th><th className="px-3 py-3">Последнее действие</th><th className="px-3 py-3">Сигнал</th><th className="px-3 py-3">Действие</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((x) => {
              const hot = x.payment_interest ? "💰 дошёл до оплаты" : x.contact_interest ? "🔓 хочет контакты" : Number(x.events_count || 0) >= 5 ? "🔥 активен" : "наблюдать";
              return <tr key={x.online_key} className="align-top hover:bg-orange-50/30"><td className="whitespace-nowrap px-3 py-3 text-xs text-slate-500">{fmtTime(x.last_seen_at)}</td><td className="px-3 py-3">{roleBadge(x.actor_role)}<div className="mt-1 font-bold">{x.actor_name || "—"}</div><div className="text-xs text-slate-400">ID: {x.actor_id || "—"}</div><div className="text-xs text-slate-500">{x.actor_phone || ""}</div></td><td className="px-3 py-3"><div className="font-semibold text-slate-700">{cleanPath(x.current_page)}</div>{x.service_id ? <div className="mt-1 text-xs font-bold text-orange-700">Услуга #{x.service_id}</div> : null}</td><td className="px-3 py-3"><ActionPill event={{ event_name: x.last_event_name, event_type: x.last_event_type, element_text: x.last_element_text, page_path: x.current_page }} /><div className="mt-1 text-xs text-slate-400">событий: {x.events_count}</div></td><td className="px-3 py-3 font-bold text-orange-700">{hot}</td><td className="px-3 py-3"><button className="rounded-lg border px-2 py-1 text-xs font-bold" onClick={() => onTimeline({ session_id: x.session_id, actor_role: x.actor_role, actor_id: x.actor_id, actor_name: x.actor_name })}>Timeline</button></td></tr>;
            })}
            {!rows.length ? <tr><td className="px-3 py-10 text-center text-slate-400" colSpan="6">Сейчас никого не видно</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ErrorsPanel({ rows, onTimeline }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-red-100 bg-white shadow-sm">
      <div className="border-b border-red-50 px-4 py-3">
        <h3 className="font-bold text-red-900">Ошибки и сбои</h3>
        <p className="text-xs text-red-500">Отдельный список технических и пользовательских ошибок, чтобы быстро найти место поломки.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-red-50 text-xs font-bold text-red-500"><tr><th className="px-3 py-3">Время</th><th className="px-3 py-3">Кто</th><th className="px-3 py-3">Источник</th><th className="px-3 py-3">Ошибка</th><th className="px-3 py-3">Где</th><th className="px-3 py-3">Действие</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => <tr key={r.id} className="align-top hover:bg-red-50/40"><td className="whitespace-nowrap px-3 py-3 text-xs text-slate-500">{fmtDate(r.created_at)}</td><td className="px-3 py-3">{roleBadge(r.actor_role)}<div className="mt-1 font-semibold">{r.actor_name || r.client_name || "—"}</div><div className="text-xs text-slate-400">ID: {r.actor_id || "—"}</div></td><td className="px-3 py-3"><SourceBadge source={r.source} /></td><td className="px-3 py-3"><ActionPill event={r} /><div className="mt-1 text-xs text-slate-400">{r.event_name} · {r.event_type}</div></td><td className="max-w-md px-3 py-3 text-xs text-slate-600">{cleanPath(r.page_path)}{r.service_id ? <div className="mt-1 font-bold text-orange-700">Услуга #{r.service_id}</div> : null}</td><td className="px-3 py-3"><button className="rounded-lg border px-2 py-1 text-xs font-bold" onClick={() => onTimeline(r)}>Timeline</button></td></tr>)}
            {!rows.length ? <tr><td className="px-3 py-10 text-center text-slate-400" colSpan="6">Ошибок нет</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TimelineView({ rows, title }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div>
          <h3 className="font-bold text-slate-950">Timeline: {title || "выберите событие"}</h3>
          <p className="text-xs text-slate-500">Хронология одного пользователя, сессии или объекта.</p>
        </div>
        <div className="text-xs text-slate-400">rows: {rows.length}</div>
      </div>
      <div className="p-4">
        {rows.length ? (
          <div className="relative space-y-4 before:absolute before:bottom-0 before:left-[89px] before:top-0 before:w-px before:bg-slate-200">
            {rows.map((r) => (
              <div key={r.id} className="relative grid grid-cols-[76px_24px_1fr] gap-3">
                <div className="pt-1 text-right text-xs font-bold text-slate-500">{fmtTime(r.created_at)}</div>
                <div className="relative z-10 mt-1 h-5 w-5 rounded-full border-4 border-white bg-orange-500 shadow" />
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <ActionPill event={r} />
                    <SourceBadge source={r.source} />
                    {roleBadge(r.actor_role)}
                  </div>
                  <div className="mt-2 text-sm text-slate-800">{r.element_text || cleanPath(r.page_path)}</div>
                  {r.service_id ? <div className="mt-1 text-xs font-bold text-orange-700">Услуга #{r.service_id}: {r.service_title || "—"}</div> : null}
                  <div className="mt-2 text-[11px] text-slate-400">{r.event_name} · {r.event_type}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-10 text-center text-slate-400">Выберите событие, сессию, горячего участника или услугу</div>
        )}
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
  const [online, setOnline] = React.useState([]);
  const [errors, setErrors] = React.useState([]);
  const [timeline, setTimeline] = React.useState([]);
  const [timelineTitle, setTimelineTitle] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [mode, setMode] = React.useState("live");
  const [filters, setFilters] = React.useState({ role: "", type: "", source: "", q: "", since_hours: 168, limit: 150, include_admin: false });

  async function load() {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v).trim() !== "") qs.set(k, v);
      });
      const [ev, ov, ss, fu, hl, sv, on, er] = await Promise.all([
        apiGet(`/api/admin/activity-events?${qs.toString()}`, "admin"),
        apiGet(`/api/admin/activity-events/overview?${qs.toString()}`, "admin"),
        apiGet(`/api/admin/activity-events/sessions?${qs.toString()}`, "admin"),
        apiGet(`/api/admin/activity-events/funnel?${qs.toString()}`, "admin"),
        apiGet(`/api/admin/activity-events/hot-leads?${qs.toString()}`, "admin"),
        apiGet(`/api/admin/activity-events/services?${qs.toString()}`, "admin"),
        apiGet(`/api/admin/activity-events/online?minutes=10&limit=100&include_admin=${filters.include_admin ? "1" : "0"}`, "admin"),
        apiGet(`/api/admin/activity-events/errors?${qs.toString()}`, "admin"),
      ]);
      setRows(Array.isArray(ev.rows) ? ev.rows : []);
      setOverview(ov || {});
      setSessions(Array.isArray(ss.rows) ? ss.rows : []);
      setFunnel(Array.isArray(fu.steps) ? fu.steps : []);
      setHotLeads(Array.isArray(hl.rows) ? hl.rows : []);
      setServices(Array.isArray(sv.rows) ? sv.rows : []);
      setOnline(Array.isArray(on.rows) ? on.rows : []);
      setErrors(Array.isArray(er.rows) ? er.rows : []);
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
    setTimelineTitle(seed.actor_name || seed.session_id || seed.service_title || (seed.service_id ? `Услуга #${seed.service_id}` : "Timeline"));
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
  const errorCount = Number(summary.errors || 0);

  const Tab = ({ id, children }) => (
    <button type="button" className={`rounded-xl px-4 py-2 text-sm font-bold ${mode === id ? "bg-black text-white" : "border border-slate-200 bg-white text-slate-700"}`} onClick={() => setMode(id)}>{children}</button>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-950">Event Bus Travella</h2>
            <p className="mt-1 text-sm text-slate-500">Центр наблюдения: кто что делает, где теряется, кто горячий, какая услуга продаёт.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" value={filters.role} onChange={(e) => setFilters((p) => ({ ...p, role: e.target.value }))}>
              <option value="">Все роли без админов</option><option value="client">Клиенты</option><option value="provider">Поставщики</option><option value="admin">Админы</option>
            </select>
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600">
              <input type="checkbox" checked={!!filters.include_admin} onChange={(e) => setFilters((p) => ({ ...p, include_admin: e.target.checked }))} />
              показать админов
            </label>
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
        <Card label="Онлайн 10 мин" value={summary.online_now} hint="прямо сейчас" />
        <Card label="Web" value={summary.web_events} />
        <Card label="Telegram" value={summary.telegram_events} />
        <Card label="Ошибки" value={errorCount} hint={errorCount ? "требует внимания" : "чисто"} />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-orange-100 bg-orange-50 p-4">
          <div className="text-xs font-bold text-orange-700">Оплата / контакты</div>
          <div className="mt-1 text-2xl font-black text-orange-900">{num(summary.payment_related)}</div>
          <div className="text-xs text-orange-700">главный коммерческий сигнал</div>
        </div>
        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
          <div className="text-xs font-bold text-blue-700">Контактный интерес</div>
          <div className="mt-1 text-2xl font-black text-blue-900">{num(summary.contact_related)}</div>
          <div className="text-xs text-blue-700">кто хотел связаться с поставщиком</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-bold text-slate-500">Что делать утром</div>
          <div className="mt-1 text-sm font-bold text-slate-900">Открыть “Горячие” → дожать оплату/контакты → проверить “Ошибки”.</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Tab id="live">Live</Tab>
        <Tab id="online">Онлайн</Tab>
        <Tab id="funnel">Воронка</Tab>
        <Tab id="hot">Горячие</Tab>
        <Tab id="sessions">Сессии</Tab>
        <Tab id="services">Услуги</Tab>
        <Tab id="timeline">Timeline</Tab>
        <Tab id="errors">Ошибки</Tab>
      </div>

      {mode === "live" ? <RecentEvents rows={rows} onTimeline={openTimeline} /> : null}

      {mode === "online" ? <OnlineNow rows={online} onTimeline={openTimeline} /> : null}

      {mode === "funnel" ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="font-bold text-slate-950">Воронка действий</h3>
          <p className="mt-1 text-xs text-slate-500">Показывает путь от просмотра до оплаты/успешного действия.</p>
          <div className="mt-4 space-y-3">
            {funnel.map((s, idx) => (
              <div key={s.key} className="grid grid-cols-1 gap-2 md:grid-cols-[240px_1fr_110px] md:items-center">
                <div className="text-sm font-bold text-slate-700">{idx + 1}. {s.label}</div>
                <MiniBar value={s.count} max={maxFunnel} />
                <div className="text-right text-sm font-black text-slate-900">{num(s.count)}<div className="text-[11px] font-semibold text-slate-400">{s.conversion !== undefined ? `${s.conversion}%` : ""}{s.drop ? ` · -${num(s.drop)}` : ""}</div></div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {mode === "hot" ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3"><h3 className="font-bold text-slate-950">Горячие участники / кого дожимать</h3></div>
          <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs font-bold text-slate-500"><tr><th className="px-3 py-3">Score</th><th className="px-3 py-3">Кто</th><th className="px-3 py-3">Почему горячий</th><th className="px-3 py-3">Рекомендация</th><th className="px-3 py-3">Действие</th></tr></thead><tbody className="divide-y divide-slate-100">
            {hotLeads.map((x) => <tr key={`${x.session_id}-${x.actor_role}-${x.actor_id}`} className="align-top hover:bg-orange-50/30"><td className="px-3 py-3 text-2xl font-black text-orange-600">{num(x.lead_score)}</td><td className="px-3 py-3">{roleBadge(x.actor_role)}<div className="mt-1 font-bold">{x.actor_name || "—"}</div><div className="text-xs text-slate-400">ID: {x.actor_id || "—"}</div><div className="text-xs text-slate-500">{x.actor_phone || ""}</div></td><td className="px-3 py-3 text-xs"><div>событий: <b>{x.events_count}</b></div><div>клики: <b>{x.clicks_count}</b></div><div>контакты: <b>{x.contact_intents}</b></div><div>оплаты: <b>{x.payment_intents}</b></div><div>ошибки: <b>{x.errors_count}</b></div></td><td className="px-3 py-3 font-bold text-orange-700">{recommendationForLead(x)}</td><td className="px-3 py-3"><button className="rounded-lg border px-2 py-1 text-xs font-bold" onClick={() => openTimeline(x)}>Timeline</button></td></tr>)}
            {!hotLeads.length ? <tr><td className="px-3 py-10 text-center text-slate-400" colSpan="5">Нет данных</td></tr> : null}
          </tbody></table></div>
        </div>
      ) : null}

      {mode === "sessions" ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3"><h3 className="font-bold text-slate-950">Сессии: где пользователь остановился</h3></div>
          <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs font-bold text-slate-500"><tr><th className="px-3 py-3">Последний визит</th><th className="px-3 py-3">Пользователь</th><th className="px-3 py-3">Активность</th><th className="px-3 py-3">Где остановился</th><th className="px-3 py-3">Последние действия</th><th className="px-3 py-3">Дожим</th></tr></thead><tbody className="divide-y divide-slate-100">
            {sessions.map((s) => { const recent = Array.isArray(s.recent_events) ? s.recent_events.slice(0, 7) : []; const push = Number(s.money_intent_count || 0) > 0 ? "Горячий: связаться быстро" : Number(s.clicks_count || 0) > 2 ? "Тёплый: предложить помощь" : "Наблюдать"; return <tr key={s.session_id} className="align-top hover:bg-orange-50/30"><td className="whitespace-nowrap px-3 py-3 text-xs text-slate-500">{fmtDate(s.last_seen_at)}</td><td className="px-3 py-3">{roleBadge(s.actor_role)}<div className="mt-1 font-semibold">{s.actor_name || "—"}</div><div className="text-xs text-slate-400">ID: {s.actor_id || "—"}</div></td><td className="px-3 py-3"><div className="font-black">{s.events_count}</div><div className="text-xs text-slate-400">клики: {s.clicks_count}</div></td><td className="max-w-sm px-3 py-3 text-xs text-slate-600">{cleanPath(s.last_page)}</td><td className="px-3 py-3"><div className="flex max-w-xl flex-wrap gap-1">{recent.map((e, idx) => <span key={`${e}-${idx}`} className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">{simpleEventName(e)}</span>)}</div></td><td className="px-3 py-3"><div className="font-bold text-orange-700">{push}</div><button className="mt-2 rounded-lg border px-2 py-1 text-xs font-bold" onClick={() => openTimeline(s)}>Timeline</button></td></tr>; })}
            {!sessions.length ? <tr><td className="px-3 py-10 text-center text-slate-400" colSpan="6">Нет данных</td></tr> : null}
          </tbody></table></div>
        </div>
      ) : null}

      {mode === "services" ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3"><h3 className="font-bold text-slate-950">Аналитика услуг</h3></div>
          <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs font-bold text-slate-500"><tr><th className="px-3 py-3">Услуга</th><th className="px-3 py-3">Поставщик</th><th className="px-3 py-3">Интерес</th><th className="px-3 py-3">Просмотры</th><th className="px-3 py-3">Подробнее</th><th className="px-3 py-3">Запросы</th><th className="px-3 py-3">Контакты</th><th className="px-3 py-3">Оплаты</th><th className="px-3 py-3">Конверсия</th><th className="px-3 py-3">Timeline</th></tr></thead><tbody className="divide-y divide-slate-100">
            {services.map((s) => <tr key={s.service_id} className="hover:bg-orange-50/30"><td className="px-3 py-3"><div className="font-bold">#{s.service_id} {s.service_title || "—"}</div><div className="text-xs text-slate-400">{s.service_category || ""}</div></td><td className="px-3 py-3">{s.provider_name || "—"}</td><td className="px-3 py-3 font-black">{s.unique_interest || s.events_count}</td><td className="px-3 py-3">{s.views}</td><td className="px-3 py-3">{s.details}</td><td className="px-3 py-3">{s.quick_requests}</td><td className="px-3 py-3 font-bold text-orange-700">{s.contact_intents}</td><td className="px-3 py-3 font-bold text-emerald-700">{s.paid_events}</td><td className="px-3 py-3 text-xs"><div>Контакты: <b>{pct(s.contact_intents, s.views || s.unique_interest)}</b></div><div>Оплата: <b>{pct(s.paid_events, s.views || s.unique_interest)}</b></div><div className="text-slate-400">{fmtDate(s.last_event_at)}</div></td><td className="px-3 py-3"><button className="rounded-lg border px-2 py-1 text-xs font-bold" onClick={() => openTimeline(s)}>Открыть</button></td></tr>)}
            {!services.length ? <tr><td className="px-3 py-10 text-center text-slate-400" colSpan="8">Нет данных</td></tr> : null}
          </tbody></table></div>
        </div>
      ) : null}

      {mode === "timeline" ? <TimelineView rows={timeline} title={timelineTitle} /> : null}

      {mode === "errors" ? <ErrorsPanel rows={errors} onTimeline={openTimeline} /> : null}
    </div>
  );
}
