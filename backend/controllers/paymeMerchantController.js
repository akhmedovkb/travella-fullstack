//backend/controllers/paymeMerchantController.js
  
const pool = require("../db");

async function getLedgerBalance(client, clientId) {
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

let _balanceColumn = null;

async function getBalanceColumn(client) {
  if (_balanceColumn !== null) return _balanceColumn;

  const r = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name='clients'
  `);

  const names = r.rows.map((x) => x.column_name);

  if (names.includes("contact_balance")) {
    _balanceColumn = "contact_balance";
  } else {
    _balanceColumn = null;
  }

  return _balanceColumn;
}

async function syncClientBalanceMirror(client, clientId) {
  const col = await getBalanceColumn(client);

  const balance = await getLedgerBalance(client, clientId);

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

async function creditLedgerOnceTx(client, { clientId, amountTiyin, orderId, paymeId }) {
  try {
    await client.query(
      `
      INSERT INTO contact_balance_ledger
      (client_id,amount,reason,source,meta)
      VALUES ($1,$2,'topup','payme',$3::jsonb)
      `,
      [
        clientId,
        amountTiyin,
        JSON.stringify({ order_id: orderId, payme_id: paymeId })
      ]
    );

    return true;
  } catch (e) {
    if (e.code === "23505") {
      return false;
    }
    throw e;
  }
}

async function debitLedgerOnceTx(client, { clientId, amountTiyin, orderId, paymeId }) {
  try {
    await client.query(
      `
      INSERT INTO contact_balance_ledger
      (client_id,amount,reason,source,meta)
      VALUES ($1,$2,'payme_refund','payme',$3::jsonb)
      `,
      [
        clientId,
        -amountTiyin,
        JSON.stringify({ order_id: orderId, payme_id: paymeId })
      ]
    );

    return true;
  } catch (e) {
    if (e.code === "23505") {
      return false;
    }
    throw e;
  }
}

async function performTransaction(client, order) {
  await creditLedgerOnceTx(client, {
    clientId: order.client_id,
    amountTiyin: order.amount_tiyin,
    orderId: order.id,
    paymeId: order.payme_id
  });

  await syncClientBalanceMirror(client, order.client_id);
}

async function cancelTransaction(client, order) {
  await debitLedgerOnceTx(client, {
    clientId: order.client_id,
    amountTiyin: order.amount_tiyin,
    orderId: order.id,
    paymeId: order.payme_id
  });

  await syncClientBalanceMirror(client, order.client_id);
}

module.exports = {
  performTransaction,
  cancelTransaction
};
