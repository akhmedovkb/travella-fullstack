//backend/utils/contactUnlockSettings.js

const DEFAULT_CONTACT_UNLOCK_PRICE = Number(process.env.CONTACT_UNLOCK_PRICE || 10000);

let _settingsTableReady = false;

function normalizePrice(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return DEFAULT_CONTACT_UNLOCK_PRICE;
  return Math.max(0, Math.trunc(n));
}

async function ensureContactUnlockSettingsTable(db) {
  if (_settingsTableReady) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS contact_unlock_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      is_paid BOOLEAN NOT NULL DEFAULT TRUE,
      price INTEGER NOT NULL DEFAULT ${Math.max(0, Math.trunc(DEFAULT_CONTACT_UNLOCK_PRICE))},
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT contact_unlock_settings_singleton CHECK (id = 1)
    );
  `);

  await db.query(`
    INSERT INTO contact_unlock_settings (id, is_paid, price)
    VALUES (1, TRUE, $1)
    ON CONFLICT (id) DO NOTHING
  `, [Math.max(0, Math.trunc(DEFAULT_CONTACT_UNLOCK_PRICE))]);

  _settingsTableReady = true;
}

async function getContactUnlockSettings(db) {
  await ensureContactUnlockSettingsTable(db);

  const r = await db.query(`
    SELECT id, is_paid, price, updated_at
    FROM contact_unlock_settings
    WHERE id = 1
    LIMIT 1
  `);

  const row = r.rows[0] || {
    is_paid: true,
    price: DEFAULT_CONTACT_UNLOCK_PRICE,
    updated_at: null,
  };

  const isPaid = !!row.is_paid;
  const price = normalizePrice(row.price);

  return {
    is_paid: isPaid,
    price,
    effective_price: isPaid ? price : 0,
    updated_at: row.updated_at || null,
  };
}

async function setContactUnlockSettings(db, { isPaid, price }) {
  await ensureContactUnlockSettingsTable(db);

  const nextPaid = !!isPaid;
  const nextPrice = normalizePrice(price);

  const r = await db.query(
    `
    UPDATE contact_unlock_settings
    SET
      is_paid = $1,
      price = $2,
      updated_at = NOW()
    WHERE id = 1
    RETURNING id, is_paid, price, updated_at
    `,
    [nextPaid, nextPrice]
  );

  const row = r.rows[0];

  return {
    is_paid: !!row.is_paid,
    price: normalizePrice(row.price),
    effective_price: row.is_paid ? normalizePrice(row.price) : 0,
    updated_at: row.updated_at || null,
  };
}

module.exports = {
  DEFAULT_CONTACT_UNLOCK_PRICE,
  getContactUnlockSettings,
  setContactUnlockSettings,
};
