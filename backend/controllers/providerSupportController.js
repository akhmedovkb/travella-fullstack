// backend/controllers/providerSupportController.js
const pool = require("../db");

const DEFAULT_SUGGESTED_AMOUNTS = [10000, 25000, 50000, 100000];
const DEFAULT_MIN_AMOUNT_SUM = 1000;

function intOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function positiveInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
}

function clampInt(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function cleanText(v, max = 5000) {
  return String(v ?? "").trim().slice(0, max);
}

function sumToTiyin(sum) {
  return Math.round(Number(sum || 0) * 100);
}

function tiyinToSum(tiyin) {
  return Math.trunc(Number(tiyin || 0) / 100);
}

function normalizeSuggestedAmounts(v) {
  const arr = Array.isArray(v)
    ? v
    : String(v || "")
        .split(/[\s,;]+/)
        .map((x) => x.trim())
        .filter(Boolean);

  const nums = arr
    .map((x) => Math.trunc(Number(x)))
    .filter((x) => Number.isFinite(x) && x > 0)
    .slice(0, 12);

  return nums.length ? nums : DEFAULT_SUGGESTED_AMOUNTS;
}

async function advisoryLock(db, key) {
  await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [String(key)]);
}

async function relationKind(db, relName) {
  const { rows } = await db.query(
    `SELECT c.relkind
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = $1
      LIMIT 1`,
    [relName]
  );

  return rows[0]?.relkind || null;
}

