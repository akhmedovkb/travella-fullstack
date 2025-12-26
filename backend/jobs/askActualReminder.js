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
 *
 * body:
 *  - slotHour?: 10|14|18        (старый формат)
 *  - forceSlot?: 10|14|18       (новый / ручной)
 *  - day?: "YYYY-MM-DD"
 */
router.post("/jobs/ask-actual-now", requireAdminJobToken, async (req, res) => {
  try {
    const {
      slotHour,
      forceSlot,
      day,
    } = req.body || {};

    const effectiveSlot =
      forceSlot ??
      slotHour ??
      null;

    if (!effectiveSlot) {
      return res.status(400).json({
        ok: false,
        error: "slot_not_provided",
        hint: "send { slotHour: 10 } or { forceSlot: 10 }",
      });
    }

    await askActualReminder({
      forceSlot: Number(effectiveSlot),
      forceDay: day,
      now: new Date(),
    });

    return res.json({
      ok: true,
      used: {
        forceSlot: Number(effectiveSlot),
        forceDay: day || null,
      },
    });
  } catch (e) {
    console.error("[adminJobs] ask-actual-now failed:", e);
    return res.status(500).json({
      ok: false,
      error: e?.message || "failed",
    });
  }
});

module.exports = router;
