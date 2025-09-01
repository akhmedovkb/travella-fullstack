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
const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");
const {
  createBooking,
  getProviderBookings,
  getProviderOutgoingBookings,
  getMyBookings,
  providerQuote,
  acceptBooking,
  rejectBooking,
  cancelBooking,
  confirmBooking,
  confirmBookingByRequester,
  cancelBookingByRequester,
} = require("../controllers/bookingController");

function requireProvider(req, res, next) {
  if (req.user?.role !== "provider") return res.status(403).json({ message: "Только для провайдера" });
  next();
}

// Создать заявку (клиент/провайдер с токеном)
router.post("/", authenticateToken, createBooking);

// Списки
router.get("/provider", authenticateToken, requireProvider, getProviderBookings);               // входящие (мои услуги)
router.get("/provider/outgoing", authenticateToken, requireProvider, getProviderOutgoingBookings); // исходящие (я бронирую как провайдер)
router.get("/my", authenticateToken, getMyBookings);                                            // мои как клиента

// Действия поставщика по входящим
router.post("/:id/accept", authenticateToken, requireProvider, acceptBooking);
router.post("/:id/reject", authenticateToken, requireProvider, rejectBooking);
router.post("/:id/quote", authenticateToken, requireProvider, providerQuote);

// Действия клиента
router.post("/:id/cancel", authenticateToken, cancelBooking);
router.post("/:id/confirm", authenticateToken, confirmBooking);

// Действия провайдера-заказчика по исходящим
router.post("/:id/confirm-by-requester", authenticateToken, requireProvider, confirmBookingByRequester);
router.post("/:id/cancel-by-requester", authenticateToken, requireProvider, cancelBookingByRequester);

module.exports = router;
