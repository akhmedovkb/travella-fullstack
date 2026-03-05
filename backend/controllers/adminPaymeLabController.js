// backend/controllers/adminPaymeLabController.js
const axios = require("axios");
const { recordPaymeEvent } = require("../utils/paymeEvents");

function safeStr(x) {
  return x == null ? "" : String(x);
}

function toBigintOrNull(x) {
  if (x == null) return null;
  const s = String(x).trim();
  if (!s) return null;
  // order_id у тебя BIGINT — сохраняем только если это число
  if (!/^\d+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

function pickErrorCode(resJson) {
  const code = resJson?.error?.code;
  return Number.isFinite(Number(code)) ? Number(code) : null;
}

function pickErrorMessage(resJson) {
  const msg = resJson?.error?.message;
  return msg ? String(msg) : "";
}

/**
 * POST /api/admin/payme/lab/run
 * Body: { method: string, params: object }
 * Проксирует JSON-RPC в Merchant endpoint и возвращает снапшот.
 * Пишет payme_events: begin/end/error
 */
async function paymeLabRun(req, res) {
  const startedAt = Date.now();

  try {
    const method = safeStr(req.body?.method).trim();
    const params = req.body?.params || {};

    if (!method) {
      return res.status(400).json({ ok: false, error: "method is required" });
    }

    // payme_id (tx id) и order_id (topup order) берём из params
    const paymeId = params?.id ? String(params.id) : null;
    const orderIdBig = toBigintOrNull(params?.account?.order_id);

    // rpc_id для связки begin/end/error
    const rpcId = `lab_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    // URL merchant endpoint
    // ВАЖНО: если BASE_URL не задан, тут будет localhost:4000 — на проде лучше явно поставить BASE_URL=https://travella.uz
    const base = String(process.env.BASE_URL || "http://localhost:4000").replace(/\/+$/, "");
    const url = `${base}/api/merchant/payme`;

    // --- BEGIN event ---
    await recordPaymeEvent({
      method,
      stage: "begin",
      paymeId,
      orderId: orderIdBig,
      rpcId,
      httpStatus: null,
      errorCode: null,
      errorMessage: "",
      ip: req.ip || "",
      userAgent: req.get("user-agent") || "",
      durationMs: null,
      reqJson: { jsonrpc: "2.0", id: rpcId, method, params },
      resJson: null,
    });

    // Call merchant
    const authLogin = process.env.PAYME_MERCHANT_LOGIN || "";
    const authKey = process.env.PAYME_MERCHANT_KEY || "";
    const basic = Buffer.from(`${authLogin}:${authKey}`, "utf8").toString("base64");

    const payload = { jsonrpc: "2.0", id: rpcId, method, params };

    const r = await axios.post(url, payload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${basic}`,
      },
      timeout: 20000,
      validateStatus: () => true,
    });

    const durationMs = Date.now() - startedAt;

    // --- END/ERROR event based on RPC body ---
    const isRpcError = !!r?.data?.error;

    await recordPaymeEvent({
      method,
      stage: isRpcError ? "error" : "end",
      paymeId,
      orderId: orderIdBig,
      rpcId,
      httpStatus: Number.isFinite(Number(r.status)) ? Number(r.status) : null,
      errorCode: isRpcError ? pickErrorCode(r.data) : null,
      errorMessage: isRpcError ? pickErrorMessage(r.data) : "",
      ip: req.ip || "",
      userAgent: req.get("user-agent") || "",
      durationMs,
      reqJson: payload,
      resJson: r.data ?? null,
    });

    // Отдаём фронту то, что он ждёт
    return res.json({
      ok: true,
      rpc: payload,
      result: r.data,
      http_status: r.status,
      duration_ms: durationMs,
    });
  } catch (e) {
    const durationMs = Date.now() - startedAt;

    // Если axios упал без response
    const method = safeStr(req.body?.method).trim() || "UNKNOWN";
    const params = req.body?.params || {};
    const paymeId = params?.id ? String(params.id) : null;
    const orderIdBig = toBigintOrNull(params?.account?.order_id);
    const rpcId = `lab_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    try {
      await recordPaymeEvent({
        method,
        stage: "error",
        paymeId,
        orderId: orderIdBig,
        rpcId,
        httpStatus: null,
        errorCode: null,
        errorMessage: e?.message ? String(e.message) : "Lab request failed",
        ip: req.ip || "",
        userAgent: req.get("user-agent") || "",
        durationMs,
        reqJson: { jsonrpc: "2.0", id: rpcId, method, params },
        resJson: null,
      });
    } catch {}

    console.error("[payme-lab] run error:", e?.message || e);
    return res.status(500).json({ ok: false, error: e?.message || "Lab request failed" });
  }
}

module.exports = { paymeLabRun };
