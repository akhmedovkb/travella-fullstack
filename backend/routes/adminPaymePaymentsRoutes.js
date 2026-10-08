// backend/routes/adminPaymePaymentsRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const {
  adminPaymePayments,
  expireOldPaymePayments,
  sendPaymePaymentReminders,
  reviewHotelRefund,
} = require("../controllers/adminPaymePaymentsController");

const router = express.Router();

router.get("/payments", authenticateToken, requireAdmin, adminPaymePayments);
router.post("/payments/expire-old", authenticateToken, requireAdmin, expireOldPaymePayments);
router.post("/payments/send-reminders", authenticateToken, requireAdmin, sendPaymePaymentReminders);
router.post("/payments/bookings/:bookingId/refund-review", authenticateToken, requireAdmin, reviewHotelRefund);

module.exports = router;
