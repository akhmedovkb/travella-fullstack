// backend/routes/adminAiPlatformRoutes.js

const express = require("express");
const axios = require("axios");
const { Blob } = require("buffer");
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
const TELEGRAM_VIDEO_UPLOAD_MAX_BYTES = 49 * 1024 * 1024;

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
      messageId: item.messageId || null,
      chatId: item.chatId || null,
      deliveryMethod: String(item.deliveryMethod || "").trim(),
      deliveryLog: Array.isArray(item.deliveryLog) ? item.deliveryLog : [],
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

function buildPublicationHistory(prevChannels = {}, nextChannels = {}, actor = {}) {
  const now = new Date().toISOString();
  const labels = {
    instagram: "Instagram",
    telegram: "Telegram",
    stories: "Stories",
    reels: "Reels",
  };
  const changes = [];
  Object.keys(labels).forEach((key) => {
    const prev = prevChannels?.[key] || {};
    const next = nextChannels?.[key] || {};
    if (Boolean(prev.published) !== Boolean(next.published)) {
      changes.push({
        at: now,
        by: actor?.id || null,
        channel: key,
        channelLabel: labels[key],
        field: "published",
        label: Boolean(next.published) ? "Отмечено опубликованным" : "Сброшена публикация",
      });
    }
    if (String(prev.plannedAt || "") !== String(next.plannedAt || "")) {
      changes.push({
        at: now,
        by: actor?.id || null,
        channel: key,
        channelLabel: labels[key],
        field: "plannedAt",
        label: next.plannedAt ? "Изменён план публикации" : "План публикации очищен",
      });
    }
    if (String(prev.url || "") !== String(next.url || "")) {
      changes.push({
        at: now,
        by: actor?.id || null,
        channel: key,
        channelLabel: labels[key],
        field: "url",
        label: next.url ? "Обновлена ссылка на пост" : "Ссылка на пост очищена",
      });
    }
  });
  return changes;
}

