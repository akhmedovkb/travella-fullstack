// backend/routes/adminAiPlatformRoutes.js

const express = require("express");
const axios = require("axios");
const { Blob } = require("buffer");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");
const { getAiConfig } = require("../ai/core/aiConfig");
const {
  getAiVideoEnabledSetting,
  setAiVideoEnabledSetting,
  getAiVideoProfileSetting,
  setAiVideoProfileSetting,
  getAiVideoPresetsSetting,
  setAiVideoPresetsSetting,
} = require("../ai/core/aiRuntimeSettings");
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
const { findRefusedServiceByCode, searchRefusedServices } = require("../ai/videoOperator/refusedServiceLookup");
const { buildPublishingPackage, buildContentReview } = require("../ai/contentManager/contentPromptSystem");
const { buildServiceMessage } = require("../utils/telegramServiceCard");

const TELEGRAM_CLIENT_BOT_TOKEN = String(process.env.TELEGRAM_CLIENT_BOT_TOKEN || "").trim();
const TELEGRAM_PUBLIC_BOT_USERNAME = String(
  process.env.TELEGRAM_CLIENT_BOT_USERNAME ||
    process.env.TELEGRAM_BOT_USERNAME ||
    process.env.TELEGRAM_BOT ||
    ""
).replace(/^@/, "").trim();
const AI_PUBLISH_TELEGRAM_CHAT_ID = String(
  process.env.AI_PUBLISH_TELEGRAM_CHAT_ID ||
    process.env.TELEGRAM_PUBLISH_CHAT_ID ||
    process.env.TELEGRAM_AI_PUBLISH_CHAT_ID ||
    ""
).trim();
const TELEGRAM_VIDEO_UPLOAD_MAX_BYTES = 49 * 1024 * 1024;
const TELEGRAM_CHAT_HEALTH_CACHE_MS = 60000;
const SITE_URL = String(
  process.env.SITE_PUBLIC_URL ||
    process.env.SITE_URL ||
    process.env.FRONTEND_URL ||
    "https://travella.uz"
).replace(/\/+$/, "");

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  return ["1", "true", "yes", "on", "enabled"].includes(String(raw).trim().toLowerCase());
}

function intEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function maskTelegramChatId(value) {
  const clean = String(value || "").trim();
  if (!clean) return "";
  if (clean.startsWith("@")) {
    if (clean.length <= 5) return "@***";
    return `${clean.slice(0, 4)}...${clean.slice(-2)}`;
  }
  if (clean.length <= 6) return "***";
  return `${clean.slice(0, 4)}...${clean.slice(-4)}`;
}

function getTelegramChatHealthMessage(reason) {
  const messages = {
    ready: "Telegram готов к публикации.",
    telegram_token_missing: "TELEGRAM_CLIENT_BOT_TOKEN is missing",
    telegram_chat_missing: "AI_PUBLISH_TELEGRAM_CHAT_ID is missing",
    chat_not_found: "Telegram chat not found. Проверь AI_PUBLISH_TELEGRAM_CHAT_ID и добавь бота в канал/чат.",
    forbidden: "Telegram bot has no access to this chat. Добавь бота в канал/чат и дай право публиковать.",
    telegram_unreachable: "Telegram chat check failed. Проверь бота, chat id и доступ к Telegram API.",
  };
  return messages[reason] || messages.telegram_unreachable;
}

let telegramChatHealthCache = { at: 0, value: null };

