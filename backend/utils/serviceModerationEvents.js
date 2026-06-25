// backend/utils/serviceModerationEvents.js
// Lightweight audit trail for service moderation decisions.

let ensured = false;

async function ensureServiceModerationEvents(pool) {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_moderation_events (
      id BIGSERIAL PRIMARY KEY,
      service_id BIGINT NOT NULL,
      actor_id BIGINT,
      actor_role TEXT NOT NULL DEFAULT 'admin',
      action TEXT NOT NULL,
      reason_code TEXT,
      reason TEXT,
      from_status TEXT,
      to_status TEXT,
      from_moderation_status TEXT,
      to_moderation_status TEXT,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_service_moderation_events_service_created ON service_moderation_events(service_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_service_moderation_events_created ON service_moderation_events(created_at DESC)`);
  ensured = true;
}

async function logServiceModerationEvent(pool, input = {}) {
  try {
    await ensureServiceModerationEvents(pool);
    const before = input.before || {};
    const after = input.after || input.service || {};
    await pool.query(
      `INSERT INTO service_moderation_events
        (service_id, actor_id, actor_role, action, reason_code, reason,
         from_status, to_status, from_moderation_status, to_moderation_status, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
      [
        Number(input.serviceId || after.id || before.id),
        input.actorId || null,
        input.actorRole || 'admin',
        String(input.action || '').trim() || 'unknown',
        input.reasonCode || null,
        input.reason || null,
        before.status || null,
        after.status || null,
        before.moderation_status || null,
        after.moderation_status || null,
        JSON.stringify(input.meta || {}),
      ]
    );
  } catch (e) {
    console.error('[serviceModerationEvents] log failed:', e?.message || e);
  }
}

async function listServiceModerationEvents(pool, serviceId, limit = 30) {
  await ensureServiceModerationEvents(pool);
  const q = await pool.query(
    `SELECT *
       FROM service_moderation_events
      WHERE service_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [Number(serviceId), Math.max(1, Math.min(Number(limit) || 30, 100))]
  );
  return q.rows;
}

module.exports = {
  ensureServiceModerationEvents,
  logServiceModerationEvent,
  listServiceModerationEvents,
};
