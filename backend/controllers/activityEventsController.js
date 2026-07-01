// backend/controllers/activityEventsController.js
// Travella Event Bus: live activity, timelines, funnels, hot leads and analytics.

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

function hoursFilter(req, def = 168, max = 24 * 180) {
  return clampInt(req.query.since_hours || req.query.sinceHours || req.query.hours, def, 1, max);
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
    const { rows } = await pool.query(`SELECT name, phone FROM clients WHERE id = $1 LIMIT 1`, [actorId]);
    actorName = rows[0]?.name || actorName;
    actorPhone = rows[0]?.phone || null;
  }

  if (actorId && ["provider", "admin", "moderator"].includes(actorRole)) {
    const { rows } = await pool.query(`SELECT COALESCE(name, email) AS name, phone FROM providers WHERE id = $1 LIMIT 1`, [actorId]);
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

function buildWhere(req, values) {
  const where = [];
  const role = safeText(req.query.role, 40).toLowerCase();
  const type = safeText(req.query.type, 60).toLowerCase();
  const q = safeText(req.query.q, 160).toLowerCase();
  const serviceId = safeInt(req.query.service_id || req.query.serviceId);
  const actorId = safeInt(req.query.actor_id || req.query.actorId);
  const providerId = safeInt(req.query.provider_id || req.query.providerId);
  const clientId = safeInt(req.query.client_id || req.query.clientId);
  const source = safeText(req.query.source, 80).toLowerCase();
  const eventName = safeText(req.query.event_name || req.query.eventName, 120).toLowerCase();
  const sinceHours = hoursFilter(req, 168);

  if (role) {
    values.push(role);
    where.push(`LOWER(COALESCE(ae.actor_role,'')) = $${values.length}`);
  }
  if (type) {
    values.push(type);
    where.push(`LOWER(COALESCE(ae.event_type,'')) = $${values.length}`);
  }
  if (serviceId) {
    values.push(serviceId);
    where.push(`ae.service_id = $${values.length}`);
  }
  if (actorId) {
    values.push(actorId);
    where.push(`ae.actor_id = $${values.length}`);
  }
  if (providerId) {
    values.push(providerId);
    where.push(`ae.provider_id = $${values.length}`);
  }
  if (clientId) {
    values.push(clientId);
    where.push(`ae.client_id = $${values.length}`);
  }
  if (source) {
    values.push(source);
    where.push(`LOWER(COALESCE(ae.source,'')) = $${values.length}`);
  }
  if (eventName) {
    values.push(eventName);
    where.push(`LOWER(COALESCE(ae.event_name,'')) = $${values.length}`);
  }
  values.push(sinceHours);
  where.push(`ae.created_at >= NOW() - ($${values.length}::int || ' hours')::interval`);
  if (q) {
    values.push(`%${q}%`);
    where.push(`(
      LOWER(COALESCE(ae.actor_name,'')) LIKE $${values.length}
      OR LOWER(COALESCE(ae.actor_phone,'')) LIKE $${values.length}
      OR LOWER(COALESCE(ae.event_name,'')) LIKE $${values.length}
      OR LOWER(COALESCE(ae.event_type,'')) LIKE $${values.length}
      OR LOWER(COALESCE(ae.element_text,'')) LIKE $${values.length}
      OR LOWER(COALESCE(ae.page_path,'')) LIKE $${values.length}
      OR LOWER(COALESCE(ae.meta::text,'')) LIKE $${values.length}
    )`);
  }
  return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", filters: { role, type, q, serviceId, actorId, providerId, clientId, source, eventName, sinceHours } };
}

async function getActivityEvents(req, res) {
  try {
    await ensureActivityEventsTable();
    const limit = clampInt(req.query.limit, 100, 1, 500);
    const values = [];
    const { whereSql, filters } = buildWhere(req, values);
    values.push(limit);

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

    return res.json({ ok: true, rows, filters: { ...filters, limit } });
  } catch (e) {
    console.error("getActivityEvents error:", e);
    return res.status(500).json({ ok: false, error: "activity_events_failed" });
  }
}

async function getActivityOverview(req, res) {
  try {
    await ensureActivityEventsTable();
    const sinceHours = hoursFilter(req, 24 * 7);
    const values = [sinceHours];

    const summary = await pool.query(
      `
      SELECT
        COUNT(*)::int AS total_events,
        COUNT(DISTINCT session_id)::int AS sessions,
        COUNT(DISTINCT COALESCE(actor_role,'?') || ':' || COALESCE(actor_id::text, session_id, id::text))::int AS actors,
        COUNT(*) FILTER (WHERE source = 'web')::int AS web_events,
        COUNT(*) FILTER (WHERE source = 'telegram_bot')::int AS telegram_events,
        COUNT(*) FILTER (WHERE source = 'api')::int AS api_events,
        COUNT(*) FILTER (WHERE event_type = 'click')::int AS clicks,
        COUNT(*) FILTER (WHERE event_type ILIKE '%error%' OR event_name ILIKE '%error%' OR (meta->>'status_code')::int >= 400)::int AS errors,
        COUNT(*) FILTER (WHERE event_name ILIKE '%unlock%' OR event_name ILIKE '%payment%' OR event_name ILIKE '%payme%' OR event_name ILIKE '%click%')::int AS payment_related,
        COUNT(*) FILTER (WHERE event_name ILIKE '%contact%' OR element_text ILIKE '%контакт%')::int AS contact_related
      FROM activity_events ae
      WHERE ae.created_at >= NOW() - ($1::int || ' hours')::interval
      `,
      values
    );

    const bySource = await pool.query(
      `SELECT COALESCE(source,'unknown') AS source, COUNT(*)::int AS count
         FROM activity_events ae
        WHERE ae.created_at >= NOW() - ($1::int || ' hours')::interval
        GROUP BY 1 ORDER BY count DESC`,
      values
    );

    const byType = await pool.query(
      `SELECT COALESCE(event_type,'unknown') AS event_type, COUNT(*)::int AS count
         FROM activity_events ae
        WHERE ae.created_at >= NOW() - ($1::int || ' hours')::interval
        GROUP BY 1 ORDER BY count DESC LIMIT 20`,
      values
    );

    const byHour = await pool.query(
      `SELECT date_trunc('hour', created_at) AS hour, COUNT(*)::int AS count
         FROM activity_events ae
        WHERE ae.created_at >= NOW() - ($1::int || ' hours')::interval
        GROUP BY 1 ORDER BY hour DESC LIMIT 72`,
      values
    );

    const topEvents = await pool.query(
      `SELECT event_name, COUNT(*)::int AS count
         FROM activity_events ae
        WHERE ae.created_at >= NOW() - ($1::int || ' hours')::interval
        GROUP BY event_name ORDER BY count DESC LIMIT 25`,
      values
    );

    return res.json({ ok: true, sinceHours, summary: summary.rows[0] || {}, bySource: bySource.rows, byType: byType.rows, byHour: byHour.rows.reverse(), topEvents: topEvents.rows });
  } catch (e) {
    console.error("getActivityOverview error:", e);
    return res.status(500).json({ ok: false, error: "activity_overview_failed" });
  }
}

async function getActivitySessions(req, res) {
  try {
    await ensureActivityEventsTable();
    const limit = clampInt(req.query.limit, 100, 1, 500);
    const sinceHours = hoursFilter(req, 336);
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
          COUNT(*) FILTER (WHERE event_name ILIKE '%unlock%' OR event_name ILIKE '%payment%' OR event_name ILIKE '%pay%' OR event_name ILIKE '%click%')::int AS money_intent_count,
          ARRAY_AGG(event_name ORDER BY created_at DESC, id DESC) AS recent_events,
          (ARRAY_AGG(actor_role ORDER BY created_at DESC, id DESC))[1] AS actor_role,
          (ARRAY_AGG(actor_id ORDER BY created_at DESC, id DESC))[1] AS actor_id,
          (ARRAY_AGG(actor_name ORDER BY created_at DESC, id DESC))[1] AS actor_name,
          (ARRAY_AGG(actor_phone ORDER BY created_at DESC, id DESC))[1] AS actor_phone,
          (ARRAY_AGG(page_path ORDER BY created_at DESC, id DESC))[1] AS last_page,
          (ARRAY_AGG(service_id ORDER BY created_at DESC, id DESC))[1] AS last_service_id,
          (ARRAY_AGG(provider_id ORDER BY created_at DESC, id DESC))[1] AS last_provider_id
        FROM activity_events
        WHERE session_id IS NOT NULL AND created_at >= NOW() - ($2::int || ' hours')::interval
        GROUP BY session_id
      )
      SELECT *
      FROM x
      ORDER BY money_intent_count DESC, last_seen_at DESC
      LIMIT $1
      `,
      values
    );

    return res.json({ ok: true, rows, sinceHours });
  } catch (e) {
    console.error("getActivitySessions error:", e);
    return res.status(500).json({ ok: false, error: "activity_sessions_failed" });
  }
}

async function getActivityTimeline(req, res) {
  try {
    await ensureActivityEventsTable();
    const limit = clampInt(req.query.limit, 200, 1, 500);
    const sinceHours = hoursFilter(req, 336);
    const actorRole = safeText(req.query.actor_role || req.query.role, 40).toLowerCase();
    const actorId = safeInt(req.query.actor_id || req.query.actorId);
    const sessionId = safeText(req.query.session_id || req.query.sessionId, 160);
    const serviceId = safeInt(req.query.service_id || req.query.serviceId);
    const providerId = safeInt(req.query.provider_id || req.query.providerId);
    const clientId = safeInt(req.query.client_id || req.query.clientId);

    const values = [];
    const where = [];
    values.push(sinceHours);
    where.push(`ae.created_at >= NOW() - ($${values.length}::int || ' hours')::interval`);
    if (actorRole) { values.push(actorRole); where.push(`LOWER(COALESCE(ae.actor_role,'')) = $${values.length}`); }
    if (actorId) { values.push(actorId); where.push(`ae.actor_id = $${values.length}`); }
    if (sessionId) { values.push(sessionId); where.push(`ae.session_id = $${values.length}`); }
    if (serviceId) { values.push(serviceId); where.push(`ae.service_id = $${values.length}`); }
    if (providerId) { values.push(providerId); where.push(`ae.provider_id = $${values.length}`); }
    if (clientId) { values.push(clientId); where.push(`ae.client_id = $${values.length}`); }
    values.push(limit);

    const { rows } = await pool.query(
      `
      SELECT ae.*, s.title AS service_title, p.name AS provider_company_name, c.name AS client_name, c.phone AS client_phone
        FROM activity_events ae
        LEFT JOIN services s ON s.id = ae.service_id
        LEFT JOIN providers p ON p.id = COALESCE(ae.provider_id, s.provider_id)
        LEFT JOIN clients c ON c.id = COALESCE(ae.client_id, CASE WHEN ae.actor_role = 'client' THEN ae.actor_id ELSE NULL END)
       WHERE ${where.join(" AND ")}
       ORDER BY ae.created_at ASC, ae.id ASC
       LIMIT $${values.length}
      `,
      values
    );
    return res.json({ ok: true, rows });
  } catch (e) {
    console.error("getActivityTimeline error:", e);
    return res.status(500).json({ ok: false, error: "activity_timeline_failed" });
  }
}

async function getActivityFunnel(req, res) {
  try {
    await ensureActivityEventsTable();
    const sinceHours = hoursFilter(req, 24 * 7);
    const serviceId = safeInt(req.query.service_id || req.query.serviceId);
    const values = [sinceHours];
    const extraWhere = [];
    if (serviceId) { values.push(serviceId); extraWhere.push(`AND service_id = $${values.length}`); }

    const { rows } = await pool.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE event_name = 'page_view' OR event_type = 'page_view')::int AS page_views,
        COUNT(*) FILTER (WHERE event_name ILIKE '%service_stats%' OR event_name ILIKE '%view%' OR page_path ILIKE '%service%')::int AS service_views,
        COUNT(*) FILTER (WHERE element_text ILIKE '%подробнее%' OR event_name ILIKE '%detail%')::int AS details,
        COUNT(*) FILTER (WHERE element_text ILIKE '%быстрый запрос%' OR event_name ILIKE '%request%')::int AS quick_requests,
        COUNT(*) FILTER (WHERE element_text ILIKE '%контакт%' OR event_name ILIKE '%unlock%' OR event_name ILIKE '%contact%')::int AS contact_intents,
        COUNT(*) FILTER (WHERE event_name ILIKE '%click%' OR element_text ILIKE '%click%' OR event_name ILIKE '%payme%' OR event_name ILIKE '%payment%')::int AS payment_intents,
        COUNT(*) FILTER (WHERE event_name ILIKE '%successful_payment%' OR event_name ILIKE '%complete%' OR event_name ILIKE '%paid%' OR meta->>'status' = 'paid')::int AS paid_events
      FROM activity_events
      WHERE created_at >= NOW() - ($1::int || ' hours')::interval
      ${extraWhere.join("\n")}
      `,
      values
    );

    const r = rows[0] || {};
    const steps = [
      { key: "page_views", label: "Открыли страницы", count: r.page_views || 0 },
      { key: "service_views", label: "Смотрели услуги", count: r.service_views || 0 },
      { key: "details", label: "Нажали подробнее", count: r.details || 0 },
      { key: "quick_requests", label: "Быстрый запрос", count: r.quick_requests || 0 },
      { key: "contact_intents", label: "Хотели контакты", count: r.contact_intents || 0 },
      { key: "payment_intents", label: "Перешли к оплате", count: r.payment_intents || 0 },
      { key: "paid_events", label: "Оплачено/успешно", count: r.paid_events || 0 },
    ];
    return res.json({ ok: true, sinceHours, serviceId, steps });
  } catch (e) {
    console.error("getActivityFunnel error:", e);
    return res.status(500).json({ ok: false, error: "activity_funnel_failed" });
  }
}

