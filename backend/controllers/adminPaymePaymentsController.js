//backend/controllers/adminPaymePaymentsController.js

const pool = require("../db");

function clampInt(x, def, min, max) {
  const n = Number(x);
  if (!Number.isFinite(n)) return def;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function normalizeState(v) {
  const s = String(v || "").trim().toUpperCase();

  if (s === "2" || s === "PERFORMED" || s === "SUCCESS") return 2;
  if (s === "1" || s === "CREATED") return 1;
  if (s === "-1" || s === "CANCELED" || s === "CANCELLED") return -1;
  if (s === "-2" || s === "REFUNDED" || s === "REFUND") return -2;

  return null;
}

async function adminPaymePayments(req, res) {
  try {
    const limit = clampInt(req.query.limit, 200, 1, 500);
    const q = String(req.query.q || "").trim();
    const state = normalizeState(req.query.state);

    const where = [];
    const args = [];
    let idx = 1;

    if (q) {
      where.push(`
        (
          pt.payme_id ILIKE $${idx}
          OR CAST(pt.order_id AS TEXT) ILIKE $${idx}
          OR CAST(o.client_id AS TEXT) ILIKE $${idx}
          OR c.name ILIKE $${idx}
          OR c.phone ILIKE $${idx}
          OR c.email ILIKE $${idx}
        )
      `);
      args.push(`%${q}%`);
      idx++;
    }

    if (state !== null) {
      where.push(`pt.state = $${idx}`);
      args.push(state);
      idx++;
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const { rows } = await pool.query(
      `
      SELECT
        pt.payme_id,
        pt.order_id,
        pt.amount_tiyin / 100.0 AS amount,
        pt.state,
        pt.created_at,
        CASE
          WHEN pt.perform_time IS NOT NULL AND pt.perform_time > 0
            THEN to_timestamp(pt.perform_time / 1000.0)
          ELSE NULL
        END AS performed_at,
        o.client_id,
        c.name,
        c.phone,
        c.email
      FROM payme_transactions pt
      LEFT JOIN topup_orders o ON o.id = pt.order_id
      LEFT JOIN clients c ON c.id = o.client_id
      ${whereSql}
      ORDER BY pt.created_at DESC
      LIMIT $${idx}
      `,
      [...args, limit]
    );

    return res.json({ success: true, rows });
  } catch (e) {
    console.error("[adminPaymePayments] error:", e?.message || e);
    return res.status(500).json({ success: false, error: "Internal error" });
  }
}

module.exports = { adminPaymePayments };
