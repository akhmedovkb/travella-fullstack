// backend/routes/reviewRoutes.js
const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");
const {
  addServiceReview,
  addClientReview,
  addProviderReview,      // ← добавили
  getServiceReviews,
  getProviderReviews,
  getClientReviews,
} = require("../controllers/reviewController");

// оставить отзыв клиентом об услуге
router.post("/service/:serviceId", authenticateToken, addServiceReview);

// оставить отзыв провайдером о клиенте
router.post("/client/:clientId", authenticateToken, addClientReview);

// оставить отзыв о провайдере (клиент ИЛИ провайдер)
// контроллер сам определит роль автора
router.post("/provider/:providerId", authenticateToken, addProviderReview);

// списки/агрегаты (публично)
router.get("/service/:serviceId", getServiceReviews);
router.get("/provider/:providerId", getProviderReviews);
router.get("/client/:clientId", getClientReviews);

module.exports = router;