async function getActivityHotLeads(req, res) {
  try {
    await ensureActivityEventsTable();
    const sinceHours = hoursFilter(req, 72);
    const limit = clampInt(req.query.limit, 100, 1, 300);
    const values = [sinceHours, limit];

    const { rows } = await pool.query(
      `
      WITH grouped AS (
        SELECT
          COALESCE(actor_role,'unknown') AS actor_role,
          actor_id,
          session_id,
          MAX(created_at) AS last_seen_at,
          MIN(created_at) AS first_seen_at,
          (ARRAY_AGG(actor_name ORDER BY created_at DESC, id DESC))[1] AS actor_name,
          (ARRAY_AGG(actor_phone ORDER BY created_at DESC, id DESC))[1] AS actor_phone,
          (ARRAY_AGG(client_id ORDER BY created_at DESC, id DESC))[1] AS client_id,
          (ARRAY_AGG(provider_id ORDER BY created_at DESC, id DESC))[1] AS provider_id,
          (ARRAY_AGG(service_id ORDER BY created_at DESC, id DESC))[1] AS service_id,
          COUNT(*)::int AS events_count,
          COUNT(*) FILTER (WHERE event_type = 'click')::int AS clicks_count,
          COUNT(*) FILTER (WHERE element_text ILIKE '%контакт%' OR event_name ILIKE '%unlock%' OR event_name ILIKE '%contact%')::int AS contact_intents,
          COUNT(*) FILTER (WHERE element_text ILIKE '%быстрый запрос%' OR event_name ILIKE '%request%')::int AS quick_requests,
          COUNT(*) FILTER (WHERE event_name ILIKE '%pay%' OR event_name ILIKE '%click%' OR event_name ILIKE '%payment%')::int AS payment_intents,
          COUNT(*) FILTER (WHERE event_type ILIKE '%error%' OR event_name ILIKE '%error%' OR (meta->>'status_code')::int >= 400)::int AS errors_count,
          ARRAY_AGG(event_name ORDER BY created_at DESC, id DESC) AS recent_events
        FROM activity_events
        WHERE created_at >= NOW() - ($1::int || ' hours')::interval
        GROUP BY COALESCE(actor_role,'unknown'), actor_id, session_id
      )
      SELECT *,
        (events_count + clicks_count * 2 + contact_intents * 10 + quick_requests * 7 + payment_intents * 12 + errors_count * 5)::int AS lead_score
      FROM grouped
      ORDER BY lead_score DESC, last_seen_at DESC
      LIMIT $2
      `,
      values
    );
    return res.json({ ok: true, sinceHours, rows });
  } catch (e) {
    console.error("getActivityHotLeads error:", e);
    return res.status(500).json({ ok: false, error: "activity_hot_leads_failed" });
  }
}

