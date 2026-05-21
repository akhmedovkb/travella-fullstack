// frontend/src/pages/admin/AdminProviderSupport.jsx

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { apiGet, apiPut } from "../../api";

const STATUS_OPTIONS = [
  ["", "Все статусы"],
  ["paid", "Оплачено"],
  ["created", "Создано"],
  ["pending", "Ожидает"],
  ["expired", "Истекло"],
  ["canceled", "Отменено"],
  ["cancelled", "Отменено"],
  ["failed", "Ошибка"],
];

const STATUS_LABELS = {
  paid: "Оплачено",
  created: "Создано",
  pending: "Ожидает",
  new: "Новое",
  expired: "Истекло",
  canceled: "Отменено",
  cancelled: "Отменено",
  failed: "Ошибка",
};

const STATUS_CLASS = {
  paid: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  created: "bg-amber-50 text-amber-700 ring-amber-100",
  pending: "bg-amber-50 text-amber-700 ring-amber-100",
  new: "bg-sky-50 text-sky-700 ring-sky-100",
  expired: "bg-slate-100 text-slate-600 ring-slate-200",
  canceled: "bg-rose-50 text-rose-700 ring-rose-100",
  cancelled: "bg-rose-50 text-rose-700 ring-rose-100",
  failed: "bg-rose-50 text-rose-700 ring-rose-100",
};

const SOURCE_LABELS = {
  telegram_provider_bot: "Telegram bot",
  telegram: "Telegram",
  web: "Web",
  provider_web: "Web",
};

