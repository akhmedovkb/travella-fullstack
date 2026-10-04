const db = require('../db');

let hotelOfferTablesReadyPromise = null;

async function ensureHotelOfferTablesOnce() {
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
  await db.query(`ALTER TABLE hotel_offers ADD COLUMN IF NOT EXISTS rejection_reason TEXT`);
  await db.query(`ALTER TABLE hotel_offers ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITHOUT TIME ZONE`);
  await db.query(`ALTER TABLE hotel_offers ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP WITHOUT TIME ZONE`);
  await db.query(`ALTER TABLE hotel_offers ADD COLUMN IF NOT EXISTS reviewed_by BIGINT`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS hotel_offer_events (
      id BIGSERIAL PRIMARY KEY,
      offer_id INTEGER NOT NULL REFERENCES hotel_offers(id) ON DELETE CASCADE,
      actor_id BIGINT,
      actor_role TEXT,
      action TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      note TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_hotel_offer_events_offer ON hotel_offer_events(offer_id,created_at DESC)`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS hotel_inventory_reservations (
      id BIGSERIAL PRIMARY KEY,
      booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      offer_id INTEGER NOT NULL REFERENCES hotel_offers(id) ON DELETE RESTRICT,
      rate_id INTEGER NOT NULL,
      stay_date DATE NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      status TEXT NOT NULL DEFAULT 'held',
      expires_at TIMESTAMP WITHOUT TIME ZONE,
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      UNIQUE (booking_id, rate_id, stay_date)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_hotel_inventory_live ON hotel_inventory_reservations(rate_id,stay_date,status,expires_at)`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS hotel_inventory_overrides (
      id BIGSERIAL PRIMARY KEY,
      offer_id INTEGER NOT NULL REFERENCES hotel_offers(id) ON DELETE CASCADE,
      rate_id INTEGER NOT NULL,
      stay_date DATE NOT NULL,
      allotment INTEGER CHECK (allotment IS NULL OR allotment >= 0),
      stop_sell BOOLEAN NOT NULL DEFAULT false,
      note TEXT,
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      UNIQUE (rate_id, stay_date)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_hotel_inventory_overrides_lookup ON hotel_inventory_overrides(rate_id,stay_date)`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS hotel_room_inventory_pools (
      id BIGSERIAL PRIMARY KEY,
      hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
      room_type TEXT NOT NULL,
      base_inventory INTEGER NOT NULL DEFAULT 0 CHECK (base_inventory >= 0),
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      UNIQUE (hotel_id, room_type)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_hotel_room_inventory_pools_lookup ON hotel_room_inventory_pools(hotel_id,room_type)`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS hotel_room_inventory_overrides (
      id BIGSERIAL PRIMARY KEY,
      pool_id BIGINT NOT NULL REFERENCES hotel_room_inventory_pools(id) ON DELETE CASCADE,
      stay_date DATE NOT NULL,
      inventory INTEGER CHECK (inventory IS NULL OR inventory >= 0),
      stop_sell BOOLEAN NOT NULL DEFAULT false,
      note TEXT,
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      UNIQUE (pool_id, stay_date)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_hotel_room_inventory_overrides_lookup ON hotel_room_inventory_overrides(pool_id,stay_date)`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS hotel_supplier_inventory_allocations (
      id BIGSERIAL PRIMARY KEY,
      hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
      provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      pool_id BIGINT NOT NULL REFERENCES hotel_room_inventory_pools(id) ON DELETE CASCADE,
      date_from DATE NOT NULL,
      date_to DATE NOT NULL,
      allotment INTEGER NOT NULL CHECK (allotment >= 0),
      active BOOLEAN NOT NULL DEFAULT true,
      created_by BIGINT,
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      CHECK (date_from <= date_to)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_hotel_supplier_allocations_lookup
    ON hotel_supplier_inventory_allocations(hotel_id,provider_id,pool_id,date_from,date_to) WHERE active=true`);
  await db.query(`ALTER TABLE hotel_offer_rates ADD COLUMN IF NOT EXISTS inventory_pool_id BIGINT REFERENCES hotel_room_inventory_pools(id) ON DELETE RESTRICT`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_hotel_offer_rates_pool ON hotel_offer_rates(inventory_pool_id)`);
  await db.query(`
    UPDATE hotel_offer_rates r
       SET inventory_pool_id=p.id
      FROM hotel_offers o, hotel_room_inventory_pools p
     WHERE r.offer_id=o.id
       AND p.hotel_id=o.hotel_id
       AND LOWER(p.room_type)=LOWER(r.room_type)
       AND r.inventory_pool_id IS NULL
  `);
  await db.query(`
    CREATE OR REPLACE FUNCTION sync_hotel_inventory_reservation_status()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.status IN ('confirmed','completed','paid') THEN
        UPDATE hotel_inventory_reservations
           SET status='confirmed',expires_at=NULL,updated_at=NOW()
         WHERE booking_id=NEW.id AND status <> 'released';
      ELSIF NEW.status='awaiting_payment' THEN
        UPDATE hotel_inventory_reservations
           SET status='held',
               expires_at=COALESCE(NULLIF(to_jsonb(NEW)->>'hold_until','')::timestamp, NOW()+INTERVAL '30 minutes'),
               updated_at=NOW()
         WHERE booking_id=NEW.id AND status <> 'released';
      ELSIF NEW.status IN ('rejected','cancelled','cancelled_unpaid','expired') THEN
        UPDATE hotel_inventory_reservations
           SET status='released',expires_at=NULL,updated_at=NOW()
         WHERE booking_id=NEW.id AND status <> 'released';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_sync_hotel_inventory_reservation') THEN
        CREATE TRIGGER trg_sync_hotel_inventory_reservation
        AFTER UPDATE OF status ON bookings
        FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
        EXECUTE FUNCTION sync_hotel_inventory_reservation_status();
      END IF;
    END $$
  `);
}

function ensureHotelOfferTables() {
  if (!hotelOfferTablesReadyPromise) {
    hotelOfferTablesReadyPromise = ensureHotelOfferTablesOnce().catch((error) => {
      hotelOfferTablesReadyPromise = null;
      throw error;
    });
  }
  return hotelOfferTablesReadyPromise;
}

module.exports = { ensureHotelOfferTables };
