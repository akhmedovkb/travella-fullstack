// backend/routes/clientBillingRoutes.js
const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");

const {
  clientBalance,
  clientBalanceLedger,
  createTopupOrder,
  unlockContact,
} = require("../controllers/clientBillingController");

const router = express.Router();

router.get("/balance", authenticateToken, clientBalance);
router.get("/balance/ledger", authenticateToken, clientBalanceLedger);
router.post("/balance/topup-order", authenticateToken, createTopupOrder);
router.post("/unlock-contact", authenticateToken, unlockContact);

module.exports = router;
