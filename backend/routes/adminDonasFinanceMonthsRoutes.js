// backend/routes/adminDonasFinanceMonthsRoutes.js
const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const ctrl = require("../controllers/adminDonasFinanceMonthsController");

const router = express.Router();

/**
 * Защита от падения сервера:
 * если какой-то метод не экспортирован из controller — вернём 501, а не crash.
 */
function h(name) {
  const fn = ctrl && ctrl[name];
  if (typeof fn === "function") return fn;
  return (_req, res) =>
    res.status(501).json({
      error: `Handler not implemented: adminDonasFinanceMonthsController.${name}`,
    });
}

/**
 * SETTINGS
 */
router.get("/settings", authenticateToken, requireAdmin, h("getSettings"));
router.put("/settings", authenticateToken, requireAdmin, h("updateSettings"));

/**
 * MONTHS LIST + CSV EXPORT
 */
router.get("/months", authenticateToken, requireAdmin, h("listMonths"));
router.post("/months/sync", authenticateToken, requireAdmin, h("syncMonths"));
router.get("/months/export.csv", authenticateToken, requireAdmin, h("exportMonthsCsv"));

/**
 * MONTH UPDATE (manual fields only)
 */
router.put("/months/:month", authenticateToken, requireAdmin, h("updateMonth"));

/**
 * LOCK / UNLOCK / RESNAPSHOT
 */
router.post("/months/:month/lock", authenticateToken, requireAdmin, h("lockMonth"));
router.post("/months/:month/lock-up-to", authenticateToken, requireAdmin, h("lockUpTo"));
router.post("/months/:month/unlock", authenticateToken, requireAdmin, h("unlockMonth"));

router.post("/months/:month/resnapshot", authenticateToken, requireAdmin, h("resnapshotMonth"));
router.post("/months/:month/resnapshot-up-to", authenticateToken, requireAdmin, h("resnapshotUpTo"));

/**
 * PREVIEWS
 */
router.get("/months/:month/lock-preview", authenticateToken, requireAdmin, h("lockPreview"));
router.get(
  "/months/:month/resnapshot-up-to-preview",
  authenticateToken,
  requireAdmin,
  h("resnapshotUpToPreview")
);

/**
 * AUDIT (json + csv)
 */
router.get("/audit", authenticateToken, requireAdmin, h("getAudit"));
router.get("/audit/export.csv", authenticateToken, requireAdmin, h("exportAuditCsv"));

router.get("/months/:month/audit", authenticateToken, requireAdmin, h("getMonthAudit"));
router.get(
  "/months/:month/audit/export.csv",
  authenticateToken,
  requireAdmin,
  h("exportMonthAuditCsv")
);

module.exports = router;
