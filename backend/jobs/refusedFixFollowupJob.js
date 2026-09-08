// backend/jobs/refusedFixFollowupJob.js

const db = require("../db");
const {
  requestRefusedFixForServiceInternal,
} = require("../controllers/adminRefusedController");

const DEFAULT_THRESHOLD_HOURS = 24;
const DEFAULT_LIMIT = 25;
const DEFAULT_SCAN_LIMIT = 200;

function intEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function boolEnv(name, fallback = false) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function hoursSince(iso, now = new Date()) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((now.getTime() - d.getTime()) / 3600000);
}

async function runRefusedFixFollowupJob(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const thresholdHours = Math.max(
    1,
    Number(options.thresholdHours || intEnv("REFUSED_FIX_FOLLOWUP_THRESHOLD_HOURS", DEFAULT_THRESHOLD_HOURS))
  );
  const limit = Math.max(1, Math.min(Number(options.limit || intEnv("REFUSED_FIX_FOLLOWUP_LIMIT", DEFAULT_LIMIT)), 100));
  const scanLimit = Math.max(limit, Math.min(Number(options.scanLimit || intEnv("REFUSED_FIX_FOLLOWUP_SCAN_LIMIT", DEFAULT_SCAN_LIMIT)), 1000));

  const stats = {
    ok: true,
    thresholdHours,
    scanLimit,
    limit,
    scanned: 0,
    due: 0,
    sent: 0,
    noChat: 0,
    noFixNeeded: 0,
    failed: 0,
    results: [],
  };

  if (boolEnv("DISABLE_REFUSED_FIX_FOLLOWUP_JOB", false)) {
    return { ...stats, skipped: true, reason: "disabled_by_env" };
  }

  if (!process.env.TELEGRAM_CLIENT_BOT_TOKEN) {
    return { ...stats, skipped: true, reason: "no_client_token" };
  }

  const res = await db.query(
    `
      SELECT
        s.id,
        s.details #>> '{admin_fix_request_meta,requestedAt}' AS requested_at
      FROM services s
      WHERE s.deleted_at IS NULL
        AND ((s.category LIKE 'refused_%') OR s.category = 'author_tour')
        AND LOWER(COALESCE(s.status, '')) IN ('approved', 'published')
        AND NULLIF(s.details #>> '{admin_fix_request_meta,requestedAt}', '') IS NOT NULL
      ORDER BY (s.details #>> '{admin_fix_request_meta,requestedAt}') ASC NULLS LAST
      LIMIT $1
    `,
    [scanLimit]
  );

  const candidates = Array.isArray(res.rows) ? res.rows : [];
  stats.scanned = candidates.length;

  const due = candidates
    .filter((row) => {
      const h = hoursSince(row.requested_at, now);
      return h != null && h >= thresholdHours;
    })
    .slice(0, limit);
  stats.due = due.length;

  for (const row of due) {
    try {
      const result = await requestRefusedFixForServiceInternal(
        row.id,
        { id: "refused_fix_followup_job", role: "system" },
        { followUp: true }
      );
      stats.results.push(result);
      if (result.success) stats.sent += 1;
      else if (result.code === "NO_PROVIDER_CHAT_ID") stats.noChat += 1;
      else if (result.code === "NO_FIX_NEEDED") stats.noFixNeeded += 1;
      else stats.failed += 1;
    } catch (e) {
      stats.failed += 1;
      stats.results.push({
        success: false,
        id: row.id,
        code: "FOLLOWUP_FAILED",
        message: e?.response?.data?.description || e?.message || "Follow-up failed",
      });
      console.error("[refusedFixFollowupJob] send failed:", row.id, e?.response?.data || e?.message || e);
    }
  }

  return stats;
}

module.exports = {
  runRefusedFixFollowupJob,
};