async function columnExists(db, tableName, columnName) {
  const { rows } = await db.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
      LIMIT 1
    `,
    [tableName, columnName]
  );

  return !!rows[0];
}


async function columnDataType(db, tableName, columnName) {
  const { rows } = await db.query(
    `
      SELECT data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
      LIMIT 1
    `,
    [tableName, columnName]
  );

  return rows[0] || null;
}

async function ensureBigIntColumn(db, tableName, columnName) {
  if (!(await columnExists(db, tableName, columnName))) return;

  const info = await columnDataType(db, tableName, columnName);
  const udt = String(info?.udt_name || "").toLowerCase();

  if (udt === "int8") return;

  await db.query(
    `ALTER TABLE ${tableName}
       ALTER COLUMN ${columnName} TYPE BIGINT
       USING NULLIF(${columnName}::text, '')::BIGINT`
  );
}

async function ensureProviderSupportBigIntColumns(db, target = "topup_orders") {
  const donationKind = await relationKind(db, "provider_support_donations");
  if (donationKind === "r" || donationKind === "p") {
    for (const column of [
      "provider_id",
      "telegram_chat_id",
      "service_id",
      "amount_tiyin",
      "payme_order_id",
    ]) {
      await ensureBigIntColumn(db, "provider_support_donations", column);
    }
  }

  const targetKind = await relationKind(db, target);
  if (targetKind === "r" || targetKind === "p") {
    for (const column of [
      "client_id",
      "amount",
      "amount_tiyin",
      "support_donation_id",
      "provider_id",
      "telegram_chat_id",
      "service_id",
    ]) {
      await ensureBigIntColumn(db, target, column);
    }
  }
}

async function ensureProviderSupportSchema(db = pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS provider_support_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      title TEXT NOT NULL DEFAULT '❤️ Поддержка проекта',
      message TEXT NOT NULL DEFAULT 'Если вы хотите поддержать развитие проекта Bot Otkaznyx Turov и Travella — можете отправить любую комфортную для вас сумму.',
      suggested_amounts JSONB NOT NULL DEFAULT '[10000,25000,50000,100000]'::jsonb,
      min_amount_sum INTEGER NOT NULL DEFAULT ${DEFAULT_MIN_AMOUNT_SUM},
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT provider_support_settings_singleton CHECK (id = 1)
    )
  `);

  await db.query(`
    INSERT INTO provider_support_settings (id)
    VALUES (1)
    ON CONFLICT (id) DO NOTHING
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS provider_support_donations (
      id BIGSERIAL PRIMARY KEY,
      provider_id BIGINT NULL,
      telegram_chat_id BIGINT NULL,
      service_id BIGINT NULL,
      amount_tiyin BIGINT NOT NULL CHECK (amount_tiyin > 0),
      payme_order_id BIGINT UNIQUE,
      payme_id TEXT,
      status TEXT NOT NULL DEFAULT 'created',
      source TEXT NOT NULL DEFAULT 'telegram_provider_bot',
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      paid_at TIMESTAMPTZ NULL,
      cancelled_at TIMESTAMPTZ NULL,
      failed_at TIMESTAMPTZ NULL,
      expires_at TIMESTAMPTZ NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    ALTER TABLE provider_support_donations
      ADD COLUMN IF NOT EXISTS provider_id BIGINT NULL,
      ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT NULL,
      ADD COLUMN IF NOT EXISTS service_id BIGINT NULL,
      ADD COLUMN IF NOT EXISTS amount_tiyin BIGINT,
      ADD COLUMN IF NOT EXISTS payme_order_id BIGINT UNIQUE,
      ADD COLUMN IF NOT EXISTS payme_id TEXT,
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'created',
      ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'telegram_provider_bot',
      ADD COLUMN IF NOT EXISTS note TEXT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await ensureProviderSupportBigIntColumns(db, "provider_support_donations");

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_provider_support_donations_status
      ON provider_support_donations(status)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_provider_support_donations_provider
      ON provider_support_donations(provider_id)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_provider_support_donations_created_at
      ON provider_support_donations(created_at DESC)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_provider_support_donations_order
      ON provider_support_donations(payme_order_id)
  `);

  const topupKind = await relationKind(db, "topup_orders");
  const target = topupKind === "v" ? "payme_topup_orders" : "topup_orders";

  await db.query(`
    CREATE TABLE IF NOT EXISTS payme_topup_orders (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NULL,
      amount BIGINT NOT NULL DEFAULT 0,
      amount_tiyin BIGINT NOT NULL DEFAULT 0,
      provider TEXT NOT NULL DEFAULT 'payme',
      status TEXT NOT NULL DEFAULT 'created',
      order_type TEXT NOT NULL DEFAULT 'balance_topup',
      purpose TEXT NOT NULL DEFAULT 'client_topup',
      support_donation_id BIGINT NULL,
      provider_id BIGINT NULL,
      telegram_chat_id BIGINT NULL,
      service_id BIGINT NULL,
      pay_url TEXT NULL,
      redirect_url TEXT NULL,
      expires_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      paid_at TIMESTAMPTZ NULL,
      canceled_at TIMESTAMPTZ NULL,
      failed_at TIMESTAMPTZ NULL,
      note TEXT NULL,
      meta JSONB NULL
    )
  `);

  if (topupKind !== "v") {
    await db.query(`
      CREATE TABLE IF NOT EXISTS topup_orders (
        id BIGSERIAL PRIMARY KEY,
        client_id BIGINT NULL,
        amount BIGINT NOT NULL DEFAULT 0,
        amount_tiyin BIGINT NOT NULL DEFAULT 0,
        provider TEXT NOT NULL DEFAULT 'payme',
        status TEXT NOT NULL DEFAULT 'created',
        order_type TEXT NOT NULL DEFAULT 'balance_topup',
        purpose TEXT NOT NULL DEFAULT 'client_topup',
        support_donation_id BIGINT NULL,
        provider_id BIGINT NULL,
        telegram_chat_id BIGINT NULL,
        service_id BIGINT NULL,
        pay_url TEXT NULL,
        redirect_url TEXT NULL,
        expires_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        paid_at TIMESTAMPTZ NULL,
        canceled_at TIMESTAMPTZ NULL,
        failed_at TIMESTAMPTZ NULL,
        note TEXT NULL,
        meta JSONB NULL
      )
    `);
  }

  await db.query(`
    ALTER TABLE ${target}
      ADD COLUMN IF NOT EXISTS client_id BIGINT NULL,
      ADD COLUMN IF NOT EXISTS amount BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS amount_tiyin BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'payme',
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'created',
      ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'balance_topup',
      ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'client_topup',
      ADD COLUMN IF NOT EXISTS support_donation_id BIGINT NULL,
      ADD COLUMN IF NOT EXISTS provider_id BIGINT NULL,
      ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT NULL,
      ADD COLUMN IF NOT EXISTS service_id BIGINT NULL,
      ADD COLUMN IF NOT EXISTS pay_url TEXT NULL,
      ADD COLUMN IF NOT EXISTS redirect_url TEXT NULL,
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS note TEXT NULL,
      ADD COLUMN IF NOT EXISTS meta JSONB NULL
  `);

  await ensureProviderSupportBigIntColumns(db, target);

  try {
    await db.query(`ALTER TABLE ${target} ALTER COLUMN client_id DROP NOT NULL`);
  } catch (e) {
    console.warn("[providerSupport] client_id DROP NOT NULL skipped:", e?.message || e);
  }

  await db.query(`
    UPDATE ${target}
       SET amount = amount_tiyin
     WHERE COALESCE(amount, 0) = 0
       AND COALESCE(amount_tiyin, 0) > 0
  `);

  await db.query(`
    UPDATE ${target}
       SET amount_tiyin = amount
     WHERE COALESCE(amount_tiyin, 0) = 0
       AND COALESCE(amount, 0) > 0
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_topup_orders_support_donation_id
      ON ${target}(support_donation_id)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_topup_orders_order_type_status
      ON ${target}(order_type, status)
  `);

  if (topupKind === "v") {
    await db.query(`CREATE OR REPLACE VIEW topup_orders AS SELECT * FROM payme_topup_orders`);
  }
}

