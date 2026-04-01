//frontend/src/pages/admin/PaymePayments.jsx

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiGet } from "../../api";
import { tError } from "../../shared/toast";

function normalizeStateValue(v) {
  const s = String(v ?? "").trim().toUpperCase();

  if (s === "PERFORMED" || s === "2") return "2";
  if (s === "CREATED" || s === "1") return "1";
  if (s === "CANCELED" || s === "-1") return "-1";
  if (s === "REFUNDED" || s === "-2") return "-2";

  return "";
}

function stateLabel(v) {
  const s = String(v ?? "");
  if (s === "2") return "SUCCESS";
  if (s === "1") return "CREATED";
  if (s === "-1") return "CANCELED";
  if (s === "-2") return "REFUND";
  return s || "—";
}

function stateBadgeClass(v) {
  const s = String(v ?? "");
  if (s === "2") return "bg-green-100 text-green-700";
  if (s === "1") return "bg-yellow-100 text-yellow-700";
  if (s === "-1") return "bg-orange-100 text-orange-700";
  if (s === "-2") return "bg-red-100 text-red-700";
  return "bg-gray-100 text-gray-700";
}

function fmtTs(x) {
  if (!x) return "—";
  try {
    return new Date(x).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" });
  } catch {
    return String(x);
  }
}

function money(x) {
  return `${Math.round(Number(x || 0)).toLocaleString("ru-RU")} сум`;
}

export default function PaymePayments() {
  const [searchParams, setSearchParams] = useSearchParams();

  const initialQ = searchParams.get("q") || "";
  const initialState = normalizeStateValue(searchParams.get("state"));
  const initialLimit = searchParams.get("limit") || "200";

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const [q, setQ] = useState(initialQ);
  const [state, setState] = useState(initialState);
  const [limit, setLimit] = useState(initialLimit);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", String(limit || "200"));
    if (q.trim()) p.set("q", q.trim());
    if (state) p.set("state", state);
    return p.toString();
  }, [q, state, limit]);

  async function load() {
    setLoading(true);
    try {
      const data = await apiGet(`/api/admin/payme/payments?${query}`, "admin");
      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } catch (e) {
      console.error(e);
      setRows([]);
      tError("Не удалось загрузить Payme Payments");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const p = new URLSearchParams(searchParams);

    p.set("tab", "payments");

    if (q.trim()) p.set("q", q.trim());
    else p.delete("q");

    if (state) p.set("state", state);
    else p.delete("state");

    if (limit && String(limit) !== "200") p.set("limit", String(limit));
    else p.delete("limit");

    setSearchParams(p, { replace: true });
  }, [q, state, limit, searchParams, setSearchParams]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Payme Payments</h2>
          <div className="text-sm opacity-70">
            Кто, когда, сколько оплатил — уже в бизнес-формате, не RPC-лог.
          </div>
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <input
            className="border rounded px-3 py-2 w-full md:w-72"
            placeholder="Search: payme_id / order_id / client / phone..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <select
            className="border rounded px-3 py-2"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            <option value="">All states</option>
            <option value="2">SUCCESS</option>
            <option value="1">CREATED</option>
            <option value="-1">CANCELED</option>
            <option value="-2">REFUND</option>
          </select>

          <input
            type="number"
            min="1"
            max="1000"
            className="border rounded px-3 py-2 w-full md:w-28"
            value={limit}
            onChange={(e) => setLimit(e.target.value || "200")}
            placeholder="Limit"
          />

          <button
            className="border rounded px-3 py-2"
            onClick={load}
            disabled={loading}
          >
            {loading ? "Loading..." : "Reload"}
          </button>
        </div>
      </div>

      <div className="border rounded-xl overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2">Client ID</th>
              <th className="px-3 py-2 text-left">Client</th>
              <th className="px-3 py-2 text-left">Phone</th>
              <th className="px-3 py-2 text-left">Amount</th>
              <th className="px-3 py-2 text-left">State</th>
              <th className="px-3 py-2 text-left">Created</th>
              <th className="px-3 py-2 text-left">Performed</th>
              <th className="px-3 py-2 text-left">Payme ID</th>
              <th className="px-3 py-2 text-left">Order</th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-center opacity-60" colSpan={8}>
                  No payments
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.payme_id}
                  className="border-t hover:bg-gray-50 cursor-pointer"
                  onClick={() =>
                    r.client_id &&
                    window.location.assign(
                      `/admin/finance?tab=clients&client_id=${r.client_id}`
                    )
                  }
                >
                  <td className="px-3 py-2 text-blue-600 font-medium">
                    {r.client_id}
                  </td>
                
                  <td className="px-3 py-2">
                    {r.name || "—"}
                  </td>
                
                  <td className="px-3 py-2">
                    {r.phone || "—"}
                  </td>
                
                  <td className="px-3 py-2 font-semibold">
                    {money(r.amount)}
                  </td>
                
                  <td className="px-3 py-2">
                    <span className={`px-2 py-1 rounded text-xs ${stateBadgeClass(r.state)}`}>
                      {stateLabel(r.state)}
                    </span>
                  </td>
                
                  <td className="px-3 py-2">{fmtTs(r.created_at)}</td>
                  <td className="px-3 py-2">{fmtTs(r.performed_at)}</td>
                  <td className="px-3 py-2">{r.payme_id}</td>
                  <td className="px-3 py-2">{r.order_id}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
