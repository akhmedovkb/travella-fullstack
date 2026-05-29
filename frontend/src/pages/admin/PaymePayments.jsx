// frontend/src/pages/admin/PaymePayments.jsx

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiGet } from "../../api";
import { tError } from "../../shared/toast";

function normalizeStateValue(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (["2", "success", "performed", "paid"].includes(s)) return "success";
  if (["1", "created", "pending", "new"].includes(s)) return "created";
  if (["-1", "canceled", "cancelled"].includes(s)) return "canceled";
  if (["-2", "refund", "refunded"].includes(s)) return "refund";
  if (["failed", "error"].includes(s)) return "failed";
  return "";
}

function stateLabel(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "success") return "SUCCESS";
  if (s === "created") return "CREATED";
  if (s === "pending" || s === "new") return "PENDING";
  if (s === "canceled") return "CANCELED";
  if (s === "refund") return "REFUND";
  if (s === "failed") return "FAILED";
  return s ? s.toUpperCase() : "—";
}

function stateBadgeClass(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "success") return "bg-green-100 text-green-700";
  if (s === "created" || s === "pending" || s === "new") return "bg-yellow-100 text-yellow-700";
  if (s === "canceled") return "bg-orange-100 text-orange-700";
  if (s === "refund" || s === "failed") return "bg-red-100 text-red-700";
  return "bg-gray-100 text-gray-700";
}

function sourceBadgeClass(v) {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("telegram")) return "bg-sky-100 text-sky-700";
  if (s.includes("support")) return "bg-purple-100 text-purple-700";
  return "bg-slate-100 text-slate-700";
}

function typeLabel(v) {
  const s = String(v ?? "").trim();
  if (s === "unlock_contact") return "Unlock contact";
  if (s === "balance_topup" || s === "client_topup" || s === "contact_topup") return "Balance topup";
  if (s === "provider_support") return "Support donation";
  return s || "—";
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

function shortId(x, max = 18) {
  const s = String(x || "").trim();
  if (!s) return "—";
  if (s.length <= max) return s;
  return `${s.slice(0, 8)}…${s.slice(-6)}`;
}

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-bold text-slate-950">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-400">{hint}</div> : null}
    </div>
  );
}

