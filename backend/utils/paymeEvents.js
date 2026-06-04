// backend/utils/paymeEvents.js
const pool = require("../db");

let schemaReady = false;
let schemaPromise = null;

async function ensurePaymeEventsSchema() {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payme_events (
        id BIGSERIAL PRIMARY KEY,
        method TEXT,
        stage TEXT,
        payme_id TEXT,
        order_id BIGINT,
        rpc_id TEXT,
        http_status INTEGER,
        error_code INTEGER,
        error_message TEXT,
        ip TEXT,
        user_agent TEXT,
        duration_ms INTEGER,
        req_json JSONB,
        res_json JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_payme_events_created_at ON payme_events(created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_payme_events_method_created ON payme_events(method, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_payme_events_order_created ON payme_events(order_id, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_payme_events_payme_created ON payme_events(payme_id, created_at DESC)`);

    schemaReady = true;
  })().finally(() => {
    schemaPromise = null;
  });

  return schemaPromise;
}

function safeJson(value) {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ _unserializable: true });
  }
}

// best-effort writer: must never break Payme processing
async function recordPaymeEvent(event) {
  try {
    await ensurePaymeEventsSchema();

    const e = event || {};

    const method = e.method ?? null;
    const stage = e.stage ?? null;
    const payme_id = e.payme_id ?? null;
    const order_id = Number.isFinite(Number(e.order_id)) ? Number(e.order_id) : null;
    const rpc_id = e.rpc_id ?? null;

    const http_status = Number.isFinite(Number(e.http_status)) ? Number(e.http_status) : null;
    const error_code = Number.isFinite(Number(e.error_code)) ? Number(e.error_code) : null;
    const error_message = e.error_message ?? null;

    const ip = e.ip ?? null;
    const user_agent = e.user_agent ?? null;
    const duration_ms = Number.isFinite(Number(e.duration_ms)) ? Number(e.duration_ms) : null;

    const req_json = e.req_json === undefined ? null : e.req_json;
    const res_json = e.res_json === undefined ? null : e.res_json;

    await pool.query(
      `
      INSERT INTO payme_events
        (method, stage, payme_id, order_id, rpc_id,
         http_status, error_code, error_message,
         ip, user_agent, duration_ms, req_json, res_json)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb)
      `,
      [
        method ? String(method) : null,
        stage ? String(stage) : null,
        payme_id ? String(payme_id) : null,
        order_id,
        rpc_id !== undefined && rpc_id !== null ? String(rpc_id) : null,
        http_status,
        error_code,
        error_message ? String(error_message) : null,
        ip ? String(ip) : null,
        user_agent ? String(user_agent) : null,
        duration_ms,
        req_json === null ? null : safeJson(req_json),
        res_json === null ? null : safeJson(res_json),
      ]
    );
  } catch (err) {
    console.error("[payme-events] write failed:", err?.message || err);
  }
}

module.exports = { ensurePaymeEventsSchema, recordPaymeEvent };
