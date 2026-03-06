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
    ),
    joined AS (
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
          -- 🔴 STUCK (state=1 too long)
          WHEN tx.state = 1
               AND tx.create_time IS NOT NULL
               AND (EXTRACT(EPOCH FROM (now() - to_timestamp(tx.create_time/1000))) > 900)
            THEN 'STUCK'

          -- 🔴 LOST PAYMENT
          WHEN tx.state = 2 AND COALESCE(lg.ledger_rows,0) = 0
            THEN 'LOST_PAYMENT'

          -- 🟡 BAD AMOUNT
          WHEN tx.state = 2 AND COALESCE(lg.ledger_sum,0) <= 0
            THEN 'BAD_AMOUNT'

          -- 🟠 REFUND MISMATCH
          WHEN tx.state IN (-1,-2) AND COALESCE(lg.ledger_sum,0) > 0
            THEN 'REFUND_MISMATCH'

          ELSE 'OK'
        END AS health_status,

        CASE
          -- performed, but ledger sum != expected topup
          WHEN tx.state = 2
               AND COALESCE(lg.ledger_sum,0) <> COALESCE(tx.amount_tiyin,0)
            THEN 'LEDGER_MISMATCH'

          -- refunded/cancelled, but ledger sum != negative expected amount
          WHEN tx.state IN (-1,-2)
               AND COALESCE(lg.ledger_sum,0) <> -COALESCE(tx.amount_tiyin,0)
            THEN 'REFUND_MISMATCH'

          -- performed, but no ledger rows at all
          WHEN tx.state = 2
               AND COALESCE(lg.ledger_rows,0) = 0
            THEN 'LOST_PAYMENT'

          ELSE 'OK'
        END AS billing_status

      FROM tx
      LEFT JOIN lg ON lg.payme_id = tx.payme_id
    )
    SELECT *
    FROM joined
    ${
      onlyBad
        ? "WHERE health_status <> 'OK' OR billing_status <> 'OK'"
        : ""
    }
    ORDER BY updated_at DESC NULLS LAST;
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

    const orderQ = await pool.query(`SELECT * FROM topup_orders WHERE id=$1`, [tx.order_id]);
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
      `SELECT * FROM topup_orders WHERE id=$1 FOR UPDATE`,
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

/**
 * POST /api/admin/payme/repair-bulk
 * Body: { paymeIds: string[], dryRun?: boolean }
 * Bulk repair LOST_PAYMENT (state=2 + ledger missing) – bank-grade:
 * - advisory lock per paymeId
 * - SELECT ... FOR UPDATE
 * - idempotency check by meta(payme_id, order_id)
 */
