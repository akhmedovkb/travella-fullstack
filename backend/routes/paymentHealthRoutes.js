// backend/routes/paymentHealthRoutes.js

const express = require("express");
const pool = require("../db");
const { getClickConfig, isClickConfigured, ensureClickTables } = require("../utils/clickMerchant");
const { getTelegramHealth } = require("../utils/telegram");

const router = express.Router();

function readJobToken(req) {
  return (
    req.headers["x-admin-job-token"] ||
    req.headers["x-job-token"] ||
    req.headers["x-cron-token"] ||
    req.query?.token ||
    ""
  );
}

function checkJobToken(req) {
  const expected =
    process.env.ADMIN_JOB_TOKEN ||
    process.env.ADMIN_JOBS_TOKEN ||
    process.env.CRON_JOB_TOKEN ||
    process.env.JOB_TOKEN ||
    "";

  if (!expected) return { ok: false, reason: "ADMIN_JOB_TOKEN is not set" };

  const got = String(readJobToken(req) || "");
  if (!got) return { ok: false, reason: "missing token" };
  if (got.length !== expected.length) return { ok: false, reason: "bad token" };

  let same = 0;
  for (let i = 0; i < expected.length; i += 1) {
    same |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  }

  if (same !== 0) return { ok: false, reason: "bad token" };
  return { ok: true };
}

function maskConfig(value) {
  const s = String(value || "").trim();
  if (!s) return { present: false };
  return {
    present: true,
    length: s.length,
    suffix: s.length > 4 ? s.slice(-4) : "****",
  };
}

async function tableExists(db, tableName) {
  const { rows } = await db.query(`SELECT to_regclass($1) AS reg`, [`public.${tableName}`]);
  return !!rows[0]?.reg;
}

async function countSafe(db, sql, params = []) {
  try {
    const { rows } = await db.query(sql, params);
    return Number(rows[0]?.count || 0);
  } catch (e) {
    return null;
  }
}

// GET /api/_debug/payment-health?probe=1&token=...
// or header: x-admin-job-token: <ADMIN_JOB_TOKEN>
router.get("/payment-health", async (req, res) => {
  const chk = checkJobToken(req);
  if (!chk.ok) return res.status(403).json({ ok: false, error: chk.reason });

  const probe = String(req.query?.probe || "") === "1";
  const db = await pool.connect();

  const result = {
    ok: true,
    checked_at: new Date().toISOString(),
    db: { ok: false },
    telegram: null,
    payme: {
      configured: Boolean(
        (process.env.PAYME_MERCHANT_LOGIN || process.env.PAYME_LOGIN) &&
          (process.env.PAYME_MERCHANT_KEY || process.env.PAYME_KEY) &&
          (process.env.PAYME_MERCHANT_ID || process.env.PAYME_CHECKOUT_ID)
      ),
      env: {
        login: maskConfig(process.env.PAYME_MERCHANT_LOGIN || process.env.PAYME_LOGIN),
        key: maskConfig(process.env.PAYME_MERCHANT_KEY || process.env.PAYME_KEY),
        merchant_id: maskConfig(process.env.PAYME_MERCHANT_ID || process.env.PAYME_CHECKOUT_ID),
      },
      tables: {},
      counts: {},
    },
    click: {
      bot_configured: isClickConfigured("bot"),
      web_configured: isClickConfigured("web"),
      bot_env: {},
      web_env: {},
      tables: {},
      counts: {},
    },
  };

  try {
    const ping = await db.query("SELECT NOW() AS now");
    result.db = { ok: true, now: ping.rows[0]?.now || null };

    const botCfg = getClickConfig("bot");
    const webCfg = getClickConfig("web");
    result.click.bot_env = {
      service_id: maskConfig(botCfg.serviceId),
      merchant_id: maskConfig(botCfg.merchantId),
      merchant_user_id: maskConfig(botCfg.merchantUserId),
      secret_key: maskConfig(botCfg.secretKey),
    };
    result.click.web_env = {
      service_id: maskConfig(webCfg.serviceId),
      merchant_id: maskConfig(webCfg.merchantId),
      merchant_user_id: maskConfig(webCfg.merchantUserId),
      secret_key: maskConfig(webCfg.secretKey),
    };

    // Schema checks are safe and idempotent.
    await ensureClickTables(db).catch((e) => {
      result.click.schema_error = e?.message || String(e);
    });

    for (const table of ["topup_orders", "payme_transactions", "payme_events", "payme_ledger_effects"]) {
      result.payme.tables[table] = await tableExists(db, table);
    }
    for (const table of ["click_orders", "click_events"]) {
      result.click.tables[table] = await tableExists(db, table);
    }

    result.payme.counts.pending_orders = await countSafe(
      db,
      `SELECT COUNT(*) FROM topup_orders WHERE provider='payme' AND status IN ('created','pending')`
    );
    result.payme.counts.stale_pending_orders = await countSafe(
      db,
      `SELECT COUNT(*) FROM topup_orders WHERE provider='payme' AND status IN ('created','pending') AND expires_at IS NOT NULL AND expires_at < NOW()`
    );
    result.payme.counts.paid_without_unlock = await countSafe(
      db,
      `SELECT COUNT(*)
         FROM topup_orders o
         LEFT JOIN client_service_contact_unlocks u
           ON u.client_id=o.client_id AND u.service_id=o.service_id
        WHERE o.provider='payme'
          AND o.order_type='unlock_contact'
          AND o.status='paid'
          AND o.service_id IS NOT NULL
          AND u.id IS NULL`
    );

    result.click.counts.pending_orders = await countSafe(
      db,
      `SELECT COUNT(*) FROM click_orders WHERE status IN ('created','invoice_created','prepared')`
    );
    result.click.counts.stale_pending_orders = await countSafe(
      db,
      `SELECT COUNT(*) FROM click_orders WHERE status IN ('created','invoice_created','prepared') AND expires_at IS NOT NULL AND expires_at < NOW()`
    );
    result.click.counts.invoice_errors = await countSafe(
      db,
      `SELECT COUNT(*) FROM click_orders WHERE status='invoice_error'`
    );
    result.click.counts.paid_without_unlock = await countSafe(
      db,
      `SELECT COUNT(*)
         FROM click_orders c
         LEFT JOIN client_service_contact_unlocks u
           ON u.client_id=c.actor_id AND u.service_id=c.service_id
        WHERE c.order_type='unlock_contact'
          AND c.status='paid'
          AND c.actor_role='client'
          AND c.service_id IS NOT NULL
          AND u.id IS NULL`
    );

    result.telegram = await getTelegramHealth({ probe }).catch((e) => ({ ok: false, error: e?.message || String(e) }));

    const critical = [];
    if (!result.db.ok) critical.push("db");
    if (!result.payme.configured) critical.push("payme_env");
    if (!result.click.bot_configured && !result.click.web_configured) critical.push("click_env");
    if (result.payme.counts.paid_without_unlock > 0) critical.push("payme_paid_without_unlock");
    if (result.click.counts.paid_without_unlock > 0) critical.push("click_paid_without_unlock");

    result.ok = critical.length === 0;
    result.critical = critical;
    return res.status(result.ok ? 200 : 207).json(result);
  } catch (e) {
    console.error("[payment-health] error:", e?.message || e);
    return res.status(500).json({ ok: false, error: e?.message || "payment_health_failed", partial: result });
  } finally {
    db.release();
  }
});

module.exports = router;
