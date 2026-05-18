// frontend/src/pages/admin/AdminServiceAudit.jsx

import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../api";
import { tError } from "../../shared/toast";

function fmtDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" });
  } catch {
    return String(value);
  }
}

function actionLabel(action) {
  const map = {
    service_created: "Создание",
    service_updated: "Редактирование",
    service_status_reset_to_draft: "Снял с публикации редактированием",
    service_submitted: "Отправил на модерацию",
    service_deleted: "Удалил в корзину",
    service_restored: "Восстановил",
    provider_service_deleted: "Удалил услугу",
    provider_service_restored: "Восстановил услугу",
    provider_service_purged: "Удалил навсегда",
  };
  return map[action] || action || "—";
}

function actionTone(action) {
  const s = String(action || "");
  if (s.includes("deleted") || s.includes("purged")) return "bg-rose-50 text-rose-700 ring-rose-100";
  if (s.includes("restored")) return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  if (s.includes("submitted")) return "bg-blue-50 text-blue-700 ring-blue-100";
  if (s.includes("reset")) return "bg-orange-50 text-orange-700 ring-orange-100";
  return "bg-slate-100 text-slate-700 ring-slate-200";
}

function statusLabel(status) {
  const map = {
    draft: "Черновик",
    pending: "На модерации",
    published: "Опубликовано",
    approved: "Одобрено",
    rejected: "Отклонено",
    archived: "Архив",
    deleted: "В корзине",
  };
  return map[String(status || "").toLowerCase()] || status || "—";
}

function getProviderName(row) {
  return row.provider_company_name || row.provider_name || row.provider_phone || row.provider_email || `Provider #${row.provider_id || "—"}`;
}

function shortJson(value) {
  if (!value) return "—";
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > 1400 ? `${text.slice(0, 1400)}\n…` : text;
  } catch {
    return String(value);
  }
}