function buildPaymeCheckoutUrl({
  merchantId,
  checkoutBase,
  orderId,
  amountTiyin,
  lang,
  callbackUrl,
}) {
  const encoded = Buffer.from(
    [
      `m=${merchantId}`,
      `ac.order_id=${orderId}`,
      `a=${amountTiyin}`,
      `l=${lang || "ru"}`,
      callbackUrl ? `c=${callbackUrl}` : "",
    ]
      .filter(Boolean)
      .join(";"),
    "utf8"
  ).toString("base64");

  return `${String(checkoutBase || "https://checkout.paycom.uz").replace(/\/+$/, "")}/${encoded}`;
}

async function getProviderByTelegramChatId(db, telegramChatId) {
  const chat = String(telegramChatId || "").trim();
  if (!chat) return null;

  const { rows } = await db.query(
    `
      SELECT
        id,
        name,
        phone,
        type,
        telegram_chat_id,
        telegram_refused_chat_id,
        telegram_web_chat_id
      FROM providers
      WHERE telegram_chat_id::text = $1
         OR telegram_refused_chat_id::text = $1
         OR telegram_web_chat_id::text = $1
      ORDER BY id DESC
      LIMIT 1
    `,
    [chat]
  );

  return rows[0] || null;
}

async function getProviderSupportSettings(db = pool) {
  await ensureProviderSupportSchema(db);

  const { rows } = await db.query(
    `
      SELECT
        id,
        enabled,
        title,
        message,
        suggested_amounts,
        min_amount_sum,
        updated_at
      FROM provider_support_settings
      WHERE id = 1
      LIMIT 1
    `
  );

  return rows[0] || null;
}

async function expireOldProviderSupportOrders(db = pool) {
  await ensureProviderSupportSchema(db);

  const topupKind = await relationKind(db, "topup_orders");
  const target = topupKind === "v" ? "payme_topup_orders" : "topup_orders";

  await db.query(`
    UPDATE ${target}
       SET status = 'expired',
           failed_at = COALESCE(failed_at, NOW())
     WHERE order_type = 'provider_support'
       AND status IN ('new', 'created', 'pending')
       AND expires_at IS NOT NULL
       AND expires_at < NOW()
  `);

  await db.query(`
    UPDATE provider_support_donations d
       SET status = 'expired',
           failed_at = COALESCE(d.failed_at, NOW()),
           updated_at = NOW()
      FROM ${target} o
     WHERE o.support_donation_id = d.id
       AND o.order_type = 'provider_support'
       AND o.status = 'expired'
       AND d.status IN ('new', 'created', 'pending')
  `);
}

