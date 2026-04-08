//backend/controllers/serviceStatsController.js

const pool = require("../db");

function getViewerKey(req) {
  const userId =
    req.user?.id ||
    req.user?.client_id ||
    req.user?.provider_id ||
    null;

  if (userId) return `user:${userId}`;

  const headerKey = String(req.headers["x-viewer-key"] || "").trim();
  if (headerKey) return `guest:${headerKey}`;

  const ip =
    req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ||
    req.ip ||
    "unknown";

  return `ip:${ip}`;
}

// POST /api/service-stats/:id/view
async function registerServiceView(req, res) {
  const serviceId = Number(req.params.id);
  if (!Number.isFinite(serviceId) || serviceId <= 0) {
    return res.status(400).json({ ok: false, error: "bad_service_id" });
  }

  const viewerKey = getViewerKey(req);

  try {
    const serviceCheck = await pool.query(
      `SELECT id FROM services WHERE id = $1 LIMIT 1`,
      [serviceId]
    );

    if (!serviceCheck.rows.length) {
      return res.status(404).json({ ok: false, error: "service_not_found" });
    }

    // антиспам: не чаще одного просмотра от одного viewer_key на одну услугу за 10 минут
    await pool.query(
      `
      INSERT INTO service_views (service_id, viewer_key)
      SELECT $1, $2
      WHERE NOT EXISTS (
        SELECT 1
        FROM service_views
        WHERE service_id = $1
          AND viewer_key = $2
          AND created_at >= NOW() - INTERVAL '10 minutes'
      )
      `,
      [serviceId, viewerKey]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("[serviceStats] registerServiceView error:", err);
    return res.status(500).json({ ok: false, error: "view_register_failed" });
  }
}

// GET /api/service-stats/:id
async function getServiceStats(req, res) {
  const serviceId = Number(req.params.id);
  if (!Number.isFinite(serviceId) || serviceId <= 0) {
    return res.status(400).json({ ok: false, error: "bad_service_id" });
  }

  try {
    const [viewsQ, watchingQ, unlocksQ] = await Promise.all([
      pool.query(
        `
        SELECT COUNT(*)::int AS views_count
        FROM service_views
        WHERE service_id = $1
        `,
        [serviceId]
      ),
      pool.query(
        `
        SELECT COUNT(DISTINCT viewer_key)::int AS watching_now
        FROM service_views
        WHERE service_id = $1
          AND created_at >= NOW() - INTERVAL '2 minutes'
        `,
        [serviceId]
      ),
      pool.query(
        `
        SELECT COUNT(*)::int AS unlocks_count
        FROM client_service_contact_unlocks
        WHERE service_id = $1
        `,
        [serviceId]
      ),
    ]);

    return res.json({
      ok: true,
      viewsCount: viewsQ.rows[0]?.views_count || 0,
      watchingNow: watchingQ.rows[0]?.watching_now || 0,
      unlocksCount: unlocksQ.rows[0]?.unlocks_count || 0,
    });
  } catch (err) {
    console.error("[serviceStats] getServiceStats error:", err);
    return res.status(500).json({ ok: false, error: "stats_failed" });
  }
}

module.exports = {
  registerServiceView,
  getServiceStats,
};
