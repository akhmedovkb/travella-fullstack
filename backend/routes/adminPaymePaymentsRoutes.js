// backend/routes/adminPaymePaymentsRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const {
  adminPaymePayments,
  expireOldPaymePayments,
  sendPaymePaymentReminders,
} = require("../controllers/adminPaymePaymentsController");

const router = express.Router();

router.get("/payments", authenticateToken, requireAdmin, adminPaymePayments);
router.post("/payments/expire-old", authenticateToken, requireAdmin, expireOldPaymePayments);
router.post("/payments/send-reminders", authenticateToken, requireAdmin, sendPaymePaymentReminders);

module.exports = router;
