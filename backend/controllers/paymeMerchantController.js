const pool = require("../db");

/**
 * Payme Merchant API: JSON-RPC 2.0 over HTTP POST.
 * Auth: Authorization: Basic base64(login:password)
 * login + key (password) задаются в env.
 */
function ok(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id, code, message, data) {
  const e = { code, message };
  if (data !== undefined) e.data = data;
  return { jsonrpc: "2.0", id, error: e };
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

function nowMs() {
  return Date.now();
}

async function getOrder(orderId) {
  const { rows } = await pool.query(
    `SELECT id, client_id, amount_tiyin, status, paid_at
     FROM payme_topup_orders
     WHERE id = $1`,
    [orderId]
  );
  return rows[0] || null;
}

/**
 * В Payme "account" приходит как объект, где поля зависят от настройки кассы.
 * Мы используем: ac.order_id=<our order id> (как в документации примере).
 */
function extractOrderId(params) {
  const oid = params?.account?.order_id ?? params?.account?.["order_id"];
  const n = Number(oid);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function upsertPaymeTx({ paymeId, orderId, amount, time, state, perform_time, cancel_time, reason }) {
  await pool.query(
    `
    INSERT INTO payme_transactions (payme_id, order_id, amount_tiyin, state, create_time, perform_time, cancel_time, reason, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
    ON CONFLICT (payme_id) DO UPDATE SET
      order_id = EXCLUDED.order_id,
      amount_tiyin = EXCLUDED.amount_tiyin,
      state = EXCLUDED.state,
      create_time = COALESCE(payme_transactions.create_time, EXCLUDED.create_time),
      perform_time = COALESCE(EXCLUDED.perform_time, payme_transactions.perform_time),
      cancel_time = COALESCE(EXCLUDED.cancel_time, payme_transactions.cancel_time),
      reason = COALESCE(EXCLUDED.reason, payme_transactions.reason),
      updated_at = now()
    `,
    [paymeId, orderId, amount, state, time || null, perform_time || null, cancel_time || null, reason || null]
  );
}

async function markOrderStatus(orderId, status, paidAt = null) {
  await pool.query(
    `UPDATE payme_topup_orders
     SET status = $2,
         paid_at = COALESCE($3, paid_at)
     WHERE id = $1`,
    [orderId, status, paidAt]
  );
}

/**
 * КРИТИЧЕСКОЕ: начисление в ledger — ТОЛЬКО 1 раз.
 * Идемпотентность держим уникальным индексом uq_contact_ledger_payme (meta->>'payme_id').
 */
async function creditLedgerOnce({ clientId, amountTiyin, orderId, paymeId }) {
  const meta = { payme_id: String(paymeId), order_id: String(orderId) };

  await pool.query(
    `
    INSERT INTO contact_balance_ledger (client_id, amount, reason, source, meta)
    VALUES ($1, $2, 'topup', 'payme', $3::jsonb)
    ON CONFLICT DO NOTHING
    `,
    [clientId, amountTiyin, JSON.stringify(meta)]
  );

  // если у тебя ещё есть legacy clients.contact_balance — обновляй ТОЛЬКО если проект так живёт сейчас.
  // Иначе — убери этот блок.
  await pool.query(
    `
    UPDATE clients
    SET contact_balance = COALESCE(contact_balance,0) + $2
    WHERE id = $1
    `,
    [clientId, amountTiyin]
  );
}

exports.paymeMerchantRpc = async (req, res) => {
  const auth = parseBasicAuth(req);
  const LOGIN = process.env.PAYME_MERCHANT_LOGIN || "";
  const KEY = process.env.PAYME_MERCHANT_KEY || "";

  const body = req.body || {};
  const id = body.id;
  const method = body.method;
  const params = body.params || {};

  // Payme требует HTTP 200 даже при ошибках протокола :contentReference[oaicite:3]{index=3}
  try {
    if (!auth || auth.login !== LOGIN || auth.password !== KEY) {
      res.status(200).json(rpcError(id, -32504, "Unauthorized"));
      return;
    }

    if (!method) {
      res.status(200).json(rpcError(id, -32600, "Invalid Request"));
      return;
    }

    // ------------- CheckPerformTransaction -------------
    if (method === "CheckPerformTransaction") {
      const orderId = extractOrderId(params);
      const amount = Number(params.amount);

      if (!orderId) {
        res.status(200).json(rpcError(id, -31050, "Invalid account"));
        return;
      }
      const order = await getOrder(orderId);
      if (!order) {
        res.status(200).json(rpcError(id, -31050, "Order not found"));
        return;
      }
      if (Number(order.amount_tiyin) !== amount) {
        res.status(200).json(rpcError(id, -31001, "Incorrect amount"));
        return;
      }
      // если уже paid — запрещаем повтор
      if (order.status === "paid") {
        res.status(200).json(rpcError(id, -31008, "Already paid"));
        return;
      }

      res.status(200).json(ok(id, { allow: true }));
      return;
    }

    // ------------- CreateTransaction -------------
    if (method === "CreateTransaction") {
      const orderId = extractOrderId(params);
      const amount = Number(params.amount);
      const paymeId = String(params.id || "");
      const time = Number(params.time);

      if (!paymeId) {
        res.status(200).json(rpcError(id, -32602, "Missing params.id"));
        return;
      }
      if (!orderId) {
        res.status(200).json(rpcError(id, -31050, "Invalid account"));
        return;
      }

      const order = await getOrder(orderId);
      if (!order) {
        res.status(200).json(rpcError(id, -31050, "Order not found"));
        return;
      }
      if (Number(order.amount_tiyin) !== amount) {
        res.status(200).json(rpcError(id, -31001, "Incorrect amount"));
        return;
      }
      if (order.status === "paid") {
        res.status(200).json(rpcError(id, -31008, "Already paid"));
        return;
      }

      await upsertPaymeTx({ paymeId, orderId, amount, time, state: 1 });
      await markOrderStatus(orderId, "created");

      // transaction — наш внутренний номер транзакции (можно orderId)
      res.status(200).json(
        ok(id, {
          create_time: time || nowMs(),
          transaction: String(orderId),
          state: 1,
          receivers: null,
        })
      );
      return;
    }

    // ------------- PerformTransaction -------------
    if (method === "PerformTransaction") {
      const paymeId = String(params.id || "");
      if (!paymeId) {
        res.status(200).json(rpcError(id, -32602, "Missing params.id"));
        return;
      }

      const { rows } = await pool.query(
        `SELECT payme_id, order_id, amount_tiyin, state
         FROM payme_transactions
         WHERE payme_id = $1`,
        [paymeId]
      );
      const tx = rows[0];
      if (!tx) {
        res.status(200).json(rpcError(id, -31003, "Transaction not found"));
        return;
      }

      // если уже performed — просто вернём успешный ответ (идемпотентность)
      if (Number(tx.state) === 2) {
        res.status(200).json(
          ok(id, {
            transaction: String(tx.order_id),
            perform_time: nowMs(),
            state: 2,
          })
        );
        return;
      }

      const order = await getOrder(Number(tx.order_id));
      if (!order) {
        res.status(200).json(rpcError(id, -31050, "Order not found"));
        return;
      }
      if (order.status === "paid") {
        // уже оплачен — считаем выполненным
        await upsertPaymeTx({ paymeId, orderId: order.id, amount: Number(tx.amount_tiyin), state: 2, perform_time: nowMs() });
        res.status(200).json(ok(id, { transaction: String(order.id), perform_time: nowMs(), state: 2 }));
        return;
      }

      const performTime = nowMs();

      // 1) помечаем tx performed
      await upsertPaymeTx({
        paymeId,
        orderId: order.id,
        amount: Number(tx.amount_tiyin),
        state: 2,
        perform_time: performTime,
      });

      // 2) помечаем order paid
      await markOrderStatus(order.id, "paid", new Date());

      // 3) начисляем в ledger ОДИН РАЗ
      await creditLedgerOnce({
        clientId: Number(order.client_id),
        amountTiyin: Number(order.amount_tiyin),
        orderId: order.id,
        paymeId,
      });

      res.status(200).json(
        ok(id, {
          transaction: String(order.id),
          perform_time: performTime,
          state: 2,
        })
      );
      return;
    }

    // ------------- CancelTransaction -------------
    if (method === "CancelTransaction") {
      const paymeId = String(params.id || "");
      const reason = Number(params.reason);
      if (!paymeId) {
        res.status(200).json(rpcError(id, -32602, "Missing params.id"));
        return;
      }

      const cancelTime = nowMs();

      // Мы не делаем "refund ledger" автоматически здесь.
      // Если нужен авто-возврат — скажи, добавлю отдельной логикой.
      await pool.query(
        `UPDATE payme_transactions
         SET state = -1, cancel_time = $2, reason = $3, updated_at = now()
         WHERE payme_id = $1`,
        [paymeId, cancelTime, Number.isFinite(reason) ? reason : null]
      );

      res.status(200).json(ok(id, { cancel_time: cancelTime, state: -1, transaction: paymeId }));
      return;
    }

    // ------------- CheckTransaction -------------
    if (method === "CheckTransaction") {
      const paymeId = String(params.id || "");
      const { rows } = await pool.query(
        `SELECT payme_id, order_id, state, create_time, perform_time, cancel_time, reason
         FROM payme_transactions
         WHERE payme_id = $1`,
        [paymeId]
      );
      const tx = rows[0];
      if (!tx) {
        res.status(200).json(rpcError(id, -31003, "Transaction not found"));
        return;
      }

      res.status(200).json(
        ok(id, {
          create_time: Number(tx.create_time) || 0,
          perform_time: Number(tx.perform_time) || 0,
          cancel_time: Number(tx.cancel_time) || 0,
          transaction: String(tx.order_id),
          state: Number(tx.state),
          reason: tx.reason ?? null,
        })
      );
      return;
    }

    // ------------- GetStatement (обязателен) -------------
    // Минимальная реализация: отдаём все payme_transactions за диапазон.
    if (method === "GetStatement") {
      const from = Number(params.from);
      const to = Number(params.to);

      const { rows } = await pool.query(
        `
        SELECT payme_id, order_id, amount_tiyin, state, create_time, perform_time, cancel_time, reason
        FROM payme_transactions
        WHERE
          ($1::bigint IS NULL OR create_time >= $1)
          AND ($2::bigint IS NULL OR create_time <= $2)
        ORDER BY create_time ASC
        LIMIT 5000
        `,
        [Number.isFinite(from) ? from : null, Number.isFinite(to) ? to : null]
      );

      const result = rows.map((r) => ({
        id: r.payme_id,
        time: Number(r.create_time) || 0,
        amount: Number(r.amount_tiyin) || 0,
        account: { order_id: String(r.order_id) },
        create_time: Number(r.create_time) || 0,
        perform_time: Number(r.perform_time) || 0,
        cancel_time: Number(r.cancel_time) || 0,
        transaction: String(r.order_id),
        state: Number(r.state),
        reason: r.reason ?? null,
      }));

      res.status(200).json(ok(id, { transactions: result }));
      return;
    }

    // Если прилетит SetFiscalData — можно принять и залогировать (не обязательно) :contentReference[oaicite:4]{index=4}
    if (method === "SetFiscalData") {
      res.status(200).json(ok(id, { success: true }));
      return;
    }

    res.status(200).json(rpcError(id, -32601, "Method not found"));
  } catch (e) {
    res.status(200).json(rpcError(id, -32400, "Internal error"));
  }
};