async function getTelegramPublishChatHealth({ force = false } = {}) {
  const now = Date.now();
  if (!force && telegramChatHealthCache.value && now - telegramChatHealthCache.at < TELEGRAM_CHAT_HEALTH_CACHE_MS) {
    return telegramChatHealthCache.value;
  }

  const base = {
    ok: false,
    configured: Boolean(TELEGRAM_CLIENT_BOT_TOKEN && AI_PUBLISH_TELEGRAM_CHAT_ID),
    tokenConfigured: Boolean(TELEGRAM_CLIENT_BOT_TOKEN),
    chatConfigured: Boolean(AI_PUBLISH_TELEGRAM_CHAT_ID),
    chatIdMasked: maskTelegramChatId(AI_PUBLISH_TELEGRAM_CHAT_ID),
    reason: "telegram_unreachable",
    message: getTelegramChatHealthMessage("telegram_unreachable"),
  };

  if (!TELEGRAM_CLIENT_BOT_TOKEN) {
    const value = { ...base, reason: "telegram_token_missing", message: getTelegramChatHealthMessage("telegram_token_missing") };
    telegramChatHealthCache = { at: now, value };
    return value;
  }
  if (!AI_PUBLISH_TELEGRAM_CHAT_ID) {
    const value = { ...base, reason: "telegram_chat_missing", message: getTelegramChatHealthMessage("telegram_chat_missing") };
    telegramChatHealthCache = { at: now, value };
    return value;
  }

  try {
    const api = `https://api.telegram.org/bot${TELEGRAM_CLIENT_BOT_TOKEN}`;
    const res = await axios.post(`${api}/getChat`, { chat_id: AI_PUBLISH_TELEGRAM_CHAT_ID }, { timeout: 10000 });
    const chat = res.data?.result || {};
    const value = {
      ...base,
      ok: Boolean(res.data?.ok),
      configured: true,
      reason: res.data?.ok ? "ready" : "telegram_unreachable",
      message: res.data?.ok ? getTelegramChatHealthMessage("ready") : getTelegramChatHealthMessage("telegram_unreachable"),
      chatType: chat.type || "",
      chatTitle: chat.title || chat.username || "",
    };
    telegramChatHealthCache = { at: now, value };
    return value;
  } catch (e) {
    const status = Number(e?.response?.status || 0);
    const description = String(e?.response?.data?.description || e?.message || "").trim();
    const normalized = description.toLowerCase();
    const reason = normalized.includes("chat not found")
      ? "chat_not_found"
      : status === 403 || normalized.includes("forbidden")
        ? "forbidden"
        : "telegram_unreachable";
    const value = {
      ...base,
      configured: true,
      reason,
      message: getTelegramChatHealthMessage(reason),
      telegramStatus: status || null,
    };
    telegramChatHealthCache = { at: now, value };
    return value;
  }
}

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

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function getServiceDetailsObject(service = {}) {
  if (!service.details) return {};
  if (typeof service.details === "object" && !Array.isArray(service.details)) return service.details;
  if (typeof service.details === "string") {
    try {
      const parsed = JSON.parse(service.details);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function getAiPublicPrice(service = {}, ctx = {}) {
  const details = getServiceDetailsObject(service);
  return firstNonEmpty(
    details.grossPrice,
    details.gross_price,
    details.priceGross,
    details.price_gross,
    details.bruttoPrice,
    details.brutto_price,
    details.clientPrice,
    details.client_price,
    details.publicPrice,
    details.public_price,
    details.price,
    service.grossPrice,
    service.gross_price,
    service.price,
    ctx.grossPrice,
    ctx.priceGross,
    ctx.publicPrice,
    ctx.price
  );
}

function getAiPublicCurrency(service = {}, ctx = {}) {
  const details = getServiceDetailsObject(service);
  return firstNonEmpty(
    details.currency,
    details.priceCurrency,
    details.price_currency,
    service.currency,
    service.price_currency,
    ctx.currency,
    "USD"
  );
}

function buildPublishingContextForJob(job) {
  const output = job?.output || {};
  const service = output.service || {};
  const ctx = getPublishingContext(job);
  const price = getAiPublicPrice(service, ctx);
  const currency = getAiPublicCurrency(service, ctx);
  return {
    ...ctx,
    ...(price ? { price } : {}),
    currency,
  };
}

async function hydrateJobServiceFromDb(job, cache = new Map()) {
  const output = job?.output || {};
  const service = output.service || {};
  const ctx = service.videoContext || {};
  const code = String(ctx.code || service.taskCode || service.displayCode || service.code || "").trim();
  const serviceId = getJobServiceId(job);
  const lookupCode = code || (serviceId ? `R${serviceId}` : "");
  if (!lookupCode) return job;

  const cacheKey = lookupCode.toUpperCase();
  if (!cache.has(cacheKey)) {
    const lookup = await findRefusedServiceByCode(lookupCode).catch((error) => ({
      found: false,
      error: error?.message || String(error),
    }));
    cache.set(cacheKey, lookup?.found ? lookup.service : null);
  }

  const freshService = cache.get(cacheKey);
  if (!freshService) return job;

  return {
    ...job,
    output: {
      ...output,
      service: {
        ...service,
        ...freshService,
        videoContext: {
          ...(service.videoContext || {}),
          ...(freshService.videoContext || {}),
        },
      },
    },
  };
}

function savePublishingPackage(job, items, actor, status = "draft") {
  const output = job.output || {};
  const ctx = buildPublishingContextForJob(job);
  const current = buildPublishingPackageForJob(job);
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
  const publishingPackage = buildPublishingPackageForJob(job);
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
  const pkg = output.publishingPackage || buildPublishingPackage(buildPublishingContextForJob(job));
  return getPublishingItemTextFromPackage(pkg, channelId);
}

function getPublishingItemTextFromPackage(pkg, channelId) {
  const items = Array.isArray(pkg.items) ? pkg.items : [];
  const exact = items.find((item) => String(item?.id || "").toLowerCase() === channelId);
  const byChannel = items.find((item) => String(item?.channel || "").toLowerCase() === channelId);
  const byLabel = items.find((item) => String(item?.label || item?.title || "").toLowerCase().includes(channelId));
  return String((exact || byChannel || byLabel)?.text || "").trim();
}

function getPublishingItemFromPackage(pkg, channelId) {
  const items = Array.isArray(pkg?.items) ? pkg.items : [];
  const normalized = String(channelId || "").toLowerCase();
  return items.find((item) => String(item?.id || "").toLowerCase() === normalized)
    || items.find((item) => String(item?.channel || "").toLowerCase() === normalized)
    || items.find((item) => String(item?.label || item?.title || "").toLowerCase().includes(normalized))
    || null;
}

function isLegacyTelegramPublishingText(text) {
  const clean = String(text || "").trim();
  if (!clean) return true;
  if (/<b>|<code>|#R\d+/i.test(clean)) return false;
  if (/контакты\s+откроются\s+после\s+оплаты/i.test(clean)) return false;
  return /^(горящ|горяч|направление:|предложение отказное|цена:)/i.test(clean)
    || /направление:\s*/i.test(clean)
    || /код предложения:\s*/i.test(clean);
}

function isLegacyContentManagerText(item = {}) {
  const text = String(item?.text || "").trim();
  if (!text) return true;
  if (String(item?.source || "").trim() && String(item?.source || "").trim() !== "telegram_service_card") return false;
  const id = String(item?.id || "").toLowerCase();
  const title = String(item?.title || item?.label || "").toLowerCase();
  if (id.includes("telegram") || title.includes("telegram")) return isLegacyTelegramPublishingText(text);
  if (/горящ(ий|ее)\s+отказн/i.test(text)) return true;
  if (/предложение\s+отказное/i.test(text)) return true;
  if (/сторис\s*1:/i.test(text)) return true;
  if (/для деталей\s+и\s+бронирования/i.test(text)) return true;
  if (/проверь\s+актуальность\s+отказн/i.test(text)) return true;
  if (id.includes("reels") || title.includes("reels") || title.includes("shorts")) return /^([A-ZА-Я]\d+:\s*)?.{1,90}\s+за\s+[\d\s.,]+/i.test(text);
  return false;
}

function stripTelegramHtml(text) {
  return String(text || "").replace(/<[^>]+>/g, "");
}

function limitTelegramCaption(text, videoUrl) {
  const clean = String(text || "").trim();
  if (clean.length <= 1000) return clean;
  const suffix = videoUrl ? `\n\nВидео: ${videoUrl}` : "";
  const plain = stripTelegramHtml(clean);
  return `${plain.slice(0, Math.max(0, 980 - suffix.length)).trim()}...${suffix}`;
}

function limitTelegramTextMessage(text, videoUrl) {
  const clean = String(text || "").trim();
  const suffix = videoUrl ? `\n\nВидео: ${videoUrl}` : "";
  const message = `${clean}${suffix}`;
  if (message.length <= 4096) return message;
  const plain = stripTelegramHtml(clean);
  return `${plain.slice(0, Math.max(0, 4093 - suffix.length)).trim()}...${suffix}`;
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

function getJobServiceId(job) {
  const output = job?.output || {};
  const service = output.service || {};
  const ctx = service.videoContext || {};
  const raw = service.id || service.serviceId || ctx.serviceId || ctx.id || ctx.code || service.code || "";
  const match = String(raw).match(/R?\s*(\d+)/i);
  return match ? match[1] : "";
}

function buildMarketplaceServiceUrl(serviceId, params = {}) {
  const url = new URL("/marketplace", SITE_URL);
  url.searchParams.set("opened", String(serviceId));
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

function buildTelegramUnlockBotUrl(serviceId) {
  if (TELEGRAM_PUBLIC_BOT_USERNAME) {
    const payload = encodeURIComponent(`unlock_${serviceId}`);
    return `https://t.me/${TELEGRAM_PUBLIC_BOT_USERNAME}?start=${payload}`;
  }
  const url = new URL("/client/balance", SITE_URL);
  url.searchParams.set("service_id", String(serviceId));
  url.searchParams.set("source", "telegram_ai_publish_fallback");
  return url.toString();
}

function buildTelegramVideoReplyMarkup(job) {
  const serviceId = getJobServiceId(job);
  if (!serviceId) return null;
  return {
    inline_keyboard: [
      [{ text: "💬 Связаться с поставщиком", url: buildTelegramUnlockBotUrl(serviceId) }],
      [{ text: "✈️ Детали рейса", url: buildMarketplaceServiceUrl(serviceId, { details: "flight" }) }],
    ],
  };
}

function getTelegramCardCategory(job) {
  const output = job?.output || {};
  const service = output.service || {};
  const ctx = getPublishingContext(job);
  const raw = String(
    service.category ||
      service.serviceCategory ||
      ctx.categoryKey ||
      ctx.serviceCategory ||
      ctx.category ||
      "refused_tour"
  ).trim().toLowerCase();
  if (!raw) return "refused_tour";
  if (raw.includes("авиа") || raw.includes("flight") || raw.includes("air")) return "refused_flight";
  if (raw.includes("отел") || raw.includes("hotel")) return "refused_hotel";
  if (raw.includes("меропр") || raw.includes("билет") || raw.includes("event") || raw.includes("ticket")) return "refused_event_ticket";
  if (raw.includes("автор") || raw.includes("author")) return "author_tour";
  if (raw.includes("тур") || raw.includes("refused")) return "refused_tour";
  return raw;
}

function buildTelegramCardService(job) {
  const output = job?.output || {};
  const service = output.service || {};
  const ctx = buildPublishingContextForJob(job);
  const details = getServiceDetailsObject(service);

  return {
    ...service,
    id: service.id || service.serviceId || ctx.serviceId || getJobServiceId(job),
    code: service.code || ctx.code || "",
    category: service.category || getTelegramCardCategory(job),
    title: service.title || ctx.title || "",
    details: {
      ...details,
      ...ctx,
      price: ctx.price,
      currency: ctx.currency,
    },
    provider: service.provider || {
      name: ctx.supplier || "",
    },
  };
}

function buildTelegramVideoCaption(job) {
  const fallback = getPublishingItemText(job, "telegram");
  const pkg = job?.output?.publishingPackage || null;
  const telegramItem = getPublishingItemFromPackage(pkg, "telegram");
  const shouldKeepFallback = fallback && telegramItem && !isLegacyTelegramPublishingText(fallback);
  if (shouldKeepFallback) return fallback;

  const serviceId = getJobServiceId(job);
  if (!serviceId) return fallback;

  try {
    const category = getTelegramCardCategory(job);
    const built = buildServiceMessage(buildTelegramCardService(job), category, "client", {
      unlocked: false,
      forceRefused: true,
      publicOpenBotUrl: buildTelegramUnlockBotUrl(serviceId),
    });
    const text = String(built?.text || "").trim();
    return text || fallback;
  } catch (e) {
    console.warn("[ai-publishing] telegram card caption fallback", {
      jobId: job?.id || null,
      error: e?.message || String(e),
    });
    return fallback;
  }
}

function buildPublishingPackageForJob(job) {
  const output = job?.output || {};
  const ctx = buildPublishingContextForJob(job);
  const generated = buildPublishingPackage(ctx);
  const base = output.publishingPackage || generated;
  const caption = buildTelegramVideoCaption(job);

  const items = Array.isArray(base.items) ? base.items : [];
  const generatedItems = Array.isArray(generated.items) ? generated.items : [];
  const generatedByKey = new Map();
  generatedItems.forEach((item) => {
    [item.id, item.channel, item.label, item.title]
      .map((value) => String(value || "").toLowerCase())
      .filter(Boolean)
      .forEach((key) => generatedByKey.set(key, item));
  });

  const nextItems = items.map((item) => {
    const id = String(item?.id || "").toLowerCase();
    const channel = String(item?.channel || "").toLowerCase();
    const label = String(item?.label || item?.title || "").toLowerCase();
    const isTelegram = id.includes("telegram") || channel === "telegram" || label.includes("telegram");
    if (!isLegacyContentManagerText(item)) return item;

    if (!isTelegram) {
      const generatedItem = generatedByKey.get(id) || generatedByKey.get(channel) || generatedByKey.get(label);
      return generatedItem ? { ...item, ...generatedItem } : item;
    }

    if (!caption) return item;
    return {
      ...item,
      id: item.id || "telegram_post",
      channel: item.channel || "Telegram",
      label: item.label || "Telegram",
      title: "Caption для Telegram-видео",
      text: caption,
      source: "telegram_service_card",
    };
  });
  const hasTelegram = nextItems.some((item) => {
    const id = String(item?.id || "").toLowerCase();
    const channel = String(item?.channel || "").toLowerCase();
    const label = String(item?.label || item?.title || "").toLowerCase();
    return id.includes("telegram") || channel === "telegram" || label.includes("telegram");
  });
  const finalItems = hasTelegram
    ? nextItems
    : [
        ...nextItems,
        {
          id: "telegram_post",
          channel: "Telegram",
          label: "Telegram",
          title: "Caption для Telegram-видео",
          text: caption,
          source: "telegram_service_card",
        },
      ];

  return {
    ...base,
    version: `${base.version || "content_manager_v1"}+telegram_card_caption`,
    summary: "Пакет публикации готов к ручной проверке. Telegram caption подтянут из карточки продукта.",
    items: finalItems,
    review: buildContentReview(ctx, finalItems),
  };
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
  form.append("parse_mode", "HTML");
  form.append("supports_streaming", "true");
  const replyMarkup = buildTelegramVideoReplyMarkup(job);
  if (replyMarkup) form.append("reply_markup", JSON.stringify(replyMarkup));
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

  const chatHealth = await getTelegramPublishChatHealth({ force: true });
  if (!chatHealth.ok) {
    const message = chatHealth.message || "Telegram chat is not reachable";
    addEvent(job.id, {
      step: "publishing",
      type: "tool_result",
      tool: "PublishingManager",
      level: "warn",
      message,
      meta: {
        channel: "telegram",
        reason: chatHealth.reason || "telegram_unreachable",
        chatIdMasked: chatHealth.chatIdMasked || "",
      },
    });
    return {
      success: false,
      status: chatHealth.reason === "chat_not_found" || chatHealth.reason === "forbidden" ? 400 : 502,
      message,
      telegramChat: chatHealth,
    };
  }

  const output = job.output || {};
  const pkg = buildPublishingPackageForJob(job);
  if (pkg.status !== "approved") {
    return { success: false, status: 400, message: "Publishing package must be approved before Telegram publishing" };
  }

  const videoUrl = String(output.heygen?.videoUrl || output.heygen?.artifact?.url || "").trim();
  if (!videoUrl) {
    return { success: false, status: 400, message: "Video URL is missing" };
  }

  const text = buildTelegramVideoCaption(job);
  if (!text) {
    return { success: false, status: 400, message: "Telegram publishing text is missing" };
  }

  const api = `https://api.telegram.org/bot${TELEGRAM_CLIENT_BOT_TOKEN}`;
  const videoPayload = {
    chat_id: AI_PUBLISH_TELEGRAM_CHAT_ID,
    video: videoUrl,
    caption: limitTelegramCaption(text, videoUrl),
    parse_mode: "HTML",
    supports_streaming: true,
  };
  const replyMarkup = buildTelegramVideoReplyMarkup(job);
  if (replyMarkup) videoPayload.reply_markup = replyMarkup;
  const messagePayload = {
    chat_id: AI_PUBLISH_TELEGRAM_CHAT_ID,
    text: limitTelegramTextMessage(text, videoUrl),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (replyMarkup) messagePayload.reply_markup = replyMarkup;

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

function getTelegramPublishingQueueSummary({ limit = 100 } = {}) {
  const now = Date.now();
  const queue = listJobs({ employeeId: "video_operator", limit })
    .map((job) => {
      const pkg = job.output?.publishingPackage || {};
      const telegram = pkg.publicationStatus?.channels?.telegram || {};
      const plannedTime = new Date(telegram.plannedAt || 0).getTime();
      if (pkg.status !== "approved" || !Number.isFinite(plannedTime) || plannedTime <= 0 || hasTelegramPublicationEvidence(telegram)) return null;
      return {
        jobId: job.id,
        code: getPublishingContext(job)?.code || "",
        plannedAt: new Date(plannedTime).toISOString(),
        due: plannedTime <= now,
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.plannedAt).getTime() - new Date(b.plannedAt).getTime());

  return {
    planned: queue.length,
    due: queue.filter((item) => item.due).length,
    next: queue[0] || null,
  };
}

let telegramDueRunState = {
  running: false,
  lastRun: null,
};

async function runDueTelegramPublishing({ limit = 5, scanLimit = 100, actor = { id: "publishing_scheduler", role: "system" } } = {}) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  telegramDueRunState = {
    ...telegramDueRunState,
    running: true,
  };

  const batchLimit = Math.max(1, Math.min(Number(limit) || 5, 20));
  try {
    const dueJobs = getDueTelegramPublishingJobs({ limit: scanLimit }).slice(0, batchLimit);
    const serviceCache = new Map();
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

      const hydratedJob = await hydrateJobServiceFromDb(job, serviceCache);
      const result = await publishVideoToTelegram(hydratedJob, actor);
      results.push({
        jobId: job.id,
        code: getPublishingContext(hydratedJob)?.code || "",
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

    const summary = {
      success: true,
      checked: dueJobs.length,
      published,
      failed,
      results,
      actor: actor?.id || null,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
    };
    telegramDueRunState = {
      running: false,
      lastRun: {
        success: summary.success,
        checked: summary.checked,
        published: summary.published,
        failed: summary.failed,
        actor: summary.actor,
        startedAt: summary.startedAt,
        finishedAt: summary.finishedAt,
        durationMs: summary.durationMs,
        resultsPreview: results.slice(0, 5).map((item) => ({
          jobId: item.jobId,
          code: item.code,
          success: item.success,
          message: item.message,
          url: item.telegram?.url || "",
          deliveryMethod: item.telegram?.deliveryMethod || "",
        })),
        resultsOverflow: Math.max(0, results.length - 5),
      },
    };
    return summary;
  } catch (err) {
    telegramDueRunState = {
      running: false,
      lastRun: {
        success: false,
        checked: 0,
        published: 0,
        failed: 1,
        actor: actor?.id || null,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedMs,
        error: err?.message || String(err),
      },
    };
    throw err;
  }
}

router.use(authenticateToken);
router.use(requireAdmin);

router.get("/status", async (req, res) => {
  const videoSetting = await getAiVideoEnabledSetting();
  const videoProfile = await getAiVideoProfileSetting();
  const videoPresets = await getAiVideoPresetsSetting();
  const config = getAiConfig();
  const jobs = listJobs({ limit: 100 });
  const telegramQueue = getTelegramPublishingQueueSummary({ limit: 100 });
  const telegramChat = await getTelegramPublishChatHealth();
  const telegramReady = Boolean(telegramChat.ok);
  const schedulerDisabledByEnv = boolEnv("DISABLE_AI_PUBLISHING_SCHEDULER", false);
  const schedulerReadyReason = process.env.NODE_ENV === "test"
    ? "test_mode"
    : schedulerDisabledByEnv
      ? "disabled_by_env"
      : !telegramReady
        ? telegramChat.reason || "telegram_unreachable"
        : "ready";
  res.json({
    success: true,
    employees: listAiEmployees(),
    video: {
      enabled: config.video.enabled,
      runtimeControl: videoSetting,
      runtimeProfile: videoProfile,
      runtimePresets: videoPresets,
      heygenReady: config.video.heygen.ready,
      format: config.video.format,
      resolution: config.video.resolution,
      artifactStorage: getArtifactStorageStatus(),
    },
    publishing: {
      telegramReady,
      telegramChatConfigured: Boolean(AI_PUBLISH_TELEGRAM_CHAT_ID),
      telegramChat,
      schedulerEnabled: schedulerReadyReason === "ready",
      schedulerReadyReason,
      schedulerIntervalMs: Math.max(60000, intEnv("AI_PUBLISHING_SCHEDULER_INTERVAL_MS", 60000)),
      schedulerBatchLimit: Math.max(1, Math.min(intEnv("AI_PUBLISHING_SCHEDULER_BATCH_LIMIT", 5), 20)),
      telegramQueue,
      telegramDueRun: telegramDueRunState,
    },
    metrics: {
      jobs: jobs.length,
      activeJobs: jobs.filter((x) => ["created", "queued", "running", "processing"].includes(String(x.status || "").toLowerCase())).length,
    },
  });
});

router.patch("/settings/video", async (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  const videoSetting = await setAiVideoEnabledSetting(enabled, {
    id: req.user?.id || req.user?.userId || null,
  });
  const videoProfile = await getAiVideoProfileSetting();
  const videoPresets = await getAiVideoPresetsSetting();
  const config = getAiConfig();
  return res.json({
    success: true,
    video: {
      enabled: config.video.enabled,
      runtimeControl: videoSetting,
      runtimeProfile: videoProfile,
      runtimePresets: videoPresets,
      heygenReady: config.video.heygen.ready,
      format: config.video.format,
      resolution: config.video.resolution,
      artifactStorage: getArtifactStorageStatus(),
    },
  });
});

router.patch("/settings/video-profile", async (req, res) => {
  const avatarId = String(req.body?.avatarId || "").trim();
  const voiceId = String(req.body?.voiceId || "").trim();
  const engine = String(req.body?.engine || "").trim();
  const voiceSpeed = req.body?.voiceSpeed;
  const expressiveness = String(req.body?.expressiveness || "").trim();
  const aspectRatio = String(req.body?.aspectRatio || "").trim();
  const resolution = String(req.body?.resolution || "").trim();
  const videoProfile = await setAiVideoProfileSetting(
    { avatarId, voiceId, engine, voiceSpeed, expressiveness, aspectRatio, resolution },
    { id: req.user?.id || req.user?.userId || null }
  );
  const videoSetting = await getAiVideoEnabledSetting();
  const config = getAiConfig();
  return res.json({
    success: true,
    video: {
      enabled: config.video.enabled,
      runtimeControl: videoSetting,
      runtimeProfile: videoProfile,
      heygenReady: config.video.heygen.ready,
      format: config.video.format,
      resolution: config.video.resolution,
      artifactStorage: getArtifactStorageStatus(),
    },
  });
});

router.patch("/settings/video-presets", async (req, res) => {
  const videoPresets = await setAiVideoPresetsSetting(
    {
      avatars: req.body?.avatars,
      voices: req.body?.voices,
    },
    { id: req.user?.id || req.user?.userId || null }
  );
  const videoSetting = await getAiVideoEnabledSetting();
  const videoProfile = await getAiVideoProfileSetting();
  const config = getAiConfig();
  return res.json({
    success: true,
    video: {
      enabled: config.video.enabled,
      runtimeControl: videoSetting,
      runtimeProfile: videoProfile,
      runtimePresets: videoPresets,
      heygenReady: config.video.heygen.ready,
      format: config.video.format,
      resolution: config.video.resolution,
      artifactStorage: getArtifactStorageStatus(),
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
  if (code && /^[RAHE]\s*\d+/i.test(code)) {
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

router.get("/video-operator/services/search", async (req, res) => {
  const type = String(req.query.type || "all").toLowerCase();
  const categoryFilters = {
    tour: ["refused_tour", "author_tour"],
    flight: ["refused_flight"],
    hotel: ["refused_hotel"],
    event: ["refused_event_ticket", "refused_ticket"],
  }[type] || [];
  try {
    const services = await searchRefusedServices({
      q: req.query.q || "",
      limit: req.query.limit || 10,
      categoryFilters,
    });
    return res.json({
      success: true,
      type,
      services: services.map((service) => {
        const ctx = service.videoContext || {};
        const price = getAiPublicPrice(service, ctx);
        const currency = getAiPublicCurrency(service, ctx);
        return {
          id: service.id,
          code: service.code,
          taskCode: service.taskCode || ctx.code || service.code,
          displayCode: service.displayCode || service.taskCode || ctx.code || service.code,
          category: service.category,
          categoryLabel: service.categoryLabel,
          title: ctx.title || service.title || "",
          destination: ctx.destination || "",
          fromCity: ctx.fromCity || "",
          dates: ctx.dates || "",
          price,
          currency,
          supplier: ctx.supplier || service.provider?.name || "",
          status: service.status || "",
        };
      }),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err?.message || "Service search failed" });
  }
});

router.post("/video-operator/jobs/:id/heygen/start", async (req, res) => {
  await getAiVideoEnabledSetting();
  await getAiVideoProfileSetting();
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

router.patch("/video-operator/jobs/:id/script", (req, res) => {
  const job = getJob(req.params.id);
  if (!job || job.employeeId !== "video_operator") {
    return res.status(404).json({ success: false, message: "AI job not found" });
  }
  const output = job.output || {};
  if (output.heygen?.videoId) {
    return res.status(409).json({ success: false, message: "HeyGen already started. Script is locked." });
  }
  const script = String(req.body?.script || "").trim();
  const motionPrompt = String(req.body?.motionPrompt ?? output.motionPrompt ?? "").trim();
  if (script.length < 20) {
    return res.status(400).json({ success: false, message: "Script is too short" });
  }
  if (script.length > 6000) {
    return res.status(400).json({ success: false, message: "Script is too long" });
  }
  if (motionPrompt.length > 4000) {
    return res.status(400).json({ success: false, message: "Motion prompt is too long" });
  }
  const actor = { id: req.user?.id || req.user?.userId || null, role: req.user?.role || req.user?.roles || null };
  const nextOutput = {
    ...output,
    script,
    motionPrompt,
    scriptReview: output.scriptReview
      ? { ...output.scriptReview, manualEdited: true, updatedAt: new Date().toISOString() }
      : { status: "ready", manualEdited: true, updatedAt: new Date().toISOString() },
    scriptEditedAt: new Date().toISOString(),
    motionPromptEditedAt: motionPrompt !== String(output.motionPrompt || "").trim() ? new Date().toISOString() : output.motionPromptEditedAt,
    scriptEditedBy: actor,
    nextStep: "Сценарий сохранён. Проверь текст и отправь в HeyGen вручную.",
  };
  const nextJob = updateJob(job.id, { status: "script_ready", output: nextOutput });
  addEvent(job.id, {
    step: "script",
    type: "tool_result",
    tool: "ScriptEditor",
    message: "Оператор вручную отредактировал сценарий перед HeyGen.",
    meta: { actor },
  });
  return res.json({ success: true, job: nextJob, output: nextJob.output });
});

router.get("/video-operator/jobs", async (req, res) => {
  const jobs = await listVideoOperatorJobs({ limit: req.query.limit || 30, repair: true });
  res.json({ success: true, jobs });
});

router.get("/video-operator/videos", async (req, res) => {
  const jobs = await listVideoOperatorJobs({ limit: req.query.limit || 100, repair: true });
  const serviceCache = new Map();
  const hydratedJobs = await Promise.all(jobs.map((job) => hydrateJobServiceFromDb(job, serviceCache)));
  const videos = hydratedJobs
    .map((job) => {
      const output = job.output || {};
      const service = output.service || {};
      const ctx = service.videoContext || {};
      const publicCtx = buildPublishingContextForJob(job);
      const heygen = output.heygen || {};
      const artifact = heygen.artifact || {};
      const mediaUrl = artifact.url || heygen.videoUrl || "";

      if (!mediaUrl) return null;

      const publishingPackage = buildPublishingPackageForJob(job);

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
        price: publicCtx.price || "",
        currency: publicCtx.currency || "USD",
        heygenStatus: heygen.status || "",
        heygenVideoId: heygen.videoId || "",
        heygenUrl: heygen.videoUrl || "",
        mediaUrl,
        artifactUrl: artifact.url || "",
        storageProvider: artifact.provider || "",
        actionButtons: buildTelegramVideoReplyMarkup(job)?.inline_keyboard?.flat().map((button) => ({
          label: button.text,
          url: button.url,
        })) || [],
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
  const current = buildPublishingPackageForJob(job);
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
  const hydratedJob = await hydrateJobServiceFromDb(job);
  const result = await publishVideoToTelegram(hydratedJob, {
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
