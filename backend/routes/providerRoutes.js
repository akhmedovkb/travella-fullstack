// backend/routes/providerRoutes.js
const express = require("express");
const router = express.Router();

const pool = require("../db");
const authenticateToken = require("../middleware/authenticateToken");

const {
  registerProvider,
  loginProvider,
  getProviderProfile,
  updateProviderProfile,
  changeProviderPassword,
  addService,
  getServices,
  updateService,
  deleteService,
  restoreService,
  purgeService,
  serviceAction,
  updateServiceImagesOnly,
  getBookedDates,
  getBlockedDates,
  saveBlockedDates,
  getCalendarPublic,
  getProviderPublicById,
  searchProvidersPublic,
  availableProvidersPublic,
  getProviderStats,
  listProviderFavorites,
  toggleProviderFavorite,
  removeProviderFavorite,
  listProviderServices,
  createProviderService,
  patchProviderService,
  bulkCreateProviderServices,
  deleteProviderService,
  getProviderServicesPublic,

  // ✅ TRASH (корзина)
  getProviderDeletedServices,
  restoreProviderService,
  purgeProviderService,
} = require("../controllers/providerController");

const {
  loginProviderWithTelegram,
} = require("../controllers/providerTelegramAuthController");

const { notifyModerationNew } = require("../utils/telegram");
const { logProviderServiceAction } = require("../utils/serviceAuditLog");
const { applyServiceLifecycleAction } = require("../utils/serviceLifecycle");

function requireProvider(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ message: "Требуется авторизация" });
  }
  if (req.user.role && req.user.role !== "provider") {
    return res.status(403).json({ message: "Только для провайдера" });
  }
  next();
}

/* -------------------- PUBLIC SEARCH / AVAILABLE -------------------- */

router.get("/search", searchProvidersPublic);
router.get("/available", availableProvidersPublic);

/* -------------------- AUTH / PROFILE / SERVICES / CALENDAR -------------------- */

router.post("/register", registerProvider);
router.post("/login", loginProvider);
router.post("/telegram-login", loginProviderWithTelegram);

router.get("/profile", authenticateToken, requireProvider, getProviderProfile);
router.put("/profile", authenticateToken, requireProvider, updateProviderProfile);
router.put("/password", authenticateToken, requireProvider, changeProviderPassword);

router.get("/stats", authenticateToken, requireProvider, getProviderStats);


