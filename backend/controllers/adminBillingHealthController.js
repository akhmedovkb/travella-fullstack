//backend/controllers/adminBillingHealthController.js

const pool = require("../db");

/**
 * Проверка целостности биллинга Travella
 */

async function adminBillingHealth(req, res) {
  try {

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
        t.state,
        o.status
      FROM payme_transactions t
      LEFT JOIN topup_orders o ON o.id = t.order_id
      WHERE
        (t.state = 2 AND o.status != 'paid')
        OR
        (t.state IN (-1,-2) AND o.status = 'paid')
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

    res.json({
      ok: true,
      ledger_mismatch: ledgerMismatch.rows,
      double_unlock: doubleUnlock.rows,
      broken_payme: brokenPayme.rows,
      orphan_orders: orphanOrders.rows
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false });
  }
}

module.exports = {
  adminBillingHealth
};
