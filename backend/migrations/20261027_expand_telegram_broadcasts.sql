CREATE TABLE IF NOT EXISTS broadcasts (
  id BIGSERIAL PRIMARY KEY,
  created_by BIGINT,
  title TEXT,
  kind VARCHAR(24) NOT NULL DEFAULT 'education',
  audience VARCHAR(16) NOT NULL DEFAULT 'all',
  segment JSONB NOT NULL DEFAULT '{}'::jsonb,
  text TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  scheduled_at TIMESTAMPTZ,
  total INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS kind VARCHAR(24) NOT NULL DEFAULT 'education';
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS segment JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_broadcasts_scheduled
  ON broadcasts(status, scheduled_at) WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id BIGSERIAL PRIMARY KEY,
  broadcast_id BIGINT NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL,
  chat_id TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(broadcast_id, role, chat_id)
);

DELETE FROM broadcast_recipients older
USING broadcast_recipients newer
WHERE older.id < newer.id
  AND older.broadcast_id = newer.broadcast_id
  AND older.role = newer.role
  AND older.chat_id = newer.chat_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_broadcast_recipients_unique_target
  ON broadcast_recipients(broadcast_id, role, chat_id);

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_queue
  ON broadcast_recipients(broadcast_id, status, id);

