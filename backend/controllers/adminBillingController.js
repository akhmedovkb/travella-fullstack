//backend/controllers/adminBillingController.js

const pool = require("../db");
const {
  DEFAULT_CONTACT_UNLOCK_PRICE,
  getContactUnlockSettings,
  setContactUnlockSettings,
} = require("../utils/contactUnlockSettings");

function clampInt(x, def, min, max) {
  const n = Number(x);
  if (!Number.isFinite(n)) return def;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

async function adminBillingSummary(req, res) {
  try {
    const totalBalanceQ = await pool.query(`
      SELECT COALESCE(SUM(amount), 0)::bigint AS total_balance
      FROM contact_balance_ledger
    `);

    const totalTopupsQ = await pool.query(`
      SELECT COALESCE(SUM(amount), 0)::bigint AS total_topups
      FROM contact_balance_ledger
      WHERE reason = 'topup'
        AND source = 'payme'
        AND amount > 0
    `);

    const totalRefundsQ = await pool.query(`
      SELECT COALESCE(SUM(ABS(amount)), 0)::bigint AS total_refunds
      FROM contact_balance_ledger
      WHERE reason = 'refund'
        AND amount < 0
    `);

    const totalDebitsQ = await pool.query(`
      SELECT COALESCE(SUM(ABS(amount)), 0)::bigint AS total_debits
      FROM contact_balance_ledger
      WHERE amount < 0
    `);

    const clientsWithBalanceQ = await pool.query(`
      SELECT COUNT(*)::bigint AS cnt
      FROM (
        SELECT client_id
        FROM contact_balance_ledger
        GROUP BY client_id
        HAVING COALESCE(SUM(amount), 0) <> 0
      ) x
    `);

    const txCountQ = await pool.query(`
      SELECT COUNT(*)::bigint AS cnt
      FROM payme_transactions
    `);

    return res.json({
      ok: true,
      total_balance: Number(totalBalanceQ.rows[0]?.total_balance || 0),
      total_topups: Number(totalTopupsQ.rows[0]?.total_topups || 0),
      total_refunds: Number(totalRefundsQ.rows[0]?.total_refunds || 0),
      total_debits: Number(totalDebitsQ.rows[0]?.total_debits || 0),
      clients_with_balance: Number(clientsWithBalanceQ.rows[0]?.cnt || 0),
      payme_tx_count: Number(txCountQ.rows[0]?.cnt || 0),
    });
  } catch (e) {
    console.error("adminBillingSummary error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function adminBillingClients(req, res) {
  const limit = clampInt(req.query.limit, 100, 1, 500);
  const offset = clampInt(req.query.offset, 0, 0, 1000000);
  const q = String(req.query.q || "").trim();

  try {
    const sql = `
      WITH balances AS (
        SELECT
          l.client_id,
          COALESCE(SUM(l.amount), 0)::bigint AS balance,
          COALESCE(SUM(CASE WHEN l.amount > 0 THEN l.amount ELSE 0 END), 0)::bigint AS total_in,
          COALESCE(SUM(CASE WHEN l.amount < 0 THEN ABS(l.amount) ELSE 0 END), 0)::bigint AS total_out,
          MAX(l.created_at) AS last_operation_at
        FROM contact_balance_ledger l
        GROUP BY l.client_id
      )
      SELECT
        b.client_id,
        b.balance,
        b.total_in,
        b.total_out,
        b.last_operation_at
      FROM balances b
      WHERE (
        $1::text IS NULL
        OR CAST(b.client_id AS text) ILIKE $1
      )
      ORDER BY b.balance DESC, b.client_id DESC
      LIMIT $2 OFFSET $3
    `;

    const like = q ? `%${q}%` : null;
    const { rows } = await pool.query(sql, [like, limit, offset]);

    return res.json({
      ok: true,
      rows,
      limit,
      offset,
    });
  } catch (e) {
    console.error("adminBillingClients error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function adminBillingLedger(req, res) {
  const limit = clampInt(req.query.limit, 100, 1, 500);
  const offset = clampInt(req.query.offset, 0, 0, 1000000);
  const clientId = req.query.clientId ? Number(req.query.clientId) : null;
  const reason = String(req.query.reason || "").trim();
  const source = String(req.query.source || "").trim();

  try {
    const sql = `
      SELECT
        id,
        client_id,
        amount,
        reason,
        source,
        service_id,
        meta,
        created_at
      FROM contact_balance_ledger
      WHERE ($1::bigint IS NULL OR client_id = $1)
        AND ($2::text IS NULL OR reason = $2)
        AND ($3::text IS NULL OR source = $3)
      ORDER BY created_at DESC, id DESC
      LIMIT $4 OFFSET $5
    `;

    const { rows } = await pool.query(sql, [
      Number.isFinite(clientId) ? clientId : null,
      reason || null,
      source || null,
      limit,
      offset,
    ]);

    return res.json({
      ok: true,
      rows,
      limit,
      offset,
    });
  } catch (e) {
    console.error("adminBillingLedger error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function adminBillingAdjust(req, res) {
  const clientId = Number(req.body?.client_id);
  const amount = Number(req.body?.amount);
  const note = String(req.body?.note || "").trim();

  if (!Number.isFinite(clientId) || clientId <= 0) {
    return res.status(400).json({ ok: false, message: "Bad client_id" });
  }

  if (!Number.isFinite(amount) || amount === 0) {
    return res.status(400).json({ ok: false, message: "Bad amount" });
  }

  if (!note) {
    return res.status(400).json({ ok: false, message: "Note is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existsQ = await client.query(`SELECT id FROM clients WHERE id=$1`, [clientId]);
    if (!existsQ.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, message: "Client not found" });
    }

    const ins = await client.query(
      `
      INSERT INTO contact_balance_ledger
        (client_id, amount, reason, source, service_id, meta)
      VALUES
        ($1, $2, 'manual_adjustment', 'admin', NULL, $3)
      RETURNING id, created_at
      `,
      [
        clientId,
        Math.trunc(amount),
        {
          note,
          adjusted_by: "admin",
        },
      ]
    );

    await client.query("COMMIT");

    return res.json({
      ok: true,
      row: {
        id: ins.rows[0]?.id || null,
        created_at: ins.rows[0]?.created_at || null,
      },
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("adminBillingAdjust error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  } finally {
    client.release();
  }
}

async function adminGetContactUnlockSettings(req, res) {
  try {
    const settings = await getContactUnlockSettings(pool);

    return res.json({
      ok: true,
      ...settings,
      default_price: DEFAULT_CONTACT_UNLOCK_PRICE,
    });
  } catch (e) {
    console.error("adminGetContactUnlockSettings error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function adminSetContactUnlockSettings(req, res) {
  const body = req.body || {};
  const hasIsPaid = Object.prototype.hasOwnProperty.call(body, "is_paid");
  const hasPrice = Object.prototype.hasOwnProperty.call(body, "price");

  if (!hasIsPaid && !hasPrice) {
    return res.status(400).json({ ok: false, message: "Nothing to update" });
  }

  try {
    const current = await getContactUnlockSettings(pool);

    const saved = await setContactUnlockSettings(pool, {
      isPaid: hasIsPaid ? !!body.is_paid : current.is_paid,
      price: hasPrice ? body.price : current.price,
    });

    return res.json({
      ok: true,
      ...saved,
      default_price: DEFAULT_CONTACT_UNLOCK_PRICE,
    });
  } catch (e) {
    console.error("adminSetContactUnlockSettings error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

module.exports = {
  adminBillingSummary,
  adminBillingClients,
  adminBillingLedger,
  adminBillingAdjust,
  adminGetContactUnlockSettings,
  adminSetContactUnlockSettings,
};
