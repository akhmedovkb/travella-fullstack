// frontend/src/pages/admin/AdminProviderSupport.jsx
import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPut } from "../../api";
import { tError, tSuccess } from "../../shared/toast";

function money(x) {
  return `${Math.round(Number(x || 0)).toLocaleString("ru-RU")} сум`;
}

function fmt(x) {
  if (!x) return "—";
  try {
    return new Date(x).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" });
  } catch {
    return String(x);
  }
}

function badge(status) {
  const s = String(status || "").toLowerCase();
  if (s === "paid") return "bg-green-100 text-green-700";
  if (s === "created" || s === "new") return "bg-yellow-100 text-yellow-700";
  if (s === "cancelled") return "bg-red-100 text-red-700";
  return "bg-gray-100 text-gray-700";
}

export default function AdminProviderSupport() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({ paid_sum: 0, pending_sum: 0, count: 0 });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [limit, setLimit] = useState("100");
  const [settings, setSettings] = useState({
    enabled: true,
    title: "❤️ Поддержка проекта",
    message: "Если вы хотите поддержать развитие проекта Bot Otkaznyx Turov и Travella — можете отправить любую комфортную для вас сумму.",
    suggested_amounts: [10000, 25000, 50000, 100000],
    min_amount_sum: 1000,
  });

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", limit || "100");
    if (q.trim()) p.set("q", q.trim());
    if (status) p.set("status", status);
    return p.toString();
  }, [q, status, limit]);

  async function load() {
    setLoading(true);
    try {
      const [settingsRes, donationsRes] = await Promise.all([
        apiGet("/api/admin/provider-support/settings", "admin"),
        apiGet(`/api/admin/provider-support/donations?${query}`, "admin"),
      ]);
      if (settingsRes?.settings) setSettings(settingsRes.settings);
      setRows(Array.isArray(donationsRes?.rows) ? donationsRes.rows : []);
      setTotals(donationsRes?.totals || { paid_sum: 0, pending_sum: 0, count: 0 });
    } catch (e) {
      console.error(e);
      tError("Не удалось загрузить поддержку проекта");
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    setSaving(true);
    try {
      const res = await apiPut("/api/admin/provider-support/settings", settings, "admin");
      if (res?.settings) setSettings(res.settings);
      tSuccess("Настройки поддержки сохранены");
    } catch (e) {
      console.error(e);
      tError("Не удалось сохранить настройки");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const amountsText = Array.isArray(settings.suggested_amounts)
    ? settings.suggested_amounts.join(", ")
    : String(settings.suggested_amounts || "");

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs text-gray-500">Оплачено</div>
          <div className="mt-1 text-2xl font-bold text-green-700">{money(totals.paid_sum)}</div>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs text-gray-500">Ожидает оплаты</div>
          <div className="mt-1 text-2xl font-bold text-yellow-700">{money(totals.pending_sum)}</div>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs text-gray-500">Всего записей</div>
          <div className="mt-1 text-2xl font-bold">{Number(totals.count || 0)}</div>
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Provider Support / Donations</h2>
            <p className="text-sm text-gray-500">Настройки шага после proof screenshots в Telegram-боте.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!settings.enabled}
              onChange={(e) => setSettings((x) => ({ ...x, enabled: e.target.checked }))}
            />
            Включено
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <div className="text-xs text-gray-500">Заголовок</div>
            <input
              className="w-full rounded-xl border px-3 py-2"
              value={settings.title || ""}
              onChange={(e) => setSettings((x) => ({ ...x, title: e.target.value }))}
            />
          </label>
          <label className="space-y-1">
            <div className="text-xs text-gray-500">Суммы через запятую</div>
            <input
              className="w-full rounded-xl border px-3 py-2"
              value={amountsText}
              onChange={(e) => setSettings((x) => ({ ...x, suggested_amounts: e.target.value }))}
              placeholder="10000, 25000, 50000, 100000"
            />
          </label>
        </div>

        <label className="block space-y-1">
          <div className="text-xs text-gray-500">Текст в боте</div>
          <textarea
            className="min-h-[96px] w-full rounded-xl border px-3 py-2"
            value={settings.message || ""}
            onChange={(e) => setSettings((x) => ({ ...x, message: e.target.value }))}
          />
        </label>

        <div className="flex items-center gap-3">
          <label className="space-y-1">
            <div className="text-xs text-gray-500">Минимальная сумма</div>
            <input
              type="number"
              className="w-44 rounded-xl border px-3 py-2"
              value={settings.min_amount_sum || 1000}
              onChange={(e) => setSettings((x) => ({ ...x, min_amount_sum: e.target.value }))}
            />
          </label>
          <button
            className="mt-5 rounded-xl bg-black px-4 py-2 text-white disabled:opacity-50"
            disabled={saving}
            onClick={saveSettings}
          >
            {saving ? "Saving..." : "Save settings"}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <h3 className="font-semibold">Платежи поддержки</h3>
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <input
              className="rounded-xl border px-3 py-2 md:w-80"
              placeholder="Поиск: provider, phone, order, Payme ID..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select className="rounded-xl border px-3 py-2" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="paid">paid</option>
              <option value="new">new</option>
              <option value="created">created</option>
              <option value="cancelled">cancelled</option>
            </select>
            <input
              type="number"
              className="w-24 rounded-xl border px-3 py-2"
              value={limit}
              onChange={(e) => setLimit(e.target.value || "100")}
            />
            <button className="rounded-xl border px-3 py-2" disabled={loading} onClick={load}>
              {loading ? "Loading..." : "Reload"}
            </button>
          </div>
        </div>

        <div className="overflow-auto rounded-xl border">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Provider</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Service</th>
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">Payme ID</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Paid</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td className="px-3 py-8 text-center text-gray-500" colSpan={9}>No support payments</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium">#{r.id}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.provider_name || "—"}</div>
                    <div className="text-xs text-gray-500">{r.provider_phone || r.telegram_chat_id || "—"}</div>
                  </td>
                  <td className="px-3 py-2 font-semibold">{money(r.amount_sum)}</td>
                  <td className="px-3 py-2"><span className={`rounded px-2 py-1 text-xs ${badge(r.status)}`}>{r.status}</span></td>
                  <td className="px-3 py-2">{r.service_id ? `#${r.service_id}` : "—"}</td>
                  <td className="px-3 py-2">{r.payme_order_id || "—"}</td>
                  <td className="px-3 py-2 max-w-[220px] truncate">{r.payme_id || "—"}</td>
                  <td className="px-3 py-2">{fmt(r.created_at)}</td>
                  <td className="px-3 py-2">{fmt(r.paid_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
