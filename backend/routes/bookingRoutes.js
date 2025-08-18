// backend/routes/bookingRoutes.js
const express = require("express");
const router = express.Router();
const auth = require("../middleware/authenticateToken");
const ctrl = require("../controllers/bookingController");

// Клиент создаёт и смотрит свои брони
router.post("/", auth, ctrl.createBooking);
router.get("/my", auth, ctrl.listMyBookings);

// Провайдер смотрит брони по своим услугам
router.get("/provider", auth, ctrl.listProviderBookings);

// Провайдер подтверждает/отклоняет
router.post("/:id/confirm", auth, ctrl.confirm);
router.post("/:id/reject", auth, ctrl.reject);

// Клиент или провайдер отменяет
router.post("/:id/cancel", auth, ctrl.cancel);

module.exports = router;
