// backend/controllers/adminPaymePaymentsController.js

const pool = require("../db");
const telegram = require("../utils/telegram");
const {
  ensureRecoveryColumns,
  expireOldPaymeOrders,
  sendDuePaymeReminders,
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

function normalizeStateFilter(v) {
  const s = cleanFilter(v);
  if (!s || s === "all") return "";
  if (["2", "success", "performed", "paid"].includes(s)) return "success";
  if (["1", "created", "pending", "new"].includes(s)) return "created";
  if (["-1", "cancel", "canceled", "cancelled"].includes(s)) return "canceled";
  if (["-2", "refund", "refunded"].includes(s)) return "refund";
  if (["failed", "error", "expired"].includes(s)) return "failed";
  return s;
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

function orderStateSql(expr) {
  return `CASE
    WHEN LOWER(COALESCE(${expr}, 'created')) IN ('paid', 'success', 'performed') THEN 'success'
    WHEN LOWER(COALESCE(${expr}, 'created')) IN ('canceled', 'cancelled', 'cancel') THEN 'canceled'
    WHEN LOWER(COALESCE(${expr}, 'created')) IN ('failed', 'error', 'expired') THEN 'failed'
    WHEN LOWER(COALESCE(${expr}, 'created')) IN ('pending') THEN 'pending'
    WHEN LOWER(COALESCE(${expr}, 'created')) IN ('new') THEN 'new'
    ELSE LOWER(COALESCE(${expr}, 'created'))
  END`;
}

function buildWebPaymeUnion() {
  return `
    SELECT
      ('payme:' || pt.payme_id)::text AS row_id,
      'web_payme'::text AS source,
      COALESCE(NULLIF(o.order_type, ''), NULLIF(o.purpose, ''), 'payme')::text AS payment_type,
      CASE
        WHEN NULLIF(to_jsonb(o)->>'actor_role', '') IS NOT NULL
          THEN NULLIF(to_jsonb(o)->>'actor_role', '')
        WHEN o.provider_id IS NOT NULL THEN 'provider'
        WHEN o.client_id IS NOT NULL THEN 'client'
        ELSE 'unknown'
      END::text AS actor_role,
      CASE WHEN COALESCE(NULLIF(to_jsonb(o)->>'actor_role', ''),
                         CASE WHEN o.provider_id IS NOT NULL THEN 'provider' ELSE 'client' END) = 'client'
        THEN COALESCE(NULLIF(to_jsonb(o)->>'actor_id', '')::bigint, o.client_id)
      END::bigint AS client_id,
      COALESCE(
        o.provider_id,
        CASE WHEN COALESCE(NULLIF(to_jsonb(o)->>'actor_role', ''), 'provider') <> 'client'
          THEN NULLIF(to_jsonb(o)->>'actor_id', '')::bigint
        END
      )::bigint AS provider_id,
      CASE WHEN to_jsonb(o)->>'actor_role' = 'client'
        THEN COALESCE(c.name, '—') ELSE COALESCE(p.name, c.name, '—')
      END::text AS actor_name,
      CASE WHEN to_jsonb(o)->>'actor_role' = 'client'
        THEN COALESCE(c.phone, '—') ELSE COALESCE(p.phone, c.phone, '—')
      END::text AS actor_phone,
      o.service_id::bigint AS service_id,
      s.title::text AS service_title,
      NULLIF(to_jsonb(o)->>'booking_id', '')::bigint AS booking_id,
      hb.status::text AS booking_status,
      NULLIF(to_jsonb(hb)->>'refund_status', '')::text AS booking_refund_status,
      hb.provider_price::numeric AS booking_amount,
      hb.currency::text AS booking_currency,
      hp.name::text AS booking_provider_name,
      ARRAY_TO_STRING(ARRAY(
        SELECT bd.date::text FROM booking_dates bd
         WHERE bd.booking_id = hb.id ORDER BY bd.date
      ), ', ')::text AS booking_dates,
      (pt.amount_tiyin / 100.0)::numeric AS amount,
      pt.amount_tiyin::bigint AS amount_tiyin,
      ${paymeStateSql("pt.state")} AS state,
      o.status::text AS order_state,
      COALESCE(o.reminder_count, 0)::int AS reminder_count,
      o.last_reminder_sent_at AS last_reminder_sent_at,
      COALESCE(c.is_test_account, false) OR COALESCE(p.is_test_account, false) AS is_test_account,
      o.created_at AS created_at,
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
      jsonb_build_object(
        'table', 'payme_transactions',
        'provider', o.provider,
        'purpose', o.purpose,
        'order_status', o.status,
        'payme_state', pt.state,
        'booking_id', NULLIF(to_jsonb(o)->>'booking_id', '')::bigint,
        'support_donation_id', o.support_donation_id,
        'expires_at', o.expires_at
      ) AS meta
    FROM payme_transactions pt
    LEFT JOIN topup_orders o ON o.id = pt.order_id
    LEFT JOIN clients c ON c.id = o.client_id
    LEFT JOIN providers p ON p.id = COALESCE(
      o.provider_id,
      CASE WHEN COALESCE(NULLIF(to_jsonb(o)->>'actor_role', ''), 'provider') <> 'client'
        THEN NULLIF(to_jsonb(o)->>'actor_id', '')::bigint
      END
    )
    LEFT JOIN services s ON s.id = o.service_id
    LEFT JOIN bookings hb ON hb.id = NULLIF(to_jsonb(o)->>'booking_id', '')::bigint
    LEFT JOIN providers hp ON hp.id = hb.provider_id
  `;
}

function buildOrdersWithoutTxUnion() {
  return `
    SELECT
      ('order:' || o.id)::text AS row_id,
      'web_payme'::text AS source,
      COALESCE(NULLIF(o.order_type, ''), NULLIF(o.purpose, ''), 'order')::text AS payment_type,
      CASE
        WHEN NULLIF(to_jsonb(o)->>'actor_role', '') IS NOT NULL
          THEN NULLIF(to_jsonb(o)->>'actor_role', '')
        WHEN o.provider_id IS NOT NULL THEN 'provider'
        WHEN o.client_id IS NOT NULL THEN 'client'
        ELSE 'unknown'
      END::text AS actor_role,
      CASE WHEN COALESCE(NULLIF(to_jsonb(o)->>'actor_role', ''),
                         CASE WHEN o.provider_id IS NOT NULL THEN 'provider' ELSE 'client' END) = 'client'
        THEN COALESCE(NULLIF(to_jsonb(o)->>'actor_id', '')::bigint, o.client_id)
      END::bigint AS client_id,
      COALESCE(
        o.provider_id,
        CASE WHEN COALESCE(NULLIF(to_jsonb(o)->>'actor_role', ''), 'provider') <> 'client'
          THEN NULLIF(to_jsonb(o)->>'actor_id', '')::bigint
        END
      )::bigint AS provider_id,
      CASE WHEN to_jsonb(o)->>'actor_role' = 'client'
        THEN COALESCE(c.name, '—') ELSE COALESCE(p.name, c.name, '—')
      END::text AS actor_name,
      CASE WHEN to_jsonb(o)->>'actor_role' = 'client'
        THEN COALESCE(c.phone, '—') ELSE COALESCE(p.phone, c.phone, '—')
      END::text AS actor_phone,
      o.service_id::bigint AS service_id,
      s.title::text AS service_title,
      NULLIF(to_jsonb(o)->>'booking_id', '')::bigint AS booking_id,
      hb.status::text AS booking_status,
      NULLIF(to_jsonb(hb)->>'refund_status', '')::text AS booking_refund_status,
      hb.provider_price::numeric AS booking_amount,
      hb.currency::text AS booking_currency,
      hp.name::text AS booking_provider_name,
      ARRAY_TO_STRING(ARRAY(
        SELECT bd.date::text FROM booking_dates bd
         WHERE bd.booking_id = hb.id ORDER BY bd.date
      ), ', ')::text AS booking_dates,
      (COALESCE(o.amount_tiyin, o.amount, 0) / 100.0)::numeric AS amount,
      COALESCE(o.amount_tiyin, o.amount, 0)::bigint AS amount_tiyin,
      ${orderStateSql("o.status")} AS state,
      o.status::text AS order_state,
      COALESCE(o.reminder_count, 0)::int AS reminder_count,
      o.last_reminder_sent_at AS last_reminder_sent_at,
      COALESCE(c.is_test_account, false) OR COALESCE(p.is_test_account, false) AS is_test_account,
      o.created_at AS created_at,
      o.paid_at AS performed_at,
      o.payme_transaction_id::text AS payme_id,
      NULL::text AS telegram_payment_charge_id,
      NULL::text AS provider_payment_charge_id,
      o.id::bigint AS order_id,
      o.status::text AS raw_status,
      jsonb_build_object(
        'table', 'topup_orders',
        'provider', o.provider,
        'purpose', o.purpose,
        'booking_id', NULLIF(to_jsonb(o)->>'booking_id', '')::bigint,
        'support_donation_id', o.support_donation_id,
        'expires_at', o.expires_at,
        'pay_url', o.pay_url
      ) AS meta
    FROM topup_orders o
    LEFT JOIN clients c ON c.id = o.client_id
    LEFT JOIN providers p ON p.id = COALESCE(
      o.provider_id,
      CASE WHEN COALESCE(NULLIF(to_jsonb(o)->>'actor_role', ''), 'provider') <> 'client'
        THEN NULLIF(to_jsonb(o)->>'actor_id', '')::bigint
      END
    )
    LEFT JOIN services s ON s.id = o.service_id
    LEFT JOIN bookings hb ON hb.id = NULLIF(to_jsonb(o)->>'booking_id', '')::bigint
    LEFT JOIN providers hp ON hp.id = hb.provider_id
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
      NULL::bigint AS booking_id,
      NULL::text AS booking_status,
      NULL::text AS booking_refund_status,
      NULL::numeric AS booking_amount,
      NULL::text AS booking_currency,
      NULL::text AS booking_provider_name,
      NULL::text AS booking_dates,
      COALESCE(tp.amount_sum, tp.amount_minor / 100.0)::numeric AS amount,
      COALESCE(tp.amount_minor, tp.amount_sum * 100, 0)::bigint AS amount_tiyin,
      CASE
        WHEN LOWER(COALESCE(tp.status, 'created')) IN ('paid', 'success', 'processed', 'unlocked') THEN 'success'
        WHEN LOWER(COALESCE(tp.status, 'created')) IN ('canceled', 'cancelled') THEN 'canceled'
        WHEN LOWER(COALESCE(tp.status, 'created')) IN ('failed', 'error', 'expired') THEN 'failed'
        ELSE LOWER(COALESCE(tp.status, 'created'))
      END::text AS state,
      tp.status::text AS order_state,
      0::int AS reminder_count,
      NULL::timestamptz AS last_reminder_sent_at,
      COALESCE(c.is_test_account, false) AS is_test_account,
      tp.created_at AS created_at,
      tp.processed_at AS performed_at,
      NULL::text AS payme_id,
      tp.telegram_payment_charge_id::text AS telegram_payment_charge_id,
      tp.provider_payment_charge_id::text AS provider_payment_charge_id,
      NULL::bigint AS order_id,
      tp.status::text AS raw_status,
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
      NULL::bigint AS booking_id,
      NULL::text AS booking_status,
      NULL::text AS booking_refund_status,
      NULL::numeric AS booking_amount,
      NULL::text AS booking_currency,
      NULL::text AS booking_provider_name,
      NULL::text AS booking_dates,
      (d.amount_tiyin / 100.0)::numeric AS amount,
      d.amount_tiyin::bigint AS amount_tiyin,
      ${orderStateSql("d.status")} AS state,
      d.status::text AS order_state,
      COALESCE(d.reminder_count, 0)::int AS reminder_count,
      d.last_reminder_sent_at AS last_reminder_sent_at,
      COALESCE(p.is_test_account, false) AS is_test_account,
      d.created_at AS created_at,
      d.paid_at AS performed_at,
      d.payme_id::text AS payme_id,
      NULL::text AS telegram_payment_charge_id,
      NULL::text AS provider_payment_charge_id,
      d.payme_order_id::bigint AS order_id,
      d.status::text AS raw_status,
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
    await ensureRecoveryColumns();

    const limit = clampInt(req.query.limit, 200, 1, 1000);
    const q = String(req.query.q || "").trim();
    const state = normalizeStateFilter(req.query.state);
    const type = cleanFilter(req.query.type);
    const source = cleanFilter(req.query.source);
    const includeTest = String(req.query.include_test || req.query.includeTest || "") === "1";

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

    if (!includeTest) {
      where.push(`COALESCE(is_test_account, false) = false`);
    }

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
        OR CAST(COALESCE(booking_id, 0) AS TEXT) ILIKE $${idx}
        OR CAST(COALESCE(order_id, 0) AS TEXT) ILIKE $${idx}
      )`);
      args.push(`%${q}%`);
      idx++;
    }

    if (state) {
      if (state === "created") where.push(`state IN ('created', 'pending', 'new')`);
      else if (state === "failed") where.push(`state IN ('failed')`);
      else {
        where.push(`state = $${idx}`);
        args.push(state);
        idx++;
      }
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
        COUNT(*) FILTER (WHERE state = 'failed')::int AS failed_count,
        COUNT(*) FILTER (WHERE raw_status ILIKE 'expired' OR order_state ILIKE 'expired')::int AS expired_count,
        COUNT(*) FILTER (WHERE state IN ('created', 'pending') AND COALESCE(reminder_count, 0) > 0)::int AS nudged_count,
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
      include_test: includeTest,
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

async function expireOldPaymePayments(req, res) {
  try {
    const dryRun = String(req.query.dry_run || req.body?.dry_run || "").trim() === "1";
    const result = await expireOldPaymeOrders({ dryRun });
    return res.json({ success: true, ...result });
  } catch (e) {
    console.error("[expireOldPaymePayments] error:", e);
    return res.status(500).json({ success: false, error: "Internal error" });
  }
}

async function sendPaymePaymentReminders(req, res) {
  try {
    const dryRun = String(req.query.dry_run || req.body?.dry_run || "").trim() === "1";
    const limit = clampInt(req.query.limit || req.body?.limit, 100, 1, 300);
    const result = await sendDuePaymeReminders({ dryRun, limit });
    return res.json({ success: true, ...result });
  } catch (e) {
    console.error("[sendPaymePaymentReminders] error:", e);
    return res.status(500).json({ success: false, error: "Internal error" });
  }
}

async function reviewHotelRefund(req, res) {
  const bookingId = Number(req.params.bookingId);
  const action = String(req.body?.action || "").trim().toLowerCase();
  const comment = String(req.body?.comment || "").trim().slice(0, 1000);
  if (!Number.isInteger(bookingId) || bookingId <= 0) return res.status(400).json({ message: "Invalid booking id" });
  if (!['processing', 'rejected'].includes(action)) return res.status(400).json({ message: "Недопустимое действие" });
  if (action === 'rejected' && comment.length < 5) return res.status(400).json({ message: "Укажите причину отказа" });

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(`
      ALTER TABLE bookings
        ADD COLUMN IF NOT EXISTS refund_status TEXT,
        ADD COLUMN IF NOT EXISTS refund_reviewed_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS refund_reviewed_by BIGINT,
        ADD COLUMN IF NOT EXISTS refund_admin_comment TEXT
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS booking_refund_events (
        id BIGSERIAL PRIMARY KEY,
        booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        comment TEXT,
        admin_id BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const updated = await db.query(
      `UPDATE bookings
          SET refund_status=$2,
              refund_reviewed_at=NOW(),
              refund_reviewed_by=$3,
              refund_admin_comment=$4,
              updated_at=NOW()
        WHERE id=$1 AND refund_status='requested'
        RETURNING id,client_id,provider_id,
                  NULLIF(to_jsonb(bookings)->>'requester_provider_id','')::bigint AS requester_provider_id`,
      [bookingId, action, Number(req.user?.id) || null, comment || null]
    );
    if (!updated.rowCount) {
      await db.query('ROLLBACK');
      return res.status(409).json({ message: "Заявка уже обработана или не найдена" });
    }
    await db.query(
      `INSERT INTO booking_refund_events (booking_id,status,comment,admin_id) VALUES ($1,$2,$3,$4)`,
      [bookingId, action, comment || null, Number(req.user?.id) || null]
    );
    await db.query('COMMIT');

    const booking = updated.rows[0];
    let chatId = null;
    if (booking.requester_provider_id) {
      const q = await pool.query(`SELECT COALESCE(telegram_web_chat_id,telegram_chat_id) AS chat_id FROM providers WHERE id=$1`, [booking.requester_provider_id]);
      chatId = q.rows[0]?.chat_id || null;
    } else if (booking.client_id) {
      const q = await pool.query(`SELECT telegram_chat_id AS chat_id FROM clients WHERE id=$1`, [booking.client_id]);
      chatId = q.rows[0]?.chat_id || null;
    }
    if (chatId) {
      const statusText = action === 'processing' ? 'принят в работу' : 'отклонён';
      const safeComment = comment.replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch]));
      telegram.tgSend(chatId, `↩️ Запрос возврата по брони <b>#${bookingId}</b> ${statusText}.${safeComment ? `\nКомментарий: ${safeComment}` : ''}`).catch(() => {});
    }
    return res.json({ ok: true, booking_id: bookingId, refund_status: action });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch {}
    console.error('[reviewHotelRefund] error:', e);
    return res.status(500).json({ message: "Не удалось обработать возврат" });
  } finally {
    db.release();
  }
}

module.exports = {
  adminPaymePayments,
  expireOldPaymePayments,
  sendPaymePaymentReminders,
  reviewHotelRefund,
};
