// backend/routes/adminDonasSalesRoutes.js
const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const ctrl = require("../controllers/donasSalesController");

const router = express.Router();

// base in index.js: /api/admin/donas
router.get("/sales", authenticateToken, requireAdmin, ctrl.getSales);
router.post("/sales", authenticateToken, requireAdmin, ctrl.addSale);
router.put("/sales/:id", authenticateToken, requireAdmin, ctrl.updateSale);
router.delete("/sales/:id", authenticateToken, requireAdmin, ctrl.deleteSale);

module.exports = router;
