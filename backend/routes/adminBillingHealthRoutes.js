//backend/routes/adminBillingHealthRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const {
  adminBillingHealth
} = require("../controllers/adminBillingHealthController");

const router = express.Router();

router.get(
  "/billing/health",
  authenticateToken,
  requireAdmin,
  adminBillingHealth
);

module.exports = router;
