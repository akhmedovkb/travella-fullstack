// backend/controllers/paymeMerchantController.js
const pool = require("../db");
const crypto = require("crypto");

/**
 * Payme Merchant API (Paycom): JSON-RPC 2.0 via HTTP POST
 * Auth: Basic base64(login:password)
 *
 * ENV:
 *   PAYME_MERCHANT_LOGIN
 *   PAYME_MERCHANT_KEY
 */

const TX_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12h

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

/**
 * Payme "account" object depends on cashier settings.
 * We use: account.order_id (as Payme asked you)
 */
function extractOrderId(params) {
  const oid = params?.account?.order_id ?? params?.account?.["order_id"];
  const n = Number(oid);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function getOrderTx(client, orderId) {
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
  const reason = patch && Object.prototype.hasOwnProperty.call(patch, "reason")
    ? patch.reason
    : null;

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

async function creditLedgerOnceTx(client, { clientId, amountTiyin, orderId, paymeId }) {
  const { rows } = await client.query(
    `INSERT INTO contact_balance_ledger
      (client_id, amount_tiyin, reason, ref_type, ref_id, payme_id, created_at)
     VALUES ($1,$2,'payme_topup','topup_order',$3,$4,now())
     ON CONFLICT (payme_id) DO NOTHING
     RETURNING id`,
    [clientId, amountTiyin, orderId, paymeId]
  );

  if (!rows?.length) return { credited: false };

  await client.query(
    `UPDATE clients
        SET contact_balance = COALESCE(contact_balance, 0) + $2
      WHERE id = $1`,
    [clientId, amountTiyin]
  );

  return { credited: true };
}

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

/**
 * ✅ Сам обработчик, который должен быть callback'ом для router.post(...)
 */
async function paymeMerchantRpc(req, res) {
  // Payme expects HTTP 200 for JSON-RPC responses, even on errors
  try {
    if (!requireAuth(req)) {
      return res.status(200).json(rpcError(null, -32504, "Unauthorized"));
    }

    const v = validateRpc(req.body || {});
    if (!v.ok) return res.status(200).json(v.err);

    const { id, method, params } = v;

    // ---------------- CheckPerformTransaction ----------------
    if (method === "CheckPerformTransaction") {
      const orderId = extractOrderId(params);
      const amount = Number(params.amount);

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
      if (Number(order.amount_tiyin) !== amount) return res.status(200).json(rpcError(id, -31001, "Incorrect amount"));
      if (order.status === "paid") return res.status(200).json(rpcError(id, -31008, "Already paid"));

      return res.status(200).json(ok(id, { allow: true }));
    }

    // ---------------- CreateTransaction ----------------
    if (method === "CreateTransaction") {
      const orderId = extractOrderId(params);
      const amount = Number(params.amount);
      const paymeId = String(params.id || "");
      const time = Number(params.time); // Payme sends ms

      if (!paymeId) return res.status(200).json(rpcError(id, -32602, "Missing params.id"));
      if (!orderId) return res.status(200).json(rpcError(id, -31050, "Invalid account"));
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(200).json(rpcError(id, -32602, "Invalid params.amount"));
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

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

        const createTime = Number.isFinite(time) && time > 0 ? time : nowMs();
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
        try {
          await client.query("ROLLBACK");
        } catch {}
        console.error("[payme] CreateTransaction error:", e?.message || e);
        return res.status(200).json(rpcError(id, -32400, "Internal error"));
      } finally {
        client.release();
      }
    }

    // ---------------- PerformTransaction ----------------
    if (method === "PerformTransaction") {
      const paymeId = String(params.id || "");
      if (!paymeId) return res.status(200).json(rpcError(id, -32602, "Missing params.id"));

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const tx = await getTxForUpdate(client, paymeId);
        if (!tx) {
          await client.query("ROLLBACK");
          return res.status(200).json(rpcError(id, -31003, "Transaction not found"));
        }

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

        if (Number(tx.state) === -1 || Number(tx.state) === -2) {
          await client.query("COMMIT");
          return res.status(200).json(rpcError(id, -31008, "Transaction cancelled"));
        }

        const ct = Number(tx.create_time) || 0;
        if (ct && nowMs() - ct > TX_TIMEOUT_MS) {
          const cancelTime = nowMs();
          await setTxState(client, paymeId, { state: -1, cancel_time: cancelTime, reason: 4 });
          await client.query("COMMIT");
          return res.status(200).json(rpcError(id, -31008, "Transaction expired"));
        }

        const orderId = Number(tx.order_id);
        const order = await getOrderTx(client, orderId);
        if (!order) {
          await client.query("ROLLBACK");
          return res.status(200).json(rpcError(id, -31050, "Order not found"));
        }

        if (order.status === "paid") {
          const performTime = order.paid_at ? new Date(order.paid_at).getTime() : nowMs();
          await setTxState(client, paymeId, { state: 2, perform_time: performTime });
          await client.query("COMMIT");
          return res.status(200).json(ok(id, { transaction: paymeId, perform_time: performTime, state: 2 }));
        }

        const performTime = nowMs();
        await setTxState(client, paymeId, { state: 2, perform_time: performTime });
        await markOrderStatusTx(client, orderId, "paid", new Date(performTime));

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

    // ---------------- CancelTransaction ----------------
    if (method === "CancelTransaction") {
      const paymeId = String(params.id || "");
      const reason = Number(params.reason);

      if (!paymeId) return res.status(200).json(rpcError(id, -32602, "Missing params.id"));

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const tx = await getTxForUpdate(client, paymeId);
        if (!tx) {
          await client.query("ROLLBACK");
          return res.status(200).json(rpcError(id, -31003, "Transaction not found"));
        }

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

    // ---------------- CheckTransaction ----------------
    if (method === "CheckTransaction") {
      const paymeId = String(params.id || "");
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

    // ---------------- GetStatement (required) ----------------
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

    // ---------------- SetFiscalData (optional) ----------------
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
