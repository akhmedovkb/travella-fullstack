// backend/routes/adminContactBalanceRoutes.js
const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin"); // у тебя такой мидлварь обычно есть

const {
  adminClientSearch,
  adminGetClientContactBalance,
  adminAdjustClientContactBalance,
} = require("../controllers/adminContactBalanceController");

const router = express.Router();

// /api/admin/clients/search?q=...
router.get("/search", authenticateToken, requireAdmin, adminClientSearch);

// /api/admin/clients/:id/contact-balance
router.get("/:id/contact-balance", authenticateToken, requireAdmin, adminGetClientContactBalance);

// /api/admin/clients/:id/contact-balance/adjust
router.post("/:id/contact-balance/adjust", authenticateToken, requireAdmin, adminAdjustClientContactBalance);

module.exports = router;
