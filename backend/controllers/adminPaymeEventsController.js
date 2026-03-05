// backend/controllers/adminPaymeEventsController.js
const pool = require("../db");

function clampInt(x, def, min, max) {
  const n = Number(x);
  if (!Number.isFinite(n)) return def;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

async function adminPaymeEvents(req, res) {
  try {
    const limit = clampInt(req.query.limit, 200, 1, 500);
    const offset = clampInt(req.query.offset, 0, 0, 200000);

    const q = String(req.query.q || "").trim();
    const method = String(req.query.method || "").trim();
    const stage = String(req.query.stage || "").trim();

    const where = [];
    const args = [];
    let idx = 1;

    if (q) {
      // search in payme_id, order_id, error_message
      where.push(
        `(payme_id ILIKE $${idx} OR CAST(order_id AS TEXT) ILIKE $${idx} OR error_message ILIKE $${idx})`
      );
      args.push(`%${q}%`);
      idx++;
    }

    if (method) {
      where.push(`method = $${idx}`);
      args.push(method);
      idx++;
    }

    if (stage) {
      where.push(`stage = $${idx}`);
      args.push(stage);
      idx++;
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const { rows } = await pool.query(
      `
      SELECT id, created_at, method, stage, payme_id, order_id,
             http_status, error_code, error_message, duration_ms
      FROM payme_events
      ${whereSql}
      ORDER BY id DESC
      LIMIT $${idx} OFFSET $${idx + 1}
      `,
      [...args, limit, offset]
    );

    return res.json({ success: true, rows });
  } catch (e) {
    console.error("[adminPaymeEvents] error:", e?.message || e);
    return res.status(500).json({ success: false, error: "Internal error" });
  }
}

async function adminPaymeEventDetails(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ success: false, error: "Bad id" });
    }

    const { rows } = await pool.query(`SELECT * FROM payme_events WHERE id=$1`, [id]);
    return res.json({ success: true, row: rows[0] || null });
  } catch (e) {
    console.error("[adminPaymeEventDetails] error:", e?.message || e);
    return res.status(500).json({ success: false, error: "Internal error" });
  }
}

module.exports = { adminPaymeEvents, adminPaymeEventDetails };
