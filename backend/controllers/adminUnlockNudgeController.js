// backend/controllers/adminUnlockNudgeController.js

const pool = require("../db");

function clampInt(x, def, min, max) {
  const n = Number(x);
  if (!Number.isFinite(n)) return def;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

function normalizeStatus(x) {
  const s = String(x || "").trim().toLowerCase();
  if (!s) return "";
  const allowed = new Set([
    "opened_after_first",
    "opened_after_second",
    "still_not_opened",
    "opened_without_nudge",
  ]);
  return allowed.has(s) ? s : "";
}

const BASE_CTE = `
  WITH payment_rows AS (
    SELECT
      f.id,
      f.client_id,
      f.service_id,
      f.provider_id,
      f.source,
      f.step,
      f.status,
      COALESCE(f.price_tiyin, 0) AS price_tiyin,
      f.balance_before,
      f.balance_after,
      f.payme_id,
      f.order_id,
      f.session_key,
      f.meta,
      f.created_at,
      f.nudge_sent_at,
      COALESCE(f.nudge_count, 0) AS nudge_count,
      COALESCE(f.last_nudge_kind, '') AS last_nudge_kind,
      f.first_nudge_sent_at,
      f.second_nudge_sent_at
    FROM contact_unlock_funnel f
    WHERE f.step = 'payment_success'
  ),
  latest_payment AS (
    SELECT DISTINCT ON (p.client_id, p.service_id)
      p.*
    FROM payment_rows p
    ORDER BY p.client_id, p.service_id, p.created_at DESC, p.id DESC
  ),
  analytics AS (
    SELECT
      lp.id AS funnel_id,
      lp.client_id,
      lp.service_id,
      lp.provider_id,
      lp.source,
      lp.step,
      lp.status,
      lp.price_tiyin,
      lp.balance_before,
      lp.balance_after,
      lp.payme_id,
      lp.order_id,
      lp.session_key,
      lp.meta,
      lp.created_at AS payment_success_at,
      lp.nudge_sent_at,
      lp.nudge_count,
      lp.last_nudge_kind,
      lp.first_nudge_sent_at,
      lp.second_nudge_sent_at,
      unlock_row.unlock_at,
      CASE
        WHEN unlock_row.unlock_at IS NULL THEN 'still_not_opened'
        WHEN lp.second_nudge_sent_at IS NOT NULL
             AND unlock_row.unlock_at >= lp.second_nudge_sent_at THEN 'opened_after_second'
        WHEN lp.first_nudge_sent_at IS NOT NULL
             AND unlock_row.unlock_at >= lp.first_nudge_sent_at
             AND (
               lp.second_nudge_sent_at IS NULL
               OR unlock_row.unlock_at < lp.second_nudge_sent_at
             ) THEN 'opened_after_first'
        ELSE 'opened_without_nudge'
      END AS unlock_nudge_status,
      CASE
        WHEN unlock_row.unlock_at IS NULL
             AND lp.first_nudge_sent_at IS NULL THEN 'payment_success'
        WHEN unlock_row.unlock_at IS NULL
             AND lp.first_nudge_sent_at IS NOT NULL
             AND lp.second_nudge_sent_at IS NULL THEN 'waiting_after_first'
        WHEN unlock_row.unlock_at IS NULL
             AND lp.second_nudge_sent_at IS NOT NULL THEN 'waiting_after_second'
        WHEN lp.second_nudge_sent_at IS NOT NULL
             AND unlock_row.unlock_at >= lp.second_nudge_sent_at THEN 'after_second_nudge'
        WHEN lp.first_nudge_sent_at IS NOT NULL
             AND unlock_row.unlock_at >= lp.first_nudge_sent_at
             AND (
               lp.second_nudge_sent_at IS NULL
               OR unlock_row.unlock_at < lp.second_nudge_sent_at
             ) THEN 'after_first_nudge'
        ELSE 'opened_without_nudge'
      END AS analytics_step
    FROM latest_payment lp
    LEFT JOIN LATERAL (
      SELECT
        u.created_at AS unlock_at
      FROM contact_unlock_funnel u
      WHERE u.client_id = lp.client_id
        AND u.service_id = lp.service_id
        AND u.step IN ('unlock_success', 'unlock_already_opened')
        AND u.created_at >= lp.created_at
      ORDER BY u.created_at ASC, u.id ASC
      LIMIT 1
    ) unlock_row ON TRUE
  )
`;

async function getUnlockNudgeAnalytics(req, res) {
  try {
    const limit = clampInt(req.query.limit, 100, 1, 500);
    const status = normalizeStatus(req.query.status);

    const summarySql = `
      ${BASE_CTE}
      SELECT
        COUNT(*)::int AS total_cases,
        COUNT(*) FILTER (WHERE unlock_nudge_status = 'still_not_opened')::int AS paid_not_opened_count,
        COUNT(*) FILTER (WHERE first_nudge_sent_at IS NOT NULL)::int AS got_first_nudge_count,
        COUNT(*) FILTER (WHERE second_nudge_sent_at IS NOT NULL)::int AS got_second_nudge_count,
        COUNT(*) FILTER (WHERE unlock_nudge_status = 'opened_after_first')::int AS opened_after_first_count,
        COUNT(*) FILTER (WHERE unlock_nudge_status = 'opened_after_second')::int AS opened_after_second_count,
        COUNT(*) FILTER (WHERE unlock_nudge_status = 'opened_without_nudge')::int AS opened_without_nudge_count,
        COALESCE(SUM(price_tiyin) FILTER (
          WHERE unlock_nudge_status = 'still_not_opened'
        ), 0)::bigint AS stuck_tiyin,
        COALESCE(SUM(price_tiyin) FILTER (
          WHERE unlock_nudge_status IN ('opened_after_first', 'opened_after_second')
        ), 0)::bigint AS squeezed_tiyin,
        COALESCE(SUM(price_tiyin) FILTER (
          WHERE unlock_nudge_status = 'still_not_opened'
            AND first_nudge_sent_at IS NOT NULL
        ), 0)::bigint AS risk_tiyin
      FROM analytics
    `;

    const summaryRes = await pool.query(summarySql);
    const summary = summaryRes.rows?.[0] || {
      total_cases: 0,
      paid_not_opened_count: 0,
      got_first_nudge_count: 0,
      got_second_nudge_count: 0,
      opened_after_first_count: 0,
      opened_after_second_count: 0,
      opened_without_nudge_count: 0,
      stuck_tiyin: 0,
      squeezed_tiyin: 0,
      risk_tiyin: 0,
    };

    const values = [];
    const filters = [];

    if (status) {
      values.push(status);
      filters.push(`a.unlock_nudge_status = $${values.length}`);
    }

    values.push(limit);
    const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const rowsSql = `
      ${BASE_CTE}
      SELECT
        a.client_id,
        a.service_id,
        a.provider_id,
        a.source,
        a.price_tiyin,
        a.payment_success_at,
        a.nudge_sent_at,
        a.nudge_count,
        a.last_nudge_kind,
        a.first_nudge_sent_at,
        a.second_nudge_sent_at,
        a.unlock_at,
        a.analytics_step AS step,
        a.unlock_nudge_status AS status,
        c.name AS client_name,
        c.phone AS client_phone,
        c.telegram_chat_id,
        s.title AS service_title,
        s.category AS service_category
      FROM analytics a
      LEFT JOIN clients c ON c.id = a.client_id
      LEFT JOIN services s ON s.id = a.service_id
      ${whereSql}
      ORDER BY
        CASE
          WHEN a.unlock_nudge_status = 'still_not_opened' THEN 0
          WHEN a.unlock_nudge_status = 'opened_after_second' THEN 1
          WHEN a.unlock_nudge_status = 'opened_after_first' THEN 2
          ELSE 3
        END,
        COALESCE(a.second_nudge_sent_at, a.first_nudge_sent_at, a.payment_success_at) DESC,
        a.client_id DESC,
        a.service_id DESC
      LIMIT $${values.length}
    `;

    const rowsRes = await pool.query(rowsSql, values);

    return res.json({
      ok: true,
      summary,
      rows: rowsRes.rows || [],
      filters: {
        limit,
        status: status || "",
      },
    });
  } catch (e) {
    console.error("getUnlockNudgeAnalytics error:", e);
    return res.status(500).json({
      ok: false,
      message: "Internal error",
    });
  }
}

module.exports = {
  getUnlockNudgeAnalytics,
};
