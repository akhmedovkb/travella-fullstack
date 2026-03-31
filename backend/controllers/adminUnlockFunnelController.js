//backend/controllers/adminUnlockFunnelController.js

const pool = require("../db");

function clampInt(x, def, min, max) {
  const n = Number(x);
  if (!Number.isFinite(n)) return def;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

function normalizeSegment(x) {
  const s = String(x || "").trim().toLowerCase();
  if (!s) return "";
  const allowed = new Set([
    "hot_no_balance",
    "hot_paid_not_opened",
    "hot_topup_created",
    "warm_clicked",
    "closed",
    "other_open",
  ]);
  return allowed.has(s) ? s : "";
}

async function getUnlockFunnel(req, res) {
  try {
    const source = String(req.query.source || "").trim().toLowerCase();
    const segment = normalizeSegment(req.query.segment);
    const limit = clampInt(req.query.limit, 100, 1, 500);

    const values = [];
    const filters = [];

    if (source) {
      values.push(source);
      filters.push(`latest.source = $${values.length}`);
    }

    if (segment) {
      values.push(segment);
      filters.push(`latest.segment = $${values.length}`);
    }

    values.push(limit);

    const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const sql = `
      WITH base AS (
        SELECT
          f.id,
          f.client_id,
          f.service_id,
          f.provider_id,
          f.source,
          f.step,
          f.status,
          f.price_tiyin,
          f.balance_before,
          f.balance_after,
          f.payme_id,
          f.order_id,
          f.session_key,
          f.meta,
          f.created_at
        FROM contact_unlock_funnel f
      ),
      grouped AS (
        SELECT
          b.client_id,
          b.service_id,
          COUNT(*)::int AS attempts_count,
          MIN(b.created_at) AS first_seen_at,
          MAX(b.created_at) AS last_seen_at
        FROM base b
        GROUP BY b.client_id, b.service_id
      ),
      latest_row AS (
        SELECT DISTINCT ON (b.client_id, b.service_id)
          b.*
        FROM base b
        ORDER BY b.client_id, b.service_id, b.created_at DESC, b.id DESC
      ),
      latest AS (
        SELECT
          lr.id,
          lr.client_id,
          lr.service_id,
          lr.provider_id,
          lr.source,
          lr.step,
          lr.status,
          lr.price_tiyin,
          lr.balance_before,
          lr.balance_after,
          lr.payme_id,
          lr.order_id,
          lr.session_key,
          lr.meta,
          lr.created_at,
          g.attempts_count,
          g.first_seen_at,
          g.last_seen_at,
          CASE
            WHEN lr.step = 'unlock_no_balance' THEN 'hot_no_balance'
            WHEN lr.step = 'payment_success' THEN 'hot_paid_not_opened'
            WHEN lr.step = 'topup_order_created' THEN 'hot_topup_created'
            WHEN lr.step = 'unlock_clicked' THEN 'warm_clicked'
            WHEN lr.step IN ('unlock_success', 'unlock_already_opened') THEN 'closed'
            ELSE 'other_open'
          END AS segment,
          CASE
            WHEN lr.step = 'unlock_no_balance' THEN 100
            WHEN lr.step = 'payment_success' THEN 95
            WHEN lr.step = 'topup_order_created' THEN 90
            WHEN lr.step = 'unlock_clicked' THEN 70
            WHEN lr.step IN ('unlock_success', 'unlock_already_opened') THEN 0
            ELSE 50
          END AS priority_score
        FROM latest_row lr
        JOIN grouped g
          ON g.client_id = lr.client_id
         AND g.service_id = lr.service_id
      )
      SELECT
        latest.*,
        c.name AS client_name,
        c.phone AS client_phone,
        c.email AS client_email,
        c.telegram_chat_id,
        s.title AS service_title,
        s.category AS service_category
      FROM latest
      LEFT JOIN clients c ON c.id = latest.client_id
      LEFT JOIN services s ON s.id = latest.service_id
      ${whereSql}
      ORDER BY latest.priority_score DESC, latest.last_seen_at DESC
      LIMIT $${values.length}
    `;

    const { rows } = await pool.query(sql, values);

    const summary = {
      total: rows.length,
      hot_no_balance: rows.filter((r) => r.segment === "hot_no_balance").length,
      hot_paid_not_opened: rows.filter((r) => r.segment === "hot_paid_not_opened").length,
      hot_topup_created: rows.filter((r) => r.segment === "hot_topup_created").length,
      warm_clicked: rows.filter((r) => r.segment === "warm_clicked").length,
      other_open: rows.filter((r) => r.segment === "other_open").length,
      closed: rows.filter((r) => r.segment === "closed").length,
    };

    return res.json({
      ok: true,
      rows,
      summary,
      filters: {
        source: source || "",
        segment: segment || "",
        limit,
      },
    });
  } catch (e) {
    console.error("getUnlockFunnel error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

module.exports = {
  getUnlockFunnel,
};
