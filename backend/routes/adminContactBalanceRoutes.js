// backend/routes/adminContactBalanceRoutes.js
const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const {
  searchClients,
  getClientContactBalance,
  adjustClientContactBalance,
} = require("../controllers/adminContactBalanceController");

const router = express.Router();

router.get("/search", authenticateToken, requireAdmin, searchClients);
router.get("/:id/contact-balance", authenticateToken, requireAdmin, getClientContactBalance);
router.post(
  "/:id/contact-balance/adjust",
  authenticateToken,
  requireAdmin,
  adjustClientContactBalance
);

module.exports = router;
