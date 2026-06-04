// backend/utils/providerFunnel.js
const pool = require("../db");

let _providerFunnelReady = false;

async function ensureProviderFunnelTables(db = pool) {
  if (_providerFunnelReady) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS provider_funnel_events (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source TEXT NOT NULL DEFAULT 'unknown',
      actor_role TEXT,
      actor_id BIGINT,
      provider_id BIGINT,
      service_id BIGINT,
      category TEXT,
      event_name TEXT NOT NULL,
      step TEXT,
      status TEXT,
      session_id TEXT,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_provider_funnel_created ON provider_funnel_events(created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_provider_funnel_event ON provider_funnel_events(event_name, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_provider_funnel_provider ON provider_funnel_events(provider_id, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_provider_funnel_service ON provider_funnel_events(service_id, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_provider_funnel_step ON provider_funnel_events(step, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_provider_funnel_category ON provider_funnel_events(category, created_at DESC)`);

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

    await db.query(
      `
      INSERT INTO provider_funnel_events (
        source,
        actor_role,
        actor_id,
        provider_id,
        service_id,
        category,
        event_name,
        step,
        status,
        session_id,
        meta
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
      `,
      [
        cleanString(event.source, 80) || "unknown",
        cleanString(event.actorRole || event.actor_role, 80),
        toBigintOrNull(event.actorId || event.actor_id),
        toBigintOrNull(event.providerId || event.provider_id),
        toBigintOrNull(event.serviceId || event.service_id),
        cleanString(event.category, 120),
        cleanString(event.eventName || event.event_name, 120) || "unknown_event",
        cleanString(event.step, 160),
        cleanString(event.status, 120),
        cleanString(event.sessionId || event.session_id, 160),
        JSON.stringify(meta),
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
