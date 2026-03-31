//backend/jobs/unlockNudgeJob.js

const pool = require("../db");
const { sendUnlockNudge } = require("../utils/telegram");

async function runUnlockNudge() {
  try {
    const { rows } = await pool.query(`
      SELECT 
        c.telegram_chat_id,
        s.title as service_title
      FROM contact_unlock_funnel f
      JOIN clients c ON c.id = f.client_id
      JOIN services s ON s.id = f.service_id
      WHERE f.step = 'payment_success'
      AND f.created_at > NOW() - interval '2 hours'
    `);

    for (const r of rows) {
      await sendUnlockNudge(r.telegram_chat_id, r.service_title);
    }

    console.log("[nudge] sent:", rows.length);
  } catch (e) {
    console.error("runUnlockNudge error:", e);
  }
}

module.exports = { runUnlockNudge };
