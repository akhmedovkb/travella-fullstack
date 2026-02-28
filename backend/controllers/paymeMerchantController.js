// backend/controllers/paymeMerchantController.js
const pool = require("../db");
const crypto = require("crypto");

/**
 * ===================== PAYME MERCHANT API (BANK-GRADE MAX) =====================
 *
 * JSON-RPC 2.0 via HTTP POST
 * Auth: Basic base64(login:password)
 *
 * ENV (required):
 *   PAYME_MODE=live|sandbox
 *   PAYME_MERCHANT_LOGIN / PAYME_MERCHANT_KEY
 *   PAYME_MERCHANT_LOGIN_SANDBOX / PAYME_MERCHANT_KEY_SANDBOX
 *
 * ENV (optional):
 *   PAYME_TX_TIMEOUT_MS=43200000  // override (default 12h)
 *   PAYME_REQUIRE_TIME=true|false // strict params.time validation in CreateTransaction (default true)
 *   PAYME_ALLOW_REFUND=true|false // enable RefundTransaction custom method
 *
 * Assumptions (your schema based on prior context):
 *   - topup_orders(id, client_id, amount_tiyin, status, paid_at)
 *   - payme_transactions(payme_id PK/unique, order_id, amount_tiyin, state, create_time, perform_time, cancel_time, reason, updated_at)
 *   - clients(id, contact_balance)
 *   - contact_balance_ledger(client_id, amount, reason, source, meta jsonb, created_at)
 *
 * Idempotency model (self-contained, no indexes required):
 *   - advisory xact locks: payme:<id> and order:<orderId>
 *   - ledger idempotency: SELECT ... FOR UPDATE on ledger existence (meta->>'payme_id')
 */

const TX_TIMEOUT_MS = Number(process.env.PAYME_TX_TIMEOUT_MS || 12 * 60 * 60 * 1000);
const REQUIRE_TIME = String(process.env.PAYME_REQUIRE_TIME || "true").toLowerCase() !== "false";

const PAYME_ERR = {
  INVALID_AMOUNT: -31001,
  NOT_FOUND: -31003,
  ALREADY_PAID: -31008,
  UNAUTHORIZED: -32504,
  INTERNAL: -32400,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,

  // rarely used, but keep (some integrators like it)
  INVALID_ACCOUNT: -31050,

  // custom internal conflict
  CONFLICT: -31099,
};

function logPayme(event, extra = {}) {
  try {
    console.log(
      JSON.stringify({
        tag: "payme",
        ts: new Date().toISOString(),
        event,
        ...extra,
      })
    );
  } catch {}
}

function ok(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message, data) {
  const e = { code, message };
  if (data !== undefined) e.data = data;
  return { jsonrpc: "2.0", id, error: e };
}

function nowMs() {
  return Date.now();
}

/* ===================== AUTH ===================== */

function parseBasicAuth(req) {
  const h = req.headers?.authorization || "";
  const m = /^Basic\s+(.+)$/i.exec(h);
  if (!m) return null;
  try {
    const raw = Buffer.from(m[1], "base64").toString("utf8");
    const idx = raw.indexOf(":");
    if (idx < 0) return null;
    return { login: raw.slice(0, idx), password: raw.slice(idx + 1) };
  } catch {
    return null;
  }
}

