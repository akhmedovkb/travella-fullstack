const express = require("express");
const router = express.Router();
const { paymeMerchantRpc } = require("../controllers/paymeMerchantController");

router.post("/merchant/payme", paymeMerchantRpc);

module.exports = router;
