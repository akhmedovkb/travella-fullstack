// backend/routes/adminServiceAuditRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");
const {
  listServiceAuditLogs,
  getServiceAuditStats,
} = require("../controllers/adminServiceAuditController");

const router = express.Router();

router.get("/service-audit", authenticateToken, requireAdmin, listServiceAuditLogs);
router.get("/service-audit/stats", authenticateToken, requireAdmin, getServiceAuditStats);

module.exports = router;
