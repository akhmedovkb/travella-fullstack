// backend/controllers/adminPaymeLabController.js

const axios = require("axios");
const pool = require("../db");

function safeStr(x) {
  return String(x ?? "").trim();
}

function toInt(x, def = 0) {
  const n = Number(String(x ?? "").trim());
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function basicAuth(login, key) {
  return "Basic " + Buffer.from(`${login}:${key}`, "utf8").toString("base64");
}

function getPaymeCreds() {
  const mode = safeStr(process.env.PAYME_MODE).toLowerCase();

  if (mode === "sandbox" || mode === "test" || mode === "dev") {
    return {
      login:
        safeStr(process.env.PAYME_MERCHANT_LOGIN_SANDBOX) ||
        safeStr(process.env.PAYME_MERCHANT_LOGIN),
      key:
        safeStr(process.env.PAYME_MERCHANT_KEY_SANDBOX) ||
        safeStr(process.env.PAYME_MERCHANT_KEY),
    };
  }

  return {
    login: safeStr(process.env.PAYME_MERCHANT_LOGIN),
    key: safeStr(process.env.PAYME_MERCHANT_KEY),
  };
}

function getMerchantRpcUrl(req) {
  const explicit = safeStr(process.env.PAYME_MERCHANT_RPC_URL);
  if (explicit) return explicit;

  const proto = safeStr(req?.protocol) || "http";
  const host = safeStr(req?.get?.("host") || req?.headers?.host);
  if (host) return `${proto}://${host}/api/merchant/payme`;

  const port = safeStr(process.env.PORT) || "4000";
  return `http://127.0.0.1:${port}/api/merchant/payme`;
}

function normalizeRpcBody(body) {
  const method = safeStr(body?.method);
  const params = body?.params && typeof body.params === "object" ? body.params : {};

  const jsonrpc = body?.jsonrpc === "2.0" ? "2.0" : "2.0";

  const id =
    body?.id !== undefined && body?.id !== null && body?.id !== ""
      ? body.id
      : `lab_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  return {
    jsonrpc,
    id,
    method,
    params,
  };
}

async function paymeLabRun(req, res) {
  const rpc = normalizeRpcBody(req.body || {});
  const m = safeStr(rpc.method);

  if (!m) {
    return res.status(400).json({
      ok: false,
      message: "method required",
    });
  }

  try {
    const rpcUrl = getMerchantRpcUrl(req);
    const { login, key } = getPaymeCreds();

    if (!login || !key) {
      return res.status(500).json({
        ok: false,
        message: "PAYME merchant credentials missing (PAYME_MERCHANT_LOGIN/KEY)",
      });
    }

    const response = await axios.post(rpcUrl, rpc, {
      timeout: 20000,
      headers: {
        "Content-Type": "application/json",
        Authorization: basicAuth(login, key),
      },
      validateStatus: () => true,
    });

    return res.json({
      ok: true,
      rpc,
      result: response.data,
      http_status: response.status,
      rpc_url: rpcUrl,
    });
  } catch (e) {
    console.error("[payme-lab] run error:", e?.code || "", e?.message || e);
    if (e?.response?.data) {
      console.error("[payme-lab] response:", e.response.data);
    }

    return res.status(500).json({
      ok: false,
      error: e?.response?.data || e?.message || String(e),
    });
  }
}

async function createTopupOrder(req, res) {
  const clientId = toInt(req.body?.client_id, 0);
  const amountTiyin = toInt(req.body?.amount_tiyin, 0);
  const provider = safeStr(req.body?.provider || "payme").toLowerCase() || "payme";
  const status = safeStr(req.body?.status || "created").toLowerCase() || "created";

  if (!clientId) {
    return res.status(400).json({ ok: false, message: "client_id required" });
  }

  if (!amountTiyin || amountTiyin <= 0) {
    return res.status(400).json({ ok: false, message: "amount_tiyin must be > 0" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const clientQ = await client.query(
      `SELECT id, phone, contact_balance FROM clients WHERE id=$1 LIMIT 1`,
      [clientId]
    );

    if (!clientQ.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, message: `Client ${clientId} not found` });
    }

    const ins = await client.query(
      `
      INSERT INTO topup_orders (client_id, amount_tiyin, provider, status)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [clientId, amountTiyin, provider, status]
    );

    await client.query("COMMIT");

    return res.json({
      ok: true,
      order: ins.rows[0],
      client: clientQ.rows[0],
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("createTopupOrder error:", e);
    return res.status(500).json({ ok: false, message: e?.message || "Internal error" });
  } finally {
    client.release();
  }
}

async function inspectTopupOrder(req, res) {
  const orderId = toInt(req.params.orderId || req.query.order_id, 0);

  if (!orderId) {
    return res.status(400).json({ ok: false, message: "orderId required" });
  }

  try {
    const orderQ = await pool.query(`SELECT * FROM topup_orders WHERE id=$1`, [orderId]);
    const order = orderQ.rows[0] || null;

    if (!order) {
      return res.status(404).json({ ok: false, message: "Order not found" });
    }

    const clientQ = await pool.query(
      `SELECT id, phone, contact_balance FROM clients WHERE id=$1 LIMIT 1`,
      [order.client_id]
    );

    const txQ = await pool.query(
      `
      SELECT *
      FROM payme_transactions
      WHERE order_id=$1
      ORDER BY updated_at DESC NULLS LAST, create_time DESC
      `,
      [orderId]
    );

    const ledgerQ = await pool.query(
      `
      SELECT *
      FROM contact_balance_ledger
      WHERE (meta->>'order_id' = $1)
         OR (
           client_id = $2
           AND source IN ('payme', 'payme_refund')
           AND meta->>'order_id' = $1
         )
      ORDER BY created_at ASC
      `,
      [String(orderId), Number(order.client_id)]
    );

    const ledgerRows = ledgerQ.rows;
    const ledgerSum = ledgerRows.reduce((s, r) => s + Number(r?.amount || 0), 0);

    return res.json({
      ok: true,
      order,
      client: clientQ.rows[0] || null,
      transactions: txQ.rows,
      ledger: ledgerRows,
      summary: {
        tx_count: txQ.rows.length,
        ledger_rows: ledgerRows.length,
        ledger_sum: ledgerSum,
      },
    });
  } catch (e) {
    console.error("inspectTopupOrder error:", e);
    return res.status(500).json({ ok: false, message: e?.message || "Internal error" });
  }
}

module.exports = {
  paymeLabRun,
  createTopupOrder,
  inspectTopupOrder,
};
