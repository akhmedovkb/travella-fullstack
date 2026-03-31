//backend/jobs/unlockNudgeJob.js

const pool = require("../db");
const { sendUnlockNudge } = require("../utils/telegram");

async function runUnlockNudge() {
  try {
    const { rows } = await pool.query(`
      SELECT 
        f.client_id,
        f.service_id,
        c.telegram_chat_id,
        s.title as service_title
      FROM contact_unlock_funnel f
      JOIN clients c ON c.id = f.client_id
      JOIN services s ON s.id = f.service_id
      WHERE f.step = 'payment_success'
        AND f.created_at > NOW() - interval '2 hours'
        AND f.nudge_sent_at IS NULL
    `);

    for (const r of rows) {
      if (!r.telegram_chat_id) continue;

      try {
        await sendUnlockNudge(r.telegram_chat_id, r.service_title);

        await pool.query(
          `
          UPDATE contact_unlock_funnel
          SET nudge_sent_at = NOW()
          WHERE client_id = $1 AND service_id = $2
          `,
          [r.client_id, r.service_id]
        );
      } catch (err) {
        console.error("[nudge] send error:", err);
      }
    }

    console.log("[nudge] sent:", rows.length);
  } catch (e) {
    console.error("runUnlockNudge error:", e);
  }
}

module.exports = { runUnlockNudge };
