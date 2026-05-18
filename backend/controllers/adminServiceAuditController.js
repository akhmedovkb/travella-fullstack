// backend/controllers/adminServiceAuditController.js

const pool = require("../db");
const { ensureServiceAuditTable } = require("../utils/serviceAuditLog");

function toInt(value, fallback, min, max) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cleanText(value) {
  return String(value || "").trim();
}

async function listServiceAuditLogs(req, res) {
  try {
    await ensureServiceAuditTable();

    const limit = toInt(req.query.limit, 100, 1, 500);
    const offset = toInt(req.query.offset, 0, 0, 1000000);
    const q = cleanText(req.query.q);
    const action = cleanText(req.query.action);
    const providerId = cleanText(req.query.provider_id);
    const serviceId = cleanText(req.query.service_id);
    const category = cleanText(req.query.category);
    const dateFrom = cleanText(req.query.date_from);
    const dateTo = cleanText(req.query.date_to);

    const where = [];
    const values = [];
    const add = (sql, value) => {
      values.push(value);
      where.push(sql.replace("?", `$${values.length}`));
    };

    if (action) add("l.action = ?", action);
    if (providerId) add("l.provider_id = ?::bigint", providerId);
    if (serviceId) add("l.service_id = ?::bigint", serviceId);
    if (category) add("l.category = ?", category);
    if (dateFrom) add("l.created_at >= ?::timestamptz", dateFrom);
    if (dateTo) add("l.created_at < (?::date + INTERVAL '1 day')", dateTo);
    if (q) {
      values.push(`%${q}%`);
      const idx = `$${values.length}`;
      where.push(`(
        l.title ILIKE ${idx}
        OR l.category ILIKE ${idx}
        OR l.action ILIKE ${idx}
        OR l.service_id::text ILIKE ${idx}
        OR l.provider_id::text ILIKE ${idx}
        OR p.name ILIKE ${idx}
        OR p.company_name ILIKE ${idx}
        OR p.phone ILIKE ${idx}
        OR p.email ILIKE ${idx}
      )`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rowsSql = `
      SELECT
        l.id,
        l.service_id,
        l.provider_id,
        l.actor_provider_id,
        l.actor_role,
        l.action,
        l.source,
        l.old_status,
        l.new_status,
        l.old_moderation_status,
        l.new_moderation_status,
        l.category,
        l.title,
        l.old_snapshot,
        l.new_snapshot,
        l.meta,
        l.ip,
        l.user_agent,
        l.created_at,
        p.name AS provider_name,
        p.company_name AS provider_company_name,
        p.phone AS provider_phone,
        p.email AS provider_email
      FROM provider_service_audit_logs l
      LEFT JOIN providers p ON p.id = l.provider_id
      ${whereSql}
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
    `;

    const countSql = `
      SELECT COUNT(*)::int AS count
      FROM provider_service_audit_logs l
      LEFT JOIN providers p ON p.id = l.provider_id
      ${whereSql}
    `;

    const summarySql = `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE action IN ('service_deleted','provider_service_deleted'))::int AS deleted_count,
        COUNT(*) FILTER (WHERE action IN ('service_restored','provider_service_restored'))::int AS restored_count,
        COUNT(*) FILTER (WHERE action IN ('service_submitted'))::int AS submitted_count,
        COUNT(*) FILTER (WHERE action IN ('service_updated','service_status_reset_to_draft'))::int AS updated_count
      FROM provider_service_audit_logs l
      LEFT JOIN providers p ON p.id = l.provider_id
      ${whereSql}
    `;

    const [rowsRes, countRes, summaryRes, actionRes] = await Promise.all([
      pool.query(rowsSql, [...values, limit, offset]),
      pool.query(countSql, values),
      pool.query(summarySql, values),
      pool.query(
        `SELECT action, COUNT(*)::int AS count
           FROM provider_service_audit_logs
          GROUP BY action
          ORDER BY count DESC, action ASC`
      ),
    ]);

    return res.json({
      ok: true,
      rows: rowsRes.rows,
      total: countRes.rows[0]?.count || 0,
      summary: summaryRes.rows[0] || {},
      actions: actionRes.rows,
      limit,
      offset,
    });
  } catch (err) {
    console.error("listServiceAuditLogs error:", err);
    return res.status(500).json({ ok: false, message: "Ошибка загрузки журнала действий" });
  }
}

async function getServiceAuditStats(req, res) {
  try {
    await ensureServiceAuditTable();
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS last_24h,
        COUNT(*) FILTER (WHERE action IN ('service_deleted','provider_service_deleted'))::int AS deleted_count,
        COUNT(*) FILTER (WHERE action IN ('service_restored','provider_service_restored'))::int AS restored_count,
        COUNT(DISTINCT provider_id)::int AS providers_count
      FROM provider_service_audit_logs
    `);
    return res.json({ ok: true, stats: rows[0] || {} });
  } catch (err) {
    console.error("getServiceAuditStats error:", err);
    return res.status(500).json({ ok: false, message: "Ошибка статистики" });
  }
}

module.exports = {
  listServiceAuditLogs,
  getServiceAuditStats,
};
