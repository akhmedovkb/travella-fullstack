// backend/routes/adminPaymeHealthRoutes.js
const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const {
  adminPaymeHealth,
  adminPaymeTxDetails,
  adminPaymeRepairLedger,
  repairLostPayment,
} = require("../controllers/adminPaymeHealthController");

const router = express.Router();

// GET /api/admin/payme/health?limit=200
router.get("/health", authenticateToken, requireAdmin, adminPaymeHealth);

// GET /api/admin/payme/tx/:paymeId
router.get("/tx/:paymeId", authenticateToken, requireAdmin, adminPaymeTxDetails);

// POST /api/admin/payme/repair/:paymeId
router.post("/repair/:paymeId", authenticateToken, requireAdmin, adminPaymeRepairLedger);

router.post(
  "/repair-lost",
  authenticateToken,
  requireAdmin,
  repairLostPayment
);

module.exports = router;
