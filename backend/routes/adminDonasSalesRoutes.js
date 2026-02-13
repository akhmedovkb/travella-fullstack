// backend/routes/adminDonasSalesRoutes.js
const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const ctrl = require("../controllers/donasSalesController");

const router = express.Router();

// base in index.js: /api/admin/donas
router.get("/sales", authenticateToken, requireAdmin, ctrl.getSales);
router.get("/sales/:id", authenticateToken, requireAdmin, ctrl.getSale);
router.post("/sales", authenticateToken, requireAdmin, ctrl.addSale);

// ✅ NEW: bulk repair / recompute cogs for month
router.post("/sales/recalc-cogs", authenticateToken, requireAdmin, ctrl.recalcCogsMonth);

router.put("/sales/:id", authenticateToken, requireAdmin, ctrl.updateSale);
router.delete("/sales/:id", authenticateToken, requireAdmin, ctrl.deleteSale);

module.exports = router;
