const pool = require("../db");

async function recordPaymeEvent(event) {
  try {
    const {
      method,
      stage,
      payme_id,
      order_id,
      rpc_id,
      http_status,
      error_code,
      error_message,
      ip,
      user_agent,
      duration_ms,
      req_json,
      res_json,
    } = event || {};

    await pool.query(
      `
      INSERT INTO payme_events
      (method, stage, payme_id, order_id, rpc_id, http_status,
       error_code, error_message, ip, user_agent, duration_ms, req_json, res_json)
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      `,
      [
        method || null,
        stage || null,
        payme_id || null,
        order_id || null,
        rpc_id || null,
        http_status || null,
        error_code || null,
        error_message || null,
        ip || null,
        user_agent || null,
        duration_ms || null,
        req_json ? JSON.stringify(req_json) : null,
        res_json ? JSON.stringify(res_json) : null,
      ]
    );
  } catch (e) {
    // best-effort: лог не должен ломать оплату
    console.error("[payme-events] write error:", e.message);
  }
}

module.exports = { recordPaymeEvent };
