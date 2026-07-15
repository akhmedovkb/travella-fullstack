// backend/jobs/aiPublishingSchedulerJob.js

const { initAiJobStore, listJobs, addEvent } = require("../ai/core/aiJobStore");
const adminAiPlatformRoutes = require("../routes/adminAiPlatformRoutes");

let timer = null;
let running = false;

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  return ["1", "true", "yes", "on", "enabled"].includes(String(raw).trim().toLowerCase());
}

function intEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function hasTelegramPublicationEvidence(item = {}) {
  return Boolean(item.published || String(item.url || "").trim() || item.messageId);
}

function getDueTelegramJobs({ limit = 100 } = {}) {
  const now = Date.now();
  return listJobs({ employeeId: "video_operator", limit })
    .filter((job) => {
      const pkg = job.output?.publishingPackage || {};
      const telegram = pkg.publicationStatus?.channels?.telegram || {};
      const plannedAt = new Date(telegram.plannedAt || 0).getTime();
      return pkg.status === "approved"
        && Number.isFinite(plannedAt)
        && plannedAt > 0
        && plannedAt <= now
        && !hasTelegramPublicationEvidence(telegram);
    })
    .sort((a, b) => {
      const aTime = new Date(a.output?.publishingPackage?.publicationStatus?.channels?.telegram?.plannedAt || 0).getTime();
      const bTime = new Date(b.output?.publishingPackage?.publicationStatus?.channels?.telegram?.plannedAt || 0).getTime();
      return aTime - bTime;
    });
}

async function runAiPublishingSchedulerOnce() {
  if (running) return { skipped: true, reason: "already_running" };
  running = true;

  try {
    await initAiJobStore({ limit: intEnv("AI_PUBLISHING_SCHEDULER_STORE_LIMIT", 100) });
    const batchLimit = Math.max(1, Math.min(intEnv("AI_PUBLISHING_SCHEDULER_BATCH_LIMIT", 5), 20));
    const dueJobs = getDueTelegramJobs({ limit: intEnv("AI_PUBLISHING_SCHEDULER_SCAN_LIMIT", 100) }).slice(0, batchLimit);
    let published = 0;
    let failed = 0;

    for (const job of dueJobs) {
      addEvent(job.id, {
        step: "publishing",
        type: "event",
        tool: "PublishingScheduler",
        message: "Автопубликация Telegram по расписанию запущена.",
        meta: { channel: "telegram" },
      });

      const result = await adminAiPlatformRoutes.publishVideoToTelegram(job, {
        id: "publishing_scheduler",
        role: "system",
      });

      if (result?.success) {
        published += 1;
      } else {
        failed += 1;
        addEvent(job.id, {
          step: "publishing",
          type: "tool_result",
          tool: "PublishingScheduler",
          level: "warn",
          message: result?.message || "Автопубликация Telegram не выполнена.",
          meta: { channel: "telegram", status: result?.status || null },
        });
      }
    }

    if (dueJobs.length || published || failed) {
      console.log("[ai-publishing-scheduler] finished", { checked: dueJobs.length, published, failed });
    }
    return { success: true, checked: dueJobs.length, published, failed };
  } catch (err) {
    console.warn("[ai-publishing-scheduler] failed:", err?.message || err);
    return { success: false, error: err?.message || String(err) };
  } finally {
    running = false;
  }
}

function startAiPublishingScheduler() {
  if (timer) return timer;

  if (process.env.NODE_ENV === "test") {
    console.log("[ai-publishing-scheduler] skipped in test mode");
    return null;
  }

  if (boolEnv("DISABLE_AI_PUBLISHING_SCHEDULER", false)) {
    console.log("[ai-publishing-scheduler] disabled by DISABLE_AI_PUBLISHING_SCHEDULER");
    return null;
  }

  const tokenReady = Boolean(String(process.env.TELEGRAM_CLIENT_BOT_TOKEN || "").trim());
  const chatReady = Boolean(String(
    process.env.AI_PUBLISH_TELEGRAM_CHAT_ID ||
      process.env.TELEGRAM_PUBLISH_CHAT_ID ||
      process.env.TELEGRAM_AI_PUBLISH_CHAT_ID ||
      ""
  ).trim());

  if (!tokenReady || !chatReady) {
    console.log("[ai-publishing-scheduler] not started: Telegram publish env is not ready");
    return null;
  }

  const intervalMs = Math.max(60000, intEnv("AI_PUBLISHING_SCHEDULER_INTERVAL_MS", 60000));
  const initialDelayMs = Math.max(10000, intEnv("AI_PUBLISHING_SCHEDULER_INITIAL_DELAY_MS", 20000));

  console.log(`[ai-publishing-scheduler] started. intervalMs=${intervalMs}, initialDelayMs=${initialDelayMs}`);
  setTimeout(() => runAiPublishingSchedulerOnce(), initialDelayMs).unref?.();
  timer = setInterval(() => runAiPublishingSchedulerOnce(), intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = {
  runAiPublishingSchedulerOnce,
  startAiPublishingScheduler,
  getDueTelegramJobs,
};
