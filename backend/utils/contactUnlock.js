// backend/utils/contactUnlock.js

async function getClientsBalanceColumn(db) {
  const { rows } = await db.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'clients'
      AND column_name IN ('contact_balance', 'contact_balance_tiyin', 'balance_tiyin', 'balance')
    LIMIT 1
    `
  );
  return rows[0]?.column_name || null;
}

async function getBalanceFromLedger(db, clientId) {
  const { rows } = await db.query(
    `
    SELECT COALESCE(SUM(amount),0)::bigint AS balance
    FROM contact_balance_ledger
    WHERE client_id=$1
    `,
    [clientId]
  );
  return Number(rows[0]?.balance || 0);
}

async function syncClientBalanceMirror(db, clientId) {
  const col = await getClientsBalanceColumn(db);
  if (!col) return;

  const balance = await getBalanceFromLedger(db, clientId);

  await db.query(
    `UPDATE clients SET ${col}=$1 WHERE id=$2`,
    [balance, clientId]
  );
}

async function unlockContactTx(db, { clientId, serviceId, price, source = "web" }) {
  const safePrice = Math.abs(Number(price) || 0);

  // 1. lock клиента
  await db.query(`SELECT id FROM clients WHERE id=$1 FOR UPDATE`, [clientId]);

  // 2. уже открыт?
  const already = await db.query(
    `
    SELECT id
    FROM client_service_contact_unlocks
    WHERE client_id=$1 AND service_id=$2
    LIMIT 1
    `,
    [clientId, serviceId]
  );

  if (already.rowCount > 0) {
    const balance = await getBalanceFromLedger(db, clientId);
    return { ok: true, already: true, balance };
  }

  // 3. баланс через ledger
  const balance = await getBalanceFromLedger(db, clientId);

  if (balance < safePrice) {
    return { ok: false, reason: "no_balance", balance, need: safePrice };
  }

  // 4. фиксируем unlock
  await db.query(
    `
    INSERT INTO client_service_contact_unlocks
      (client_id, service_id, price_charged, source)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT DO NOTHING
    `,
    [clientId, serviceId, safePrice, source]
  );

  // 5. списание через ledger
  await db.query(
    `
    INSERT INTO contact_balance_ledger
      (client_id, amount, reason, service_id, source, meta)
    VALUES ($1,$2,'unlock_contact',$3,$4,$5::jsonb)
    `,
    [
      clientId,
      -safePrice,
      serviceId,
      source,
      JSON.stringify({ service_id: serviceId }),
    ]
  );

  // 6. синк зеркала
  await syncClientBalanceMirror(db, clientId);

  const newBalance = await getBalanceFromLedger(db, clientId);

  return { ok: true, already: false, balance: newBalance };
}

module.exports = {
  getBalanceFromLedger,
  syncClientBalanceMirror,
  unlockContactTx,
};
