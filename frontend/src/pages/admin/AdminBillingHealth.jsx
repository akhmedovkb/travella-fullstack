//frontend/src/pages/admin/AdminBillingHealth.jsx

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../../api";
import { tError, tSuccess } from "../../shared/toast";
import { formatTiyinToSum } from "../../utils/money";

function Badge({ kind = "gray", children }) {
  const map = {
    green: "bg-green-100 text-green-700",
    red: "bg-red-100 text-red-700",
    yellow: "bg-yellow-100 text-yellow-800",
    gray: "bg-gray-100 text-gray-700",
    black: "bg-black text-white",
    orange: "bg-orange-100 text-orange-800",
    purple: "bg-purple-100 text-purple-800",
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
        map[kind] || map.gray
      }`}
    >
      {children}
    </span>
  );
}

function Box({ title, count, kind = "gray", children, right = null }) {
  return (
    <div className="bg-white rounded-xl shadow overflow-hidden">
      <div className="p-3 border-b flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="text-sm font-medium">{title}</div>
          <Badge kind={kind}>{count}</Badge>
        </div>
        {right}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function SmallAction({ children, onClick, disabled = false, tone = "default" }) {
  const cls =
    tone === "danger"
      ? "bg-red-600 text-white border-red-600"
      : tone === "black"
      ? "bg-black text-white border-black"
      : "bg-white text-gray-800 border-gray-300 hover:bg-gray-50";

  return (
    <button
      className={`px-3 py-1 rounded-lg border text-xs disabled:opacity-60 ${cls}`}
      onClick={onClick}
      disabled={disabled}
      type="button"
    >
      {children}
    </button>
  );
}

function problemBadge(problemType) {
  const p = String(problemType || "").toUpperCase();

  if (p === "LOST_PAYMENT") return <Badge kind="red">LOST_PAYMENT</Badge>;
  if (p === "CANCELED_BUT_ORDER_PAID")
    return <Badge kind="orange">CANCELED_BUT_ORDER_PAID</Badge>;
  if (p === "ORDER_STATUS_MISMATCH")
    return <Badge kind="yellow">ORDER_STATUS_MISMATCH</Badge>;
  if (p === "TX_OK_ORDER_BAD") return <Badge kind="purple">TX_OK_ORDER_BAD</Badge>;
  return <Badge kind="gray">{p || "UNKNOWN"}</Badge>;
}

export default function AdminBillingHealth() {
  const [loading, setLoading] = useState(false);
  const [repairingAll, setRepairingAll] = useState(false);
  const [repairingClientId, setRepairingClientId] = useState(null);
  const [repairingPaymeId, setRepairingPaymeId] = useState(null);
  const [brokenFilter, setBrokenFilter] = useState("ALL");
  const [data, setData] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const res = await apiGet("/api/admin/billing/health", "admin");
      setData(res || null);
    } catch (e) {
      console.error(e);
      tError("Не удалось загрузить Billing Health");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  async function repairOne(clientId) {
    if (!clientId) return;
    setRepairingClientId(clientId);
    try {
      const res = await apiPost(`/api/admin/billing/health/repair/${clientId}`, {}, "admin");
      tSuccess(`Client ${res?.client_id || clientId} repaired`);
      await load();
    } catch (e) {
      console.error(e);
      tError("Не удалось выполнить repair");
    } finally {
      setRepairingClientId(null);
    }
  }

  async function repairAll() {
    setRepairingAll(true);
    try {
      const res = await apiPost("/api/admin/billing/health/repair-all", {}, "admin");
      tSuccess(`Repair all done: ${res?.repaired_count || 0}`);
      await load();
    } catch (e) {
      console.error(e);
      tError("Не удалось выполнить repair all");
    } finally {
      setRepairingAll(false);
    }
  }

  async function repairPaymeLedger(paymeId) {
    if (!paymeId) return;
    setRepairingPaymeId(paymeId);
    try {
      const res = await apiPost(
        `/api/admin/payme/repair/${encodeURIComponent(paymeId)}`,
        {},
        "admin"
      );
      if (res?.already) tSuccess("Ledger уже был (idempotent)");
      else tSuccess("Ledger repaired");
      await load();
    } catch (e) {
      console.error(e);
      tError("Не удалось восстановить ledger");
    } finally {
      setRepairingPaymeId(null);
    }
  }

  function openPaymeHealth(paymeId) {
    if (!paymeId) return;
    window.open(`/admin/payme-health?payme_id=${encodeURIComponent(paymeId)}`, "_blank");
  }

  function openPaymeLab({ paymeId, orderId, amount }) {
    const params = new URLSearchParams();
    if (paymeId) params.set("seed_payme_id", paymeId);
    if (orderId) params.set("order_id", String(orderId));
    if (amount) params.set("amount", String(amount));
    window.open(`/admin/payme-lab?${params.toString()}`, "_blank");
  }

  function openClient(clientId) {
    if (!clientId) return;
    window.open(`/admin/contact-balance?client_id=${encodeURIComponent(clientId)}`, "_blank");
  }

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => {
    const ledgerMismatch = Array.isArray(data?.ledger_mismatch) ? data.ledger_mismatch : [];
    const doubleUnlock = Array.isArray(data?.double_unlock) ? data.double_unlock : [];
    const brokenPayme = Array.isArray(data?.broken_payme) ? data.broken_payme : [];
    const orphanOrders = Array.isArray(data?.orphan_orders) ? data.orphan_orders : [];

    const totalIssues =
      ledgerMismatch.length +
      doubleUnlock.length +
      brokenPayme.length +
      orphanOrders.length;

    return {
      ledgerMismatch,
      doubleUnlock,
      brokenPayme,
      orphanOrders,
      totalIssues,
      ok: totalIssues === 0,
    };
  }, [data]);

  const brokenProblemCounts = useMemo(() => {
    const out = {
      ALL: stats.brokenPayme.length,
      LOST_PAYMENT: 0,
      CANCELED_BUT_ORDER_PAID: 0,
      ORDER_STATUS_MISMATCH: 0,
      TX_OK_ORDER_BAD: 0,
      UNKNOWN: 0,
    };

    for (const r of stats.brokenPayme) {
      const key = String(r?.problem_type || "UNKNOWN").toUpperCase();
      if (out[key] === undefined) out.UNKNOWN += 1;
      else out[key] += 1;
    }

    return out;
  }, [stats.brokenPayme]);

  const filteredBrokenPayme = useMemo(() => {
    if (brokenFilter === "ALL") return stats.brokenPayme;
    return stats.brokenPayme.filter(
      (r) => String(r?.problem_type || "UNKNOWN").toUpperCase() === brokenFilter
    );
  }, [stats.brokenPayme, brokenFilter]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-lg font-semibold">Billing Health</div>
          <div className="text-sm text-gray-500">
            Automatic Ledger Integrity Guard: mismatch, double unlock, broken Payme, orphan orders.
          </div>
        </div>

        <div className="flex items-center gap-2">
          {stats.ok ? (
            <Badge kind="green">System OK</Badge>
          ) : (
            <Badge kind="red">Issues: {stats.totalIssues}</Badge>
          )}

          <button
            className="px-4 py-2 rounded-lg border bg-white disabled:opacity-60"
            onClick={load}
            disabled={loading}
          >
            {loading ? "Загрузка…" : "Обновить"}
          </button>

          <button
            className="px-4 py-2 rounded-lg bg-black text-white disabled:opacity-60"
            onClick={repairAll}
            disabled={repairingAll || stats.ledgerMismatch.length === 0}
          >
            {repairingAll ? "Repairing…" : "Repair all"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl shadow p-4">
          <div className="text-sm text-gray-500">Ledger mismatch</div>
          <div
            className={`mt-2 text-2xl font-semibold ${
              stats.ledgerMismatch.length ? "text-red-600" : "text-gray-900"
            }`}
          >
            {stats.ledgerMismatch.length}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-4">
          <div className="text-sm text-gray-500">Double unlock</div>
          <div
            className={`mt-2 text-2xl font-semibold ${
              stats.doubleUnlock.length ? "text-red-600" : "text-gray-900"
            }`}
          >
            {stats.doubleUnlock.length}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-4">
          <div className="text-sm text-gray-500">Broken Payme</div>
          <div
            className={`mt-2 text-2xl font-semibold ${
              stats.brokenPayme.length ? "text-red-600" : "text-gray-900"
            }`}
          >
            {stats.brokenPayme.length}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-4">
          <div className="text-sm text-gray-500">Orphan orders</div>
          <div
            className={`mt-2 text-2xl font-semibold ${
              stats.orphanOrders.length ? "text-red-600" : "text-gray-900"
            }`}
          >
            {stats.orphanOrders.length}
          </div>
        </div>
      </div>

      <Box
        title="Ledger mismatch"
        count={stats.ledgerMismatch.length}
        kind={stats.ledgerMismatch.length ? "red" : "green"}
      >
        {stats.ledgerMismatch.length === 0 ? (
          <div className="text-sm text-gray-500">Расхождений mirror vs ledger нет.</div>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-3 py-2">client_id</th>
                  <th className="text-left px-3 py-2">mirror_balance</th>
                  <th className="text-left px-3 py-2">ledger_balance</th>
                  <th className="text-right px-3 py-2">actions</th>
                </tr>
              </thead>
              <tbody>
                {stats.ledgerMismatch.map((r, idx) => (
                  <tr key={`${r.client_id}_${idx}`} className="border-t">
                    <td className="px-3 py-2">{r.client_id}</td>
                    <td className="px-3 py-2">{formatTiyinToSum(r.mirror_balance)} сум</td>
                    <td className="px-3 py-2">{formatTiyinToSum(r.ledger_balance)} сум</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-2 flex-wrap">
                        <SmallAction onClick={() => openClient(r.client_id)}>
                          Open client
                        </SmallAction>
                        <SmallAction
                          tone="black"
                          onClick={() => repairOne(r.client_id)}
                          disabled={repairingClientId === r.client_id}
                        >
                          {repairingClientId === r.client_id ? "…" : "Repair"}
                        </SmallAction>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Box>

      <Box
        title="Double unlock"
        count={stats.doubleUnlock.length}
        kind={stats.doubleUnlock.length ? "red" : "green"}
      >
        {stats.doubleUnlock.length === 0 ? (
          <div className="text-sm text-gray-500">Повторных unlock по одной и той же услуге нет.</div>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-3 py-2">client_id</th>
                  <th className="text-left px-3 py-2">service_id</th>
                  <th className="text-left px-3 py-2">count</th>
                </tr>
              </thead>
              <tbody>
                {stats.doubleUnlock.map((r, idx) => (
                  <tr key={`${r.client_id}_${r.service_id}_${idx}`} className="border-t">
                    <td className="px-3 py-2">{r.client_id}</td>
                    <td className="px-3 py-2">{r.service_id}</td>
                    <td className="px-3 py-2">{r.cnt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Box>

      <Box
        title="Broken Payme"
        count={filteredBrokenPayme.length}
        kind={filteredBrokenPayme.length ? "red" : "green"}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="border rounded-lg px-3 py-1.5 text-sm bg-white"
              value={brokenFilter}
              onChange={(e) => setBrokenFilter(e.target.value)}
            >
              <option value="ALL">All ({brokenProblemCounts.ALL})</option>
              <option value="LOST_PAYMENT">
                LOST_PAYMENT ({brokenProblemCounts.LOST_PAYMENT})
              </option>
              <option value="CANCELED_BUT_ORDER_PAID">
                CANCELED_BUT_ORDER_PAID ({brokenProblemCounts.CANCELED_BUT_ORDER_PAID})
              </option>
              <option value="ORDER_STATUS_MISMATCH">
                ORDER_STATUS_MISMATCH ({brokenProblemCounts.ORDER_STATUS_MISMATCH})
              </option>
              <option value="TX_OK_ORDER_BAD">
                TX_OK_ORDER_BAD ({brokenProblemCounts.TX_OK_ORDER_BAD})
              </option>
              <option value="UNKNOWN">UNKNOWN ({brokenProblemCounts.UNKNOWN})</option>
            </select>
          </div>
        }
      >
        {filteredBrokenPayme.length === 0 ? (
          <div className="text-sm text-gray-500">Для выбранного фильтра проблем нет.</div>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-3 py-2">payme_id</th>
                  <th className="text-left px-3 py-2">order_id</th>
                  <th className="text-left px-3 py-2">client_id</th>
                  <th className="text-left px-3 py-2">tx_state</th>
                  <th className="text-left px-3 py-2">order_status</th>
                  <th className="text-left px-3 py-2">problem</th>
                  <th className="text-right px-3 py-2">actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredBrokenPayme.map((r, idx) => (
                  <tr key={`${r.payme_id}_${idx}`} className="border-t">
                    <td className="px-3 py-2 break-all">{r.payme_id}</td>
                    <td className="px-3 py-2">{r.order_id}</td>
                    <td className="px-3 py-2">{r.state}</td>
                    <td className="px-3 py-2">{r.status}</td>
                    <td className="px-3 py-2">{problemBadge(r.problem_type)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-2 flex-wrap">
                        <SmallAction onClick={() => openPaymeHealth(r.payme_id)}>
                          Open in Health
                        </SmallAction>
                        <SmallAction
                          onClick={() =>
                            openPaymeLab({
                              paymeId: r.payme_id,
                              orderId: r.order_id,
                              amount: r.amount_tiyin,
                            })
                          }
                        >
                          Open in Lab
                        </SmallAction>
                        <SmallAction
                          tone="danger"
                          onClick={() => repairPaymeLedger(r.payme_id)}
                          disabled={repairingPaymeId === r.payme_id}
                        >
                          {repairingPaymeId === r.payme_id ? "…" : "Repair Ledger"}
                        </SmallAction>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Box>

      <Box
        title="Orphan orders"
        count={stats.orphanOrders.length}
        kind={stats.orphanOrders.length ? "red" : "green"}
      >
        {stats.orphanOrders.length === 0 ? (
          <div className="text-sm text-gray-500">Зависших order без payme_transactions нет.</div>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-3 py-2">order_id</th>
                  <th className="text-left px-3 py-2">client_id</th>
                  <th className="text-left px-3 py-2">amount</th>
                  <th className="text-left px-3 py-2">status</th>
                  <th className="text-right px-3 py-2">actions</th>
                </tr>
              </thead>
              <tbody>
                {stats.orphanOrders.map((r, idx) => (
                  <tr key={`${r.id}_${idx}`} className="border-t">
                    <td className="px-3 py-2">{r.id}</td>
                    <td className="px-3 py-2">{r.client_id}</td>
                    <td className="px-3 py-2">{formatTiyinToSum(r.amount_tiyin)} сум</td>
                    <td className="px-3 py-2">{r.status}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-2 flex-wrap">
                        <SmallAction onClick={() => openClient(r.client_id)}>
                          Open client
                        </SmallAction>
                        <SmallAction
                          onClick={() =>
                            openPaymeLab({
                              orderId: r.id,
                              amount: r.amount_tiyin,
                            })
                          }
                        >
                          Open in Lab
                        </SmallAction>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Box>
    </div>
  );
}
