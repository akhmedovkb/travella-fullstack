// backend/routes/adminDonasFinanceMonthsRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");
const months = require("../controllers/donasFinanceMonthsController");

const router = express.Router();

// Все эти маршруты — админские
router.use(authenticateToken, requireAdmin);

/**
 * Settings
 */
router.get("/settings", months.getSettings);
router.put("/settings", months.updateSettings);

/**
 * Months list / sync
 */
router.get("/months", months.listMonths);
router.post("/months/sync", months.syncMonths);

/**
 * Update month (only loan_paid + notes when unlocked)
 */
router.put("/months/:month", months.updateMonth);

/**
 * Lock / Unlock / Snapshot
 */
router.post("/months/:month/lock", months.lockMonth);
router.post("/months/:month/unlock", months.unlockMonth);
router.post("/months/:month/resnapshot", months.resnapshotMonth);

router.post("/months/:month/lock-up-to", months.lockUpTo);
// alias (UI sometimes uses this name)
router.post("/months/:month/resnapshot-up-to", months.resnapshotUpTo);

/**
 * Previews (UI)
 */
router.get("/months/:month/lock-preview", months.lockPreview); // ?scope=single|upto
router.get("/months/:month/resnapshot-up-to-preview", months.resnapshotUpToPreview);

/**
 * Export
 */
router.get("/months/export.csv", months.exportCsv);

/**
 * Audit
 */
router.get("/audit", months.audit);
router.get("/audit/export.csv", months.exportAuditCsv);
router.get("/audit/:month", months.auditMonth);
router.get("/audit/:month/export.csv", months.exportAuditMonthCsv);

module.exports = router;
