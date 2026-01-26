//backend/routes/adminDonasPurchasesRoutes.js

const router = require("express").Router();
const {
  addPurchase,
  listPurchases
} = require("../controllers/donasPurchasesController");

router.post("/purchases", addPurchase);
router.get("/purchases", listPurchases);

module.exports = router;
