// backend/routes/adminJobsRoutes.js

const express = require("express");
const router = express.Router();

const { askActualReminder } = require("../jobs/askActualReminder");

// 1) Защита “job endpoint” отдельным токеном (для Postman/cron)
// Header: x-admin-job-token: <TOKEN>
// Env: ADMIN_JOB_TOKEN
function requireJobToken(req, res, next) {
  const expected = process.env.ADMIN_JOB_TOKEN || "";
  const got =
    req.headers["x-admin-job-token"] ||
    req.headers["x-admin-jobs-token"] ||
    req.headers["x-admin-jobs-secret"] ||
    "";

  if (!expected || String(got) !== String(expected)) {
    return res.status(401).json({ message: "Invalid token" });
  }
  next();
}

// POST /api/admin/jobs/ask-actual-now
// body: { forceSlot?: 10|14|18, forceDay?: "YYYY-MM-DD" }
// legacy body (поддержим): { slotHour?: 10|14|18 }
router.post("/jobs/ask-actual-now", requireJobToken, async (req, res) => {
  try {
    const body = req.body || {};

    const forceSlot = body.forceSlot ?? body.slotHour ?? null;
    const forceDay = body.forceDay ?? null;

    const result = await askActualReminder({
      forceSlot,
      forceDay,
    });

    return res.json({
      ok: true,
      used: { forceSlot: forceSlot ?? null, forceDay: forceDay ?? null },
      result,
    });
  } catch (e) {
    console.error("[adminJobsRoutes] ask-actual-now failed:", e?.message || e);
    return res.status(500).json({
      ok: false,
      error: e?.message || "internal_error",
    });
  }
});

module.exports = router;
