// backend/routes/clickMerchantRoutes.js
const express = require("express");
const { handleClickMerchant } = require("../controllers/clickMerchantController");

const router = express.Router();

// CLICK SHOP-API callback: action=0 prepare, action=1 complete
router.all("/merchant/click", handleClickMerchant);
router.all("/click/merchant", handleClickMerchant);

module.exports = router;