async function syncProviderSupportDonationStatuses(db = pool) {
  await ensureProviderSupportSchema(db);
  await expireOldProviderSupportOrders(db);

  const topupKind = await relationKind(db, "topup_orders");
  const target = topupKind === "v" ? "payme_topup_orders" : "topup_orders";

  const hasPaymeTransactions =
    (await relationKind(db, "payme_transactions")) !== null;

  if (hasPaymeTransactions) {
    await db.query(`
      UPDATE provider_support_donations d
         SET status = 'paid',
             paid_at = COALESCE(d.paid_at, to_timestamp(pt.perform_time / 1000.0), NOW()),
             payme_id = COALESCE(d.payme_id, pt.payme_id),
             updated_at = NOW()
        FROM payme_transactions pt
       WHERE pt.order_id = d.payme_order_id
         AND pt.state = 2
         AND d.status <> 'paid'
    `);

    await db.query(`
      UPDATE provider_support_donations d
         SET status = CASE
              WHEN pt.state = -2 THEN 'refunded'
              ELSE 'canceled'
             END,
             cancelled_at = COALESCE(d.cancelled_at, to_timestamp(pt.cancel_time / 1000.0), NOW()),
             payme_id = COALESCE(d.payme_id, pt.payme_id),
             updated_at = NOW()
        FROM payme_transactions pt
       WHERE pt.order_id = d.payme_order_id
         AND pt.state IN (-1, -2)
         AND d.status <> 'paid'
    `);
  }

  await db.query(`
    UPDATE provider_support_donations d
       SET status = 'paid',
           paid_at = COALESCE(d.paid_at, o.paid_at, NOW()),
           updated_at = NOW()
      FROM ${target} o
     WHERE o.support_donation_id = d.id
       AND o.order_type = 'provider_support'
       AND o.status = 'paid'
       AND d.status <> 'paid'
  `);

  await db.query(`
    UPDATE provider_support_donations d
       SET status = 'canceled',
           cancelled_at = COALESCE(d.cancelled_at, o.canceled_at, NOW()),
           updated_at = NOW()
      FROM ${target} o
     WHERE o.support_donation_id = d.id
       AND o.order_type = 'provider_support'
       AND o.status IN ('canceled', 'cancelled')
       AND d.status IN ('new', 'created', 'pending')
  `);
}

