// frontend/src/pages/admin/AdminProviderFunnel.jsx
import React from "react";

function getAdminToken() {
  return (
    localStorage.getItem("token") ||
    localStorage.getItem("adminToken") ||
    localStorage.getItem("providerToken") ||
    sessionStorage.getItem("token") ||
    ""
  );
}

async function apiGet(path) {
  const token = getAdminToken();
  const res = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || data?.message || res.statusText || `HTTP ${res.status}`);
  }

  return data;
}

function fmtDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("ru-RU");
}

function StatCard({ title, value, hint }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</div>
      <div className="mt-2 text-3xl font-black tracking-tight text-slate-950">{Number(value || 0).toLocaleString("ru-RU")}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

function EventBadge({ name }) {
  const map = {
    wizard_started: "Создание начато",
    wizard_step: "Шаг мастера",
    wizard_saved_draft: "Черновик",
    proof_uploaded: "Proof",
    submitted_to_moderation: "На модерации",
    approved: "Одобрено",
    rejected: "Отклонено",
    published: "Опубликовано",
    archived: "Архив",
    deleted: "Удалено",
  };
  return (
    <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-700">
      {map[name] || name || "—"}
    </span>
  );
}

export default function AdminProviderFunnel({ embedded = false }) {
  const [days, setDays] = React.useState(7);
  const [summary, setSummary] = React.useState(null);
  const [events, setEvents] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [s, e] = await Promise.all([
        apiGet(`/api/admin/provider-funnel/summary?days=${days}`),
        apiGet(`/api/admin/provider-funnel/events?days=${days}&limit=150`),
      ]);
      setSummary(s);
      setEvents(e.events || []);
    } catch (err) {
      setError(err?.message || "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [days]);

  React.useEffect(() => {
    load();
  }, [load]);

  const totals = summary?.totals || {};
  const byStep = summary?.by_step || [];
  const byCategory = summary?.by_category || [];

  return (
    <div className={embedded ? "space-y-5" : "p-4 md:p-6 space-y-5"}>
      {!embedded && (
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-950">Воронка поставщиков</h1>
          <p className="mt-1 text-sm text-slate-600">Где поставщики начинают создание услуг, где бросают и сколько доходит до модерации.</p>
        </div>
      )}

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-black text-slate-950">Период анализа</div>
            <div className="text-xs text-slate-500">События из Telegram, web и backend lifecycle.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {[1, 7, 14, 30, 90].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`rounded-xl px-3 py-2 text-sm font-bold ${
                  days === d ? "bg-black text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {d} дн.
              </button>
            ))}
            <button
              type="button"
              onClick={load}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Обновить
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">Загрузка...</div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard title="Начали создание" value={totals.wizard_started} hint="wizard_started" />
        <StatCard title="Proof загружен" value={totals.proof_uploaded} hint="proof_uploaded" />
        <StatCard title="На модерации" value={totals.submitted_to_moderation} hint="submitted_to_moderation" />
        <StatCard title="Одобрено" value={totals.approved} hint="approved" />
        <StatCard title="Отклонено" value={totals.rejected} hint="rejected" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-black text-slate-950">Где чаще всего находятся поставщики</h2>
          <div className="mt-3 space-y-2">
            {byStep.length ? byStep.slice(0, 12).map((row) => (
              <div key={row.step} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
                <span className="min-w-0 truncate text-sm font-medium text-slate-700">{row.step}</span>
                <span className="text-sm font-black text-slate-950">{Number(row.count || 0).toLocaleString("ru-RU")}</span>
              </div>
            )) : (
              <div className="text-sm text-slate-500">Пока нет данных по шагам.</div>
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-black text-slate-950">Категории</h2>
          <div className="mt-3 space-y-2">
            {byCategory.length ? byCategory.slice(0, 12).map((row) => (
              <div key={row.category} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
                <span className="min-w-0 truncate text-sm font-medium text-slate-700">{row.category}</span>
                <span className="text-sm font-black text-slate-950">{Number(row.count || 0).toLocaleString("ru-RU")}</span>
              </div>
            )) : (
              <div className="text-sm text-slate-500">Пока нет данных по категориям.</div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-4">
          <h2 className="text-base font-black text-slate-950">Последние события</h2>
          <p className="text-xs text-slate-500">Здесь видно, кто начал создание, на каком шаге остановился и дошёл ли до модерации.</p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Время</th>
                <th className="px-4 py-3">Событие</th>
                <th className="px-4 py-3">Поставщик</th>
                <th className="px-4 py-3">Услуга</th>
                <th className="px-4 py-3">Категория</th>
                <th className="px-4 py-3">Шаг</th>
                <th className="px-4 py-3">Источник</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {events.length ? events.map((e) => (
                <tr key={e.id} className="align-top hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{fmtDate(e.created_at)}</td>
                  <td className="px-4 py-3"><EventBadge name={e.event_name} /></td>
                  <td className="px-4 py-3 text-slate-700">{e.provider_label || (e.provider_id ? `Provider #${e.provider_id}` : "—")}</td>
                  <td className="px-4 py-3 text-slate-700">{e.service_label || (e.service_id ? `#${e.service_id}` : "—")}</td>
                  <td className="px-4 py-3 text-slate-700">{e.category || "—"}</td>
                  <td className="px-4 py-3 text-slate-700">{e.step || "—"}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{e.source || "—"}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                    Событий пока нет. Данные появятся после создания/редактирования услуг в Telegram или web.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
