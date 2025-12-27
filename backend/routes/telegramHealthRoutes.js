// backend/routes/telegramHealthRoutes.js

const express = require("express");
const router = express.Router();

const { getTelegramHealth } = require("../utils/telegram");

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
  if (!got) return { ok: false, reason: "missing token" };

  if (got.length != expected.length) return { ok: false, reason: "bad token" };

  // constant-time-ish compare
  let same = 0;
  for (let i = 0; i < expected.length; i++) {
    same |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (same !== 0) return { ok: false, reason: "bad token" };

  return { ok: true };
}

// GET /api/_debug/telegram-health?probe=1&token=...
// or header: x-admin-job-token: <ADMIN_JOB_TOKEN>
router.get("/telegram-health", async (req, res) => {
  const chk = checkJobToken(req);
  if (!chk.ok) return res.status(403).json({ ok: false, error: chk.reason });

  const probe = String(req.query?.probe || "") === "1";
  const health = await getTelegramHealth({ probe });
  return res.json(health);
});

module.exports = router;
