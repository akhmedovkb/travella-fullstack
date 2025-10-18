// backend/routes/bookingRoutes.js
const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");
const {
  createBooking,
  getProviderBookings,
  getProviderOutgoingBookings,
  getMyBookings,
  getGroupBookings,
  providerQuote,
  acceptBooking,
  rejectBooking,
  cancelBooking,
  confirmBooking,
  confirmBookingByRequester,
  cancelBookingByRequester,
  cancelBookingByProvider,
  // NEW for conveyor
  checkAvailability,
  placeHold,
  getBookingDocs,
  // NEW for payment window
  getBooking,
  markPaid,
} = require("../controllers/bookingController");

function requireProvider(req, res, next) {
  if (req.user?.role !== "provider") {
    return res.status(403).json({ message: "Только для провайдера" });
  }
  next();
}

// Создать заявку (клиент/провайдер с токеном)
router.post("/", authenticateToken, createBooking);

// Списки
router.get("/provider", authenticateToken, requireProvider, getProviderBookings);                 // входящие (мои услуги)
router.get("/provider/outgoing", authenticateToken, requireProvider, getProviderOutgoingBookings); // исходящие (я бронирую как провайдер)
router.get("/my", authenticateToken, getMyBookings);                                              // мои как клиента

// Пакет по group_id (для клиента или провайдера, имеющего отношение к пакету)
// ВАЖНО: ставим ДО маршрута '/:id', чтобы он не перехватывал 'group'
router.get("/group/:group_id", authenticateToken, getGroupBookings);

// Метаданные конкретной брони (любой авторизованный) + автоистечение окна оплаты
// (можно ограничить id цифрами, чтобы точно не ловить другие пути)
router.get("/:id(\\d+)", authenticateToken, getBooking);

// Действия поставщика по входящим
router.post("/:id(\\d+)/accept", authenticateToken, requireProvider, acceptBooking);
router.post("/:id(\\d+)/reject", authenticateToken, requireProvider, rejectBooking);
router.post("/:id(\\d+)/quote", authenticateToken, requireProvider, providerQuote);
router.post("/:id(\\d+)/cancel-by-provider", authenticateToken, requireProvider, cancelBookingByProvider);

// Действия клиента
router.post("/:id(\\d+)/cancel", authenticateToken, cancelBooking);
router.post("/:id(\\d+)/confirm", authenticateToken, confirmBooking);
// Оплата брони (маркёр после успешного платежа)
router.post("/:id(\\d+)/pay", authenticateToken, markPaid);

// Действия провайдера-заказчика по исходящим
router.post("/:id(\\d+)/confirm-by-requester", authenticateToken, requireProvider, confirmBookingByRequester);
router.post("/:id(\\d+)/cancel-by-requester", authenticateToken, requireProvider, cancelBookingByRequester);

// === Booking Conveyor ===
router.post("/:id(\\d+)/check-availability", authenticateToken, requireProvider, checkAvailability);
router.post("/:id(\\d+)/place-hold", authenticateToken, requireProvider, placeHold);
router.get("/:id(\\d+)/docs", authenticateToken, getBookingDocs);

module.exports = router;
