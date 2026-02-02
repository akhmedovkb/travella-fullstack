// backend/routes/adminDonasFinanceMonthsRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const ctrl = require("../controllers/donasFinanceMonthsController");

const router = express.Router();

// базовый префикс: /api/admin/donas/finance
router.get("/:month", authenticateToken, requireAdmin, ctrl.getMonth);
router.put("/:month", authenticateToken, requireAdmin, ctrl.updateMonth);

router.post("/:month/lock", authenticateToken, requireAdmin, ctrl.lockMonth);
router.post("/:month/unlock", authenticateToken, requireAdmin, ctrl.unlockMonth);

module.exports = router;
