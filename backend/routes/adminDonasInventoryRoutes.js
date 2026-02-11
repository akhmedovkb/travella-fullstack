// backend/routes/adminDonasInventoryRoutes.js
const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const ctrl = require("../controllers/donasInventoryController");

const router = express.Router();

// базовый префикс в index.js: /api/admin/donas/inventory

// Items
router.get("/items", authenticateToken, requireAdmin, ctrl.listItems);
router.post("/items", authenticateToken, requireAdmin, ctrl.createItem);
router.put("/items/:id", authenticateToken, requireAdmin, ctrl.updateItem);
router.delete("/items/:id", authenticateToken, requireAdmin, ctrl.deleteItem);

// Stock
router.get("/stock", authenticateToken, requireAdmin, ctrl.getStock);
router.get("/stock/low", authenticateToken, requireAdmin, ctrl.getLowStock);

// Purchases
router.get("/purchases", authenticateToken, requireAdmin, ctrl.listPurchases);
router.get("/purchases/:id", authenticateToken, requireAdmin, ctrl.getPurchase);
router.post("/purchases", authenticateToken, requireAdmin, ctrl.createPurchase);

// Consume (расход со склада)
router.post("/consume", authenticateToken, requireAdmin, ctrl.consumeStock);

module.exports = router;
