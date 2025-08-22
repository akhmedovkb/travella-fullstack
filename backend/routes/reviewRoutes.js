// routes/reviewRoutes.js
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

// простые role-guards
function requireClient(req, _res, next) {
  if (req.user?.role === "client" || req.user?.clientId) return next();
  if (!req.user?.role) return next(); // пропускаем «старые» токены без role
  return next({ status: 403, message: "client_required" });
}
function requireProvider(req, _res, next) {
  if (req.user?.role === "provider" || req.user?.providerId) return next();
  if (!req.user?.role) return next();
  return next({ status: 403, message: "provider_required" });
}
function requireClientOrProvider(req, _res, next) {
  if (req.user?.role === "client" || req.user?.clientId ||
      req.user?.role === "provider" || req.user?.providerId) return next();
  if (!req.user?.role) return next();
  return next({ status: 403, message: "client_or_provider_required" });
}

// CREATE
router.post("/service/:serviceId",  authenticateToken, requireClient,           addServiceReview);
router.post("/client/:clientId",    authenticateToken, requireProvider,         addClientReview);
router.post("/provider/:providerId",authenticateToken, requireClientOrProvider, addProviderReview);

// READ
router.get("/service/:serviceId",   getServiceReviews);
router.get("/provider/:providerId", getProviderReviews);
router.get("/client/:clientId",     getClientReviews);

module.exports = router;
