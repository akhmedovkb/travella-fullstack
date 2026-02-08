// backend/routes/adminDonasFinanceRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const ctrl = require("../controllers/donasFinanceMonthsController");

const router = express.Router();

// Все эти маршруты — админские
router.use(authenticateToken, requireAdmin);

/**
 * Settings
 */
router.get("/settings", ctrl.getSettings);
router.put("/settings", ctrl.updateSettings);

/**
 * Months list / sync
 */
router.get("/months", ctrl.listMonths);
router.post("/months/sync", ctrl.syncMonths);

/**
 * Update month (loan_paid + notes when unlocked)
 */
router.put("/months/:month", ctrl.updateMonth);

/**
 * Lock / Unlock / Snapshot
 */
router.post("/months/:month/lock", ctrl.lockMonth);
router.post("/months/:month/unlock", ctrl.unlockMonth);

router.post("/months/:month/resnapshot", ctrl.resnapshotMonth);

// lock all ≤ current
router.post("/months/:month/lock-up-to", ctrl.lockUpTo);

// bulk resnapshot in range (UI)
router.post("/months/:month/bulk-resnapshot", ctrl.bulkResnapshot);

// resnapshot up to month (UI)
router.get("/months/:month/resnapshot-up-to-preview", ctrl.resnapshotUpToPreview);
router.post("/months/:month/resnapshot-up-to", ctrl.resnapshotUpTo);

/**
 * Previews (UI)
 */
router.get("/months/:month/lock-preview", ctrl.lockPreview);

/**
 * Audit (new paths used by UI)
 */
router.get("/months/:month/audit", ctrl.auditMonth);
router.get("/months/:month/audit/export.csv", ctrl.exportAuditMonthCsv);

/**
 * Exports
 */
router.get("/months/export.csv", ctrl.exportCsv);
router.get("/audit", ctrl.audit);
router.get("/audit/export.csv", ctrl.exportAuditCsv);

/**
 * Legacy aliases (на случай старого UI)
 * /audit/:month вместо /months/:month/audit
 */
router.get("/audit/:month", ctrl.auditMonth);
router.get("/audit/:month/export.csv", ctrl.exportAuditMonthCsv);

module.exports = router;
