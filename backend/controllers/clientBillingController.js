// backend/controllers/clientBillingController.js

const pool = require("../db");

const {
  isClickConfigured,
  normalizePhone: normalizeClickPhone,
  createClickOrderAndInvoice,
} = require("../utils/clickMerchant");
const { getContactUnlockSettings } = require("../utils/contactUnlockSettings");
const { logUnlockFunnel } = require("../utils/contactUnlockFunnel");
const {
  unlockContactTx,
  getBalanceFromLedger,
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

function normalizeTopupAmountTiyin(body = {}) {
  if (body.amount_tiyin !== undefined && body.amount_tiyin !== null) {
    return normalizePositiveTiyin(body.amount_tiyin);
  }

  const sumValue = body.amount ?? body.sum;
  return sumToTiyin(sumValue);
}

function getOrderExpiryDate(minutes = 30) {
  const ttl = Number(process.env.PAYME_ORDER_TTL_MINUTES || minutes);
  const safeTtl = Number.isFinite(ttl) && ttl > 0 ? ttl : minutes;
  return new Date(Date.now() + safeTtl * 60 * 1000);
}

function buildPaymeCheckoutUrl({ merchantId, orderId, amountTiyin, redirectUrl }) {
  const checkoutBase = String(
    process.env.PAYME_CHECKOUT_URL || "https://checkout.paycom.uz"
  ).replace(/\/+$/, "");

  const raw = [
    `m=${merchantId}`,
    `ac.order_id=${orderId}`,
    `a=${amountTiyin}`,
    redirectUrl ? `c=${redirectUrl}` : "",
  ]
    .filter(Boolean)
    .join(";");

  const encoded = Buffer.from(raw, "utf8").toString("base64");
  return `${checkoutBase}/${encoded}`;
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
      amount BIGINT NOT NULL DEFAULT 0,
      amount_tiyin BIGINT NOT NULL DEFAULT 0,
      provider TEXT NOT NULL DEFAULT 'payme',
      status TEXT NOT NULL DEFAULT 'created',
      purpose TEXT NOT NULL DEFAULT 'client_topup',
      order_type TEXT NOT NULL DEFAULT 'balance_topup',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await db.query(`
    ALTER TABLE topup_orders
      ADD COLUMN IF NOT EXISTS amount_tiyin BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'payme',
      ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'client_topup',
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
    UPDATE topup_orders
       SET amount_tiyin = amount
     WHERE COALESCE(amount_tiyin, 0) = 0
       AND COALESCE(amount, 0) > 0
  `);

  await db.query(`
    UPDATE topup_orders
       SET provider = 'payme'
     WHERE provider IS NULL OR TRIM(provider) = ''
  `);

  await db.query(`
    UPDATE topup_orders
       SET purpose = CASE
         WHEN order_type = 'unlock_contact' THEN 'unlock_contact'
         ELSE 'client_topup'
       END
     WHERE purpose IS NULL OR TRIM(purpose) = ''
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
  if (req.user?.role === "client" && req.user?.id) return req.user.id;
  if (req.user?.clientId) return req.user.clientId;
  if (req.user?.client_id) return req.user.client_id;
  return null;
}

async function getClientBalance(req, res) {
  const clientId = await findClientId(req);

  if (!clientId) {
    return res.status(401).json({ ok: false, error: "client_auth_required" });
  }

  const db = await pool.connect();

  try {
    await ensureBillingShape(db);
    await expireOldOrders(db, clientId);

    const settings = await getContactUnlockSettings(db);
    const balance = await syncClientBalanceMirrorLocal(db, clientId);

    return res.json({
      ok: true,
      balance,
      balance_sum: tiyinToSum(balance),
      balance_tiyin: balance,
      unlock_price: settings.unlockPriceTiyin,
      unlock_price_tiyin: settings.unlockPriceTiyin,
      unlock_price_sum: tiyinToSum(settings.unlockPriceTiyin),
      unlock_is_paid: settings.unlockIsPaid,
      unlock_base_price: settings.unlockBasePrice,
    });
  } catch (e) {
    console.error("[client-billing] getClientBalance:", e);
    return res.status(500).json({ ok: false, error: "balance_failed" });
  } finally {
    db.release();
  }
}

async function getClientBalanceLedger(req, res) {
  const clientId = await findClientId(req);

  if (!clientId) {
    return res.status(401).json({ ok: false, error: "client_auth_required" });
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

    return res.json({ ok: true, items: rows, rows });
  } catch (e) {
    console.error("[client-billing] getClientBalanceLedger:", e);
    return res.status(500).json({ ok: false, error: "ledger_failed" });
  } finally {
    db.release();
  }
}

async function createTopupOrder(req, res) {
  const clientId = await findClientId(req);

  if (!clientId) {
    return res.status(401).json({ ok: false, error: "client_auth_required" });
  }

  const amountTiyin = normalizeTopupAmountTiyin(req.body || {});
  const MIN_TOPUP = normalizePositiveTiyin(
    process.env.MIN_TOPUP_TIYIN || process.env.MIN_TOPUP_TIIYIN || 1000
  );

  if (amountTiyin < MIN_TOPUP) {
    return res.status(400).json({ ok: false, error: "invalid_amount" });
  }

  const db = await pool.connect();

  try {
    await ensureBillingShape(db);
    await db.query("BEGIN");

    await advisoryLock(db, `topup:create:${clientId}`);
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
        order_id: existingPending.rows[0].id,
        amount_tiyin: Number(existingPending.rows[0].amount_tiyin || existingPending.rows[0].amount || 0),
        amount_sum: tiyinToSum(existingPending.rows[0].amount_tiyin || existingPending.rows[0].amount || 0),
        pay_url: existingPending.rows[0].pay_url,
        redirect_url: existingPending.rows[0].redirect_url,
        expires_at: existingPending.rows[0].expires_at,
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
          purpose,
          order_type,
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
          'client_topup',
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
    const merchantId = process.env.PAYME_MERCHANT_ID || process.env.PAYME_CHECKOUT_ID || "";

    if (!merchantId) {
      throw new Error("PAYME_MERCHANT_ID_MISSING");
    }

    const payUrl = buildPaymeCheckoutUrl({
      merchantId,
      orderId: order.id,
      amountTiyin,
      redirectUrl,
    });

    await db.query(
      `UPDATE topup_orders SET pay_url = $2 WHERE id = $1`,
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
    return res.status(500).json({ ok: false, error: "topup_create_failed" });
  } finally {
    db.release();
  }
}

async function autoUnlockAfterTopup(req, res) {
  const clientId = await findClientId(req);

  if (!clientId) {
    return res.status(401).json({ ok: false, error: "client_auth_required" });
  }

  const serviceId = toIntOrNull(req.body?.service_id || req.body?.serviceId);
  const orderId = toIntOrNull(req.body?.order_id || req.body?.orderId);

  if (!serviceId) {
    return res.status(400).json({ ok: false, error: "service_required" });
  }

  const db = await pool.connect();

  try {
    await ensureBillingShape(db);
    const settings = await getContactUnlockSettings(db);
    const unlockPrice = normalizePositiveTiyin(settings.unlockPriceTiyin);

    await db.query("BEGIN");

    await advisoryLock(db, `unlock:auto:${clientId}:${serviceId}`);
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
      return res.json({ ok: true, already_unlocked: true, alreadyUnlocked: true });
    }

    const paidOrderParams = [clientId, serviceId];
    let paidOrderIdFilter = "";
    
    if (orderId) {
      paidOrderParams.push(orderId);
      paidOrderIdFilter = `AND id = $${paidOrderParams.length}`;
    }
    
    const paidUnlockOrder = await db.query(
      `
        SELECT *
        FROM topup_orders
        WHERE client_id = $1
          AND service_id = $2
          AND order_type = 'unlock_contact'
          AND status = 'paid'
          ${paidOrderIdFilter}
        ORDER BY paid_at DESC NULLS LAST, id DESC
        LIMIT 1
      `,
      paidOrderParams
    );
    
    if (paidUnlockOrder.rows[0]) {
      const result = await unlockContactTx(db, {
        clientId,
        serviceId,
        source: "web_return_paid_order",
        skipBalanceDeduction: true,
        note: `Auto unlock after paid Payme order #${paidUnlockOrder.rows[0].id}`,
      });
    
      await syncClientBalanceMirrorLocal(db, clientId);
      await db.query("COMMIT");
    
      await safeLogUnlockFunnel(pool, {
        clientId,
        serviceId,
        source: "web_return_paid_order",
        step: result?.alreadyUnlocked
          ? "already_unlocked_after_paid_order"
          : "unlocked_after_paid_order",
      });
    
      return res.json({
        ok: true,
        unlocked: true,
        alreadyUnlocked: !!result?.alreadyUnlocked,
        paid_order_id: paidUnlockOrder.rows[0].id,
        result,
      });
    }

    const serviceCheck = await db.query(
      `
        SELECT id, provider_id, status, moderation_status, expiration_at, deleted_at
        FROM services
        WHERE id = $1
          AND deleted_at IS NULL
          AND status IN ('published', 'approved', 'active')
          AND COALESCE(LOWER(moderation_status), 'approved') IN ('approved', 'published', 'active')
          AND (expiration_at IS NULL OR expiration_at > now())
          AND COALESCE(NULLIF(LOWER(details->>'isActive'), ''), 'true') <> 'false'
        LIMIT 1
      `,
      [serviceId]
    );

    if (!serviceCheck.rows[0]) {
      await db.query("COMMIT");

      await safeLogUnlockFunnel(pool, {
        clientId,
        serviceId,
        source: "web_unlock_auto",
        step: "service_not_available_before_payment",
      });

      return res.status(404).json({
        ok: false,
        error: "service_not_available",
        message: "Услуга недоступна для открытия контактов",
      });
    }

    const service = serviceCheck.rows[0];

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
        order_id: existingPending.rows[0].id,
        amount_tiyin: Number(existingPending.rows[0].amount_tiyin || existingPending.rows[0].amount || 0),
        amount_sum: tiyinToSum(existingPending.rows[0].amount_tiyin || existingPending.rows[0].amount || 0),
        pay_url: existingPending.rows[0].pay_url,
        redirect_url: existingPending.rows[0].redirect_url,
        expires_at: existingPending.rows[0].expires_at,
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
        alreadyUnlocked: !!result?.alreadyUnlocked,
        result,
      });
    }

    const expiresAt = getOrderExpiryDate();
    const initialRedirectUrl =
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
          purpose,
          order_type,
          service_id,
          provider_id,
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
          'unlock_contact',
          $3,
          $4,
          $5,
          $6,
          $7
        )
        RETURNING *
      `,
      [
        clientId,
        unlockPrice,
        serviceId,
        service.provider_id || null,
        initialRedirectUrl,
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
    const merchantId = process.env.PAYME_MERCHANT_ID || process.env.PAYME_CHECKOUT_ID || "";

    if (!merchantId) {
      throw new Error("PAYME_MERCHANT_ID_MISSING");
    }

    const finalRedirectUrl =
      `${process.env.SITE_URL || ""}/client/balance?service_id=${serviceId}&order_id=${order.id}`;

    const payUrl = buildPaymeCheckoutUrl({
      merchantId,
      orderId: order.id,
      amountTiyin: unlockPrice,
      redirectUrl: finalRedirectUrl,
    });

    await db.query(
      `
        UPDATE topup_orders
        SET
          pay_url = $2,
          redirect_url = $3
        WHERE id = $1
      `,
      [order.id, payUrl, finalRedirectUrl]
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
      redirect_url: finalRedirectUrl,
      expires_at: expiresAt,
    });
  } catch (e) {
    try {
      await db.query("ROLLBACK");
    } catch {}

    console.error("[client-billing] autoUnlockAfterTopup:", e);
    return res.status(500).json({ ok: false, error: "auto_unlock_failed" });
  } finally {
    db.release();
  }
}


async function createClickUnlockInvoice(req, res) {
  const clientId = await findClientId(req);

  if (!clientId) {
    return res.status(401).json({ ok: false, error: "client_auth_required" });
  }

  if (!isClickConfigured("web")) {
    return res.status(500).json({ ok: false, error: "click_web_not_configured" });
  }

  const serviceId = toIntOrNull(req.body?.service_id || req.body?.serviceId);
  const rawPhone = req.body?.phone_number || req.body?.phoneNumber || req.body?.phone || "";
  const phoneNumber = normalizeClickPhone(rawPhone);

  if (!serviceId) {
    return res.status(400).json({ ok: false, error: "service_required" });
  }

  if (!phoneNumber) {
    return res.status(400).json({
      ok: false,
      error: "click_phone_required",
      message: "Укажите номер телефона Click в формате 998901234567",
    });
  }

  const db = await pool.connect();

  try {
    await ensureBillingShape(db);
    await db.query("BEGIN");

    await advisoryLock(db, `web:click-unlock:${clientId}:${serviceId}`);
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
      return res.json({ ok: true, unlocked: true, alreadyUnlocked: true });
    }

    const serviceCheck = await db.query(
      `
        SELECT id, provider_id, status, moderation_status, expiration_at, deleted_at
        FROM services
        WHERE id = $1
          AND deleted_at IS NULL
          AND status IN ('published', 'approved', 'active')
          AND COALESCE(LOWER(moderation_status), 'approved') IN ('approved', 'published', 'active')
          AND (expiration_at IS NULL OR expiration_at > now())
          AND COALESCE(NULLIF(LOWER(details->>'isActive'), ''), 'true') <> 'false'
        LIMIT 1
      `,
      [serviceId]
    );

    if (!serviceCheck.rows[0]) {
      await db.query("COMMIT");
      return res.status(404).json({
        ok: false,
        error: "service_not_available",
        message: "Услуга недоступна для открытия контактов",
      });
    }

    const settings = await getContactUnlockSettings(db);
    const unlockPriceTiyin = normalizePositiveTiyin(settings.unlockPriceTiyin);
    const unlockPriceSum = tiyinToSum(unlockPriceTiyin);

    if (!settings.unlockIsPaid || unlockPriceTiyin <= 0) {
      const result = await unlockContactTx(db, {
        clientId,
        serviceId,
        source: "web_click_free_unlock",
      });
      await syncClientBalanceMirrorLocal(db, clientId);
      await db.query("COMMIT");
      return res.json({ ok: true, unlocked: true, result });
    }

    const service = serviceCheck.rows[0];
    const merchantTransId = `web-unlock-${clientId}-${serviceId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const clickResult = await createClickOrderAndInvoice(db, {
      merchantTransId,
      orderType: "unlock_contact",
      clickProfile: "web",
      actorRole: "client",
      actorId: clientId,
      telegramChatId: null,
      serviceId,
      amountSum: unlockPriceSum,
      phoneNumber,
      meta: {
        source: "web_marketplace",
        provider_id: service.provider_id || null,
        ip: req.ip,
        ua: req.headers["user-agent"] || null,
      },
    });

    await safeLogUnlockFunnel(pool, {
      clientId,
      serviceId,
      source: "web_click_invoice",
      step: "click_invoice_created",
      meta: {
        merchant_trans_id: merchantTransId,
        click_invoice_id: clickResult?.order?.click_invoice_id || null,
      },
    });

    await db.query("COMMIT");

    return res.json({
      ok: true,
      provider: "click",
      requires_payment: true,
      order_id: clickResult?.order?.id || null,
      click_order_id: clickResult?.order?.id || null,
      click_invoice_id: clickResult?.order?.click_invoice_id || clickResult?.invoice?.invoice_id || null,
      merchant_trans_id: merchantTransId,
      amount_tiyin: unlockPriceTiyin,
      amount_sum: unlockPriceSum,
      phone_number: phoneNumber,
      message: "Click-счёт выставлен. Откройте приложение Click и оплатите счёт.",
    });
  } catch (e) {
    try {
      await db.query("ROLLBACK");
    } catch {}

    const clickData = e?.click || null;
    const clickNote = clickData?.error_note || e?.message || "click_invoice_failed";
    console.error("[client-billing] createClickUnlockInvoice:", clickNote, clickData || "");

    return res.status(e?.status && e.status >= 400 && e.status < 600 ? e.status : 500).json({
      ok: false,
      error: "click_invoice_failed",
      message: clickNote,
      click_error_code: clickData?.error_code ?? null,
      click_error_note: clickData?.error_note ?? null,
    });
  } finally {
    db.release();
  }
}

