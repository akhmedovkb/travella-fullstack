const express = require("express");
const router = express.Router();
const { paymeMerchantRpc } = require("../controllers/paymeMerchantController");

// Paycom sandbox может дергать OPTIONS/GET в сценариях — не ловим 405
router.all("/merchant/payme", paymeMerchantRpc);

module.exports = router;
