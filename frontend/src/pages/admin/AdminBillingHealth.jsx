//frontend/src/pages/admin/AdminBillingHealth.jsx

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../../api";
import { tError, tSuccess } from "../../shared/toast";

function Badge({ kind = "gray", children }) {
  const map = {
    green: "bg-green-100 text-green-700",
    red: "bg-red-100 text-red-700",
    yellow: "bg-yellow-100 text-yellow-800",
    gray: "bg-gray-100 text-gray-700",
    black: "bg-black text-white",
  };

  return (
    <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${map[kind] || map.gray}`}>
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

export default function AdminBillingHealth() {
  const [loading, setLoading] = useState(false);
  const [repairingAll, setRepairingAll] = useState(false);
  const [repairingClientId, setRepairingClientId] = useState(null);
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
          {stats.ok ? <Badge kind="green">System OK</Badge> : <Badge kind="red">Issues: {stats.totalIssues}</Badge>}

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
          <div className={`mt-2 text-2xl font-semibold ${stats.ledgerMismatch.length ? "text-red-600" : "text-gray-900"}`}>
            {stats.ledgerMismatch.length}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-4">
          <div className="text-sm text-gray-500">Double unlock</div>
          <div className={`mt-2 text-2xl font-semibold ${stats.doubleUnlock.length ? "text-red-600" : "text-gray-900"}`}>
            {stats.doubleUnlock.length}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-4">
          <div className="text-sm text-gray-500">Broken Payme</div>
          <div className={`mt-2 text-2xl font-semibold ${stats.brokenPayme.length ? "text-red-600" : "text-gray-900"}`}>
            {stats.brokenPayme.length}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-4">
          <div className="text-sm text-gray-500">Orphan orders</div>
          <div className={`mt-2 text-2xl font-semibold ${stats.orphanOrders.length ? "text-red-600" : "text-gray-900"}`}>
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
                    <td className="px-3 py-2">{r.mirror_balance}</td>
                    <td className="px-3 py-2">{r.ledger_balance}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        className="px-3 py-1 rounded-lg bg-black text-white disabled:opacity-60"
                        onClick={() => repairOne(r.client_id)}
                        disabled={repairingClientId === r.client_id}
                      >
                        {repairingClientId === r.client_id ? "…" : "Repair"}
                      </button>
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
        count={stats.brokenPayme.length}
        kind={stats.brokenPayme.length ? "red" : "green"}
      >
        {stats.brokenPayme.length === 0 ? (
          <div className="text-sm text-gray-500">Неконсистентных Payme transaction / order status не найдено.</div>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-3 py-2">payme_id</th>
                  <th className="text-left px-3 py-2">order_id</th>
                  <th className="text-left px-3 py-2">tx_state</th>
                  <th className="text-left px-3 py-2">order_status</th>
                </tr>
              </thead>
              <tbody>
                {stats.brokenPayme.map((r, idx) => (
                  <tr key={`${r.payme_id}_${idx}`} className="border-t">
                    <td className="px-3 py-2 break-all">{r.payme_id}</td>
                    <td className="px-3 py-2">{r.order_id}</td>
                    <td className="px-3 py-2">{r.state}</td>
                    <td className="px-3 py-2">{r.status}</td>
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
                  <th className="text-left px-3 py-2">amount_tiyin</th>
                  <th className="text-left px-3 py-2">status</th>
                </tr>
              </thead>
              <tbody>
                {stats.orphanOrders.map((r, idx) => (
                  <tr key={`${r.id}_${idx}`} className="border-t">
                    <td className="px-3 py-2">{r.id}</td>
                    <td className="px-3 py-2">{r.client_id}</td>
                    <td className="px-3 py-2">{r.amount_tiyin}</td>
                    <td className="px-3 py-2">{r.status}</td>
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
