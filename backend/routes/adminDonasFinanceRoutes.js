// backend/routes/adminDonasFinanceMonthsRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const ctrl = require("../controllers/donasFinanceMonthsController");

const router = express.Router();

// базовый префикс в index.js: /api/admin/donas/finance

function safe(fn, name) {
  if (typeof fn === "function") return fn;

  // НЕ роняем контейнер на старте — вместо этого даём понятный 500.
  console.error(`[donas-finance-months] MISSING handler: ctrl.${name} is not a function`);
  return (req, res) =>
    res.status(500).json({
      error: `Backend misconfigured: handler ctrl.${name} is missing`,
    });
}

// settings
router.get("/settings", authenticateToken, requireAdmin, safe(ctrl.getSettings, "getSettings"));
router.put("/settings", authenticateToken, requireAdmin, safe(ctrl.updateSettings, "updateSettings"));

// months list
router.get("/months", authenticateToken, requireAdmin, safe(ctrl.listMonths, "listMonths"));
router.post("/months/sync", authenticateToken, requireAdmin, safe(ctrl.syncMonths, "syncMonths"));

// month update + lock
router.put("/months/:month", authenticateToken, requireAdmin, safe(ctrl.updateMonth, "updateMonth"));

router.post("/months/:month/lock", authenticateToken, requireAdmin, safe(ctrl.lockMonth, "lockMonth"));
router.post(
  "/months/:month/unlock",
  authenticateToken,
  requireAdmin,
  safe(ctrl.unlockMonth, "unlockMonth")
);

router.post(
  "/months/:month/resnapshot",
  authenticateToken,
  requireAdmin,
  safe(ctrl.resnapshotMonth, "resnapshotMonth")
);
router.post("/months/:month/lock-up-to", authenticateToken, requireAdmin, safe(ctrl.lockUpTo, "lockUpTo"));
router.post(
  "/months/:month/bulk-resnapshot",
  authenticateToken,
  requireAdmin,
  safe(ctrl.bulkResnapshot, "bulkResnapshot")
);

// UI helpers (preview + audit)
router.get(
  "/months/:month/lock-preview",
  authenticateToken,
  requireAdmin,
  safe(ctrl.lockPreview, "lockPreview")
);
router.get(
  "/months/:month/resnapshot-up-to-preview",
  authenticateToken,
  requireAdmin,
  safe(ctrl.resnapshotUpToPreview, "resnapshotUpToPreview")
);
router.post(
  "/months/:month/resnapshot-up-to",
  authenticateToken,
  requireAdmin,
  safe(ctrl.resnapshotUpTo, "resnapshotUpTo")
);

router.get(
  "/months/:month/audit",
  authenticateToken,
  requireAdmin,
  safe(ctrl.auditMonth, "auditMonth")
);
router.get(
  "/months/:month/audit/export.csv",
  authenticateToken,
  requireAdmin,
  safe(ctrl.exportAuditMonthCsv, "exportAuditMonthCsv")
);

// extras used by UI buttons
router.get("/months/export.csv", authenticateToken, requireAdmin, safe(ctrl.exportCsv, "exportCsv"));
router.get("/audit", authenticateToken, requireAdmin, safe(ctrl.audit, "audit"));
router.get(
  "/audit/export.csv",
  authenticateToken,
  requireAdmin,
  safe(ctrl.exportAuditCsv, "exportAuditCsv")
);

module.exports = router;
