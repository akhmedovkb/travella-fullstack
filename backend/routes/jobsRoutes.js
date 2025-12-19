// backend/routes/jobsRoutes.js

const express = require("express");
const router = express.Router();

const { askActualReminder } = require("../jobs/askActualReminder");

// простой секрет, чтобы никто извне не дергал (задай в .env)
const JOBS_SECRET = process.env.JOBS_SECRET || "";

function isAllowed(req) {
  // если секрет не задан — НЕ разрешаем
  if (!JOBS_SECRET) return false;

  // 1) query ?secret=...
  if (String(req.query.secret || "") === String(JOBS_SECRET)) return true;

  // 2) header X-Jobs-Secret: ...
  const hdr = req.get("X-Jobs-Secret") || req.get("x-jobs-secret") || "";
  if (hdr && String(hdr) === String(JOBS_SECRET)) return true;

  return false;
}

// ручной запуск job
router.get("/ask-actual-reminder", async (req, res) => {
  if (!isAllowed(req)) return res.status(403).json({ ok: false, error: "forbidden" });

  try {
    await askActualReminder();
    return res.json({ ok: true, ran: "askActualReminder" });
  } catch (e) {
    console.error("[jobsRoutes] askActualReminder failed:", e?.message || e);
    return res.status(500).json({ ok: false, error: "job_failed" });
  }
});

module.exports = router;
