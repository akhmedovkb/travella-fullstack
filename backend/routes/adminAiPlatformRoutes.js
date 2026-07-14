// backend/routes/adminAiPlatformRoutes.js

const express = require("express");
const axios = require("axios");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");
const { getAiConfig } = require("../ai/core/aiConfig");
const { getArtifactStorageStatus } = require("../ai/videoOperator/videoArtifactStore");
const { listAiEmployees } = require("../ai/core/aiEmployeeRegistry");
const { listJobs, getJob, updateJob, addEvent } = require("../ai/core/aiJobStore");
const { runAiRuntime } = require("../ai/core/aiRuntime");
const {
  runVideoOperatorTask,
  createScriptFromManualContext,
  startHeygenForVideoJob,
  refreshHeygenForVideoJob,
  listVideoOperatorJobs,
} = require("../ai/videoOperator/videoOperator.runtime");
const { buildPublishingPackage, buildContentReview } = require("../ai/contentManager/contentPromptSystem");

const TELEGRAM_CLIENT_BOT_TOKEN = String(process.env.TELEGRAM_CLIENT_BOT_TOKEN || "").trim();
const AI_PUBLISH_TELEGRAM_CHAT_ID = String(
  process.env.AI_PUBLISH_TELEGRAM_CHAT_ID ||
    process.env.TELEGRAM_PUBLISH_CHAT_ID ||
    process.env.TELEGRAM_AI_PUBLISH_CHAT_ID ||
    ""
).trim();

function normalizePublishingItems(items = []) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index) => ({
      id: String(item?.id || `item_${index + 1}`).trim(),
      channel: String(item?.channel || "").trim(),
      label: String(item?.label || item?.channel || item?.title || `Текст ${index + 1}`).trim(),
      title: String(item?.title || item?.label || `Текст ${index + 1}`).trim(),
      text: String(item?.text || "").trim(),
    }))
    .filter((item) => item.text);
}

function getPublishingContext(job) {
  const service = job?.output?.service || {};
  return service.videoContext || {};
}

function savePublishingPackage(job, items, actor, status = "draft") {
  const output = job.output || {};
  const ctx = getPublishingContext(job);
  const current = output.publishingPackage || buildPublishingPackage(ctx);
  const nextItems = normalizePublishingItems(items);
  if (!nextItems.length) {
    return { success: false, status: 400, message: "Publishing package items are required" };
  }

  const nextPackage = {
    ...current,
    status,
    updatedAt: new Date().toISOString(),
    updatedBy: actor?.id || null,
    approvedAt: status === "approved" ? new Date().toISOString() : current.approvedAt || null,
    approvedBy: status === "approved" ? actor?.id || null : current.approvedBy || null,
    summary: status === "approved" ? "Пакет публикации утверждён." : "Пакет публикации сохранён как черновик.",
    items: nextItems,
    review: buildContentReview(ctx, nextItems),
  };

  const nextJob = updateJob(job.id, {
    output: {
      ...output,
      publishingPackage: nextPackage,
    },
  });

  addEvent(job.id, {
    step: "content_manager",
    type: "tool_result",
    tool: "ContentManager",
    message: status === "approved" ? "Пакет публикации утверждён вручную." : "Пакет публикации сохранён после ручной правки.",
    meta: { status, items: nextItems.length },
  });

  return { success: true, job: nextJob, publishingPackage: nextPackage };
}

function normalizePublicationChannels(channels = {}) {
  const now = new Date().toISOString();
  const allowed = ["instagram", "telegram", "stories", "reels"];
  return allowed.reduce((acc, key) => {
    const item = channels?.[key] || {};
    const published = Boolean(item.published);
    acc[key] = {
      published,
      publishedAt: published ? item.publishedAt || now : null,
      plannedAt: String(item.plannedAt || "").trim(),
      url: String(item.url || "").trim(),
    };
    return acc;
  }, {});
}

function getPublicationStatus(channels = {}) {
  const keys = ["instagram", "telegram", "stories", "reels"];
  const publishedCount = keys.filter((key) => channels?.[key]?.published).length;
  if (publishedCount === 0) return "not_published";
  if (publishedCount === keys.length) return "published_all";
  return "published_partial";
}

