// frontend/src/pages/admin/PaymeLab.jsx

import { useMemo, useState } from "react";
import { apiPost } from "../../api";
import { tError, tSuccess } from "../../shared/toast";

function nowMs() {
  return Date.now();
}

function toInt(x, def = 0) {
  const n = Number(String(x ?? "").trim());
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function pretty(x) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

function isoToMs(iso) {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function msToLocalIsoInput(ms) {
  // input[type=datetime-local] expects YYYY-MM-DDTHH:mm
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

export default function PaymeLab() {
  // Core inputs
  const [orderId, setOrderId] = useState("11");
  const [amount, setAmount] = useState("100000"); // tiyins
  const [paymeId, setPaymeId] = useState(`pm_lab_tx_${nowMs()}`);
  const [cancelReason, setCancelReason] = useState("");

  // GetStatement range
  const [fromIso, setFromIso] = useState(msToLocalIsoInput(nowMs() - 60 * 60 * 1000));
  const [toIso, setToIso] = useState(msToLocalIsoInput(nowMs() + 5 * 60 * 1000));

  // UI state
  const [busy, setBusy] = useState(false);
  const [lastSnap, setLastSnap] = useState(null);
  const [history, setHistory] = useState([]); // newest first

  const parsed = useMemo(() => {
    return {
      orderId: String(orderId || "").trim(),
      amount: toInt(amount, 0),
      paymeId: String(paymeId || "").trim(),
      cancelReason: cancelReason === "" ? null : toInt(cancelReason, null),
      from: isoToMs(fromIso),
      to: isoToMs(toIso),
    };
  }, [orderId, amount, paymeId, cancelReason, fromIso, toIso]);

  async function run(method, params) {
    setBusy(true);
    try {
      const data = await apiPost(
        "/api/admin/payme/lab/run",
        { method, params },
        "admin"
      );

      const snap = {
        ts: nowMs(),
        method,
        params,
        rpc: data?.rpc,
        result: data?.result,
      };

      setLastSnap(snap);
      setHistory((prev) => [snap, ...prev].slice(0, 30));
      tSuccess(`${method}: OK`);
      return snap;
    } catch (e) {
      console.error(e);
      tError(`${method}: ошибка`);
      const snap = {
        ts: nowMs(),
        method,
        params,
        error: e?.message || e,
      };
      setLastSnap(snap);
      setHistory((prev) => [snap, ...prev].slice(0, 30));
      return null;
    } finally {
      setBusy(false);
    }
  }

  function buildCheck() {
    return { amount: parsed.amount, account: { order_id: parsed.orderId } };
  }
  function buildCreate() {
    return {
      id: parsed.paymeId,
      time: nowMs(),
      amount: parsed.amount,
      account: { order_id: parsed.orderId },
    };
  }
  function buildPerform() {
    return { id: parsed.paymeId };
  }
  function buildCancel() {
    const p = { id: parsed.paymeId };
    if (parsed.cancelReason !== null) p.reason = parsed.cancelReason;
    return p;
  }
  function buildStatement() {
    return {
      from: parsed.from || nowMs() - 60 * 60 * 1000,
      to: parsed.to || nowMs(),
    };
  }

  async function runFullScenario() {
    // Bank-grade flow (happy path): Check -> Create -> Perform -> GetStatement
    setBusy(true);
    try {
      const ok1 = await run("CheckPerformTransaction", buildCheck());
      if (!ok1) return;

      const ok2 = await run("CreateTransaction", buildCreate());
      if (!ok2) return;

      const ok3 = await run("PerformTransaction", buildPerform());
      if (!ok3) return;

      await run("GetStatement", buildStatement());
      tSuccess("RUN FULL SCENARIO: done");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Payme Lab (Admin)</h1>
          <p className="text-sm text-gray-500">
            Кнопки Merchant API через серверный прокси (Basic Auth хранится на backend).
          </p>
        </div>

        <button
          className="px-4 py-2 rounded-lg bg-black text-white disabled:opacity-60"
          onClick={runFullScenario}
          disabled={busy}
          title="Check → Create → Perform → GetStatement"
        >
          {busy ? "RUN…" : "RUN FULL SCENARIO"}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Controls */}
        <div className="lg:col-span-1 bg-white rounded-xl shadow p-4">
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">order_id</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                placeholder="например 11"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">amount (tiyin)</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="100000"
              />
              <div className="text-[11px] text-gray-400 mt-1">
                Например 100000 = 1 000.00 UZS (если minor=100)
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">payme tx id (params.id)</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={paymeId}
                onChange={(e) => setPaymeId(e.target.value)}
              />
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border bg-white text-sm"
                  onClick={() => setPaymeId(`pm_lab_tx_${nowMs()}`)}
                  disabled={busy}
                >
                  New tx_id
                </button>
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border bg-white text-sm"
                  onClick={() => {
                    setFromIso(msToLocalIsoInput(nowMs() - 60 * 60 * 1000));
                    setToIso(msToLocalIsoInput(nowMs() + 5 * 60 * 1000));
                  }}
                  disabled={busy}
                >
                  Reset range
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">GetStatement from</label>
                <input
                  type="datetime-local"
                  className="w-full border rounded-lg px-3 py-2"
                  value={fromIso}
                  onChange={(e) => setFromIso(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">GetStatement to</label>
                <input
                  type="datetime-local"
                  className="w-full border rounded-lg px-3 py-2"
                  value={toIso}
                  onChange={(e) => setToIso(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Cancel reason (optional)</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="например 1"
              />
            </div>

            <div className="pt-2 grid grid-cols-1 gap-2">
              <button
                className="px-4 py-2 rounded-lg bg-black text-white disabled:opacity-60"
                onClick={() => run("CheckPerformTransaction", buildCheck())}
                disabled={busy}
              >
                CheckPerformTransaction
              </button>
              <button
                className="px-4 py-2 rounded-lg border bg-white disabled:opacity-60"
                onClick={() => run("CreateTransaction", buildCreate())}
                disabled={busy}
              >
                CreateTransaction
              </button>
              <button
                className="px-4 py-2 rounded-lg border bg-white disabled:opacity-60"
                onClick={() => run("PerformTransaction", buildPerform())}
                disabled={busy}
              >
                PerformTransaction
              </button>
              <button
                className="px-4 py-2 rounded-lg border bg-white disabled:opacity-60"
                onClick={() => run("CancelTransaction", buildCancel())}
                disabled={busy}
              >
                CancelTransaction
              </button>
              <button
                className="px-4 py-2 rounded-lg border bg-white disabled:opacity-60"
                onClick={() => run("GetStatement", buildStatement())}
                disabled={busy}
              >
                GetStatement
              </button>
            </div>
          </div>
        </div>

        {/* Middle: Snapshot */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow overflow-hidden">
          <div className="p-3 border-b flex items-center justify-between">
            <div className="text-sm text-gray-600">Snapshot</div>
            <div className="text-xs text-gray-400">history: {history.length}/30</div>
          </div>

          {!lastSnap ? (
            <div className="p-4 text-sm text-gray-500">Нажми любую кнопку — тут появится RPC + ответ.</div>
          ) : (
            <div className="p-4 grid grid-cols-1 gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700">
                  {new Date(lastSnap.ts).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" })}
                </span>
                <span className="text-xs px-2 py-1 rounded bg-black text-white">{lastSnap.method}</span>
                {lastSnap?.result?.error && (
                  <span className="text-xs px-2 py-1 rounded bg-red-100 text-red-700">RPC error</span>
                )}
                {lastSnap?.error && (
                  <span className="text-xs px-2 py-1 rounded bg-red-100 text-red-700">HTTP error</span>
                )}
              </div>

              <div>
                <div className="text-xs text-gray-500 mb-1">Request body (sent to /api/admin/payme/lab/run)</div>
                <pre className="text-xs bg-gray-50 border rounded-lg p-3 overflow-auto">
                  {pretty({ method: lastSnap.method, params: lastSnap.params })}
                </pre>
              </div>

              <div>
                <div className="text-xs text-gray-500 mb-1">Backend result</div>
                <pre className="text-xs bg-gray-50 border rounded-lg p-3 overflow-auto">
                  {pretty(lastSnap.result ?? lastSnap.error)}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Bottom: History list */}
        <div className="lg:col-span-3 bg-white rounded-xl shadow overflow-hidden">
          <div className="p-3 border-b flex items-center justify-between">
            <div className="text-sm text-gray-600">History</div>
            <button
              type="button"
              className="text-sm px-3 py-1.5 rounded-lg border bg-white"
              onClick={() => {
                setHistory([]);
                setLastSnap(null);
              }}
              disabled={busy}
            >
              Clear
            </button>
          </div>
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-3 py-2">time</th>
                  <th className="text-left px-3 py-2">method</th>
                  <th className="text-left px-3 py-2">order_id</th>
                  <th className="text-left px-3 py-2">amount</th>
                  <th className="text-left px-3 py-2">id</th>
                  <th className="text-right px-3 py-2">open</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-gray-500" colSpan={6}>
                      пусто
                    </td>
                  </tr>
                ) : (
                  history.map((h, idx) => (
                    <tr key={`${h.ts}_${idx}`} className="border-t">
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {new Date(h.ts).toLocaleTimeString("ru-RU", { timeZone: "Asia/Tashkent" })}
                      </td>
                      <td className="px-3 py-2 font-medium">{h.method}</td>
                      <td className="px-3 py-2">{String(h?.params?.account?.order_id ?? "—")}</td>
                      <td className="px-3 py-2">{String(h?.params?.amount ?? "—")}</td>
                      <td className="px-3 py-2">{String(h?.params?.id ?? "—")}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-lg border bg-white"
                          onClick={() => setLastSnap(h)}
                        >
                          Open
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
    </div>
  );
}
