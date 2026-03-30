//backend/controllers/adminUnlockFunnelController.js

const pool = require("../db");

async function getUnlockFunnel(req, res) {
  try {
    const { source, step, limit = 50 } = req.query;

    let where = [];
    let values = [];

    if (source) {
      values.push(source);
      where.push(`f.source = $${values.length}`);
    }

    if (step) {
      values.push(step);
      where.push(`f.step = $${values.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const q = `
      SELECT 
        f.*,
        c.name as client_name,
        c.phone as client_phone,
        s.title as service_title
      FROM contact_unlock_funnel f
      LEFT JOIN clients c ON c.id = f.client_id
      LEFT JOIN services s ON s.id = f.service_id
      ${whereSql}
      ORDER BY f.created_at DESC
      LIMIT ${Number(limit)}
    `;

    const { rows } = await pool.query(q, values);

    res.json({ success: true, data: rows });
  } catch (e) {
    console.error("getUnlockFunnel error:", e);
    res.status(500).json({ success: false });
  }
}

module.exports = { getUnlockFunnel };
