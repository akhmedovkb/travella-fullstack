// backend/controllers/paymeMerchantController.js

const crypto = require("crypto");
const pool = require("../db");
const { unlockContactSafe } = require("../utils/contactUnlock");

const PAYME_STATE = {
  CREATED: 1,
  COMPLETED: 2,
  CANCELED_AFTER_COMPLETE: -2,
  CANCELED: -1,
};

const PAYME_ERROR = {
  INVALID_AMOUNT: -31001,
  TRANSACTION_NOT_FOUND: -31003,
  ORDER_NOT_FOUND: -31050,
  CANNOT_PERFORM: -31008,
  INVALID_ACCOUNT: -31050,
  INTERNAL: -32400,
};

function nowMs() {
  return Date.now();
}

function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function success(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function error(id, code, message, data = null) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      data,
    },
  };
}

function extractCredentials(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Basic ")) return null;

  try {
    const decoded = Buffer.from(auth.slice(6), "base64")
      .toString("utf8")
      .trim();

    const idx = decoded.indexOf(":");
    if (idx === -1) return null;

    return {
      login: decoded.slice(0, idx),
      key: decoded.slice(idx + 1),
    };
  } catch {
    return null;
  }
}

function validateAuth(req) {
  const creds = extractCredentials(req);
  if (!creds) return false;

  const allowedLogin =
    process.env.PAYME_MERCHANT_LOGIN ||
    process.env.PAYME_LOGIN ||
    "";

  const allowedKey =
    process.env.PAYME_MERCHANT_KEY ||
    process.env.PAYME_KEY ||
    "";

  return creds.login === allowedLogin && creds.key === allowedKey;
}

