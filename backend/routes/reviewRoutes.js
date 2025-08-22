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

// простая проверка роли: пускаем клиентов, провайдеров и админа.
// если req.user.role отсутствует (старые токены) — тоже пускаем, чтобы не ломать.
function requireClientOrProvider(req, res, next) {
  const role = req.user?.role;
  if (!role) return next();
  if (role === "client" || role === "provider" || role === "admin") return next();
  return res.status(403).json({ error: "forbidden" });
}

// Создать отзыв
router.post("/service/:serviceId",  authenticateToken, requireClientOrProvider, addServiceReview);
router.post("/client/:clientId",    authenticateToken, requireClientOrProvider, addClientReview);
router.post("/provider/:providerId",authenticateToken, requireClientOrProvider, addProviderReview);

// Прочитать отзывы/агрегаты
router.get("/service/:serviceId",   getServiceReviews);
router.get("/client/:clientId",     getClientReviews);
router.get("/provider/:providerId", getProviderReviews);

module.exports = router;
