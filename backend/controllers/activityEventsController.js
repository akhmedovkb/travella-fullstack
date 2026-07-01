// backend/controllers/activityEventsController.js

const pool = require("../db");
const { ensureActivityEventsTable, logActivityEvent } = require("../utils/activityLogger");


function clampInt(x, def, min, max) {
  const n = Number(x);
  if (!Number.isFinite(n)) return def;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

function safeText(x, max = 500, fallback = "") {
  if (x === undefined || x === null) return fallback;
  return String(x).trim().slice(0, max);
}

function safeInt(x) {
  if (x === undefined || x === null || x === "") return null;
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function safeJsonObject(x) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return {};
  return x;
}

function pickIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xf || req.ip || req.socket?.remoteAddress || null;
}

async function enrichActor(req, payload) {
  const roleFromToken = safeText(req.user?.role, 40).toLowerCase();
  const roleFromPayload = safeText(payload.actorRole, 40).toLowerCase();
  const actorRole = roleFromToken || roleFromPayload || null;

  const actorIdFromToken = safeInt(req.user?.id);
  const actorIdFromPayload = safeInt(payload.actorId);
  const actorId = actorIdFromToken || actorIdFromPayload;

  let actorName = safeText(req.user?.name || req.user?.full_name, 160, null);
  let actorPhone = null;

  if (actorId && actorRole === "client") {
    const { rows } = await pool.query(
      `SELECT name, phone FROM clients WHERE id = $1 LIMIT 1`,
      [actorId]
    );
    actorName = rows[0]?.name || actorName;
    actorPhone = rows[0]?.phone || null;
  }

  if (actorId && (actorRole === "provider" || actorRole === "admin" || actorRole === "moderator")) {
    const { rows } = await pool.query(
      `SELECT COALESCE(name, email) AS name, phone FROM providers WHERE id = $1 LIMIT 1`,
      [actorId]
    );
    actorName = rows[0]?.name || actorName;
    actorPhone = rows[0]?.phone || null;
  }

  return { actorRole, actorId, actorName, actorPhone };
}

async function trackActivityEvent(req, res) {
  try {
    await ensureActivityEventsTable();

    const body = req.body || {};
    const meta = safeJsonObject(body.meta);
    const { actorRole, actorId, actorName, actorPhone } = await enrichActor(req, body);

    const eventType = safeText(body.eventType || body.type, 60, "event") || "event";
    const eventName = safeText(body.eventName || body.name, 120, "unknown_event") || "unknown_event";
    const serviceId = safeInt(body.serviceId || meta.service_id || meta.serviceId);
    const providerId = safeInt(body.providerId || meta.provider_id || meta.providerId);
    const clientId = safeInt(body.clientId || meta.client_id || meta.clientId || (actorRole === "client" ? actorId : null));

    const ok = await logActivityEvent({
      actorRole,
      actorId,
      actorName: actorName || null,
      actorPhone: actorPhone || null,
      sessionId: safeText(body.sessionId, 120, null),
      eventType,
      eventName,
      pagePath: safeText(body.pagePath, 500, null),
      pageTitle: safeText(body.pageTitle, 250, null),
      elementText: safeText(body.elementText, 400, null),
      elementTag: safeText(body.elementTag, 60, null),
      elementRole: safeText(body.elementRole, 80, null),
      elementHref: safeText(body.elementHref, 700, null),
      serviceId,
      providerId,
      clientId,
      source: safeText(body.source, 80, "web"),
      userAgent: safeText(req.headers["user-agent"], 1000, null),
      ip: pickIp(req),
      meta,
    });

    return res.json({ ok: !!ok });
  } catch (e) {
    console.error("trackActivityEvent error:", e);
    return res.status(500).json({ ok: false, error: "activity_track_failed" });
  }
}