router.get("/finance", authenticateToken, requireProvider, async (req, res) => {
  const providerId = Number(req.user.id);
  if (!Number.isFinite(providerId) || providerId <= 0) {
    return res.status(401).json({ ok: false, message: "Требуется авторизация поставщика" });
  }

  async function hasTable(name) {
    const r = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1 LIMIT 1`,
      [name]
    );
    return !!r.rowCount;
  }

  async function hasColumns(table, columns) {
    const r = await pool.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name=$1
        AND column_name = ANY($2::text[])
      `,
      [table, columns]
    );
    return new Set((r.rows || []).map((x) => x.column_name));
  }

  try {
    const unlocksQ = await pool.query(
      `
      SELECT
        u.id,
        u.client_id,
        u.service_id,
        u.source,
        u.created_at,
        COALESCE(c.name, c.full_name, c.phone, 'Client #' || u.client_id::text) AS client_name,
        c.phone AS client_phone,
        c.telegram AS client_telegram,
        s.title AS service_title,
        s.category AS service_category
      FROM client_service_contact_unlocks u
      JOIN services s ON s.id = u.service_id
      LEFT JOIN clients c ON c.id = u.client_id
      WHERE s.provider_id = $1
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT 50
      `,
      [providerId]
    );

    const statsQ = await pool.query(
      `
      SELECT
        COUNT(*)::bigint AS unlock_count,
        COUNT(DISTINCT u.client_id)::bigint AS hot_clients_count
      FROM client_service_contact_unlocks u
      JOIN services s ON s.id = u.service_id
      WHERE s.provider_id = $1
      `,
      [providerId]
    );

    const hotClientsQ = await pool.query(
      `
      SELECT
        u.client_id,
        COALESCE(c.name, c.full_name, c.phone, 'Client #' || u.client_id::text) AS client_name,
        c.phone AS client_phone,
        c.telegram AS client_telegram,
        COUNT(*)::bigint AS unlock_count,
        MAX(u.created_at) AS last_activity_at,
        (ARRAY_AGG(s.title ORDER BY u.created_at DESC, u.id DESC))[1] AS last_service_title
      FROM client_service_contact_unlocks u
      JOIN services s ON s.id = u.service_id
      LEFT JOIN clients c ON c.id = u.client_id
      WHERE s.provider_id = $1
      GROUP BY u.client_id, c.name, c.full_name, c.phone, c.telegram
      ORDER BY COUNT(*) DESC, MAX(u.created_at) DESC
      LIMIT 30
      `,
      [providerId]
    );

    const topServicesQ = await pool.query(
      `
      SELECT
        s.id AS service_id,
        s.title AS service_title,
        s.category AS service_category,
        COUNT(u.id)::bigint AS unlock_count,
        MAX(u.created_at) AS last_unlock_at
      FROM services s
      LEFT JOIN client_service_contact_unlocks u ON u.service_id = s.id
      WHERE s.provider_id = $1
        AND s.deleted_at IS NULL
      GROUP BY s.id, s.title, s.category
      HAVING COUNT(u.id) > 0
      ORDER BY COUNT(u.id) DESC, MAX(u.created_at) DESC NULLS LAST
      LIMIT 20
      `,
      [providerId]
    );

    let viewsCount = 0;
    let quickRequests = [];

    if (await hasTable("service_views")) {
      const cols = await hasColumns("service_views", ["service_id", "created_at"]);
      if (cols.has("service_id")) {
        const viewsQ = await pool.query(
          `
          SELECT COUNT(*)::bigint AS views_count
          FROM service_views v
          JOIN services s ON s.id = v.service_id
          WHERE s.provider_id = $1
          `,
          [providerId]
        );
        viewsCount = Number(viewsQ.rows?.[0]?.views_count || 0);
      }
    }

    if (await hasTable("quick_requests")) {
      const cols = await hasColumns("quick_requests", ["id", "service_id", "client_id", "name", "client_name", "message", "status", "created_at"]);
      if (cols.has("service_id")) {
        const nameExpr = cols.has("client_name") ? "qr.client_name" : (cols.has("name") ? "qr.name" : "NULL::text");
        const messageExpr = cols.has("message") ? "qr.message" : "NULL::text";
        const statusExpr = cols.has("status") ? "qr.status" : "'new'::text";
        const createdExpr = cols.has("created_at") ? "qr.created_at" : "NOW()";
        const idExpr = cols.has("id") ? "qr.id" : "NULL::bigint";
        const quickQ = await pool.query(
          `
          SELECT
            ${idExpr} AS id,
            qr.service_id,
            ${nameExpr} AS client_name,
            ${messageExpr} AS message,
            ${statusExpr} AS status,
            ${createdExpr} AS created_at,
            s.title AS service_title,
            s.category AS service_category
          FROM quick_requests qr
          JOIN services s ON s.id = qr.service_id
          WHERE s.provider_id = $1
          ORDER BY ${createdExpr} DESC
          LIMIT 30
          `,
          [providerId]
        );
        quickRequests = quickQ.rows || [];
      }
    }

    const baseStats = statsQ.rows?.[0] || {};
    return res.json({
      ok: true,
      provider_id: providerId,
      stats: {
        unlock_count: Number(baseStats.unlock_count || 0),
        hot_clients_count: Number(baseStats.hot_clients_count || 0),
        views_count: Number(viewsCount || 0),
        quick_requests_count: quickRequests.length,
      },
      recent_unlocks: unlocksQ.rows || [],
      hot_clients: hotClientsQ.rows || [],
      top_services: topServicesQ.rows || [],
      quick_requests: quickRequests,
    });
  } catch (e) {
    console.error("providers/finance demand dashboard error:", e);
    return res.status(500).json({ ok: false, message: "provider demand dashboard error" });
  }
});