function formatMoney(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat("ru-RU").format(Number.isFinite(n) ? n : 0);
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function compact(value, max = 32) {
  const s = String(value || "").trim();
  if (!s) return "—";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function parseAmounts(value) {
  return String(value || "")
    .split(/[\s,;]+/)
    .map((x) => Number(String(x).replace(/\D+/g, "")))
    .filter((x) => Number.isFinite(x) && x > 0)
    .slice(0, 12);
}

function StatusBadge({ status }) {
  const key = String(status || "created").toLowerCase();
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${STATUS_CLASS[key] || "bg-slate-100 text-slate-700 ring-slate-200"}`}>
      {STATUS_LABELS[key] || key}
    </span>
  );
}

function KpiCard({ title, value, hint, tone = "slate" }) {
  const toneClass = {
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    rose: "bg-rose-50 text-rose-700 ring-rose-100",
    slate: "bg-white text-slate-800 ring-slate-200",
  }[tone];

  return (
    <div className={`rounded-2xl p-4 shadow-sm ring-1 ${toneClass}`}>
      <div className="text-xs font-black uppercase tracking-[0.14em] opacity-70">{title}</div>
      <div className="mt-2 text-2xl font-black tracking-[-0.03em]">{value}</div>
      {hint ? <div className="mt-1 text-xs font-semibold opacity-70">{hint}</div> : null}
    </div>
  );
}

export default function AdminProviderSupport() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState(null);
  const [settings, setSettings] = useState(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [limit, setLimit] = useState(100);
  const [offset, setOffset] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(true);

  const settingsForm = useMemo(() => {
    const amounts = Array.isArray(settings?.suggested_amounts)
      ? settings.suggested_amounts.join(", ")
      : "10000, 25000, 50000, 100000";

    return {
      enabled: settings?.enabled !== false,
      title: settings?.title || "❤️ Поддержка проекта",
      message:
        settings?.message ||
        "Если вы хотите поддержать развитие проекта Bot Otkaznyx Turov и Travella — можете отправить любую комфортную для вас сумму.",
      suggested_amounts: amounts,
      min_amount_sum: Number(settings?.min_amount_sum || 1000),
    };
  }, [settings]);

  const [form, setForm] = useState(settingsForm);

  useEffect(() => {
    setForm(settingsForm);
  }, [settingsForm]);

  const fetchSettings = useCallback(async () => {
    const res = await apiGet("/api/provider-support/settings", "admin");
    setSettings(res?.settings || res?.data?.settings || null);
  }, []);

  const fetchDonations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      params.set("offset", String(offset));
      if (status) params.set("status", status);
      if (q.trim()) params.set("q", q.trim());

      const res = await apiGet(`/api/provider-support/donations?${params.toString()}`, "admin");
      setRows(res?.rows || []);
      setTotals(res?.totals || null);
    } catch (e) {
      console.error(e);
      toast.error(e?.message || "Не удалось загрузить донаты поддержки");
    } finally {
      setLoading(false);
    }
  }, [limit, offset, q, status]);

  useEffect(() => {
    fetchSettings().catch((e) => {
      console.error(e);
      toast.error(e?.message || "Не удалось загрузить настройки поддержки");
    });
  }, [fetchSettings]);

  useEffect(() => {
    fetchDonations();
  }, [fetchDonations]);

  async function saveSettings() {
    const amounts = parseAmounts(form.suggested_amounts);
    if (!amounts.length) {
      toast.error("Укажите хотя бы одну рекомендованную сумму");
      return;
    }

    setSaving(true);
    try {
      const res = await apiPut(
        "/api/provider-support/settings",
        {
          enabled: !!form.enabled,
          title: form.title,
          message: form.message,
          suggested_amounts: amounts,
          min_amount_sum: Number(form.min_amount_sum || 1000),
        },
        "admin"
      );
      setSettings(res?.settings || res?.data?.settings || null);
      toast.success("Настройки поддержки сохранены");
    } catch (e) {
      console.error(e);
      toast.error(e?.message || "Не удалось сохранить настройки");
    } finally {
      setSaving(false);
    }
  }

  function submitSearch(e) {
    e.preventDefault();
    setOffset(0);
    fetchDonations();
  }

  const paidSum = Number(totals?.paid_sum || 0);
  const pendingSum = Number(totals?.pending_sum || 0);
  const failedSum = Number(totals?.failed_sum || 0);
  const totalCount = Number(totals?.count || 0);

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex rounded-full bg-orange-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-orange-600 ring-1 ring-orange-100">
              Provider support
            </div>
            <h2 className="mt-3 text-2xl font-black tracking-[-0.03em] text-slate-950">
              Поддержка проекта
            </h2>
            <p className="mt-1 max-w-3xl text-sm font-medium leading-6 text-slate-600">
              Донаты поставщиков через Payme из Telegram-бота и веба. Здесь видны оплаты, ожидания, источник и текущие настройки блока поддержки.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fetchDonations()}
              disabled={loading}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
            >
              {loading ? "Обновляем..." : "Обновить"}
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen((v) => !v)}
              className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-black"
            >
              {settingsOpen ? "Скрыть настройки" : "Настройки"}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <KpiCard title="Оплачено" value={`${formatMoney(paidSum)} UZS`} hint="успешные донаты" tone="emerald" />
        <KpiCard title="Ожидает" value={`${formatMoney(pendingSum)} UZS`} hint="создано / pending" tone="amber" />
        <KpiCard title="Неуспешно" value={`${formatMoney(failedSum)} UZS`} hint="expired / canceled / failed" tone="rose" />
        <KpiCard title="Всего записей" value={formatMoney(totalCount)} hint="с учётом фильтров" tone="slate" />
      </div>

      {settingsOpen && (
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-lg font-black text-slate-950">Настройки поддержки</h3>
              <p className="mt-1 text-sm font-medium text-slate-500">
                Эти тексты и суммы используются в сценарии поддержки проекта.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700 ring-1 ring-slate-200">
              <input
                type="checkbox"
                checked={!!form.enabled}
                onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))}
              />
              Включено
            </label>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Заголовок</span>
              <input
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
              />
            </label>

            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Рекомендованные суммы, UZS</span>
              <input
                value={form.suggested_amounts}
                onChange={(e) => setForm((p) => ({ ...p, suggested_amounts: e.target.value }))}
                placeholder="10000, 25000, 50000, 100000"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
              />
            </label>

            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Минимальная сумма, UZS</span>
              <input
                type="number"
                min="1"
                value={form.min_amount_sum}
                onChange={(e) => setForm((p) => ({ ...p, min_amount_sum: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
              />
            </label>

            <label className="block lg:row-span-2">
              <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Сообщение</span>
              <textarea
                value={form.message}
                onChange={(e) => setForm((p) => ({ ...p, message: e.target.value }))}
                rows={5}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
              />
            </label>
          </div>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={saveSettings}
              disabled={saving}
              className="rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-orange-700 disabled:opacity-60"
            >
              {saving ? "Сохраняем..." : "Сохранить настройки"}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <form onSubmit={submitSearch} className="flex flex-1 flex-col gap-2 md:flex-row md:items-center">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск: поставщик / телефон / telegram / Payme order / donation ID"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100 md:max-w-xl"
            />
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setOffset(0);
              }}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
            >
              {STATUS_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <button type="submit" className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-black">
              Найти
            </button>
          </form>

          <select
            value={limit}
            onChange={(e) => {
              setLimit(Number(e.target.value));
              setOffset(0);
            }}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
          >
            <option value={50}>50 строк</option>
            <option value={100}>100 строк</option>
            <option value={200}>200 строк</option>
            <option value={500}>500 строк</option>
          </select>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Поставщик</th>
                  <th className="px-4 py-3">Сумма</th>
                  <th className="px-4 py-3">Статус</th>
                  <th className="px-4 py-3">Источник</th>
                  <th className="px-4 py-3">Payme</th>
                  <th className="px-4 py-3">Создан</th>
                  <th className="px-4 py-3">Оплачен</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {loading && rows.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-sm font-semibold text-slate-500">Загрузка...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-sm font-semibold text-slate-500">Донаты поддержки не найдены</td></tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="align-top transition hover:bg-orange-50/40">
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">#{row.id}</td>
                      <td className="px-4 py-3">
                        <div className="font-black text-slate-900">{row.provider_name || "—"}</div>
                        <div className="mt-0.5 text-xs font-semibold text-slate-500">
                          provider: {row.provider_id || "—"} · tg: {compact(row.telegram_chat_id, 18)}
                        </div>
                        {row.provider_phone ? <div className="mt-0.5 text-xs text-slate-500">{row.provider_phone}</div> : null}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-black text-slate-950">{formatMoney(row.amount_sum)} UZS</td>
                      <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                      <td className="px-4 py-3 text-sm font-semibold text-slate-700">{SOURCE_LABELS[row.source] || row.source || "—"}</td>
                      <td className="px-4 py-3">
                        <div className="font-mono text-xs text-slate-700">order: {row.payme_order_id || "—"}</div>
                        <div className="mt-0.5 font-mono text-xs text-slate-400" title={row.payme_id || ""}>payme: {compact(row.payme_id, 22)}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs font-semibold text-slate-600">{formatDate(row.created_at)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs font-semibold text-slate-600">{formatDate(row.paid_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs font-semibold text-slate-500">
            Показано {rows.length} · offset {offset}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={offset <= 0 || loading}
              onClick={() => setOffset((x) => Math.max(0, x - limit))}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Назад
            </button>
            <button
              type="button"
              disabled={rows.length < limit || loading}
              onClick={() => setOffset((x) => x + limit)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Дальше
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
