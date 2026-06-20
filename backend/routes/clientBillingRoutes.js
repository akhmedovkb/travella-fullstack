// backend/routes/clientBillingRoutes.js
const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");

const {
  clientBalance,
  clientBalanceLedger,
  createTopupOrder,
  unlockAuto,
  createClickUnlockInvoice,
  getUnlockStatus,
  unlockContact,
} = require("../controllers/clientBillingController");

const router = express.Router();

router.get("/balance", authenticateToken, clientBalance);
router.get("/balance/ledger", authenticateToken, clientBalanceLedger);

router.post("/balance/topup-order", authenticateToken, createTopupOrder);
router.post("/unlock-auto", authenticateToken, unlockAuto);
router.post("/unlock-click-invoice", authenticateToken, createClickUnlockInvoice);
router.get("/unlock-status", authenticateToken, getUnlockStatus);
router.post("/unlock-contact", authenticateToken, unlockContact);

module.exports = router;