function savePublicationStatus(job, channels, actor) {
  const output = job.output || {};
  const ctx = getPublishingContext(job);
  const publishingPackage = output.publishingPackage || buildPublishingPackage(ctx);
  const normalizedChannels = normalizePublicationChannels(channels);
  const publicationStatus = {
    status: getPublicationStatus(normalizedChannels),
    updatedAt: new Date().toISOString(),
    updatedBy: actor?.id || null,
    channels: normalizedChannels,
  };

  const nextJob = updateJob(job.id, {
    output: {
      ...output,
      publishingPackage: {
        ...publishingPackage,
        publicationStatus,
      },
    },
  });

  addEvent(job.id, {
    step: "publishing",
    type: "tool_result",
    tool: "ContentManager",
    message: "Статус ручной публикации обновлён.",
    meta: { status: publicationStatus.status },
  });

  return { success: true, job: nextJob, publicationStatus };
}

function getPublishingItemText(job, channelId) {
  const output = job.output || {};
  const pkg = output.publishingPackage || buildPublishingPackage(getPublishingContext(job));
  const items = Array.isArray(pkg.items) ? pkg.items : [];
  const exact = items.find((item) => String(item?.id || "").toLowerCase() === channelId);
  const byChannel = items.find((item) => String(item?.channel || "").toLowerCase() === channelId);
  const byLabel = items.find((item) => String(item?.label || item?.title || "").toLowerCase().includes(channelId));
  return String((exact || byChannel || byLabel)?.text || "").trim();
}

function limitTelegramCaption(text, videoUrl) {
  const clean = String(text || "").trim();
  if (clean.length <= 1000) return clean;
  const suffix = videoUrl ? `\n\nВидео: ${videoUrl}` : "";
  return `${clean.slice(0, Math.max(0, 980 - suffix.length)).trim()}...${suffix}`;
}

function buildTelegramMessageUrl(chat, messageId) {
  const username = String(chat?.username || "").trim();
  if (username && messageId) return `https://t.me/${username}/${messageId}`;

  const rawId = String(chat?.id || AI_PUBLISH_TELEGRAM_CHAT_ID || "").trim();
  if (rawId.startsWith("-100") && messageId) {
    return `https://t.me/c/${rawId.slice(4)}/${messageId}`;
  }
  return "";
}