export default function PaymePayments() {
  const [searchParams, setSearchParams] = useSearchParams();

  const initialQ = searchParams.get("q") || "";
  const initialState = normalizeStateValue(searchParams.get("state"));
  const initialType = searchParams.get("type") || "";
  const initialSource = searchParams.get("source") || "";
  const initialLimit = searchParams.get("limit") || "200";

  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({});
  const [loading, setLoading] = useState(false);

  const [q, setQ] = useState(initialQ);
  const [state, setState] = useState(initialState);
  const [type, setType] = useState(initialType);
  const [source, setSource] = useState(initialSource);
  const [limit, setLimit] = useState(initialLimit);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", String(limit || "200"));
    if (q.trim()) p.set("q", q.trim());
    if (state) p.set("state", state);
    if (type) p.set("type", type);
    if (source) p.set("source", source);
    return p.toString();
  }, [q, state, type, source, limit]);

  async function load() {
    setLoading(true);
    try {
      const data = await apiGet(`/api/admin/payme/payments?${query}`, "admin");
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setTotals(data?.totals || {});
    } catch (e) {
      console.error(e);
      setRows([]);
      setTotals({});
      tError("Не удалось загрузить Payments");
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

    if (type) p.set("type", type);
    else p.delete("type");

    if (source) p.set("source", source);
    else p.delete("source");

    if (limit && String(limit) !== "200") p.set("limit", String(limit));
    else p.delete("limit");

    setSearchParams(p, { replace: true });
  }, [q, state, type, source, limit, searchParams, setSearchParams]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const totalCount = Number(totals?.count || 0);
  const successCount = Number(totals?.success_count || 0);
  const pendingCount = Number(totals?.pending_count || 0);
  const failedCount = Number(totals?.failed_count || 0);
  const successAmount = Number(totals?.success_amount || 0);

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Unified Payments</h2>
          <div className="text-sm opacity-70">
            Все платежи в одном месте: web Payme, Telegram Payme, открытие контактов, пополнения и поддержка проекта.
          </div>
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <input
            className="border rounded px-3 py-2 w-full md:w-80"
            placeholder="Search: client / provider / phone / service / payme_id..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <select
            className="border rounded px-3 py-2"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">All sources</option>
            <option value="web">Web Payme</option>
            <option value="telegram">Telegram</option>
            <option value="telegram_invoice">Telegram invoice</option>
          </select>

          <select
            className="border rounded px-3 py-2"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">All types</option>
            <option value="unlock">Unlock</option>
            <option value="topup">Topup</option>
            <option value="support">Support</option>
            <option value="provider_support">Provider support</option>
            <option value="unlock_contact">Unlock contact</option>
            <option value="balance_topup">Balance topup</option>
            <option value="contact_topup">Telegram topup</option>
          </select>

          <select
            className="border rounded px-3 py-2"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            <option value="">All states</option>
            <option value="success">SUCCESS</option>
            <option value="created">CREATED/PENDING</option>
            <option value="failed">FAILED</option>
            <option value="canceled">CANCELED</option>
            <option value="refund">REFUND</option>
          </select>

          <input
            type="number"
            min="1"
            max="1000"
            className="border rounded px-3 py-2 w-full md:w-24"
            value={limit}
            onChange={(e) => setLimit(e.target.value || "200")}
            placeholder="Limit"
          />

          <button
            className="rounded-lg bg-black px-4 py-2 text-white disabled:opacity-60"
            onClick={load}
            disabled={loading}
          >
            {loading ? "Loading..." : "Reload"}
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <StatCard label="Total payments" value={totalCount.toLocaleString("ru-RU")} />
        <StatCard label="Success" value={successCount.toLocaleString("ru-RU")} hint={money(successAmount)} />
        <StatCard label="Pending" value={pendingCount.toLocaleString("ru-RU")} />
        <StatCard label="Failed / canceled / refund" value={failedCount.toLocaleString("ru-RU")} />
      </div>

      <div className="rounded-xl border bg-white overflow-auto shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left">Time</th>
              <th className="px-3 py-2 text-left">Source</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Actor</th>
              <th className="px-3 py-2 text-left">Phone</th>
              <th className="px-3 py-2 text-left">Service</th>
              <th className="px-3 py-2 text-left">Amount</th>
              <th className="px-3 py-2 text-left">State</th>
              <th className="px-3 py-2 text-left">Paid</th>
              <th className="px-3 py-2 text-left">Payme / Telegram ID</th>
              <th className="px-3 py-2 text-left">Order</th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-center opacity-60" colSpan={11}>
                  No payments
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const isClient = r.actor_role === "client" && r.client_id;
                const actorHref = isClient
                  ? `/admin/finance?tab=clients&client_id=${r.client_id}`
                  : null;
                const idValue = r.payme_id || r.telegram_payment_charge_id || r.provider_payment_charge_id;

                return (
                  <tr key={r.row_id} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap">{fmtTs(r.created_at)}</td>

                    <td className="px-3 py-2">
                      <span className={`rounded px-2 py-1 text-xs font-semibold ${sourceBadgeClass(r.source)}`}>
                        {r.source || "—"}
                      </span>
                    </td>

                    <td className="px-3 py-2 font-medium">{typeLabel(r.payment_type)}</td>

                    <td className="px-3 py-2">
                      {actorHref ? (
                        <button
                          type="button"
                          className="text-left text-blue-600 hover:underline"
                          onClick={() => window.location.assign(actorHref)}
                        >
                          {r.actor_name || "—"}
                          <div className="text-xs text-slate-400">client #{r.client_id}</div>
                        </button>
                      ) : (
                        <div>
                          {r.actor_name || "—"}
                          <div className="text-xs text-slate-400">
                            {r.provider_id ? `provider #${r.provider_id}` : r.client_id ? `client #${r.client_id}` : "—"}
                          </div>
                        </div>
                      )}
                    </td>

                    <td className="px-3 py-2 whitespace-nowrap">{r.actor_phone || "—"}</td>

                    <td className="px-3 py-2 min-w-64">
                      <div className="font-medium">{r.service_title || "—"}</div>
                      {r.service_id ? <div className="text-xs text-slate-400">service #{r.service_id}</div> : null}
                    </td>

                    <td className="px-3 py-2 font-semibold whitespace-nowrap">{money(r.amount)}</td>

                    <td className="px-3 py-2">
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${stateBadgeClass(r.state)}`}>
                        {stateLabel(r.state)}
                      </span>
                    </td>

                    <td className="px-3 py-2 whitespace-nowrap">{fmtTs(r.performed_at)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{shortId(idValue, 24)}</td>
                    <td className="px-3 py-2">{r.order_id || "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