function safeEq(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function requireAuth(req) {
  const mode = String(process.env.PAYME_MODE || "live").toLowerCase();

  const expectedLogin =
    mode === "sandbox"
      ? (process.env.PAYME_MERCHANT_LOGIN_SANDBOX || "")
      : (process.env.PAYME_MERCHANT_LOGIN || "");

  const expectedKey =
    mode === "sandbox"
      ? (process.env.PAYME_MERCHANT_KEY_SANDBOX || "")
      : (process.env.PAYME_MERCHANT_KEY || "");

  if (!expectedLogin || !expectedKey) return false;

  const parsed = parseBasicAuth(req);
  if (!parsed) return false;

  return safeEq(parsed.login, expectedLogin) && safeEq(parsed.password, expectedKey);
}

/* ===================== RPC VALIDATION ===================== */

function validateRpc(body) {
  const jsonrpc = body?.jsonrpc;
  const id = body?.id;
  const method = body?.method;
  const params = body?.params;

  if (jsonrpc !== "2.0") {
    return { ok: false, id: id ?? null, err: rpcError(id ?? null, PAYME_ERR.INVALID_REQUEST, "Invalid Request") };
  }
  if (typeof method !== "string" || !method) {
    return { ok: false, id: id ?? null, err: rpcError(id ?? null, PAYME_ERR.INVALID_REQUEST, "Invalid Request") };
  }
  if (params !== undefined && (typeof params !== "object" || params === null)) {
    return { ok: false, id: id ?? null, err: rpcError(id ?? null, PAYME_ERR.INVALID_PARAMS, "Invalid params") };
  }
  return { ok: true, id, method, params: params || {} };
}

/* ===================== PAYME PARAMS HELPERS ===================== */

/**
 * Payme "account" object depends on cashier settings.
 * We use: account.order_id (as Payme asked you)
 */
function extractOrderId(params) {
  const oid = params?.account?.order_id ?? params?.account?.["order_id"];
  const n = Number(oid);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseAmount(params) {
  const amount = Number(params?.amount);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function parsePaymeId(params) {
  const paymeId = String(params?.id || "");
  return paymeId ? paymeId : null;
}

function parsePaymeTimeMs(params) {
  const t = Number(params?.time);
  return Number.isFinite(t) && t > 0 ? t : null;
}

/**
 * bank-grade: optional strict "time window"
 * - In many setups Payme sends params.time = ms since epoch.
 * - We accept if it is:
 *    - present (unless REQUIRE_TIME=false)
 *    - within +/- 15 minutes drift (anti-fraud)
 */
function validateCreateTimeOrThrow(id, timeMs) {
  if (!timeMs) {
    if (REQUIRE_TIME) {
      return { ok: false, err: rpcError(id, PAYME_ERR.INVALID_PARAMS, "Missing params.time") };
    }
    return { ok: true };
  }

  const drift = Math.abs(nowMs() - timeMs);
  const MAX_DRIFT_MS = 15 * 60 * 1000;
  if (drift > MAX_DRIFT_MS) {
    return { ok: false, err: rpcError(id, PAYME_ERR.INVALID_PARAMS, "Invalid params.time (drift)") };
  }
  return { ok: true };
}

/* ===================== DB HELPERS (TX) ===================== */

async function lockKeyTx(client, keyStr) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [String(keyStr)]);
}

async function getOrderTx(client, orderId) {
  const { rows } = await client.query(
    `SELECT id, client_id, amount_tiyin, status, paid_at
       FROM topup_orders
      WHERE id = $1
      FOR UPDATE`,
    [orderId]
  );
  return rows[0] || null;
}

async function getTxForUpdate(client, paymeId) {
  const { rows } = await client.query(
    `SELECT payme_id, order_id, amount_tiyin, state, create_time, perform_time, cancel_time, reason
       FROM payme_transactions
      WHERE payme_id = $1
      FOR UPDATE`,
    [paymeId]
  );
  return rows[0] || null;
}

async function insertTxIfAbsent(client, { paymeId, orderId, amount, createTime }) {
  const { rows } = await client.query(
    `INSERT INTO payme_transactions
      (payme_id, order_id, amount_tiyin, state, create_time, updated_at)
     VALUES ($1,$2,$3,1,$4,now())
     ON CONFLICT (payme_id) DO NOTHING
     RETURNING payme_id, order_id, amount_tiyin, state, create_time, perform_time, cancel_time, reason`,
    [paymeId, orderId, amount, createTime]
  );
  return rows[0] || null;
}

async function setTxState(client, paymeId, patch) {
  const state = Number.isFinite(patch?.state) ? patch.state : null;
  const perform_time = Number.isFinite(patch?.perform_time) ? patch.perform_time : null;
  const cancel_time = Number.isFinite(patch?.cancel_time) ? patch.cancel_time : null;
  const reason =
    patch && Object.prototype.hasOwnProperty.call(patch, "reason") ? patch.reason : null;

  const { rows } = await client.query(
    `UPDATE payme_transactions
        SET state = COALESCE($2, state),
            perform_time = COALESCE($3, perform_time),
            cancel_time = COALESCE($4, cancel_time),
            reason = COALESCE($5, reason),
            updated_at = now()
      WHERE payme_id = $1
      RETURNING payme_id, order_id, amount_tiyin, state, create_time, perform_time, cancel_time, reason`,
    [paymeId, state, perform_time, cancel_time, reason]
  );
  return rows[0] || null;
}

async function markOrderStatusTx(client, orderId, status, paidAt = null) {
  await client.query(
    `UPDATE topup_orders
        SET status = $2,
            paid_at = COALESCE($3, paid_at)
      WHERE id = $1`,
    [orderId, status, paidAt]
  );
}

/* ===================== LEDGER (SELF-CONTAINED IDEMPOTENCY) ===================== */

async function ledgerExistsTx(client, { clientId, source, reason, paymeId }) {
  const { rows } = await client.query(
    `
    SELECT id
      FROM contact_balance_ledger
     WHERE client_id = $1
       AND source = $2
       AND reason = $3
       AND (meta->>'payme_id') = $4
     LIMIT 1
     FOR UPDATE
    `,
    [Number(clientId), String(source), String(reason), String(paymeId)]
  );
  return !!rows?.length;
}

async function creditLedgerOnceTx(client, { clientId, amountTiyin, orderId, paymeId }) {
  const meta = {
    payme_id: String(paymeId),
    order_id: String(orderId),
  };

  const exists = await ledgerExistsTx(client, {
    clientId,
    source: "payme",
    reason: "topup",
    paymeId,
  });
  if (exists) return { credited: false };

  await client.query(
    `INSERT INTO contact_balance_ledger
      (client_id, amount, reason, source, meta, created_at)
     VALUES ($1, $2, 'topup', 'payme', $3::jsonb, now())`,
    [Number(clientId), Number(amountTiyin), JSON.stringify(meta)]
  );

  await client.query(
    `UPDATE clients
        SET contact_balance = COALESCE(contact_balance, 0) + $2
      WHERE id = $1`,
    [Number(clientId), Number(amountTiyin)]
  );

  return { credited: true };
}

async function debitLedgerOnceTx(client, { clientId, amountTiyin, orderId, paymeId, reasonCode }) {
  const meta = {
    payme_id: String(paymeId),
    order_id: String(orderId),
    cancel_reason: reasonCode == null ? null : String(reasonCode),
  };

  const exists = await ledgerExistsTx(client, {
    clientId,
    source: "payme",
    reason: "topup_reversal",
    paymeId,
  });
  if (exists) return { debited: false };

  await client.query(
    `INSERT INTO contact_balance_ledger
      (client_id, amount, reason, source, meta, created_at)
     VALUES ($1, $2, 'topup_reversal', 'payme', $3::jsonb, now())`,
    [Number(clientId), -Math.abs(Number(amountTiyin)), JSON.stringify(meta)]
  );

  await client.query(
    `UPDATE clients
        SET contact_balance = GREATEST(COALESCE(contact_balance,0) + $2, 0)
      WHERE id = $1`,
    [Number(clientId), -Math.abs(Number(amountTiyin))]
  );

  return { debited: true };
}

/* ===================== OPTIONAL REFUND (CUSTOM) ===================== */

async function refundOnceTx(client, { clientId, amountTiyin, orderId, paymeId }) {
  const meta = {
    refund_of: String(paymeId),
    order_id: String(orderId),
    payme_id: String(paymeId),
  };

  const { rows: ex } = await client.query(
    `
    SELECT id
      FROM contact_balance_ledger
     WHERE client_id = $1
       AND source = 'payme_refund'
       AND reason = 'topup_refund'
       AND (meta->>'refund_of') = $2
     LIMIT 1
     FOR UPDATE
    `,
    [Number(clientId), String(paymeId)]
  );
  if (ex?.length) return { refunded: false };

  await client.query(
    `INSERT INTO contact_balance_ledger
      (client_id, amount, reason, source, meta, created_at)
     VALUES ($1, $2, 'topup_refund', 'payme_refund', $3::jsonb, now())`,
    [Number(clientId), -Math.abs(Number(amountTiyin)), JSON.stringify(meta)]
  );

  await client.query(
    `UPDATE clients
        SET contact_balance = COALESCE(contact_balance, 0) - $2
      WHERE id = $1`,
    [Number(clientId), Math.abs(Number(amountTiyin))]
  );

  await client.query(
    `UPDATE topup_orders
        SET status = 'refunded'
      WHERE id = $1 AND status = 'paid'`,
    [Number(orderId)]
  );

  return { refunded: true };
}

/* ===================== BANK-GRADE: CONSISTENT ERROR MAPPING ===================== */

function errNotFound(id, msg) {
  return rpcError(id, PAYME_ERR.NOT_FOUND, msg || "Not found");
}
function errAlreadyPaid(id, msg) {
  return rpcError(id, PAYME_ERR.ALREADY_PAID, msg || "Already paid");
}
function errInvalidAmount(id, msg) {
  return rpcError(id, PAYME_ERR.INVALID_AMOUNT, msg || "Incorrect amount");
}

/* ===================== MAIN HANDLER ===================== */

async function paymeMerchantRpc(req, res) {
  try {
    if (!requireAuth(req)) {
      return res.status(200).json(rpcError(null, PAYME_ERR.UNAUTHORIZED, "Unauthorized"));
    }

    const v = validateRpc(req.body || {});
    if (!v.ok) return res.status(200).json(v.err);

    const { id, method, params } = v;

    /* ---------------- CheckPerformTransaction ---------------- */
    if (method === "CheckPerformTransaction") {
      const orderId = extractOrderId(params);
      const amount = parseAmount(params);

      if (!orderId) return res.status(200).json(errNotFound(id, "Invalid account"));
      if (!amount) return res.status(200).json(rpcError(id, PAYME_ERR.INVALID_PARAMS, "Invalid params.amount"));

      const { rows } = await pool.query(
        `SELECT id, amount_tiyin, status
           FROM topup_orders
          WHERE id = $1`,
        [orderId]
      );
      const order = rows[0];

      if (!order) return res.status(200).json(errNotFound(id, "Order not found"));
      if (Number(order.amount_tiyin) !== amount) return res.status(200).json(errInvalidAmount(id, "Incorrect amount"));
      if (order.status === "paid") return res.status(200).json(errAlreadyPaid(id, "Already paid"));

      return res.status(200).json(ok(id, { allow: true }));
    }

    /* ---------------- CreateTransaction ---------------- */
    if (method === "CreateTransaction") {
      const paymeId = parsePaymeId(params);
      const orderId = extractOrderId(params);
      const amount = parseAmount(params);
      const timeMs = parsePaymeTimeMs(params);

      if (!paymeId) return res.status(200).json(rpcError(id, PAYME_ERR.INVALID_PARAMS, "Missing params.id"));
      if (!orderId) return res.status(200).json(errNotFound(id, "Invalid account"));
      if (!amount) return res.status(200).json(rpcError(id, PAYME_ERR.INVALID_PARAMS, "Invalid params.amount"));

      const tv = validateCreateTimeOrThrow(id, timeMs);
      if (!tv.ok) return res.status(200).json(tv.err);

      const createTime = timeMs || nowMs();

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        await lockKeyTx(client, `payme:${paymeId}`);
        await lockKeyTx(client, `order:${orderId}`);

        logPayme("CreateTransaction.begin", { paymeId, orderId, amount, createTime });

        const existing = await getTxForUpdate(client, paymeId);
        if (existing) {
          if (Number(existing.order_id) !== Number(orderId)) {
            await client.query("ROLLBACK");
            return res.status(200).json(rpcError(id, PAYME_ERR.CONFLICT, "Transaction conflict (order mismatch)"));
          }
          if (Number(existing.amount_tiyin) !== Number(amount)) {
            await client.query("ROLLBACK");
            return res.status(200).json(errInvalidAmount(id, "Incorrect amount"));
          }

          // bank-grade: если заказ уже paid — приводим tx к state=2
          const order = await getOrderTx(client, orderId);
          if (order && order.status === "paid" && Number(existing.state) !== 2) {
            const performTime = order.paid_at ? new Date(order.paid_at).getTime() : nowMs();
            await setTxState(client, paymeId, { state: 2, perform_time: performTime });
            existing.state = 2;
            existing.perform_time = performTime;
          }

          await client.query("COMMIT");
          return res.status(200).json(
            ok(id, {
              create_time: Number(existing.create_time) || createTime,
              transaction: paymeId,
              state: Number(existing.state),
              receivers: null,
            })
          );
        }

        const order = await getOrderTx(client, orderId);
        if (!order) {
          await client.query("ROLLBACK");
          return res.status(200).json(errNotFound(id, "Order not found"));
        }

        // bank-grade: amount drift protection
        if (Number(order.amount_tiyin) !== Number(amount)) {
          await client.query("ROLLBACK");
          return res.status(200).json(errInvalidAmount(id, "Incorrect amount"));
        }

        // already paid
        if (order.status === "paid") {
          await client.query("ROLLBACK");
          return res.status(200).json(errAlreadyPaid(id, "Already paid"));
        }

        await insertTxIfAbsent(client, { paymeId, orderId, amount, createTime });

        if (order.status !== "created") {
          await markOrderStatusTx(client, orderId, "created");
        }

        await client.query("COMMIT");

        return res.status(200).json(
          ok(id, {
            create_time: createTime,
            transaction: paymeId,
            state: 1,
            receivers: null,
          })
        );
      } catch (e) {
        try { await client.query("ROLLBACK"); } catch {}
        console.error("[payme] CreateTransaction error:", e?.message || e);
        if (e?.code) console.error("[payme] pg code:", e.code);
        return res.status(200).json(rpcError(id, PAYME_ERR.INTERNAL, "Internal error"));
      } finally {
        client.release();
      }
    }

    /* ---------------- PerformTransaction ---------------- */
    if (method === "PerformTransaction") {
      const paymeId = parsePaymeId(params);
      if (!paymeId) return res.status(200).json(rpcError(id, PAYME_ERR.INVALID_PARAMS, "Missing params.id"));

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        await lockKeyTx(client, `payme:${paymeId}`);
        logPayme("PerformTransaction.begin", { paymeId });

        const tx = await getTxForUpdate(client, paymeId);
        if (!tx) {
          await client.query("ROLLBACK");
          return res.status(200).json(errNotFound(id, "Transaction not found"));
        }

        if (tx?.order_id) await lockKeyTx(client, `order:${tx.order_id}`);

        // already performed
        if (Number(tx.state) === 2) {
          await client.query("COMMIT");
          return res.status(200).json(
            ok(id, {
              transaction: paymeId,
              perform_time: Number(tx.perform_time) || nowMs(),
              state: 2,
            })
          );
        }

        // cancelled
        if (Number(tx.state) === -1 || Number(tx.state) === -2) {
          await client.query("COMMIT");
          // Payme обычно ожидает ошибку, а не ok
          return res.status(200).json(errAlreadyPaid(id, "Transaction cancelled"));
        }

        // timeout -> expire (state=-1)
        const ct = Number(tx.create_time) || 0;
        if (ct && nowMs() - ct > TX_TIMEOUT_MS) {
          const cancelTime = nowMs();
          await setTxState(client, paymeId, { state: -1, cancel_time: cancelTime, reason: 4 });
          await client.query("COMMIT");
          return res.status(200).json(errAlreadyPaid(id, "Transaction expired"));
        }

        const orderId = Number(tx.order_id);
        const order = await getOrderTx(client, orderId);
        if (!order) {
          await client.query("ROLLBACK");
          return res.status(200).json(errNotFound(id, "Order not found"));
        }

        // bank-grade: amount drift check again
        if (Number(order.amount_tiyin) !== Number(tx.amount_tiyin)) {
          await client.query("ROLLBACK");
          return res.status(200).json(errInvalidAmount(id, "Incorrect amount"));
        }

        // if order already paid -> finalize tx and return ok
        if (order.status === "paid") {
          const performTime = order.paid_at ? new Date(order.paid_at).getTime() : nowMs();
          await setTxState(client, paymeId, { state: 2, perform_time: performTime });
          await client.query("COMMIT");
          return res.status(200).json(ok(id, { transaction: paymeId, perform_time: performTime, state: 2 }));
        }

        const performTime = nowMs();

        // Mark tx performed first (so retries see state=2)
        await setTxState(client, paymeId, { state: 2, perform_time: performTime });

        // Then mark order paid (single source of truth)
        await markOrderStatusTx(client, orderId, "paid", new Date(performTime));

        // FK sanity (avoid crash)
        const { rows: cRows } = await client.query(`SELECT id FROM clients WHERE id=$1`, [Number(order.client_id)]);
        if (!cRows.length) {
          await client.query("ROLLBACK");
          return res.status(200).json(errNotFound(id, "Client not found"));
        }

        logPayme("PerformTransaction.credited", {
          paymeId,
          orderId,
          clientId: Number(order.client_id),
        });

        await creditLedgerOnceTx(client, {
          clientId: Number(order.client_id),
          amountTiyin: Number(order.amount_tiyin),
          orderId,
          paymeId,
        });

        await client.query("COMMIT");

        return res.status(200).json(
          ok(id, {
            transaction: paymeId,
            perform_time: performTime,
            state: 2,
          })
        );
      } catch (e) {
        try { await client.query("ROLLBACK"); } catch {}
        console.error("[payme] PerformTransaction error:", e?.message || e);
        if (e?.code) console.error("[payme] pg code:", e.code);
        return res.status(200).json(rpcError(id, PAYME_ERR.INTERNAL, "Internal error"));
      } finally {
        client.release();
      }
    }

    /* ---------------- CancelTransaction ---------------- */
    if (method === "CancelTransaction") {
      const paymeId = parsePaymeId(params);
      const reason = Number(params?.reason);

      if (!paymeId) return res.status(200).json(rpcError(id, PAYME_ERR.INVALID_PARAMS, "Missing params.id"));

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        await lockKeyTx(client, `payme:${paymeId}`);

        const tx = await getTxForUpdate(client, paymeId);
        if (!tx) {
          await client.query("ROLLBACK");
          return res.status(200).json(errNotFound(id, "Transaction not found"));
        }

        if (tx?.order_id) await lockKeyTx(client, `order:${tx.order_id}`);

        // already cancelled
        if (Number(tx.state) === -1 || Number(tx.state) === -2) {
          await client.query("COMMIT");
          return res.status(200).json(
            ok(id, {
              transaction: paymeId,
              cancel_time: Number(tx.cancel_time) || nowMs(),
              state: Number(tx.state),
              reason: tx.reason ?? null,
            })
          );
        }

        const cancelTime = nowMs();
        const newState = Number(tx.state) === 2 ? -2 : -1;

        const updated = await setTxState(client, paymeId, {
          state: newState,
          cancel_time: cancelTime,
          reason: Number.isFinite(reason) ? reason : null,
        });

        // if cancelling performed tx -> reversal once
        if (Number(updated?.state ?? newState) === -2) {
          const orderId = Number(tx.order_id);
          const order = await getOrderTx(client, orderId);
          if (order) {
            await debitLedgerOnceTx(client, {
              clientId: Number(order.client_id),
              amountTiyin: Number(order.amount_tiyin),
              orderId,
              paymeId,
              reasonCode: Number.isFinite(reason) ? reason : null,
            });

            await markOrderStatusTx(client, orderId, "cancelled");
          }
        }

        // ✅ guaranteed COMMIT before response
        await client.query("COMMIT");

        return res.status(200).json(
          ok(id, {
            transaction: paymeId,
            cancel_time: cancelTime,
            state: Number(updated?.state ?? newState),
            reason: updated?.reason ?? (Number.isFinite(reason) ? reason : null),
          })
        );
      } catch (e) {
        try { await client.query("ROLLBACK"); } catch {}
        console.error("[payme] CancelTransaction error:", e?.message || e);
        if (e?.code) console.error("[payme] pg code:", e.code);
        return res.status(200).json(rpcError(id, PAYME_ERR.INTERNAL, "Internal error"));
      } finally {
        client.release();
      }
    }

    /* ---------------- CheckTransaction ---------------- */
    if (method === "CheckTransaction") {
      const paymeId = parsePaymeId(params);
      if (!paymeId) return res.status(200).json(rpcError(id, PAYME_ERR.INVALID_PARAMS, "Missing params.id"));

      const { rows } = await pool.query(
        `SELECT payme_id, order_id, state, create_time, perform_time, cancel_time, reason
           FROM payme_transactions
          WHERE payme_id = $1`,
        [paymeId]
      );
      const tx = rows[0];
      if (!tx) return res.status(200).json(errNotFound(id, "Transaction not found"));

      return res.status(200).json(
        ok(id, {
          create_time: Number(tx.create_time) || 0,
          perform_time: Number(tx.perform_time) || 0,
          cancel_time: Number(tx.cancel_time) || 0,
          transaction: String(tx.payme_id),
          state: Number(tx.state),
          reason: tx.reason ?? null,
        })
      );
    }

    /* ---------------- GetStatement ---------------- */
    if (method === "GetStatement") {
      const from = Number(params?.from);
      const to = Number(params?.to);

      if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < 0 || to < from) {
        return res.status(200).json(rpcError(id, PAYME_ERR.INVALID_PARAMS, "Invalid params.from/to"));
      }

      const { rows } = await pool.query(
        `
        SELECT payme_id, order_id, amount_tiyin, state, create_time, perform_time, cancel_time, reason
          FROM payme_transactions
         WHERE create_time >= $1
           AND create_time <= $2
         ORDER BY create_time ASC
         LIMIT 5000
        `,
        [from, to]
      );

      const result = rows.map((r) => ({
        id: String(r.payme_id),
        time: Number(r.create_time) || 0,
        amount: Number(r.amount_tiyin) || 0,
        account: { order_id: String(r.order_id) },
        create_time: Number(r.create_time) || 0,
        perform_time: Number(r.perform_time) || 0,
        cancel_time: Number(r.cancel_time) || 0,
        transaction: String(r.payme_id),
        state: Number(r.state),
        reason: r.reason ?? null,
      }));

      return res.status(200).json(ok(id, { transactions: result }));
    }

    /* ---------------- SetFiscalData (optional) ---------------- */
    if (method === "SetFiscalData") {
      return res.status(200).json(ok(id, { success: true }));
    }

    /* ---------------- RefundTransaction (custom, optional) ---------------- */
    if (method === "RefundTransaction") {
      if (String(process.env.PAYME_ALLOW_REFUND || "").toLowerCase() !== "true") {
        return res.status(200).json(rpcError(id, PAYME_ERR.METHOD_NOT_FOUND, "Method not allowed"));
      }

      const paymeId = parsePaymeId(params);
      if (!paymeId) return res.status(200).json(rpcError(id, PAYME_ERR.INVALID_PARAMS, "Missing params.id"));

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await lockKeyTx(client, `payme:${paymeId}`);

        const tx = await getTxForUpdate(client, paymeId);
        if (!tx || Number(tx.state) !== 2) {
          await client.query("ROLLBACK");
          return res.status(200).json(errNotFound(id, "Transaction not refundable"));
        }

        await lockKeyTx(client, `order:${tx.order_id}`);

        const order = await getOrderTx(client, Number(tx.order_id));
        if (!order) {
          await client.query("ROLLBACK");
          return res.status(200).json(errNotFound(id, "Order not found"));
        }

        const r = await refundOnceTx(client, {
          clientId: Number(order.client_id),
          amountTiyin: Number(order.amount_tiyin),
          orderId: Number(order.id),
          paymeId,
        });

        await client.query("COMMIT");
        return res.status(200).json(ok(id, { refunded: !!r.refunded }));
      } catch (e) {
        try { await client.query("ROLLBACK"); } catch {}
        console.error("[payme] RefundTransaction error:", e?.message || e);
        return res.status(200).json(rpcError(id, PAYME_ERR.INTERNAL, "Internal error"));
      } finally {
        client.release();
      }
    }

    return res.status(200).json(rpcError(id, PAYME_ERR.METHOD_NOT_FOUND, "Method not found"));
  } catch (e) {
    console.error("[payme] handler fatal:", e?.message || e);
    if (e?.code) console.error("[payme] pg code:", e.code);
    return res.status(200).json(rpcError(null, PAYME_ERR.INTERNAL, "Internal error"));
  }
}

module.exports = {
  paymeMerchantRpc,
};
