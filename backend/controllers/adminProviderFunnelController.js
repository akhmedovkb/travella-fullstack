// backend/controllers/adminProviderFunnelController.js
const pool = require("../db");
const { ensureProviderFunnelTables } = require("../utils/providerFunnel");

function clampDays(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 7;
  return Math.max(1, Math.min(90, Math.trunc(n)));
}

function clampLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.max(1, Math.min(500, Math.trunc(n)));
}

async function getProviderFunnelSummary(req, res) {
  try {
    await ensureProviderFunnelTables();

    const days = clampDays(req.query.days);
    const sinceSql = `NOW() - ($1::int * interval '1 day')`;

    const totalsQ = await pool.query(
      `
      SELECT
        COUNT(*)::int AS total_events,
        COUNT(DISTINCT provider_id)::int AS providers,
        COUNT(DISTINCT service_id)::int AS services,
        COUNT(*) FILTER (WHERE event_name = 'wizard_started')::int AS wizard_started,
        COUNT(*) FILTER (WHERE event_name = 'wizard_step')::int AS wizard_steps,
        COUNT(*) FILTER (WHERE event_name = 'wizard_saved_draft')::int AS wizard_saved_draft,
        COUNT(*) FILTER (WHERE event_name = 'proof_uploaded')::int AS proof_uploaded,
        COUNT(*) FILTER (WHERE event_name = 'submitted_to_moderation')::int AS submitted_to_moderation,
        COUNT(*) FILTER (WHERE event_name = 'approved')::int AS approved,
        COUNT(*) FILTER (WHERE event_name = 'rejected')::int AS rejected,
        COUNT(*) FILTER (WHERE event_name = 'published')::int AS published,
        COUNT(*) FILTER (WHERE event_name = 'archived')::int AS archived,
        COUNT(*) FILTER (WHERE event_name = 'deleted')::int AS deleted
      FROM provider_funnel_events
      WHERE created_at >= ${sinceSql}
      `,
      [days]
    );

    const byEventQ = await pool.query(
      `
      SELECT event_name, COUNT(*)::int AS count
      FROM provider_funnel_events
      WHERE created_at >= ${sinceSql}
      GROUP BY event_name
      ORDER BY count DESC, event_name ASC
      `,
      [days]
    );

    const byStepQ = await pool.query(
      `
      SELECT COALESCE(step, '—') AS step, COUNT(*)::int AS count
      FROM provider_funnel_events
      WHERE created_at >= ${sinceSql}
        AND event_name = 'wizard_step'
      GROUP BY COALESCE(step, '—')
      ORDER BY count DESC, step ASC
      LIMIT 50
      `,
      [days]
    );

    const byCategoryQ = await pool.query(
      `
      SELECT COALESCE(category, '—') AS category, COUNT(*)::int AS count
      FROM provider_funnel_events
      WHERE created_at >= ${sinceSql}
      GROUP BY COALESCE(category, '—')
      ORDER BY count DESC, category ASC
      LIMIT 30
      `,
      [days]
    );

    const bySourceQ = await pool.query(
      `
      SELECT COALESCE(source, 'unknown') AS source, COUNT(*)::int AS count
      FROM provider_funnel_events
      WHERE created_at >= ${sinceSql}
      GROUP BY COALESCE(source, 'unknown')
      ORDER BY count DESC, source ASC
      LIMIT 20
      `,
      [days]
    );

    const latestStepsQ = await pool.query(
      `
      WITH latest AS (
        SELECT DISTINCT ON (COALESCE(session_id, provider_id::text, actor_id::text, service_id::text, id::text))
          COALESCE(session_id, provider_id::text, actor_id::text, service_id::text, id::text) AS funnel_key,
          event_name,
          COALESCE(step, '—') AS step,
          created_at
        FROM provider_funnel_events
        WHERE created_at >= ${sinceSql}
        ORDER BY COALESCE(session_id, provider_id::text, actor_id::text, service_id::text, id::text), created_at DESC
      )
      SELECT step, COUNT(*)::int AS count
      FROM latest
      WHERE event_name = 'wizard_step'
      GROUP BY step
      ORDER BY count DESC, step ASC
      LIMIT 30
      `,
      [days]
    );

    const recentQ = await pool.query(
      `
      SELECT
        e.id,
        e.created_at,
        e.source,
        e.actor_role,
        e.actor_id,
        e.provider_id,
        e.service_id,
        e.category,
        e.event_name,
        e.step,
        e.status,
        e.session_id,
        e.meta,
        COALESCE(
          to_jsonb(p)->>'company_name',
          to_jsonb(p)->>'name',
          to_jsonb(p)->>'full_name',
          to_jsonb(p)->>'phone',
          CONCAT('Provider #', e.provider_id)
        ) AS provider_label,
        COALESCE(
          to_jsonb(s)->>'title',
          to_jsonb(s)->'details'->>'title',
          CONCAT('Service #', e.service_id)
        ) AS service_label
      FROM provider_funnel_events e
      LEFT JOIN providers p ON p.id = e.provider_id
      LEFT JOIN services s ON s.id = e.service_id
      WHERE e.created_at >= ${sinceSql}
      ORDER BY e.created_at DESC
      LIMIT 25
      `,
      [days]
    );

    res.json({
      ok: true,
      days,
      totals: totalsQ.rows[0] || {},
      by_event: byEventQ.rows,
      by_step: byStepQ.rows,
      by_category: byCategoryQ.rows,
      by_source: bySourceQ.rows,
      abandoned_steps: latestStepsQ.rows,
      recent: recentQ.rows,
    });
  } catch (err) {
    console.error("[admin-provider-funnel] summary error:", err);
    res.status(500).json({ ok: false, error: err?.message || "SERVER_ERROR" });
  }
}

