// backend/jobs/aiHeygenPollerJob.js

const { getAiConfig } = require("../ai/core/aiConfig");
const { initAiJobStore } = require("../ai/core/aiJobStore");
const { runHeygenVideoPollerOnce } = require("../ai/videoOperator/videoOperator.runtime");

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

async function runAiHeygenPollerJob() {
  if (running) return { skipped: true, reason: "already_running" };
  running = true;

  try {
    await initAiJobStore({ limit: 100 });
    const result = await runHeygenVideoPollerOnce({
      limit: intEnv("AI_HEYGEN_POLLER_BATCH_LIMIT", 20),
    });
    if (result.checked > 0 || result.ready > 0 || result.failed > 0) {
      console.log("[ai-heygen-poller] finished", result);
    }
    return result;
  } catch (err) {
    console.warn("[ai-heygen-poller] failed:", err?.message || err);
    return { success: false, error: err?.message || String(err) };
  } finally {
    running = false;
  }
}

function startAiHeygenPoller() {
  if (timer) return timer;

  if (process.env.NODE_ENV === "test") {
    console.log("[ai-heygen-poller] skipped in test mode");
    return null;
  }

  if (boolEnv("DISABLE_AI_HEYGEN_POLLER", false)) {
    console.log("[ai-heygen-poller] disabled by DISABLE_AI_HEYGEN_POLLER");
    return null;
  }

  const config = getAiConfig();
  if (!config.video.enabled || !config.video.heygen.ready) {
    console.log("[ai-heygen-poller] not started: AI video/HeyGen is not ready");
    return null;
  }

  const intervalMs = Math.max(30000, intEnv("AI_HEYGEN_POLLER_INTERVAL_MS", 120000));
  const initialDelayMs = Math.max(5000, intEnv("AI_HEYGEN_POLLER_INITIAL_DELAY_MS", 30000));

  console.log(`[ai-heygen-poller] started. intervalMs=${intervalMs}, initialDelayMs=${initialDelayMs}`);
  setTimeout(() => runAiHeygenPollerJob(), initialDelayMs).unref?.();
  timer = setInterval(() => runAiHeygenPollerJob(), intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = {
  runAiHeygenPollerJob,
  startAiHeygenPoller,
};
