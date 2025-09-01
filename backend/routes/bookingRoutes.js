// backend/routes/bookingRoutes.js
const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");

const {
  createBooking,
  // списки
  getProviderBookings,            // ВХОДЯЩИЕ: бронирования моих услуг
  getProviderOutgoingBookings,    // ИСХОДЯЩИЕ: мои брони у других провайдеров
  getMyBookings,                  // мои как клиента
  // действия
  providerQuote,
  acceptBooking,
  rejectBooking,
  cancelBooking,
  confirmBooking,
} = require("../controllers/bookingController");

// маленький гард — роут только для провайдера
function requireProvider(req, res, next) {
  if (req.user?.role !== "provider") {
    return res.status(403).json({ message: "Только для провайдера" });
  }
  next();
}

/* ================== Создать заявку (клиент/провайдер) ================== */
router.post("/", authenticateToken, createBooking);

/* ================== Списки ================== */
// ВХОДЯЩИЕ брони моих услуг (нормальный путь)
router.get("/provider/incoming", authenticateToken, requireProvider, getProviderBookings);
// ИСХОДЯЩИЕ брони: я (провайдер) бронирую чужие услуги
router.get("/provider/outgoing", authenticateToken, requireProvider, getProviderOutgoingBookings);

// ЛЕГАСИ-АЛИАС (оставляем для совместимости фронта, который стучится на /provider)
router.get("/provider", authenticateToken, requireProvider, getProviderBookings);

// Мои брони как клиента (кабинет клиента)
router.get("/my", authenticateToken, getMyBookings);

/* ================== Действия ================== */
// Провайдер
router.post("/:id/accept", authenticateToken, acceptBooking);
router.post("/:id/reject", authenticateToken, rejectBooking);
router.post("/:id/quote",  authenticateToken, providerQuote);

// Клиент
router.post("/:id/cancel",  authenticateToken, cancelBooking);
router.post("/:id/confirm", authenticateToken, confirmBooking);

module.exports = router;
