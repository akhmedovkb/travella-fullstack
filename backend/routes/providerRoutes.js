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
} = require("../controllers/providerController");

const { notifyModerationNew } = require("../utils/telegram");
  
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

router.get("/profile", authenticateToken, requireProvider, getProviderProfile);
router.put("/profile", authenticateToken, requireProvider, updateProviderProfile);
router.put("/password", authenticateToken, requireProvider, changeProviderPassword);

router.get("/stats", authenticateToken, requireProvider, getProviderStats);

router.get("/services", authenticateToken, requireProvider, getServices);
router.post("/services", authenticateToken, requireProvider, addService);
router.put("/services/:id", authenticateToken, requireProvider, updateService);
router.delete("/services/:id", authenticateToken, requireProvider, deleteService);
router.patch("/services/:id/images", authenticateToken, requireProvider, updateServiceImagesOnly);

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
      const { id } = req.params;
      const { rows } = await pool.query(
        `
          UPDATE services
             SET status='pending',
                 submitted_at = NOW(),
                 updated_at   = NOW()
           WHERE id=$1
             AND provider_id=$2
             AND status IN ('draft','rejected')
           RETURNING id, status, submitted_at
        `,
        [id, req.user.id]
      );
      if (!rows.length) {
        return res.status(409).json({ message: "Service must be in draft/rejected to submit" });
      }
      try {
        await notifyModerationNew({ service: rows[0].id });
      } catch {}
      return res.json({ ok: true, service: rows[0] });
    } catch (e) {
      next(e);
    }
  }
);

router.get("/:id(\\d+)", getProviderPublicById);

module.exports = router;
