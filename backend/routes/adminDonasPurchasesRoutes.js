// backend/routes/adminDonasPurchasesRoutes.js
const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const {
  getPurchases,
  addPurchase,
  updatePurchase,
  deletePurchase,
} = require("../controllers/donasPurchasesController");

const router = express.Router();

// base in index.js: /api/admin/donas
router.get("/purchases", authenticateToken, requireAdmin, getPurchases);
router.post("/purchases", authenticateToken, requireAdmin, addPurchase);
router.put("/purchases/:id", authenticateToken, requireAdmin, updatePurchase);
router.delete("/purchases/:id", authenticateToken, requireAdmin, deletePurchase);

module.exports = router;
