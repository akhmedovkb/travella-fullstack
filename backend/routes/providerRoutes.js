// backend/routes/providerRoutes.js
const express = require("express");
const router = express.Router();

const pool = require("../db"); // <— нужно для /calendar
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
  // календарь
  getBookedDates,      // занято бронями (отдельный список дат)
  getBlockedDates,     // ручные блокировки провайдера
  saveBlockedDates,
  getCalendarPublic,   // публичный календарь по providerId
  // прочее
  getProviderPublicById,
  getProviderStats,
  listProviderFavorites,
  toggleProviderFavorite,
  removeProviderFavorite,
} = require("../controllers/providerController");

// Simple role guard
function requireProvider(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ message: "Требуется авторизация" });
  }
  next();
}

// Auth
router.post("/register", registerProvider);
router.post("/login", loginProvider);

// Profile
router.get("/profile", authenticateToken, requireProvider, getProviderProfile);
router.put("/profile", authenticateToken, requireProvider, updateProviderProfile);
router.put("/password", authenticateToken, requireProvider, changeProviderPassword);

// Stats
router.get("/stats", authenticateToken, requireProvider, getProviderStats);

// Services
router.get("/services", authenticateToken, requireProvider, getServices);
router.post("/services", authenticateToken, requireProvider, addService);
router.put("/services/:id", authenticateToken, requireProvider, updateService);
router.delete("/services/:id", authenticateToken, requireProvider, deleteService);
router.patch("/services/:id/images", authenticateToken, requireProvider, updateServiceImagesOnly);

// ---------- Calendar (ВАЖНО: до публичного /:providerId/calendar) ----------
router.get("/booked-dates",  authenticateToken, requireProvider, getBookedDates);
router.get("/blocked-dates", authenticateToken, requireProvider, getBlockedDates);
router.post("/blocked-dates", authenticateToken, requireProvider, saveBlockedDates);

// ЕДИНЫЙ приватный эндпоинт для календаря провайдера.
// Возвращает и системно занятые даты (брони), и ручные блокировки.
router.get("/calendar", authenticateToken, requireProvider, async (req, res) => {
  try {
    const providerId = req.user.id;

    const [booked, blocked] = await Promise.all([
      pool.query(
        `SELECT DISTINCT bd.date::text AS date
           FROM booking_dates bd
           JOIN bookings b ON b.id = bd.booking_id
          WHERE b.provider_id = $1
            AND b.status IN ('pending','confirmed','active')
            AND bd.date >= CURRENT_DATE
          ORDER BY bd.date`,
        [providerId]
      ),
      pool.query(
        `SELECT date::text AS date
           FROM provider_blocked_dates
          WHERE provider_id = $1
          ORDER BY date`,
        [providerId]
      ),
    ]);

    return res.json({
      booked: booked.rows,   // [{ date: 'YYYY-MM-DD' }, ...]
      blocked: blocked.rows, // [{ date: 'YYYY-MM-DD' }, ...]
    });
  } catch (e) {
    console.error("providers/calendar error:", e);
    return res.status(500).json({ message: "calendar error" });
  }
});

// Публичный календарь для страницы провайдера (ДОЛЖЕН идти после /calendar)
router.get("/:providerId(\\d+)/calendar", getCalendarPublic);

// Favorites (provider)
router.get   ("/favorites",            authenticateToken, requireProvider, listProviderFavorites);
router.post  ("/favorites/toggle",     authenticateToken, requireProvider, toggleProviderFavorite);
router.delete("/favorites/:serviceId", authenticateToken, requireProvider, removeProviderFavorite);

// Public provider page (держим самым последним)
router.get("/:id(\\d+)", getProviderPublicById);

module.exports = router;