async function ensureSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS payme_transactions (
      id BIGSERIAL PRIMARY KEY,
      payme_id TEXT UNIQUE,
      order_id BIGINT,
      order_type TEXT,
      amount BIGINT NOT NULL DEFAULT 0,
      state INTEGER NOT NULL DEFAULT 1,
      create_time BIGINT,
      perform_time BIGINT,
      cancel_time BIGINT,
      reason INTEGER,
      raw JSONB,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  
  await client.query(`
    ALTER TABLE payme_transactions
      ADD COLUMN IF NOT EXISTS order_type TEXT,
      ADD COLUMN IF NOT EXISTS amount BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS state INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS create_time BIGINT,
      ADD COLUMN IF NOT EXISTS perform_time BIGINT,
      ADD COLUMN IF NOT EXISTS cancel_time BIGINT,
      ADD COLUMN IF NOT EXISTS reason INTEGER,
      ADD COLUMN IF NOT EXISTS raw JSONB,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
  `);
  
  await client.query(`
    CREATE TABLE IF NOT EXISTS payme_ledger_effects (
      id BIGSERIAL PRIMARY KEY,
      effect_key TEXT UNIQUE NOT NULL,
      effect_type TEXT NOT NULL,
      order_id BIGINT,
      transaction_id TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await client.query(`
    ALTER TABLE payme_transactions
    ADD COLUMN IF NOT EXISTS performed BOOLEAN DEFAULT FALSE
  `);

  await client.query(`
    ALTER TABLE payme_transactions
    ADD COLUMN IF NOT EXISTS canceled BOOLEAN DEFAULT FALSE
  `);

  await client.query(`
    ALTER TABLE payme_transactions
    ADD COLUMN IF NOT EXISTS refunded BOOLEAN DEFAULT FALSE
  `);

  await client.query(`
    ALTER TABLE payme_transactions
    ADD COLUMN IF NOT EXISTS last_callback_hash TEXT
  `);

  await client.query(`
    ALTER TABLE topup_orders
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP
  `);

  await client.query(`
    ALTER TABLE topup_orders
    ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP
  `);

  await client.query(`
    ALTER TABLE topup_orders
    ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMP
  `);

  await client.query(`
    ALTER TABLE topup_orders
    ADD COLUMN IF NOT EXISTS failed_at TIMESTAMP
  `);

  await client.query(`
    ALTER TABLE topup_orders
    ADD COLUMN IF NOT EXISTS redirect_url TEXT
  `);

  await client.query(`
    ALTER TABLE topup_orders
    ADD COLUMN IF NOT EXISTS purpose TEXT
  `);

  await client.query(`
    ALTER TABLE topup_orders
    ADD COLUMN IF NOT EXISTS support_donation_id BIGINT
  `);
}

async function advisoryLock(client, key) {
  const hash = crypto
    .createHash("sha256")
    .update(String(key))
    .digest("hex");

  const bigint = BigInt("0x" + hash.slice(0, 15));

  await client.query(`SELECT pg_advisory_xact_lock($1)`, [
    bigint.toString(),
  ]);
}

async function relationExists(client, relationName) {
  const { rows } = await client.query(
    `SELECT to_regclass($1) AS reg`,
    [`public.${relationName}`]
  );

  return !!rows[0]?.reg;
}

function isProviderSupportOrder(order) {
  return (
    order?.order_type === "provider_support" ||
    order?.purpose === "provider_support" ||
    !!order?.support_donation_id
  );
}

function isUnlockContactOrder(order) {
  return order?.order_type === "unlock_contact";
}

async function syncProviderSupportPaid({
  client,
  order,
  transactionId,
}) {
  if (!isProviderSupportOrder(order)) return;

  const exists = await relationExists(client, "provider_support_donations");
  if (!exists) return;

  await client.query(
    `
      UPDATE provider_support_donations
      SET
        status = 'paid',
        paid_at = COALESCE(paid_at, NOW()),
        payme_id = COALESCE(payme_id, $2),
        updated_at = NOW()
      WHERE id = $1
         OR payme_order_id = $3
    `,
    [
      order.support_donation_id || null,
      transactionId,
      order.id,
    ]
  );
}

async function syncProviderSupportCanceled({
  client,
  order,
  transactionId,
  refunded = false,
}) {
  if (!isProviderSupportOrder(order)) return;

  const exists = await relationExists(client, "provider_support_donations");
  if (!exists) return;

  await client.query(
    `
      UPDATE provider_support_donations
      SET
        status = CASE
          WHEN $4::boolean THEN 'refunded'
          ELSE 'canceled'
        END,
        cancelled_at = COALESCE(cancelled_at, NOW()),
        failed_at = CASE
          WHEN $4::boolean THEN failed_at
          ELSE COALESCE(failed_at, NOW())
        END,
        payme_id = COALESCE(payme_id, $2),
        updated_at = NOW()
      WHERE id = $1
         OR payme_order_id = $3
    `,
    [
      order.support_donation_id || null,
      transactionId,
      order.id,
      refunded,
    ]
  );
}

async function getTransactionByPaymeId(client, paymeId) {
  const { rows } = await client.query(
    `
      SELECT *
      FROM payme_transactions
      WHERE payme_id = $1
      LIMIT 1
    `,
    [paymeId]
  );

  return rows[0] || null;
}

async function getTopupOrder(client, orderId) {
  const { rows } = await client.query(
    `
      SELECT *
      FROM topup_orders
      WHERE id = $1
      LIMIT 1
    `,
    [orderId]
  );

  return rows[0] || null;
}

async function markOrderExpired(client, orderId) {
  await client.query(
    `
      UPDATE topup_orders
      SET
        status = 'expired',
        failed_at = NOW()
      WHERE id = $1
        AND status IN ('created', 'pending')
    `,
    [orderId]
  );
}

function isExpired(order) {
  if (!order?.expires_at) return false;

  const ts = new Date(order.expires_at).getTime();
  if (!Number.isFinite(ts)) return false;

  return ts < Date.now();
}

async function insertLedgerEffect(
  client,
  effectKey,
  effectType,
  orderId,
  transactionId
) {
  const res = await client.query(
    `
      INSERT INTO payme_ledger_effects (
        effect_key,
        effect_type,
        order_id,
        transaction_id
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (effect_key)
      DO NOTHING
      RETURNING id
    `,
    [effectKey, effectType, orderId, transactionId]
  );

  return !!res.rows[0];
}

async function creditClientBalance({
  client,
  clientId,
  amountTiyin,
  orderId,
  transactionId,
}) {
  const effectKey = `topup_credit:${transactionId}`;

  const inserted = await insertLedgerEffect(
    client,
    effectKey,
    "topup_credit",
    orderId,
    transactionId
  );

  if (!inserted) {
    return {
      duplicated: true,
    };
  }

  await client.query(
    `
      INSERT INTO contact_balance_ledger (
        client_id,
        amount,
        type,
        note,
        created_at
      )
      VALUES (
        $1,
        $2,
        'topup',
        $3,
        NOW()
      )
    `,
    [
      clientId,
      amountTiyin,
      `Payme topup #${transactionId}`,
    ]
  );

  return {
    duplicated: false,
  };
}

