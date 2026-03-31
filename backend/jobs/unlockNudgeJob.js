//backend/jobs/unlockNudgeJob.js

const pool = require("../db");
const { sendUnlockNudge } = require("../utils/telegram");

async function runUnlockNudge() {
  try {
    const { rows } = await pool.query(`
      WITH pay_rows AS (
        SELECT
          f.id,
          f.client_id,
          f.created_at,
          f.nudge_sent_at,
          COALESCE(f.nudge_count, 0) AS nudge_count,
          COALESCE(f.last_nudge_kind, '') AS last_nudge_kind
        FROM contact_unlock_funnel f
        WHERE f.step = 'payment_success'
          AND f.source = 'web'
      ),
      latest_pay AS (
        SELECT DISTINCT ON (p.client_id)
          p.id,
          p.client_id,
          p.created_at,
          p.nudge_sent_at,
          p.nudge_count,
          p.last_nudge_kind
        FROM pay_rows p
        ORDER BY p.client_id, p.created_at DESC, p.id DESC
      ),
      latest_unlock AS (
        SELECT DISTINCT ON (u.client_id)
          u.client_id,
          u.created_at AS unlock_created_at
        FROM contact_unlock_funnel u
        WHERE u.step IN ('unlock_success', 'unlock_already_opened')
        ORDER BY u.client_id, u.created_at DESC, u.id DESC
      )
      SELECT
        lp.id,
        lp.client_id,
        c.telegram_chat_id,
        c.name AS client_name,
        lp.created_at,
        lp.nudge_sent_at,
        lp.nudge_count,
        lp.last_nudge_kind
      FROM latest_pay lp
      JOIN clients c
        ON c.id = lp.client_id
      LEFT JOIN latest_unlock lu
        ON lu.client_id = lp.client_id
      WHERE c.telegram_chat_id IS NOT NULL
        AND TRIM(c.telegram_chat_id::text) <> ''
        AND (
          lu.unlock_created_at IS NULL
          OR lu.unlock_created_at < lp.created_at
        )
        AND (
          (lp.nudge_count = 0 AND lp.created_at <= NOW() - interval '10 minutes')
          OR
          (lp.nudge_count = 1 AND lp.nudge_sent_at IS NOT NULL AND lp.nudge_sent_at <= NOW() - interval '1 hour')
        )
      ORDER BY lp.created_at ASC
      LIMIT 100
    `);

    let sent = 0;

    for (const r of rows) {
      const kind = Number(r.nudge_count || 0) >= 1 ? "second" : "first";

      try {
        const ok = await sendUnlockNudge(r.telegram_chat_id, {
          kind,
          serviceTitle: "",
          serviceId: null,
        });

        if (!ok) continue;

        await pool.query(
          `
          UPDATE contact_unlock_funnel
          SET
            nudge_sent_at = NOW(),
            nudge_count = COALESCE(nudge_count, 0) + 1,
            last_nudge_kind = $2
          WHERE id = $1
          `,
          [r.id, kind]
        );

        sent += 1;
      } catch (err) {
        console.error("[nudge] send error:", err?.message || err);
      }
    }

    console.log("[nudge] sent:", sent, "candidates:", rows.length);
  } catch (e) {
    console.error("runUnlockNudge error:", e);
  }
}

module.exports = { runUnlockNudge };
