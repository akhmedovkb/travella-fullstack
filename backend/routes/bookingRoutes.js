// backend/routes/bookingRoutes.js
const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");
const {
  createBooking,
  getProviderBookings,
  getMyBookings,
  providerQuote,
  acceptBooking,
  rejectBooking,
  cancelBooking,
} = require("../controllers/bookingController");

// Создать заявку (клиент/провайдер с токеном)
router.post("/", authenticateToken, createBooking);

// Списки
router.get("/provider", authenticateToken, getProviderBookings); // мои как провайдера
router.get("/my",       authenticateToken, getMyBookings);       // мои как клиента

// Действия провайдера
router.post("/:id/accept", authenticateToken, acceptBooking);
router.post("/:id/reject", authenticateToken, rejectBooking);
router.post("/:id/quote", authenticateToken, bookingController.providerQuote);

// Действие клиента
router.post("/:id/cancel", authenticateToken, cancelBooking);

module.exports = router;
