// frontend/src/pages/admin/PaymeLab.jsx

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiGet, apiPost } from "../../api";
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

function fmtTs(x) {
  if (!x) return "—";
  try {
    return new Date(x).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" });
  } catch {
    return String(x);
  }
}

function money(x) {
  return Math.round(Number(x || 0)).toLocaleString("ru-RU");
}

function badgePill(kind, text) {
  const base = "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium";
  const map = {
    ok: "bg-green-100 text-green-700",
    warn: "bg-yellow-100 text-yellow-800",
    bad: "bg-red-100 text-red-700",
    info: "bg-gray-100 text-gray-700",
    purple: "bg-purple-100 text-purple-800",
    orange: "bg-orange-100 text-orange-800",
    black: "bg-black text-white",
  };
  const cls = map[kind] || map.info;
  return <span className={`${base} ${cls}`}>{text}</span>;
}

function healthStatusFromDetails(details) {
  const tx = details?.tx;
  if (!tx) return null;

  const state = Number(tx.state);
  const amount = Number(tx.amount_tiyin || 0);
  const ledger = Array.isArray(details?.ledger) ? details.ledger : [];
  const ledgerRows = ledger.length;
  const ledgerSum = ledger.reduce((s, r) => s + Number(r?.amount || 0), 0);

  if (state === 1 && Number(tx.create_time) > 0) {
    const ageSec = (Date.now() - Number(tx.create_time)) / 1000;
    if (ageSec > 900) return "STUCK";
  }
  if (state === 2 && ledgerRows === 0) return "LOST_PAYMENT";
  if (state === 2 && ledgerSum <= 0) return "BAD_AMOUNT";
  if ((state === -1 || state === -2) && ledgerSum > 0) return "REFUND_MISMATCH";
  if (state === 2 && ledgerRows > 0 && amount > 0 && ledgerSum !== amount) {
    return "AMOUNT_MISMATCH";
  }

  return "OK";
}

function timelineTone(tone) {
  if (tone === "ok") return "border-green-200 bg-green-50";
  if (tone === "warn") return "border-yellow-200 bg-yellow-50";
  if (tone === "bad") return "border-red-200 bg-red-50";
  return "border-gray-200 bg-gray-50";
}

function timelineDotTone(tone) {
  if (tone === "ok") return "bg-green-500";
  if (tone === "warn") return "bg-yellow-500";
  if (tone === "bad") return "bg-red-500";
  return "bg-gray-300";
}

function parseMaybeJson(x) {
  if (x == null) return null;
  if (typeof x === "object") return x;
  const s = String(x).trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function pickFirstDefined(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") {
      return obj[k];
    }
  }
  return null;
}

function extractRawPayload(eventRow) {
  if (!eventRow || typeof eventRow !== "object") {
    return {
      request: null,
      response: null,
      error: null,
    };
  }

  const request = parseMaybeJson(
    pickFirstDefined(eventRow, [
      "request_body",
      "request_payload",
      "request_json",
      "req_body",
      "req_payload",
      "payload",
      "params",
      "request",
      "rpc",
      "body",
    ])
  );

  const response = parseMaybeJson(
    pickFirstDefined(eventRow, [
      "response_body",
      "response_payload",
      "response_json",
      "res_body",
      "res_payload",
      "result",
      "response",
      "rpc_result",
      "data",
    ])
  );

  const error = parseMaybeJson(
    pickFirstDefined(eventRow, [
      "error_body",
      "error_payload",
      "error_json",
      "error",
      "error_message",
      "exception",
    ])
  );

  return { request, response, error };
}

