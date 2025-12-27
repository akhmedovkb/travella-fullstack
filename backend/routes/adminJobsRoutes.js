// backend/routes/adminJobsRoutes.js

const express = require("express");
const router = express.Router();

// optional: if you mount jobs routes behind JWT admin middleware,
// keep these requires — if files don't exist in some environment, comment them out.
let authenticateToken = null;
let requireAdmin = null;
try {
  authenticateToken = require("../middleware/authenticateToken");
  requireAdmin = require("../middleware/requireAdmin");
} catch {
  // ignore in minimal environments
}

const { askActualReminder } = require("../jobs/askActualReminder");

function readJobToken(req) {
  return (
    req.headers["x-admin-job-token"] ||
    req.headers["x-job-token"] ||
    req.headers["x-cron-token"] ||
    req.query?.token ||
    ""
  );
}

function checkJobToken(req) {
  const expected =
    process.env.ADMIN_JOB_TOKEN ||
    process.env.ADMIN_JOBS_TOKEN ||
    process.env.CRON_JOB_TOKEN ||
    process.env.JOB_TOKEN ||
    "";

  if (!expected) return { ok: false, reason: "ADMIN_JOB_TOKEN is not set" };

  const got = String(readJobToken(req) || "");
  if (!got) return { ok: false, reason: "missing x-admin-job-token" };

  return { ok: got === expected, reason: got === expected ? "" : "invalid token" };
}

// POST /api/admin/jobs/ask-actual-now
// Body: { forceSlot: 10|14|18, forceDay?: "YYYY-MM-DD" }
// (совместимость) Body: { slotHour: 10|14|18, day?: "YYYY-MM-DD" }
router.post("/ask-actual-now", async (req, res) => {
  // 1) job-token gate (как у тебя в Postman)
  const gate = checkJobToken(req);
  if (gate.ok) {
    try {
      const forceSlot = req.body?.forceSlot ?? req.body?.slotHour ?? null;
      const forceDay = req.body?.forceDay ?? req.body?.day ?? null;

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
        error: e?.message || String(e),
      });
    }
  }

  // 2) fallback: JWT admin gate (если job-token не прошёл)
  if (authenticateToken && requireAdmin) {
    try {
      await new Promise((resolve, reject) => {
        authenticateToken(req, res, (err) => (err ? reject(err) : resolve()));
      });
      await new Promise((resolve, reject) => {
        requireAdmin(req, res, (err) => (err ? reject(err) : resolve()));
      });

      const forceSlot = req.body?.forceSlot ?? req.body?.slotHour ?? null;
      const forceDay = req.body?.forceDay ?? req.body?.day ?? null;

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
      return res.status(401).json({ ok: false, message: "Invalid token" });
    }
  }

  // 3) no auth method available
  return res.status(401).json({
    ok: false,
    message: gate.reason || "Unauthorized",
  });
});

module.exports = router;
