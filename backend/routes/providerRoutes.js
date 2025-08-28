// backend/routes/providerRoutes.js
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
  getBookedDates,
  saveBlockedDates,
  getProviderPublicById,
  getProviderStats,
  listProviderFavorites,
  toggleProviderFavorite,
  removeProviderFavorite,
} = require("../controllers/providerController");

// Simple role guard: token already decoded by authenticateToken
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

// Stats (place before :id route)
router.get("/stats", authenticateToken, requireProvider, getProviderStats);

// Services
router.get("/services", authenticateToken, requireProvider, getServices);
router.post("/services", authenticateToken, requireProvider, addService);
router.put("/services/:id", authenticateToken, requireProvider, updateService);
router.delete("/services/:id", authenticateToken, requireProvider, deleteService);
router.patch("/services/:id/images", authenticateToken, requireProvider, updateServiceImagesOnly);

// Calendar
router.get("/booked-dates", authenticateToken, requireProvider, getBookedDates);
router.post("/blocked-dates", authenticateToken, requireProvider, saveBlockedDates);
// получить ручные блокировки провайдера (сам провайдер)
router.get('/blocked-dates', authenticate, providerController.getBlockedDates);

// заменить/обновить блокировки
router.post('/blocked-dates', authenticate, providerController.saveBlockedDates);

// публичная выдача для клиента: и забронированные, и заблокированные
router.get('/:providerId/calendar', providerController.getCalendarPublic);


// Favorites (provider)
router.get   ("/favorites",            authenticateToken, requireProvider, listProviderFavorites);
router.post  ("/favorites/toggle",     authenticateToken, requireProvider, toggleProviderFavorite);
router.delete("/favorites/:serviceId", authenticateToken, requireProvider, removeProviderFavorite);

// Public provider page (keep last)
router.get("/:id(\\d+)", getProviderPublicById);


module.exports = router;
