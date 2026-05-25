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
