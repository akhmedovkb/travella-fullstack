// backend/controllers/adminContactBalanceController.js
const pool = require("../db");

let _clientsColsCache = null;
let _ledgerColsCache = null;

async function getClientsColumns() {
  if (_clientsColsCache) return _clientsColsCache;

  const { rows } = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='clients'
  `);

  _clientsColsCache = new Set(rows.map((r) => r.column_name));
  return _clientsColsCache;
}

async function getLedgerColumns() {
  if (_ledgerColsCache) return _ledgerColsCache;

  const { rows } = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='contact_balance_ledger'
  `);

  _ledgerColsCache = new Set(rows.map((r) => r.column_name));
  return _ledgerColsCache;
}

function pickFirstExisting(cols, candidates) {
  for (const c of candidates) {
    if (cols.has(c)) return c;
  }
  return null;
}

async function getClientsBalanceColumn(client) {
  const { rows } = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='clients'
  `);

  const cols = new Set(rows.map((r) => r.column_name));
  return (
    pickFirstExisting(cols, [
      "contact_balance",
      "contact_balance_tiyin",
      "balance_tiyin",
      "balance",
      "wallet_balance",
    ]) || null
  );
}

async function getBalanceFromLedger(client, clientId) {
  const { rows } = await client.query(
    `
    SELECT COALESCE(SUM(amount), 0)::bigint AS balance
    FROM contact_balance_ledger
    WHERE client_id = $1
  `,
    [clientId]
  );

  return Number(rows[0]?.balance || 0);
}

async function syncClientBalanceMirror(client, clientId) {
  const balanceCol = await getClientsBalanceColumn(client);
  const balance = await getBalanceFromLedger(client, clientId);

  if (balanceCol) {
    await client.query(
      `
      UPDATE clients
      SET ${balanceCol} = $2
      WHERE id = $1
    `,
      [clientId, balance]
    );
  }

  return balance;
}

async function searchClients(req, res) {
  try {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) {
      return res.json({ ok: true, items: [] });
    }

    const cols = await getClientsColumns();

    const selectCols = ["id"];
    if (cols.has("full_name")) selectCols.push("full_name");
    if (cols.has("name")) selectCols.push("name");
    if (cols.has("username")) selectCols.push("username");
    if (cols.has("phone")) selectCols.push("phone");
    if (cols.has("email")) selectCols.push("email");
    if (cols.has("telegram_chat_id")) selectCols.push("telegram_chat_id");

    const whereParts = [];
    const args = [];
    let i = 1;

    const qLike = `%${q}%`;

    if (/^\d+$/.test(q)) {
      whereParts.push(`CAST(id AS TEXT) ILIKE $${i++}`);
      args.push(qLike);
    }

    if (cols.has("full_name")) {
      whereParts.push(`COALESCE(full_name,'') ILIKE $${i++}`);
      args.push(qLike);
    }
    if (cols.has("name")) {
      whereParts.push(`COALESCE(name,'') ILIKE $${i++}`);
      args.push(qLike);
    }
    if (cols.has("username")) {
      whereParts.push(`COALESCE(username,'') ILIKE $${i++}`);
      args.push(qLike);
    }
    if (cols.has("phone")) {
      whereParts.push(`COALESCE(phone,'') ILIKE $${i++}`);
      args.push(qLike);
    }
    if (cols.has("email")) {
      whereParts.push(`COALESCE(email,'') ILIKE $${i++}`);
      args.push(qLike);
    }
    if (cols.has("telegram_chat_id")) {
      whereParts.push(`CAST(COALESCE(telegram_chat_id, 0) AS TEXT) ILIKE $${i++}`);
      args.push(qLike);
    }

    if (!whereParts.length) {
      return res.json({ ok: true, items: [] });
    }

    const sql = `
      SELECT ${selectCols.join(", ")}
      FROM clients
      WHERE ${whereParts.join(" OR ")}
      ORDER BY id DESC
      LIMIT 50
    `;

    const { rows } = await pool.query(sql, args);

    return res.json({
      ok: true,
      items: rows,
    });
  } catch (e) {
    console.error("searchClients error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function getClientContactBalance(req, res) {
  const clientId = Number(req.params.id);

  if (!Number.isFinite(clientId) || clientId <= 0) {
    return res.status(400).json({ ok: false, message: "Bad client id" });
  }

  try {
    const cols = await getClientsColumns();

    const selectCols = ["id"];
    if (cols.has("full_name")) selectCols.push("full_name");
    if (cols.has("name")) selectCols.push("name");
    if (cols.has("username")) selectCols.push("username");
    if (cols.has("phone")) selectCols.push("phone");
    if (cols.has("email")) selectCols.push("email");
    if (cols.has("telegram_chat_id")) selectCols.push("telegram_chat_id");

    const clientQ = await pool.query(
      `
      SELECT ${selectCols.join(", ")}
      FROM clients
      WHERE id = $1
      LIMIT 1
    `,
      [clientId]
    );

    if (!clientQ.rows.length) {
      return res.status(404).json({ ok: false, message: "Client not found" });
    }

    const ledgerQ = await pool.query(
      `
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
      WHERE client_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 200
    `,
      [clientId]
    );

    const statsQ = await pool.query(
      `
      SELECT
        COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0)::bigint AS total_in,
        COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0)::bigint AS total_out,

        COUNT(*) FILTER (WHERE reason = 'topup')::int AS topup_count,
        COUNT(*) FILTER (WHERE reason = 'refund')::int AS refund_count,
        COUNT(*) FILTER (WHERE reason = 'unlock_contact')::int AS unlock_count,
        COUNT(*) FILTER (WHERE reason = 'admin_adjust')::int AS admin_adjust_count,

        COALESCE(SUM(CASE WHEN reason = 'topup' THEN amount ELSE 0 END), 0)::bigint AS topup_sum,
        COALESCE(SUM(CASE WHEN reason = 'refund' THEN ABS(amount) ELSE 0 END), 0)::bigint AS refund_sum,
        COALESCE(SUM(CASE WHEN reason = 'unlock_contact' THEN ABS(amount) ELSE 0 END), 0)::bigint AS unlock_sum,
        COALESCE(SUM(CASE WHEN reason = 'admin_adjust' THEN amount ELSE 0 END), 0)::bigint AS admin_adjust_sum,

        MAX(created_at) AS last_operation_at,
        COUNT(*)::int AS ledger_rows
      FROM contact_balance_ledger
      WHERE client_id = $1
    `,
      [clientId]
    );

    const paymeQ = await pool.query(
      `
      SELECT
        t.payme_id,
        t.order_id,
        t.amount_tiyin,
        t.state,
        t.create_time,
        t.perform_time,
        t.cancel_time,
        t.reason,
        o.status AS order_status,
        o.created_at AS order_created_at,
        o.paid_at AS order_paid_at
      FROM payme_transactions t
      INNER JOIN topup_orders o ON o.id = t.order_id
      WHERE o.client_id = $1
      ORDER BY COALESCE(t.create_time, 0) DESC, t.payme_id DESC
      LIMIT 100
    `,
      [clientId]
    );

    const paymeStatsQ = await pool.query(
      `
      SELECT
        COUNT(*)::int AS tx_count,
        COUNT(*) FILTER (WHERE t.state = 1)::int AS created_count,
        COUNT(*) FILTER (WHERE t.state = 2)::int AS performed_count,
        COUNT(*) FILTER (WHERE t.state IN (-1, -2))::int AS canceled_count,
        COALESCE(SUM(CASE WHEN t.state = 2 THEN t.amount_tiyin ELSE 0 END), 0)::bigint AS performed_sum,
        COALESCE(SUM(CASE WHEN t.state IN (-1, -2) THEN t.amount_tiyin ELSE 0 END), 0)::bigint AS canceled_sum,
        MAX(COALESCE(t.perform_time, t.create_time, 0)) AS last_payme_time
      FROM payme_transactions t
      INNER JOIN topup_orders o ON o.id = t.order_id
      WHERE o.client_id = $1
    `,
      [clientId]
    );

    const balance = await getBalanceFromLedger(pool, clientId);

    return res.json({
      ok: true,
      client: clientQ.rows[0],
      balance,
      stats: statsQ.rows[0] || {
        total_in: 0,
        total_out: 0,
        topup_count: 0,
        refund_count: 0,
        unlock_count: 0,
        admin_adjust_count: 0,
        topup_sum: 0,
        refund_sum: 0,
        unlock_sum: 0,
        admin_adjust_sum: 0,
        last_operation_at: null,
        ledger_rows: 0,
      },
      payme_stats: paymeStatsQ.rows[0] || {
        tx_count: 0,
        created_count: 0,
        performed_count: 0,
        canceled_count: 0,
        performed_sum: 0,
        canceled_sum: 0,
        last_payme_time: null,
      },
      ledger: ledgerQ.rows,
      payme_transactions: paymeQ.rows,
    });
  } catch (e) {
    console.error("getClientContactBalance error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function adjustClientContactBalance(req, res) {
  const clientId = Number(req.params.id);
  const amount = Number(req.body?.amount);
  const reason = String(req.body?.reason || "admin_adjust").trim() || "admin_adjust";
  const note = String(req.body?.note || "").trim();

  if (!Number.isFinite(clientId) || clientId <= 0) {
    return res.status(400).json({ ok: false, message: "Bad client id" });
  }

  if (!Number.isFinite(amount) || amount === 0) {
    return res.status(400).json({ ok: false, message: "Bad amount" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existsQ = await client.query(
      `SELECT id FROM clients WHERE id = $1 FOR UPDATE`,
      [clientId]
    );

    if (!existsQ.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, message: "Client not found" });
    }

    const ledgerCols = await getLedgerColumns();

    const fields = [];
    const values = [];

    function push(col, val) {
      fields.push(col);
      values.push(val);
    }

    push("client_id", clientId);
    push("amount", Math.trunc(amount));

    if (ledgerCols.has("reason")) push("reason", reason);
    if (ledgerCols.has("source")) push("source", "admin");
    if (ledgerCols.has("service_id")) push("service_id", null);
    if (ledgerCols.has("meta")) {
      push("meta", {
        note,
        channel: "admin",
        kind: "manual_adjustment",
      });
    }

    const placeholders = fields.map((_, idx) => `$${idx + 1}`);

    await client.query(
      `
      INSERT INTO contact_balance_ledger
      (${fields.join(", ")})
      VALUES (${placeholders.join(", ")})
    `,
      values
    );

    const balance = await syncClientBalanceMirror(client, clientId);

    await client.query("COMMIT");

    return res.json({
      ok: true,
      client_id: clientId,
      balance,
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("adjustClientContactBalance error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  } finally {
    client.release();
  }
}

module.exports = {
  searchClients,
  getClientContactBalance,
  adjustClientContactBalance,
};
