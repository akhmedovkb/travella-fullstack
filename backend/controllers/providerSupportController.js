// backend/controllers/providerSupportController.js
const pool = require("../db");

function intOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function clampInt(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function cleanText(v, max = 5000) {
  return String(v ?? "").trim().slice(0, max);
}

function normalizeSuggestedAmounts(v) {
  const arr = Array.isArray(v) ? v : String(v || "")
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const nums = arr
    .map((x) => Math.trunc(Number(x)))
    .filter((x) => Number.isFinite(x) && x > 0)
    .slice(0, 12);

  return nums.length ? nums : [10000, 25000, 50000, 100000];
}

async function relationKind(db, relName) {
  const { rows } = await db.query(
    `SELECT c.relkind
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND c.relname=$1
      LIMIT 1`,
    [relName]
  );
  return rows[0]?.relkind || null;
}

async function ensureProviderSupportSchema(db = pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS provider_support_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      title TEXT NOT NULL DEFAULT '❤️ Поддержка проекта',
      message TEXT NOT NULL DEFAULT 'Если вы хотите поддержать развитие проекта Bot Otkaznyx Turov и Travella — можете отправить любую комфортную для вас сумму.',
      suggested_amounts JSONB NOT NULL DEFAULT '[10000,25000,50000,100000]'::jsonb,
      min_amount_sum INTEGER NOT NULL DEFAULT 1000,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
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
      status TEXT NOT NULL DEFAULT 'new',
      source TEXT NOT NULL DEFAULT 'telegram_provider_bot',
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at TIMESTAMPTZ NULL,
      cancelled_at TIMESTAMPTZ NULL
    )
  `);

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

  const topupKind = await relationKind(db, "topup_orders");
  const target = topupKind === "v" ? "payme_topup_orders" : "topup_orders";

  await db.query(`
    CREATE TABLE IF NOT EXISTS payme_topup_orders (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NOT NULL,
      amount_tiyin BIGINT NOT NULL CHECK (amount_tiyin > 0),
      provider TEXT NOT NULL DEFAULT 'payme',
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at TIMESTAMPTZ NULL
    )
  `);

  await db.query(`
    ALTER TABLE ${target}
      ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'payme',
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new',
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'client_topup',
      ADD COLUMN IF NOT EXISTS support_donation_id BIGINT NULL,
      ADD COLUMN IF NOT EXISTS provider_id BIGINT NULL,
      ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT NULL,
      ADD COLUMN IF NOT EXISTS note TEXT NULL
  `);

  if (topupKind === "v") {
    await db.query(`CREATE OR REPLACE VIEW topup_orders AS SELECT * FROM payme_topup_orders`);
  }
}

function buildPaymeCheckoutUrl({ merchantId, checkoutBase, orderId, amountTiyin, lang, callbackUrl }) {
  const parts = [
    `m=${merchantId}`,
    `ac.order_id=${orderId}`,
    `a=${amountTiyin}`,
    `l=${lang || "ru"}`,
  ];
  if (callbackUrl) parts.push(`c=${callbackUrl}`);
  const encoded = Buffer.from(parts.join(";"), "utf8").toString("base64");
  return `${String(checkoutBase || "https://checkout.paycom.uz").replace(/\/+$/, "")}/${encoded}`;
}

async function getProviderByTelegramChatId(db, telegramChatId) {
  const chat = String(telegramChatId || "").trim();
  if (!chat) return null;

  const { rows } = await db.query(
    `SELECT id, name, phone, type, telegram_chat_id, telegram_refused_chat_id
       FROM providers
      WHERE telegram_chat_id::text = $1
         OR telegram_refused_chat_id::text = $1
      ORDER BY id DESC
      LIMIT 1`,
    [chat]
  );
  return rows[0] || null;
}

async function getProviderSupportSettings(db = pool) {
  await ensureProviderSupportSchema(db);
  const { rows } = await db.query(
    `SELECT id, enabled, title, message, suggested_amounts, min_amount_sum, updated_at
       FROM provider_support_settings
      WHERE id = 1`
  );
  return rows[0] || null;
}

async function createProviderSupportDonationOrder({ telegramChatId, providerId = null, serviceId = null, amountSum, source = "telegram_provider_bot", note = null }) {
  const amount = Math.trunc(Number(amountSum));
  if (!Number.isFinite(amount) || amount <= 0) {
    const e = new Error("Bad support amount");
    e.status = 400;
    throw e;
  }

  const merchantId = process.env.PAYME_MERCHANT_ID || "";
  const checkoutBase = process.env.PAYME_CHECKOUT_URL || "https://checkout.paycom.uz";
  const sitePublic = process.env.SITE_PUBLIC_URL || process.env.SITE_URL || "https://travella.uz";

  if (!merchantId || !sitePublic) {
    const e = new Error("Payme is not configured");
    e.status = 500;
    throw e;
  }

  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await ensureProviderSupportSchema(db);

    const settings = await getProviderSupportSettings(db);
    if (!settings?.enabled) {
      const e = new Error("Provider support is disabled");
      e.status = 403;
      throw e;
    }

    const minAmount = Math.trunc(Number(settings.min_amount_sum || 0));
    if (minAmount > 0 && amount < minAmount) {
      const e = new Error(`Minimum support amount is ${minAmount}`);
      e.status = 400;
      throw e;
    }

    let resolvedProviderId = intOrNull(providerId);
    if (!resolvedProviderId && telegramChatId) {
      const provider = await getProviderByTelegramChatId(db, telegramChatId);
      resolvedProviderId = provider?.id ? Number(provider.id) : null;
    }

    const amountTiyin = amount * 100;

    const donationQ = await db.query(
      `INSERT INTO provider_support_donations
        (provider_id, telegram_chat_id, service_id, amount_tiyin, status, source, note)
       VALUES ($1,$2,$3,$4,'new',$5,$6)
       RETURNING *`,
      [resolvedProviderId, intOrNull(telegramChatId), intOrNull(serviceId), amountTiyin, source, note]
    );
    const donation = donationQ.rows[0];

    const orderQ = await db.query(
      `INSERT INTO topup_orders
        (client_id, amount_tiyin, provider, status, purpose, support_donation_id, provider_id, telegram_chat_id, note)
       VALUES (0, $1, 'payme', 'new', 'provider_support', $2, $3, $4, $5)
       RETURNING id, amount_tiyin, status, created_at`,
      [amountTiyin, Number(donation.id), resolvedProviderId, intOrNull(telegramChatId), note]
    );
    const order = orderQ.rows[0];

    await db.query(
      `UPDATE provider_support_donations
          SET payme_order_id = $2
        WHERE id = $1`,
      [Number(donation.id), Number(order.id)]
    );

    const callbackUrl = `${String(sitePublic).replace(/\/+$/, "")}/support/success?donation_id=${donation.id}&order_id=${order.id}`;
    const pay_url = buildPaymeCheckoutUrl({
      merchantId,
      checkoutBase,
      orderId: Number(order.id),
      amountTiyin,
      lang: "ru",
      callbackUrl,
    });

    await db.query("COMMIT");

    return {
      ok: true,
      donation: {
        id: Number(donation.id),
        provider_id: resolvedProviderId,
        telegram_chat_id: intOrNull(telegramChatId),
        service_id: intOrNull(serviceId),
        amount_tiyin: amountTiyin,
        amount_sum: amount,
        status: "new",
      },
      order: {
        id: Number(order.id),
        amount_tiyin: amountTiyin,
        amount_sum: amount,
        status: order.status,
      },
      pay_url,
    };
  } catch (e) {
    try { await db.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    db.release();
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
    const message = cleanText(req.body?.message, 2000) || "Если вы хотите поддержать развитие проекта Bot Otkaznyx Turov и Travella — можете отправить любую комфортную для вас сумму.";
    const suggestedAmounts = normalizeSuggestedAmounts(req.body?.suggested_amounts);
    const minAmount = clampInt(req.body?.min_amount_sum, 1000, 1, 100000000);

    const { rows } = await pool.query(
      `UPDATE provider_support_settings
          SET enabled = $1,
              title = $2,
              message = $3,
              suggested_amounts = $4::jsonb,
              min_amount_sum = $5,
              updated_at = now()
        WHERE id = 1
        RETURNING id, enabled, title, message, suggested_amounts, min_amount_sum, updated_at`,
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

    const totalsQ = await pool.query(
      `SELECT
         COUNT(*)::int AS count,
         COALESCE(SUM(CASE WHEN d.status='paid' THEN d.amount_tiyin ELSE 0 END),0)::bigint AS paid_tiyin,
         COALESCE(SUM(CASE WHEN d.status IN ('new','created') THEN d.amount_tiyin ELSE 0 END),0)::bigint AS pending_tiyin
       FROM provider_support_donations d
       LEFT JOIN providers p ON p.id = d.provider_id
       ${whereSql}`,
      args
    );

    const rowsQ = await pool.query(
      `SELECT
         d.id,
         d.provider_id,
         p.name AS provider_name,
         p.phone AS provider_phone,
         d.telegram_chat_id,
         d.service_id,
         d.amount_tiyin,
         FLOOR(d.amount_tiyin / 100)::bigint AS amount_sum,
         d.payme_order_id,
         d.payme_id,
         d.status,
         d.source,
         d.note,
         d.created_at,
         d.paid_at,
         d.cancelled_at,
         pt.state AS payme_state,
         pt.create_time,
         pt.perform_time,
         pt.cancel_time
       FROM provider_support_donations d
       LEFT JOIN providers p ON p.id = d.provider_id
       LEFT JOIN payme_transactions pt ON pt.order_id = d.payme_order_id
       ${whereSql}
       ORDER BY d.created_at DESC, d.id DESC
       LIMIT $${i++} OFFSET $${i++}`,
      [...args, limit, offset]
    );

    return res.json({
      ok: true,
      totals: {
        count: Number(totalsQ.rows[0]?.count || 0),
        paid_tiyin: Number(totalsQ.rows[0]?.paid_tiyin || 0),
        paid_sum: Math.trunc(Number(totalsQ.rows[0]?.paid_tiyin || 0) / 100),
        pending_tiyin: Number(totalsQ.rows[0]?.pending_tiyin || 0),
        pending_sum: Math.trunc(Number(totalsQ.rows[0]?.pending_tiyin || 0) / 100),
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
  adminSupportSettings,
  adminUpdateSupportSettings,
  adminSupportDonations,
};