async function listProviderFunnelEvents(req, res) {
  try {
    await ensureProviderFunnelTables();

    const days = clampDays(req.query.days);
    const limit = clampLimit(req.query.limit);
    const eventName = String(req.query.event || "").trim();
    const providerId = Number(req.query.provider_id || 0);
    const serviceId = Number(req.query.service_id || 0);

    const params = [days, limit];
    const where = [`e.created_at >= NOW() - ($1::int * interval '1 day')`];

    if (eventName) {
      params.push(eventName);
      where.push(`e.event_name = $${params.length}`);
    }

    if (Number.isFinite(providerId) && providerId > 0) {
      params.push(providerId);
      where.push(`e.provider_id = $${params.length}`);
    }

    if (Number.isFinite(serviceId) && serviceId > 0) {
      params.push(serviceId);
      where.push(`e.service_id = $${params.length}`);
    }

    const q = await pool.query(
      `
      SELECT
        e.id,
        e.created_at,
        e.source,
        e.actor_role,
        e.actor_id,
        e.provider_id,
        e.service_id,
        e.category,
        e.event_name,
        e.step,
        e.status,
        e.session_id,
        e.meta,
        COALESCE(
          to_jsonb(p)->>'company_name',
          to_jsonb(p)->>'name',
          to_jsonb(p)->>'full_name',
          to_jsonb(p)->>'phone',
          CONCAT('Provider #', e.provider_id)
        ) AS provider_label,
        COALESCE(
          to_jsonb(s)->>'title',
          to_jsonb(s)->'details'->>'title',
          CONCAT('Service #', e.service_id)
        ) AS service_label
      FROM provider_funnel_events e
      LEFT JOIN providers p ON p.id = e.provider_id
      LEFT JOIN services s ON s.id = e.service_id
      WHERE ${where.join(" AND ")}
      ORDER BY e.created_at DESC
      LIMIT $2
      `,
      params
    );

    res.json({ ok: true, days, limit, events: q.rows });
  } catch (err) {
    console.error("[admin-provider-funnel] events error:", err);
    res.status(500).json({ ok: false, error: err?.message || "SERVER_ERROR" });
  }
}

module.exports = {
  getProviderFunnelSummary,
  listProviderFunnelEvents,
};
