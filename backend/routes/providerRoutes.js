const express = require("express");
const router = express.Router();

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
  getBookedDates,      // занято бронями
  getBlockedDates,     // ручные блокировки провайдера
  saveBlockedDates,
  getCalendarPublic,   // публичный для клиента
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

// Calendar (важно располагать до публичного /:id)
router.get("/booked-dates",  authenticateToken, requireProvider, getBookedDates);
router.get("/blocked-dates", authenticateToken, requireProvider, getBlockedDates);
router.post("/blocked-dates", authenticateToken, requireProvider, saveBlockedDates);
// публичный эндпоинт для клиента
router.get("/:providerId/calendar", getCalendarPublic);

// Favorites (provider)
router.get   ("/favorites",            authenticateToken, requireProvider, listProviderFavorites);
router.post  ("/favorites/toggle",     authenticateToken, requireProvider, toggleProviderFavorite);
router.delete("/favorites/:serviceId", authenticateToken, requireProvider, removeProviderFavorite);

// Public provider page (держим самым последним)
router.get("/:id(\\d+)", getProviderPublicById);

module.exports = router;