async function createProviderSupportDonationOrder({
  telegramChatId,
  providerId = null,
  serviceId = null,
  amountSum,
  source = "telegram_provider_bot",
  note = null,
}) {
  const amountSumInt = positiveInt(amountSum, 0);

  if (!amountSumInt) {
    const e = new Error("Bad support amount");
    e.status = 400;
    throw e;
  }

  const merchantId = process.env.PAYME_MERCHANT_ID || process.env.PAYME_CHECKOUT_ID || "";
  const checkoutBase = process.env.PAYME_CHECKOUT_URL || "https://checkout.paycom.uz";
  const sitePublic =
    process.env.SITE_PUBLIC_URL ||
    process.env.SITE_URL ||
    process.env.FRONTEND_URL ||
    "https://travella.uz";

  if (!merchantId || !sitePublic) {
    const e = new Error("Payme is not configured");
    e.status = 500;
    throw e;
  }

  const db = await pool.connect();

  try {
    await db.query("BEGIN");
    await ensureProviderSupportSchema(db);

    await advisoryLock(
      db,
      `provider-support:${providerId || ""}:${telegramChatId || ""}:${serviceId || ""}:${amountSumInt}`
    );

    await expireOldProviderSupportOrders(db);

    const settings = await getProviderSupportSettings(db);

    if (!settings?.enabled) {
      const e = new Error("Provider support is disabled");
      e.status = 403;
      throw e;
    }

    const minAmount = positiveInt(settings.min_amount_sum, DEFAULT_MIN_AMOUNT_SUM);

    if (minAmount > 0 && amountSumInt < minAmount) {
      const e = new Error(`Minimum support amount is ${minAmount}`);
      e.status = 400;
      throw e;
    }

    let resolvedProviderId = intOrNull(providerId);

    if (!resolvedProviderId && telegramChatId) {
      const provider = await getProviderByTelegramChatId(db, telegramChatId);
      resolvedProviderId = provider?.id ? Number(provider.id) : null;
    }

    const tgChatId = intOrNull(telegramChatId);
    const svcId = intOrNull(serviceId);
    const amountTiyin = sumToTiyin(amountSumInt);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    const topupKind = await relationKind(db, "topup_orders");
    const target = topupKind === "v" ? "payme_topup_orders" : "topup_orders";

    const existing = await db.query(
      `
        SELECT
          d.*,
          o.id AS order_id,
          o.pay_url,
          o.status AS order_status,
          o.expires_at AS order_expires_at
        FROM provider_support_donations d
        JOIN ${target} o ON o.support_donation_id = d.id
        WHERE d.amount_tiyin = $1
          AND COALESCE(d.provider_id, 0::bigint) = COALESCE($2::bigint, 0::bigint)
          AND COALESCE(d.telegram_chat_id, 0::bigint) = COALESCE($3::bigint, 0::bigint)
          AND COALESCE(d.service_id, 0::bigint) = COALESCE($4::bigint, 0::bigint)
          AND d.status IN ('new', 'created', 'pending')
          AND o.status IN ('new', 'created', 'pending')
          AND o.order_type = 'provider_support'
          AND o.expires_at IS NOT NULL
          AND o.expires_at > NOW()
        ORDER BY d.id DESC
        LIMIT 1
      `,
      [amountTiyin, resolvedProviderId, tgChatId, svcId]
    );

    if (existing.rows[0]?.pay_url) {
      await db.query("COMMIT");

      return {
        ok: true,
        reused: true,
        donation: {
          id: Number(existing.rows[0].id),
          provider_id: resolvedProviderId,
          telegram_chat_id: tgChatId,
          service_id: svcId,
          amount_tiyin: amountTiyin,
          amount_sum: amountSumInt,
          status: existing.rows[0].status,
          expires_at: existing.rows[0].order_expires_at,
        },
        order: {
          id: Number(existing.rows[0].order_id),
          amount_tiyin: amountTiyin,
          amount_sum: amountSumInt,
          status: existing.rows[0].order_status,
          expires_at: existing.rows[0].order_expires_at,
        },
        pay_url: existing.rows[0].pay_url,
      };
    }

    const donationQ = await db.query(
      `
        INSERT INTO provider_support_donations (
          provider_id,
          telegram_chat_id,
          service_id,
          amount_tiyin,
          status,
          source,
          note,
          expires_at
        )
        VALUES ($1, $2, $3, $4, 'created', $5, $6, $7)
        RETURNING *
      `,
      [
        resolvedProviderId,
        tgChatId,
        svcId,
        amountTiyin,
        cleanText(source, 120) || "telegram_provider_bot",
        cleanText(note, 1000) || null,
        expiresAt,
      ]
    );

    const donation = donationQ.rows[0];

    const orderQ = await db.query(
      `
        INSERT INTO ${target} (
          client_id,
          amount,
          amount_tiyin,
          provider,
          status,
          order_type,
          purpose,
          support_donation_id,
          provider_id,
          telegram_chat_id,
          service_id,
          redirect_url,
          expires_at,
          note,
          meta
        )
        VALUES (
          NULL,
          $1,
          $1,
          'payme',
          'created',
          'provider_support',
          'provider_support',
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9
        )
        RETURNING id, amount, amount_tiyin, status, created_at, expires_at
      `,
      [
        amountTiyin,
        Number(donation.id),
        resolvedProviderId,
        tgChatId,
        svcId,
        `${String(sitePublic).replace(/\/+$/, "")}/support/success?donation_id=${donation.id}`,
        expiresAt,
        cleanText(note, 1000) || null,
        JSON.stringify({
          source: cleanText(source, 120) || "telegram_provider_bot",
          donation_id: Number(donation.id),
          amount_sum: amountSumInt,
        }),
      ]
    );

    const order = orderQ.rows[0];

    const callbackUrl = `${String(sitePublic).replace(/\/+$/, "")}/support/success?donation_id=${donation.id}&order_id=${order.id}`;

    const payUrl = buildPaymeCheckoutUrl({
      merchantId,
      checkoutBase,
      orderId: Number(order.id),
      amountTiyin,
      lang: "ru",
      callbackUrl,
    });

    await db.query(
      `
        UPDATE ${target}
           SET pay_url = $2,
               redirect_url = $3
         WHERE id = $1
      `,
      [Number(order.id), payUrl, callbackUrl]
    );

    await db.query(
      `
        UPDATE provider_support_donations
           SET payme_order_id = $2,
               status = 'created',
               updated_at = NOW()
         WHERE id = $1
      `,
      [Number(donation.id), Number(order.id)]
    );

    await db.query("COMMIT");

    return {
      ok: true,
      reused: false,
      donation: {
        id: Number(donation.id),
        provider_id: resolvedProviderId,
        telegram_chat_id: tgChatId,
        service_id: svcId,
        amount_tiyin: amountTiyin,
        amount_sum: amountSumInt,
        status: "created",
        expires_at: expiresAt,
      },
      order: {
        id: Number(order.id),
        amount_tiyin: amountTiyin,
        amount_sum: amountSumInt,
        status: order.status,
        expires_at: expiresAt,
      },
      pay_url: payUrl,
    };
  } catch (e) {
    try {
      await db.query("ROLLBACK");
    } catch {}

    throw e;
  } finally {
    db.release();
  }
}