function savePublicationStatus(job, channels, actor) {
  const output = job.output || {};
  const ctx = getPublishingContext(job);
  const publishingPackage = output.publishingPackage || buildPublishingPackage(ctx);
  const prevPublicationStatus = publishingPackage.publicationStatus || {};
  const normalizedChannels = normalizePublicationChannels(channels);
  const newChanges = buildPublicationHistory(prevPublicationStatus.channels || {}, normalizedChannels, actor);
  const history = [
    ...newChanges,
    ...(Array.isArray(prevPublicationStatus.history) ? prevPublicationStatus.history : []),
  ].slice(0, 20);
  const publicationStatus = {
    status: getPublicationStatus(normalizedChannels),
    updatedAt: new Date().toISOString(),
    updatedBy: actor?.id || null,
    channels: normalizedChannels,
    history,
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
    meta: { status: publicationStatus.status, changes: newChanges.length },
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

function limitTelegramTextMessage(text, videoUrl) {
  const clean = String(text || "").trim();
  const suffix = videoUrl ? `\n\nВидео: ${videoUrl}` : "";
  const message = `${clean}${suffix}`;
  if (message.length <= 4096) return message;
  return `${clean.slice(0, Math.max(0, 4093 - suffix.length)).trim()}...${suffix}`;
}

function isTelegramWrongWebPageContentError(description) {
  const normalized = String(description || "").toLowerCase();
  return normalized.includes("wrong type of web page content")
    || normalized.includes("wrong type of the web page content");
}

function shortTelegramError(value) {
  return String(value || "failed")
    .replace(/^bad request:\s*/i, "")
    .slice(0, 180);
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

async function sendTelegramVideoUpload(api, job, videoUrl, text) {
  const download = await axios.get(videoUrl, {
    responseType: "arraybuffer",
    timeout: 60000,
    maxContentLength: TELEGRAM_VIDEO_UPLOAD_MAX_BYTES,
    maxBodyLength: TELEGRAM_VIDEO_UPLOAD_MAX_BYTES,
  });
  const contentType = String(download.headers?.["content-type"] || "video/mp4").split(";")[0].trim() || "video/mp4";
  const bytes = Buffer.byteLength(download.data);
  if (bytes > TELEGRAM_VIDEO_UPLOAD_MAX_BYTES) {
    throw new Error(`Video is too large for Telegram upload fallback (${bytes} bytes)`);
  }

  const form = new FormData();
  form.append("chat_id", AI_PUBLISH_TELEGRAM_CHAT_ID);
  form.append("caption", limitTelegramCaption(text, videoUrl));
  form.append("supports_streaming", "true");
  form.append("video", new Blob([download.data], { type: contentType }), "travella-video.mp4");

  const res = await fetch(`${api}/sendVideo`, {
    method: "POST",
    body: form,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.description || `Telegram upload sendVideo failed with HTTP ${res.status}`);
  }

  console.log("[ai-publishing] telegram sendVideo upload fallback completed", {
    jobId: job.id,
    bytes,
    contentType,
  });
  return data;
}

async function publishVideoToTelegramUnlocked(job, actor) {
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

  const videoUrl = String(output.heygen?.videoUrl || output.heygen?.artifact?.url || "").trim();
  if (!videoUrl) {
    return { success: false, status: 400, message: "Video URL is missing" };
  }

  const text = getPublishingItemText(job, "telegram");
  if (!text) {
    return { success: false, status: 400, message: "Telegram publishing text is missing" };
  }

  const api = `https://api.telegram.org/bot${TELEGRAM_CLIENT_BOT_TOKEN}`;
  const videoPayload = {
    chat_id: AI_PUBLISH_TELEGRAM_CHAT_ID,
    video: videoUrl,
    caption: limitTelegramCaption(text, videoUrl),
    supports_streaming: true,
  };
  const messagePayload = {
    chat_id: AI_PUBLISH_TELEGRAM_CHAT_ID,
    text: limitTelegramTextMessage(text, videoUrl),
    disable_web_page_preview: true,
  };

  let data;
  let deliveryMethod = "sendVideo";
  const deliveryLog = [];
  try {
    const res = await axios.post(`${api}/sendVideo`, videoPayload, { timeout: 30000 });
    data = res.data;
    deliveryLog.push({ method: "sendVideo", status: data?.ok ? "success" : "not_ok", message: data?.ok ? "Telegram accepted video URL" : shortTelegramError(data?.description) });
  } catch (e) {
    const desc = e?.response?.data?.description || e?.message || "Telegram sendVideo failed";
    deliveryLog.push({ method: "sendVideo", status: "failed", message: shortTelegramError(desc) });
    console.error("[ai-publishing] telegram sendVideo failed", {
      jobId: job.id,
      status: e?.response?.status || null,
      description: desc,
    });
    if (!isTelegramWrongWebPageContentError(desc)) {
      return { success: false, status: 502, message: desc };
    }

    try {
      data = await sendTelegramVideoUpload(api, job, videoUrl, text);
      deliveryMethod = "sendVideoUpload";
      deliveryLog.push({ method: "sendVideoUpload", status: "success", message: "Backend uploaded mp4 to Telegram" });
    } catch (uploadError) {
      deliveryLog.push({ method: "sendVideoUpload", status: "failed", message: shortTelegramError(uploadError?.message || uploadError) });
      console.error("[ai-publishing] telegram sendVideo upload fallback failed", {
        jobId: job.id,
        description: uploadError?.message || String(uploadError),
      });
      try {
        const fallback = await axios.post(`${api}/sendMessage`, messagePayload, { timeout: 30000 });
        data = fallback.data;
        deliveryMethod = "sendMessage";
        deliveryLog.push({ method: "sendMessage", status: data?.ok ? "success" : "not_ok", message: data?.ok ? "Published text with video link" : shortTelegramError(data?.description) });
      } catch (fallbackError) {
        const fallbackDesc =
          fallbackError?.response?.data?.description || fallbackError?.message || "Telegram sendMessage failed";
        deliveryLog.push({ method: "sendMessage", status: "failed", message: shortTelegramError(fallbackDesc) });
        console.error("[ai-publishing] telegram sendMessage fallback failed", {
          jobId: job.id,
          status: fallbackError?.response?.status || null,
          description: fallbackDesc,
        });
        return { success: false, status: 502, message: fallbackDesc };
      }
    }
  }

  if (!data?.ok && isTelegramWrongWebPageContentError(data?.description)) {
    try {
      data = await sendTelegramVideoUpload(api, job, videoUrl, text);
      deliveryMethod = "sendVideoUpload";
      deliveryLog.push({ method: "sendVideoUpload", status: "success", message: "Backend uploaded mp4 to Telegram" });
    } catch (uploadError) {
      deliveryLog.push({ method: "sendVideoUpload", status: "failed", message: shortTelegramError(uploadError?.message || uploadError) });
      console.error("[ai-publishing] telegram sendVideo upload fallback failed", {
        jobId: job.id,
        description: uploadError?.message || String(uploadError),
      });
      try {
        const fallback = await axios.post(`${api}/sendMessage`, messagePayload, { timeout: 30000 });
        data = fallback.data;
        deliveryMethod = "sendMessage";
        deliveryLog.push({ method: "sendMessage", status: data?.ok ? "success" : "not_ok", message: data?.ok ? "Published text with video link" : shortTelegramError(data?.description) });
      } catch (fallbackError) {
        const fallbackDesc =
          fallbackError?.response?.data?.description || fallbackError?.message || "Telegram sendMessage failed";
        deliveryLog.push({ method: "sendMessage", status: "failed", message: shortTelegramError(fallbackDesc) });
        console.error("[ai-publishing] telegram sendMessage fallback failed", {
          jobId: job.id,
          status: fallbackError?.response?.status || null,
          description: fallbackDesc,
        });
        return { success: false, status: 502, message: fallbackDesc };
      }
    }
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
        deliveryMethod,
        deliveryLog,
      },
    },
    actor
  );

  addEvent(job.id, {
    step: "publishing",
    type: "tool_result",
    tool: "PublishingManager",
    message: "Telegram публикация отправлена через клиентский бот.",
    meta: { channel: "telegram", messageId: message.message_id || null, url: telegramUrl || null, deliveryMethod, deliveryLog },
  });

  console.log("[ai-publishing] telegram publish completed", {
    jobId: job.id,
    messageId: message.message_id || null,
    url: telegramUrl || null,
    deliveryMethod,
  });

  return {
    success: true,
    job: getJob(job.id) || result.job,
    publicationStatus: result.publicationStatus,
    telegram: {
      messageId: message.message_id || null,
      chatId: message.chat?.id || AI_PUBLISH_TELEGRAM_CHAT_ID,
      url: telegramUrl,
      deliveryMethod,
      deliveryLog,
    },
  };
}

const telegramPublishingLocks = new Set();

async function publishVideoToTelegram(job, actor) {
  const lockKey = String(job?.id || "").trim();
  if (lockKey && telegramPublishingLocks.has(lockKey)) {
    addEvent(job.id, {
      step: "publishing",
      type: "event",
      tool: "PublishingManager",
      level: "warn",
      message: "Telegram публикация уже выполняется, повторный запуск отклонён.",
      meta: { channel: "telegram", actor: actor?.id || null },
    });
    return { success: false, status: 409, message: "Telegram publishing is already running for this job" };
  }
  if (lockKey) telegramPublishingLocks.add(lockKey);
  try {
    return await publishVideoToTelegramUnlocked(job, actor);
  } finally {
    if (lockKey) telegramPublishingLocks.delete(lockKey);
  }
}

function hasTelegramPublicationEvidence(item = {}) {
  return Boolean(item.published || String(item.url || "").trim() || item.messageId);
}

function getDueTelegramPublishingJobs({ limit = 100 } = {}) {
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

async function runDueTelegramPublishing({ limit = 5, scanLimit = 100, actor = { id: "publishing_scheduler", role: "system" } } = {}) {
  const batchLimit = Math.max(1, Math.min(Number(limit) || 5, 20));
  const dueJobs = getDueTelegramPublishingJobs({ limit: scanLimit }).slice(0, batchLimit);
  let published = 0;
  let failed = 0;
  const results = [];

  for (const job of dueJobs) {
    addEvent(job.id, {
      step: "publishing",
      type: "event",
      tool: "PublishingScheduler",
      message: "Автопубликация Telegram по расписанию запущена.",
      meta: { channel: "telegram", actor: actor?.id || null },
    });

    const result = await publishVideoToTelegram(job, actor);
    results.push({
      jobId: job.id,
      code: getPublishingContext(job)?.code || "",
      success: Boolean(result?.success),
      message: result?.message || "",
      telegram: result?.telegram || null,
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

  return { success: true, checked: dueJobs.length, published, failed, results };
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

router.post("/publishing/telegram/run-due", async (req, res) => {
  const result = await runDueTelegramPublishing({
    limit: req.body?.limit || 5,
    scanLimit: req.body?.scanLimit || 100,
    actor: {
      id: req.user?.id || req.user?.userId || "manual_publishing_run",
      role: req.user?.role || req.user?.roles || "admin",
    },
  });
  return res.status(result.success ? 200 : 400).json(result);
});

router.post("/video-operator/jobs/:id/refresh", async (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ success: false, message: "Job not found" });
  const result = await refreshHeygenForVideoJob({ jobId: req.params.id });
  const status = result.success ? 200 : result.error?.code === "HEYGEN_VIDEO_REQUIRED" ? 400 : 502;
  return res.status(status).json(result);
});

module.exports = router;
module.exports.publishVideoToTelegram = publishVideoToTelegram;
module.exports.savePublicationStatus = savePublicationStatus;
module.exports.getDueTelegramPublishingJobs = getDueTelegramPublishingJobs;
module.exports.runDueTelegramPublishing = runDueTelegramPublishing;