async function publishVideoToTelegram(job, actor) {
  console.log("[ai-publishing] telegram publish requested", {
    jobId: job?.id || null,
    chatConfigured: Boolean(AI_PUBLISH_TELEGRAM_CHAT_ID),
    tokenConfigured: Boolean(TELEGRAM_CLIENT_BOT_TOKEN),
  });

  if (!TELEGRAM_CLIENT_BOT_TOKEN) {
    return { success: false, status: 400, message: "TELEGRAM_CLIENT_BOT_TOKEN is missing" };
  }
  if (!AI_PUBLISH_TELEGRAM_CHAT_ID) {
    return { success: false, status: 400, message: "AI_PUBLISH_TELEGRAM_CHAT_ID is missing" };
  }

  const output = job.output || {};
  const pkg = output.publishingPackage || buildPublishingPackage(getPublishingContext(job));
  if (pkg.status !== "approved") {
    return { success: false, status: 400, message: "Publishing package must be approved before Telegram publishing" };
  }

  const videoUrl = String(output.heygen?.artifact?.url || output.heygen?.videoUrl || "").trim();
  if (!videoUrl) {
    return { success: false, status: 400, message: "Video URL is missing" };
  }

  const text = getPublishingItemText(job, "telegram");
  if (!text) {
    return { success: false, status: 400, message: "Telegram publishing text is missing" };
  }

  const api = `https://api.telegram.org/bot${TELEGRAM_CLIENT_BOT_TOKEN}`;
  const payload = {
    chat_id: AI_PUBLISH_TELEGRAM_CHAT_ID,
    video: videoUrl,
    caption: limitTelegramCaption(text, videoUrl),
    supports_streaming: true,
  };

  let data;
  try {
    const res = await axios.post(`${api}/sendVideo`, payload, { timeout: 30000 });
    data = res.data;
  } catch (e) {
    const desc = e?.response?.data?.description || e?.message || "Telegram sendVideo failed";
    console.error("[ai-publishing] telegram sendVideo failed", {
      jobId: job.id,
      status: e?.response?.status || null,
      description: desc,
    });
    return { success: false, status: 502, message: desc };
  }

  if (!data?.ok) {
    console.error("[ai-publishing] telegram sendVideo not ok", {
      jobId: job.id,
      description: data?.description || null,
    });
    return { success: false, status: 502, message: data?.description || "Telegram sendVideo returned not ok" };
  }

  const message = data.result || {};
  const currentChannels = pkg.publicationStatus?.channels || {};
  const publishedAt = new Date().toISOString();
  const telegramUrl = buildTelegramMessageUrl(message.chat, message.message_id);
  const result = savePublicationStatus(
    job,
    {
      ...currentChannels,
      telegram: {
        ...(currentChannels.telegram || {}),
        published: true,
        publishedAt,
        url: telegramUrl,
        messageId: message.message_id || null,
        chatId: message.chat?.id || AI_PUBLISH_TELEGRAM_CHAT_ID,
      },
    },
    actor
  );

  addEvent(job.id, {
    step: "publishing",
    type: "tool_result",
    tool: "PublishingManager",
    message: "Telegram публикация отправлена через клиентский бот.",
    meta: { channel: "telegram", messageId: message.message_id || null, url: telegramUrl || null },
  });

  console.log("[ai-publishing] telegram publish completed", {
    jobId: job.id,
    messageId: message.message_id || null,
    url: telegramUrl || null,
  });

  return {
    success: true,
    job: getJob(job.id) || result.job,
    publicationStatus: result.publicationStatus,
    telegram: {
      messageId: message.message_id || null,
      chatId: message.chat?.id || AI_PUBLISH_TELEGRAM_CHAT_ID,
      url: telegramUrl,
    },
  };
}

router.use(authenticateToken);
router.use(requireAdmin);

router.get("/status", (req, res) => {
  const config = getAiConfig();
  const jobs = listJobs({ limit: 100 });
  res.json({
    success: true,
    employees: listAiEmployees(),
    video: {
      enabled: config.video.enabled,
      heygenReady: config.video.heygen.ready,
      format: config.video.format,
      resolution: config.video.resolution,
      artifactStorage: getArtifactStorageStatus(),
    },
    publishing: {
      telegramReady: Boolean(TELEGRAM_CLIENT_BOT_TOKEN && AI_PUBLISH_TELEGRAM_CHAT_ID),
      telegramChatConfigured: Boolean(AI_PUBLISH_TELEGRAM_CHAT_ID),
    },
    metrics: {
      jobs: jobs.length,
      activeJobs: jobs.filter((x) => ["created", "queued", "running", "processing"].includes(String(x.status || "").toLowerCase())).length,
    },
  });
});

router.post("/tasks", async (req, res) => {
  const command = String(req.body?.command || "").trim();
  if (!command) return res.status(400).json({ success: false, message: "Command is required" });

  const result = await runAiRuntime({
    command,
    employeeId: req.body?.employeeId || "auto",
    actor: { id: req.user?.id || req.user?.userId || null, role: req.user?.role || req.user?.roles || null },
  });

  const status = result.success ? 200 : result.error?.code === "SERVICE_CODE_REQUIRED" ? 400 : 404;
  return res.status(status).json(result);
});

// Backward compatibility with previous frontend stage.
router.post("/video-operator/script", async (req, res) => {
  const code = String(req.body?.code || "").trim();
  if (code && /^R\s*\d+/i.test(code)) {
    const result = await runVideoOperatorTask({ command: `Создай сценарий для ${code}`, actor: { id: req.user?.id || null } });
    return res.status(result.success ? 200 : 404).json(result);
  }
  const result = await createScriptFromManualContext(req.body || {});
  return res.json(result);
});

