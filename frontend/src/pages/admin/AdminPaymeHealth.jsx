// frontend/src/pages/admin/AdminPaymeHealth.jsx

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../../api";
import { tError, tSuccess } from "../../shared/toast";
import { useSearchParams } from "react-router-dom";
import AdminPaymeEvents from "./AdminPaymeEvents";
import PaymeLab from "./PaymeLab";
import PaymeDashboard from "./PaymeDashboard";
import PaymeLive from "./PaymeLive";
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

function badge(status) {
  const base = "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium";

  if (status === "OK") {
    return <span className={`${base} bg-green-100 text-green-700`}>✅ OK</span>;
  }

  if (status === "STUCK") {
    return (
      <span className={`${base} bg-purple-100 text-purple-800`}>
        ⏳ STUCK
      </span>
    );
  }

  if (status === "LOST_PAYMENT") {
    return <span className={`${base} bg-red-100 text-red-700`}>✖ LOST_PAYMENT</span>;
  }

  if (status === "BAD_AMOUNT") {
    return <span className={`${base} bg-yellow-100 text-yellow-800`}>⚠ BAD_AMOUNT</span>;
  }

  if (status === "REFUND_MISMATCH") {
    return (
      <span className={`${base} bg-orange-100 text-orange-800`}>
        ⚠ REFUND_MISMATCH
      </span>
    );
  }

  return <span className={`${base} bg-gray-100 text-gray-700`}>{String(status)}</span>;
}

