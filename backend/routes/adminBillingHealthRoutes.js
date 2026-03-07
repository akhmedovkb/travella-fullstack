//backend/routes/adminBillingHealthRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const {
  adminBillingHealth,
  adminBillingRepairOne,
  adminBillingRepairAll,
} = require("../controllers/adminBillingHealthController");

const router = express.Router();

router.get("/billing/health", authenticateToken, requireAdmin, adminBillingHealth);
router.post("/billing/health/repair/:clientId", authenticateToken, requireAdmin, adminBillingRepairOne);
router.post("/billing/health/repair-all", authenticateToken, requireAdmin, adminBillingRepairAll);

module.exports = router;