router.post("/video-operator/heygen-video", async (req, res) => {
  const code = String(req.body?.code || "").trim();
  const result = await runVideoOperatorTask({ command: `Подготовь видео для ${code || "отказного тура"}`, actor: { id: req.user?.id || null } });
  if (!result.success) return res.status(404).json(result);
  return res.json({
    ...result,
    output: {
      ...result.output,
      heygen: { status: "not_started", message: "HeyGen запуск будет подключён следующим этапом после утверждения реального data-flow." },
    },
  });
});

router.post("/video-operator/jobs/:id/heygen/start", async (req, res) => {
  const result = await startHeygenForVideoJob({
    jobId: req.params.id,
    actor: { id: req.user?.id || req.user?.userId || null, role: req.user?.role || req.user?.roles || null },
  });
  if (!result.success) {
    const status = result.error?.code === "JOB_NOT_FOUND" ? 404 : 400;
    return res.status(status).json(result);
  }
  return res.json(result);
});

router.get("/video-operator/jobs", (req, res) => {
  res.json({ success: true, jobs: listVideoOperatorJobs({ limit: req.query.limit || 30 }) });
});

router.get("/video-operator/videos", (req, res) => {
  const jobs = listVideoOperatorJobs({ limit: req.query.limit || 100 });
  const videos = jobs
    .map((job) => {
      const output = job.output || {};
      const service = output.service || {};
      const ctx = service.videoContext || {};
      const heygen = output.heygen || {};
      const artifact = heygen.artifact || {};
      const mediaUrl = artifact.url || heygen.videoUrl || "";

      if (!mediaUrl) return null;

      const publishingPackage = output.publishingPackage || buildPublishingPackage(ctx);

      return {
        id: `${job.id}:${heygen.videoId || "video"}`,
        jobId: job.id,
        command: job.command || "",
        status: job.status || "",
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        code: ctx.code || service.code || "",
        title: ctx.title || service.title || job.command || "Travella AI video",
        destination: ctx.destination || "",
        price: ctx.price || "",
        currency: ctx.currency || "USD",
        heygenStatus: heygen.status || "",
        heygenVideoId: heygen.videoId || "",
        heygenUrl: heygen.videoUrl || "",
        mediaUrl,
        artifactUrl: artifact.url || "",
        storageProvider: artifact.provider || "",
        publishingDrafts: Array.isArray(output.publishingDrafts) ? output.publishingDrafts : [],
        publishingPackage,
      };
    })
    .filter(Boolean);

  res.json({ success: true, videos });
});

router.patch("/video-operator/jobs/:id/publishing-package", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ success: false, message: "Job not found" });
  const result = savePublishingPackage(
    job,
    req.body?.items,
    { id: req.user?.id || req.user?.userId || null },
    "draft"
  );
  if (!result.success) return res.status(result.status || 400).json(result);
  return res.json(result);
});

router.post("/video-operator/jobs/:id/publishing-package/approve", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ success: false, message: "Job not found" });
  const output = job.output || {};
  const current = output.publishingPackage || buildPublishingPackage(getPublishingContext(job));
  const result = savePublishingPackage(
    job,
    req.body?.items || current.items,
    { id: req.user?.id || req.user?.userId || null },
    "approved"
  );
  if (!result.success) return res.status(result.status || 400).json(result);
  return res.json(result);
});

router.patch("/video-operator/jobs/:id/publication-status", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ success: false, message: "Job not found" });
  const result = savePublicationStatus(
    job,
    req.body?.channels || {},
    { id: req.user?.id || req.user?.userId || null }
  );
  return res.json(result);
});

router.post("/video-operator/jobs/:id/publish/telegram", async (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ success: false, message: "Job not found" });
  const result = await publishVideoToTelegram(job, {
    id: req.user?.id || req.user?.userId || null,
    role: req.user?.role || req.user?.roles || null,
  });
  return res.status(result.success ? 200 : result.status || 400).json(result);
});

router.post("/video-operator/jobs/:id/refresh", async (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ success: false, message: "Job not found" });
  const result = await refreshHeygenForVideoJob({ jobId: req.params.id });
  const status = result.success ? 200 : result.error?.code === "HEYGEN_VIDEO_REQUIRED" ? 400 : 502;
  return res.status(status).json(result);
});

module.exports = router;
