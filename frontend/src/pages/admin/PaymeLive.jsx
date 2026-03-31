//frontend/src/pages/admin/PaymeLive.jsx

import { useEffect, useRef, useState } from "react";
import { apiGet } from "../../api";
import { tError } from "../../shared/toast";
import { formatTiyinToSum } from "../../utils/money";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}


function fmtTs(x) {
  if (!x) return "—";
  try {
    return new Date(x).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" });
  } catch {
    return String(x);
  }
}

function stateBadge(state) {
  const s = Number(state);
  const base = "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium";

  if (s === 2) return <span className={`${base} bg-green-100 text-green-700`}>PERFORMED</span>;
  if (s === 1) return <span className={`${base} bg-blue-100 text-blue-700`}>CREATED</span>;
  if (s === -1) return <span className={`${base} bg-yellow-100 text-yellow-800`}>CANCELED</span>;
  if (s === -2) return <span className={`${base} bg-orange-100 text-orange-800`}>REFUNDED</span>;

  return <span className={`${base} bg-gray-100 text-gray-700`}>{String(state)}</span>;
}

export default function PaymeLive() {
  const [rows, setRows] = useState([]);
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const timerRef = useRef(null);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const data = await apiGet(
        `/api/admin/payme/live?limit=${encodeURIComponent(limit)}`,
        "admin"
      );
      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } catch (e) {
      console.error(e);
      if (!silent) tError("Не удалось загрузить live Payme transactions");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    if (autoRefresh) {
      timerRef.current = setInterval(() => {
        load(true);
      }, 3000);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, limit]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow p-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-lg font-semibold">Payme Live</div>
          <div className="text-sm text-gray-500">
            Последние транзакции Payme с автообновлением каждые 3 секунды
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Limit</label>
            <input
              type="number"
              min={1}
              max={200}
              className="w-24 border rounded-lg px-3 py-2"
              value={limit}
              onChange={(e) => setLimit(toNum(e.target.value) || 50)}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto refresh (3s)
          </label>

          <button
            className="px-4 py-2 rounded-lg bg-black text-white disabled:opacity-60"
            onClick={() => load(false)}
            disabled={loading}
          >
            {loading ? "Загрузка…" : "Обновить"}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <div className="p-3 border-b flex items-center justify-between">
          <div className="text-sm text-gray-600">Live transactions</div>
          <div className="text-xs text-gray-400">rows: {rows.length}</div>
        </div>

        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-3 py-2">updated</th>
                <th className="text-left px-3 py-2">payme_id</th>
                <th className="text-left px-3 py-2">order</th>
                <th className="text-left px-3 py-2">client</th>
                <th className="text-left px-3 py-2">amount</th>
                <th className="text-left px-3 py-2">state</th>
                <th className="text-left px-3 py-2">order_status</th>
                <th className="text-left px-3 py-2">ledger_rows</th>
                <th className="text-left px-3 py-2">ledger_sum</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-gray-400" colSpan={9}>
                    Нет данных
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.payme_id} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {fmtTs(r.updated_at || (r.create_time ? Number(r.create_time) : null))}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.payme_id}</td>
                    <td className="px-3 py-2">{r.order_id}</td>
                    <td className="px-3 py-2">{r.client_id ?? "—"}</td>
                    <td className="px-3 py-2">{formatTiyinToSum(r.amount_tiyin)} сум</td>
                    <td className="px-3 py-2">{stateBadge(r.state)}</td>
                    <td className="px-3 py-2">{r.order_status || "—"}</td>
                    <td className="px-3 py-2">{r.ledger_rows}</td>
                    <td className="px-3 py-2">{formatTiyinToSum(r.ledger_sum)} сум</td>
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
