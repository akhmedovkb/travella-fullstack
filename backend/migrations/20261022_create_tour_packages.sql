CREATE TABLE IF NOT EXISTS tour_packages (
  id UUID PRIMARY KEY,
  owner_provider_id BIGINT NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  currency VARCHAR(8) NOT NULL DEFAULT 'UZS',
  net_total NUMERIC(18,2) NOT NULL DEFAULT 0,
  markup_type VARCHAR(16) NOT NULL DEFAULT 'percent',
  markup_value NUMERIC(18,2) NOT NULL DEFAULT 0,
  gross_total NUMERIC(18,2) NOT NULL DEFAULT 0,
  pax_adult INTEGER NOT NULL DEFAULT 0,
  pax_child INTEGER NOT NULL DEFAULT 0,
  start_date DATE,
  end_date DATE,
  quote_valid_until TIMESTAMPTZ,
  route JSONB NOT NULL DEFAULT '{}'::jsonb,
  itinerary JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tour_packages_status_chk CHECK (status IN (
    'draft', 'request_sent', 'partially_confirmed', 'confirmed',
    'proposed', 'booked', 'paid', 'cancelled'
  )),
  CONSTRAINT tour_packages_markup_type_chk CHECK (markup_type IN ('percent', 'fixed')),
  CONSTRAINT tour_packages_nonnegative_chk CHECK (
    net_total >= 0 AND markup_value >= 0 AND gross_total >= 0
    AND pax_adult >= 0 AND pax_child >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_tour_packages_owner_updated
  ON tour_packages(owner_provider_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_tour_packages_status
  ON tour_packages(status, updated_at DESC);