async function debitRefund({
  client,
  clientId,
  amountTiyin,
  orderId,
  transactionId,
}) {
  const effectKey = `refund_debit:${transactionId}`;

  const inserted = await insertLedgerEffect(
    client,
    effectKey,
    "refund_debit",
    orderId,
    transactionId
  );

  if (!inserted) {
    return {
      duplicated: true,
    };
  }

  await client.query(
    `
      INSERT INTO contact_balance_ledger (
        client_id,
        amount,
        type,
        note,
        created_at
      )
      VALUES (
        $1,
        $2,
        'refund',
        $3,
        NOW()
      )
    `,
    [
      clientId,
      -Math.abs(amountTiyin),
      `Refund for Payme transaction ${transactionId}`,
    ]
  );

  return {
    duplicated: false,
  };
}

async function processAutoUnlock({
  client,
  order,
  transactionId,
}) {
  if (
    order.order_type !== "unlock_contact" ||
    !order.service_id ||
    !order.client_id
  ) {
    return;
  }

  const effectKey = `unlock_after_pay:${transactionId}`;

  const inserted = await insertLedgerEffect(
    client,
    effectKey,
    "unlock_after_pay",
    order.id,
    transactionId
  );

  if (!inserted) return;

  await unlockContactSafe({
    client,
    clientId: order.client_id,
    serviceId: order.service_id,
    source: "payme_auto_unlock",
    skipBalanceDeduction: true,
  });
}

async function createTransaction({
  client,
  paymeId,
  orderId,
  orderType,
  amount,
  raw,
}) {
  const createTime = nowMs();

  const { rows } = await client.query(
    `
      INSERT INTO payme_transactions (
        payme_id,
        order_id,
        order_type,
        amount,
        state,
        create_time,
        raw
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7
      )
      RETURNING *
    `,
    [
      paymeId,
      orderId,
      orderType,
      amount,
      PAYME_STATE.CREATED,
      createTime,
      raw,
    ]
  );

  return rows[0];
}

async function performTransaction({
  client,
  transaction,
  order,
}) {
  if (transaction.state === PAYME_STATE.COMPLETED) {
    if (isProviderSupportOrder(order)) {
      await syncProviderSupportPaid({
        client,
        order,
        transactionId: transaction.payme_id,
      });
    }

    return transaction;
  }

  const amount = toNumber(transaction.amount);

  if (amount <= 0) {
    throw new Error("INVALID_AMOUNT");
  }

  if (isExpired(order)) {
    await markOrderExpired(client, order.id);
    throw new Error("ORDER_EXPIRED");
  }

  if (order.status === "paid") {
    if (isProviderSupportOrder(order)) {
      await syncProviderSupportPaid({
        client,
        order,
        transactionId: transaction.payme_id,
      });
    }

    const { rows } = await client.query(
      `
        UPDATE payme_transactions
        SET
          state = $2,
          performed = TRUE,
          perform_time = COALESCE(perform_time, $3),
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [
        transaction.id,
        PAYME_STATE.COMPLETED,
        nowMs(),
      ]
    );

    return rows[0];
  }

  const effectKey = `perform_credit:${transaction.payme_id}`;

  const alreadyPerformed =
    !(await insertLedgerEffect(
      client,
      effectKey,
      "perform_guard",
      order.id,
      transaction.payme_id
    ));

    if (
    !alreadyPerformed &&
    !isProviderSupportOrder(order) &&
    !isUnlockContactOrder(order)
  ) {
    if (!order.client_id) {
      throw new Error("CLIENT_ID_REQUIRED_FOR_TOPUP");
    }

    await creditClientBalance({
      client,
      clientId: order.client_id,
      amountTiyin: amount,
      orderId: order.id,
      transactionId: transaction.payme_id,
    });
  }

  if (isProviderSupportOrder(order)) {
    await syncProviderSupportPaid({
      client,
      order,
      transactionId: transaction.payme_id,
    });
  }

  await client.query(
    `
      UPDATE topup_orders
      SET
        status = 'paid',
        paid_at = COALESCE(paid_at, NOW())
      WHERE id = $1
    `,
    [order.id]
  );

  await processAutoUnlock({
    client,
    order,
    transactionId: transaction.payme_id,
  });

  const { rows } = await client.query(
    `
      UPDATE payme_transactions
      SET
        state = $2,
        performed = TRUE,
        perform_time = COALESCE(perform_time, $3),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      transaction.id,
      PAYME_STATE.COMPLETED,
      nowMs(),
    ]
  );

  return rows[0];
}

