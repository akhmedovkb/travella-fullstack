//backend/controllers/adminUnlockNudgeController.js

const pool = require("../db");

async function getPaidNotOpened(req, res) {
  try {
    const { rows } = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (client_id, service_id)
          client_id,
          service_id,
          step,
          created_at
        FROM contact_unlock_funnel
        ORDER BY client_id, service_id, created_at DESC
      )
      SELECT 
        l.client_id,
        l.service_id,
        c.name,
        c.phone,
        c.telegram_chat_id,
        s.title as service_title
      FROM latest l
      LEFT JOIN clients c ON c.id = l.client_id
      LEFT JOIN services s ON s.id = l.service_id
      WHERE l.step = 'payment_success'
      ORDER BY l.created_at DESC
      LIMIT 100
    `);

    res.json({ ok: true, rows });
  } catch (e) {
    console.error("getPaidNotOpened error:", e);
    res.status(500).json({ ok: false });
  }
}

module.exports = { getPaidNotOpened };