async function getActivityServices(req, res) {
  try {
    await ensureActivityEventsTable();
    const sinceHours = hoursFilter(req, 24 * 7);
    const limit = clampInt(req.query.limit, 100, 1, 300);
    const values = [sinceHours, limit];

    const { rows } = await pool.query(
      `
      SELECT
        ae.service_id,
        s.title AS service_title,
        s.category AS service_category,
        COALESCE(ae.provider_id, s.provider_id) AS provider_id,
        p.name AS provider_name,
        COUNT(*)::int AS events_count,
        COUNT(*) FILTER (WHERE ae.event_type = 'page_view' OR ae.event_name ILIKE '%view%')::int AS views,
        COUNT(*) FILTER (WHERE ae.event_type = 'click')::int AS clicks,
        COUNT(*) FILTER (WHERE ae.element_text ILIKE '%подробнее%' OR ae.event_name ILIKE '%detail%')::int AS details,
        COUNT(*) FILTER (WHERE ae.element_text ILIKE '%быстрый запрос%' OR ae.event_name ILIKE '%request%')::int AS quick_requests,
        COUNT(*) FILTER (WHERE ae.element_text ILIKE '%контакт%' OR ae.event_name ILIKE '%unlock%' OR ae.event_name ILIKE '%contact%')::int AS contact_intents,
        COUNT(DISTINCT ae.session_id)::int AS sessions,
        MAX(ae.created_at) AS last_event_at
      FROM activity_events ae
      LEFT JOIN services s ON s.id = ae.service_id
      LEFT JOIN providers p ON p.id = COALESCE(ae.provider_id, s.provider_id)
      WHERE ae.created_at >= NOW() - ($1::int || ' hours')::interval
        AND ae.service_id IS NOT NULL
      GROUP BY ae.service_id, s.title, s.category, COALESCE(ae.provider_id, s.provider_id), p.name
      ORDER BY contact_intents DESC, quick_requests DESC, events_count DESC
      LIMIT $2
      `,
      values
    );
    return res.json({ ok: true, sinceHours, rows });
  } catch (e) {
    console.error("getActivityServices error:", e);
    return res.status(500).json({ ok: false, error: "activity_services_failed" });
  }
}

module.exports = {
  trackActivityEvent,
  getActivityEvents,
  getActivityOverview,
  getActivitySessions,
  getActivityTimeline,
  getActivityFunnel,
  getActivityHotLeads,
  getActivityServices,
};