async function getActivityEvents(req, res) {
  try {
    await ensureActivityEventsTable();

    const limit = clampInt(req.query.limit, 100, 1, 500);
    const role = safeText(req.query.role, 40).toLowerCase();
    const type = safeText(req.query.type, 60).toLowerCase();
    const q = safeText(req.query.q, 160);
    const serviceId = safeInt(req.query.service_id || req.query.serviceId);
    const actorId = safeInt(req.query.actor_id || req.query.actorId);
    const providerId = safeInt(req.query.provider_id || req.query.providerId);
    const clientId = safeInt(req.query.client_id || req.query.clientId);
    const source = safeText(req.query.source, 80).toLowerCase();
    const eventName = safeText(req.query.event_name || req.query.eventName, 120).toLowerCase();
    const sinceHours = clampInt(req.query.since_hours || req.query.sinceHours, 168, 1, 24 * 90);

    const values = [];
    const where = [];

    if (role) {
      values.push(role);
      where.push(`LOWER(COALESCE(actor_role,'')) = $${values.length}`);
    }
    if (type) {
      values.push(type);
      where.push(`LOWER(COALESCE(event_type,'')) = $${values.length}`);
    }
    if (serviceId) {
      values.push(serviceId);
      where.push(`service_id = $${values.length}`);
    }
    if (actorId) {
      values.push(actorId);
      where.push(`actor_id = $${values.length}`);
    }
    if (providerId) {
      values.push(providerId);
      where.push(`provider_id = $${values.length}`);
    }
    if (clientId) {
      values.push(clientId);
      where.push(`client_id = $${values.length}`);
    }
    if (source) {
      values.push(source);
      where.push(`LOWER(COALESCE(source,'')) = $${values.length}`);
    }
    if (eventName) {
      values.push(eventName);
      where.push(`LOWER(COALESCE(event_name,'')) = $${values.length}`);
    }
    values.push(sinceHours);
    where.push(`ae.created_at >= NOW() - ($${values.length}::int || ' hours')::interval`);
    if (q) {
      values.push(`%${q.toLowerCase()}%`);
      where.push(`(
        LOWER(COALESCE(actor_name,'')) LIKE $${values.length}
        OR LOWER(COALESCE(actor_phone,'')) LIKE $${values.length}
        OR LOWER(COALESCE(event_name,'')) LIKE $${values.length}
        OR LOWER(COALESCE(element_text,'')) LIKE $${values.length}
        OR LOWER(COALESCE(page_path,'')) LIKE $${values.length}
        OR LOWER(COALESCE(meta::text,'')) LIKE $${values.length}
      )`);
    }

    values.push(limit);
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const { rows } = await pool.query(
      `
      SELECT
        ae.*,
        s.title AS service_title,
        s.category AS service_category,
        p.name AS provider_company_name,
        c.name AS client_name,
        c.phone AS client_phone
      FROM activity_events ae
      LEFT JOIN services s ON s.id = ae.service_id
      LEFT JOIN providers p ON p.id = COALESCE(ae.provider_id, s.provider_id)
      LEFT JOIN clients c ON c.id = COALESCE(ae.client_id, CASE WHEN ae.actor_role = 'client' THEN ae.actor_id ELSE NULL END)
      ${whereSql}
      ORDER BY ae.created_at DESC, ae.id DESC
      LIMIT $${values.length}
      `,
      values
    );

    const stats = await pool.query(
      `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE actor_role = 'client')::int AS client_events,
        COUNT(*) FILTER (WHERE actor_role = 'provider')::int AS provider_events,
        COUNT(*) FILTER (WHERE event_type = 'click')::int AS clicks,
        COUNT(*) FILTER (WHERE event_name IN ('unlock_request','unlock_payme_open','payment_redirect_created'))::int AS payment_intent_events,
        COUNT(DISTINCT session_id)::int AS sessions
      FROM activity_events
      WHERE created_at >= NOW() - INTERVAL '7 days'
      `
    );

    return res.json({ ok: true, rows, summary: stats.rows[0] || {}, filters: { limit, role, type, q, serviceId, actorId, providerId, clientId, source, eventName, sinceHours } });
  } catch (e) {
    console.error("getActivityEvents error:", e);
    return res.status(500).json({ ok: false, error: "activity_events_failed" });
  }
}

async function getActivitySessions(req, res) {
  try {
    await ensureActivityEventsTable();
    const limit = clampInt(req.query.limit, 100, 1, 500);
    const sinceHours = clampInt(req.query.since_hours || req.query.sinceHours, 336, 1, 24 * 90);
    const values = [limit, sinceHours];

    const { rows } = await pool.query(
      `
      WITH x AS (
        SELECT
          session_id,
          MAX(created_at) AS last_seen_at,
          MIN(created_at) AS first_seen_at,
          COUNT(*)::int AS events_count,
          COUNT(*) FILTER (WHERE event_type = 'click')::int AS clicks_count,
          ARRAY_AGG(event_name ORDER BY created_at DESC, id DESC) AS recent_events,
          (ARRAY_AGG(actor_role ORDER BY created_at DESC, id DESC))[1] AS actor_role,
          (ARRAY_AGG(actor_id ORDER BY created_at DESC, id DESC))[1] AS actor_id,
          (ARRAY_AGG(actor_name ORDER BY created_at DESC, id DESC))[1] AS actor_name,
          (ARRAY_AGG(page_path ORDER BY created_at DESC, id DESC))[1] AS last_page,
          (ARRAY_AGG(service_id ORDER BY created_at DESC, id DESC))[1] AS last_service_id
        FROM activity_events
        WHERE session_id IS NOT NULL AND created_at >= NOW() - ($2::int || ' hours')::interval
        GROUP BY session_id
      )
      SELECT *
      FROM x
      ORDER BY last_seen_at DESC
      LIMIT $1
      `,
      values
    );

    return res.json({ ok: true, rows });
  } catch (e) {
    console.error("getActivitySessions error:", e);
    return res.status(500).json({ ok: false, error: "activity_sessions_failed" });
  }
}

module.exports = {
  trackActivityEvent,
  getActivityEvents,
  getActivitySessions,
};