export default function PaymeLab({ embedded = false, seed = null } = {}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [orderId, setOrderId] = useState("11");
  const [amount, setAmount] = useState("100000");
  const [paymeId, setPaymeId] = useState(makeNewTxId());

  const [seedPaymeId, setSeedPaymeId] = useState("");
  const [txMode, setTxMode] = useState("new");

  const CANCEL_PRESETS = [
    { value: "", label: "— не указывать (null)" },
    { value: "1", label: "1 — отмена по инициативе клиента" },
    { value: "2", label: "2 — отмена по инициативе мерчанта" },
    { value: "3", label: "3 — истёк таймаут / не выполнено" },
    { value: "custom", label: "Custom…" },
  ];

  const [cancelPreset, setCancelPreset] = useState("");
  const [cancelCustom, setCancelCustom] = useState("");
  
  const [fromIso, setFromIso] = useState(msToLocalIsoInput(nowMs() - 60 * 60 * 1000));
  const [toIso, setToIso] = useState(msToLocalIsoInput(nowMs() + 5 * 60 * 1000));
  
  const [fiscalReceiptId, setFiscalReceiptId] = useState("");
  const [fiscalTerminalId, setFiscalTerminalId] = useState("PAYME_LAB");
  const [fiscalSign, setFiscalSign] = useState("");
  const [fiscalDateTime, setFiscalDateTime] = useState(msToLocalIsoInput(nowMs()));

  const [busy, setBusy] = useState(false);
  const [lastSnap, setLastSnap] = useState(null);
  const [history, setHistory] = useState([]);

  const [autoStatus, setAutoStatus] = useState(true);
  const [statusLoading, setStatusLoading] = useState(false);
  const [txDetails, setTxDetails] = useState(null);
  const [txDetailsErr, setTxDetailsErr] = useState("");
  const [repairing, setRepairing] = useState(false);

  const [newClientId, setNewClientId] = useState("");
  const [newAmountTiyin, setNewAmountTiyin] = useState("100000");
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [createdOrder, setCreatedOrder] = useState(null);

  const [inspectOrderId, setInspectOrderId] = useState("");
  const [inspectLoading, setInspectLoading] = useState(false);
  const [orderDetails, setOrderDetails] = useState(null);
  const [orderDetailsErr, setOrderDetailsErr] = useState("");

  const [inspectorEvents, setInspectorEvents] = useState([]);
  const [inspectorEventsLoading, setInspectorEventsLoading] = useState(false);
  const [inspectorEventsErr, setInspectorEventsErr] = useState("");

  const [openRpcRaw, setOpenRpcRaw] = useState({});

  function toggleRpcRaw(method) {
    setOpenRpcRaw((prev) => ({
      ...prev,
      [method]: !prev[method],
    }));
  }

  function openInHealthByPaymeId(id) {
    const paymeId2 = String(id || "").trim();
    if (!paymeId2) {
      tError("Нет payme_id для перехода в Health");
      return;
    }
    navigate(`/admin/finance?tab=payme&payme_id=${encodeURIComponent(paymeId2)}`);
  }

  useEffect(() => {
    const s = normalizeSeed(seed);
    if (!s) return;

    if (s.orderId) {
      setOrderId(String(s.orderId));
      setInspectOrderId(String(s.orderId));
    }
    if (s.amount) setAmount(String(s.amount));

    if (s.paymeId) setSeedPaymeId(String(s.paymeId));
    else setSeedPaymeId("");

    if (txMode === "seed" && s.paymeId) {
      setPaymeId(String(s.paymeId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.orderId, seed?.amount, seed?.paymeId]);

  useEffect(() => {
    if (txMode === "seed") {
      if (seedPaymeId) setPaymeId(seedPaymeId);
      else {
        tError("Нет выбранного tx_id из Health");
        setTxMode("new");
      }
    }
    if (txMode === "new") {
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

  async function loadInspectorEvents(orderIdOverride = null, paymeIdOverride = null, silent = true) {
    const oid = String(orderIdOverride || inspectOrderId || orderId || "").trim();
    const pid = String(paymeIdOverride || "").trim();

    const qValue = pid || oid;
    if (!qValue) {
      setInspectorEvents([]);
      setInspectorEventsErr("");
      return;
    }

    setInspectorEventsLoading(true);
    setInspectorEventsErr("");

    try {
      const data = await apiGet(
        `/api/admin/payme/events?limit=100&q=${encodeURIComponent(qValue)}`,
        "admin"
      );

      const rows = Array.isArray(data?.rows) ? data.rows : [];

      const filtered = rows.filter((r) => {
        const rowOrderId = String(r?.order_id ?? "").trim();
        const rowPaymeId = String(r?.payme_id ?? "").trim();

        if (pid && rowPaymeId === pid) return true;
        if (oid && rowOrderId === oid) return true;
        return false;
      });

      setInspectorEvents(filtered);
    } catch (e) {
      console.error(e);
      setInspectorEvents([]);
      setInspectorEventsErr(e?.message || "Events load error");
      if (!silent) tError("Не удалось загрузить события Payme");
    } finally {
      setInspectorEventsLoading(false);
    }
  }

  async function inspectOrder(idOverride = null, silent = false) {
    const id = String(idOverride || inspectOrderId || orderId || "").trim();
    if (!id) {
      setOrderDetails(null);
      setOrderDetailsErr("");
      return;
    }

    setInspectLoading(true);
    setOrderDetailsErr("");
    try {
      const data = await apiGet(
        `/api/admin/payme/lab/orders/${encodeURIComponent(id)}/inspect`,
        "admin"
      );

      setOrderDetails(data);

      const latestTx =
        Array.isArray(data?.transactions) && data.transactions.length ? data.transactions[0] : null;

      await loadInspectorEvents(String(data?.order?.id || id), String(latestTx?.payme_id || ""));

      if (!silent) tSuccess("Order inspected");
    } catch (e) {
      console.error(e);
      setOrderDetails(null);
      setOrderDetailsErr(e?.message || "Inspect error");
      if (!silent) tError("Inspect order: ошибка");
    } finally {
      setInspectLoading(false);
    }
  }

  async function createOrder() {
    const clientId = toInt(newClientId, 0);
    const amountTiyin = toInt(newAmountTiyin, 0);

    if (!clientId) return tError("Укажи существующий client_id");
    if (!amountTiyin || amountTiyin <= 0) return tError("Укажи amount_tiyin > 0");

    setCreatingOrder(true);
    try {
      const data = await apiPost(
        "/api/admin/payme/lab/orders/create",
        { client_id: clientId, amount_tiyin: amountTiyin, provider: "payme", status: "created" },
        "admin"
      );

      const ord = data?.order || null;
      setCreatedOrder(data);

      if (ord?.id) {
        setOrderId(String(ord.id));
        setInspectOrderId(String(ord.id));
        setAmount(String(ord.amount_tiyin ?? amountTiyin));
        setPaymeId(makeNewTxId());
        setTxMode("new");
        await inspectOrder(String(ord.id), true);
        tSuccess(`Order #${ord.id} создан`);
      } else {
        tSuccess("Order создан");
      }
    } catch (e) {
      console.error(e);
      tError(e?.message || "Create order: ошибка");
    } finally {
      setCreatingOrder(false);
    }
  }

  async function refreshStatus(idOverride = null, silent = false) {
    const id = String(idOverride || parsed.paymeId || "").trim();
    if (!id) {
      setTxDetails(null);
      setTxDetailsErr("");
      return;
    }

    setStatusLoading(true);
    setTxDetailsErr("");
    try {
      const data = await apiGet(`/api/admin/payme/tx/${encodeURIComponent(id)}`, "admin");
      setTxDetails(data);
      if (!silent) tSuccess("Status refreshed");
    } catch (e) {
      const st = Number(e?.status || 0);
      if (st === 404) {
        setTxDetails(null);
        setTxDetailsErr("Tx not found in DB (ещё не создана или другой tx_id)");
        if (!silent) tError("Tx not found (DB)");
      } else {
        console.error(e);
        setTxDetails(null);
        setTxDetailsErr(e?.message || "Status fetch error");
        if (!silent) tError("Status fetch error");
      }
    } finally {
      setStatusLoading(false);
    }
  }

  async function repairLedgerForCurrent() {
    const id = String(parsed.paymeId || "").trim();
    if (!id) return;

    setRepairing(true);
    try {
      const data = await apiPost(`/api/admin/payme/repair/${encodeURIComponent(id)}`, {}, "admin");
      if (data?.already) tSuccess("Ledger уже был (idempotent)");
      else tSuccess("Ledger восстановлен");
      await refreshStatus(id, true);
      if (parsed.orderId) await inspectOrder(parsed.orderId, true);
    } catch (e) {
      console.error(e);
      tError("Repair ledger: ошибка");
    } finally {
      setRepairing(false);
    }
  }

  useEffect(() => {
    if (!autoStatus) return;
    if (!seedPaymeId) return;
    if (txMode !== "seed") return;
    refreshStatus(seedPaymeId, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedPaymeId]);

  useEffect(() => {
    const qpSeedPaymeId = String(searchParams.get("seed_payme_id") || "").trim();
    const qpOrderId = String(searchParams.get("order_id") || "").trim();
    const qpAmount = String(searchParams.get("amount") || "").trim();

    if (!qpSeedPaymeId && !qpOrderId && !qpAmount) return;

    if (qpOrderId) {
      setOrderId(qpOrderId);
      setInspectOrderId(qpOrderId);
    }

    if (qpAmount) {
      setAmount(qpAmount);
    }

    if (qpSeedPaymeId) {
      setSeedPaymeId(qpSeedPaymeId);
      setPaymeId(qpSeedPaymeId);
      setTxMode("seed");
      refreshStatus(qpSeedPaymeId, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function run(method, params) {
    setBusy(true);
    try {
      const rpc = {
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      };

      const data = await apiPost("/api/admin/payme/lab/run", rpc, "admin");

      const snap = {
        ts: nowMs(),
        method,
        params,
        rpc: data?.rpc || rpc,
        result: data?.result,
      };

      setLastSnap(snap);
      setHistory((prev) => [snap, ...prev].slice(0, 30));
      tSuccess(`${method}: OK`);

      if (autoStatus) {
        const id = params?.id ? String(params.id) : parsed.paymeId;
        await refreshStatus(id, true);
      }

      return snap;
    } catch (e) {
      console.error(e);
      tError(`${method}: ошибка`);

      const rpc = {
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      };

      const snap = {
        ts: nowMs(),
        method,
        params,
        rpc,
        error: e?.message || e,
      };

      setLastSnap(snap);
      setHistory((prev) => [snap, ...prev].slice(0, 30));

      if (autoStatus) {
        const id = params?.id ? String(params.id) : parsed.paymeId;
        await refreshStatus(id, true);
      }

      return null;
    } finally {
      setBusy(false);
    }
  }

  function buildCheck() {
    const oid = Number(parsed.orderId);
    return {
      amount: parsed.amount,
      account: {
        order_id: oid,
      },
    };
  }

  function buildCreate() {
    const oid = Number(parsed.orderId);
    return {
      id: parsed.paymeId,
      time: nowMs(),
      amount: parsed.amount,
      account: {
        order_id: oid,
      },
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

  function buildSetFiscalData() {
    const dt = fiscalDateTime ? new Date(fiscalDateTime).toISOString() : new Date().toISOString();
  
    return {
      id: parsed.paymeId,
      fiscal_data: {
        receipt_id: String(fiscalReceiptId || `rcpt_${nowMs()}`),
        terminal_id: String(fiscalTerminalId || "PAYME_LAB"),
        fiscal_sign: String(fiscalSign || `fsign_${nowMs()}`),
        date_time: dt,
      },
    };
  }

  function switchToSeedOrFail() {
    if (!seedPaymeId) {
      tError("Нет выбранного tx_id из Health. Выбери транзакцию в Health.");
      return false;
    }
    if (txMode !== "seed") setTxMode("seed");
    if (paymeId !== seedPaymeId) setPaymeId(seedPaymeId);
    return true;
  }

  function switchToNewEnsuringFreshTxId() {
    if (txMode !== "new") setTxMode("new");
    if (!paymeId || (seedPaymeId && paymeId === seedPaymeId)) {
      setPaymeId(makeNewTxId());
      return true;
    }
    return true;
  }

  function ensureCreateSafeOrFix() {
    switchToNewEnsuringFreshTxId();

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

  async function scenarioReconcileStatement() {
    await run("GetStatement", buildStatement());
  }

  async function scenarioCancelSelectedThenStatement() {
    if (!switchToSeedOrFail()) return;
    if (!canRunIdOnly()) return tError("Нужен tx_id");
    const ok = await run("CancelTransaction", buildCancel());
    if (!ok) return;
    await run("GetStatement", buildStatement());
    tSuccess("Scenario: Cancel selected → Statement done");
  }

  async function scenarioHappyPathNewPayment() {
    if (!canRunBasic()) return tError("Заполни order_id и amount");

    switchToNewEnsuringFreshTxId();
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

  async function scenarioPerformThenFiscalize() {
    if (!canRunIdOnly()) return tError("Нужен tx_id");
  
    const ok = await run("PerformTransaction", buildPerform());
    if (!ok) return;
  
    await run("SetFiscalData", buildSetFiscalData());
    tSuccess("Scenario: Perform → SetFiscalData done");
  }

  async function runFullScenario() {
    if (!canRunBasic()) return tError("Заполни order_id и amount");
  
    switchToNewEnsuringFreshTxId();
    if (!ensureCreateSafeOrFix()) return;
  
    const ok1 = await run("CheckPerformTransaction", buildCheck());
    if (!ok1) return;
  
    const ok2 = await run("CreateTransaction", buildCreate());
    if (!ok2) return;
  
    const ok3 = await run("PerformTransaction", buildPerform());
    if (!ok3) return;
  
    await run("SetFiscalData", buildSetFiscalData());
    await run("GetStatement", buildStatement());
  
    tSuccess("RUN FULL SCENARIO done");
  }

  const statusComputed = useMemo(() => {
    const d = txDetails;
    const tx = d?.tx || null;
    const order = d?.order || null;
    const ledger = Array.isArray(d?.ledger) ? d.ledger : [];

    const ledgerRows = ledger.length;
    const ledgerSum = ledger.reduce((s, r) => s + Number(r?.amount || 0), 0);
    const amountExpected = Number(tx?.amount_tiyin || 0);

    const hs = d ? healthStatusFromDetails(d) : null;

    let stateLabel = "—";
    const st = Number(tx?.state);
    if (Number.isFinite(st)) {
      if (st === 1) stateLabel = "CREATED (1)";
      else if (st === 2) stateLabel = "PERFORMED (2)";
      else if (st === -1) stateLabel = "CANCELED (-1)";
      else if (st === -2) stateLabel = "CANCELED AFTER PERFORM (-2)";
      else stateLabel = `STATE ${st}`;
    }

    let next = null;
    if (!tx) {
      next = txMode === "new" ? "Next: CreateTransaction" : "Next: select tx_id in Health";
    } else if (st === 1) {
      next = "Next: PerformTransaction";
    } else if (st === 2 && ledgerRows === 0) {
      next = "Next: Repair ledger";
    } else if (st === 2 && ledgerRows > 0 && amountExpected > 0 && ledgerSum !== amountExpected) {
      next = "Next: Investigate amount mismatch";
    } else {
      next = "Next: —";
    }

    return {
      hasTx: !!tx,
      state: st,
      stateLabel,
      health: hs,
      ledgerRows,
      ledgerSum,
      amountExpected,
      orderId: tx?.order_id ?? order?.id ?? null,
      clientId: order?.client_id ?? null,
      createTime: tx?.create_time ?? null,
      performTime: tx?.perform_time ?? null,
      cancelTime: tx?.cancel_time ?? null,
      reason: tx?.reason ?? null,
      next,
    };
  }, [txDetails, txMode]);

  const orderSummary = useMemo(() => {
    const order = orderDetails?.order || null;
    const client = orderDetails?.client || null;
    const transactions = Array.isArray(orderDetails?.transactions) ? orderDetails.transactions : [];
    const ledger = Array.isArray(orderDetails?.ledger) ? orderDetails.ledger : [];
    const ledgerSum = ledger.reduce((s, r) => s + Number(r?.amount || 0), 0);

    return {
      order,
      client,
      transactions,
      ledger,
      ledgerSum,
      latestTx: transactions[0] || null,
    };
  }, [orderDetails]);

  useEffect(() => {
    const oid = String(orderSummary?.order?.id || "").trim();
    const pid = String(orderSummary?.latestTx?.payme_id || "").trim();
    if (!oid && !pid) return;

    loadInspectorEvents(oid, pid, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderSummary?.order?.id, orderSummary?.latestTx?.payme_id]);

  const inspectorTimeline = useMemo(() => {
    const order = orderSummary.order;
    const client = orderSummary.client;
    const latestTx = orderSummary.latestTx;
    const ledger = orderSummary.ledger;
    const ledgerSum = orderSummary.ledgerSum;

    if (!order) return [];

    const st = Number(latestTx?.state);
    const hasTx = !!latestTx;
    const hasCreatedTx = hasTx;
    const hasPerformed = st === 2 || st === -2;
    const hasCancel = st === -1 || st === -2;
    const positiveLedger = ledger.some((r) => Number(r?.amount || 0) > 0);
    const negativeLedger = ledger.some((r) => Number(r?.amount || 0) < 0);
    const expectedAmount = Number(order?.amount_tiyin || latestTx?.amount_tiyin || 0);

    const createTone = hasCreatedTx ? "ok" : "muted";
    const performTone =
      hasPerformed && positiveLedger
        ? "ok"
        : hasPerformed && !positiveLedger
        ? "bad"
        : st === 1
        ? "warn"
        : "muted";

    const cancelTone =
      hasCancel && negativeLedger
        ? "ok"
        : hasCancel && !negativeLedger && ledgerSum > 0
        ? "bad"
        : hasCancel
        ? "warn"
        : "muted";

    const ledgerCreditTone =
      positiveLedger && ledgerSum === expectedAmount
        ? "ok"
        : positiveLedger && ledgerSum !== expectedAmount && !hasCancel
        ? "warn"
        : hasPerformed && !positiveLedger
        ? "bad"
        : "muted";

    const ledgerReversalTone =
      negativeLedger && ledgerSum === 0
        ? "ok"
        : negativeLedger && ledgerSum !== 0
        ? "warn"
        : hasCancel && ledgerSum > 0
        ? "bad"
        : "muted";

    return [
      {
        key: "order",
        title: "Order created",
        tone: order ? "ok" : "muted",
        ts: order?.created_at || null,
        desc: order
          ? `order #${order.id}, status=${order.status}, amount=${money(order.amount_tiyin)}`
          : "Order not found",
      },
      {
        key: "create",
        title: "Transaction created",
        tone: createTone,
        ts: latestTx?.create_time ? Number(latestTx.create_time) : null,
        desc: hasCreatedTx
          ? `tx_id=${latestTx.payme_id}, state=${latestTx.state}`
          : "CreateTransaction ещё не зафиксирован",
      },
      {
        key: "perform",
        title: "Performed",
        tone: performTone,
        ts: latestTx?.perform_time ? Number(latestTx.perform_time) : null,
        desc: hasPerformed
          ? positiveLedger
            ? "Perform прошёл и credit в ledger найден"
            : "Perform прошёл, но credit в ledger не найден"
          : st === 1
          ? "Tx создан, ждёт Perform"
          : "Perform ещё не наступал",
      },
      {
        key: "cancel",
        title: "Cancel / refund",
        tone: cancelTone,
        ts: latestTx?.cancel_time ? Number(latestTx.cancel_time) : null,
        desc: hasCancel
          ? negativeLedger
            ? "Cancel зафиксирован и reversal в ledger найден"
            : ledgerSum > 0
            ? "Cancel есть, но reversal в ledger отсутствует"
            : "Cancel есть"
          : "Cancel не было",
      },
      {
        key: "ledger-credit",
        title: "Ledger credit",
        tone: ledgerCreditTone,
        ts: ledger.find((r) => Number(r?.amount || 0) > 0)?.created_at || null,
        desc: positiveLedger
          ? `credit найден, ledger_sum=${money(ledgerSum)}`
          : hasPerformed
          ? "credit не найден"
          : "credit ещё не ожидался",
      },
      {
        key: "ledger-reversal",
        title: "Ledger reversal",
        tone: ledgerReversalTone,
        ts: ledger.find((r) => Number(r?.amount || 0) < 0)?.created_at || null,
        desc: negativeLedger
          ? `reversal найден, ledger_sum=${money(ledgerSum)}`
          : hasCancel
          ? "reversal не найден"
          : "reversal не ожидался",
      },
      {
        key: "balance",
        title: "Client balance snapshot",
        tone: client ? "ok" : "muted",
        ts: null,
        desc: client
          ? `client #${client.id}, balance=${money(client.contact_balance)}`
          : "Client not found",
      },
    ];
  }, [orderSummary]);

  const rpcTimeline = useMemo(() => {
    const methods = [
      "CheckPerformTransaction",
      "CreateTransaction",
      "PerformTransaction",
      "SetFiscalData",
      "CancelTransaction",
      "GetStatement",
    ];

    const rows = Array.isArray(inspectorEvents) ? inspectorEvents : [];

    return methods.map((method) => {
      const events = rows
        .filter((r) => String(r?.method || "") === method)
        .sort((a, b) => {
          const ai = Number(a?.id || 0);
          const bi = Number(b?.id || 0);
          return ai - bi;
        });

      const begin = events.find((e) => e?.stage === "begin") || null;
      const end = [...events].reverse().find((e) => e?.stage === "end") || null;
      const error = [...events].reverse().find((e) => e?.stage === "error") || null;

      let tone = "muted";
      let desc = "Нет событий";
      let ts = null;

      if (error) {
        tone = "bad";
        desc = `error${error?.error_code != null ? ` ${error.error_code}` : ""}${
          error?.error_message ? ` — ${error.error_message}` : ""
        }`;
        ts = error?.created_at || null;
      } else if (end) {
        tone = "ok";
        desc = `end, http=${end?.http_status ?? "—"}, ms=${end?.duration_ms ?? "—"}`;
        ts = end?.created_at || null;
      } else if (begin) {
        tone = "warn";
        desc = "begin есть, end/error пока нет";
        ts = begin?.created_at || null;
      }

      const beginRaw = extractRawPayload(begin);
      const endRaw = extractRawPayload(end);
      const errorRaw = extractRawPayload(error);

      const hasAnyRaw =
        beginRaw.request ||
        beginRaw.response ||
        beginRaw.error ||
        endRaw.request ||
        endRaw.response ||
        endRaw.error ||
        errorRaw.request ||
        errorRaw.response ||
        errorRaw.error;

      return {
        method,
        begin,
        end,
        error,
        tone,
        desc,
        ts,
        count: events.length,
        hasAnyRaw: !!hasAnyRaw,
        raw: {
          begin: beginRaw,
          end: endRaw,
          error: errorRaw,
        },
      };
    });
  }, [inspectorEvents]);

  return (
    <div className={embedded ? "" : "p-4 md:p-6"}>
      {!embedded && (
        <>
          <h1 className="text-xl font-semibold mb-1">Payme Lab (Admin)</h1>
          <p className="text-sm text-gray-500 mb-4">
            Merchant RPC + bank-grade status (payme_transactions ↔ ledger).
          </p>
        </>
      )}

      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-lg font-semibold">Payme Lab</div>
          <div className="text-sm text-gray-500">
            Merchant RPC actions + order builder + order inspector + auto-snapshot
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

      <div className="mb-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-gray-800">Create topup order</div>
              <div className="text-xs text-gray-500">
                Создаёт topup_orders для теста Payme прямо из Finance.
              </div>
            </div>
            {createdOrder?.order?.id ? badgePill("ok", `order #${createdOrder.order.id}`) : null}
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">client_id</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={newClientId}
                onChange={(e) => setNewClientId(e.target.value)}
                placeholder="например 25"
                disabled={creatingOrder || busy}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">amount_tiyin</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={newAmountTiyin}
                onChange={(e) => setNewAmountTiyin(e.target.value)}
                placeholder="100000"
                disabled={creatingOrder || busy}
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                className="w-full px-4 py-2 rounded-lg bg-black text-white disabled:opacity-60"
                onClick={createOrder}
                disabled={creatingOrder || busy}
              >
                {creatingOrder ? "Creating…" : "Create order"}
              </button>
            </div>
          </div>

          <div className="mt-2 text-[11px] text-gray-400">
            Provider = payme, status = created. После создания новый order_id автоматически
            подставится в Lab.
          </div>

          {createdOrder?.order && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div className="bg-gray-50 border rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1">order_id</div>
                <div className="font-mono">{createdOrder.order.id}</div>
              </div>
              <div className="bg-gray-50 border rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1">client_id</div>
                <div className="font-mono">{createdOrder.order.client_id}</div>
              </div>
              <div className="bg-gray-50 border rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1">amount_tiyin</div>
                <div className="font-mono">{createdOrder.order.amount_tiyin}</div>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-gray-800">Payment inspector</div>
              <div className="text-xs text-gray-500">
                Показывает order + tx + ledger + client balance по order_id.
              </div>
            </div>
            {orderSummary.order?.id ? badgePill("black", `inspect #${orderSummary.order.id}`) : null}
          </div>

          <div className="mt-3 flex flex-col md:flex-row gap-3 md:items-end">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">order_id</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={inspectOrderId}
                onChange={(e) => setInspectOrderId(e.target.value)}
                placeholder="например 21"
                disabled={inspectLoading || busy}
              />
            </div>
            <button
              type="button"
              className="px-4 py-2 rounded-lg border bg-white disabled:opacity-60"
              onClick={() => inspectOrder(null, false)}
              disabled={inspectLoading || busy}
            >
              {inspectLoading ? "Inspecting…" : "Inspect order"}
            </button>
          </div>

          {!!orderDetailsErr && <div className="mt-2 text-sm text-red-600">{orderDetailsErr}</div>}

          {orderSummary.order && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="bg-gray-50 border rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1">Order</div>
                <div>
                  id: <span className="font-mono">{orderSummary.order.id}</span>
                </div>
                <div>
                  status: <span className="font-mono">{orderSummary.order.status}</span>
                </div>
                <div>
                  provider: <span className="font-mono">{orderSummary.order.provider}</span>
                </div>
                <div>
                  amount_tiyin:{" "}
                  <span className="font-mono">{money(orderSummary.order.amount_tiyin)}</span>
                </div>
              </div>
              <div className="bg-gray-50 border rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1">Client</div>
                <div>
                  client_id: <span className="font-mono">{orderSummary.order.client_id}</span>
                </div>
                <div>
                  phone: <span className="font-mono">{orderSummary.client?.phone || "—"}</span>
                </div>
                <div>
                  contact_balance:{" "}
                  <span className="font-mono">{money(orderSummary.client?.contact_balance)}</span>
                </div>
                <div>
                  tx_count / ledger_rows:{" "}
                  <span className="font-mono">
                    {orderSummary.transactions.length} / {orderSummary.ledger.length}
                  </span>
                </div>
              </div>
            </div>
          )}

          {orderSummary.order && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {orderSummary.transactions.length
                ? badgePill("ok", `tx: ${orderSummary.transactions.length}`)
                : badgePill("warn", "tx: 0")}
              {orderSummary.ledger.length
                ? badgePill("ok", `ledger_sum: ${money(orderSummary.ledgerSum)}`)
                : badgePill("warn", "ledger: 0")}
              {orderSummary.latestTx?.payme_id ? badgePill("info", orderSummary.latestTx.payme_id) : null}
              {orderSummary.latestTx?.state === 2 && orderSummary.ledger.length === 0
                ? badgePill("bad", "LOST_PAYMENT")
                : null}
              {orderSummary.latestTx?.payme_id ? (
                <button
                  type="button"
                  className="px-2.5 py-1 rounded border bg-white text-xs"
                  onClick={() => openInHealthByPaymeId(orderSummary.latestTx.payme_id)}
                >
                  Open in Health
                </button>
              ) : null}
            </div>
          )}

          {orderSummary.order && (
            <div className="mt-4">
              <div className="text-sm font-semibold text-gray-800 mb-2">Transaction timeline</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {inspectorTimeline.map((item) => (
                  <div
                    key={item.key}
                    className={`border rounded-lg p-3 ${timelineTone(item.tone)}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ${timelineDotTone(
                            item.tone
                          )}`}
                        />
                        <div className="font-medium text-sm">{item.title}</div>
                      </div>
                      <div className="text-[11px] text-gray-500 shrink-0">
                        {item.ts ? fmtTs(item.ts) : "—"}
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-gray-700">{item.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {orderSummary.order && (
            <div className="mt-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-sm font-semibold text-gray-800">RPC events timeline</div>
                <div className="flex items-center gap-2">
                  {inspectorEventsLoading ? (
                    <span className="text-xs text-gray-500">Loading…</span>
                  ) : (
                    <span className="text-xs text-gray-500">events: {inspectorEvents.length}</span>
                  )}
                  {orderSummary.latestTx?.payme_id ? (
                    <button
                      type="button"
                      className="px-2.5 py-1.5 rounded-lg border bg-white text-xs"
                      onClick={() => openInHealthByPaymeId(orderSummary.latestTx.payme_id)}
                    >
                      Open latest tx in Health
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="px-2.5 py-1.5 rounded-lg border bg-white text-xs"
                    onClick={() =>
                      loadInspectorEvents(
                        String(orderSummary?.order?.id || ""),
                        String(orderSummary?.latestTx?.payme_id || ""),
                        false
                      )
                    }
                    disabled={inspectorEventsLoading || busy}
                  >
                    Reload events
                  </button>
                </div>
              </div>

              {!!inspectorEventsErr && (
                <div className="mb-2 text-xs text-red-600">{inspectorEventsErr}</div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {rpcTimeline.map((item) => (
                  <div
                    key={item.method}
                    className={`border rounded-lg p-3 ${timelineTone(item.tone)}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ${timelineDotTone(
                            item.tone
                          )}`}
                        />
                        <div className="font-medium text-sm">{item.method}</div>
                      </div>
                      <div className="text-[11px] text-gray-500 shrink-0">
                        {item.ts ? fmtTs(item.ts) : "—"}
                      </div>
                    </div>

                    <div className="mt-2 text-xs text-gray-700">{item.desc}</div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.begin ? badgePill("info", "begin") : null}
                      {item.end ? badgePill("ok", "end") : null}
                      {item.error ? badgePill("bad", "error") : null}
                      {item.count ? badgePill("black", `rows: ${item.count}`) : null}
                      {item.hasAnyRaw ? (
                        <button
                          type="button"
                          className="px-2 py-0.5 rounded border bg-white text-[11px]"
                          onClick={() => toggleRpcRaw(item.method)}
                        >
                          {openRpcRaw[item.method] ? "Hide raw" : "Open raw"}
                        </button>
                      ) : null}
                    </div>

                    {(item.begin || item.end || item.error) && (
                      <div className="mt-2 text-[11px] text-gray-500 space-y-1">
                        {item.begin ? <div>begin: {fmtTs(item.begin.created_at)}</div> : null}
                        {item.end ? (
                          <div>
                            end: {fmtTs(item.end.created_at)}
                            {item.end.http_status != null ? ` • http=${item.end.http_status}` : ""}
                            {item.end.duration_ms != null ? ` • ${item.end.duration_ms}ms` : ""}
                          </div>
                        ) : null}
                        {item.error ? (
                          <div>
                            error: {fmtTs(item.error.created_at)}
                            {item.error.error_code != null
                              ? ` • code=${item.error.error_code}`
                              : ""}
                            {item.error.error_message
                              ? ` • ${item.error.error_message}`
                              : ""}
                          </div>
                        ) : null}
                      </div>
                    )}

                    {openRpcRaw[item.method] && item.hasAnyRaw ? (
                      <div className="mt-3 space-y-3">
                        <div className="border rounded-lg bg-white p-3">
                          <div className="text-xs font-medium text-gray-700 mb-2">Raw begin</div>
                          <div className="space-y-2">
                            {item.raw.begin.request ? (
                              <div>
                                <div className="text-[11px] text-gray-500 mb-1">request</div>
                                <pre className="text-[11px] bg-gray-50 border rounded p-2 overflow-auto">
                                  {pretty(item.raw.begin.request)}
                                </pre>
                              </div>
                            ) : null}
                            {item.raw.begin.response ? (
                              <div>
                                <div className="text-[11px] text-gray-500 mb-1">response</div>
                                <pre className="text-[11px] bg-gray-50 border rounded p-2 overflow-auto">
                                  {pretty(item.raw.begin.response)}
                                </pre>
                              </div>
                            ) : null}
                            {item.raw.begin.error ? (
                              <div>
                                <div className="text-[11px] text-gray-500 mb-1">error</div>
                                <pre className="text-[11px] bg-gray-50 border rounded p-2 overflow-auto">
                                  {pretty(item.raw.begin.error)}
                                </pre>
                              </div>
                            ) : null}
                            {!item.raw.begin.request &&
                            !item.raw.begin.response &&
                            !item.raw.begin.error ? (
                              <div className="text-[11px] text-gray-400">Нет raw begin payload</div>
                            ) : null}
                          </div>
                        </div>

                        <div className="border rounded-lg bg-white p-3">
                          <div className="text-xs font-medium text-gray-700 mb-2">Raw end</div>
                          <div className="space-y-2">
                            {item.raw.end.request ? (
                              <div>
                                <div className="text-[11px] text-gray-500 mb-1">request</div>
                                <pre className="text-[11px] bg-gray-50 border rounded p-2 overflow-auto">
                                  {pretty(item.raw.end.request)}
                                </pre>
                              </div>
                            ) : null}
                            {item.raw.end.response ? (
                              <div>
                                <div className="text-[11px] text-gray-500 mb-1">response</div>
                                <pre className="text-[11px] bg-gray-50 border rounded p-2 overflow-auto">
                                  {pretty(item.raw.end.response)}
                                </pre>
                              </div>
                            ) : null}
                            {item.raw.end.error ? (
                              <div>
                                <div className="text-[11px] text-gray-500 mb-1">error</div>
                                <pre className="text-[11px] bg-gray-50 border rounded p-2 overflow-auto">
                                  {pretty(item.raw.end.error)}
                                </pre>
                              </div>
                            ) : null}
                            {!item.raw.end.request &&
                            !item.raw.end.response &&
                            !item.raw.end.error ? (
                              <div className="text-[11px] text-gray-400">Нет raw end payload</div>
                            ) : null}
                          </div>
                        </div>

                        <div className="border rounded-lg bg-white p-3">
                          <div className="text-xs font-medium text-gray-700 mb-2">Raw error</div>
                          <div className="space-y-2">
                            {item.raw.error.request ? (
                              <div>
                                <div className="text-[11px] text-gray-500 mb-1">request</div>
                                <pre className="text-[11px] bg-gray-50 border rounded p-2 overflow-auto">
                                  {pretty(item.raw.error.request)}
                                </pre>
                              </div>
                            ) : null}
                            {item.raw.error.response ? (
                              <div>
                                <div className="text-[11px] text-gray-500 mb-1">response</div>
                                <pre className="text-[11px] bg-gray-50 border rounded p-2 overflow-auto">
                                  {pretty(item.raw.error.response)}
                                </pre>
                              </div>
                            ) : null}
                            {item.raw.error.error ? (
                              <div>
                                <div className="text-[11px] text-gray-500 mb-1">error</div>
                                <pre className="text-[11px] bg-gray-50 border rounded p-2 overflow-auto">
                                  {pretty(item.raw.error.error)}
                                </pre>
                              </div>
                            ) : null}
                            {!item.raw.error.request &&
                            !item.raw.error.response &&
                            !item.raw.error.error ? (
                              <div className="text-[11px] text-gray-400">Нет raw error payload</div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mb-4 bg-white rounded-xl shadow p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-800">Status panel</div>
            <div className="text-xs text-gray-500">
              DB: topup_orders + payme_transactions + contact_balance_ledger
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoStatus}
                onChange={(e) => setAutoStatus(e.target.checked)}
                disabled={busy}
              />
              Auto refresh after each click
            </label>

            <button
              type="button"
              className="px-3 py-2 rounded-lg border bg-white text-sm disabled:opacity-60"
              onClick={() => refreshStatus(null, false)}
              disabled={busy || statusLoading}
              title="Fetch /api/admin/payme/tx/:paymeId"
            >
              {statusLoading ? "Refreshing…" : "Refresh Status"}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {statusComputed.hasTx ? badgePill("ok", "DB: tx found") : badgePill("warn", "DB: tx not found")}
          {statusComputed.health &&
            (statusComputed.health === "OK"
              ? badgePill("ok", "HEALTH: OK")
              : statusComputed.health === "STUCK"
              ? badgePill("purple", "HEALTH: STUCK")
              : statusComputed.health === "LOST_PAYMENT"
              ? badgePill("bad", "HEALTH: LOST_PAYMENT")
              : statusComputed.health === "BAD_AMOUNT"
              ? badgePill("warn", "HEALTH: BAD_AMOUNT")
              : statusComputed.health === "REFUND_MISMATCH"
              ? badgePill("orange", "HEALTH: REFUND_MISMATCH")
              : statusComputed.health === "AMOUNT_MISMATCH"
              ? badgePill("warn", "HEALTH: AMOUNT_MISMATCH")
              : badgePill("info", `HEALTH: ${statusComputed.health}`))}
          {statusComputed.stateLabel !== "—" && badgePill("black", statusComputed.stateLabel)}
          {!!txDetailsErr && badgePill("warn", txDetailsErr)}
          {statusComputed.next && badgePill("info", statusComputed.next)}
        </div>

        {statusComputed.health === "LOST_PAYMENT" && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="px-3 py-2 rounded-lg bg-red-600 text-white disabled:opacity-60"
              onClick={repairLedgerForCurrent}
              disabled={busy || repairing}
              title="POST /api/admin/payme/repair/:paymeId"
            >
              {repairing ? "Repairing…" : "Repair ledger"}
            </button>
            <div className="text-xs text-gray-500">
              LOST_PAYMENT = Perform был, но ledger не записался. Repair восстановит ledger
              идемпотентно.
            </div>
          </div>
        )}

        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div className="bg-gray-50 border rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">tx_id</div>
            <div className="font-mono break-all">{parsed.paymeId || "—"}</div>
            <div className="mt-2 text-xs text-gray-500">selected tx_id</div>
            <div className="font-mono break-all">{seedPaymeId || "—"}</div>
          </div>

          <div className="bg-gray-50 border rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">Order / Amount</div>
            <div>
              order_id:{" "}
              <span className="font-mono">
                {String(statusComputed.orderId ?? parsed.orderId ?? "—")}
              </span>
            </div>
            <div>
              expected amount:{" "}
              <span className="font-mono">{String(statusComputed.amountExpected ?? 0)}</span>
            </div>
            <div className="mt-2">
              ledger_rows: <span className="font-mono">{String(statusComputed.ledgerRows)}</span>
            </div>
            <div>
              ledger_sum: <span className="font-mono">{String(statusComputed.ledgerSum)}</span>
            </div>
          </div>

          <div className="bg-gray-50 border rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">Times</div>
            <div>
              create_time:{" "}
              <span className="font-mono">
                {statusComputed.createTime ? fmtTs(Number(statusComputed.createTime)) : "—"}
              </span>
            </div>
            <div>
              perform_time:{" "}
              <span className="font-mono">
                {statusComputed.performTime ? fmtTs(Number(statusComputed.performTime)) : "—"}
              </span>
            </div>
            <div>
              cancel_time:{" "}
              <span className="font-mono">
                {statusComputed.cancelTime ? fmtTs(Number(statusComputed.cancelTime)) : "—"}
              </span>
            </div>
            <div className="mt-2">
              reason: <span className="font-mono">{String(statusComputed.reason ?? "—")}</span>
            </div>
          </div>
        </div>

        {txDetails?.tx && (
          <div className="mt-3">
            <div className="text-xs text-gray-500 mb-1">Raw details (tx/order/ledger)</div>
            <pre className="text-xs bg-gray-50 border rounded-lg p-3 overflow-auto">
              {pretty(txDetails)}
            </pre>
          </div>
        )}
      </div>

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
            >
              Reconcile (Statement)
            </button>
            <button
              className="px-3 py-2 rounded-lg border bg-white text-sm disabled:opacity-60"
              onClick={scenarioCancelSelectedThenStatement}
              disabled={busy}
            >
              Cancel selected tx → Statement
            </button>
            <button
              className="px-3 py-2 rounded-lg border bg-white text-sm disabled:opacity-60"
              onClick={scenarioHappyPathNewPayment}
              disabled={busy}
            >
              Happy path (new payment)
            </button>
            <button
              className="px-3 py-2 rounded-lg border bg-white text-sm disabled:opacity-60"
              onClick={scenarioCreatePerformThenCancel}
              disabled={busy}
            >
              Create+Perform → Cancel (test)
            </button>
            <button
              className="px-3 py-2 rounded-lg border bg-white text-sm disabled:opacity-60"
              onClick={scenarioPerformThenFiscalize}
              disabled={busy}
            >
              Perform → SetFiscalData
            </button>
          </div>
        </div>
      </div>

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
            >
              Generate new tx_id
            </button>
          </div>
        </div>

        <div className="mt-2 text-xs text-gray-500">
          Selected tx_id: <span className="font-mono">{seedPaymeId || "—"}</span>
          <span className="mx-2">•</span>
          Current tx_id: <span className="font-mono">{parsed.paymeId || "—"}</span>
          {txMode === "seed" ? (
            <span className="ml-2 text-gray-400">(для Perform/Cancel по выбранному)</span>
          ) : (
            <span className="ml-2 text-gray-400">(для Create нового платежа)</span>
          )}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          className="px-3 py-2 rounded-lg border bg-white disabled:opacity-60 text-sm"
          onClick={runCreateOnly}
          disabled={busy}
        >
          Create only
        </button>
        <button
          className="px-3 py-2 rounded-lg border bg-white disabled:opacity-60 text-sm"
          onClick={runCreateAndPerform}
          disabled={busy}
        >
          Create + Perform
        </button>
        <button
          className="px-3 py-2 rounded-lg border bg-white disabled:opacity-60 text-sm"
          onClick={runCheckCreatePerform}
          disabled={busy}
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
        >
          New tx_id
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
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
              <label className="block text-xs text-gray-500 mb-1">payme tx id (params.id)</label>
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
              <div className="border rounded-lg p-3 bg-gray-50">
                <div className="text-xs font-semibold text-gray-700 mb-2">SetFiscalData</div>
              
                <div className="grid grid-cols-1 gap-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">receipt_id</label>
                    <input
                      className="w-full border rounded-lg px-3 py-2"
                      value={fiscalReceiptId}
                      onChange={(e) => setFiscalReceiptId(e.target.value)}
                      placeholder={`rcpt_${nowMs()}`}
                      disabled={busy}
                    />
                  </div>
              
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">terminal_id</label>
                    <input
                      className="w-full border rounded-lg px-3 py-2"
                      value={fiscalTerminalId}
                      onChange={(e) => setFiscalTerminalId(e.target.value)}
                      placeholder="PAYME_LAB"
                      disabled={busy}
                    />
                  </div>
              
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">fiscal_sign</label>
                    <input
                      className="w-full border rounded-lg px-3 py-2"
                      value={fiscalSign}
                      onChange={(e) => setFiscalSign(e.target.value)}
                      placeholder={`fsign_${nowMs()}`}
                      disabled={busy}
                    />
                  </div>
              
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">date_time</label>
                    <input
                      type="datetime-local"
                      className="w-full border rounded-lg px-3 py-2"
                      value={fiscalDateTime}
                      onChange={(e) => setFiscalDateTime(e.target.value)}
                      disabled={busy}
                    />
                  </div>
                </div>
              </div>
            </div>

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
              <button
                  className="px-4 py-2 rounded-lg border bg-white disabled:opacity-60"
                  onClick={() => {
                    if (!canRunIdOnly()) return tError("Нужен tx_id");
                    run("SetFiscalData", buildSetFiscalData());
                  }}
                  disabled={busy}
                >
                  SetFiscalData
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 bg-white rounded-xl shadow overflow-hidden">
          <div className="p-3 border-b flex items-center justify-between">
            <div className="text-sm text-gray-600">Snapshot</div>
            <div className="text-xs text-gray-400">history: {history.length}/30</div>
          </div>

          {!lastSnap ? (
            <div className="p-4 text-sm text-gray-500">
              Нажми любую кнопку — тут появится RPC + ответ.
            </div>
          ) : (
            <div className="p-4 grid grid-cols-1 gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700">
                  {new Date(lastSnap.ts).toLocaleString("ru-RU", {
                    timeZone: "Asia/Tashkent",
                  })}
                </span>
                <span className="text-xs px-2 py-1 rounded bg-black text-white">
                  {lastSnap.method}
                </span>
                {lastSnap?.result?.error && (
                  <span className="text-xs px-2 py-1 rounded bg-red-100 text-red-700">
                    RPC error
                  </span>
                )}
                {lastSnap?.error && (
                  <span className="text-xs px-2 py-1 rounded bg-red-100 text-red-700">
                    HTTP error
                  </span>
                )}
              </div>

              <div>
                <div className="text-xs text-gray-500 mb-1">Merchant RPC body</div>
                <pre className="text-xs bg-gray-50 border rounded-lg p-3 overflow-auto">
                  {pretty(
                    lastSnap.rpc || {
                      jsonrpc: "2.0",
                      id: null,
                      method: lastSnap.method,
                      params: lastSnap.params,
                    }
                  )}
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
                        {new Date(h.ts).toLocaleTimeString("ru-RU", {
                          timeZone: "Asia/Tashkent",
                        })}
                      </td>
                      <td className="px-3 py-2 font-medium">{h.method}</td>
                      <td className="px-3 py-2">
                        {String(h?.params?.account?.order_id ?? "—")}
                      </td>
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
