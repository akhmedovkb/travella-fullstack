// backend/routes/adminDonasFinanceRoutes.js
const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/donasFinanceMonthsController");

// settings
router.get("/settings", ctrl.getSettings);
router.put("/settings", ctrl.updateSettings);

// months
router.get("/months", ctrl.listMonths);
router.post("/months/sync", ctrl.syncMonths);
router.get("/months/export.csv", ctrl.exportCsv);

router.put("/months/:month", ctrl.updateMonth);

router.get("/months/:month/lock-preview", ctrl.lockPreview);
router.post("/months/:month/lock", ctrl.lockMonth);
router.post("/months/:month/unlock", ctrl.unlockMonth);
router.post("/months/:month/resnapshot", ctrl.resnapshotMonth);
router.post("/months/:month/lock-up-to", ctrl.lockUpTo);

// bulk resnapshot locked only <= month
router.get("/months/:month/resnapshot-up-to-preview", ctrl.resnapshotUpToPreview);
router.post("/months/:month/resnapshot-up-to", ctrl.resnapshotUpTo);

// audit
router.get("/audit", ctrl.audit);
router.get("/audit/export.csv", ctrl.exportAuditCsv);
router.get("/months/:month/audit", ctrl.auditForMonth);
router.get("/months/:month/audit/export.csv", ctrl.exportMonthAuditCsv);

module.exports = router;
