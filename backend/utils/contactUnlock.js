// backend/utils/contactUnlock.js

const { getContactUnlockSettings } = require("./contactUnlockSettings");

let _schemaReady = false;
let _balanceColumnCache = undefined;

function toInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function positiveInt(value, fallback = 0) {
  return Math.max(0, toInt(value, fallback));
}

function normalizeId(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    const e = new Error(`BAD_${String(name || "ID").toUpperCase()}`);
    e.status = 400;
    throw e;
  }
  return n;
}

function normalizeSource(source) {
  const s = String(source || "web").trim();
  return s || "web";
}

async function advisoryLock(db, key) {
  await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [String(key)]);
}

async function ensureContactUnlockSchema(db) {
  if (_schemaReady) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS contact_balance_ledger (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NOT NULL,
      amount BIGINT NOT NULL,
      reason TEXT,
      service_id BIGINT,
      source TEXT,
      meta JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    ALTER TABLE contact_balance_ledger
      ADD COLUMN IF NOT EXISTS reason TEXT,
      ADD COLUMN IF NOT EXISTS type TEXT,
      ADD COLUMN IF NOT EXISTS note TEXT,
      ADD COLUMN IF NOT EXISTS service_id BIGINT,
      ADD COLUMN IF NOT EXISTS source TEXT,
      ADD COLUMN IF NOT EXISTS meta JSONB,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_contact_balance_ledger_client_id
      ON contact_balance_ledger(client_id)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_contact_balance_ledger_service_id
      ON contact_balance_ledger(service_id)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_contact_balance_ledger_reason
      ON contact_balance_ledger(reason)
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS client_service_contact_unlocks (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NOT NULL,
      service_id BIGINT NOT NULL,
      price_charged BIGINT NOT NULL DEFAULT 0,
      source TEXT,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (client_id, service_id)
    )
  `);

  await db.query(`
    ALTER TABLE client_service_contact_unlocks
      ADD COLUMN IF NOT EXISTS price_charged BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS source TEXT,
      ADD COLUMN IF NOT EXISTS note TEXT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_client_service_contact_unlocks_unique
      ON client_service_contact_unlocks(client_id, service_id)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_client_service_contact_unlocks_client
      ON client_service_contact_unlocks(client_id)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_client_service_contact_unlocks_service
      ON client_service_contact_unlocks(service_id)
  `);

  try {
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_contact_ledger_unlock_once
        ON contact_balance_ledger (client_id, service_id, reason)
        WHERE reason IN ('unlock_contact', 'unlock_contacts')
    `);
  } catch (e) {
    console.warn(
      "[contactUnlock] ux_contact_ledger_unlock_once not created:",
      e?.message || e
    );
  }

  _schemaReady = true;
}

async function getClientsBalanceColumn(db) {
  if (_balanceColumnCache !== undefined) return _balanceColumnCache;

  const { rows } = await db.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'clients'
        AND column_name IN (
          'contact_balance',
          'contact_balance_tiyin',
          'balance_tiyin',
          'balance',
          'wallet_balance'
        )
      ORDER BY CASE column_name
        WHEN 'contact_balance' THEN 1
        WHEN 'contact_balance_tiyin' THEN 2
        WHEN 'balance_tiyin' THEN 3
        WHEN 'balance' THEN 4
        WHEN 'wallet_balance' THEN 5
        ELSE 99
      END
      LIMIT 1
    `
  );

  _balanceColumnCache = rows[0]?.column_name || null;
  return _balanceColumnCache;
}

async function getBalanceFromLedger(db, clientId) {
  const cid = normalizeId(clientId, "client_id");
  await ensureContactUnlockSchema(db);

  const { rows } = await db.query(
    `
      SELECT COALESCE(SUM(amount), 0)::bigint AS balance
      FROM contact_balance_ledger
      WHERE client_id = $1
    `,
    [cid]
  );

  return Number(rows[0]?.balance || 0);
}

async function syncClientBalanceMirror(db, clientId) {
  const cid = normalizeId(clientId, "client_id");
  await ensureContactUnlockSchema(db);

  const col = await getClientsBalanceColumn(db);
  const balance = await getBalanceFromLedger(db, cid);

  if (col) {
    await db.query(`UPDATE clients SET ${col} = $1 WHERE id = $2`, [balance, cid]);
  }

  return balance;
}

async function resolveUnlockPrice(db, explicitPrice, skipBalanceDeduction = false) {
  if (skipBalanceDeduction) return 0;

  if (typeof explicitPrice !== "undefined" && explicitPrice !== null) {
    return positiveInt(explicitPrice, 0);
  }

  const settings = await getContactUnlockSettings(db);
  const isPaid =
    typeof settings.unlockIsPaid !== "undefined"
      ? !!settings.unlockIsPaid
      : typeof settings.is_paid !== "undefined"
      ? !!settings.is_paid
      : true;

  if (!isPaid) return 0;

  return positiveInt(
    settings.unlockPriceTiyin ??
      settings.effective_price ??
      settings.price ??
      process.env.CONTACT_UNLOCK_PRICE ??
      10000,
    10000
  );
}

async function getExistingUnlock(db, clientId, serviceId) {
  const { rows } = await db.query(
    `
      SELECT id, price_charged, source, created_at
      FROM client_service_contact_unlocks
      WHERE client_id = $1
        AND service_id = $2
      LIMIT 1
    `,
    [clientId, serviceId]
  );

  return rows[0] || null;
}

async function insertUnlockRow(db, { clientId, serviceId, price, source, note = null }) {
  const { rows } = await db.query(
    `
      INSERT INTO client_service_contact_unlocks
        (client_id, service_id, price_charged, source, note)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (client_id, service_id)
      DO NOTHING
      RETURNING id, price_charged, source, created_at
    `,
    [clientId, serviceId, price, source, note]
  );

  return rows[0] || null;
}

async function insertUnlockDebit(db, { clientId, serviceId, price, source }) {
  if (price <= 0) {
    return { inserted: false, skipped: true };
  }

  const meta = {
    service_id: serviceId,
    idempotency_key: `unlock_contact:${clientId}:${serviceId}`,
  };

  const { rows } = await db.query(
    `
      INSERT INTO contact_balance_ledger
        (client_id, amount, reason, type, note, service_id, source, meta)
      SELECT
        $1,
        $2,
        'unlock_contact',
        'unlock_contact',
        $3,
        $4,
        $5,
        $6::jsonb
      WHERE NOT EXISTS (
        SELECT 1
        FROM contact_balance_ledger
        WHERE client_id = $1
          AND service_id = $4
          AND reason IN ('unlock_contact', 'unlock_contacts')
      )
      RETURNING id
    `,
    [
      clientId,
      -Math.abs(price),
      `Unlock contact for service #${serviceId}`,
      serviceId,
      source,
      JSON.stringify(meta),
    ]
  );

  return { inserted: !!rows[0], skipped: false, ledgerId: rows[0]?.id || null };
}

