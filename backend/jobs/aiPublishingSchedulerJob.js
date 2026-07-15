// backend/jobs/aiPublishingSchedulerJob.js

const { initAiJobStore } = require("../ai/core/aiJobStore");
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

async function runAiPublishingSchedulerOnce() {
  if (running) return { skipped: true, reason: "already_running" };
  running = true;

  try {
    await initAiJobStore({ limit: intEnv("AI_PUBLISHING_SCHEDULER_STORE_LIMIT", 100) });
    const result = await adminAiPlatformRoutes.runDueTelegramPublishing({
      limit: intEnv("AI_PUBLISHING_SCHEDULER_BATCH_LIMIT", 5),
      scanLimit: intEnv("AI_PUBLISHING_SCHEDULER_SCAN_LIMIT", 100),
      actor: {
        id: "publishing_scheduler",
        role: "system",
      },
    });
    if (result.checked > 0 || result.published > 0 || result.failed > 0) {
      console.log("[ai-publishing-scheduler] finished", result);
    }
    return result;
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
};
