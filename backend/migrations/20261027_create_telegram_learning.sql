CREATE TABLE IF NOT EXISTS telegram_learning_campaigns (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(80) NOT NULL UNIQUE,
  title TEXT NOT NULL,
  audience VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT telegram_learning_campaign_audience_chk CHECK (audience IN ('client', 'provider')),
  CONSTRAINT telegram_learning_campaign_status_chk CHECK (status IN ('draft', 'active', 'paused', 'archived'))
);

CREATE TABLE IF NOT EXISTS telegram_learning_lessons (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES telegram_learning_campaigns(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  delay_hours INTEGER NOT NULL DEFAULT 24,
  title TEXT NOT NULL,
  message_html TEXT NOT NULL,
  action_kind VARCHAR(40),
  action_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(campaign_id, position),
  CONSTRAINT telegram_learning_lesson_position_chk CHECK (position > 0),
  CONSTRAINT telegram_learning_lesson_delay_chk CHECK (delay_hours >= 0)
);

CREATE TABLE IF NOT EXISTS telegram_learning_enrollments (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES telegram_learning_campaigns(id) ON DELETE CASCADE,
  user_role VARCHAR(16) NOT NULL,
  user_id BIGINT NOT NULL,
  chat_id TEXT NOT NULL,
  next_lesson_position INTEGER NOT NULL DEFAULT 1,
  next_send_at TIMESTAMPTZ,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  snoozed_until TIMESTAMPTZ,
  last_sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(campaign_id, user_role, user_id),
  CONSTRAINT telegram_learning_enrollment_role_chk CHECK (user_role IN ('client', 'provider')),
  CONSTRAINT telegram_learning_enrollment_status_chk CHECK (status IN ('active', 'paused', 'unsubscribed', 'completed'))
);

CREATE INDEX IF NOT EXISTS idx_telegram_learning_enrollments_due
  ON telegram_learning_enrollments(status, next_send_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_telegram_learning_enrollments_chat
  ON telegram_learning_enrollments(chat_id, user_role);

CREATE TABLE IF NOT EXISTS telegram_learning_deliveries (
  id BIGSERIAL PRIMARY KEY,
  enrollment_id BIGINT NOT NULL REFERENCES telegram_learning_enrollments(id) ON DELETE CASCADE,
  lesson_id BIGINT NOT NULL REFERENCES telegram_learning_lessons(id) ON DELETE CASCADE,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  source VARCHAR(16) NOT NULL DEFAULT 'scheduled',
  telegram_message_id BIGINT,
  error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(enrollment_id, lesson_id),
  CONSTRAINT telegram_learning_delivery_status_chk CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  CONSTRAINT telegram_learning_delivery_source_chk CHECK (source IN ('scheduled', 'manual'))
);

