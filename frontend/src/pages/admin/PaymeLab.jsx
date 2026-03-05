// frontend/src/pages/admin/PaymeLab.jsx

import { useEffect, useMemo, useState } from "react";
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

function normalizeSeed(seed) {
  if (!seed) return null;
  const s = typeof seed === "object" ? seed : null;
  if (!s) return null;
  return {
    orderId: s.orderId != null ? String(s.orderId) : "",
    amount: s.amount != null ? String(s.amount) : "",
    paymeId: s.paymeId != null ? String(s.paymeId) : "",
  };
}

function makeNewTxId() {
  return `pm_lab_tx_${nowMs()}`;
}

/**
 * Props:
 * - embedded?: boolean
 * - seed?: { orderId?: string|number, amount?: string|number, paymeId?: string }
 */
export default function PaymeLab({ embedded = false, seed = null } = {}) {
  // Core inputs
  const [orderId, setOrderId] = useState("11");
  const [amount, setAmount] = useState("100000"); // tiyins
  const [paymeId, setPaymeId] = useState(makeNewTxId());

  // last selected payme id from Health
  const [seedPaymeId, setSeedPaymeId] = useState("");

  // tx id mode:
  // - "seed": use selected tx_id from Health (for Perform/Cancel on existing)
  // - "new": use custom/new tx_id (for Create new)
  const [txMode, setTxMode] = useState("new");

  // Cancel reason presets
  const CANCEL_PRESETS = [
    { value: "", label: "— не указывать (null)" },
    { value: "1", label: "1 — отмена по инициативе клиента" },
    { value: "2", label: "2 — отмена по инициативе мерчанта" },
    { value: "3", label: "3 — истёк таймаут / не выполнено" },
    { value: "custom", label: "Custom…" },
  ];
  const [cancelPreset, setCancelPreset] = useState("");
  const [cancelCustom, setCancelCustom] = useState("");

  // GetStatement range
  const [fromIso, setFromIso] = useState(msToLocalIsoInput(nowMs() - 60 * 60 * 1000));
  const [toIso, setToIso] = useState(msToLocalIsoInput(nowMs() + 5 * 60 * 1000));

  // UI state
  const [busy, setBusy] = useState(false);
  const [lastSnap, setLastSnap] = useState(null);
  const [history, setHistory] = useState([]); // newest first

  // Apply seed from parent (AdminPaymeHealth -> Lab tab)
  useEffect(() => {
    const s = normalizeSeed(seed);
    if (!s) return;

    if (s.orderId) setOrderId(String(s.orderId));
    if (s.amount) setAmount(String(s.amount));

    if (s.paymeId) setSeedPaymeId(String(s.paymeId));
    else setSeedPaymeId("");

    // If currently in seed-mode, follow selected tx_id
    if (txMode === "seed" && s.paymeId) {
      setPaymeId(String(s.paymeId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.orderId, seed?.amount, seed?.paymeId]);

  // If user switches txMode manually
  useEffect(() => {
    if (txMode === "seed") {
      if (seedPaymeId) setPaymeId(seedPaymeId);
      else {
        tError("Нет выбранного tx_id из Health");
        setTxMode("new");
      }
    }
    if (txMode === "new") {
      // if accidentally equals seed -> create a fresh one
      if (seedPaymeId && paymeId === seedPaymeId) {
        setPaymeId(makeNewTxId());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txMode]);

  const parsed = useMemo(() => {
    const orderId2 = String(orderId || "").trim();
    const amount2 = toInt(amount, 0);
    const paymeId2 = String(paymeId || "").trim();

    let cancelReason = null;
    if (cancelPreset === "custom") {
      cancelReason = cancelCustom === "" ? null : toInt(cancelCustom, null);
    } else if (cancelPreset === "") {
      cancelReason = null;
    } else {
      cancelReason = toInt(cancelPreset, null);
    }

    return {
      orderId: orderId2,
      amount: amount2,
      paymeId: paymeId2,
      cancelReason,
      from: isoToMs(fromIso),
      to: isoToMs(toIso),
    };
  }, [orderId, amount, paymeId, cancelPreset, cancelCustom, fromIso, toIso]);

  function canRunBasic() {
    if (!parsed.orderId) return false;
    if (!Number.isFinite(parsed.amount) || parsed.amount <= 0) return false;
    return true;
  }

  function canRunIdOnly() {
    if (!parsed.paymeId) return false;
    return true;
  }

  // ---- RPC runner ----
  async function run(method, params) {
    setBusy(true);
    try {
      const data = await apiPost("/api/admin/payme/lab/run", { method, params }, "admin");

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

  // ---- Builders ----
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

  // ---- BANK-GRADE GUARD RAILS ----
  function switchToSeedOrFail() {
    if (!seedPaymeId) {
      tError("Нет выбранного tx_id из Health. Открой транзакцию в Health → Open in Lab.");
      return false;
    }
    if (txMode !== "seed") setTxMode("seed");
    if (paymeId !== seedPaymeId) setPaymeId(seedPaymeId);
    return true;
  }

  function switchToNewEnsuringFreshTxId() {
    if (txMode !== "new") setTxMode("new");
    // if current equals seed or empty -> generate fresh
    if (!paymeId || (seedPaymeId && paymeId === seedPaymeId)) {
      setPaymeId(makeNewTxId());
      return true;
    }
    return true;
  }

  function ensureCreateSafeOrFix() {
    // Always run Create only in NEW mode, and never with seed tx id.
    switchToNewEnsuringFreshTxId();
    // After setState, paymeId updates async; but guard rail still helps user.
    // We additionally hard-check current values.
    if (txMode === "seed") {
      tError("Create запрещён в режиме selected tx_id (seed). Переключил на new.");
      return false;
    }
    if (!paymeId) {
      tError("tx_id пуст. Нажми Generate new tx_id.");
      return false;
    }
    if (seedPaymeId && paymeId === seedPaymeId) {
      tError("tx_id совпал с выбранным (seed). Нажми Generate new tx_id.");
      return false;
    }
    return true;
  }

  // ---- Quick actions ----
  async function runCreateOnly() {
    if (!canRunBasic()) return tError("Заполни order_id и amount");
    if (!ensureCreateSafeOrFix()) return;
    await run("CreateTransaction", buildCreate());
  }

  async function runCreateAndPerform() {
    if (!canRunBasic()) return tError("Заполни order_id и amount");
    if (!ensureCreateSafeOrFix()) return;

    const ok2 = await run("CreateTransaction", buildCreate());
    if (!ok2) return;
    await run("PerformTransaction", buildPerform());
  }

  async function runCheckCreatePerform() {
    if (!canRunBasic()) return tError("Заполни order_id и amount");

    const ok1 = await run("CheckPerformTransaction", buildCheck());
    if (!ok1) return;

    if (!ensureCreateSafeOrFix()) return;

    const ok2 = await run("CreateTransaction", buildCreate());
    if (!ok2) return;

    await run("PerformTransaction", buildPerform());
  }

  // ---- Scenario presets (bank-grade) ----
  async function scenarioReconcileStatement() {
    await run("GetStatement", buildStatement());
  }

  async function scenarioCancelSelectedThenStatement() {
    // auto switch to seed and set seed tx_id
    if (!switchToSeedOrFail()) return;
    if (!canRunIdOnly()) return tError("Нужен tx_id");
    const ok = await run("CancelTransaction", buildCancel());
    if (!ok) return;
    await run("GetStatement", buildStatement());
    tSuccess("Scenario: Cancel selected → Statement done");
  }

  async function scenarioHappyPathNewPayment() {
    // auto: switch new + ensure fresh tx_id
    if (!canRunBasic()) return tError("Заполни order_id и amount");

    switchToNewEnsuringFreshTxId();
    // hard guard
    if (!ensureCreateSafeOrFix()) return;

    const ok1 = await run("CheckPerformTransaction", buildCheck());
    if (!ok1) return;

    const ok2 = await run("CreateTransaction", buildCreate());
    if (!ok2) return;

    const ok3 = await run("PerformTransaction", buildPerform());
    if (!ok3) return;

    await run("GetStatement", buildStatement());
    tSuccess("Scenario: Happy path (new) done");
  }

  async function scenarioCreatePerformThenCancel() {
    // auto: switch new + ensure fresh tx_id
    if (!canRunBasic()) return tError("Заполни order_id и amount");

    switchToNewEnsuringFreshTxId();
    if (!ensureCreateSafeOrFix()) return;

    const ok1 = await run("CheckPerformTransaction", buildCheck());
    if (!ok1) return;

    const ok2 = await run("CreateTransaction", buildCreate());
    if (!ok2) return;

    const ok3 = await run("PerformTransaction", buildPerform());
    if (!ok3) return;

    const ok4 = await run("CancelTransaction", buildCancel());
    if (!ok4) return;

    await run("GetStatement", buildStatement());
    tSuccess("Scenario: Create→Perform→Cancel done");
  }

  async function runFullScenario() {
    // keep: happy path new payment
    return scenarioHappyPathNewPayment();
  }

  const Wrapper = ({ children }) =>
    embedded ? (
      <div>{children}</div>
    ) : (
      <div className="p-4 md:p-6">
        <h1 className="text-xl font-semibold mb-1">Payme Lab (Admin)</h1>
        <p className="text-sm text-gray-500 mb-4">
          Merchant RPC через серверный прокси (Basic Auth хранится на backend).
        </p>
        {children}
      </div>
    );

  return (
    <Wrapper>
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-lg font-semibold">Payme Lab</div>
          <div className="text-sm text-gray-500">
            Merchant RPC actions + bank-grade presets + auto-snapshot
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="px-4 py-2 rounded-lg bg-black text-white disabled:opacity-60"
            onClick={runFullScenario}
            disabled={busy}
            title="Happy path: Check → Create → Perform → GetStatement"
          >
            {busy ? "RUN…" : "RUN FULL SCENARIO"}
          </button>
        </div>
      </div>

      {/* Scenario presets */}
      <div className="mb-4 bg-white rounded-xl shadow p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-gray-800">Scenario presets</div>
            <div className="text-xs text-gray-500">
              One-click sequences. Guard rails: авто txMode + авто tx_id.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              className="px-3 py-2 rounded-lg border bg-white text-sm disabled:opacity-60"
              onClick={scenarioReconcileStatement}
              disabled={busy}
              title="GetStatement по диапазону"
            >
              Reconcile (Statement)
            </button>

            <button
              className="px-3 py-2 rounded-lg border bg-white text-sm disabled:opacity-60"
              onClick={scenarioCancelSelectedThenStatement}
              disabled={busy}
              title="Cancel selected (auto seed) → Statement"
            >
              Cancel selected tx → Statement
            </button>

            <button
              className="px-3 py-2 rounded-lg border bg-white text-sm disabled:opacity-60"
              onClick={scenarioHappyPathNewPayment}
              disabled={busy}
              title="Happy path new payment (auto new + fresh tx_id)"
            >
              Happy path (new payment)
            </button>

            <button
              className="px-3 py-2 rounded-lg border bg-white text-sm disabled:opacity-60"
              onClick={scenarioCreatePerformThenCancel}
              disabled={busy}
              title="Test cancel after perform (auto new + fresh tx_id)"
            >
              Create+Perform → Cancel (test)
            </button>
          </div>
        </div>
      </div>

      {/* TX MODE SWITCH */}
      <div className="mb-4 bg-white rounded-xl shadow p-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <div className="text-sm text-gray-700 font-medium">tx_id mode</div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="txmode"
                value="seed"
                checked={txMode === "seed"}
                onChange={() => setTxMode("seed")}
                disabled={busy}
              />
              Use selected tx_id
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="txmode"
                value="new"
                checked={txMode === "new"}
                onChange={() => setTxMode("new")}
                disabled={busy}
              />
              Use new tx_id
            </label>

            <button
              type="button"
              className="px-3 py-1.5 rounded-lg border bg-white text-sm disabled:opacity-60"
              disabled={busy}
              onClick={() => {
                setTxMode("new");
                setPaymeId(makeNewTxId());
                tSuccess("Новый tx_id создан");
              }}
              title="Переключить на new и сгенерировать новый tx_id"
            >
              Generate new tx_id
            </button>
          </div>
        </div>

        <div className="mt-2 text-xs text-gray-500">
          Selected tx_id:{" "}
          <span className="font-mono">{seedPaymeId ? seedPaymeId : "—"}</span>
          <span className="mx-2">•</span>
          Current tx_id: <span className="font-mono">{parsed.paymeId || "—"}</span>
          {txMode === "seed" ? (
            <span className="ml-2 text-gray-400">(для Perform/Cancel по выбранному)</span>
          ) : (
            <span className="ml-2 text-gray-400">(для Create нового платежа)</span>
          )}
        </div>
      </div>

      {/* Quick actions row */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          className="px-3 py-2 rounded-lg border bg-white disabled:opacity-60 text-sm"
          onClick={runCreateOnly}
          disabled={busy}
          title="CreateTransaction (только создать) — auto new + guard rails"
        >
          Create only
        </button>
        <button
          className="px-3 py-2 rounded-lg border bg-white disabled:opacity-60 text-sm"
          onClick={runCreateAndPerform}
          disabled={busy}
          title="Create → Perform — auto new + guard rails"
        >
          Create + Perform
        </button>
        <button
          className="px-3 py-2 rounded-lg border bg-white disabled:opacity-60 text-sm"
          onClick={runCheckCreatePerform}
          disabled={busy}
          title="Check → Create → Perform — auto new + guard rails"
        >
          Check + Create + Perform
        </button>
        <button
          type="button"
          className="px-3 py-2 rounded-lg border bg-white disabled:opacity-60 text-sm"
          onClick={() => {
            setTxMode("new");
            setPaymeId(makeNewTxId());
          }}
          disabled={busy}
          title="Сгенерировать новый tx_id"
        >
          New tx_id
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Controls */}
        <div className="lg:col-span-1 bg-white rounded-xl shadow p-4">
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">order_id</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                placeholder="например 11"
                disabled={busy}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">amount (tiyin)</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="100000"
                disabled={busy}
              />
              <div className="text-[11px] text-gray-400 mt-1">
                Например 100000 = 1 000.00 UZS (если minor=100)
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">
                payme tx id (params.id)
              </label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={paymeId}
                onChange={(e) => setPaymeId(e.target.value)}
                disabled={busy || txMode === "seed"}
                title={txMode === "seed" ? "В режиме selected tx_id поле редактировать нельзя" : ""}
              />
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border bg-white text-sm disabled:opacity-60"
                  onClick={() => {
                    setTxMode("new");
                    setPaymeId(makeNewTxId());
                  }}
                  disabled={busy}
                >
                  New tx_id
                </button>
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border bg-white text-sm disabled:opacity-60"
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

            {/* Cancel reason presets */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Cancel reason</label>
              <select
                className="w-full border rounded-lg px-3 py-2 bg-white"
                value={cancelPreset}
                onChange={(e) => setCancelPreset(e.target.value)}
                disabled={busy}
              >
                {CANCEL_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              {cancelPreset === "custom" && (
                <div className="mt-2">
                  <input
                    className="w-full border rounded-lg px-3 py-2"
                    value={cancelCustom}
                    onChange={(e) => setCancelCustom(e.target.value)}
                    placeholder="введи число, например 1"
                    disabled={busy}
                  />
                </div>
              )}
              <div className="text-[11px] text-gray-400 mt-1">
                Если выбрать “не указывать”, поле reason не отправляется (null).
              </div>
            </div>

            {/* GetStatement range */}
            <div className="grid grid-cols-1 gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">GetStatement from</label>
                <input
                  type="datetime-local"
                  className="w-full border rounded-lg px-3 py-2"
                  value={fromIso}
                  onChange={(e) => setFromIso(e.target.value)}
                  disabled={busy}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">GetStatement to</label>
                <input
                  type="datetime-local"
                  className="w-full border rounded-lg px-3 py-2"
                  value={toIso}
                  onChange={(e) => setToIso(e.target.value)}
                  disabled={busy}
                />
              </div>
            </div>

            {/* Buttons */}
            <div className="pt-2 grid grid-cols-1 gap-2">
              <button
                className="px-4 py-2 rounded-lg bg-black text-white disabled:opacity-60"
                onClick={() => {
                  if (!canRunBasic()) return tError("Заполни order_id и amount");
                  run("CheckPerformTransaction", buildCheck());
                }}
                disabled={busy}
              >
                CheckPerformTransaction
              </button>

              <button
                className="px-4 py-2 rounded-lg border bg-white disabled:opacity-60"
                onClick={() => {
                  if (!canRunBasic()) return tError("Заполни order_id и amount");
                  if (!ensureCreateSafeOrFix()) return;
                  run("CreateTransaction", buildCreate());
                }}
                disabled={busy}
              >
                CreateTransaction
              </button>

              <button
                className="px-4 py-2 rounded-lg border bg-white disabled:opacity-60"
                onClick={() => {
                  if (!canRunIdOnly()) return tError("Нужен tx_id");
                  run("PerformTransaction", buildPerform());
                }}
                disabled={busy}
              >
                PerformTransaction
              </button>

              <button
                className="px-4 py-2 rounded-lg border bg-white disabled:opacity-60"
                onClick={() => {
                  if (!canRunIdOnly()) return tError("Нужен tx_id");
                  run("CancelTransaction", buildCancel());
                }}
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

        {/* Snapshot */}
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

        {/* History */}
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
    </Wrapper>
  );
}
