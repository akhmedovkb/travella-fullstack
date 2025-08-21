// routes/reviewRoutes.js
const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");
const {
  addServiceReview,
  addClientReview,
  getServiceReviews,
  getProviderReviews,
  getClientReviews,
} = require("../controllers/reviewController");

// простые role-guards (если у вас уже есть — используйте их)
function requireClient(req, res, next) {
  if (req.user?.role === "client" || req.user?.clientId) return next();
  // допускаем, если роли нет, чтобы не ломать текущую авторизацию
  if (!req.user?.role) return next();
  return res.status(403).json({ error: "client_required" });
}
function requireProvider(req, res, next) {
  if (req.user?.role === "provider" || req.user?.providerId) return next();
  if (!req.user?.role) return next();
  return res.status(403).json({ error: "provider_required" });
}

// оставить отзыв клиентом об услуге
router.post("/service/:serviceId", authenticateToken, requireClient, addServiceReview);
// оставить отзыв провайдером о клиенте
router.post("/client/:clientId", authenticateToken, requireProvider, addClientReview);

// + оставить отзыв КЛИЕНТОМ о ПРОВАЙДЕРЕ
router.post("/provider/:providerId", authenticateToken, requireClient, addProviderReview);

// списки/агрегаты (публично)
router.get("/service/:serviceId", getServiceReviews);
router.get("/provider/:providerId", getProviderReviews);
router.get("/client/:clientId", getClientReviews);

module.exports = router;
