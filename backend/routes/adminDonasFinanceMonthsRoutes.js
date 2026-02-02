// backend/routes/adminDonasFinanceMonthsRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const ctrl = require("../controllers/donasFinanceMonthsController");

const router = express.Router();

// базовый префикс: /api/admin/donas/finance

// ✅ SETTINGS (то, что фронт ждёт)
router.get("/settings", authenticateToken, requireAdmin, ctrl.getSettings);
router.put("/settings", authenticateToken, requireAdmin, ctrl.updateSettings);

// ✅ MONTHS LIST (то, что фронт ждёт)
router.get("/months", authenticateToken, requireAdmin, ctrl.listMonths);

// SINGLE MONTH
router.get("/months/:month", authenticateToken, requireAdmin, ctrl.getMonth);
router.put("/months/:month", authenticateToken, requireAdmin, ctrl.updateMonth);

router.post("/months/:month/lock", authenticateToken, requireAdmin, ctrl.lockMonth);
router.post("/months/:month/unlock", authenticateToken, requireAdmin, ctrl.unlockMonth);

module.exports = router;
