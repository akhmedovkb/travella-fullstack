// backend/routes/adminUnlockNudgeRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");
const {
  getUnlockNudgeAnalytics,
} = require("../controllers/adminUnlockNudgeController");

const router = express.Router();

// Оба адреса рабочие:
// GET /api/admin/unlock-nudge
// GET /api/admin/unlock-nudge/analytics
router.get("/", authenticateToken, requireAdmin, getUnlockNudgeAnalytics);
router.get("/analytics", authenticateToken, requireAdmin, getUnlockNudgeAnalytics);

module.exports = router;
