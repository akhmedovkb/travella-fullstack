//frontend/src/pages/admin/AdminUnlockFunnel.jsx

import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../api";
import { tError } from "../../shared/toast";

function fmtTs(x) {
  if (!x) return "—";
  try {
    return new Date(x).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" });
  } catch {
    return String(x);
  }
}

function money(n) {
  return Math.round(Number(n || 0)).toLocaleString("ru-RU");
}

function SegmentBadge({ segment }) {
  const s = String(segment || "").toLowerCase();

  const cls =
    s === "hot_no_balance"
      ? "bg-red-100 text-red-700"
      : s === "hot_topup_created"
      ? "bg-orange-100 text-orange-800"
      : s === "warm_clicked"
      ? "bg-yellow-100 text-yellow-800"
      : s === "closed"
      ? "bg-green-100 text-green-700"
      : "bg-gray-100 text-gray-700";

  const label =
    s === "hot_no_balance"
      ? "NO BALANCE"
      : s === "hot_topup_created"
      ? "TOPUP STARTED"
      : s === "warm_clicked"
      ? "CLICKED"
      : s === "closed"
      ? "CLOSED"
      : "OTHER";

  return (
    <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function StatCard({ title, value, tone = "default" }) {
  const toneCls =
    tone === "red"
      ? "text-red-600"
      : tone === "orange"
      ? "text-orange-600"
      : tone === "yellow"
      ? "text-yellow-700"
      : tone === "green"
      ? "text-green-700"
      : "text-gray-900";

  return (
    <div className="bg-white rounded-xl shadow p-4">
      <div className="text-sm text-gray-500">{title}</div>
      <div className={`mt-2 text-2xl font-semibold ${toneCls}`}>{value}</div>
    </div>
  );
}

export default function AdminUnlockFunnel() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  const [source, setSource] = useState("");
  const [segment, setSegment] = useState("");
  const [limit, setLimit] = useState(100);

  async function load() {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      p.set("limit", String(limit || 100));
      if (source) p.set("source", source);
      if (segment) p.set("segment", segment);

      const data = await apiGet(`/api/admin/unlock-funnel?${p.toString()}`, "admin");
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setSummary(data?.summary || null);
    } catch (e) {
      console.error(e);
      tError("Не удалось загрузить Unlock Funnel");
      setRows([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openRows = useMemo(
    () => rows.filter((r) => String(r.segment || "") !== "closed"),
    [rows]
  );

  function openClientBalance(clientId) {
    if (!clientId) return;
    window.open(`/admin/contact-balance?client_id=${encodeURIComponent(clientId)}`, "_blank");
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-lg font-semibold">Unlock Funnel</div>
            <div className="text-sm text-gray-500">
              Кого можно дожимать: нет баланса, начал пополнение, кликнул и пропал.
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Source</label>
              <select
                className="border rounded-lg px-3 py-2"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="">All</option>
                <option value="web">web</option>
                <option value="bot">bot</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Segment</label>
              <select
                className="border rounded-lg px-3 py-2"
                value={segment}
                onChange={(e) => setSegment(e.target.value)}
              >
                <option value="">All</option>
                <option value="hot_no_balance">No balance</option>
                <option value="hot_topup_created">Topup started</option>
                <option value="warm_clicked">Clicked only</option>
                <option value="other_open">Other open</option>
                <option value="closed">Closed</option>
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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          <StatCard title="No balance" value={summary.hot_no_balance || 0} tone="red" />
          <StatCard title="Topup started" value={summary.hot_topup_created || 0} tone="orange" />
          <StatCard title="Clicked only" value={summary.warm_clicked || 0} tone="yellow" />
          <StatCard title="Other open" value={summary.other_open || 0} />
          <StatCard title="Open leads total" value={openRows.length} tone="green" />
        </div>
      )}

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="font-medium">Leads for follow-up</div>
          <div className="text-sm text-gray-500">rows: {rows.length}</div>
        </div>

        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-3 py-2">Segment</th>
                <th className="text-left px-3 py-2">Client</th>
                <th className="text-left px-3 py-2">Phone</th>
                <th className="text-left px-3 py-2">Service</th>
                <th className="text-left px-3 py-2">Last step</th>
                <th className="text-left px-3 py-2">Source</th>
                <th className="text-left px-3 py-2">Attempts</th>
                <th className="text-left px-3 py-2">Balance</th>
                <th className="text-left px-3 py-2">Last seen</th>
                <th className="text-right px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-gray-400" colSpan={10}>
                    Нет данных
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={`${r.client_id}-${r.service_id}`} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <SegmentBadge segment={r.segment} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.client_name || `Client #${r.client_id}`}</div>
                      <div className="text-xs text-gray-400">ID: {r.client_id}</div>
                    </td>
                    <td className="px-3 py-2">{r.client_phone || "—"}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.service_title || `Service #${r.service_id}`}</div>
                      <div className="text-xs text-gray-400">
                        {r.service_category || "—"} · #{r.service_id}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div>{r.step || "—"}</div>
                      <div className="text-xs text-gray-400">{r.status || "—"}</div>
                    </td>
                    <td className="px-3 py-2">{r.source || "—"}</td>
                    <td className="px-3 py-2">{r.attempts_count || 0}</td>
                    <td className="px-3 py-2">
                      <div className="text-xs text-gray-500">
                        {money(r.balance_before)} → {money(r.balance_after)}
                      </div>
                      <div className="text-xs text-gray-400">
                        price: {money(r.price_tiyin)}
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtTs(r.last_seen_at)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => openClientBalance(r.client_id)}
                        className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
                      >
                        Открыть клиента
                      </button>
                    </td>
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
