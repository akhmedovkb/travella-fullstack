// backend/routes/adminJobsRoutes.js

const express = require("express");
const router = express.Router();

const { askActualReminder } = require("../jobs/askActualReminder");

function requireAdminJobToken(req, res, next) {
  const expected = process.env.ADMIN_JOB_TOKEN || "";
  if (!expected) {
    return res.status(500).json({ ok: false, error: "ADMIN_JOB_TOKEN_not_set" });
  }
  const got = req.headers["x-admin-job-token"];
  if (!got || String(got) !== String(expected)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}

/**
 * POST /api/admin/jobs/ask-actual-now
 * body: { slotHour?: 10|14|18, day?: "YYYY-MM-DD" }
 */
router.post("/jobs/ask-actual-now", requireAdminJobToken, async (req, res) => {
  try {
    const slotHour = req.body?.slotHour;
    const day = req.body?.day;

    await askActualReminder({
      forceSlot: slotHour,
      forceDay: day,
      now: new Date(),
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("[adminJobs] ask-actual-now failed:", e?.message || e);
    return res.status(500).json({ ok: false, error: e?.message || "failed" });
  }
});

module.exports = router;
