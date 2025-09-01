// backend/routes/bookingRoutes.js
const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");
const {
  createBooking,
  getProviderBookings,
  requireProvider,
  getMyBookings,
  providerQuote,
  acceptBooking,
  rejectBooking,
  cancelBooking,
  confirmBooking
} = require("../controllers/bookingController");

// маленький гард
function requireProvider(req, res, next) {
  if (req.user?.role !== "provider") return res.status(403).json({ message: "Только для провайдера" });
  next();
}

// Создать заявку (клиент/провайдер с токеном)
router.post("/", authenticateToken, createBooking);

// Списки
// ВХОДЯЩИЕ брони моих услуг
router.get("/provider", authenticateToken, getProviderBookings); // мои как провайдера
// ИСХОДЯЩИЕ брони (я бронирую чужую услугу как провайдер)
router.get("/provider/outgoing", authenticateToken, requireProvider, getProviderOutgoingBookings);
router.get("/my",       authenticateToken, getMyBookings);       // мои как клиента

// Действия провайдера
router.post("/:id/accept", authenticateToken, acceptBooking);
router.post("/:id/reject", authenticateToken, rejectBooking);
router.post("/:id/quote", authenticateToken, providerQuote);

// Действие клиента
router.post("/:id/cancel", authenticateToken, cancelBooking);
router.post("/:id/confirm", authenticateToken, confirmBooking);


module.exports = router;
