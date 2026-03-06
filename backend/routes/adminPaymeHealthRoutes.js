// backend/routes/adminPaymeHealthRoutes.js
const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const {
  adminPaymeHealth,
  adminPaymeTxDetails,
  adminPaymeRepairLedger,
  adminPaymeRepairBulk, 
  adminPaymeDashboard,
  adminPaymeLive,
} = require("../controllers/adminPaymeHealthController");

const router = express.Router();

// GET /api/admin/payme/health?limit=200
router.get("/health", authenticateToken, requireAdmin, adminPaymeHealth);

// GET /api/admin/payme/tx/:paymeId
router.get("/tx/:paymeId", authenticateToken, requireAdmin, adminPaymeTxDetails);

// GET /api/admin/payme/dashboard
router.get(
"/dashboard",
authenticateToken,
requireAdmin,
adminPaymeDashboard
);

// GET /api/admin/payme/live
router.get("/live", authenticateToken, requireAdmin, adminPaymeLive);

// POST /api/admin/payme/repair/:paymeId
router.post("/repair/:paymeId", authenticateToken, requireAdmin, adminPaymeRepairLedger);

// POST /api/admin/payme/repair-bulk
router.post(
  "/repair-bulk",
  authenticateToken,
  requireAdmin,
  adminPaymeRepairBulk
);

module.exports = router;