async function publicSupportStatus(req, res) {
  try {
    await ensureProviderSupportSchema(pool);
    await syncProviderSupportDonationStatuses(pool);

    const donationId = intOrNull(req.query?.donation_id || req.query?.donationId);
    const orderId = intOrNull(req.query?.order_id || req.query?.orderId);

    if (!donationId && !orderId) {
      return res.status(400).json({ ok: false, message: "donation_id or order_id is required" });
    }

    const topupKind = await relationKind(pool, "topup_orders");
    const target = topupKind === "v" ? "payme_topup_orders" : "topup_orders";
    const hasPaymeTransactions = (await relationKind(pool, "payme_transactions")) !== null;

    const paymeJoin = hasPaymeTransactions
      ? `LEFT JOIN payme_transactions pt ON pt.order_id = o.id`
      : `LEFT JOIN LATERAL (
           SELECT NULL::text AS payme_id,
                  NULL::int AS state,
                  NULL::bigint AS create_time,
                  NULL::bigint AS perform_time,
                  NULL::bigint AS cancel_time
         ) pt ON TRUE`;

    const args = [];
    const where = [];
    let i = 1;

    if (donationId) {
      where.push(`d.id = $${i++}`);
      args.push(donationId);
    }
    if (orderId) {
      where.push(`o.id = $${i++}`);
      args.push(orderId);
    }

    const { rows } = await pool.query(
      `
        SELECT
          d.id AS donation_id,
          d.status AS donation_status,
          d.amount_tiyin,
          FLOOR(d.amount_tiyin / 100)::bigint AS amount_sum,
          d.provider_id,
          d.service_id,
          d.source,
          d.created_at,
          d.paid_at,
          d.cancelled_at,
          d.failed_at,
          d.expires_at,
          o.id AS order_id,
          o.status AS order_status,
          o.pay_url,
          o.expires_at AS order_expires_at,
          COALESCE(d.payme_id, pt.payme_id) AS payme_id,
          pt.state AS payme_state,
          pt.perform_time,
          pt.cancel_time
        FROM provider_support_donations d
        LEFT JOIN ${target} o ON o.support_donation_id = d.id
        ${paymeJoin}
        WHERE ${where.join(" AND ")}
        ORDER BY d.id DESC
        LIMIT 1
      `,
      args
    );

    const row = rows[0];
    if (!row) {
      return res.status(404).json({ ok: false, message: "Support payment not found" });
    }

    return res.json({
      ok: true,
      donation: {
        id: Number(row.donation_id),
        status: row.donation_status,
        amount_tiyin: Number(row.amount_tiyin || 0),
        amount_sum: Number(row.amount_sum || 0),
        provider_id: row.provider_id ? Number(row.provider_id) : null,
        service_id: row.service_id ? Number(row.service_id) : null,
        source: row.source || null,
        created_at: row.created_at,
        paid_at: row.paid_at,
        cancelled_at: row.cancelled_at,
        failed_at: row.failed_at,
        expires_at: row.expires_at,
      },
      order: {
        id: row.order_id ? Number(row.order_id) : null,
        status: row.order_status || null,
        pay_url: row.pay_url || null,
        expires_at: row.order_expires_at,
      },
      payme: {
        id: row.payme_id || null,
        state: row.payme_state,
        perform_time: row.perform_time,
        cancel_time: row.cancel_time,
      },
    });
  } catch (e) {
    console.error("publicSupportStatus error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function providerCreateSupportDonation(req, res) {
  try {
    if (String(req.user?.role || "").toLowerCase() !== "provider" && !req.user?.is_admin) {
      return res.status(403).json({ ok: false, message: "Provider access required" });
    }

    const providerId = intOrNull(req.user?.id);
    if (!providerId) {
      return res.status(401).json({ ok: false, message: "Provider is not identified" });
    }

    const amountSum = positiveInt(req.body?.amount_sum || req.body?.amount || req.body?.sum, 0);
    const serviceId = intOrNull(req.body?.service_id || req.body?.serviceId);
    const note = cleanText(req.body?.note, 1000) || "Web provider support";

    const result = await createProviderSupportDonationOrder({
      providerId,
      serviceId,
      amountSum,
      source: "provider_web",
      note,
    });

    return res.json(result);
  } catch (e) {
    console.error("providerCreateSupportDonation error:", e);
    return res.status(e.status || 500).json({ ok: false, message: e.message || "Internal error" });
  }
}

async function adminSupportSettings(req, res) {
  try {
    const settings = await getProviderSupportSettings(pool);
    return res.json({ ok: true, settings });
  } catch (e) {
    console.error("adminSupportSettings error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function adminUpdateSupportSettings(req, res) {
  try {
    await ensureProviderSupportSchema(pool);

    const enabled = req.body?.enabled !== false;
    const title = cleanText(req.body?.title, 300) || "❤️ Поддержка проекта";
    const message =
      cleanText(req.body?.message, 2000) ||
      "Если вы хотите поддержать развитие проекта Bot Otkaznyx Turov и Travella — можете отправить любую комфортную для вас сумму.";
    const suggestedAmounts = normalizeSuggestedAmounts(req.body?.suggested_amounts);
    const minAmount = clampInt(
      req.body?.min_amount_sum,
      DEFAULT_MIN_AMOUNT_SUM,
      1,
      100000000
    );

    const { rows } = await pool.query(
      `
        UPDATE provider_support_settings
           SET enabled = $1,
               title = $2,
               message = $3,
               suggested_amounts = $4::jsonb,
               min_amount_sum = $5,
               updated_at = NOW()
         WHERE id = 1
         RETURNING
           id,
           enabled,
           title,
           message,
           suggested_amounts,
           min_amount_sum,
           updated_at
      `,
      [enabled, title, message, JSON.stringify(suggestedAmounts), minAmount]
    );

    return res.json({ ok: true, settings: rows[0] });
  } catch (e) {
    console.error("adminUpdateSupportSettings error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function adminSupportDonations(req, res) {
  try {
    await ensureProviderSupportSchema(pool);
    await syncProviderSupportDonationStatuses(pool);

    const limit = clampInt(req.query.limit, 100, 1, 500);
    const offset = clampInt(req.query.offset, 0, 0, 1000000);
    const status = cleanText(req.query.status, 40).toLowerCase();
    const q = cleanText(req.query.q, 200);

    const where = [];
    const args = [];
    let i = 1;

    if (status) {
      where.push(`d.status = $${i++}`);
      args.push(status);
    }

    if (q) {
      where.push(`(
        d.id::text ILIKE $${i}
        OR d.payme_order_id::text ILIKE $${i}
        OR d.payme_id ILIKE $${i}
        OR d.telegram_chat_id::text ILIKE $${i}
        OR p.name ILIKE $${i}
        OR p.phone ILIKE $${i}
      )`);
      args.push(`%${q}%`);
      i++;
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const hasPaymeTransactions =
      (await relationKind(pool, "payme_transactions")) !== null;

    const paymeJoin = hasPaymeTransactions
      ? `LEFT JOIN payme_transactions pt ON pt.order_id = d.payme_order_id`
      : `LEFT JOIN LATERAL (
           SELECT NULL::text AS payme_id,
                  NULL::int AS state,
                  NULL::bigint AS create_time,
                  NULL::bigint AS perform_time,
                  NULL::bigint AS cancel_time
         ) pt ON TRUE`;

    const totalsQ = await pool.query(
      `
        SELECT
          COUNT(*)::int AS count,
          COALESCE(SUM(CASE WHEN d.status = 'paid' THEN d.amount_tiyin ELSE 0 END), 0)::bigint AS paid_tiyin,
          COALESCE(SUM(CASE WHEN d.status IN ('new', 'created', 'pending') THEN d.amount_tiyin ELSE 0 END), 0)::bigint AS pending_tiyin,
          COALESCE(SUM(CASE WHEN d.status IN ('expired', 'canceled', 'cancelled') THEN d.amount_tiyin ELSE 0 END), 0)::bigint AS failed_tiyin
        FROM provider_support_donations d
        LEFT JOIN providers p ON p.id = d.provider_id
        ${whereSql}
      `,
      args
    );

    const rowsQ = await pool.query(
      `
        SELECT
          d.id,
          d.provider_id,
          p.name AS provider_name,
          p.phone AS provider_phone,
          d.telegram_chat_id,
          d.service_id,
          d.amount_tiyin,
          FLOOR(d.amount_tiyin / 100)::bigint AS amount_sum,
          d.payme_order_id,
          COALESCE(d.payme_id, pt.payme_id) AS payme_id,
          d.status,
          d.source,
          d.note,
          d.created_at,
          d.paid_at,
          d.cancelled_at,
          d.failed_at,
          d.expires_at,
          pt.state AS payme_state,
          pt.create_time,
          pt.perform_time,
          pt.cancel_time
        FROM provider_support_donations d
        LEFT JOIN providers p ON p.id = d.provider_id
        ${paymeJoin}
        ${whereSql}
        ORDER BY d.created_at DESC, d.id DESC
        LIMIT $${i++} OFFSET $${i++}
      `,
      [...args, limit, offset]
    );

    const paidTiyin = Number(totalsQ.rows[0]?.paid_tiyin || 0);
    const pendingTiyin = Number(totalsQ.rows[0]?.pending_tiyin || 0);
    const failedTiyin = Number(totalsQ.rows[0]?.failed_tiyin || 0);

    return res.json({
      ok: true,
      totals: {
        count: Number(totalsQ.rows[0]?.count || 0),
        paid_tiyin: paidTiyin,
        paid_sum: tiyinToSum(paidTiyin),
        pending_tiyin: pendingTiyin,
        pending_sum: tiyinToSum(pendingTiyin),
        failed_tiyin: failedTiyin,
        failed_sum: tiyinToSum(failedTiyin),
      },
      rows: rowsQ.rows,
      limit,
      offset,
    });
  } catch (e) {
    console.error("adminSupportDonations error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

module.exports = {
  ensureProviderSupportSchema,
  getProviderSupportSettings,
  createProviderSupportDonationOrder,
  expireOldProviderSupportOrders,
  syncProviderSupportDonationStatuses,
  publicSupportStatus,
  providerCreateSupportDonation,
  adminSupportSettings,
  adminUpdateSupportSettings,
  adminSupportDonations,
};
