// backend/routes/paymeMerchantRoutes.js

const express = require("express");
const router = express.Router();

const {
  handlePaymeMerchant,
} = require("../controllers/paymeMerchantController");

// Payme / Paycom Merchant JSON-RPC endpoint.
// Используем all(), потому что Payme sandbox/production иногда проверяет endpoint разными HTTP-method.
// Реальная обработка JSON-RPC находится в backend/controllers/paymeMerchantController.js
router.all("/merchant/payme", handlePaymeMerchant);

module.exports = router;
