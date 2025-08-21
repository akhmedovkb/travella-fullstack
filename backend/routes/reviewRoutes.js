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

// Небольшие role-guards. Если роли у токена нет — пропускаем (back-compat).
function requireClient(req, res, next) {
  if (req.user?.role === "client" || req.user?.clientId) return next();
  if (!req.user?.role) return next();
  return res.status(403).json({ error: "client_required" });
}
function requireProvider(req, res, next) {
  if (req.user?.role === "provider" || req.user?.providerId) return next();
  if (!req.user?.role) return next();
  return res.status(403).json({ error: "provider_required" });
}

/** CREATE */
router.post("/service/:serviceId", authenticateToken, requireClient, addServiceReview);
router.post("/client/:clientId", authenticateToken, requireProvider, addClientReview);
router.post("/provider/:providerId", authenticateToken, requireClient, addProviderReview);

/** READ (публичные) */
router.get("/service/:serviceId", getServiceReviews);
router.get("/provider/:providerId", getProviderReviews);
router.get("/client/:clientId", getClientReviews);

module.exports = router;
