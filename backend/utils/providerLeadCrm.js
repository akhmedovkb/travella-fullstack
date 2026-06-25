// backend/utils/providerLeadCrm.js
const pool = require("../db");

let _leadCrmReady = false;

function toBigintOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function cleanString(value, max = 500) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

async function ensureProviderLeadCrmTable(db = pool) {
  if (_leadCrmReady) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS provider_lead_crm (
      id BIGSERIAL PRIMARY KEY,
      provider_id BIGINT NOT NULL,
      client_id BIGINT,
      service_id BIGINT,
      status TEXT NOT NULL DEFAULT 'new',
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (provider_id, client_id, service_id)
    )
  `);

  await db.query(`ALTER TABLE provider_lead_crm ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'unknown'`);
  await db.query(`ALTER TABLE provider_lead_crm ADD COLUMN IF NOT EXISTS request_table TEXT`);
  await db.query(`ALTER TABLE provider_lead_crm ADD COLUMN IF NOT EXISTS request_id TEXT`);
  await db.query(`ALTER TABLE provider_lead_crm ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT`);
  await db.query(`ALTER TABLE provider_lead_crm ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ`);
  await db.query(`ALTER TABLE provider_lead_crm ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb`);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_provider_lead_crm_provider ON provider_lead_crm(provider_id, updated_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_provider_lead_crm_client ON provider_lead_crm(client_id) WHERE client_id IS NOT NULL`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_provider_lead_crm_service ON provider_lead_crm(service_id) WHERE service_id IS NOT NULL`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_provider_lead_crm_source ON provider_lead_crm(source, updated_at DESC)`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_provider_lead_crm_source_request ON provider_lead_crm(source, request_table, request_id) WHERE request_id IS NOT NULL`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_provider_lead_crm_tg_chat_service ON provider_lead_crm(provider_id, telegram_chat_id, service_id) WHERE telegram_chat_id IS NOT NULL AND service_id IS NOT NULL`);

  _leadCrmReady = true;
}

