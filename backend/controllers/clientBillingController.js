// backend/controllers/clientBillingController.js

const pool = require("../db");

const { getContactUnlockSettings } = require("../utils/contactUnlockSettings");
const { logUnlockFunnel } = require("../utils/contactUnlockFunnel");
const {
  unlockContactTx,
  getBalanceFromLedger,
  syncClientBalanceMirror,
} = require("../utils/contactUnlock");

let _clientsBalanceColumn = null;

function clampInt(x, def, min, max) {
  const n = Number(x);
  if (!Number.isFinite(n)) return def;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

function toIntOrNull(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function getSessionKey(req) {
  return req.headers["x-session-key"] || null;
}

function sumToTiyin(sum) {
  return Math.round(Number(sum || 0) * 100);
}

function tiyinToSum(tiyin) {
  return Math.trunc(Number(tiyin || 0) / 100);
}

function normalizePositiveTiyin(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function getOrderExpiryDate(minutes = 30) {
  const ttl = Number(process.env.PAYME_ORDER_TTL_MINUTES || minutes);
  const safeTtl = Number.isFinite(ttl) && ttl > 0 ? ttl : minutes;
  return new Date(Date.now() + safeTtl * 60 * 1000);
}

async function safeLogUnlockFunnel(dbOrPayload, maybePayload = null) {
  try {
    await logUnlockFunnel(dbOrPayload, maybePayload);
  } catch (e) {
    console.error("[unlock-funnel] log error:", e?.message || e);
  }
}

async function advisoryLock(db, key) {
  await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [String(key)]);
}

async function getClientsBalanceColumn(client) {
  if (_clientsBalanceColumn !== null) return _clientsBalanceColumn;

  const r = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='clients'
  `);

  const names = r.rows.map((x) => x.column_name);

  const candidates = [
    "contact_balance",
    "contact_balance_tiyin",
    "balance_tiyin",
    "balance",
    "wallet_balance",
  ];

  for (const c of candidates) {
    if (names.includes(c)) {
      _clientsBalanceColumn = c;
      return c;
    }
  }

  _clientsBalanceColumn = null;
  return null;
}

async function syncClientBalanceMirrorLocal(client, clientId) {
  const col = await getClientsBalanceColumn(client);
  const balance = await getBalanceFromLedger(client, clientId);

  if (col) {
    await client.query(`UPDATE clients SET ${col}=$2 WHERE id=$1`, [
      clientId,
      balance,
    ]);
  }

  return balance;
}

async function ensureContactBalanceLedgerShape(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS contact_balance_ledger (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NOT NULL,
      amount BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await db.query(`
    ALTER TABLE contact_balance_ledger
      ADD COLUMN IF NOT EXISTS reason TEXT,
      ADD COLUMN IF NOT EXISTS type TEXT,
      ADD COLUMN IF NOT EXISTS note TEXT,
      ADD COLUMN IF NOT EXISTS service_id BIGINT,
      ADD COLUMN IF NOT EXISTS source TEXT,
      ADD COLUMN IF NOT EXISTS meta JSONB,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  `);
}

async function ensureContactUnlocksShape(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS client_service_contact_unlocks (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NOT NULL,
      service_id BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await db.query(`
    ALTER TABLE client_service_contact_unlocks
      ADD COLUMN IF NOT EXISTS price_charged BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS source TEXT,
      ADD COLUMN IF NOT EXISTS note TEXT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_client_service_contact_unlocks_unique
      ON client_service_contact_unlocks(client_id, service_id)
  `);
}
async function ensureTopupOrdersShape(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS topup_orders (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NOT NULL,
      amount BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await db.query(`
    ALTER TABLE topup_orders
      ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'balance_topup',
      ADD COLUMN IF NOT EXISTS service_id BIGINT,
      ADD COLUMN IF NOT EXISTS provider_id BIGINT,
      ADD COLUMN IF NOT EXISTS payme_transaction_id TEXT,
      ADD COLUMN IF NOT EXISTS pay_url TEXT,
      ADD COLUMN IF NOT EXISTS redirect_url TEXT,
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS meta JSONB
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_topup_orders_client_status
      ON topup_orders(client_id, status)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_topup_orders_service_status
      ON topup_orders(service_id, status)
  `);
}

async function ensureBillingShape(db) {
  await ensureContactBalanceLedgerShape(db);
  await ensureContactUnlocksShape(db);
  await ensureTopupOrdersShape(db);
}

async function expireOldOrders(db, clientId = null) {
  const params = [];
  let clientFilter = "";

  if (clientId) {
    params.push(clientId);
    clientFilter = `AND client_id = $${params.length}`;
  }

  await db.query(
    `
      UPDATE topup_orders
      SET
        status = 'expired',
        failed_at = COALESCE(failed_at, now())
      WHERE status IN ('created', 'pending')
        AND expires_at IS NOT NULL
        AND expires_at < now()
        ${clientFilter}
    `,
    params
  );
}

async function findClientId(req) {
  if (req.user?.role === "client" && req.user?.id) {
    return req.user.id;
  }

  if (req.user?.clientId) return req.user.clientId;
  if (req.user?.client_id) return req.user.client_id;

  return null;
}

async function getClientBalance(req, res) {
  const clientId = await findClientId(req);

  if (!clientId) {
    return res.status(401).json({
      ok: false,
      error: "client_auth_required",
    });
  }

  const db = await pool.connect();

  try {
    await ensureBillingShape(db);
    await expireOldOrders(db, clientId);

    const settings = await getContactUnlockSettings();
    const balance = await syncClientBalanceMirrorLocal(db, clientId);

    return res.json({
      ok: true,
      balance,
      balance_sum: tiyinToSum(balance),
      balance_tiyin: balance,
      unlock_price: settings.unlockPriceTiyin,
      unlock_price_sum: tiyinToSum(settings.unlockPriceTiyin),
      unlock_is_paid: settings.unlockIsPaid,
      unlock_base_price: settings.unlockBasePrice,
    });
  } catch (e) {
    console.error("[client-billing] getClientBalance:", e);
    return res.status(500).json({
      ok: false,
      error: "balance_failed",
    });
  } finally {
    db.release();
  }
}

async function getClientBalanceLedger(req, res) {
  const clientId = await findClientId(req);

  if (!clientId) {
    return res.status(401).json({
      ok: false,
      error: "client_auth_required",
    });
  }

  const limit = clampInt(req.query.limit, 50, 1, 200);

  const db = await pool.connect();

  try {
    await ensureBillingShape(db);
    await expireOldOrders(db, clientId);

    const { rows } = await db.query(
      `
        SELECT
          id,
          client_id,
          amount,
          amount AS amount_tiyin,
          FLOOR(amount / 100.0)::BIGINT AS amount_sum,
          COALESCE(type, reason) AS type,
          reason,
          note,
          service_id,
          source,
          meta,
          created_at
        FROM contact_balance_ledger
        WHERE client_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2
      `,
      [clientId, limit]
    );

    return res.json({
      ok: true,
      items: rows,
    });
  } catch (e) {
    console.error("[client-billing] getClientBalanceLedger:", e);
    return res.status(500).json({
      ok: false,
      error: "ledger_failed",
    });
  } finally {
    db.release();
  }
}
async function createTopupOrder(req, res) {
  const clientId = await findClientId(req);

  if (!clientId) {
    return res.status(401).json({
      ok: false,
      error: "client_auth_required",
    });
  }

  const amountInput =
    req.body?.amount_tiyin ??
    req.body?.amount ??
    req.body?.sum;

  let amountTiyin = normalizePositiveTiyin(amountInput);

  // backward compatibility:
  // если пришла маленькая сумма — считаем что это SUM а не TIYIN
  if (amountTiyin > 0 && amountTiyin < 1000) {
    amountTiyin = sumToTiyin(amountTiyin);
  }

  const MIN_TOPUP =
    normalizePositiveTiyin(
      process.env.MIN_TOPUP_TIYIN || process.env.MIN_TOPUP_TIIYIN || 1000
    );

  if (amountTiyin < MIN_TOPUP) {
    return res.status(400).json({
      ok: false,
      error: "invalid_amount",
    });
  }

  const db = await pool.connect();

  try {
    await ensureBillingShape(db);

    await db.query("BEGIN");

    await advisoryLock(
      db,
      `topup:create:${clientId}`
    );

    await expireOldOrders(db, clientId);

    const existingPending = await db.query(
      `
        SELECT *
        FROM topup_orders
        WHERE client_id = $1
          AND order_type = 'balance_topup'
          AND amount = $2
          AND status IN ('created', 'pending')
          AND expires_at > now()
        ORDER BY id DESC
        LIMIT 1
      `,
      [clientId, amountTiyin]
    );

    if (existingPending.rows[0]) {
      await db.query("COMMIT");

      return res.json({
        ok: true,
        reused: true,
        order: existingPending.rows[0],
      });
    }

    const expiresAt = getOrderExpiryDate();

    const redirectUrl =
      req.body?.redirect_url ||
      req.body?.redirectUrl ||
      `${process.env.SITE_URL || ""}/client/balance`;

    const { rows } = await db.query(
      `
        INSERT INTO topup_orders (
          client_id,
          amount,
          amount_tiyin,
          provider,
          status,
          order_type,
          redirect_url,
          expires_at,
          meta
        )
        VALUES (
          $1,
          $2,
          $2,
          'created',
          'payme',
          'balance_topup',
          $3,
          $4,
          $5
        )
        RETURNING *
      `,
      [
        clientId,
        amountTiyin,
        redirectUrl,
        expiresAt,
        {
          session_key: getSessionKey(req),
          ip: req.ip,
          ua: req.headers["user-agent"] || null,
        },
      ]
    );

    const order = rows[0];

    const merchantId =
      process.env.PAYME_MERCHANT_ID ||
      process.env.PAYME_CHECKOUT_ID ||
      "";

    const account = {
      order_id: order.id,
    };

    const encoded = Buffer.from(
      JSON.stringify({
        m: merchantId,
        ac: account,
        a: amountTiyin,
      })
    ).toString("base64");

    const payUrl =
      `https://checkout.paycom.uz/${encoded}`;

    await db.query(
      `
        UPDATE topup_orders
        SET pay_url = $2
        WHERE id = $1
      `,
      [order.id, payUrl]
    );

    await db.query("COMMIT");

    return res.json({
      ok: true,
      order_id: order.id,
      amount_tiyin: amountTiyin,
      amount_sum: tiyinToSum(amountTiyin),
      pay_url: payUrl,
      redirect_url: redirectUrl,
      expires_at: expiresAt,
    });
  } catch (e) {
    try {
      await db.query("ROLLBACK");
    } catch {}

    console.error("[client-billing] createTopupOrder:", e);

    return res.status(500).json({
      ok: false,
      error: "topup_create_failed",
    });
  } finally {
    db.release();
  }
}

async function autoUnlockAfterTopup(req, res) {
  const clientId = await findClientId(req);

  if (!clientId) {
    return res.status(401).json({
      ok: false,
      error: "client_auth_required",
    });
  }

  const serviceId = toIntOrNull(
    req.body?.service_id ||
      req.body?.serviceId
  );

  if (!serviceId) {
    return res.status(400).json({
      ok: false,
      error: "service_required",
    });
  }

  const db = await pool.connect();

  try {
    await ensureBillingShape(db);

    const settings = await getContactUnlockSettings();

    const unlockPrice =
      normalizePositiveTiyin(
        settings.unlockPriceTiyin
      );

    await db.query("BEGIN");

    await advisoryLock(
      db,
      `unlock:auto:${clientId}:${serviceId}`
    );

    await expireOldOrders(db, clientId);

    const alreadyUnlocked = await db.query(
      `
        SELECT id
        FROM client_service_contact_unlocks
        WHERE client_id = $1
          AND service_id = $2
        LIMIT 1
      `,
      [clientId, serviceId]
    );

    if (alreadyUnlocked.rows[0]) {
      await db.query("COMMIT");

      return res.json({
        ok: true,
        already_unlocked: true,
      });
    }

    const existingPending = await db.query(
      `
        SELECT *
        FROM topup_orders
        WHERE client_id = $1
          AND service_id = $2
          AND order_type = 'unlock_contact'
          AND status IN ('created', 'pending')
          AND expires_at > now()
        ORDER BY id DESC
        LIMIT 1
      `,
      [clientId, serviceId]
    );

    if (existingPending.rows[0]) {
      await db.query("COMMIT");

      return res.json({
        ok: true,
        reused: true,
        order: existingPending.rows[0],
        pay_url: existingPending.rows[0].pay_url,
      });
    }
        const balance = await getBalanceFromLedger(db, clientId);

    if (!settings.unlockIsPaid || balance >= unlockPrice) {
      const result = await unlockContactTx(db, {
        clientId,
        serviceId,
        source: "web_auto_unlock",
      });

      await syncClientBalanceMirrorLocal(db, clientId);

      await db.query("COMMIT");

      await safeLogUnlockFunnel(pool, {
        clientId,
        serviceId,
        source: "web_auto_unlock",
        step: "unlocked_without_payme_redirect",
      });

      return res.json({
        ok: true,
        unlocked: true,
        result,
      });
    }

    const expiresAt = getOrderExpiryDate();

    const redirectUrl =
      req.body?.redirect_url ||
      req.body?.redirectUrl ||
      `${process.env.SITE_URL || ""}/client/balance?service_id=${serviceId}`;

    const { rows } = await db.query(
      `
        INSERT INTO topup_orders (
          client_id,
          amount,
          amount_tiyin,
          provider,
          status,
          order_type,
          service_id,
          redirect_url,
          expires_at,
          meta
        )
        VALUES (
          $1,
          $2,
          $2,
          'payme',
          'created',
          'unlock_contact',
          $3,
          $4,
          $5,
          $6
        )
        RETURNING *
      `,
      [
        clientId,
        unlockPrice,
        serviceId,
        redirectUrl,
        expiresAt,
        {
          session_key: getSessionKey(req),
          source: "web_unlock_auto",
          ip: req.ip,
          ua: req.headers["user-agent"] || null,
        },
      ]
    );

    const order = rows[0];

    const merchantId =
      process.env.PAYME_MERCHANT_ID ||
      process.env.PAYME_CHECKOUT_ID ||
      "";

    const encoded = Buffer.from(
      JSON.stringify({
        m: merchantId,
        ac: {
          order_id: order.id,
        },
        a: unlockPrice,
      })
    ).toString("base64");

    const payUrl =
      `https://checkout.paycom.uz/${encoded}`;

    await db.query(
      `
        UPDATE topup_orders
        SET pay_url = $2
        WHERE id = $1
      `,
      [order.id, payUrl]
    );

    await db.query("COMMIT");

    await safeLogUnlockFunnel(pool, {
      clientId,
      serviceId,
      source: "web_unlock_auto",
      step: "payme_redirect_created",
    });

    return res.json({
      ok: true,
      requires_payment: true,
      order_id: order.id,
      amount_tiyin: unlockPrice,
      amount_sum: tiyinToSum(unlockPrice),
      pay_url: payUrl,
      redirect_url: redirectUrl,
      expires_at: expiresAt,
    });
  } catch (e) {
    try {
      await db.query("ROLLBACK");
    } catch {}

    console.error("[client-billing] autoUnlockAfterTopup:", e);

    return res.status(500).json({
      ok: false,
      error: "auto_unlock_failed",
    });
  } finally {
    db.release();
  }
}

async function unlockContact(req, res) {
  const clientId = await findClientId(req);

  if (!clientId) {
    return res.status(401).json({
      ok: false,
      error: "client_auth_required",
    });
  }

  const serviceId = toIntOrNull(
    req.body?.service_id ||
      req.body?.serviceId
  );

  if (!serviceId) {
    return res.status(400).json({
      ok: false,
      error: "service_required",
    });
  }

  const db = await pool.connect();

  try {
    await ensureBillingShape(db);

    await db.query("BEGIN");

    await advisoryLock(
      db,
      `unlock:manual:${clientId}:${serviceId}`
    );

    await expireOldOrders(db, clientId);

    const result = await unlockContactTx(db, {
      clientId,
      serviceId,
      source: "web_manual_unlock",
    });

    await syncClientBalanceMirrorLocal(db, clientId);

    await db.query("COMMIT");

    await safeLogUnlockFunnel(pool, {
      clientId,
      serviceId,
      source: "web_manual_unlock",
      step: result?.alreadyUnlocked
        ? "already_unlocked"
        : "unlocked",
    });

    return res.json({
      ok: true,
      ...result,
    });
  } catch (e) {
    try {
      await db.query("ROLLBACK");
    } catch {}

    console.error("[client-billing] unlockContact:", e);

    return res.status(400).json({
      ok: false,
      error: e?.message || "unlock_failed",
    });
  } finally {
    db.release();
  }
}

module.exports = {
  // старые имена, которые уже ждёт clientBillingRoutes.js
  clientBalance: getClientBalance,
  clientBalanceLedger: getClientBalanceLedger,

  // новые/совместимые имена
  getClientBalance,
  getClientBalanceLedger,

  createTopupOrder,
  createTopupOrderForBalance: createTopupOrder,
  topupOrder: createTopupOrder,

  autoUnlockAfterTopup,
  unlockAuto: autoUnlockAfterTopup,

  unlockContact,
};
