// backend/utils/providerFunnel.js
const pool = require("../db");

let _providerFunnelReady = false;

async function ensureProviderFunnelTables(db = pool) {
  if (_providerFunnelReady) return;

  // Создаём таблицу в актуальном формате.
  await db.query(`
    CREATE TABLE IF NOT EXISTS provider_funnel_events (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source TEXT NOT NULL DEFAULT 'unknown',
      actor_role TEXT,
      actor_id BIGINT,
      provider_id BIGINT,
      telegram_chat_id BIGINT,
      service_id BIGINT,
      category TEXT,
      event_name TEXT,
      event_type TEXT,
      step TEXT,
      status TEXT,
      session_id TEXT,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      payload JSONB DEFAULT '{}'::jsonb
    )
  `);

  // Миграция для уже существующей таблицы старого формата.
  await db.query(`ALTER TABLE provider_funnel_events ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'unknown'`);
  await db.query(`ALTER TABLE provider_funnel_events ADD COLUMN IF NOT EXISTS actor_role TEXT`);
  await db.query(`ALTER TABLE provider_funnel_events ADD COLUMN IF NOT EXISTS actor_id BIGINT`);
  await db.query(`ALTER TABLE provider_funnel_events ADD COLUMN IF NOT EXISTS provider_id BIGINT`);
  await db.query(`ALTER TABLE provider_funnel_events ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT`);
  await db.query(`ALTER TABLE provider_funnel_events ADD COLUMN IF NOT EXISTS service_id BIGINT`);
  await db.query(`ALTER TABLE provider_funnel_events ADD COLUMN IF NOT EXISTS category TEXT`);
  await db.query(`ALTER TABLE provider_funnel_events ADD COLUMN IF NOT EXISTS event_name TEXT`);
  await db.query(`ALTER TABLE provider_funnel_events ADD COLUMN IF NOT EXISTS event_type TEXT`);
  await db.query(`ALTER TABLE provider_funnel_events ADD COLUMN IF NOT EXISTS step TEXT`);
  await db.query(`ALTER TABLE provider_funnel_events ADD COLUMN IF NOT EXISTS status TEXT`);
  await db.query(`ALTER TABLE provider_funnel_events ADD COLUMN IF NOT EXISTS session_id TEXT`);
  await db.query(`ALTER TABLE provider_funnel_events ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await db.query(`ALTER TABLE provider_funnel_events ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'::jsonb`);

  // Старые колонки не должны блокировать INSERT нового кода.
  await db.query(`ALTER TABLE provider_funnel_events ALTER COLUMN event_type DROP NOT NULL`).catch(() => {});
  await db.query(`ALTER TABLE provider_funnel_events ALTER COLUMN payload DROP NOT NULL`).catch(() => {});

  // Синхронизируем старые и новые имена событий/метаданные.
  await db.query(`
    UPDATE provider_funnel_events
       SET event_name = COALESCE(NULLIF(event_name, ''), NULLIF(event_type, ''), 'unknown_event')
     WHERE event_name IS NULL OR event_name = ''
  `);
  await db.query(`
    UPDATE provider_funnel_events
       SET event_type = COALESCE(NULLIF(event_type, ''), NULLIF(event_name, ''), 'unknown_event')
     WHERE event_type IS NULL OR event_type = ''
  `);
  await db.query(`
    UPDATE provider_funnel_events
       SET meta = COALESCE(meta, payload, '{}'::jsonb)
     WHERE meta IS NULL
  `);
  await db.query(`
    UPDATE provider_funnel_events
       SET payload = COALESCE(payload, meta, '{}'::jsonb)
     WHERE payload IS NULL
  `);

  await db.query(`ALTER TABLE provider_funnel_events ALTER COLUMN event_name SET NOT NULL`).catch(() => {});
  await db.query(`ALTER TABLE provider_funnel_events ALTER COLUMN meta SET DEFAULT '{}'::jsonb`).catch(() => {});
  await db.query(`ALTER TABLE provider_funnel_events ALTER COLUMN payload SET DEFAULT '{}'::jsonb`).catch(() => {});

  await db.query(`CREATE INDEX IF NOT EXISTS idx_provider_funnel_created ON provider_funnel_events(created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_provider_funnel_event ON provider_funnel_events(event_name, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_provider_funnel_event_type ON provider_funnel_events(event_type, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_provider_funnel_provider ON provider_funnel_events(provider_id, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_provider_funnel_chat ON provider_funnel_events(telegram_chat_id, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_provider_funnel_service ON provider_funnel_events(service_id, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_provider_funnel_step ON provider_funnel_events(step, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_provider_funnel_category ON provider_funnel_events(category, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_provider_funnel_source ON provider_funnel_events(source, created_at DESC)`);

  // Индексы для Telegram-заявок: эта таблица есть в проде и быстро попадает в CRM/аналитику.
  await db.query(`CREATE INDEX IF NOT EXISTS idx_tqr_provider ON telegram_quick_requests(provider_id, created_at DESC)`).catch(() => {});
  await db.query(`CREATE INDEX IF NOT EXISTS idx_tqr_service ON telegram_quick_requests(service_id, created_at DESC)`).catch(() => {});
  await db.query(`CREATE INDEX IF NOT EXISTS idx_tqr_requester ON telegram_quick_requests(requester_chat_id, created_at DESC)`).catch(() => {});
  await db.query(`CREATE INDEX IF NOT EXISTS idx_tqr_awaiting ON telegram_quick_requests(awaiting_reply, created_at DESC)`).catch(() => {});

  _providerFunnelReady = true;
}

function toBigintOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function cleanString(value, max = 200) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

async function logProviderFunnelEvent(event = {}, db = pool) {
  try {
    await ensureProviderFunnelTables(db);

    const meta =
      event.meta && typeof event.meta === "object" && !Array.isArray(event.meta)
        ? event.meta
        : {};

    const eventName = cleanString(event.eventName || event.event_name || event.eventType || event.event_type, 120) || "unknown_event";
    const telegramChatId = toBigintOrNull(event.telegramChatId || event.telegram_chat_id || meta.chat_id);
    const metaJson = JSON.stringify(meta);

    await db.query(
      `
      INSERT INTO provider_funnel_events (
        source,
        actor_role,
        actor_id,
        provider_id,
        telegram_chat_id,
        service_id,
        category,
        event_name,
        event_type,
        step,
        status,
        session_id,
        meta,
        payload
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12::jsonb,$12::jsonb)
      `,
      [
        cleanString(event.source, 80) || "unknown",
        cleanString(event.actorRole || event.actor_role, 80),
        toBigintOrNull(event.actorId || event.actor_id),
        toBigintOrNull(event.providerId || event.provider_id),
        telegramChatId,
        toBigintOrNull(event.serviceId || event.service_id),
        cleanString(event.category, 120),
        eventName,
        cleanString(event.step, 160),
        cleanString(event.status, 120),
        cleanString(event.sessionId || event.session_id, 160),
        metaJson,
      ]
    );

    return true;
  } catch (err) {
    console.error("[provider-funnel] log failed:", err?.message || err);
    return false;
  }
}

module.exports = {
  ensureProviderFunnelTables,
  logProviderFunnelEvent,
};