async function upsertProviderLeadCrm(lead = {}, db = pool) {
  try {
    await ensureProviderLeadCrmTable(db);

    const providerId = toBigintOrNull(lead.providerId || lead.provider_id);
    const serviceId = toBigintOrNull(lead.serviceId || lead.service_id);
    if (!providerId) return null;

    const clientId = toBigintOrNull(lead.clientId || lead.client_id);
    const telegramChatId = toBigintOrNull(lead.telegramChatId || lead.telegram_chat_id);
    const source = cleanString(lead.source, 80) || "unknown";
    const requestTable = cleanString(lead.requestTable || lead.request_table, 80);
    const requestId = cleanString(lead.requestId || lead.request_id, 120);
    const status = cleanString(lead.status, 80) || "new";
    const note = cleanString(lead.note, 1000);
    const meta = lead.meta && typeof lead.meta === "object" && !Array.isArray(lead.meta) ? lead.meta : {};

    // Сначала ищем тот же источник заявки. Это защищает web/tg лиды от дублей.
    if (requestId && requestTable) {
      const existing = await db.query(
        `SELECT id FROM provider_lead_crm WHERE source=$1 AND request_table=$2 AND request_id=$3 LIMIT 1`,
        [source, requestTable, requestId]
      );
      if (existing.rowCount) {
        const upd = await db.query(
          `
          UPDATE provider_lead_crm
             SET provider_id=$2,
                 client_id=COALESCE($3, client_id),
                 service_id=COALESCE($4, service_id),
                 telegram_chat_id=COALESCE($5, telegram_chat_id),
                 status=COALESCE(NULLIF($6,''), status),
                 note=COALESCE($7, note),
                 meta=COALESCE(meta, '{}'::jsonb) || $8::jsonb,
                 last_event_at=NOW(),
                 updated_at=NOW()
           WHERE id=$1
           RETURNING *
          `,
          [existing.rows[0].id, providerId, clientId, serviceId, telegramChatId, status, note, JSON.stringify(meta)]
        );
        return upd.rows[0] || null;
      }
    }

    // Для web-лида есть реальный client_id: используем существующую business-уникальность.
    if (clientId && serviceId) {
      const r = await db.query(
        `
        INSERT INTO provider_lead_crm (
          provider_id, client_id, service_id, status, note, source,
          request_table, request_id, telegram_chat_id, last_event_at, meta, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),$10::jsonb,NOW())
        ON CONFLICT (provider_id, client_id, service_id)
        DO UPDATE SET
          status=COALESCE(NULLIF(EXCLUDED.status,''), provider_lead_crm.status),
          note=COALESCE(EXCLUDED.note, provider_lead_crm.note),
          source=COALESCE(NULLIF(EXCLUDED.source,''), provider_lead_crm.source),
          request_table=COALESCE(EXCLUDED.request_table, provider_lead_crm.request_table),
          request_id=COALESCE(EXCLUDED.request_id, provider_lead_crm.request_id),
          telegram_chat_id=COALESCE(EXCLUDED.telegram_chat_id, provider_lead_crm.telegram_chat_id),
          meta=COALESCE(provider_lead_crm.meta, '{}'::jsonb) || EXCLUDED.meta,
          last_event_at=NOW(),
          updated_at=NOW()
        RETURNING *
        `,
        [providerId, clientId, serviceId, status, note, source, requestTable, requestId, telegramChatId, JSON.stringify(meta)]
      );
      return r.rows[0] || null;
    }

    // Для TG-лида без client_id привязываемся к provider + telegram_chat_id + service.
    if (telegramChatId && serviceId) {
      const existing = await db.query(
        `SELECT id FROM provider_lead_crm WHERE provider_id=$1 AND telegram_chat_id=$2 AND service_id=$3 LIMIT 1`,
        [providerId, telegramChatId, serviceId]
      );
      if (existing.rowCount) {
        const upd = await db.query(
          `
          UPDATE provider_lead_crm
             SET status=COALESCE(NULLIF($2,''), status),
                 note=COALESCE($3, note),
                 source=$4,
                 request_table=COALESCE($5, request_table),
                 request_id=COALESCE($6, request_id),
                 meta=COALESCE(meta, '{}'::jsonb) || $7::jsonb,
                 last_event_at=NOW(),
                 updated_at=NOW()
           WHERE id=$1
           RETURNING *
          `,
          [existing.rows[0].id, status, note, source, requestTable, requestId, JSON.stringify(meta)]
        );
        return upd.rows[0] || null;
      }
    }

    const ins = await db.query(
      `
      INSERT INTO provider_lead_crm (
        provider_id, client_id, service_id, status, note, source,
        request_table, request_id, telegram_chat_id, last_event_at, meta, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),$10::jsonb,NOW())
      RETURNING *
      `,
      [providerId, clientId, serviceId, status, note, source, requestTable, requestId, telegramChatId, JSON.stringify(meta)]
    );
    return ins.rows[0] || null;
  } catch (err) {
    console.error("[provider-lead-crm] upsert failed:", err?.message || err);
    return null;
  }
}

async function updateProviderLeadCrmStatus(match = {}, status, db = pool) {
  try {
    await ensureProviderLeadCrmTable(db);
    const cleanStatus = cleanString(status, 80);
    if (!cleanStatus) return null;
    const source = cleanString(match.source, 80);
    const requestTable = cleanString(match.requestTable || match.request_table, 80);
    const requestId = cleanString(match.requestId || match.request_id, 120);

    if (source && requestTable && requestId) {
      const r = await db.query(
        `UPDATE provider_lead_crm SET status=$4, last_event_at=NOW(), updated_at=NOW() WHERE source=$1 AND request_table=$2 AND request_id=$3 RETURNING *`,
        [source, requestTable, requestId, cleanStatus]
      );
      return r.rows[0] || null;
    }
    return null;
  } catch (err) {
    console.error("[provider-lead-crm] status update failed:", err?.message || err);
    return null;
  }
}

module.exports = {
  ensureProviderLeadCrmTable,
  upsertProviderLeadCrm,
  updateProviderLeadCrmStatus,
};
