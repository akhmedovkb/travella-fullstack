// frontend/src/pages/admin/AdminUnlockNudgeAnalytics.jsx

import { useEffect, useState } from "react";
import { apiGet } from "../../api";
import { tError } from "../../shared/toast";
import { formatTiyinToSumWithCurrency } from "../../utils/money";

function fmtTs(x) {
  if (!x) return "—";
  try {
    return new Date(x).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" });
  } catch {
    return String(x);
  }
}

function StatCard({ title, value, tone = "default", hint = "" }) {
  const toneCls =
    tone === "red"
      ? "text-red-600"
      : tone === "orange"
      ? "text-orange-600"
      : tone === "yellow"
      ? "text-yellow-700"
      : tone === "green"
      ? "text-green-700"
      : tone === "blue"
      ? "text-blue-700"
      : "text-gray-900";

  return (
    <div className="bg-white rounded-xl shadow p-4">
      <div className="text-sm text-gray-500">{title}</div>
      <div className={`mt-2 text-2xl font-semibold ${toneCls}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-gray-400">{hint}</div> : null}
    </div>
  );
}

function StatusBadge({ status }) {
  const s = String(status || "").toLowerCase();

  const cls =
    s === "opened_after_first"
      ? "bg-green-100 text-green-700"
      : s === "opened_after_second"
      ? "bg-blue-100 text-blue-700"
      : s === "still_not_opened"
      ? "bg-red-100 text-red-700"
      : "bg-gray-100 text-gray-700";

  const label =
    s === "opened_after_first"
      ? "OPENED AFTER 1ST"
      : s === "opened_after_second"
      ? "OPENED AFTER 2ND"
      : s === "still_not_opened"
      ? "STILL NOT OPENED"
      : "OPENED WITHOUT NUDGE";

  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

export default function AdminUnlockNudgeAnalytics() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  const [status, setStatus] = useState("");
  const [limit, setLimit] = useState(100);

  async function load() {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      p.set("limit", String(limit || 100));
      if (status) p.set("status", status);

      const data = await apiGet(
        `/api/admin/unlock-nudge/analytics?${p.toString()}`,
        "admin"
      );

      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setSummary(data?.summary || null);
    } catch (e) {
      console.error(e);
      tError("Не удалось загрузить Nudge Analytics");
      setRows([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-lg font-semibold">Unlock Nudge Analytics</div>
            <div className="text-sm text-gray-500">
              Аналитика по оплате, дожиму через 1-й и 2-й nudge и итоговому
              открытию контактов.
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Status</label>
              <select
                className="border rounded-lg px-3 py-2"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">All</option>
                <option value="still_not_opened">still_not_opened</option>
                <option value="opened_after_first">opened_after_first</option>
                <option value="opened_after_second">opened_after_second</option>
                <option value="opened_without_nudge">opened_without_nudge</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Limit</label>
              <input
                type="number"
                min={1}
                max={500}
                className="w-24 border rounded-lg px-3 py-2"
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value) || 100)}
              />
            </div>

            <button
              className="px-4 py-2 rounded-lg bg-black text-white disabled:opacity-60"
              onClick={load}
              disabled={loading}
            >
              {loading ? "Загрузка…" : "Обновить"}
            </button>
          </div>
        </div>
      </div>

      {summary && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
            <StatCard
              title="Оплатили, но не открыли"
              value={summary.paid_not_opened_count || 0}
              tone="red"
            />
            <StatCard
              title="Получили 1-й nudge"
              value={summary.got_first_nudge_count || 0}
              tone="orange"
            />
            <StatCard
              title="Открыли после 1-го"
              value={summary.opened_after_first_count || 0}
              tone="green"
            />
            <StatCard
              title="Открыли после 2-го"
              value={summary.opened_after_second_count || 0}
              tone="blue"
            />
            <StatCard
              title="Всего кейсов"
              value={summary.total_cases || 0}
              tone="default"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard
              title="Зависло"
              value={formatTiyinToSumWithCurrency(summary.stuck_tiyin)}
              tone="red"
              hint="Оплатили, но контакты ещё не открыты"
            />
            <StatCard
              title="Дожато"
              value={formatTiyinToSumWithCurrency(summary.squeezed_tiyin)}
              tone="green"
              hint="Открыли после 1-го или 2-го nudge"
            />
            <StatCard
              title="Ещё в риске"
              value={formatTiyinToSumWithCurrency(summary.risk_tiyin)}
              tone="orange"
              hint="Уже nudged, но всё ещё не открыли"
            />
          </div>
        </>
      )}

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="font-medium">Nudge cases</div>
          <div className="text-sm text-gray-500">rows: {rows.length}</div>
        </div>

        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-3 py-2">Client</th>
                <th className="text-left px-3 py-2">Service</th>
                <th className="text-left px-3 py-2">Step</th>
                <th className="text-left px-3 py-2">Nudge count</th>
                <th className="text-left px-3 py-2">Last nudge kind</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Amount</th>
                <th className="text-left px-3 py-2">Payment</th>
                <th className="text-left px-3 py-2">1st nudge</th>
                <th className="text-left px-3 py-2">2nd nudge</th>
                <th className="text-left px-3 py-2">Unlock</th>
              </tr>
            </thead>

            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    className="px-3 py-6 text-center text-gray-400"
                    colSpan={11}
                  >
                    Нет данных
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={`${r.client_id}-${r.service_id}-${r.payment_success_at || ""}`}
                    className="border-t hover:bg-gray-50"
                  >
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium">
                        {r.client_name || `Client #${r.client_id}`}
                      </div>
                      <div className="text-xs text-gray-400">
                        client_id: {r.client_id}
                      </div>
                      <div className="text-xs text-gray-400">
                        {r.client_phone || "—"}
                      </div>
                    </td>

                    <td className="px-3 py-2 align-top">
                      <div className="font-medium">
                        {r.service_title || `Service #${r.service_id}`}
                      </div>
                      <div className="text-xs text-gray-400">
                        service_id: {r.service_id} ·{" "}
                        {r.service_category || "—"}
                      </div>
                    </td>

                    <td className="px-3 py-2 align-top">{r.step || "—"}</td>
                    <td className="px-3 py-2 align-top">{r.nudge_count || 0}</td>
                    <td className="px-3 py-2 align-top">
                      {r.last_nudge_kind || "—"}
                    </td>

                    <td className="px-3 py-2 align-top">
                      <StatusBadge status={r.status} />
                    </td>

                    <td className="px-3 py-2 align-top">
                      {formatTiyinToSumWithCurrency(r.price_tiyin)}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {fmtTs(r.payment_success_at)}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {fmtTs(r.first_nudge_sent_at)}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {fmtTs(r.second_nudge_sent_at)}
                    </td>
                    <td className="px-3 py-2 align-top">{fmtTs(r.unlock_at)}</td>
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
