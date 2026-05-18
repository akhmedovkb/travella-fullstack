// backend/utils/serviceAuditLog.js

const pool = require("../db");

let ensured = false;
let ensurePromise = null;

async function ensureServiceAuditTable() {
  if (ensured) return;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS provider_service_audit_logs (
        id BIGSERIAL PRIMARY KEY,
        service_id BIGINT,
        provider_id BIGINT,
        actor_provider_id BIGINT,
        actor_role TEXT NOT NULL DEFAULT 'provider',
        action TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'web',
        old_status TEXT,
        new_status TEXT,
        old_moderation_status TEXT,
        new_moderation_status TEXT,
        category TEXT,
        title TEXT,
        old_snapshot JSONB,
        new_snapshot JSONB,
        meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        ip TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_provider_service_audit_logs_created_at
        ON provider_service_audit_logs (created_at DESC)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_provider_service_audit_logs_provider_id
        ON provider_service_audit_logs (provider_id, created_at DESC)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_provider_service_audit_logs_service_id
        ON provider_service_audit_logs (service_id, created_at DESC)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_provider_service_audit_logs_action
        ON provider_service_audit_logs (action, created_at DESC)
    `);

    ensured = true;
  })().finally(() => {
    ensurePromise = null;
  });

  return ensurePromise;
}

function safeJson(value) {
  if (value === undefined) return null;
  try {
    JSON.stringify(value);
    return value;
  } catch {
    return { unserializable: true };
  }
}

function pickProviderId(row = {}) {
  const n = Number(row.provider_id || row.providerId || row.provider || 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pickServiceId(row = {}, fallback = null) {
  const n = Number(row.id || row.service_id || row.serviceId || fallback || 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function requestMeta(req) {
  if (!req) return {};
  return {
    method: req.method,
    path: req.originalUrl || req.url,
  };
}

async function logProviderServiceAction({
  req = null,
  action,
  source = "web",
  actorRole = "provider",
  providerId = null,
  serviceId = null,
  oldService = null,
  newService = null,
  meta = {},
}) {
  try {
    if (!action) return;
    await ensureServiceAuditTable();

    const actorProviderId = Number(req?.user?.id || req?.user?.provider_id || providerId || 0) || null;
    const finalProviderId =
      Number(providerId || pickProviderId(newService) || pickProviderId(oldService) || actorProviderId || 0) || null;
    const finalServiceId = Number(serviceId || pickServiceId(newService) || pickServiceId(oldService) || 0) || null;

    const title =
      newService?.title ||
      oldService?.title ||
      newService?.details?.title ||
      oldService?.details?.title ||
      null;

    const category = newService?.category || oldService?.category || null;

    await pool.query(
      `
      INSERT INTO provider_service_audit_logs (
        service_id,
        provider_id,
        actor_provider_id,
        actor_role,
        action,
        source,
        old_status,
        new_status,
        old_moderation_status,
        new_moderation_status,
        category,
        title,
        old_snapshot,
        new_snapshot,
        meta,
        ip,
        user_agent
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17
      )
      `,
      [
        finalServiceId,
        finalProviderId,
        actorProviderId,
        actorRole,
        action,
        source,
        oldService?.status || null,
        newService?.status || null,
        oldService?.moderation_status || null,
        newService?.moderation_status || null,
        category,
        title,
        JSON.stringify(safeJson(oldService)),
        JSON.stringify(safeJson(newService)),
        JSON.stringify({ ...requestMeta(req), ...(safeJson(meta) || {}) }),
        req?.ip || req?.headers?.["x-forwarded-for"] || null,
        req?.headers?.["user-agent"] || null,
      ]
    );
  } catch (err) {
    console.error("[service-audit] log failed:", err?.message || err);
  }
}

module.exports = {
  ensureServiceAuditTable,
  logProviderServiceAction,
};
