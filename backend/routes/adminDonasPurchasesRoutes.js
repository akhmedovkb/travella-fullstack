// backend/routes/adminDonasPurchasesRoutes.js

const router = require("express").Router();
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const {
  addPurchase,
  listPurchases,
  deletePurchase,
} = require("../controllers/donasPurchasesController");

// Mounted in backend/index.js at: /api/admin/donas
router.get("/purchases", authenticateToken, requireAdmin, listPurchases);
router.post("/purchases", authenticateToken, requireAdmin, addPurchase);
router.delete("/purchases/:id", authenticateToken, requireAdmin, deletePurchase);

module.exports = router;
