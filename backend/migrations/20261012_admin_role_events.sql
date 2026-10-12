CREATE TABLE IF NOT EXISTS admin_role_events (
  id BIGSERIAL PRIMARY KEY,
  actor_provider_id BIGINT REFERENCES providers(id) ON DELETE SET NULL,
  target_provider_id BIGINT REFERENCES providers(id) ON DELETE SET NULL,
  action VARCHAR(32) NOT NULL CHECK (action IN ('granted', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_role_events_created_at
  ON admin_role_events (created_at DESC);
