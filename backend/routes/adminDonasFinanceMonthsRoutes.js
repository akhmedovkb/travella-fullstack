// backend/routes/adminDonasFinanceMonthsRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const ctrl = require("../controllers/donasFinanceMonthsController");

const router = express.Router();

// базовый префикс: /api/admin/donas/finance
router.get("/months/:month", authenticateToken, requireAdmin, ctrl.getMonth);
router.put("/months/:month", authenticateToken, requireAdmin, ctrl.updateMonth);

router.post("/months/:month/lock", authenticateToken, requireAdmin, ctrl.lockMonth);
router.post("/months/:month/unlock", authenticateToken, requireAdmin, ctrl.unlockMonth);

module.exports = router;
