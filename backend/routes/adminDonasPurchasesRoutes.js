//backend/routes/adminDonasPurchasesRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const ctrl = require("../controllers/donasPurchasesController");

const router = express.Router();

// базовый префикс в index.js должен быть что-то типа:
// /api/admin/donas/purchases

router.get("/", authenticateToken, requireAdmin, ctrl.listPurchases);
router.post("/", authenticateToken, requireAdmin, ctrl.addPurchase);
router.put("/:id", authenticateToken, requireAdmin, ctrl.updatePurchase);
router.delete("/:id", authenticateToken, requireAdmin, ctrl.deletePurchase);

module.exports = router;
