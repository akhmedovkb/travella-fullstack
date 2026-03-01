// backend/controllers/adminPaymeHealthController.js
const pool = require("../db");

function normPaymeId(x) {
  return String(x ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

async function lockKeyTx(client, keyStr) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [String(keyStr)]);
}

function clampInt(x, def, min, max) {
  const n = Number(x);
  if (!Number.isFinite(n)) return def;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

/**
 * GET /api/admin/payme/health?limit=200&onlyBad=1&q=pm_tx_...
 * Bank-grade сверка: payme_transactions ↔ contact_balance_ledger(meta.payme_id)
 */
async function adminPaymeHealth(req, res) {
  const limit = clampInt(req.query.limit, 200, 1, 2000);
  const onlyBad = String(req.query.onlyBad || "").toLowerCase() === "1";
  const q = String(req.query.q || "").trim();

  const sql = `
    WITH tx AS (
      SELECT
        t.payme_id,
        t.order_id,
        t.amount_tiyin,
        t.state,
        t.create_time,
        t.perform_time,
        t.cancel_time,
        t.reason,
        t.updated_at
      FROM payme_transactions t
      WHERE ($1::text IS NULL OR t.payme_id ILIKE $1 OR CAST(t.order_id AS text) ILIKE $1)
      ORDER BY t.updated_at DESC NULLS LAST
      LIMIT ${limit}
    ),
    lg AS (
      SELECT
        (l.meta->>'payme_id') AS payme_id,
        COUNT(*)::bigint AS ledger_rows,
        COALESCE(SUM(l.amount),0)::numeric AS ledger_sum,
        MIN(l.created_at) AS first_ledger_at,
        MAX(l.created_at) AS last_ledger_at
      FROM contact_balance_ledger l
      WHERE l.source IN ('payme','payme_refund')
        AND l.meta ? 'payme_id'
      GROUP BY (l.meta->>'payme_id')
    )
    SELECT
      tx.payme_id,
      tx.order_id,
      tx.amount_tiyin,
      tx.state,
      tx.create_time,
      tx.perform_time,
      tx.cancel_time,
      tx.reason,
      tx.updated_at,
      COALESCE(lg.ledger_rows,0) AS ledger_rows,
      COALESCE(lg.ledger_sum,0) AS ledger_sum,
      lg.first_ledger_at,
      lg.last_ledger_at,
      CASE
        WHEN tx.state = 2 AND COALESCE(lg.ledger_rows,0) = 0 THEN 'LOST_PAYMENT'
        WHEN tx.state = 2 AND COALESCE(lg.ledger_sum,0) <= 0 THEN 'BAD_AMOUNT'
        WHEN tx.state IN (-1,-2) AND COALESCE(lg.ledger_sum,0) > 0 THEN 'REFUND_MISMATCH'
        ELSE 'OK'
      END AS health_status
    FROM tx
    LEFT JOIN lg ON lg.payme_id = tx.payme_id
    ${onlyBad ? "WHERE (CASE WHEN tx.state = 2 AND COALESCE(lg.ledger_rows,0) = 0 THEN 'LOST_PAYMENT' WHEN tx.state = 2 AND COALESCE(lg.ledger_sum,0) <= 0 THEN 'BAD_AMOUNT' WHEN tx.state IN (-1,-2) AND COALESCE(lg.ledger_sum,0) > 0 THEN 'REFUND_MISMATCH' ELSE 'OK' END) <> 'OK'" : ""}
    ORDER BY tx.updated_at DESC NULLS LAST;
  `;

  try {
    const like = q ? `%${q}%` : null;
    const { rows } = await pool.query(sql, [like]);
    res.json({ ok: true, rows });
  } catch (e) {
    console.error("adminPaymeHealth error:", e);
    res.status(500).json({ ok: false, message: "Internal error" });
  }
}

/**
 * GET /api/admin/payme/tx/:paymeId
 * Tx + order + ledger rows
 */
async function adminPaymeTxDetails(req, res) {
  const paymeId = normPaymeId(req.params.paymeId);
  if (!paymeId) return res.status(400).json({ ok: false, message: "Bad paymeId" });

  try {
    const txQ = await pool.query(`SELECT * FROM payme_transactions WHERE payme_id=$1`, [paymeId]);
    if (!txQ.rows.length) return res.status(404).json({ ok: false, message: "Not found" });
    const tx = txQ.rows[0];

    const orderQ = await pool.query(`SELECT * FROM payme_topup_orders WHERE id=$1`, [tx.order_id]);
    const order = orderQ.rows[0] || null;

    const ledgerQ = await pool.query(
      `
      SELECT *
        FROM contact_balance_ledger
       WHERE source IN ('payme','payme_refund')
         AND meta->>'payme_id' = $1
       ORDER BY created_at ASC
      `,
      [paymeId]
    );

    res.json({ ok: true, tx, order, ledger: ledgerQ.rows });
  } catch (e) {
    console.error("adminPaymeTxDetails error:", e);
    res.status(500).json({ ok: false, message: "Internal error" });
  }
}

/**
 * POST /api/admin/payme/repair/:paymeId
 * Создаёт отсутствующую ledger-запись для state=2.
 * Безопасно: advisory lock + existence check по meta(payme_id, order_id).
 */
async function adminPaymeRepairLedger(req, res) {
  const paymeId = normPaymeId(req.params.paymeId);
  const dryRun = !!req.body?.dryRun;
  if (!paymeId) return res.status(400).json({ ok: false, message: "Bad paymeId" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockKeyTx(client, `payme:${paymeId}`);

    const txQ = await client.query(
      `SELECT * FROM payme_transactions WHERE payme_id=$1 FOR UPDATE`,
      [paymeId]
    );
    if (!txQ.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, message: "Transaction not found" });
    }
    const tx = txQ.rows[0];

    if (Number(tx.state) !== 2) {
      await client.query("ROLLBACK");
      return res.status(400).json({ ok: false, message: `Tx state is ${tx.state}, expected 2` });
    }

    const orderQ = await client.query(
      `SELECT * FROM payme_topup_orders WHERE id=$1 FOR UPDATE`,
      [tx.order_id]
    );
    const order = orderQ.rows[0];
    if (!order) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, message: "Order not found" });
    }

    const ex = await client.query(
      `
      SELECT id
        FROM contact_balance_ledger
       WHERE source='payme'
         AND reason='topup'
         AND meta->>'payme_id'=$1
         AND meta->>'order_id'=$2
       LIMIT 1
      `,
      [String(paymeId), String(order.id)]
    );
    if (ex.rows.length) {
      await client.query("COMMIT");
      return res.json({ ok: true, already: true, ledger_id: ex.rows[0].id });
    }

    const row = {
      client_id: Number(order.client_id),
      amount: Number(order.amount_tiyin),
      reason: "topup",
      service_id: null,
      source: "payme",
      meta: {
        payme_id: String(paymeId),
        order_id: String(order.id),
        kind: "topup",
        repaired_by: "admin",
      },
    };

    if (dryRun) {
      await client.query("ROLLBACK");
      return res.json({ ok: true, dryRun: true, wouldInsert: row });
    }

    const ins = await client.query(
      `
      INSERT INTO contact_balance_ledger (client_id, amount, reason, service_id, source, meta)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING id
      `,
      [row.client_id, row.amount, row.reason, row.service_id, row.source, row.meta]
    );

    await client.query("COMMIT");
    return res.json({ ok: true, inserted: true, ledger_id: ins.rows[0]?.id || null });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("adminPaymeRepairLedger error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  } finally {
    client.release();
  }
}

module.exports = {
  adminPaymeHealth,
  adminPaymeTxDetails,
  adminPaymeRepairLedger,
};
