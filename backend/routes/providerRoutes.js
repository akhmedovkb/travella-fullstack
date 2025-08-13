const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");

// ⚠️ Если файл называется ProviderController.js — используем такой же регистр в require
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
  getBookedDates,
  saveBlockedDates,
  updateServiceImagesOnly,
  getProviderStats,
  getProviderPublicById,
} = require("../controllers/providerController");

// Пускаем только провайдера
function requireProvider(req, res, next) {
  if (req.user?.role === "provider" || req.user?.providerId) return next();
  return res.status(403).json({ error: "provider_required" });
}

// Auth
router.post("/register", registerProvider);
router.post("/login", loginProvider);

// Profile
router.get("/profile", authenticateToken, requireProvider, getProviderProfile);
router.put("/profile", authenticateToken, requireProvider, updateProviderProfile);
router.put("/change-password", authenticateToken, requireProvider, changeProviderPassword);

// Stats
router.get("/stats", authenticateToken, requireProvider, getProviderStats);

// Services (все под провайдером)
router.post("/services", authenticateToken, requireProvider, addService);
router.get("/services", authenticateToken, requireProvider, getServices);
router.put("/services/:id", authenticateToken, requireProvider, updateService);
router.delete("/services/:id", authenticateToken, requireProvider, deleteService);

// Calendar
router.get("/booked-dates", authenticateToken, requireProvider, getBookedDates);
router.post("/blocked-dates", authenticateToken, requireProvider, saveBlockedDates);

// Только картинки услуги
router.patch(
  "/services/:id/images",
  authenticateToken,
  requireProvider,
  updateServiceImagesOnly
);

router.get("/:id(\\d+)", getProviderPublicById);

module.exports = router;
