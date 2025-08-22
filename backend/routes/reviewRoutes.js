// backend/routes/reviewRoutes.js
const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");
const {
  addServiceReview,
  addClientReview,
  addProviderReview,
  getServiceReviews,
  getProviderReviews,
  getClientReviews,
} = require("../controllers/reviewController");

// ── Guards ─────────────────────────────────────────
function requireClient(req, res, next) {
  if (req.user?.role === "client" || req.user?.clientId) return next();
  if (!req.user?.role) return next(); // мягко: если роли нет в токене
  return res.status(403).json({ error: "client_required" });
}
function requireProvider(req, res, next) {
  if (req.user?.role === "provider" || req.user?.providerId) return next();
  if (!req.user?.role) return next();
  return res.status(403).json({ error: "provider_required" });
}
// клиент ИЛИ провайдер
function requireClientOrProvider(req, res, next) {
  if (
    req.user?.role === "client" ||
    req.user?.clientId ||
    req.user?.role === "provider" ||
    req.user?.providerId
  ) {
    return next();
  }
  if (!req.user?.role) return next();
  return res.status(403).json({ error: "client_or_provider_required" });
}

// ── Create ─────────────────────────────────────────
router.post("/service/:serviceId",  authenticateToken, requireClient,           addServiceReview);
router.post("/client/:clientId",     authenticateToken, requireProvider,         addClientReview);
// теперь отзыв о провайдере может оставить и клиент, и другой провайдер
router.post("/provider/:providerId", authenticateToken, requireClientOrProvider, addProviderReview);

// ── Read (public) ──────────────────────────────────
router.get("/service/:serviceId",   getServiceReviews);
router.get("/provider/:providerId", getProviderReviews);
router.get("/client/:clientId",     getClientReviews);

module.exports = router;
