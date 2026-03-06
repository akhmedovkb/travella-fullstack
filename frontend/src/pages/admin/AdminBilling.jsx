//frontend/src/pages/admin/AdminBilling.jsx

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../../api";
import { tError, tSuccess } from "../../shared/toast";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function money(n) {
  return Math.round(toNum(n)).toLocaleString("ru-RU");
}

function fmtTs(x) {
  if (!x) return "—";
  try {
    return new Date(x).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" });
  } catch {
    return String(x);
  }
}

function StatCard({ title, value, danger = false, warn = false }) {
  const valueCls = danger
    ? "text-red-600"
    : warn
    ? "text-yellow-600"
    : "text-gray-900";

  return (
    <div className="bg-white rounded-xl shadow p-4">
      <div className="text-sm text-gray-500">{title}</div>
      <div className={`mt-2 text-2xl font-semibold ${valueCls}`}>{money(value)}</div>
    </div>
  );
}

export default function AdminBilling() {
  const [tab, setTab] = useState("summary");

  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [clients, setClients] = useState([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsQ, setClientsQ] = useState("");
  const [clientsLimit, setClientsLimit] = useState(100);

  const [ledger, setLedger] = useState([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerClientId, setLedgerClientId] = useState("");
  const [ledgerReason, setLedgerReason] = useState("");
  const [ledgerSource, setLedgerSource] = useState("");
  const [ledgerLimit, setLedgerLimit] = useState(100);

  const [adjustClientId, setAdjustClientId] = useState("");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [adjustLoading, setAdjustLoading] = useState(false);

  async function loadSummary() {
    setSummaryLoading(true);
    try {
      const data = await apiGet("/api/admin/billing/summary", "admin");
      setSummary(data || null);
    } catch (e) {
      console.error(e);
      tError("Не удалось загрузить Billing Summary");
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }

  async function loadClients() {
    setClientsLoading(true);
    try {
      const url = `/api/admin/billing/clients?limit=${encodeURIComponent(
        clientsLimit
      )}&q=${encodeURIComponent(String(clientsQ || "").trim())}`;

      const data = await apiGet(url, "admin");
      setClients(Array.isArray(data?.rows) ? data.rows : []);
    } catch (e) {
      console.error(e);
      tError("Не удалось загрузить balances клиентов");
      setClients([]);
    } finally {
      setClientsLoading(false);
    }
  }

  async function loadLedger() {
    setLedgerLoading(true);
    try {
      const parts = [
        `limit=${encodeURIComponent(ledgerLimit)}`,
      ];

      if (String(ledgerClientId || "").trim()) {
        parts.push(`clientId=${encodeURIComponent(String(ledgerClientId).trim())}`);
      }
      if (String(ledgerReason || "").trim()) {
        parts.push(`reason=${encodeURIComponent(String(ledgerReason).trim())}`);
      }
      if (String(ledgerSource || "").trim()) {
        parts.push(`source=${encodeURIComponent(String(ledgerSource).trim())}`);
      }

      const url = `/api/admin/billing/ledger?${parts.join("&")}`;
      const data = await apiGet(url, "admin");
      setLedger(Array.isArray(data?.rows) ? data.rows : []);
    } catch (e) {
      console.error(e);
      tError("Не удалось загрузить ledger");
      setLedger([]);
    } finally {
      setLedgerLoading(false);
    }
  }

  async function submitAdjust() {
    const client_id = Number(adjustClientId);
    const amount = Number(adjustAmount);
    const note = String(adjustNote || "").trim();

    if (!Number.isFinite(client_id) || client_id <= 0) {
      return tError("Укажи корректный client_id");
    }
    if (!Number.isFinite(amount) || amount === 0) {
      return tError("Укажи amount, не равный 0");
    }
    if (!note) {
      return tError("Укажи note");
    }

    setAdjustLoading(true);
    try {
      await apiPost(
        "/api/admin/billing/adjust",
        {
          client_id,
          amount,
          note,
        },
        "admin"
      );

      tSuccess("Корректировка сохранена");
      setAdjustAmount("");
      setAdjustNote("");

      await Promise.all([loadSummary(), loadClients(), loadLedger()]);
    } catch (e) {
      console.error(e);
      tError("Не удалось сделать корректировку");
    } finally {
      setAdjustLoading(false);
    }
  }

  useEffect(() => {
    loadSummary();
    loadClients();
    loadLedger();
  }, []);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Billing (Admin)</h1>
          <p className="text-sm text-gray-500">
            Балансы клиентов, ledger и ручные корректировки
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            className={`px-3 py-2 rounded-lg text-sm ${
              tab === "summary" ? "bg-black text-white" : "border bg-white"
            }`}
            onClick={() => setTab("summary")}
          >
            Summary
          </button>

          <button
            className={`px-3 py-2 rounded-lg text-sm ${
              tab === "clients" ? "bg-black text-white" : "border bg-white"
            }`}
            onClick={() => setTab("clients")}
          >
            Clients
          </button>

          <button
            className={`px-3 py-2 rounded-lg text-sm ${
              tab === "ledger" ? "bg-black text-white" : "border bg-white"
            }`}
            onClick={() => setTab("ledger")}
          >
            Ledger
          </button>
        </div>
      </div>

      {tab === "summary" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              className="px-4 py-2 rounded-lg bg-black text-white disabled:opacity-60"
              onClick={loadSummary}
              disabled={summaryLoading}
            >
              {summaryLoading ? "Загрузка…" : "Обновить"}
            </button>
          </div>

          {!summary ? (
            <div className="bg-white rounded-xl shadow p-6 text-sm text-gray-400">
              Нет данных
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <StatCard title="Total balance" value={summary.total_balance} />
              <StatCard title="Total topups" value={summary.total_topups} />
              <StatCard title="Total refunds" value={summary.total_refunds} warn />
              <StatCard title="Total debits" value={summary.total_debits} danger />
              <StatCard title="Clients with balance" value={summary.clients_with_balance} />
              <StatCard title="Payme tx count" value={summary.payme_tx_count} />
            </div>
          )}

          <div className="bg-white rounded-xl shadow p-4">
            <div className="text-sm font-medium mb-3">Manual adjustment</div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">client_id</label>
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  value={adjustClientId}
                  onChange={(e) => setAdjustClientId(e.target.value)}
                  placeholder="39"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">amount</label>
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                  placeholder="10000 или -10000"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">note</label>
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  value={adjustNote}
                  onChange={(e) => setAdjustNote(e.target.value)}
                  placeholder="Причина корректировки"
                />
              </div>
            </div>

            <div className="mt-3 flex justify-end">
              <button
                className="px-4 py-2 rounded-lg bg-black text-white disabled:opacity-60"
                onClick={submitAdjust}
                disabled={adjustLoading}
              >
                {adjustLoading ? "Сохраняю…" : "Сделать корректировку"}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === "clients" && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex flex-col md:flex-row gap-3 md:items-end">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Поиск по client_id</label>
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  value={clientsQ}
                  onChange={(e) => setClientsQ(e.target.value)}
                  placeholder="39"
                />
              </div>

              <div className="w-full md:w-40">
                <label className="block text-xs text-gray-500 mb-1">Limit</label>
                <input
                  type="number"
                  className="w-full border rounded-lg px-3 py-2"
                  value={clientsLimit}
                  onChange={(e) => setClientsLimit(toNum(e.target.value) || 100)}
                  min={1}
                  max={500}
                />
              </div>

              <button
                className="px-4 py-2 rounded-lg bg-black text-white disabled:opacity-60"
                onClick={loadClients}
                disabled={clientsLoading}
              >
                {clientsLoading ? "Загрузка…" : "Обновить"}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow overflow-hidden">
            <div className="p-3 border-b flex items-center justify-between">
              <div className="text-sm text-gray-600">Client balances</div>
              <div className="text-xs text-gray-400">rows: {clients.length}</div>
            </div>

            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left px-3 py-2">client_id</th>
                    <th className="text-left px-3 py-2">balance</th>
                    <th className="text-left px-3 py-2">total_in</th>
                    <th className="text-left px-3 py-2">total_out</th>
                    <th className="text-left px-3 py-2">last_operation</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-gray-400" colSpan={5}>
                        Нет данных
                      </td>
                    </tr>
                  ) : (
                    clients.map((r) => (
                      <tr key={r.client_id} className="border-t">
                        <td className="px-3 py-2">{r.client_id}</td>
                        <td className="px-3 py-2 font-medium">{money(r.balance)}</td>
                        <td className="px-3 py-2 text-green-700">{money(r.total_in)}</td>
                        <td className="px-3 py-2 text-red-600">{money(r.total_out)}</td>
                        <td className="px-3 py-2">{fmtTs(r.last_operation_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === "ledger" && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow p-4">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">client_id</label>
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  value={ledgerClientId}
                  onChange={(e) => setLedgerClientId(e.target.value)}
                  placeholder="39"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">reason</label>
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  value={ledgerReason}
                  onChange={(e) => setLedgerReason(e.target.value)}
                  placeholder="topup / refund / manual_adjustment"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">source</label>
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  value={ledgerSource}
                  onChange={(e) => setLedgerSource(e.target.value)}
                  placeholder="payme / admin / payme_refund"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Limit</label>
                <input
                  type="number"
                  className="w-full border rounded-lg px-3 py-2"
                  value={ledgerLimit}
                  onChange={(e) => setLedgerLimit(toNum(e.target.value) || 100)}
                  min={1}
                  max={500}
                />
              </div>

              <div className="flex items-end">
                <button
                  className="w-full px-4 py-2 rounded-lg bg-black text-white disabled:opacity-60"
                  onClick={loadLedger}
                  disabled={ledgerLoading}
                >
                  {ledgerLoading ? "Загрузка…" : "Обновить"}
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow overflow-hidden">
            <div className="p-3 border-b flex items-center justify-between">
              <div className="text-sm text-gray-600">Ledger</div>
              <div className="text-xs text-gray-400">rows: {ledger.length}</div>
            </div>

            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left px-3 py-2">id</th>
                    <th className="text-left px-3 py-2">client_id</th>
                    <th className="text-left px-3 py-2">amount</th>
                    <th className="text-left px-3 py-2">reason</th>
                    <th className="text-left px-3 py-2">source</th>
                    <th className="text-left px-3 py-2">created_at</th>
                    <th className="text-left px-3 py-2">meta</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-gray-400" colSpan={7}>
                        Нет данных
                      </td>
                    </tr>
                  ) : (
                    ledger.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="px-3 py-2">{r.id}</td>
                        <td className="px-3 py-2">{r.client_id}</td>
                        <td
                          className={`px-3 py-2 font-medium ${
                            Number(r.amount) < 0 ? "text-red-600" : "text-green-700"
                          }`}
                        >
                          {money(r.amount)}
                        </td>
                        <td className="px-3 py-2">{r.reason}</td>
                        <td className="px-3 py-2">{r.source}</td>
                        <td className="px-3 py-2">{fmtTs(r.created_at)}</td>
                        <td className="px-3 py-2">
                          <pre className="text-xs whitespace-pre-wrap break-all">
                            {r.meta ? JSON.stringify(r.meta, null, 2) : "—"}
                          </pre>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
