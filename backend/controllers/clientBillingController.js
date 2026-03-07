const pool = require("../db");

const CONTACT_UNLOCK_PRICE = Number(process.env.CONTACT_UNLOCK_PRICE || 10000);

let _clientsBalanceColumn = null;

async function getClientsBalanceColumn(client) {
  if (_clientsBalanceColumn !== null) return _clientsBalanceColumn;

  const r = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name='clients'
  `);

  const names = r.rows.map((x) => x.column_name);

  const candidates = [
    "contact_balance",
    "balance",
    "wallet_balance"
  ];

  for (const c of candidates) {
    if (names.includes(c)) {
      _clientsBalanceColumn = c;
      return c;
    }
  }

  _clientsBalanceColumn = null;
  return null;
}

async function getBalanceFromLedger(client, clientId) {
  const { rows } = await client.query(
    `
    SELECT COALESCE(SUM(amount),0)::bigint AS balance
    FROM contact_balance_ledger
    WHERE client_id=$1
  `,
    [clientId]
  );

  return Number(rows[0]?.balance || 0);
}

async function syncClientBalanceMirror(client, clientId) {
  const col = await getClientsBalanceColumn(client);
  const balance = await getBalanceFromLedger(client, clientId);

  if (col) {
    await client.query(
      `
      UPDATE clients
      SET ${col}=$2
      WHERE id=$1
      `,
      [clientId, balance]
    );
  }

  return balance;
}

async function getClientBalance(req, res) {
  const clientId = req.user.id;

  try {
    const client = await pool.connect();

    try {
      const balance = await getBalanceFromLedger(client, clientId);

      res.json({
        ok: true,
        balance,
        unlock_price: CONTACT_UNLOCK_PRICE
      });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
}

async function unlockContact(req, res) {
  const clientId = req.user.id;
  const serviceId = Number(req.body.service_id);

  if (!serviceId) {
    return res.status(400).json({ ok: false });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const price = CONTACT_UNLOCK_PRICE;

    const existing = await client.query(
      `
      SELECT id
      FROM client_service_contact_unlocks
      WHERE client_id=$1
      AND service_id=$2
      LIMIT 1
      `,
      [clientId, serviceId]
    );

    if (existing.rows.length) {
      const balance = await getBalanceFromLedger(client, clientId);

      await client.query("ROLLBACK");

      return res.json({
        ok: true,
        already: true,
        balance
      });
    }

    const balance = await getBalanceFromLedger(client, clientId);

    if (balance < price) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        ok: false,
        error: "not_enough_balance",
        balance
      });
    }

    await client.query(
      `
      INSERT INTO contact_balance_ledger
      (client_id, amount, reason, service_id, source, meta)
      VALUES ($1,$2,'unlock_contact',$3,'web',$4::jsonb)
      `,
      [
        clientId,
        -price,
        serviceId,
        JSON.stringify({ service_id: serviceId })
      ]
    );

    await client.query(
      `
      INSERT INTO client_service_contact_unlocks
      (client_id, service_id)
      VALUES ($1,$2)
      `,
      [clientId, serviceId]
    );

    const newBalance = await syncClientBalanceMirror(client, clientId);

    await client.query("COMMIT");

    res.json({
      ok: true,
      balance: newBalance
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ ok: false });
  } finally {
    client.release();
  }
}

module.exports = {
  getClientBalance,
  unlockContact
};