router.get("/services", authenticateToken, requireProvider, getServices);
router.post("/services", authenticateToken, requireProvider, addService);
router.put("/services/:id", authenticateToken, requireProvider, updateService);
router.delete("/services/:id", authenticateToken, requireProvider, deleteService);
router.post("/services/:id/restore", authenticateToken, requireProvider, restoreService);
router.delete("/services/:id/purge", authenticateToken, requireProvider, purgeService);
router.post("/services/:id/action", authenticateToken, requireProvider, serviceAction);
router.patch("/services/:id/images", authenticateToken, requireProvider, updateServiceImagesOnly);

/* -------------------- PROVIDER SERVICES (каскад в профиле) -------------------- */
// Важно: ставим ДО маршрута "/:id(\\d+)", чтобы порядок не мешал.
// Публичный просмотр каскадных услуг провайдера (только активные; включает vehicle_model)
router.get("/:providerId(\\d+)/services/public", getProviderServicesPublic);

router.get("/:providerId(\\d+)/services", authenticateToken, requireProvider, listProviderServices);
router.post("/:providerId(\\d+)/services", authenticateToken, requireProvider, createProviderService);
router.patch("/:providerId(\\d+)/services/:id(\\d+)", authenticateToken, requireProvider, patchProviderService);
router.post("/:providerId(\\d+)/services/bulk", authenticateToken, requireProvider, bulkCreateProviderServices);
router.delete("/:providerId(\\d+)/services/:id(\\d+)", authenticateToken, requireProvider, deleteProviderService);

/* -------------------- ✅ TRASH / корзина (каскадные услуги) -------------------- */
router.get("/:providerId(\\d+)/services/deleted", authenticateToken, requireProvider, getProviderDeletedServices);
router.post("/:providerId(\\d+)/services/:id(\\d+)/restore", authenticateToken, requireProvider, restoreProviderService);
router.delete("/:providerId(\\d+)/services/:id(\\d+)/purge", authenticateToken, requireProvider, purgeProviderService);

router.get("/booked-dates", authenticateToken, requireProvider, getBookedDates);
router.get("/blocked-dates", authenticateToken, requireProvider, getBlockedDates);
router.post("/blocked-dates", authenticateToken, requireProvider, saveBlockedDates);

router.get("/booked-details", authenticateToken, requireProvider, async (req, res) => {
  try {
    const providerId = req.user.id;
    const q = await pool.query(
      `
        SELECT
           bd.date::text AS date,
           COALESCE(rp.name, c.name)   AS name,
           COALESCE(rp.phone, c.phone) AS phone,
           CASE WHEN rp.id IS NOT NULL THEN rp.social ELSE c.telegram END AS telegram,
           CASE WHEN rp.id IS NOT NULL THEN 'provider' ELSE 'client' END   AS role,
           COALESCE(rp.id, c.id) AS "profileId",
           CASE
             WHEN rp.id IS NOT NULL THEN '/profile/provider/' || rp.id
             ELSE '/profile/client/'   || c.id
           END AS "profileUrl"
        FROM booking_dates bd
        JOIN bookings b   ON b.id = bd.booking_id
        LEFT JOIN clients   c  ON c.id = b.client_id
        LEFT JOIN providers rp ON rp.id = b.requester_provider_id
        WHERE b.provider_id = $1
          AND b.status IN ('confirmed','active')
          AND bd.date >= CURRENT_DATE
        ORDER BY bd.date, name
      `,
      [providerId]
    );
    res.json(q.rows);
  } catch (e) {
    console.error("providers/booked-details error:", e);
    res.status(500).json({ message: "booked-details error" });
  }
});

