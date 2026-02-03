const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const ctrl = require("../controllers/donasFinanceMonthsController");

const router = express.Router();

// SETTINGS
router.get("/settings", authenticateToken, requireAdmin, ctrl.getSettings);
router.put("/settings", authenticateToken, requireAdmin, ctrl.updateSettings);

// MONTHS LIST
router.get("/months", authenticateToken, requireAdmin, ctrl.listMonths);

// SINGLE MONTH
router.get("/months/:month", authenticateToken, requireAdmin, ctrl.getMonth);
router.put("/months/:month", authenticateToken, requireAdmin, ctrl.updateMonth);

// LOCK / UNLOCK
router.post("/months/:month/lock", authenticateToken, requireAdmin, ctrl.lockMonth);
router.post("/months/:month/unlock", authenticateToken, requireAdmin, ctrl.unlockMonth);

// SYNC (кнопка Sync)
router.post("/months/sync", authenticateToken, requireAdmin, ctrl.syncMonths);

module.exports = router;