async function unlockContactTx(
  db,
  {
    clientId,
    serviceId,
    price,
    source = "web",
    skipBalanceDeduction = false,
    note = null,
  }
) {
  const cid = normalizeId(clientId, "client_id");
  const sid = normalizeId(serviceId, "service_id");
  const src = normalizeSource(source);

  await ensureContactUnlockSchema(db);
  await advisoryLock(db, `unlock:${cid}:${sid}`);

  const clientLock = await db.query(`SELECT id FROM clients WHERE id = $1 FOR UPDATE`, [cid]);
  if (!clientLock.rowCount) {
    const e = new Error("CLIENT_NOT_FOUND");
    e.status = 404;
    throw e;
  }

  const existing = await getExistingUnlock(db, cid, sid);
  if (existing) {
    const balance = await syncClientBalanceMirror(db, cid);
    return {
      ok: true,
      already: true,
      alreadyUnlocked: true,
      unlocked: true,
      charged: 0,
      price: Number(existing.price_charged || 0),
      balance,
      unlock_id: existing.id,
    };
  }

  const safePrice = await resolveUnlockPrice(db, price, skipBalanceDeduction);
  const balanceBefore = await getBalanceFromLedger(db, cid);

  if (!skipBalanceDeduction && safePrice > 0 && balanceBefore < safePrice) {
    return {
      ok: false,
      unlocked: false,
      already: false,
      alreadyUnlocked: false,
      reason: "no_balance",
      balance: balanceBefore,
      need: safePrice,
      deficit: safePrice - balanceBefore,
    };
  }

  const insertedUnlock = await insertUnlockRow(db, {
    clientId: cid,
    serviceId: sid,
    price: safePrice,
    source: src,
    note,
  });

  if (!insertedUnlock) {
    const balance = await syncClientBalanceMirror(db, cid);
    const row = await getExistingUnlock(db, cid, sid);
    return {
      ok: true,
      already: true,
      alreadyUnlocked: true,
      unlocked: true,
      charged: 0,
      price: Number(row?.price_charged || safePrice),
      balance,
      unlock_id: row?.id || null,
    };
  }

  const debit = await insertUnlockDebit(db, {
    clientId: cid,
    serviceId: sid,
    price: skipBalanceDeduction ? 0 : safePrice,
    source: src,
  });

  const balanceAfter = await syncClientBalanceMirror(db, cid);

  return {
    ok: true,
    already: false,
    alreadyUnlocked: false,
    unlocked: true,
    charged: debit.inserted ? safePrice : 0,
    price: safePrice,
    balance: balanceAfter,
    unlock_id: insertedUnlock.id,
    ledger_debit_inserted: debit.inserted,
  };
}

async function unlockContactSafe({
  client,
  db,
  clientId,
  serviceId,
  price,
  source = "payme_auto_unlock",
  skipBalanceDeduction = false,
  note = null,
}) {
  const conn = client || db;
  if (!conn || typeof conn.query !== "function") {
    throw new Error("DB_CLIENT_REQUIRED");
  }

  return unlockContactTx(conn, {
    clientId,
    serviceId,
    price,
    source,
    skipBalanceDeduction,
    note,
  });
}

module.exports = {
  ensureContactUnlockSchema,
  getClientsBalanceColumn,
  getBalanceFromLedger,
  syncClientBalanceMirror,
  unlockContactTx,
  unlockContactSafe,
};
