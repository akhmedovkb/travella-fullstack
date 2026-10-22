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
  client_name TEXT,
  client_phone TEXT,
  client_email TEXT,
  client_company TEXT,
  share_token_hash VARCHAR(64),
  shared_at TIMESTAMPTZ,
  share_expires_at TIMESTAMPTZ,
  proposal_response VARCHAR(32),
  proposal_response_message TEXT,
  proposal_responded_at TIMESTAMPTZ,
  booking_reference VARCHAR(32),
  booked_at TIMESTAMPTZ,
  payment_status VARCHAR(16) NOT NULL DEFAULT 'unpaid',
  paid_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  payment_due_at TIMESTAMPTZ,
  payment_note TEXT,
  paid_at TIMESTAMPTZ,
  current_revision INTEGER NOT NULL DEFAULT 0,
  accepted_revision INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tour_packages_status_chk CHECK (status IN (
    'draft', 'request_sent', 'partially_confirmed', 'confirmed',
    'proposed', 'booked', 'paid', 'cancelled'
  )),
  CONSTRAINT tour_packages_markup_type_chk CHECK (markup_type IN ('percent', 'fixed')),
  CONSTRAINT tour_packages_payment_status_chk CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
  CONSTRAINT tour_packages_nonnegative_chk CHECK (
    net_total >= 0 AND markup_value >= 0 AND gross_total >= 0
    AND pax_adult >= 0 AND pax_child >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_tour_packages_owner_updated
  ON tour_packages(owner_provider_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_tour_packages_status
  ON tour_packages(status, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tour_packages_share_token
  ON tour_packages(share_token_hash) WHERE share_token_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tour_packages_booking_reference
  ON tour_packages(booking_reference) WHERE booking_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS tour_package_revisions (
  id BIGSERIAL PRIMARY KEY,
  package_id UUID NOT NULL REFERENCES tour_packages(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(package_id, version)
);

CREATE INDEX IF NOT EXISTS idx_tour_package_revisions_package
  ON tour_package_revisions(package_id, version DESC);

CREATE TABLE IF NOT EXISTS tour_package_payment_events (
  id BIGSERIAL PRIMARY KEY,
  package_id UUID NOT NULL REFERENCES tour_packages(id) ON DELETE CASCADE,
  payment_status VARCHAR(16) NOT NULL,
  paid_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  payment_due_at TIMESTAMPTZ,
  payment_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tour_package_payment_events_package
  ON tour_package_payment_events(package_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tour_package_travelers (
  id BIGSERIAL PRIMARY KEY,
  package_id UUID NOT NULL REFERENCES tour_packages(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  traveler_type VARCHAR(16) NOT NULL DEFAULT 'adult',
  birth_date DATE,
  citizenship TEXT,
  passport_number TEXT,
  passport_expiry DATE,
  room_type TEXT,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tour_package_travelers_type_chk CHECK (traveler_type IN ('adult','child'))
);

CREATE INDEX IF NOT EXISTS idx_tour_package_travelers_package
  ON tour_package_travelers(package_id, sort_order, id);

CREATE TABLE IF NOT EXISTS tour_package_component_ops (
  id BIGSERIAL PRIMARY KEY,
  package_id UUID NOT NULL REFERENCES tour_packages(id) ON DELETE CASCADE,
  booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  confirmation_reference TEXT,
  supplier_payment_due_at DATE,
  supplier_paid BOOLEAN NOT NULL DEFAULT FALSE,
  operational_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(package_id, booking_id)
);

CREATE INDEX IF NOT EXISTS idx_tour_package_component_ops_package
  ON tour_package_component_ops(package_id, booking_id);

