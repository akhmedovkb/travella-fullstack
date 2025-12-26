// backend/routes/adminJobsRoutes.js

const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");
const { askActualReminder } = require("../jobs/askActualReminder");

function normalizeSlot(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (![10, 14, 18].includes(n)) return null;
  return n;
}

function normalizeDay(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

// ✅ либо JWT-админ, либо секрет в заголовке
function adminOrJobsSecret(req, res, next) {
  const secret = process.env.ADMIN_JOBS_SECRET || "";
  const got = String(req.headers["x-admin-jobs-secret"] || "").trim();

  if (secret && got && got === secret) return next();

  // иначе идём по обычному пути: JWT + админ
  return authenticateToken(req, res, () => requireAdmin(req, res, next));
}

// POST /api/admin/jobs/ask-actual-now
router.post("/jobs/ask-actual-now", adminOrJobsSecret, async (req, res) => {
  try {
    const rawForceSlot = req.body?.forceSlot ?? req.body?.slotHour ?? req.body?.slot ?? null;
    const rawForceDay = req.body?.forceDay ?? req.body?.day ?? null;

    const forceSlot = normalizeSlot(rawForceSlot);
    const forceDay = normalizeDay(rawForceDay);

    const result = await askActualReminder({
      forceSlot: forceSlot || undefined,
      forceDay: forceDay || undefined,
    });

    res.json({
      ok: true,
      used: { forceSlot: forceSlot || null, forceDay: forceDay || null },
      result,
    });
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || "ask-actual-now failed" });
  }
});

module.exports = router;