export default function AdminPaymeHealth() {
  const [searchParams] = useSearchParams();

  const [q, setQ] = useState("");
  const [onlyBad, setOnlyBad] = useState(true);
  const [limit, setLimit] = useState(200);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);

  const [selected, setSelected] = useState(null);
  const [details, setDetails] = useState(null);
  const [repairingId, setRepairingId] = useState(null);
  const [autoFixing, setAutoFixing] = useState(false);

  const [tab, setTab] = useState("health"); // health | events | lab | dashboard | live

  const canLoad = useMemo(() => true, []);

  async function load(qOverride = null) {
    if (!canLoad) return;

    setLoading(true);
    try {
      const qValue =
        qOverride !== null ? String(qOverride || "").trim() : String(q || "").trim();

      const url = `/api/admin/payme/health?limit=${encodeURIComponent(limit)}&onlyBad=${
        onlyBad ? 1 : 0
      }&q=${encodeURIComponent(qValue)}`;

      const data = await apiGet(url, "admin");
      const nextRows = Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [];
      setRows(nextRows);

      if (qValue) {
        const exact =
          nextRows.find((r) => String(r?.payme_id || "") === qValue) ||
          nextRows.find((r) => String(r?.order_id || "") === qValue);

        if (exact) {
          setSelected(exact);
          try {
            const detailsData = await apiGet(
              `/api/admin/payme/tx/${encodeURIComponent(exact.payme_id)}`,
              "admin"
            );
            setDetails(detailsData);
          } catch (e) {
            console.error(e);
          }
        }
      }
    } catch (e) {
      console.error(e);
      tError("Не удалось загрузить Payme Health");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function openTx(r) {
    if (!r?.payme_id) return;

    setSelected(r);
    setDetails(null);

    try {
      const data = await apiGet(`/api/admin/payme/tx/${encodeURIComponent(r.payme_id)}`, "admin");
      setDetails(data);
    } catch (e) {
      console.error(e);
      tError("Не удалось загрузить детали транзакции");
    }
  }

  function openInLab(r) {
    if (!r) return;
    setSelected(r);
    setTab("lab");
  }

  async function repair(paymeId) {
    if (!paymeId) return;

    setRepairingId(paymeId);

    try {
      const data = await apiPost(
        `/api/admin/payme/repair/${encodeURIComponent(paymeId)}`,
        {},
        "admin"
      );

      if (data?.already) tSuccess("Ledger уже был (idempotent)");
      else tSuccess("Ledger восстановлен");

      await load();

      if (selected?.payme_id === paymeId) {
        await openTx({ payme_id: paymeId });
      }
    } catch (e) {
      console.error(e);
      tError("Не удалось выполнить repair");
    } finally {
      setRepairingId(null);
    }
  }

  async function runAutoFix() {
    setAutoFixing(true);
    try {
      const res = await apiPost("/api/admin/payme/autofix", {}, "admin");

      tSuccess("Auto Fix завершен");

      await load();

      if (selected?.payme_id) {
        await openTx({ payme_id: selected.payme_id });
      }

      console.log("[payme-autofix-report]", res?.report || res);
    } catch (e) {
      console.error(e);
      tError("Auto Fix ошибка");
    } finally {
      setAutoFixing(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const qpPaymeId = String(searchParams.get("payme_id") || "").trim();
    if (!qpPaymeId) return;

    setQ(qpPaymeId);
    load(qpPaymeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <div className="space-y-4">
      {/* Single header for the whole Payme module */}
      <div className="bg-white rounded-xl shadow p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Payme Merchant Console</h2>
            <div className="text-xs text-gray-500 mt-1">
              Bank-grade monitoring: health, events, lab, dashboard, live.
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className={`px-3 py-1.5 rounded-lg text-sm ${
                tab === "health" ? "bg-black text-white" : "border bg-white"
              }`}
              onClick={() => setTab("health")}
            >
              Health
            </button>

            <button
              className={`px-3 py-1.5 rounded-lg text-sm ${
                tab === "events" ? "bg-black text-white" : "border bg-white"
              }`}
              onClick={() => setTab("events")}
            >
              Events
            </button>

            <button
              className={`px-3 py-1.5 rounded-lg text-sm ${
                tab === "lab" ? "bg-black text-white" : "border bg-white"
              }`}
              onClick={() => setTab("lab")}
              title={
                selected?.payme_id
                  ? "Открыть Payme Lab для выбранной транзакции"
                  : "Открыть Payme Lab"
              }
            >
              Lab
            </button>

            <button
              className={`px-3 py-1.5 rounded-lg text-sm ${
                tab === "dashboard" ? "bg-black text-white" : "border bg-white"
              }`}
              onClick={() => setTab("dashboard")}
              title="Общий мониторинг Payme"
            >
              Dashboard
            </button>

            <button
              className={`px-3 py-1.5 rounded-lg text-sm ${
                tab === "live" ? "bg-black text-white" : "border bg-white"
              }`}
              onClick={() => setTab("live")}
              title="Live мониторинг транзакций Payme"
            >
              Live
            </button>

            <button
              className="px-3 py-1.5 rounded-lg text-sm bg-red-600 text-white disabled:opacity-60"
              onClick={runAutoFix}
              disabled={autoFixing}
              title="Автоматически исправить типичные проблемы Payme"
            >
              {autoFixing ? "AUTO FIX…" : "AUTO FIX PAYME"}
            </button>
          </div>
        </div>
      </div>

      {/* Health */}
      {tab === "health" && (
        <>
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex flex-col md:flex-row gap-3 md:items-end">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">
                  Поиск (payme_id или order_id)
                </label>
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="pm_tx_... или 123"
                />
              </div>

              <div className="w-full md:w-40">
                <label className="block text-xs text-gray-500 mb-1">Limit</label>
                <input
                  type="number"
                  className="w-full border rounded-lg px-3 py-2"
                  value={limit}
                  onChange={(e) => setLimit(toNum(e.target.value) || 200)}
                  min={1}
                  max={2000}
                />
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={onlyBad}
                  onChange={(e) => setOnlyBad(e.target.checked)}
                />
                Только проблемы
              </label>

              <button
                className="px-4 py-2 rounded-lg bg-black text-white disabled:opacity-60"
                onClick={load}
                disabled={loading}
              >
                {loading ? "Загрузка…" : "Обновить"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-white rounded-xl shadow overflow-hidden">
              <div className="p-3 border-b flex items-center justify-between">
                <div className="text-sm text-gray-600">Transactions</div>
                <div className="text-xs text-gray-400">rows: {rows.length}</div>
              </div>

              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="text-left px-3 py-2">payme_id</th>
                      <th className="text-left px-3 py-2">order</th>
                      <th className="text-left px-3 py-2">state</th>
                      <th className="text-left px-3 py-2">amount</th>
                      <th className="text-left px-3 py-2">ledger_sum</th>
                      <th className="text-left px-3 py-2">status</th>
                      <th className="text-left px-3 py-2">billing</th>
                      <th className="text-right px-3 py-2">actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.payme_id}
                        className={`border-t hover:bg-gray-50 cursor-pointer ${
                          selected?.payme_id === r.payme_id ? "bg-gray-50" : ""
                        }`}
                        onClick={() => openTx(r)}
                      >
                        <td className="px-3 py-2 font-mono text-xs">{r.payme_id}</td>
                        <td className="px-3 py-2">{r.order_id}</td>
                        <td className="px-3 py-2">{r.state}</td>
                        <td className="px-3 py-2">{formatTiyinToSum(r.amount_tiyin)} сум</td>
                        <td className="px-3 py-2">{formatTiyinToSum(r.ledger_sum)} сум</td>
                        <td className="px-3 py-2">{badge(r.health_status)}</td>
                        <td className="px-3 py-2">{badge(r.billing_status)}</td>
                        <td
                          className="px-3 py-2 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-end gap-2">
                            <button
                              className="px-3 py-1 rounded-lg border bg-white hover:bg-gray-50"
                              onClick={() => openInLab(r)}
                              title="Открыть выбранную транзакцию в Payme Lab"
                            >
                              Open in Lab
                            </button>

                            {r.health_status === "LOST_PAYMENT" ? (
                              <button
                                className="px-3 py-1 rounded-lg bg-red-600 text-white disabled:opacity-60"
                                disabled={repairingId === r.payme_id}
                                onClick={() => repair(r.payme_id)}
                              >
                                {repairingId === r.payme_id ? "…" : "Repair"}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}

                    {!rows.length && (
                      <tr>
                        <td className="px-3 py-6 text-center text-gray-400" colSpan={8}>
                          Нет данных
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow p-4">
              <div className="text-sm text-gray-600 mb-2">Details</div>

              {!selected && (
                <div className="text-sm text-gray-400">Выберите транзакцию слева</div>
              )}

              {selected && (
                <div className="space-y-3">
                  <div className="text-xs text-gray-500">payme_id</div>
                  <div className="font-mono text-xs break-all">{selected.payme_id}</div>

                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <div className="text-xs text-gray-500">order_id</div>
                      <div>{selected.order_id}</div>
                    </div>

                    <div>
                      <div className="text-xs text-gray-500">state</div>
                      <div>{selected.state}</div>
                    </div>

                    <div>
                      <div className="text-xs text-gray-500">perform_time</div>
                      <div className="text-xs">{selected.perform_time || "—"}</div>
                    </div>

                    <div>
                      <div className="text-xs text-gray-500">updated_at</div>
                      <div className="text-xs">{fmtTs(selected.updated_at)}</div>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-gray-500 mb-1">Ledger rows</div>
                    <div className="text-xs text-gray-800">
                      {details?.ledger ? details.ledger.length : "—"}
                    </div>
                  </div>

                  {details?.ledger?.length ? (
                    <div className="border rounded-lg overflow-auto max-h-64">
                      <table className="min-w-full text-xs">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="text-left px-2 py-1">id</th>
                            <th className="text-left px-2 py-1">amount</th>
                            <th className="text-left px-2 py-1">source</th>
                            <th className="text-left px-2 py-1">created</th>
                          </tr>
                        </thead>
                        <tbody>
                          {details.ledger.map((l) => (
                            <tr key={l.id} className="border-t">
                              <td className="px-2 py-1">{l.id}</td>
                              <td className="px-2 py-1">{formatTiyinToSum(l.amount)} сум</td>
                              <td className="px-2 py-1">{l.source}</td>
                              <td className="px-2 py-1">{fmtTs(l.created_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Events */}
      {tab === "events" && <AdminPaymeEvents />}

      {/* Lab */}
      {tab === "lab" && (
        <PaymeLab
          embedded
          seed={
            selected
              ? {
                  orderId: selected.order_id,
                  amount: selected.amount_tiyin,
                  paymeId: selected.payme_id,
                }
              : null
          }
        />
      )}

      {/* Dashboard */}
      {tab === "dashboard" && <PaymeDashboard />}

      {/* Live */}
      {tab === "live" && <PaymeLive />}
    </div>
  );
}
