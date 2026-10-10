const pool = require("../db");

const normalizeVehicleName = (value) => String(value || "").trim().replace(/\s+/g, " ");
const normalizedKey = (value) => normalizeVehicleName(value).toLocaleLowerCase("en-US");

async function ensureVehicleCatalog(db = pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS vehicle_catalog (
      id BIGSERIAL PRIMARY KEY,
      normalized_name TEXT NOT NULL UNIQUE,
      make TEXT,
      model TEXT,
      display_name TEXT NOT NULL,
      seats INTEGER CHECK (seats IS NULL OR seats > 0),
      source TEXT NOT NULL DEFAULT 'provider',
      usage_count INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS vehicle_catalog_display_name_idx ON vehicle_catalog (LOWER(display_name))`);
}

async function upsertVehicle({ displayName, make = null, model = null, seats = null, source = "provider" }, db = pool) {
  const cleanName = normalizeVehicleName(displayName);
  if (!cleanName) return null;
  await ensureVehicleCatalog(db);
  const cleanSeats = Number.isInteger(Number(seats)) && Number(seats) > 0 ? Number(seats) : null;
  const result = await db.query(
    `INSERT INTO vehicle_catalog (normalized_name,make,model,display_name,seats,source)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (normalized_name) DO UPDATE SET
       make=COALESCE(EXCLUDED.make,vehicle_catalog.make),
       model=COALESCE(EXCLUDED.model,vehicle_catalog.model),
       display_name=EXCLUDED.display_name,
       seats=COALESCE(EXCLUDED.seats,vehicle_catalog.seats),
       usage_count=vehicle_catalog.usage_count + 1,
       updated_at=NOW()
     RETURNING display_name,seats,source`,
    [normalizedKey(cleanName), make, model, cleanName, cleanSeats, source]
  );
  return result.rows[0] || null;
}

async function upsertFleet(fleet = [], db = pool) {
  for (const vehicle of Array.isArray(fleet) ? fleet : []) {
    await upsertVehicle({ displayName: vehicle?.model, seats: vehicle?.seats, source: "provider" }, db);
  }
}

module.exports = { ensureVehicleCatalog, normalizeVehicleName, normalizedKey, upsertVehicle, upsertFleet };