//backend/routes/adminBillingRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const {
  adminBillingSummary,
  adminBillingClients,
  adminBillingLedger,
  adminBillingAdjust,
} = require("../controllers/adminBillingController");

const router = express.Router();

router.get("/summary", authenticateToken, requireAdmin, adminBillingSummary);
router.get("/clients", authenticateToken, requireAdmin, adminBillingClients);
router.get("/ledger", authenticateToken, requireAdmin, adminBillingLedger);
router.post("/adjust", authenticateToken, requireAdmin, adminBillingAdjust);

module.exports = router;
