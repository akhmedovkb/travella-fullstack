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
);
CREATE INDEX IF NOT EXISTS vehicle_catalog_display_name_idx ON vehicle_catalog (LOWER(display_name));