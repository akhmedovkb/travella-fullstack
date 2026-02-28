// backend/controllers/paymeMerchantController.js
const pool = require("../db");
const crypto = require("crypto");

function getPaymeCreds() {
  const mode = String(process.env.PAYME_MODE || "").trim().toLowerCase();

  // sandbox/test mode
  if (mode === "sandbox" || mode === "test" || mode === "dev") {
    return {
      login:
        process.env.PAYME_MERCHANT_LOGIN_SANDBOX ||
        process.env.PAYME_MERCHANT_LOGIN ||
        "",
      key:
        process.env.PAYME_MERCHANT_KEY_SANDBOX ||
        process.env.PAYME_MERCHANT_KEY ||
        "",
    };
  }

  // prod/default
  return {
    login: process.env.PAYME_MERCHANT_LOGIN || "",
    key: process.env.PAYME_MERCHANT_KEY || "",
  };
}

function parseBasicAuth(req) {
  const h = String(req.headers.authorization || "");
  const m = h.match(/^Basic\s+(.+)$/i);
  if (!m) return null;
  try {
    const raw = Buffer.from(m[1], "base64").toString("utf8");
    const idx = raw.indexOf(":");
    if (idx < 0) return null;
    return { login: raw.slice(0, idx), key: raw.slice(idx + 1) };
  } catch {
    return null;
  }
}

/**
 * Payme Merchant API (Paycom): JSON-RPC 2.0 via HTTP POST
 * Auth: Basic base64(login:password)
 *
 * ENV:
 *   PAYME_MODE=live|sandbox
 *   PAYME_MERCHANT_LOGIN / PAYME_MERCHANT_KEY
 *   PAYME_MERCHANT_LOGIN_SANDBOX / PAYME_MERCHANT_KEY_SANDBOX
 */

const TX_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12h

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

function toIntAmountTiyin(x) {
  // Payme sends "amount" in tiyin (integer). Be strict to avoid float bugs.
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i <= 0) return null;
  if (i !== n) return null; // reject fractional values
  return i;
}

/** ===== auth ===== */

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

function getPaymeCreds() {
  const mode = String(process.env.PAYME_MODE || "").toLowerCase();
  const isSandbox = mode === "sandbox" || mode === "test";

  const login = isSandbox
    ? process.env.PAYME_MERCHANT_LOGIN_SANDBOX || process.env.PAYME_MERCHANT_LOGIN
    : process.env.PAYME_MERCHANT_LOGIN;

  const key = isSandbox
    ? process.env.PAYME_MERCHANT_KEY_SANDBOX || process.env.PAYME_MERCHANT_KEY
    : process.env.PAYME_MERCHANT_KEY;

  return { login: String(login || ""), key: String(key || "") };
}

function parseBasicAuth(req) {
  const h = String(req.headers.authorization || "");
  const m = h.match(/^Basic\s+(.+)$/i);
  if (!m) return null;

  try {
    const raw = Buffer.from(m[1], "base64").toString("utf8");
    const idx = raw.indexOf(":");
    if (idx < 0) return null;
    return { login: raw.slice(0, idx), key: raw.slice(idx + 1) };
  } catch {
    return null;
  }
}

function requireAuth(req) {
  const { login: expLogin, key: expKey } = getPaymeCreds();
  const got = parseBasicAuth(req);

  // если кредов нет — всегда запрещаем (чтобы не открыть дыру)
  if (!expLogin || !expKey) return false;

  return !!got && got.login === expLogin && got.key === expKey;
}

/** ===== normalization (bank-grade) ===== */

function normalizePaymeId(x) {
  // Payme id может прилететь с пробелами/невидимыми символами из тестов/инструментов
  // Нормализуем одинаково везде.
  const s = String(x ?? "")
    .replace(/\u0000/g, "") // null bytes
    .trim();

  // collapse whitespace inside (на случай "pm_tx_123 " / "pm_tx_ 123")
  return s.replace(/\s+/g, " ");
}

/** ===== Payme account =====
 * We use account.order_id (topup order id)
 */