export default function AdminServiceAudit() {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({});
  const [actions, setActions] = useState([]);
  const [selected, setSelected] = useState(null);

  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [category, setCategory] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [limit, setLimit] = useState("100");

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", limit || "100");
    if (q.trim()) p.set("q", q.trim());
    if (action) p.set("action", action);
    if (category) p.set("category", category);
    if (serviceId.trim()) p.set("service_id", serviceId.trim());
    if (providerId.trim()) p.set("provider_id", providerId.trim());
    return p.toString();
  }, [q, action, category, serviceId, providerId, limit]);

  async function load() {
    setLoading(true);
    try {
      const res = await apiGet(`/api/admin/service-audit?${query}`, "admin");
      setRows(Array.isArray(res.rows) ? res.rows : []);
      setTotal(Number(res.total || 0));
      setSummary(res.summary || {});
      setActions(Array.isArray(res.actions) ? res.actions : []);
    } catch (err) {
      console.error(err);
      tError("Не удалось загрузить журнал действий поставщиков");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex rounded-full bg-orange-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-orange-600 ring-1 ring-orange-100">
              Travella control
            </div>
            <h1 className="mt-3 text-2xl font-black tracking-[-0.03em] text-slate-950">
              Журнал действий поставщиков
            </h1>
            <p className="mt-1 max-w-3xl text-sm font-medium leading-6 text-slate-600">
              Здесь видно, кто создал, изменил, снял с публикации, удалил или восстановил объявление. Это защита от манипуляций с отказными услугами.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Загрузка…" : "Обновить"}
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs font-bold uppercase text-slate-400">Всего</div>
          <div className="mt-1 text-2xl font-black">{Number(summary.total || total || 0)}</div>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs font-bold uppercase text-rose-400">Удаления</div>
          <div className="mt-1 text-2xl font-black text-rose-700">{Number(summary.deleted_count || 0)}</div>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs font-bold uppercase text-emerald-400">Восстановления</div>
          <div className="mt-1 text-2xl font-black text-emerald-700">{Number(summary.restored_count || 0)}</div>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs font-bold uppercase text-blue-400">Модерация</div>
          <div className="mt-1 text-2xl font-black text-blue-700">{Number(summary.submitted_count || 0)}</div>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs font-bold uppercase text-orange-400">Редактирования</div>
          <div className="mt-1 text-2xl font-black text-orange-700">{Number(summary.updated_count || 0)}</div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_220px_200px_170px_170px_120px]">
          <input
            className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-orange-400 focus:ring-4 focus:ring-orange-100"
            placeholder="Поиск: #ID, поставщик, телефон, название, категория..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">Все действия</option>
            {actions.map((x) => (
              <option key={x.action} value={x.action}>{actionLabel(x.action)} ({x.count})</option>
            ))}
          </select>
          <select className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Все категории</option>
            <option value="refused_tour">Отказной тур</option>
            <option value="refused_hotel">Отказной отель</option>
            <option value="refused_flight">Отказной авиабилет</option>
            <option value="refused_event_ticket">Отказной билет</option>
            <option value="author_tour">Авторский тур</option>
            <option value="visa_support">Виза</option>
          </select>
          <input
            className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold"
            placeholder="Service ID"
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value.replace(/\D/g, ""))}
          />
          <input
            className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold"
            placeholder="Provider ID"
            value={providerId}
            onChange={(e) => setProviderId(e.target.value.replace(/\D/g, ""))}
          />
          <select className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold" value={limit} onChange={(e) => setLimit(e.target.value)}>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="200">200</option>
            <option value="500">500</option>
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-500">
          Найдено: {total}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Дата</th>
                <th className="px-4 py-3">Действие</th>
                <th className="px-4 py-3">Услуга</th>
                <th className="px-4 py-3">Поставщик</th>
                <th className="px-4 py-3">Статус</th>
                <th className="px-4 py-3">Источник</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm font-semibold text-slate-400">
                    {loading ? "Загрузка…" : "Записей пока нет"}
                  </td>
                </tr>
              ) : rows.map((row) => (
                <tr key={row.id} className="hover:bg-orange-50/40">
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-600">{fmtDate(row.created_at)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-black ring-1 ${actionTone(row.action)}`}>
                      {actionLabel(row.action)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-black text-slate-900">#R{row.service_id || "—"}</div>
                    <div className="max-w-[360px] truncate text-xs font-semibold text-slate-500">{row.title || "—"}</div>
                    <div className="mt-1 text-[11px] font-black uppercase text-orange-600">{row.category || "—"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-bold text-slate-800">{getProviderName(row)}</div>
                    <div className="text-xs text-slate-500">ID: {row.provider_id || "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold text-slate-600">
                    {statusLabel(row.old_status)} → <span className="font-black text-slate-950">{statusLabel(row.new_status)}</span>
                  </td>
                  <td className="px-4 py-3 text-xs font-bold text-slate-500">{row.source || "web"}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setSelected(row)}
                      className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50"
                    >
                      Детали
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <div className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-orange-50 via-white to-orange-50 p-5">
              <div>
                <div className="inline-flex rounded-full bg-orange-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-orange-600 ring-1 ring-orange-100">
                  Audit log #{selected.id}
                </div>
                <h2 className="mt-3 text-xl font-black text-slate-950">
                  {actionLabel(selected.action)} · #R{selected.service_id}
                </h2>
                <p className="mt-1 text-sm font-semibold text-slate-500">{fmtDate(selected.created_at)} · {getProviderName(selected)}</p>
              </div>
              <button className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-black" onClick={() => setSelected(null)}>Закрыть</button>
            </div>
            <div className="grid max-h-[72vh] gap-4 overflow-auto p-5 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-black uppercase text-slate-500">До</h3>
                <pre className="max-h-[520px] overflow-auto rounded-2xl bg-slate-950 p-4 text-xs leading-5 text-slate-100">{shortJson(selected.old_snapshot)}</pre>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-black uppercase text-slate-500">После</h3>
                <pre className="max-h-[520px] overflow-auto rounded-2xl bg-slate-950 p-4 text-xs leading-5 text-slate-100">{shortJson(selected.new_snapshot)}</pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminServiceAudit({
 embedded=false
})
