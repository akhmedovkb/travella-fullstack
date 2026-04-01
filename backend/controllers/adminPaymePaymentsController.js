//backend/controllers/adminPaymePaymentsController.js

const pool = require("../db");

async function adminPaymePayments(req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT
        pt.id,
        pt.payme_id,
        pt.order_id,
        pt.amount,
        pt.state,
        pt.created_at,
        pt.perform_time,

        c.id as client_id,
        c.phone,
        c.email,
        c.name

      FROM payme_transactions pt
      LEFT JOIN topup_orders o ON o.id = pt.order_id
      LEFT JOIN clients c ON c.id = o.client_id

      ORDER BY pt.id DESC
      LIMIT 200
    `);

    return res.json({ success: true, rows });
  } catch (e) {
    console.error("[adminPaymePayments] error:", e);
    return res.status(500).json({ success: false });
  }
}

module.exports = { adminPaymePayments };
