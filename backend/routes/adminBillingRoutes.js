//backend/routes/adminBillingRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const {
  adminBillingSummary,
  adminBillingClients,
  adminBillingLedger,
  adminBillingAdjust,
  adminGetContactUnlockSettings,
  adminSetContactUnlockSettings,
} = require("../controllers/adminBillingController");

const router = express.Router();

router.get("/summary", authenticateToken, requireAdmin, adminBillingSummary);
router.get("/clients", authenticateToken, requireAdmin, adminBillingClients);
router.get("/ledger", authenticateToken, requireAdmin, adminBillingLedger);
router.post("/adjust", authenticateToken, requireAdmin, adminBillingAdjust);
router.get("/contact-unlock-settings", authenticateToken, requireAdmin, adminGetContactUnlockSettings);
router.put("/contact-unlock-settings", authenticateToken, requireAdmin, adminSetContactUnlockSettings);

module.exports = router;