async function cancelTransaction({
  client,
  transaction,
  order,
  reason,
}) {
  const now = nowMs();

  if (
    transaction.state === PAYME_STATE.CANCELED ||
    transaction.state === PAYME_STATE.CANCELED_AFTER_COMPLETE
  ) {
    if (order && isProviderSupportOrder(order)) {
      await syncProviderSupportCanceled({
        client,
        order,
        transactionId: transaction.payme_id,
        refunded: transaction.state === PAYME_STATE.CANCELED_AFTER_COMPLETE,
      });
    }

    return transaction;
  }

  let nextState = PAYME_STATE.CANCELED;

  if (transaction.state === PAYME_STATE.COMPLETED) {
    nextState = PAYME_STATE.CANCELED_AFTER_COMPLETE;

    if (order?.client_id && !isProviderSupportOrder(order)) {
      await debitRefund({
        client,
        clientId: order.client_id,
        amountTiyin: transaction.amount,
        orderId: order.id,
        transactionId: transaction.payme_id,
      });
    }

    if (order && isProviderSupportOrder(order)) {
      await syncProviderSupportCanceled({
        client,
        order,
        transactionId: transaction.payme_id,
        refunded: true,
      });
    }
  }

  if (order?.id) {
    await client.query(
      `
        UPDATE topup_orders
        SET
          status = CASE
            WHEN status = 'paid' THEN 'refunded'
            ELSE 'canceled'
          END,
          canceled_at = COALESCE(canceled_at, NOW()),
          failed_at = CASE
            WHEN status IN ('created', 'pending')
            THEN COALESCE(failed_at, NOW())
            ELSE failed_at
          END
        WHERE id = $1
      `,
      [order.id]
    );

    if (
      isProviderSupportOrder(order) &&
      transaction.state !== PAYME_STATE.COMPLETED
    ) {
      await syncProviderSupportCanceled({
        client,
        order,
        transactionId: transaction.payme_id,
        refunded: false,
      });
    }
  }

  const { rows } = await client.query(
    `
      UPDATE payme_transactions
      SET
        state = $2,
        canceled = TRUE,
        cancel_time = COALESCE(cancel_time, $3),
        reason = COALESCE(reason, $4),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      transaction.id,
      nextState,
      now,
      reason || null,
    ]
  );

  return rows[0];
}

function accountOrderId(account = {}) {
  return (
    account.order_id ||
    account.orderId ||
    account.id ||
    account.topup_order_id ||
    account.topupOrderId
  );
}

function paymeResultTransaction(tx) {
  return {
    transaction: String(tx.payme_id),
    state: Number(tx.state),
    create_time: Number(tx.create_time || 0),
    perform_time: Number(tx.perform_time || 0),
    cancel_time: Number(tx.cancel_time || 0),
    reason: tx.reason || null,
  };
}

async function CheckPerformTransaction(req, res, id, params) {
  const client = await pool.connect();

  try {
    await ensureSchema(client);

    const amount = toNumber(params.amount);
    const orderId = accountOrderId(params.account);

    if (!orderId) {
      return res.json(
        error(
          id,
          PAYME_ERROR.INVALID_ACCOUNT,
          "Order id is required"
        )
      );
    }

    await client.query("BEGIN");
    await advisoryLock(client, `order:${orderId}`);

    const order = await getTopupOrder(client, orderId);

    if (!order) {
      await client.query("ROLLBACK");
      return res.json(
        error(
          id,
          PAYME_ERROR.ORDER_NOT_FOUND,
          "Order not found"
        )
      );
    }

    if (isExpired(order)) {
      await markOrderExpired(client, order.id);
      await client.query("COMMIT");

      return res.json(
        error(
          id,
          PAYME_ERROR.CANNOT_PERFORM,
          "Order expired"
        )
      );
    }

    if (!["created", "pending"].includes(order.status)) {
      await client.query("ROLLBACK");

      return res.json(
        error(
          id,
          PAYME_ERROR.CANNOT_PERFORM,
          "Order cannot be paid"
        )
      );
    }

    if (toNumber(order.amount) !== amount) {
      await client.query("ROLLBACK");

      return res.json(
        error(
          id,
          PAYME_ERROR.INVALID_AMOUNT,
          "Invalid amount"
        )
      );
    }

    await client.query("COMMIT");

    return res.json(
      success(id, {
        allow: true,
      })
    );
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    console.error("[payme] CheckPerformTransaction error:", e);

    return res.json(
      error(
        id,
        PAYME_ERROR.INTERNAL,
        "Internal error"
      )
    );
  } finally {
    client.release();
  }
}

async function CreateTransaction(req, res, id, params) {
  const client = await pool.connect();

  try {
    await ensureSchema(client);

    const paymeId = params.id;
    const amount = toNumber(params.amount);
    const orderId = accountOrderId(params.account);

    if (!paymeId || !orderId) {
      return res.json(
        error(
          id,
          PAYME_ERROR.INVALID_ACCOUNT,
          "Invalid transaction/account"
        )
      );
    }

    await client.query("BEGIN");
    await advisoryLock(client, `payme:${paymeId}`);
    await advisoryLock(client, `order:${orderId}`);

    let tx = await getTransactionByPaymeId(client, paymeId);

    if (tx) {
      await client.query("COMMIT");

      return res.json(
        success(id, paymeResultTransaction(tx))
      );
    }

    const order = await getTopupOrder(client, orderId);

    if (!order) {
      await client.query("ROLLBACK");

      return res.json(
        error(
          id,
          PAYME_ERROR.ORDER_NOT_FOUND,
          "Order not found"
        )
      );
    }

    if (isExpired(order)) {
      await markOrderExpired(client, order.id);
      await client.query("COMMIT");

      return res.json(
        error(
          id,
          PAYME_ERROR.CANNOT_PERFORM,
          "Order expired"
        )
      );
    }

    if (!["created", "pending"].includes(order.status)) {
      await client.query("ROLLBACK");

      return res.json(
        error(
          id,
          PAYME_ERROR.CANNOT_PERFORM,
          "Order cannot be paid"
        )
      );
    }

    if (toNumber(order.amount) !== amount) {
      await client.query("ROLLBACK");

      return res.json(
        error(
          id,
          PAYME_ERROR.INVALID_AMOUNT,
          "Invalid amount"
        )
      );
    }

    tx = await createTransaction({
      client,
      paymeId,
      orderId: order.id,
      orderType: order.order_type || "topup",
      amount,
      raw: params,
    });

    await client.query(
      `
        UPDATE topup_orders
        SET status = 'pending'
        WHERE id = $1
          AND status = 'created'
      `,
      [order.id]
    );

    await client.query("COMMIT");

    return res.json(
      success(id, paymeResultTransaction(tx))
    );
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    console.error("[payme] CreateTransaction error:", e);

    return res.json(
      error(
        id,
        PAYME_ERROR.INTERNAL,
        "Internal error"
      )
    );
  } finally {
    client.release();
  }
}

async function PerformTransaction(req, res, id, params) {
  const client = await pool.connect();

  try {
    await ensureSchema(client);

    const paymeId = params.id;

    if (!paymeId) {
      return res.json(
        error(
          id,
          PAYME_ERROR.TRANSACTION_NOT_FOUND,
          "Transaction id is required"
        )
      );
    }

    await client.query("BEGIN");
    await advisoryLock(client, `payme:${paymeId}`);

    const tx = await getTransactionByPaymeId(client, paymeId);

    if (!tx) {
      await client.query("ROLLBACK");

      return res.json(
        error(
          id,
          PAYME_ERROR.TRANSACTION_NOT_FOUND,
          "Transaction not found"
        )
      );
    }

    await advisoryLock(client, `order:${tx.order_id}`);

    const order = await getTopupOrder(client, tx.order_id);

    if (!order) {
      await client.query("ROLLBACK");

      return res.json(
        error(
          id,
          PAYME_ERROR.ORDER_NOT_FOUND,
          "Order not found"
        )
      );
    }

    const performed = await performTransaction({
      client,
      transaction: tx,
      order,
    });

    await client.query("COMMIT");

    return res.json(
      success(id, paymeResultTransaction(performed))
    );
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    if (e.message === "ORDER_EXPIRED") {
      return res.json(
        error(
          id,
          PAYME_ERROR.CANNOT_PERFORM,
          "Order expired"
        )
      );
    }

    console.error("[payme] PerformTransaction error:", e);

    return res.json(
      error(
        id,
        PAYME_ERROR.INTERNAL,
        "Internal error"
      )
    );
  } finally {
    client.release();
  }
}

async function CancelTransaction(req, res, id, params) {
  const client = await pool.connect();

  try {
    await ensureSchema(client);

    const paymeId = params.id;

    if (!paymeId) {
      return res.json(
        error(
          id,
          PAYME_ERROR.TRANSACTION_NOT_FOUND,
          "Transaction id is required"
        )
      );
    }

    await client.query("BEGIN");
    await advisoryLock(client, `payme:${paymeId}`);

    const tx = await getTransactionByPaymeId(client, paymeId);

    if (!tx) {
      await client.query("ROLLBACK");

      return res.json(
        error(
          id,
          PAYME_ERROR.TRANSACTION_NOT_FOUND,
          "Transaction not found"
        )
      );
    }

    if (tx.order_id) {
      await advisoryLock(client, `order:${tx.order_id}`);
    }

    const order = tx.order_id
      ? await getTopupOrder(client, tx.order_id)
      : null;

    const canceled = await cancelTransaction({
      client,
      transaction: tx,
      order,
      reason: params.reason,
    });

    await client.query("COMMIT");

    return res.json(
      success(id, paymeResultTransaction(canceled))
    );
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    console.error("[payme] CancelTransaction error:", e);

    return res.json(
      error(
        id,
        PAYME_ERROR.INTERNAL,
        "Internal error"
      )
    );
  } finally {
    client.release();
  }
}

async function CheckTransaction(req, res, id, params) {
  const client = await pool.connect();

  try {
    await ensureSchema(client);

    const paymeId = params.id;

    const tx = await getTransactionByPaymeId(client, paymeId);

    if (!tx) {
      return res.json(
        error(
          id,
          PAYME_ERROR.TRANSACTION_NOT_FOUND,
          "Transaction not found"
        )
      );
    }

    return res.json(
      success(id, paymeResultTransaction(tx))
    );
  } catch (e) {
    console.error("[payme] CheckTransaction error:", e);

    return res.json(
      error(
        id,
        PAYME_ERROR.INTERNAL,
        "Internal error"
      )
    );
  } finally {
    client.release();
  }
}

async function GetStatement(req, res, id, params) {
  const client = await pool.connect();

  try {
    await ensureSchema(client);

    const from = toNumber(params.from, 0);
    const to = toNumber(params.to, nowMs());

    const { rows } = await client.query(
      `
        SELECT *
        FROM payme_transactions
        WHERE create_time BETWEEN $1 AND $2
        ORDER BY create_time ASC
      `,
      [from, to]
    );

    return res.json(
      success(id, {
        transactions: rows.map(paymeResultTransaction),
      })
    );
  } catch (e) {
    console.error("[payme] GetStatement error:", e);

    return res.json(
      error(
        id,
        PAYME_ERROR.INTERNAL,
        "Internal error"
      )
    );
  } finally {
    client.release();
  }
}

async function handlePaymeMerchant(req, res) {
  const { id, method, params = {} } = req.body || {};

  if (!validateAuth(req)) {
    return res.json(
      error(
        id || null,
        -32504,
        "Unauthorized"
      )
    );
  }

  switch (method) {
    case "CheckPerformTransaction":
      return CheckPerformTransaction(req, res, id, params);

    case "CreateTransaction":
      return CreateTransaction(req, res, id, params);

    case "PerformTransaction":
      return PerformTransaction(req, res, id, params);

    case "CancelTransaction":
      return CancelTransaction(req, res, id, params);

    case "CheckTransaction":
      return CheckTransaction(req, res, id, params);

    case "GetStatement":
      return GetStatement(req, res, id, params);

    default:
      return res.json(
        error(
          id || null,
          -32601,
          "Method not found"
        )
      );
  }
}

module.exports = {
  handlePaymeMerchant,
  CheckPerformTransaction,
  CreateTransaction,
  PerformTransaction,
  CancelTransaction,
  CheckTransaction,
  GetStatement,
};
