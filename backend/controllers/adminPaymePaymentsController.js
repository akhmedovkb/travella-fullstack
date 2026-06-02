// backend/controllers/adminPaymePaymentsController.js

const pool = require("../db");
const {
  ensureAbandonedPaymeShape,
  expireCreatedPaymeOrders,
  runAbandonedPaymeReminderJob,
} = require("../jobs/abandonedPaymeReminderJob");

function clampInt(x, def, min, max) {
  const n = Number(x);
  if (!Number.isFinite(n)) return def;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function cleanFilter(v) {
  return String(v || "").trim().toLowerCase();
}

async function relationExists(name) {
  const r = await pool.query(
    `
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = $1
     LIMIT 1
    `,
    [String(name)]
  );
  return !!r.rowCount;
}

async function columnExists(table, column) {
  const r = await pool.query(
    `
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_name = $2
     LIMIT 1
    `,
    [String(table), String(column)]
  );
  return !!r.rowCount;
}

function sqlText(value) {
  return String(value || "").replace(/'/g, "''");
}

function paymeStateSql(expr) {
  return `CASE
    WHEN ${expr} = 2 THEN 'success'
    WHEN ${expr} = 1 THEN 'created'
    WHEN ${expr} = -1 THEN 'canceled'
    WHEN ${expr} = -2 THEN 'refund'
    ELSE COALESCE(${expr}::text, 'unknown')
  END`;
}

function normalizeStateFilter(v) {
  const s = cleanFilter(v);
  if (!s || s === "all") return "";
  if (["2", "success", "performed", "paid"].includes(s)) return "success";
  if (["1", "created", "pending", "new"].includes(s)) return "created";
  if (["-1", "cancel", "canceled", "cancelled"].includes(s)) return "canceled";
  if (["-2", "refund", "refunded"].includes(s)) return "refund";
  if (["failed", "error"].includes(s)) return "failed";
  if (["expired", "expire"].includes(s)) return "expired";
  return s;
}

function buildWebPaymeUnion() {
  return `
    SELECT
      ('payme:' || pt.payme_id)::text AS row_id,
      'web_payme'::text AS source,
      COALESCE(NULLIF(o.order_type, ''), NULLIF(o.purpose, ''), 'payme')::text AS payment_type,
      CASE
        WHEN o.provider_id IS NOT NULL THEN 'provider'
        WHEN o.client_id IS NOT NULL THEN 'client'
        ELSE 'unknown'
      END::text AS actor_role,
      o.client_id::bigint AS client_id,
      o.provider_id::bigint AS provider_id,
      COALESCE(c.name, p.name, '—')::text AS actor_name,
      COALESCE(c.phone, p.phone, '—')::text AS actor_phone,
      o.service_id::bigint AS service_id,
      s.title::text AS service_title,
      (pt.amount_tiyin / 100.0)::numeric AS amount,
      pt.amount_tiyin::bigint AS amount_tiyin,
      ${paymeStateSql("pt.state")} AS state,
      pt.created_at AS created_at,
      CASE
        WHEN pt.perform_time IS NOT NULL AND pt.perform_time > 0
          THEN to_timestamp(pt.perform_time / 1000.0)
        ELSE o.paid_at
      END AS performed_at,
      pt.payme_id::text AS payme_id,
      NULL::text AS telegram_payment_charge_id,
      NULL::text AS provider_payment_charge_id,
      pt.order_id::bigint AS order_id,
      pt.state::text AS raw_status,
      COALESCE(o.reminder_count, 0)::int AS reminder_count,
      o.last_reminder_sent_at AS last_reminder_sent_at,
      o.expired_at AS expired_at,
      jsonb_build_object(
        'table', 'payme_transactions',
        'provider', o.provider,
        'purpose', o.purpose,
        'order_status', o.status,
        'payme_state', pt.state,
        'support_donation_id', o.support_donation_id
      ) AS meta
    FROM payme_transactions pt
    LEFT JOIN topup_orders o ON o.id = pt.order_id
    LEFT JOIN clients c ON c.id = o.client_id
    LEFT JOIN providers p ON p.id = o.provider_id
    LEFT JOIN services s ON s.id = o.service_id
  `;
}

function buildOrdersWithoutTxUnion() {
  return `
    SELECT
      ('order:' || o.id)::text AS row_id,
      'web_payme'::text AS source,
      COALESCE(NULLIF(o.order_type, ''), NULLIF(o.purpose, ''), 'order')::text AS payment_type,
      CASE
        WHEN o.provider_id IS NOT NULL THEN 'provider'
        WHEN o.client_id IS NOT NULL THEN 'client'
        ELSE 'unknown'
      END::text AS actor_role,
      o.client_id::bigint AS client_id,
      o.provider_id::bigint AS provider_id,
      COALESCE(c.name, p.name, '—')::text AS actor_name,
      COALESCE(c.phone, p.phone, '—')::text AS actor_phone,
      o.service_id::bigint AS service_id,
      s.title::text AS service_title,
      (COALESCE(o.amount_tiyin, o.amount, 0) / 100.0)::numeric AS amount,
      COALESCE(o.amount_tiyin, o.amount, 0)::bigint AS amount_tiyin,
      CASE
        WHEN LOWER(COALESCE(o.status, 'created')) IN ('paid', 'success', 'performed') THEN 'success'
        WHEN LOWER(COALESCE(o.status, 'created')) IN ('canceled', 'cancelled', 'cancel') THEN 'canceled'
        WHEN LOWER(COALESCE(o.status, 'created')) IN ('expired') THEN 'expired'
        WHEN LOWER(COALESCE(o.status, 'created')) IN ('failed', 'error') THEN 'failed'
        ELSE LOWER(COALESCE(o.status, 'created'))
      END::text AS state,
      o.created_at AS created_at,
      o.paid_at AS performed_at,
      o.payme_transaction_id::text AS payme_id,
      NULL::text AS telegram_payment_charge_id,
      NULL::text AS provider_payment_charge_id,
      o.id::bigint AS order_id,
      o.status::text AS raw_status,
      COALESCE(o.reminder_count, 0)::int AS reminder_count,
      o.last_reminder_sent_at AS last_reminder_sent_at,
      o.expired_at AS expired_at,
      jsonb_build_object(
        'table', 'topup_orders',
        'provider', o.provider,
        'purpose', o.purpose,
        'support_donation_id', o.support_donation_id,
        'expires_at', o.expires_at,
        'reminder_count', COALESCE(o.reminder_count, 0),
        'last_reminder_sent_at', o.last_reminder_sent_at
      ) AS meta
    FROM topup_orders o
    LEFT JOIN clients c ON c.id = o.client_id
    LEFT JOIN providers p ON p.id = o.provider_id
    LEFT JOIN services s ON s.id = o.service_id
    WHERE NOT EXISTS (
      SELECT 1 FROM payme_transactions pt WHERE pt.order_id = o.id
    )
  `;
}

function buildTelegramPaymentsUnion() {
  return `
    SELECT
      ('telegram:' || tp.id)::text AS row_id,
      'telegram'::text AS source,
      COALESCE(NULLIF(tp.payment_type, ''), 'telegram_payment')::text AS payment_type,
      CASE
        WHEN tp.client_id IS NOT NULL THEN 'client'
        ELSE 'unknown'
      END::text AS actor_role,
      tp.client_id::bigint AS client_id,
      NULL::bigint AS provider_id,
      COALESCE(c.name, '—')::text AS actor_name,
      COALESCE(c.phone, '—')::text AS actor_phone,
      tp.service_id::bigint AS service_id,
      s.title::text AS service_title,
      COALESCE(tp.amount_sum, tp.amount_minor / 100.0)::numeric AS amount,
      COALESCE(tp.amount_minor, tp.amount_sum * 100, 0)::bigint AS amount_tiyin,
      CASE
        WHEN LOWER(COALESCE(tp.status, 'created')) IN ('paid', 'success', 'processed', 'unlocked') THEN 'success'
        WHEN LOWER(COALESCE(tp.status, 'created')) IN ('canceled', 'cancelled') THEN 'canceled'
        WHEN LOWER(COALESCE(tp.status, 'created')) IN ('failed', 'error') THEN 'failed'
        ELSE LOWER(COALESCE(tp.status, 'created'))
      END::text AS state,
      tp.created_at AS created_at,
      tp.processed_at AS performed_at,
      NULL::text AS payme_id,
      tp.telegram_payment_charge_id::text AS telegram_payment_charge_id,
      tp.provider_payment_charge_id::text AS provider_payment_charge_id,
      NULL::bigint AS order_id,
      tp.status::text AS raw_status,
      0::int AS reminder_count,
      NULL::timestamptz AS last_reminder_sent_at,
      NULL::timestamptz AS expired_at,
      jsonb_build_object(
        'table', 'telegram_payments',
        'currency', tp.currency,
        'invoice_payload', tp.invoice_payload,
        'error', tp.error,
        'meta', tp.meta
      ) AS meta
    FROM telegram_payments tp
    LEFT JOIN clients c ON c.id = tp.client_id
    LEFT JOIN services s ON s.id = tp.service_id
  `;
}

function buildSupportDonationOnlyUnion() {
  return `
    SELECT
      ('support:' || d.id)::text AS row_id,
      COALESCE(NULLIF(d.source, ''), 'provider_support')::text AS source,
      'provider_support'::text AS payment_type,
      'provider'::text AS actor_role,
      NULL::bigint AS client_id,
      d.provider_id::bigint AS provider_id,
      COALESCE(p.name, '—')::text AS actor_name,
      COALESCE(p.phone, '—')::text AS actor_phone,
      d.service_id::bigint AS service_id,
      s.title::text AS service_title,
      (d.amount_tiyin / 100.0)::numeric AS amount,
      d.amount_tiyin::bigint AS amount_tiyin,
      CASE
        WHEN LOWER(COALESCE(d.status, 'created')) IN ('paid', 'success') THEN 'success'
        WHEN LOWER(COALESCE(d.status, 'created')) IN ('canceled', 'cancelled') THEN 'canceled'
        WHEN LOWER(COALESCE(d.status, 'created')) IN ('expired') THEN 'expired'
        WHEN LOWER(COALESCE(d.status, 'created')) IN ('failed') THEN 'failed'
        ELSE LOWER(COALESCE(d.status, 'created'))
      END::text AS state,
      d.created_at AS created_at,
      d.paid_at AS performed_at,
      d.payme_id::text AS payme_id,
      NULL::text AS telegram_payment_charge_id,
      NULL::text AS provider_payment_charge_id,
      d.payme_order_id::bigint AS order_id,
      d.status::text AS raw_status,
      COALESCE(d.reminder_count, 0)::int AS reminder_count,
      d.last_reminder_sent_at AS last_reminder_sent_at,
      d.expired_at AS expired_at,
      jsonb_build_object(
        'table', 'provider_support_donations',
        'donation_id', d.id,
        'telegram_chat_id', d.telegram_chat_id,
        'note', d.note,
        'expires_at', d.expires_at
      ) AS meta
    FROM provider_support_donations d
    LEFT JOIN providers p ON p.id = d.provider_id
    LEFT JOIN services s ON s.id = d.service_id
    WHERE d.payme_order_id IS NULL
  `;
}

async function adminPaymePayments(req, res) {
  try {
    const limit = clampInt(req.query.limit, 200, 1, 1000);
    const q = String(req.query.q || "").trim();
    const state = normalizeStateFilter(req.query.state);
    const type = cleanFilter(req.query.type);
    const source = cleanFilter(req.query.source);

    await ensureAbandonedPaymeShape(pool);

    const hasPaymeTransactions = await relationExists("payme_transactions");
    const hasTopupOrders = await relationExists("topup_orders");
    const hasTelegramPayments = await relationExists("telegram_payments");
    const hasSupportDonations = await relationExists("provider_support_donations");

    const unions = [];

    if (hasPaymeTransactions && hasTopupOrders) unions.push(buildWebPaymeUnion());
    if (hasTopupOrders) unions.push(buildOrdersWithoutTxUnion());
    if (hasTelegramPayments) unions.push(buildTelegramPaymentsUnion());
    if (hasSupportDonations) unions.push(buildSupportDonationOnlyUnion());

    if (!unions.length) return res.json({ success: true, rows: [], totals: {} });

    const where = [];
    const args = [];
    let idx = 1;

    if (q) {
      where.push(`(
        row_id ILIKE $${idx}
        OR COALESCE(actor_name, '') ILIKE $${idx}
        OR COALESCE(actor_phone, '') ILIKE $${idx}
        OR COALESCE(service_title, '') ILIKE $${idx}
        OR COALESCE(payme_id, '') ILIKE $${idx}
        OR COALESCE(telegram_payment_charge_id, '') ILIKE $${idx}
        OR COALESCE(provider_payment_charge_id, '') ILIKE $${idx}
        OR CAST(COALESCE(client_id, 0) AS TEXT) ILIKE $${idx}
        OR CAST(COALESCE(provider_id, 0) AS TEXT) ILIKE $${idx}
        OR CAST(COALESCE(order_id, 0) AS TEXT) ILIKE $${idx}
      )`);
      args.push(`%${q}%`);
      idx++;
    }

    if (state) {
      where.push(`state = $${idx}`);
      args.push(state);
      idx++;
    }

    if (type && type !== "all") {
      if (type === "unlock") where.push(`payment_type IN ('unlock_contact', 'telegram_unlock_contact')`);
      else if (type === "topup") where.push(`payment_type IN ('balance_topup', 'client_topup', 'contact_topup')`);
      else if (type === "support") where.push(`payment_type = 'provider_support'`);
      else {
        where.push(`payment_type = $${idx}`);
        args.push(type);
        idx++;
      }
    }

    if (source && source !== "all") {
      if (source === "web") where.push(`source IN ('web_payme', 'payme', 'web')`);
      else if (source === "telegram") where.push(`source ILIKE '%telegram%'`);
      else {
        where.push(`source = $${idx}`);
        args.push(source);
        idx++;
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const baseSql = `
      WITH unified AS (
        ${unions.join("\nUNION ALL\n")}
      ), filtered AS (
        SELECT * FROM unified
        ${whereSql}
      )
    `;

    const rowsQ = await pool.query(
      `
      ${baseSql}
      SELECT *
        FROM filtered
       ORDER BY created_at DESC NULLS LAST, row_id DESC
       LIMIT $${idx}
      `,
      [...args, limit]
    );

    const totalsQ = await pool.query(
      `
      ${baseSql}
      SELECT
        COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE state = 'success')::int AS success_count,
        COUNT(*) FILTER (WHERE state IN ('created', 'pending', 'new'))::int AS pending_count,
        COUNT(*) FILTER (WHERE state IN ('created', 'pending', 'new') AND COALESCE(reminder_count, 0) > 0)::int AS abandoned_count,
        COUNT(*) FILTER (WHERE state = 'expired')::int AS expired_count,
        COUNT(*) FILTER (WHERE state IN ('failed', 'canceled', 'refund'))::int AS failed_count,
        COALESCE(SUM(CASE WHEN state = 'success' THEN amount ELSE 0 END), 0)::numeric AS success_amount,
        COALESCE(SUM(amount), 0)::numeric AS total_amount
      FROM filtered
      `,
      args
    );

    return res.json({
      success: true,
      rows: rowsQ.rows || [],
      totals: totalsQ.rows?.[0] || {},
      sources: {
        payme_transactions: hasPaymeTransactions,
        topup_orders: hasTopupOrders,
        telegram_payments: hasTelegramPayments,
        provider_support_donations: hasSupportDonations,
      },
    });
  } catch (e) {
    console.error("[adminPaymePayments] error:", e);
    return res.status(500).json({ success: false, error: "Internal error" });
  }
}


async function expireAbandonedPaymePayments(req, res) {
  try {
    const result = await expireCreatedPaymeOrders();
    return res.json({ success: true, ...result });
  } catch (e) {
    console.error("[expireAbandonedPaymePayments] error:", e);
    return res.status(500).json({ success: false, error: "Internal error" });
  }
}

async function sendAbandonedPaymeReminders(req, res) {
  try {
    const limit = clampInt(req.body?.limit || req.query?.limit, 100, 1, 200);
    const dryRun = String(req.body?.dryRun || req.query?.dryRun || "").toLowerCase() === "true";
    const result = await runAbandonedPaymeReminderJob({ limit, dryRun });
    return res.json({ success: true, ...result });
  } catch (e) {
    console.error("[sendAbandonedPaymeReminders] error:", e);
    return res.status(500).json({ success: false, error: "Internal error" });
  }
}

module.exports = {
  adminPaymePayments,
  expireAbandonedPaymePayments,
  sendAbandonedPaymeReminders,
};
