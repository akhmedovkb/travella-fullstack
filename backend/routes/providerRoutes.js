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

  async function getColumns(table) {
    const r = await pool.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name=$1
      `,
      [table]
    );
    return new Set((r.rows || []).map((x) => x.column_name));
  }

  function col(cols, name, sqlIfExists, fallbackSql = "NULL::text") {
    return cols.has(name) ? sqlIfExists : fallbackSql;
  }

  function firstExisting(cols, candidates, alias, fallbackSql = "NULL::text") {
    const parts = candidates.filter((x) => cols.has(x)).map((x) => `NULLIF(c.${x}::text, '')`);
    return parts.length ? `COALESCE(${parts.join(", ")}, ${fallbackSql}) AS ${alias}` : `${fallbackSql} AS ${alias}`;
  }

  try {
    const unlockCols = await getColumns("client_service_contact_unlocks");
    const clientCols = (await hasTable("clients")) ? await getColumns("clients") : new Set();
    const serviceCols = await getColumns("services");

    const unlockIdExpr = unlockCols.has("id") ? "u.id" : "ROW_NUMBER() OVER (ORDER BY u.created_at DESC)::bigint";
    const unlockSourceExpr = unlockCols.has("source") ? "COALESCE(NULLIF(u.source::text, ''), 'marketplace')" : "'marketplace'::text";
    const unlockCreatedExpr = unlockCols.has("created_at") ? "u.created_at" : "NOW()";

    const clientNameSelect = clientCols.size
      ? firstExisting(clientCols, ["name", "full_name", "first_name", "phone", "email", "telegram"], "client_name", "'Клиент'::text")
      : "'Клиент'::text AS client_name";
    const clientPhoneSelect = clientCols.has("phone") ? "c.phone AS client_phone" : "NULL::text AS client_phone";
    const clientTelegramSelect = clientCols.has("telegram")
      ? "c.telegram AS client_telegram"
      : (clientCols.has("username") ? "c.username AS client_telegram" : "NULL::text AS client_telegram");

    const serviceTitleExpr = serviceCols.has("title") ? "s.title" : "('Услуга #' || s.id::text)";
    const serviceCategoryExpr = serviceCols.has("category") ? "s.category" : "NULL::text";

    const unlocksQ = await pool.query(
      `
      SELECT
        ${unlockIdExpr} AS id,
        u.client_id,
        u.service_id,
        ${unlockSourceExpr} AS source,
        ${unlockCreatedExpr} AS created_at,
        ${clientNameSelect},
        ${clientPhoneSelect},
        ${clientTelegramSelect},
        ${serviceTitleExpr} AS service_title,
        ${serviceCategoryExpr} AS service_category
      FROM client_service_contact_unlocks u
      JOIN services s ON s.id = u.service_id
      ${clientCols.size ? "LEFT JOIN clients c ON c.id = u.client_id" : ""}
      WHERE s.provider_id = $1
      ORDER BY ${unlockCreatedExpr} DESC, ${unlockIdExpr} DESC
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
        ${clientNameSelect},
        ${clientPhoneSelect},
        ${clientTelegramSelect},
        COUNT(*)::bigint AS unlock_count,
        MAX(${unlockCreatedExpr}) AS last_activity_at,
        (ARRAY_AGG(${serviceTitleExpr} ORDER BY ${unlockCreatedExpr} DESC, ${unlockIdExpr} DESC))[1] AS last_service_title
      FROM client_service_contact_unlocks u
      JOIN services s ON s.id = u.service_id
      ${clientCols.size ? "LEFT JOIN clients c ON c.id = u.client_id" : ""}
      WHERE s.provider_id = $1
      GROUP BY u.client_id${clientCols.has("name") ? ", c.name" : ""}${clientCols.has("full_name") ? ", c.full_name" : ""}${clientCols.has("first_name") ? ", c.first_name" : ""}${clientCols.has("phone") ? ", c.phone" : ""}${clientCols.has("email") ? ", c.email" : ""}${clientCols.has("telegram") ? ", c.telegram" : ""}${clientCols.has("username") ? ", c.username" : ""}
      ORDER BY COUNT(*) DESC, MAX(${unlockCreatedExpr}) DESC
      LIMIT 30
      `,
      [providerId]
    );

    let viewsCount = 0;
    let viewsByServiceJoin = "";
    let viewsByServiceSelect = "0::bigint AS views_count";
    if (await hasTable("service_views")) {
      const viewCols = await getColumns("service_views");
      if (viewCols.has("service_id")) {
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
        viewsByServiceJoin = `
          LEFT JOIN (
            SELECT service_id, COUNT(*)::bigint AS views_count
            FROM service_views
            GROUP BY service_id
          ) vv ON vv.service_id = s.id`;
        viewsByServiceSelect = "COALESCE(vv.views_count, 0)::bigint AS views_count";
      }
    }

    let favoritesCount = 0;
    let favoritesByServiceJoin = "";
    let favoritesByServiceSelect = "0::bigint AS favorites_count";
    if (await hasTable("wishlist")) {
      const wishlistCols = await getColumns("wishlist");
      if (wishlistCols.has("service_id")) {
        const favQ = await pool.query(
          `
          SELECT COUNT(*)::bigint AS favorites_count
          FROM wishlist w
          JOIN services s ON s.id = w.service_id
          WHERE s.provider_id = $1
          `,
          [providerId]
        );
        favoritesCount = Number(favQ.rows?.[0]?.favorites_count || 0);
        favoritesByServiceJoin = `
          LEFT JOIN (
            SELECT service_id, COUNT(*)::bigint AS favorites_count
            FROM wishlist
            GROUP BY service_id
          ) ff ON ff.service_id = s.id`;
        favoritesByServiceSelect = "COALESCE(ff.favorites_count, 0)::bigint AS favorites_count";
      }
    }

    let quickRequests = [];
    let quickByServiceJoin = "";
    let quickByServiceSelect = "0::bigint AS quick_requests_count";
    if (await hasTable("quick_requests")) {
      const qrCols = await getColumns("quick_requests");
      if (qrCols.has("service_id")) {
        const nameExpr = qrCols.has("client_name") ? "qr.client_name" : (qrCols.has("name") ? "qr.name" : "NULL::text");
        const messageExpr = qrCols.has("message") ? "qr.message" : "NULL::text";
        const statusExpr = qrCols.has("status") ? "qr.status" : "'new'::text";
        const createdExpr = qrCols.has("created_at") ? "qr.created_at" : "NOW()";
        const idExpr = qrCols.has("id") ? "qr.id" : `ROW_NUMBER() OVER (ORDER BY ${createdExpr} DESC)::bigint`;
        const quickQ = await pool.query(
          `
          SELECT
            ${idExpr} AS id,
            qr.service_id,
            ${nameExpr} AS client_name,
            ${messageExpr} AS message,
            ${statusExpr} AS status,
            ${createdExpr} AS created_at,
            ${serviceTitleExpr} AS service_title,
            ${serviceCategoryExpr} AS service_category
          FROM quick_requests qr
          JOIN services s ON s.id = qr.service_id
          WHERE s.provider_id = $1
          ORDER BY ${createdExpr} DESC
          LIMIT 30
          `,
          [providerId]
        );
        quickRequests = quickQ.rows || [];
        quickByServiceJoin = `
          LEFT JOIN (
            SELECT service_id, COUNT(*)::bigint AS quick_requests_count
            FROM quick_requests
            GROUP BY service_id
          ) qq ON qq.service_id = s.id`;
        quickByServiceSelect = "COALESCE(qq.quick_requests_count, 0)::bigint AS quick_requests_count";
      }
    }

    const topServicesQ = await pool.query(
      `
      SELECT
        s.id AS service_id,
        ${serviceTitleExpr} AS service_title,
        ${serviceCategoryExpr} AS service_category,
        COUNT(u.id)::bigint AS unlock_count,
        ${viewsByServiceSelect},
        ${favoritesByServiceSelect},
        ${quickByServiceSelect},
        MAX(${unlockCreatedExpr}) AS last_unlock_at
      FROM services s
      LEFT JOIN client_service_contact_unlocks u ON u.service_id = s.id
      ${viewsByServiceJoin}
      ${favoritesByServiceJoin}
      ${quickByServiceJoin}
      WHERE s.provider_id = $1
        ${serviceCols.has("deleted_at") ? "AND s.deleted_at IS NULL" : ""}
      GROUP BY s.id${serviceCols.has("title") ? ", s.title" : ""}${serviceCols.has("category") ? ", s.category" : ""}${viewsByServiceJoin ? ", vv.views_count" : ""}${favoritesByServiceJoin ? ", ff.favorites_count" : ""}${quickByServiceJoin ? ", qq.quick_requests_count" : ""}
      HAVING COUNT(u.id) > 0${viewsByServiceJoin ? " OR COALESCE(MAX(vv.views_count),0) > 0" : ""}${favoritesByServiceJoin ? " OR COALESCE(MAX(ff.favorites_count),0) > 0" : ""}${quickByServiceJoin ? " OR COALESCE(MAX(qq.quick_requests_count),0) > 0" : ""}
      ORDER BY (COUNT(u.id) * 5${quickByServiceJoin ? " + COALESCE(MAX(qq.quick_requests_count),0) * 4" : ""}${favoritesByServiceJoin ? " + COALESCE(MAX(ff.favorites_count),0) * 3" : ""}${viewsByServiceJoin ? " + COALESCE(MAX(vv.views_count),0)" : ""}) DESC,
               MAX(${unlockCreatedExpr}) DESC NULLS LAST
      LIMIT 20
      `,
      [providerId]
    );

    const baseStats = statsQ.rows?.[0] || {};
    return res.json({
      ok: true,
      provider_id: providerId,
      stats: {
        unlock_count: Number(baseStats.unlock_count || 0),
        hot_clients_count: Number(baseStats.hot_clients_count || 0),
        views_count: Number(viewsCount || 0),
        favorites_count: Number(favoritesCount || 0),
        quick_requests_count: quickRequests.length,
      },
      recent_unlocks: unlocksQ.rows || [],
      hot_clients: hotClientsQ.rows || [],
      top_services: topServicesQ.rows || [],
      quick_requests: quickRequests,
    });
  } catch (e) {
    console.error("providers/finance demand dashboard error:", e);
    return res.status(500).json({ ok: false, message: e?.message || "provider demand dashboard error" });
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
