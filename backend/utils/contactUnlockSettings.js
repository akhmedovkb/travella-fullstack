// backend/utils/contactUnlockSettings.js

const pool = require("../db");

const DEFAULT_CONTACT_UNLOCK_PRICE = Number(
  process.env.CONTACT_UNLOCK_PRICE || 10000
);

let _settingsTableReady = false;

function normalizePrice(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return Math.max(0, Math.trunc(DEFAULT_CONTACT_UNLOCK_PRICE || 0));
  }

  return Math.max(0, Math.trunc(n));
}

function normalizePaid(value, fallback = true) {
  if (typeof value === "undefined" || value === null) return !!fallback;

  if (typeof value === "boolean") return value;

  const s = String(value).trim().toLowerCase();

  if (["true", "1", "yes", "on", "paid"].includes(s)) return true;
  if (["false", "0", "no", "off", "free"].includes(s)) return false;

  return !!fallback;
}

function normalizeSettings(row = {}) {
  const isPaid = normalizePaid(row.is_paid, true);
  const price = normalizePrice(row.price);
  const effectivePrice = isPaid ? price : 0;

  return {
    // старый контракт
    is_paid: isPaid,
    price,
    effective_price: effectivePrice,
    updated_at: row.updated_at || null,

    // новый контракт для clientBillingController.js
    unlockIsPaid: isPaid,
    unlockPriceTiyin: effectivePrice,
    unlockBasePrice: price,

    // совместимые aliases
    unlock_price: effectivePrice,
    unlock_price_tiyin: effectivePrice,
    unlock_base_price: price,
  };
}

function getDb(db) {
  return db && typeof db.query === "function" ? db : pool;
}

async function ensureContactUnlockSettingsTable(dbArg) {
  const db = getDb(dbArg);

  if (_settingsTableReady) return;

  const defaultPrice = Math.max(
    0,
    Math.trunc(DEFAULT_CONTACT_UNLOCK_PRICE || 0)
  );

  await db.query(`
    CREATE TABLE IF NOT EXISTS contact_unlock_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      is_paid BOOLEAN NOT NULL DEFAULT TRUE,
      price INTEGER NOT NULL DEFAULT ${defaultPrice},
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT contact_unlock_settings_singleton CHECK (id = 1)
    )
  `);

  await db.query(
    `
      INSERT INTO contact_unlock_settings (
        id,
        is_paid,
        price,
        updated_at
      )
      VALUES (
        1,
        TRUE,
        $1,
        NOW()
      )
      ON CONFLICT (id)
      DO NOTHING
    `,
    [defaultPrice]
  );

  _settingsTableReady = true;
}

async function getContactUnlockSettings(dbArg) {
  const db = getDb(dbArg);

  await ensureContactUnlockSettingsTable(db);

  const { rows } = await db.query(`
    SELECT
      id,
      is_paid,
      price,
      updated_at
    FROM contact_unlock_settings
    WHERE id = 1
    LIMIT 1
  `);

  return normalizeSettings(
    rows[0] || {
      is_paid: true,
      price: DEFAULT_CONTACT_UNLOCK_PRICE,
      updated_at: null,
    }
  );
}

async function setContactUnlockSettings(dbArg, payload = {}) {
  const db = getDb(dbArg);

  await ensureContactUnlockSettingsTable(db);

  const current = await getContactUnlockSettings(db);

  const nextPaid = normalizePaid(
    payload.isPaid ??
      payload.is_paid ??
      payload.unlockIsPaid,
    current.is_paid
  );

  const nextPrice = normalizePrice(
    payload.price ??
      payload.unlockPriceTiyin ??
      payload.unlock_price_tiyin ??
      payload.unlock_base_price ??
      current.price
  );

  const { rows } = await db.query(
    `
      UPDATE contact_unlock_settings
      SET
        is_paid = $1,
        price = $2,
        updated_at = NOW()
      WHERE id = 1
      RETURNING
        id,
        is_paid,
        price,
        updated_at
    `,
    [nextPaid, nextPrice]
  );

  return normalizeSettings(rows[0]);
}

module.exports = {
  DEFAULT_CONTACT_UNLOCK_PRICE,
  ensureContactUnlockSettingsTable,
  getContactUnlockSettings,
  setContactUnlockSettings,
};
