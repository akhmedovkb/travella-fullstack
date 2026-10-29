CREATE TABLE IF NOT EXISTS service_correction_reminders (
  id BIGSERIAL PRIMARY KEY,
  service_id BIGINT NOT NULL,
  request_id TEXT NOT NULL,
  requested_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  state TEXT NOT NULL DEFAULT 'reserved',
  sent_at TIMESTAMPTZ,
  error_code TEXT
);
CREATE INDEX IF NOT EXISTS idx_service_correction_reminders_request
  ON service_correction_reminders(service_id, request_id, created_at DESC);
