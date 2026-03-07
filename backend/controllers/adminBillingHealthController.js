//backend/controllers/adminBillingHealthController.js

const pool = require("../db");

async function syncOneClientBalance(client, clientId) {
  const { rows: colRows } = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='clients'
  `);

  const cols = new Set(colRows.map((r) => r.column_name));
  const balanceCol =
    ["contact_balance", "contact_balance_tiyin", "balance_tiyin", "balance", "wallet_balance"].find(
      (c) => cols.has(c)
    ) || null;

  if (!balanceCol) {
    throw new Error("No balance column found in clients");
  }

  const { rows } = await client.query(
    `
    SELECT COALESCE(SUM(amount),0)::bigint AS balance
    FROM contact_balance_ledger
    WHERE client_id = $1
  `,
    [clientId]
  );

  const balance = Number(rows[0]?.balance || 0);

  await client.query(
    `
    UPDATE clients
    SET ${balanceCol} = $2
    WHERE id = $1
  `,
    [clientId, balance]
  );

  return balance;
}

async function getBillingHealthData() {
  const ledgerMismatch = await pool.query(`
    SELECT
      c.id AS client_id,
      COALESCE(c.contact_balance,0) AS mirror_balance,
      COALESCE(l.balance,0) AS ledger_balance
    FROM clients c
    LEFT JOIN (
      SELECT client_id, COALESCE(SUM(amount),0)::bigint AS balance
      FROM contact_balance_ledger
      GROUP BY client_id
    ) l ON l.client_id = c.id
    WHERE COALESCE(c.contact_balance,0) != COALESCE(l.balance,0)
    ORDER BY c.id DESC
    LIMIT 50
  `);

  const doubleUnlock = await pool.query(`
    SELECT
      client_id,
      service_id,
      COUNT(*) AS cnt
    FROM client_service_contact_unlocks
    GROUP BY client_id, service_id
    HAVING COUNT(*) > 1
    LIMIT 50
  `);

  const brokenPayme = await pool.query(`
    SELECT
      t.payme_id,
      t.order_id,
      o.client_id,
      t.amount_tiyin,
      t.state,
      t.perform_time,
      t.cancel_time,
      o.status,
      CASE
        WHEN t.state = 2 AND COALESCE(o.status, '') != 'paid' THEN 'TX_OK_ORDER_BAD'
        WHEN t.state IN (-1, -2) AND o.status = 'paid' THEN 'CANCELED_BUT_ORDER_PAID'
        WHEN t.state = 2 AND NOT EXISTS (
          SELECT 1
          FROM contact_balance_ledger l
          WHERE l.client_id = o.client_id
            AND (
              (l.reason = 'topup' AND l.source = 'payme')
              OR (l.meta::text ILIKE '%' || t.payme_id || '%')
            )
        ) THEN 'LOST_PAYMENT'
        WHEN t.state = 1 AND COALESCE(o.status, '') = 'paid' THEN 'ORDER_STATUS_MISMATCH'
        ELSE 'UNKNOWN'
      END AS problem_type
    FROM payme_transactions t
    LEFT JOIN topup_orders o ON o.id = t.order_id
    WHERE
      (t.state = 2 AND COALESCE(o.status, '') != 'paid')
      OR
      (t.state IN (-1,-2) AND o.status = 'paid')
      OR
      (t.state = 1 AND COALESCE(o.status, '') = 'paid')
      OR
      (
        t.state = 2 AND NOT EXISTS (
          SELECT 1
          FROM contact_balance_ledger l
          WHERE l.client_id = o.client_id
            AND (
              (l.reason = 'topup' AND l.source = 'payme')
              OR (l.meta::text ILIKE '%' || t.payme_id || '%')
            )
        )
      )
    LIMIT 50
  `);

  const orphanOrders = await pool.query(`
    SELECT
      o.id,
      o.client_id,
      o.amount_tiyin,
      o.status
    FROM topup_orders o
    LEFT JOIN payme_transactions t ON t.order_id = o.id
    WHERE t.order_id IS NULL
      AND o.status != 'new'
    LIMIT 50
  `);

  return {
    ok: true,
    ledger_mismatch: ledgerMismatch.rows,
    double_unlock: doubleUnlock.rows,
    broken_payme: brokenPayme.rows,
    orphan_orders: orphanOrders.rows,
  };
}

async function adminBillingHealth(req, res) {
  try {
    const data = await getBillingHealthData();
    return res.json(data);
  } catch (e) {
    console.error("adminBillingHealth error:", e);
    return res.status(500).json({ ok: false });
  }
}

async function adminBillingRepairOne(req, res) {
  const clientId = Number(req.params.clientId);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return res.status(400).json({ ok: false, message: "Bad clientId" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const balance = await syncOneClientBalance(client, clientId);
    await client.query("COMMIT");

    return res.json({
      ok: true,
      client_id: clientId,
      repaired_balance: balance,
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("adminBillingRepairOne error:", e);
    return res.status(500).json({ ok: false, message: "Repair failed" });
  } finally {
    client.release();
  }
}

async function adminBillingRepairAll(req, res) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    const { rows } = await db.query(`
      SELECT
        c.id AS client_id
      FROM clients c
      LEFT JOIN (
        SELECT client_id, COALESCE(SUM(amount),0)::bigint AS balance
        FROM contact_balance_ledger
        GROUP BY client_id
      ) l ON l.client_id = c.id
      WHERE COALESCE(c.contact_balance,0) != COALESCE(l.balance,0)
      ORDER BY c.id DESC
      LIMIT 500
    `);

    const repaired = [];
    for (const r of rows) {
      const balance = await syncOneClientBalance(db, Number(r.client_id));
      repaired.push({
        client_id: Number(r.client_id),
        repaired_balance: balance,
      });
    }

    await db.query("COMMIT");

    return res.json({
      ok: true,
      repaired_count: repaired.length,
      repaired,
    });
  } catch (e) {
    try {
      await db.query("ROLLBACK");
    } catch {}
    console.error("adminBillingRepairAll error:", e);
    return res.status(500).json({ ok: false, message: "Repair all failed" });
  } finally {
    db.release();
  }
}

module.exports = {
  adminBillingHealth,
  adminBillingRepairOne,
  adminBillingRepairAll,
};
