//backend/routes/adminPaymePaymentsRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const {
  adminPaymePayments,
  expireAbandonedPaymePayments,
  sendAbandonedPaymeReminders,
} = require("../controllers/adminPaymePaymentsController");

const router = express.Router();

router.get("/payments", authenticateToken, requireAdmin, adminPaymePayments);
router.post("/payments/expire", authenticateToken, requireAdmin, expireAbandonedPaymePayments);
router.post("/payments/reminders", authenticateToken, requireAdmin, sendAbandonedPaymeReminders);

module.exports = router;
