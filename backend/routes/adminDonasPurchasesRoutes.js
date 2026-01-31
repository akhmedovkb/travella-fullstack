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

// Purchases are used as a single ledger:
// - type = 'opex'  -> OPEX tab
// - type = 'capex' -> CAPEX tab
// - other types can exist (e.g. raw purchases), but the UI filters.

router.get("/purchases", authenticateToken, requireAdmin, listPurchases);
router.post("/purchases", authenticateToken, requireAdmin, addPurchase);

// Needed by UI "Delete" button; fixes "Route.delete() requires a callback" when handler is missing.
router.delete("/purchases/:id", authenticateToken, requireAdmin, deletePurchase);

module.exports = router;