async function getUnlockStatus(req, res) {
  const clientId = await findClientId(req);

  if (!clientId) {
    return res.status(401).json({ ok: false, error: "client_auth_required" });
  }

  const serviceId = toIntOrNull(req.query?.service_id || req.query?.serviceId);

  if (!serviceId) {
    return res.status(400).json({ ok: false, error: "service_required" });
  }

  const db = await pool.connect();

  try {
    await ensureBillingShape(db);
    await expireOldOrders(db, clientId);

    await db.query("BEGIN");
    await advisoryLock(db, `unlock:status:${clientId}:${serviceId}`);

    let unlockedQ = await db.query(
      `
        SELECT id, created_at
        FROM client_service_contact_unlocks
        WHERE client_id = $1
          AND service_id = $2
        LIMIT 1
      `,
      [clientId, serviceId]
    );

    let reconciled = false;
    let reconciledProvider = null;
    let reconciledOrder = null;

    if (!unlockedQ.rows[0]) {
      const paidPaymeOrder = await db.query(
        `
          SELECT *
          FROM topup_orders
          WHERE client_id = $1
            AND service_id = $2
            AND order_type = 'unlock_contact'
            AND status = 'paid'
          ORDER BY paid_at DESC NULLS LAST, id DESC
          LIMIT 1
        `,
        [clientId, serviceId]
      );

      if (paidPaymeOrder.rows[0]) {
        const order = paidPaymeOrder.rows[0];
        await unlockContactTx(db, {
          clientId,
          serviceId,
          source: "web_payment_status_payme_reconcile",
          skipBalanceDeduction: true,
          note: `Manual/payment status check after Payme order #${order.id}`,
        });
        reconciled = true;
        reconciledProvider = "payme";
        reconciledOrder = { id: order.id, status: order.status, paid_at: order.paid_at };
      }
    }

    if (!unlockedQ.rows[0] && !reconciled) {
      const paidClickOrder = await db.query(
        `
          SELECT *
          FROM click_orders
          WHERE actor_role = 'client'
            AND actor_id = $1
            AND service_id = $2
            AND order_type = 'unlock_contact'
            AND status = 'paid'
          ORDER BY paid_at DESC NULLS LAST, id DESC
          LIMIT 1
        `,
        [clientId, serviceId]
      ).catch(() => ({ rows: [] }));

      if (paidClickOrder.rows[0]) {
        const order = paidClickOrder.rows[0];
        await unlockContactTx(db, {
          clientId,
          serviceId,
          source: "web_payment_status_click_reconcile",
          skipBalanceDeduction: true,
          note: `Manual/payment status check after Click order #${order.id}`,
        });
        reconciled = true;
        reconciledProvider = "click";
        reconciledOrder = {
          id: order.id,
          status: order.status,
          paid_at: order.paid_at,
          click_invoice_id: order.click_invoice_id || null,
        };
      }
    }

    if (reconciled) {
      unlockedQ = await db.query(
        `
          SELECT id, created_at
          FROM client_service_contact_unlocks
          WHERE client_id = $1
            AND service_id = $2
          LIMIT 1
        `,
        [clientId, serviceId]
      );
      await syncClientBalanceMirrorLocal(db, clientId);
    }

    const clickQ = await db.query(
      `
        SELECT id, merchant_trans_id, click_invoice_id, status, paid_at, created_at, error_code, error_note
        FROM click_orders
        WHERE actor_role = 'client'
          AND actor_id = $1
          AND service_id = $2
          AND order_type = 'unlock_contact'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
      [clientId, serviceId]
    ).catch(() => ({ rows: [] }));

    const paymeQ = await db.query(
      `
        SELECT id, status, paid_at, created_at, expires_at, payme_transaction_id, pay_url
        FROM topup_orders
        WHERE client_id = $1
          AND service_id = $2
          AND order_type = 'unlock_contact'
          AND provider = 'payme'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
      [clientId, serviceId]
    ).catch(() => ({ rows: [] }));

    await db.query("COMMIT");

    return res.json({
      ok: true,
      unlocked: !!unlockedQ.rows[0],
      unlock: unlockedQ.rows[0] || null,
      reconciled,
      reconciled_provider: reconciledProvider,
      reconciled_order: reconciledOrder,
      click_order: clickQ.rows[0] || null,
      payme_order: paymeQ.rows[0] || null,
      message: reconciled
        ? "Оплата найдена, контакты открыты."
        : unlockedQ.rows[0]
          ? "Контакты уже открыты."
          : "Оплата пока не найдена. Если вы оплатили только что, проверьте ещё раз через несколько секунд.",
    });
  } catch (e) {
    try {
      await db.query("ROLLBACK");
    } catch {}
    console.error("[client-billing] getUnlockStatus:", e);
    return res.status(500).json({ ok: false, error: "unlock_status_failed" });
  } finally {
    db.release();
  }
}

async function unlockContact(req, res) {
  const clientId = await findClientId(req);

  if (!clientId) {
    return res.status(401).json({ ok: false, error: "client_auth_required" });
  }

  const serviceId = toIntOrNull(req.body?.service_id || req.body?.serviceId);

  if (!serviceId) {
    return res.status(400).json({ ok: false, error: "service_required" });
  }

  const db = await pool.connect();

  try {
    await ensureBillingShape(db);
    await db.query("BEGIN");

    await advisoryLock(db, `unlock:manual:${clientId}:${serviceId}`);
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
      step: result?.alreadyUnlocked ? "already_unlocked" : "unlocked",
    });

    return res.json({ ok: true, ...result });
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
  clientBalance: getClientBalance,
  clientBalanceLedger: getClientBalanceLedger,

  getClientBalance,
  getClientBalanceLedger,

  createTopupOrder,
  createTopupOrderForBalance: createTopupOrder,
  topupOrder: createTopupOrder,

  autoUnlockAfterTopup,
  unlockAuto: autoUnlockAfterTopup,

  createClickUnlockInvoice,
  getUnlockStatus,

  unlockContact,
};
