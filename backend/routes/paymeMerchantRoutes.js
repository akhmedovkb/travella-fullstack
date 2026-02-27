const express = require("express");
const router = express.Router();
const { paymeMerchantRpc } = require("../controllers/paymeMerchantController");

// ✅ Paycom sandbox иногда делает нестандартные проверки / редиректы.
// Поэтому принимаем любой метод и всегда отдаём JSON-RPC 200.
router.all("/merchant/payme", paymeMerchantRpc);

module.exports = router;
