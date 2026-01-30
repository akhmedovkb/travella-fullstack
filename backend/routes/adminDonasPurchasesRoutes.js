// backend/routes/adminDonasPurchasesRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");
const {
  addPurchase,
  listPurchases,
  deletePurchase,
} = require("../controllers/donasPurchasesController");

const router = express.Router();

// все purchase endpoints — только для админа
router.use(authenticateToken, requireAdmin);

// list
router.get("/purchases", listPurchases);

// add
router.post("/purchases", addPurchase);

// delete
router.delete("/purchases/:id", deletePurchase);

module.exports = router;