async function adminPaymeRepairBulk(req, res) {
  const paymeIds = Array.isArray(req.body?.paymeIds) ? req.body.paymeIds : [];
  const dryRun = !!req.body?.dryRun;

  const ids = paymeIds
    .map((x) => normPaymeId(x))
    .filter(Boolean);

  if (!ids.length) return res.status(400).json({ ok: false, message: "paymeIds[] required" });
  if (ids.length > 200) return res.status(400).json({ ok: false, message: "Too many paymeIds (max 200)" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const results = [];

    for (const paymeId of ids) {
      await lockKeyTx(client, `payme:${paymeId}`);

      const txQ = await client.query(
        `SELECT * FROM payme_transactions WHERE payme_id=$1 FOR UPDATE`,
        [paymeId]
      );
      if (!txQ.rows.length) {
        results.push({ paymeId, ok: false, reason: "tx_not_found" });
        continue;
      }
      const tx = txQ.rows[0];

      if (Number(tx.state) !== 2) {
        results.push({ paymeId, ok: false, reason: `tx_state_${tx.state}` });
        continue;
      }

      const orderQ = await client.query(
        `SELECT * FROM topup_orders WHERE id=$1 FOR UPDATE`,
        [tx.order_id]
      );
      const order = orderQ.rows[0];
      if (!order) {
        results.push({ paymeId, ok: false, reason: "order_not_found" });
        continue;
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
        results.push({ paymeId, ok: true, already: true, ledger_id: ex.rows[0].id });
        continue;
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
          repaired_by: "admin_bulk",
        },
      };

      if (dryRun) {
        results.push({ paymeId, ok: true, dryRun: true, wouldInsert: row });
        continue;
      }

      const ins = await client.query(
        `
        INSERT INTO contact_balance_ledger (client_id, amount, reason, service_id, source, meta)
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING id
        `,
        [row.client_id, row.amount, row.reason, row.service_id, row.source, row.meta]
      );

      results.push({ paymeId, ok: true, inserted: true, ledger_id: ins.rows[0]?.id || null });
    }

    if (dryRun) {
      await client.query("ROLLBACK");
      return res.json({ ok: true, dryRun: true, results });
    }

    await client.query("COMMIT");
    return res.json({ ok: true, results });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("adminPaymeRepairBulk error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  } finally {
    client.release();
  }
}

async function adminPaymeDashboard(req,res){

  const today = await pool.query(`
  SELECT COUNT(*) 
  FROM payme_transactions
  WHERE state=2
  AND to_timestamp(perform_time/1000)::date = CURRENT_DATE
  `);

  const success = await pool.query(`
  SELECT COUNT(*) FROM payme_transactions
  WHERE state=2
  `);

  const failed = await pool.query(`
  SELECT COUNT(*) FROM payme_transactions
  WHERE state<0
  `);

  const refunds = await pool.query(`
  SELECT COUNT(*) FROM contact_balance_ledger
  WHERE reason='refund'
  `);

  const ledger = await pool.query(`
  SELECT COUNT(*) FROM contact_balance_ledger
  WHERE reason='topup'
  `);

  const broken = await pool.query(`
  SELECT COUNT(*)
  FROM payme_transactions p
  LEFT JOIN contact_balance_ledger l
  ON l.meta->>'payme_id'=p.payme_id
  WHERE p.state=2
  AND l.id IS NULL
  `);

  res.json({
    today_topups: today.rows[0].count,
    success: success.rows[0].count,
    failed: failed.rows[0].count,
    refunds: refunds.rows[0].count,
    ledger_credits: ledger.rows[0].count,
    broken: broken.rows[0].count
  });

}

async function adminPaymeLive(req, res) {
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(200, Math.trunc(limitRaw)))
    : 50;

  try {
    const q = await pool.query(
      `
      SELECT
        p.payme_id,
        p.order_id,
        p.amount_tiyin,
        p.state,
        p.create_time,
        p.perform_time,
        p.cancel_time,
        p.reason,
        p.updated_at,
        t.client_id,
        t.status AS order_status,
        COALESCE(lg.ledger_rows, 0) AS ledger_rows,
        COALESCE(lg.ledger_sum, 0) AS ledger_sum
      FROM payme_transactions p
      LEFT JOIN topup_orders t
        ON t.id = p.order_id
      LEFT JOIN (
        SELECT
          l.meta->>'payme_id' AS payme_id,
          COUNT(*)::bigint AS ledger_rows,
          COALESCE(SUM(l.amount), 0)::bigint AS ledger_sum
        FROM contact_balance_ledger l
        WHERE l.source IN ('payme', 'payme_refund')
          AND l.meta ? 'payme_id'
        GROUP BY l.meta->>'payme_id'
      ) lg
        ON lg.payme_id = p.payme_id
      ORDER BY COALESCE(p.updated_at, now()) DESC, p.create_time DESC
      LIMIT $1
      `,
      [limit]
    );

    return res.json({
      ok: true,
      rows: q.rows,
      limit,
    });
  } catch (e) {
    console.error("adminPaymeLive error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}
module.exports = {
  adminPaymeHealth,
  adminPaymeTxDetails,
  adminPaymeRepairLedger,
  adminPaymeRepairBulk,
  adminPaymeDashboard,
  adminPaymeLive,
};
