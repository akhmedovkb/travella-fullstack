// backend/routes/reviewRoutes.js
const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");
const {
  addServiceReview,
  addClientReview,
  addProviderReview,        // клиент И/ИЛИ провайдер → провайдер
  getServiceReviews,
  getProviderReviews,
  getClientReviews,
} = require("../controllers/reviewController");

// простые role-guards (оставляем для специфичных эндпоинтов)
function requireClient(req, res, next) {
  if (req.user?.role === "client" || req.user?.clientId) return next();
  if (!req.user?.role) return next(); // на всякий случай — не ломаем совместимость
  return res.status(403).json({ error: "client_required" });
}
function requireProvider(req, res, next) {
  if (req.user?.role === "provider" || req.user?.providerId) return next();
  if (!req.user?.role) return next();
  return res.status(403).json({ error: "provider_required" });
}

// клиент → услуге
router.post("/service/:serviceId", authenticateToken, requireClient, addServiceReview);
// провайдер → клиенту
router.post("/client/:clientId", authenticateToken, requireProvider, addClientReview);

// КЛИЕНТ И/ИЛИ ПРОВАЙДЕР → ПРОВАЙДЕРУ
// guard не ставим — проверка роли и запрет «сам себе» внутри контроллера
router.post("/provider/:providerId", authenticateToken, addProviderReview);

// списки (публично)
router.get("/service/:serviceId", getServiceReviews);
router.get("/provider/:providerId", getProviderReviews);
router.get("/client/:clientId", getClientReviews);

module.exports = router;
