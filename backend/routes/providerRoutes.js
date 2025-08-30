// backend/routes/providerRoutes.js
const express = require("express");
const router = express.Router();

const pool = require("../db");                         // ← ЭТОГО НЕ ХВАТАЛО
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
  getBookedDates,
  getBlockedDates,
  saveBlockedDates,
  getCalendarPublic,
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
router.get("/profile",  authenticateToken, requireProvider, getProviderProfile);
router.put("/profile",  authenticateToken, requireProvider, updateProviderProfile);
router.put("/password", authenticateToken, requireProvider, changeProviderPassword);

// Stats
router.get("/stats", authenticateToken, requireProvider, getProviderStats);

// Services
router.get   ("/services",      authenticateToken, requireProvider, getServices);
router.post  ("/services",      authenticateToken, requireProvider, addService);
router.put   ("/services/:id",  authenticateToken, requireProvider, updateService);
router.delete("/services/:id",  authenticateToken, requireProvider, deleteService);
router.patch ("/services/:id/images", authenticateToken, requireProvider, updateServiceImagesOnly);

// ---- КАЛЕНДАРЬ ----
// 1) агрегирующая ручка для ЛК провайдера (должна стоять ДО динамических маршрутов)
router.get("/calendar", authenticateToken, requireProvider, async (req, res) => {
  const providerId = req.user.id;
  try {
    const [booked, blocked] = await Promise.all([
      pool.query(
        `SELECT DISTINCT bd.date::text AS date
           FROM booking_dates bd
           JOIN bookings b ON b.id = bd.booking_id
          WHERE b.provider_id = $1
            AND b.status IN ('pending','confirmed','active')  -- оставь только нужные статусы
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
    res.json({ booked: booked.rows, blocked: blocked.rows });
  } catch (e) {
    console.error("providers/calendar error:", e);
    res.status(500).json({ message: "calendar error" });
  }
});

// 2) ручки, которые уже были
router.get("/booked-dates",  authenticateToken, requireProvider, getBookedDates);
router.get("/blocked-dates", authenticateToken, requireProvider, getBlockedDates);
router.post("/blocked-dates", authenticateToken, requireProvider, saveBlockedDates);

// публичный календарь по id провайдера (для карточки услуги)
router.get("/:providerId/calendar", getCalendarPublic);

// избранное
router.get   ("/favorites",            authenticateToken, requireProvider, listProviderFavorites);
router.post  ("/favorites/toggle",     authenticateToken, requireProvider, toggleProviderFavorite);
router.delete("/favorites/:serviceId", authenticateToken, requireProvider, removeProviderFavorite);

// публичная страница провайдера — держим самой последней
router.get("/:id(\\d+)", getProviderPublicById);

module.exports = router;
