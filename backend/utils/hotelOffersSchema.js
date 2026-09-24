const db = require('../db');

async function ensureHotelOfferTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS hotel_offers (
      id SERIAL PRIMARY KEY,
      hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
      provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      supplier_type TEXT NOT NULL DEFAULT 'supplier',
      is_direct BOOLEAN NOT NULL DEFAULT false,
      currency TEXT NOT NULL DEFAULT 'UZS',
      status TEXT NOT NULL DEFAULT 'draft',
      title TEXT,
      terms JSONB NOT NULL DEFAULT '{}'::jsonb,
      valid_from DATE,
      valid_to DATE,
      last_verified_at TIMESTAMP WITHOUT TIME ZONE,
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to),
      UNIQUE (hotel_id, provider_id)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS hotel_offer_rates (
      id SERIAL PRIMARY KEY,
      offer_id INTEGER NOT NULL REFERENCES hotel_offers(id) ON DELETE CASCADE,
      room_type TEXT NOT NULL,
      meal_plan TEXT NOT NULL DEFAULT 'BB',
      residency TEXT NOT NULL DEFAULT 'all',
      date_from DATE NOT NULL,
      date_to DATE NOT NULL,
      amount NUMERIC(14,2) NOT NULL,
      allotment INTEGER,
      min_stay INTEGER NOT NULL DEFAULT 1,
      refundable BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      CHECK (date_from <= date_to),
      CHECK (amount > 0),
      CHECK (min_stay > 0)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_hotel_offers_hotel_status ON hotel_offers(hotel_id,status)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_hotel_offer_rates_lookup ON hotel_offer_rates(offer_id,date_from,date_to,room_type,meal_plan,residency)`);
}

module.exports = { ensureHotelOfferTables };
