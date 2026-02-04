// backend/routes/adminDonasFinanceMonthsRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const ctrl = require("../controllers/donasFinanceMonthsController");

const router = express.Router();

// базовый префикс в index.js: /api/admin/donas/finance

// === URL COMPAT LAYER ===
// Фронт ходит на: /api/admin/donas/finance/months/...
// А этот роутер исторически ожидает: /donas/finance/months/...
router.use((req, _res, next) => {
  try {
    const u = req.url || "";
    const path = u.split("?")[0] || "";

    // если уже с /donas/finance - ничего не делаем
    if (path.startsWith("/donas/finance")) return next();

    // если пришло без префикса - добавим его
    const known =
      path === "/settings" || path.startsWith("/settings/") ||
      path === "/months" || path.startsWith("/months/") ||
      path === "/audit" || path.startsWith("/audit/") ||
      path === "/adjustments" || path.startsWith("/adjustments/") ||
      path.endsWith("/export.csv");

    if (known) {
      req.url = "/donas/finance" + u;
    }
  } catch {}
  next();
});

// settings
router.get("/settings", authenticateToken, requireAdmin, ctrl.getSettings);
router.put("/settings", authenticateToken, requireAdmin, ctrl.updateSettings);

// months list
router.get("/months", authenticateToken, requireAdmin, ctrl.listMonths);
router.post("/months/sync", authenticateToken, requireAdmin, ctrl.syncMonths);

// month update + lock
router.put("/months/:month", authenticateToken, requireAdmin, ctrl.updateMonth);

router.post("/months/:month/lock", authenticateToken, requireAdmin, ctrl.lockMonth);
router.post("/months/:month/unlock", authenticateToken, requireAdmin, ctrl.unlockMonth);

router.post("/months/:month/resnapshot", authenticateToken, requireAdmin, ctrl.resnapshotMonth);
router.post("/months/:month/lock-up-to", authenticateToken, requireAdmin, ctrl.lockUpTo);
router.post("/months/:month/bulk-resnapshot", authenticateToken, requireAdmin, ctrl.bulkResnapshot);

// UI helpers (preview + audit)
router.get("/months/:month/lock-preview", authenticateToken, requireAdmin, ctrl.lockPreview);
router.get(
  "/months/:month/resnapshot-up-to-preview",
  authenticateToken,
  requireAdmin,
  ctrl.resnapshotUpToPreview
);
router.post(
  "/months/:month/resnapshot-up-to",
  authenticateToken,
  requireAdmin,
  ctrl.resnapshotUpTo
);

router.get("/months/:month/audit", authenticateToken, requireAdmin, ctrl.auditMonth);
router.get(
  "/months/:month/audit/export.csv",
  authenticateToken,
  requireAdmin,
  ctrl.exportAuditMonthCsv
);

// extras used by UI buttons
router.get("/months/export.csv", authenticateToken, requireAdmin, ctrl.exportCsv);
router.get("/audit", authenticateToken, requireAdmin, ctrl.audit);
router.get("/audit/export.csv", authenticateToken, requireAdmin, ctrl.exportAuditCsv);

module.exports = router;
