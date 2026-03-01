//backend/jobs/paymeHealthJob.js

const pool = require("../db");
const { notifyPaymeHealthIssues } = require("../utils/paymeHealthAlerts");

async function runPaymeHealthCheck() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      WITH tx AS (
        SELECT payme_id, state
        FROM payme_transactions
        ORDER BY updated_at DESC
        LIMIT 1000
      ),
      lg AS (
        SELECT
          (meta->>'payme_id') AS payme_id,
          COUNT(*) AS ledger_rows,
          SUM(amount) AS ledger_sum
        FROM contact_balance_ledger
        WHERE source IN ('payme','payme_refund')
          AND meta ? 'payme_id'
        GROUP BY (meta->>'payme_id')
      )
      SELECT
        SUM(CASE WHEN tx.state=2 AND COALESCE(lg.ledger_rows,0)=0 THEN 1 ELSE 0 END) AS lost_payment,
        SUM(CASE WHEN tx.state=2 AND COALESCE(lg.ledger_sum,0)<=0 THEN 1 ELSE 0 END) AS bad_amount,
        SUM(CASE WHEN tx.state IN (-1,-2) AND COALESCE(lg.ledger_sum,0)>0 THEN 1 ELSE 0 END) AS refund_mismatch
      FROM tx
      LEFT JOIN lg ON lg.payme_id = tx.payme_id
    `);

    await notifyPaymeHealthIssues(rows[0]);
  } catch (e) {
    console.error("[payme-health-job]", e?.message || e);
  } finally {
    client.release();
  }
}

module.exports = { runPaymeHealthCheck };