router.get("/calendar", authenticateToken, requireProvider, async (req, res) => {
  try {
    const providerId = req.user.id;
    const [booked, blocked, details] = await Promise.all([
      pool.query(
        `
          SELECT DISTINCT bd.date::text AS date
          FROM booking_dates bd
          JOIN bookings b ON b.id = bd.booking_id
          WHERE b.provider_id = $1
            AND b.status IN ('confirmed','active')
            AND bd.date >= CURRENT_DATE
          ORDER BY 1
        `,
        [providerId]
      ),
      pool.query(
        `
          SELECT date::text AS date
          FROM provider_blocked_dates
          WHERE provider_id = $1
          ORDER BY 1
        `,
        [providerId]
      ),
      pool.query(
        `
          SELECT
             bd.date::text AS date,
             COALESCE(rp.name, c.name)   AS name,
             COALESCE(rp.phone, c.phone) AS phone,
             CASE WHEN rp.id IS NOT NULL THEN rp.social ELSE c.telegram END AS telegram,
             CASE WHEN rp.id IS NOT NULL THEN 'provider' ELSE 'client' END   AS role,
             COALESCE(rp.id, c.id) AS "profileId",
             CASE
               WHEN rp.id IS NOT NULL THEN '/profile/provider/' || rp.id
               ELSE '/profile/client/' || c.id
             END AS "profileUrl"
          FROM booking_dates bd
          JOIN bookings b   ON b.id = bd.booking_id
          LEFT JOIN clients   c  ON c.id = b.client_id
          LEFT JOIN providers rp ON rp.id = b.requester_provider_id
          WHERE b.provider_id = $1
            AND b.status IN ('confirmed','active')
            AND bd.date >= CURRENT_DATE
          ORDER BY bd.date, name
        `,
        [providerId]
      ),
    ]);
    res.json({
      booked: booked.rows,
      blocked: blocked.rows,
      bookedDetails: details.rows,
    });
  } catch (e) {
    console.error("providers/calendar error:", e);
    res.status(500).json({ message: "calendar error" });
  }
});

router.get("/:providerId(\\d+)/calendar", getCalendarPublic);

/* -------------------- FAVORITES -------------------- */

router.get("/favorites", authenticateToken, requireProvider, listProviderFavorites);
router.post("/favorites/toggle", authenticateToken, requireProvider, toggleProviderFavorite);
router.delete("/favorites/:serviceId", authenticateToken, requireProvider, removeProviderFavorite);

/* -------------------- SUBMIT SERVICE TO MODERATION -------------------- */

router.post(
  "/services/:id/submit",
  authenticateToken,
  requireProvider,
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const applied = await applyServiceLifecycleAction(pool, {
        providerId: req.user.id,
        serviceId: id,
        action: "submit",
      });

      await logProviderServiceAction({
        req,
        action: "service_submitted",
        providerId: req.user.id,
        serviceId: id,
        oldService: applied.before,
        newService: applied.service,
        meta: { submitted_to_moderation: true },
      });

      try {
        await notifyModerationNew({ service: id });
      } catch {}

      return res.json({ ok: true, service: applied.service });
    } catch (e) {
      if (e?.code === "PROOF_IMAGES_REQUIRED") {
        return res.status(400).json({
          message: "Before sending to moderation, upload screenshots confirming the authenticity of the booking/ticket.",
          code: "PROOF_IMAGES_REQUIRED",
        });
      }

      if (e?.code === "SERVICE_NOT_SUBMITTABLE") {
        return res.status(409).json({
          message: "Service must be in draft/rejected (or empty status) to submit",
          code: e.code,
        });
      }

      return next(e);
    }
  }
);

router.get("/:id(\\d+)", getProviderPublicById);

/* -------------------- HOTELS -------------------- */
router.get("/me", authenticateToken, requireProvider, async (req, res) => {
  try {
    const providerId = req.user.id;
    const q = await pool.query("SELECT id FROM hotels WHERE provider_id=$1 LIMIT 1", [providerId]);
    return res.json({
      id: providerId,
      hotel_id: q.rows?.[0]?.id || null,
    });
  } catch (e) {
    console.error("providers/me error:", e);
    res.status(500).json({ message: "me error" });
  }
});

module.exports = router;
