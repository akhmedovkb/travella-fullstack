//backend/controllers/adminPaymePaymentsController.js

const pool = require("../db");

async function adminPaymePayments(req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT
        pt.payme_id,
        pt.order_id,
        pt.amount_tiyin / 100.0 AS amount,
        pt.state,
        pt.created_at,
        to_timestamp(pt.perform_time / 1000.0) AS performed_at,

        c.id as client_id,
        c.name,
        c.phone,
        c.email

      FROM payme_transactions pt
      LEFT JOIN topup_orders o ON o.id = pt.order_id
      LEFT JOIN clients c ON c.id = o.client_id

      ORDER BY pt.created_at DESC
      LIMIT 200
    `);

    return res.json({ success: true, rows });
  } catch (e) {
    console.error("[adminPaymePayments] error:", e);
    return res.status(500).json({ success: false });
  }
}

module.exports = { adminPaymePayments };
