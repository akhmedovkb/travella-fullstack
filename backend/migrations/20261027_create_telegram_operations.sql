CREATE TABLE IF NOT EXISTS telegram_support_tickets (
  id BIGSERIAL PRIMARY KEY,
  actor_role VARCHAR(16) NOT NULL CHECK (actor_role IN ('client', 'provider')),
  actor_id BIGINT NOT NULL,
  chat_id TEXT NOT NULL,
  category VARCHAR(32) NOT NULL,
  booking_id BIGINT REFERENCES bookings(id) ON DELETE SET NULL,
  review_id BIGINT REFERENCES reviews(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  priority VARCHAR(12) NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'critical')),
  admin_note TEXT,
  assigned_to BIGINT,
  first_response_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE telegram_support_tickets ADD COLUMN IF NOT EXISTS assigned_to BIGINT;
ALTER TABLE telegram_support_tickets ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ;
ALTER TABLE telegram_support_tickets ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;
UPDATE telegram_support_tickets SET due_at=created_at + CASE WHEN priority='critical' THEN INTERVAL '1 hour' WHEN priority='high' THEN INTERVAL '4 hours' ELSE INTERVAL '24 hours' END WHERE due_at IS NULL;

CREATE TABLE IF NOT EXISTS telegram_support_messages (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES telegram_support_tickets(id) ON DELETE CASCADE,
  sender_role VARCHAR(16) NOT NULL,
  sender_id BIGINT,
  message TEXT,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_telegram_support_messages_ticket ON telegram_support_messages(ticket_id, created_at);

CREATE INDEX IF NOT EXISTS idx_telegram_support_tickets_actor
  ON telegram_support_tickets(actor_role, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_support_tickets_queue
  ON telegram_support_tickets(status, priority, created_at);

CREATE TABLE IF NOT EXISTS telegram_notification_preferences (
  actor_role VARCHAR(16) NOT NULL CHECK (actor_role IN ('client', 'provider')),
  actor_id BIGINT NOT NULL,
  chat_id TEXT NOT NULL,
  booking_updates BOOLEAN NOT NULL DEFAULT TRUE,
  request_updates BOOLEAN NOT NULL DEFAULT TRUE,
  review_updates BOOLEAN NOT NULL DEFAULT TRUE,
  learning_updates BOOLEAN NOT NULL DEFAULT TRUE,
  marketing_updates BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (actor_role, actor_id)
);

CREATE TABLE IF NOT EXISTS telegram_bot_events (
  id BIGSERIAL PRIMARY KEY,
  actor_role VARCHAR(16),
  actor_id BIGINT,
  chat_id TEXT,
  event_type VARCHAR(48) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telegram_bot_events_type_date
  ON telegram_bot_events(event_type, created_at DESC);

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS response_text TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS response_at TIMESTAMPTZ;