function extractOrderId(params) {
  const oid = params?.account?.order_id ?? params?.account?.["order_id"];
  const n = Number(oid);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** ===== advisory locks ===== */

async function lockKeyTx(client, keyStr) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [String(keyStr)]);
}

/** ===== DB helpers ===== */

async function getOrderTx(client, orderId) {
  // NOTE: In Travella bot we create orders in payme_topup_orders.
  // Keep this table as the source of truth for Merchant API too.
  const { rows } = await client.query(
    `SELECT id, client_id, amount_tiyin, status, paid_at
       FROM payme_topup_orders
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

// fallback read (без FOR UPDATE) — чтобы диагностировать “почему не нашли”

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
    `UPDATE payme_topup_orders
        SET status = $2,
            paid_at = COALESCE($3, paid_at)
      WHERE id = $1`,
    [orderId, status, paidAt]
  );
}

/**
 * Ledger idempotency:
 * We do NOT rely on "ON CONFLICT" with expression keys (it is not supported in PG syntax).
 * Instead we guarantee idempotency via:
 *  - pg_advisory_xact_lock(payme:<id>) around Perform/Cancel
 *  - explicit existence check inside the same DB transaction
 */
async function creditLedgerOnceTx(client, { clientId, amountTiyin, orderId, paymeId }) {
  const meta = {
    payme_id: String(paymeId),
    order_id: String(orderId),
  };

  const { rows: exist } = await client.query(
    `
      SELECT 1
        FROM contact_balance_ledger
       WHERE client_id = $1
         AND source = 'payme'
         AND reason = 'topup'
         AND (meta->>'payme_id') = $2
       LIMIT 1
    `,
    [Number(clientId), String(paymeId)]
  );
  if (exist?.length) return { credited: false };

  const { rows } = await client.query(
    `
      INSERT INTO contact_balance_ledger
        (client_id, amount, reason, source, meta, created_at)
      VALUES ($1, $2, 'topup', 'payme', $3::jsonb, now())
      RETURNING id
    `,
    [Number(clientId), Number(amountTiyin), JSON.stringify(meta)]
  );
  if (!rows?.length) return { credited: false };

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

  const { rows: exist } = await client.query(
    `
      SELECT 1
        FROM contact_balance_ledger
       WHERE client_id = $1
         AND source = 'payme'
         AND reason = 'topup_reversal'
         AND (meta->>'payme_id') = $2
       LIMIT 1
    `,
    [Number(clientId), String(paymeId)]
  );
  if (exist?.length) return { debited: false };

  const { rows } = await client.query(
    `
      INSERT INTO contact_balance_ledger
        (client_id, amount, reason, source, meta, created_at)
      VALUES ($1, $2, 'topup_reversal', 'payme', $3::jsonb, now())
      RETURNING id
    `,
    [Number(clientId), -Math.abs(Number(amountTiyin)), JSON.stringify(meta)]
  );
  if (!rows?.length) return { debited: false };

  await client.query(
    `UPDATE clients
        SET contact_balance = GREATEST(COALESCE(contact_balance,0) + $2, 0)
      WHERE id = $1`,
    [Number(clientId), -Math.abs(Number(amountTiyin))]
  );

  return { debited: true };
}

/** ===== rpc validation ===== */

function validateRpc(body) {
  const jsonrpc = body?.jsonrpc;
  const id = body?.id;
  const method = body?.method;
  const params = body?.params;

  if (jsonrpc !== "2.0") {
    return { ok: false, id: id ?? null, err: rpcError(id ?? null, -32600, "Invalid Request") };
  }
  if (typeof method !== "string" || !method) {
    return { ok: false, id: id ?? null, err: rpcError(id ?? null, -32600, "Invalid Request") };
  }
  if (params !== undefined && (typeof params !== "object" || params === null)) {
    return { ok: false, id: id ?? null, err: rpcError(id ?? null, -32602, "Invalid params") };
  }
  return { ok: true, id, method, params: params || {} };
}

/** ===== main handler ===== */

async function paymeMerchantRpc(req, res) {
  try {
    if (!requireAuth(req)) {
      const reqId = req?.body?.id ?? null;
      return res.status(200).json(rpcError(reqId, -32504, "Unauthorized"));
    }

    const v = validateRpc(req.body || {});
    if (!v.ok) return res.status(200).json(v.err);

    const { id, method, params } = v;

    /** ---- CheckPerformTransaction ---- */
    if (method === "CheckPerformTransaction") {
      const orderId = extractOrderId(params);
      const amount = toIntAmountTiyin(params.amount);

      if (!orderId) return res.status(200).json(rpcError(id, -31050, "Invalid account"));
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(200).json(rpcError(id, -32602, "Invalid params.amount"));
      }

      const { rows } = await pool.query(
        `SELECT id, amount_tiyin, status
           FROM payme_topup_orders
          WHERE id = $1`,
        [orderId]
      );
      const order = rows[0];
      if (!order) return res.status(200).json(rpcError(id, -31050, "Order not found"));
      if (Number(order.amount_tiyin) !== amount)
        return res.status(200).json(rpcError(id, -31001, "Incorrect amount"));
      if (order.status === "paid") return res.status(200).json(rpcError(id, -31008, "Already paid"));
      if (order.status === "cancelled")
        return res.status(200).json(rpcError(id, -31008, "Order cancelled"));

      return res.status(200).json(ok(id, { allow: true }));
    }

    /** ---- CreateTransaction ---- */
    if (method === "CreateTransaction") {
      const orderId = extractOrderId(params);
      const amount = toIntAmountTiyin(params.amount);
      const paymeIdRaw = params.id;
      const paymeId = normalizePaymeId(paymeIdRaw);
      const time = Number(params.time);

      if (!paymeId) return res.status(200).json(rpcError(id, -32602, "Missing params.id"));
      if (!orderId) return res.status(200).json(rpcError(id, -31050, "Invalid account"));
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(200).json(rpcError(id, -32602, "Invalid params.amount"));
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        await lockKeyTx(client, `payme:${paymeId}`);
        await lockKeyTx(client, `order:${orderId}`);

        logPayme("CreateTransaction.begin", { paymeId, orderId, amount });

        // Edge-case guard: one order must not have 2 active transactions
        const { rows: orderTxRows } = await client.query(
          `SELECT payme_id, state
             FROM payme_transactions
            WHERE order_id = $1
              AND state IN (1,2)
            LIMIT 1
            FOR UPDATE`,
          [orderId]
        );
        const activeForOrder = orderTxRows[0] || null;

        const existing = await getTxForUpdate(client, paymeId);
        if (existing) {
          if (Number(existing.order_id) !== Number(orderId)) {
            await client.query("ROLLBACK");
            return res.status(200).json(rpcError(id, -31099, "Transaction conflict (order mismatch)"));
          }
          if (Number(existing.amount_tiyin) !== Number(amount)) {
            await client.query("ROLLBACK");
            return res.status(200).json(rpcError(id, -31001, "Incorrect amount"));
          }

          await client.query("COMMIT");
          return res.status(200).json(
            ok(id, {
              create_time: Number(existing.create_time) || (Number.isFinite(time) ? time : nowMs()),
              transaction: paymeId,
              state: Number(existing.state),
              receivers: null,
            })
          );
        }

        if (activeForOrder && String(activeForOrder.payme_id) !== String(paymeId)) {
          await client.query("ROLLBACK");
          return res
            .status(200)
            .json(rpcError(id, -31099, "Transaction conflict (another active tx for order)"));
        }

        const order = await getOrderTx(client, orderId);
        if (!order) {
          await client.query("ROLLBACK");
          return res.status(200).json(rpcError(id, -31050, "Order not found"));
        }
        if (Number(order.amount_tiyin) !== amount) {
          await client.query("ROLLBACK");
          return res.status(200).json(rpcError(id, -31001, "Incorrect amount"));
        }
        if (order.status === "paid") {
          await client.query("ROLLBACK");
          return res.status(200).json(rpcError(id, -31008, "Already paid"));
        }
        if (order.status === "cancelled") {
          await client.query("ROLLBACK");
          return res.status(200).json(rpcError(id, -31008, "Order cancelled"));
        }

        const createTime = Number.isFinite(time) && time > 0 ? time : nowMs();

        // Payme spec: do not allow creating too-old transactions
        if (nowMs() - createTime > TX_TIMEOUT_MS) {
          await client.query("ROLLBACK");
          return res.status(200).json(rpcError(id, -31008, "Transaction expired"));
        }

        await insertTxIfAbsent(client, {
          paymeId,
          orderId,
          amount,
          createTime,
        });

        // Keep compatibility with older bot statuses: 'new' -> 'created'
        if (order.status === "new" || order.status === "created" || !order.status) {
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
        try {
          await client.query("ROLLBACK");
        } catch {}
        console.error("[payme] CreateTransaction error:", e?.message || e);
        return res.status(200).json(rpcError(id, -32400, "Internal error"));
      } finally {
        client.release();
      }
    }

/** ---- PerformTransaction ---- */
if (method === "PerformTransaction") {
  const paymeId = normalizePaymeId(params.id);

  if (!paymeId) return res.status(200).json(rpcError(id, -32602, "Missing params.id"));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // serialize all operations per payme transaction id
    await lockKeyTx(client, `payme:${paymeId}`);

    logPayme("PerformTransaction.begin", { paymeId });

    // Strict row lock ONLY
    const tx = await getTxForUpdate(client, paymeId);
    if (!tx) {
      await client.query("ROLLBACK");
      const raw = String(params.id ?? "");
      const hex = Buffer.from(raw, "utf8").toString("hex").slice(0, 80);
      logPayme("PerformTransaction.not_found", {
        paymeId_norm: paymeId,
        paymeId_raw_len: raw.length,
        paymeId_raw_hex_prefix: hex,
      });
      return res.status(200).json(rpcError(id, -31003, "Transaction not found"));
    }

    // lock order too
    if (tx?.order_id) {
      await lockKeyTx(client, `order:${tx.order_id}`);
    }

    // cancelled => refuse perform
    if (Number(tx.state) === -1 || Number(tx.state) === -2) {
      await client.query("COMMIT");
      return res.status(200).json(rpcError(id, -31008, "Transaction cancelled"));
    }

    // expired => cancel as -1 and refuse
    const ct = Number(tx.create_time) || 0;
    if (ct && nowMs() - ct > TX_TIMEOUT_MS) {
      const cancelTime = nowMs();
      await setTxState(client, paymeId, { state: -1, cancel_time: cancelTime, reason: 4 });
      await client.query("COMMIT");
      return res.status(200).json(rpcError(id, -31008, "Transaction expired"));
    }

    // idempotent: already performed
    if (Number(tx.state) === 2) {
      const pt = Number(tx.perform_time) || 0;
      await client.query("COMMIT");
      return res.status(200).json(
        ok(id, {
          transaction: paymeId,
          perform_time: pt,
          state: 2,
        })
      );
    }

    const orderId = Number(tx.order_id);
    const order = await getOrderTx(client, orderId);
    if (!order) {
      await client.query("ROLLBACK");
      return res.status(200).json(rpcError(id, -31050, "Order not found"));
    }

    // if our order is cancelled => cancel tx and refuse
    if (order.status === "cancelled") {
      const cancelTime = nowMs();
      await setTxState(client, paymeId, { state: -1, cancel_time: cancelTime, reason: 4 });
      await client.query("COMMIT");
      return res.status(200).json(rpcError(id, -31008, "Order cancelled"));
    }

    // If order already paid (by some other flow), finalize tx as performed idempotently
    if (order.status === "paid") {
      const performTime = order.paid_at ? new Date(order.paid_at).getTime() : nowMs();
      await setTxState(client, paymeId, { state: 2, perform_time: performTime });
      await client.query("COMMIT");
      return res.status(200).json(
        ok(id, {
          transaction: paymeId,
          perform_time: performTime,
          state: 2,
        })
      );
    }

    // FK safety: client must exist
    const { rows: cRows } = await client.query(`SELECT id FROM clients WHERE id=$1`, [
      Number(order.client_id),
    ]);
    if (!cRows.length) {
      await client.query("ROLLBACK");
      return res.status(200).json(rpcError(id, -31050, "Client not found"));
    }

    // Perform time now
    const performTime = nowMs();

    // 1) set tx performed
    await setTxState(client, paymeId, { state: 2, perform_time: performTime });

    // 2) mark order paid
    await markOrderStatusTx(client, orderId, "paid", new Date(performTime));

    // 3) credit once (idempotent via existence check under same advisory lock)
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
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("[payme] PerformTransaction error:", e?.message || e);
    return res.status(200).json(rpcError(id, -32400, "Internal error"));
  } finally {
    client.release();
  }
}
/** ---- CancelTransaction ---- */
if (method === "CancelTransaction") {
  const paymeId = normalizePaymeId(params.id);
  const reason = Number(params.reason);

  if (!paymeId) return res.status(200).json(rpcError(id, -32602, "Missing params.id"));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // lock by payme id (serializes cancel/perform/check flows for same tx)
    await lockKeyTx(client, `payme:${paymeId}`);

    const tx = await getTxForUpdate(client, paymeId);
    if (!tx) {
      await client.query("ROLLBACK");
      return res.status(200).json(rpcError(id, -31003, "Transaction not found"));
    }

    // lock by order too (serializes anything that touches the same order)
    if (tx?.order_id) {
      await lockKeyTx(client, `order:${tx.order_id}`);
    }

    // already cancelled => idempotent reply, no extra debits
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

    // update tx state (single source of truth)
    const updated = await setTxState(client, paymeId, {
      state: newState,
      cancel_time: cancelTime,
      reason: Number.isFinite(reason) ? reason : null,
    });

    // ===== bank-grade reversal decision =====
    const prevState = Number(tx.state);
    const newStateDb = Number(updated?.state ?? newState);

    // reversal only if THIS request moved state from 2 -> -2
    if (prevState === 2 && newStateDb === -2) {
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
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("[payme] CancelTransaction error:", e?.message || e);
    return res.status(200).json(rpcError(id, -32400, "Internal error"));
  } finally {
    client.release();
  }
}

    /** ---- CheckTransaction ---- */
    if (method === "CheckTransaction") {
      const paymeId = normalizePaymeId(params.id);
      if (!paymeId) return res.status(200).json(rpcError(id, -32602, "Missing params.id"));

      const { rows } = await pool.query(
        `SELECT payme_id, order_id, state, create_time, perform_time, cancel_time, reason
           FROM payme_transactions
          WHERE payme_id = $1`,
        [paymeId]
      );
      const tx = rows[0];
      if (!tx) return res.status(200).json(rpcError(id, -31003, "Transaction not found"));

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

    /** ---- GetStatement ---- */
    if (method === "GetStatement") {
      const from = Number(params.from);
      const to = Number(params.to);

      const { rows } = await pool.query(
        `
        SELECT payme_id, order_id, amount_tiyin, state, create_time, perform_time, cancel_time, reason
          FROM payme_transactions
         WHERE ($1::bigint IS NULL OR create_time >= $1)
           AND ($2::bigint IS NULL OR create_time <= $2)
         ORDER BY create_time ASC
         LIMIT 5000
        `,
        [Number.isFinite(from) ? from : null, Number.isFinite(to) ? to : null]
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

    /** ---- SetFiscalData (optional) ---- */
    if (method === "SetFiscalData") {
      return res.status(200).json(ok(id, { success: true }));
    }

    return res.status(200).json(rpcError(id, -32601, "Method not found"));
  } catch (e) {
    console.error("[payme] handler fatal:", e?.message || e);
    return res.status(200).json(rpcError(null, -32400, "Internal error"));
  }
}

module.exports = {
  paymeMerchantRpc,
};
