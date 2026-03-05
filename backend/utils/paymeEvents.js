// backend/utils/paymeEvents.js
const pool = require("../db");

// best-effort writer: must never break Payme processing
async function recordPaymeEvent(event) {
  try {
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

    const req_json = e.req_json ? e.req_json : null;
    const res_json = e.res_json ? e.res_json : null;

    await pool.query(
      `
      INSERT INTO payme_events
        (method, stage, payme_id, order_id, rpc_id,
         http_status, error_code, error_message,
         ip, user_agent, duration_ms, req_json, res_json)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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
        req_json ? JSON.stringify(req_json) : null,
        res_json ? JSON.stringify(res_json) : null,
      ]
    );
  } catch (err) {
    console.error("[payme-events] write failed:", err?.message || err);
  }
}

module.exports = { recordPaymeEvent };
