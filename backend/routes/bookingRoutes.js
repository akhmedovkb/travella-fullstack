// backend/routes/bookingRoutes.js
const express = require("express");
const router = express.Router();
const authenticateToken = require("../middleware/authenticateToken");
const bookingController = require("../controllers/bookingController");

// создать бронь (клиент)
router.post("/", authenticateToken, bookingController.createBooking);

// списки
router.get("/client", authenticateToken, bookingController.listMyBookings);
router.get("/provider", authenticateToken, bookingController.listProviderBookings);

// действия провайдера
router.post("/:id/confirm", authenticateToken, bookingController.confirm);
router.post("/:id/reject", authenticateToken, bookingController.reject);

// отмена (клиент или провайдер)
router.post("/:id/cancel", authenticateToken, bookingController.cancel);

module.exports = router;
