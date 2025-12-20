// backend/telegram/bot.js
require("dotenv").config();

const { Telegraf, session } = require("telegraf");
const axiosBase = require("axios");
const {
  parseDateFlexible,
  isServiceActual,
  normalizeDateTimeInput: normalizeDateTimeInputHelper,
} = require("./helpers/serviceActual");
const { buildSvcActualKeyboard } = require("./keyboards/serviceActual");

// ==== CONFIG ====

const CLIENT_TOKEN = process.env.TELEGRAM_CLIENT_BOT_TOKEN || "";
if (!CLIENT_TOKEN) {
  throw new Error(
    "TELEGRAM_CLIENT_BOT_TOKEN is required for backend/telegram/bot.js"
  );
}
const BOT_TOKEN = CLIENT_TOKEN;

// Username бота (без @). Нужен для стабильных ссылок, т.к. ctx.me не всегда доступен в inline.
// Пример: TELEGRAM_BOT_USERNAME=Travella2025Bot
const BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME || "")
  .replace(/^@/, "")
  .trim();

// Шаблон ссылки на карточку услуги на сайте.
// По умолчанию оставляем как было: https://travella.uz?service=123
// Можно переопределить, например:
// SERVICE_URL_TEMPLATE=https://travella.uz/marketplace?service={id}
// SERVICE_URL_TEMPLATE=https://travella.uz/service/{id}
const SERVICE_URL_TEMPLATE = (
  process.env.SERVICE_URL_TEMPLATE || "{SITE_URL}?service={id}"
).trim();

// Публичный URL Travella для кнопок "Подробнее"
const SITE_URL = (
  process.env.SITE_PUBLIC_URL ||
  process.env.SITE_URL ||
  "https://travella.uz"
).replace(/\/+$/, "");

// ⚠️ ВАЖНО:
// Telegram для inline типа "photo" требует реальный публичный HTTPS URL картинки.
// Если подставить несуществующий плейсхолдер (404) — Telegram выкинет результаты и будет "Не найдено".
// Поэтому плейсхолдер НЕ форсим — лучше вернуть inline type "article".
const INLINE_PLACEHOLDER_THUMB = ""; // не используем как обязательный fallback

// Кому отправлять "быстрые запросы" из бота (чат менеджера)
const MANAGER_CHAT_ID = process.env.TELEGRAM_MANAGER_CHAT_ID || "";

// Валюта для отображения цен в боте
const PRICE_CURRENCY = (process.env.PRICE_CURRENCY || "USD").trim();

// Для /tour_123 и inline-поиска — с какими категориями работаем
const REFUSED_CATEGORIES = [
  "refused_tour",
  "refused_hotel",
  "refused_flight",
  "refused_ticket",
];

const API_BASE = (
  process.env.API_BASE_URL ||
  process.env.SITE_API_URL ||
  "http://localhost:8080"
).replace(/\/+$/, "");

// ВАЖНО: Telegram скачивает thumb_url/photo_url снаружи.
// Поэтому для картинок нужен публичный URL (https://...).
const API_PUBLIC_BASE = (
  process.env.API_PUBLIC_URL ||
  process.env.SITE_API_PUBLIC_URL ||
  process.env.API_BASE_PUBLIC_URL ||
  process.env.SITE_API_URL ||
  SITE_URL // ✅ fallback: если API проксируется через travella.uz
).replace(/\/+$/, "");

console.log("=== BOT.JS LOADED ===");
console.log("[tg-bot] Using TELEGRAM_CLIENT_BOT_TOKEN (polling)");
console.log("[tg-bot] API_BASE =", API_BASE);
console.log("[tg-bot] API_PUBLIC_BASE =", API_PUBLIC_BASE || "(not set)");
console.log("[tg-bot] SITE_URL =", SITE_URL);
console.log("[tg-bot] BOT_USERNAME =", BOT_USERNAME || "(not set)");
console.log("[tg-bot] SERVICE_URL_TEMPLATE =", SERVICE_URL_TEMPLATE);
console.log(
  "[tg-bot] MANAGER_CHAT_ID =",
  MANAGER_CHAT_ID ? MANAGER_CHAT_ID : "(not set)"
);
console.log("[tg-bot] PRICE_CURRENCY =", PRICE_CURRENCY);

// axios instance
const axios = axiosBase.create({
  baseURL: API_BASE,
  timeout: 10000,
});

// inline cache
const INLINE_CACHE_TTL_MS = 8000;
const inlineCache = new Map();
function cacheGet(key) {
  const v = inlineCache.get(key);
  if (!v) return null;
  if (Date.now() - v.ts > INLINE_CACHE_TTL_MS) {
    inlineCache.delete(key);
    return null;
  }
  return v.data;
}
function cacheSet(key, data) {
  inlineCache.set(key, { ts: Date.now(), data });
}

// ==== INIT BOT ====

const bot = new Telegraf(BOT_TOKEN);

// ✅ Сессия всегда по пользователю (важно для inline/групп -> ЛС)
bot.use(
  session({
    getSessionKey: (ctx) => String(ctx?.from?.id || ctx?.chat?.id || "anon"),
  })
);

/* ===================== TG FILE LINK CACHE ===================== */
// file_id -> { url, ts }
const tgFileLinkCache = new Map();
const TG_FILE_LINK_TTL = 20 * 60 * 1000; // 20 минут

async function getPublicThumbUrlFromTgFile(botInstance, fileId) {
  const cached = tgFileLinkCache.get(fileId);
  if (cached && Date.now() - cached.ts < TG_FILE_LINK_TTL) {
    return cached.url;
  }
  const link = await botInstance.telegram.getFileLink(fileId);
  const url = String(link);
  tgFileLinkCache.set(fileId, { url, ts: Date.now() });
  return url;
}

/* ===================== HELPERS ===================== */

function truncate(str, max = 64) {
  const s = String(str || "");
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trim() + "…";
}

// экранирование текста для Telegram Markdown (V1)
function escapeMarkdown(text) {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/_/g, "\\_")
    .replace(/\*/g, "\\*")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/`/g, "\\`");
}

// ✅ Бережная нормализация заголовка:
// - если слово капсом и длинее 3 букв → делаем "С Заглавной"
// - короткие аббревиатуры (<=3) оставляем как есть (ОАЭ, UAE и т.п.)
function normalizeTitleSoft(str) {
  if (!str) return str;
  const s = String(str).trim();
  if (!s) return s;
  if (/[a-zа-яё]/.test(s)) return s;

  return s.replace(/[A-Za-zА-ЯЁа-яё]+/g, (w) => {
    if (w.length <= 3) return w;
    if (w === w.toUpperCase()) {
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }
    return w;
  });
}

// ✅ Санитизация странных разделителей (’n / 'n / &n) → стрелка
function normalizeWeirdSeparator(s) {
  if (!s) return s;
  return String(s)
    .replace(/\s*['’]n\s*/gi, " → ")
    .replace(/\s*&n\s*/gi, " → ")
    .replace(/\s+→\s+/g, " → ")
    .trim();
}

function formatPriceWithCurrency(value) {
  if (value === null || value === undefined) return null;
  const v = String(value).trim();
  if (!v) return null;

  // если уже есть валюта — не дублируем
  if (/\b(usd|u\.?s\.?d\.?|eur|rub|uzs|\$|€|₽|сум)\b/i.test(v)) return v;
  return `${v} ${PRICE_CURRENCY}`;
}

function getMainMenuKeyboard(role) {
  if (role === "provider") {
    return {
      reply_markup: {
        keyboard: [
          [{ text: "🔍 Найти услугу" }, { text: "🧳 Мои услуги" }],
          [{ text: "📄 Бронирования" }, { text: "📨 Заявки" }],
          [{ text: "👤 Профиль" }],
        ],
        resize_keyboard: true,
      },
    };
  }

  return {
    reply_markup: {
      keyboard: [
        [{ text: "🔍 Найти услугу" }, { text: "❤️ Избранное" }],
        [{ text: "📄 Бронирования" }, { text: "📨 Заявки" }],
        [{ text: "👤 Профиль" }, { text: "🏢 Стать поставщиком" }],
      ],
      resize_keyboard: true,
    },
  };
}

async function askRole(ctx) {
  await ctx.reply(
    "👋 Добро пожаловать в *Travella*!\n\n" + "Выберите роль, чтобы продолжить 👇",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "👤 Я клиент", callback_data: "role:client" }],
          [{ text: "🏢 Я поставщик", callback_data: "role:provider" }],
        ],
      },
    }
  );
}

// ✅ ВАЖНО: для callback/inline в группах ctx.chat.id = id группы.
// Для идентификации пользователя (поставщик/клиент) всегда используем ctx.from.id.
function getActorId(ctx) {
  return ctx?.from?.id || ctx?.chat?.id || null;
}

async function safeReply(ctx, text, extra) {
  if (ctx.chat?.id) return ctx.reply(text, extra);
  const uid = ctx.from?.id;
  if (!uid) return;
  return bot.telegram.sendMessage(uid, text, extra);
}

function logUpdate(ctx, label = "update") {
  try {
    const fromId = ctx.from?.id;
    const username = ctx.from?.username;
    const type = ctx.updateType;
    const subTypes = ctx.updateSubTypes;
    console.log("[tg-bot]", label, { type, subTypes, fromId, username });
  } catch (_) {}
}

// Маппинг подписей для категорий
const CATEGORY_LABELS = {
  refused_tour: "Отказной тур",
  refused_hotel: "Отказной отель",
  refused_flight: "Отказной авиабилет",
  refused_ticket: "Отказной билет",
};
// Emoji по категориям (для заголовков/inline)
const CATEGORY_EMOJI = {
  refused_tour: "📍",
  refused_hotel: "🏨",
  refused_flight: "✈️",
  refused_ticket: "🎫",
};

// пытаемся вытащить звёзды из roomCategory / accommodationCategory (например "5*", "5 *", "⭐️5")
function extractStars(details) {
  const d = details || {};
  const raw = String(d.accommodationCategory || d.roomCategory || "").trim();
  if (!raw) return null;

  const m = raw.match(/([1-7])\s*\*|⭐\s*([1-7])/);
  const stars = m ? Number(m[1] || m[2]) : null;
  if (!stars) return null;

  return `⭐️ ${stars}*`;
}

function prettyDateTime(value) {
  if (!value) return "";
  const s = String(value).trim();
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?$/
  );
  if (!m) return s;
  const [, y, mm, dd, hh, mi] = m;
  if (hh && mi) return `${dd}.${mm}.${y} ${hh}:${mi}`;
  return `${dd}.${mm}.${y}`;
}

// безопасный парсинг дат для сортировки
function parseDateSafe(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;

  let d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;

  // пробуем формат 2026.01.02
  const s2 = s.replace(/\./g, "-");
  d = new Date(s2);
  if (!Number.isNaN(d.getTime())) return d;

  return null;
}

// достаём дату вылета/старта тура из svc.details для сортировки
function getStartDateForSort(svc) {
  let d = svc.details || {};
  if (typeof d === "string") {
    try {
      d = JSON.parse(d);
    } catch {
      d = {};
    }
  }
  const raw =
    d.departureFlightDate ||
    d.startDate ||
    d.startFlightDate ||
    d.start_flight_date;
  return parseDateSafe(raw);
}

function parseDetailsAny(details) {
  if (!details) return {};
  if (typeof details === "object") return details;
  if (typeof details === "string") {
    try {
      return JSON.parse(details);
    } catch {
      return {};
    }
  }
  return {};
}

// gross = net + % (по умолчанию 10%)
const DEFAULT_GROSS_MARKUP_PERCENT = Number(
  process.env.GROSS_MARKUP_PERCENT || "10"
);
function calcGrossFromNet(netNum) {
  const p = Number.isFinite(DEFAULT_GROSS_MARKUP_PERCENT)
    ? DEFAULT_GROSS_MARKUP_PERCENT
    : 10;
  return Math.round(netNum * (1 + p / 100));
}

/* ===================== DATES ===================== */

// нормализуем дату: 2025-12-15 / 2025.12.15 / 2025/12/15 -> 2025-12-15
function normalizeDateInput(raw) {
  if (!raw) return null;
  const txt = String(raw).trim();
  if (/^(нет|пропустить|skip|-)\s*$/i.test(txt)) return null;

  const m = txt.match(/^(\d{4})[.\-/](\d{2})[.\-/](\d{2})$/);
  if (!m) return null;

  const [, y, mm, dd] = m;
  return `${y}-${mm}-${dd}`;
}

// ✅ Дата+время для "Актуально до"
function normalizeDateTimeInput(raw) {
  return normalizeDateTimeInputHelper(raw);
}

function isPastDateTime(value) {
  const dt = parseDateFlexible(value);
  if (!dt) return false;
  return dt.getTime() < Date.now();
}

function dateAtLocalMidnight(ymd) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d, 0, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function isPastYMD(ymd) {
  const dt = dateAtLocalMidnight(ymd);
  if (!dt) return false;
  const today = new Date();
  const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return dt.getTime() < today0.getTime();
}

function isBeforeYMD(a, b) {
  const da = dateAtLocalMidnight(a);
  const db = dateAtLocalMidnight(b);
  if (!da || !db) return false;
  return da.getTime() < db.getTime();
}

function getExpiryBadge(detailsRaw, svc) {
  let d = detailsRaw || {};
  if (typeof d === "string") {
    try {
      d = JSON.parse(d);
    } catch {
      d = {};
    }
  }

  const expirationRaw = d.expiration || svc?.expiration || null;
  if (!expirationRaw) return null;

  const exp = parseDateFlexible(expirationRaw);
  if (!exp) return null;

  const today = new Date();
  const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const tomorrow0 = new Date(today0.getTime() + 24 * 60 * 60 * 1000);
  const exp0 = new Date(exp.getFullYear(), exp.getMonth(), exp.getDate());

  if (exp0.getTime() === today0.getTime()) return "⏳ истекает сегодня";
  if (exp0.getTime() === tomorrow0.getTime()) return "⏳ истекает завтра";
  return null;
}

async function hideInlineButtons(ctx) {
  try {
    await ctx.editMessageReplyMarkup(undefined);
  } catch (_) {}
}

/* ===================== IMAGES ===================== */
/**
 * В services.images могут быть:
 * - base64 data:image...
 * - http(s) URL
 * - относительный /path
 * - "tg:<file_id>" (если фото добавлено через Telegram)
 */
function getFirstImageUrl(svc) {
  // ✅ 0) если API уже отдал готовый публичный URL — используем его
  if (svc?.imageUrl && typeof svc.imageUrl === "string") {
    const u = svc.imageUrl.trim();
    if (u) return u;
  }

  let arr = svc?.images ?? null;

  // ✅ 1) если images строка — пробуем JSON, иначе считаем единичным значением
  if (typeof arr === "string") {
    try {
      arr = JSON.parse(arr);
    } catch {
      arr = [arr];
    }
  }

  // ✅ 2) если images объект (например {}), превращаем в пустой массив
  if (!Array.isArray(arr)) arr = [];

  // ✅ 3) fallback: фото, загруженное через Telegram
  if (!arr.length) {
    let d = svc.details || {};
    if (typeof d === "string") {
      try {
        d = JSON.parse(d);
      } catch {
        d = {};
      }
    }
    const fid = (d.telegramPhotoFileId || "").trim();
    if (fid) return `tgfile:${fid}`;
    return null;
  }

  let v = arr[0];
  if (v && typeof v === "object") {
    v = v.url || v.src || v.path || v.location || v.href || null;
  }
  if (typeof v !== "string") return null;

  v = v.trim();
  if (!v) return null;

  if (v.startsWith("tg:")) {
    const fileId = v.slice(3).trim();
    if (!fileId) return null;
    return `tgfile:${fileId}`;
  }

  // ✅ base64 -> через прокси (API_PUBLIC_BASE теперь всегда не пустой)
  if (v.startsWith("data:image")) {
    return `${API_PUBLIC_BASE}/api/telegram/service-image/${svc.id}`;
  }

  if (v.startsWith("http://") || v.startsWith("https://")) return v;
  if (v.startsWith("/")) return SITE_URL + v;

  return null;
}

// выбираем цену в зависимости от роли
function pickPrice(details, svc, role) {
  const d = details || {};
  if (role === "provider") {
    return d.netPrice ?? d.price ?? d.grossPrice ?? svc.price ?? null;
  }
  return d.grossPrice ?? d.price ?? d.netPrice ?? svc.price ?? null;
}

function buildServiceUrl(serviceId) {
  const tpl = SERVICE_URL_TEMPLATE || "{SITE_URL}?service={id}";
  return tpl
    .replace(/\{SITE_URL\}/g, SITE_URL)
    .replace(/\{id\}/g, String(serviceId));
}

function buildBotStartUrl() {
  return BOT_USERNAME ? `https://t.me/${BOT_USERNAME}?start=start` : SITE_URL;
}

/**
 * Преобразуем услугу в красивый текст + url картинки + url на сайт
 * role: "client" | "provider"
 */
function buildServiceMessage(svc, category, role = "client") {
  let d = svc.details || {};
  if (typeof d === "string") {
    try {
      d = JSON.parse(d);
    } catch {
      d = {};
    }
  }

  const titleRaw = svc.title || CATEGORY_LABELS[category] || "Услуга";
  const titlePretty = normalizeTitleSoft(titleRaw);

  const emoji = CATEGORY_EMOJI[category] || "";
  const stars = extractStars(d);
  const titleDecor = [emoji, titlePretty, stars].filter(Boolean).join(" ");
  const title = escapeMarkdown(titleDecor);

  // Направление
  const directionParts = [];
  const from = d.directionFrom ? normalizeWeirdSeparator(d.directionFrom) : null;
  const to = d.directionTo ? normalizeWeirdSeparator(d.directionTo) : null;
  const country = d.directionCountry
    ? normalizeWeirdSeparator(d.directionCountry)
    : null;

  if (from && to)
    directionParts.push(
      `${escapeMarkdown(from)} → ${escapeMarkdown(to)}`
    );
  else if (from) directionParts.push(escapeMarkdown(from));
  else if (to) directionParts.push(escapeMarkdown(to));
  if (country) directionParts.push(escapeMarkdown(country));

  const direction = directionParts.length ? directionParts.join(" · ") : null;

  const startRaw =
    d.departureFlightDate || d.startDate || d.startFlightDate || null;
  const endRaw = d.returnFlightDate || d.endDate || d.endFlightDate || null;

  const startClean = startRaw ? normalizeWeirdSeparator(startRaw) : null;
  const endClean = endRaw ? normalizeWeirdSeparator(endRaw) : null;

  let dates = null;
  if (startClean && endClean && String(startClean) !== String(endClean)) {
    dates = `Даты: ${escapeMarkdown(startClean)} → ${escapeMarkdown(endClean)}`;
  } else if (startClean) {
    dates = `Дата: ${escapeMarkdown(startClean)}`;
  }

  const hotel = d.hotel || d.hotelName || null;
  const hotelSafe = hotel ? escapeMarkdown(hotel) : null;

  const accommodation = d.accommodation || null;
  const accommodationSafe = accommodation ? escapeMarkdown(accommodation) : null;

  const priceRaw = pickPrice(d, svc, role);
  const priceWithCur = formatPriceWithCurrency(priceRaw);
  const price = priceWithCur != null ? escapeMarkdown(priceWithCur) : null;
  const priceLabel = role === "provider" ? "Цена (netto)" : "Цена";

  const providerNameRaw = svc.provider_name || "Поставщик Travella";
  const providerName = escapeMarkdown(providerNameRaw);
  const providerTelegram = svc.provider_telegram || null;

  const providerId =
    svc.provider_id || svc.providerId || svc.provider?.id || null;
  const providerProfileUrl = providerId
    ? `${SITE_URL}/profile/provider/${providerId}`
    : null;

  const providerLine = providerProfileUrl
    ? `Поставщик: [${providerName}](${providerProfileUrl})`
    : `Поставщик: ${providerName}`;

  let telegramLine = null;
  if (providerTelegram) {
    let username = String(providerTelegram).trim();
    username = username.replace(/^@/, "");
    username = username.replace(/^https?:\/\/t\.me\//i, "");
    const mdUsername = escapeMarkdown(username);
    telegramLine = `Telegram: @${mdUsername}`;
  }

  const serviceUrl = buildServiceUrl(svc.id);

  const lines = [];
  lines.push(`*${title}*`);
  if (direction) lines.push(direction);
  if (dates) lines.push(dates);
  if (hotelSafe) lines.push(`Отель: ${hotelSafe}`);
  if (accommodationSafe) lines.push(`Размещение: ${accommodationSafe}`);
  if (price) lines.push(`${priceLabel}: *${price}*`);

  const badge = getExpiryBadge(d, svc);
  if (badge) lines.push(escapeMarkdown(badge));

  lines.push(providerLine);
  if (telegramLine) lines.push(telegramLine);

  lines.push("");
  lines.push(`Подробнее и бронирование: ${serviceUrl}`);

  const text = lines.join("\n");
  const photoUrl = getFirstImageUrl(svc);

  return { text, photoUrl, serviceUrl };
}

function buildInlineDescription(svc, category, roleForInline) {
  let d = svc.details || {};
  if (typeof d === "string") {
    try {
      d = JSON.parse(d);
    } catch {
      d = {};
    }
  }

  const parts = [];

  const from = d.directionFrom ? normalizeWeirdSeparator(d.directionFrom) : null;
  const to = d.directionTo ? normalizeWeirdSeparator(d.directionTo) : null;
  const country = d.directionCountry
    ? normalizeWeirdSeparator(d.directionCountry)
    : null;

  if (from && to) parts.push(`${from} → ${to}`);
  else if (to) parts.push(to);
  else if (from) parts.push(from);

  if (country) parts.push(country);

  const startRaw =
    d.departureFlightDate || d.startDate || d.startFlightDate || null;
  const endRaw = d.returnFlightDate || d.endDate || d.endFlightDate || null;

  if (startRaw && endRaw && String(startRaw) !== String(endRaw)) {
    parts.push(`${prettyDateTime(startRaw)}–${prettyDateTime(endRaw)}`);
  } else if (startRaw) {
    parts.push(prettyDateTime(startRaw));
  }

  const priceRaw = pickPrice(d, svc, roleForInline);
  const priceWithCur = formatPriceWithCurrency(priceRaw);
  if (priceWithCur) parts.push(priceWithCur);

  const label = CATEGORY_LABELS[category] || category || "Услуга";
  const s = `${label}: ${parts.filter(Boolean).join(" · ")}`.trim();
  return truncate(s, 96);
}

/* ===================== ROLE RESOLUTION ===================== */

async function ensureProviderRole(ctx) {
  if (ctx.session?.role === "provider") return "provider";

  const actorId = getActorId(ctx);
  if (!actorId) return ctx.session?.role || null;

  try {
    const resProv = await axios.get(
      `/api/telegram/profile/provider/${actorId}`
    );
    if (resProv.data && resProv.data.success) {
      if (!ctx.session) ctx.session = {};
      ctx.session.role = "provider";
      ctx.session.linked = true;
      return "provider";
    }
  } catch (e) {
    if (e?.response?.status !== 404) {
      console.log(
        "[tg-bot] ensureProviderRole error:",
        e?.response?.data || e.message || e
      );
    }
  }
  return ctx.session?.role || null;
}

async function ensureClientRole(ctx) {
  if (ctx.session?.role === "client") return "client";

  const actorId = getActorId(ctx);
  if (!actorId) return ctx.session?.role || null;

  try {
    const resClient = await axios.get(`/api/telegram/profile/client/${actorId}`);
    if (resClient.data && resClient.data.success) {
      if (!ctx.session) ctx.session = {};
      ctx.session.role = "client";
      ctx.session.linked = true;
      return "client";
    }
  } catch (e) {
    if (e?.response?.status !== 404) {
      console.log(
        "[tg-bot] ensureClientRole error:",
        e?.response?.data || e.message || e
      );
    }
  }
  return ctx.session?.role || null;
}

// ✅ для inline_query (там нет ctx.chat, есть ctx.from.id)
async function resolveRoleByUserId(userId, ctx) {
  try {
    const resProv = await axios.get(`/api/telegram/profile/provider/${userId}`);
    if (resProv.data && resProv.data.success) {
      if (ctx && ctx.session) {
        ctx.session.role = "provider";
        ctx.session.linked = true;
      }
      return "provider";
    }
  } catch (e) {
    if (e?.response?.status !== 404) {
      console.log(
        "[tg-bot] resolveRoleByUserId provider error:",
        e?.response?.data || e.message || e
      );
    }
  }

  try {
    const resClient = await axios.get(`/api/telegram/profile/client/${userId}`);
    if (resClient.data && resClient.data.success) {
      if (ctx && ctx.session) {
        ctx.session.role = "client";
        ctx.session.linked = true;
      }
      return "client";
    }
  } catch (e) {
    if (e?.response?.status !== 404) {
      console.log(
        "[tg-bot] resolveRoleByUserId client error:",
        e?.response?.data || e.message || e
      );
    }
  }

  return null;
}

/* ===================== WIZARD HELPERS (create refused_tour / refused_hotel) ===================== */

function resetServiceWizard(ctx) {
  if (!ctx.session) return;
  ctx.session.state = null;
  ctx.session.serviceDraft = null;
  ctx.session.wizardStack = null;
}

function parseYesNo(text) {
  const t = text.trim().toLowerCase();
  if (["да", "ha", "xa", "yes", "y"].includes(t)) return true;
  if (["нет", "yo'q", "yoq", "yo‘q", "yok", "no", "n"].includes(t)) return false;
  return null;
}

function normalizePrice(text) {
  const cleaned = String(text || "")
    .replace(/[^0-9.,]/g, "")
    .replace(",", ".");
  const n = parseFloat(cleaned);
  if (Number.isNaN(n)) return null;
  return n;
}

function parsePaxTriple(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const parts = t.split(/[\/,\s]+/).filter(Boolean);
  if (parts.length !== 3) return null;

  const [a, c, i] = parts.map((x) => Number(String(x).replace(/[^\d]/g, "")));
  if ([a, c, i].some((n) => Number.isNaN(n) || n < 0)) return null;

  return { adt: a, chd: c, inf: i };
}

// "20–27.12" или "28.12–03.01"
function shortDM(ymd) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${m[3]}.${m[2]}`;
}
function shortDateRange(startYmd, endYmd) {
  const s = shortDM(startYmd);
  const e = shortDM(endYmd);
  if (!s && !e) return "";
  if (s && e && s !== e) {
    const sm = s.slice(3);
    const em = e.slice(3);
    const sd = s.slice(0, 2);
    const ed = e.slice(0, 2);
    if (sm === em) return `${sd}–${ed}.${sm}`;
    return `${s}–${e}`;
  }
  return s || e || "";
}

// авто-заголовок для refused_tour (если title пустой)
function autoTitleRefusedTour(draft) {
  const from = (draft.fromCity || "").trim();
  const to = (draft.toCity || "").trim();
  const range = shortDateRange(draft.startDate, draft.endDate);
  const dir = from && to ? `${from} → ${to}` : to || from || "";
  const parts = [];
  if (dir) parts.push(dir);
  if (range) parts.push(range);
  if (!parts.length) return "Отказной тур";
  return parts.join(" · ");
}

// авто-заголовок для refused_hotel (если title пустой)
function autoTitleRefusedHotel(draft) {
  const hotel = (draft.hotel || "Отель").trim();
  const city = (draft.toCity || "").trim();
  const range = shortDateRange(draft.startDate, draft.endDate);
  const parts = [hotel];
  if (city) parts.push(city);
  if (range) parts.push(range);
  return parts.join(" · ");
}

// собираем details
function buildDetailsForRefusedTour(draft, priceNum) {
  return {
    title: draft.title || "",
    directionCountry: draft.country || "",
    directionFrom: draft.fromCity || "",
    directionTo: draft.toCity || "",
    startDate: draft.startDate || "",
    endDate: draft.endDate || "",
    departureFlightDate: draft.departureFlightDate || "",
    returnFlightDate: draft.returnFlightDate || "",
    flightDetails: draft.flightDetails || "",
    hotel: draft.hotel || "",
    accommodation: draft.accommodation || "",
    netPrice: priceNum,
    grossPrice: typeof draft.grossPriceNum === "number" ? draft.grossPriceNum : null,
    expiration: draft.expiration || null,
    isActive: true,
    telegramPhotoFileId: draft.telegramPhotoFileId || null,
  };
}

function buildDetailsForRefusedHotel(draft, netPriceNum) {
  return {
    title: draft.title || "",
    directionCountry: draft.country || "",
    directionTo: draft.toCity || "",
    hotel: draft.hotel || "",
    startDate: draft.startDate || "",
    endDate: draft.endDate || "",
    accommodationCategory: draft.roomCategory || "",
    accommodation: draft.accommodation || "",
    food: draft.food || "",
    halal: typeof draft.halal === "boolean" ? draft.halal : false,
    transfer: draft.transfer || "",
    changeable: typeof draft.changeable === "boolean" ? draft.changeable : false,

    accommodationADT: typeof draft.adt === "number" ? draft.adt : 0,
    accommodationCHD: typeof draft.chd === "number" ? draft.chd : 0,
    accommodationINF: typeof draft.inf === "number" ? draft.inf : 0,

    netPrice: netPriceNum,
    grossPrice: typeof draft.grossPriceNum === "number" ? draft.grossPriceNum : null,
    expiration: draft.expiration || null,
    isActive: true,
    telegramPhotoFileId: draft.telegramPhotoFileId || null,
  };
}

function wizNavKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "⬅️ Назад", callback_data: "svc_wiz:back" },
          { text: "❌ Отмена", callback_data: "svc_wiz:cancel" },
        ],
      ],
    },
  };
}

function pushWizardState(ctx, prevState) {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.wizardStack) ctx.session.wizardStack = [];
  if (
    prevState &&
    (String(prevState).startsWith("svc_create_") ||
      String(prevState).startsWith("svc_hotel_"))
  ) {
    ctx.session.wizardStack.push(prevState);
  }
}

async function promptWizardState(ctx, state) {
  switch (state) {
    case "svc_create_title":
      await ctx.reply(
        "🆕 Создаём *Отказной тур*.\n\n" +
          "✍️ Напишите *название тура* (как оно будет отображаться в Travella).",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_create_tour_country":
      await ctx.reply("🌍 Укажите *страну направления* (например: Таиланд):", {
        parse_mode: "Markdown",
        ...wizNavKeyboard(),
      });
      return;

    case "svc_create_tour_from":
      await ctx.reply("🛫 Укажите *город вылета* (например: Ташкент):", {
        parse_mode: "Markdown",
        ...wizNavKeyboard(),
      });
      return;

    case "svc_create_tour_to":
      await ctx.reply("🛬 Укажите *город прибытия* (например: Бангкок):", {
        parse_mode: "Markdown",
        ...wizNavKeyboard(),
      });
      return;

    case "svc_create_tour_start":
      await ctx.reply(
        "📅 Укажите *дату начала тура*\n" +
          "✅ Формат: *YYYY-MM-DD* или *YYYY.MM.DD*\n" +
          "Пример: *2025-12-09*",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_create_tour_end":
      await ctx.reply(
        "📅 Укажите *дату окончания тура*\n" +
          "✅ Формат: *YYYY-MM-DD* или *YYYY.MM.DD*\n" +
          "Пример: *2025-12-15*",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_create_flight_departure":
      await ctx.reply(
        "🛫 Укажите *дату рейса вылета* (опционально)\n" +
          "✅ Формат: *YYYY-MM-DD* или *YYYY.MM.DD*\n" +
          "Если не нужно — напишите *пропустить*.",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_create_flight_return":
      await ctx.reply(
        "🛬 Укажите *дату рейса обратно* (опционально)\n" +
          "✅ Формат: *YYYY-MM-DD* или *YYYY.MM.DD*\n" +
          "Если не нужно — напишите *пропустить*.",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_create_flight_details":
      await ctx.reply(
        "✈️ Укажите *детали рейса* (номер/время/авиакомпания)\n" +
          "Если не нужно — напишите *пропустить*.",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_create_tour_hotel":
      await ctx.reply("🏨 Укажите *название отеля*:", {
        parse_mode: "Markdown",
        ...wizNavKeyboard(),
      });
      return;

    case "svc_create_tour_accommodation":
      await ctx.reply(
        "🛏 Укажите *размещение*\n" +
          "Например: *DBL*, *SGL*, *2ADL+1CHD* и т.д.",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    // ===== REFUSED HOTEL =====
    case "svc_hotel_country":
      await ctx.reply("🌍 Укажите *страну* (например: Турция):", {
        parse_mode: "Markdown",
        ...wizNavKeyboard(),
      });
      return;

    case "svc_hotel_city":
      await ctx.reply("🏙 Укажите *город* (например: Стамбул):", {
        parse_mode: "Markdown",
        ...wizNavKeyboard(),
      });
      return;

    case "svc_hotel_name":
      await ctx.reply("🏨 Укажите *название отеля*:", {
        parse_mode: "Markdown",
        ...wizNavKeyboard(),
      });
      return;

    case "svc_hotel_checkin":
      await ctx.reply(
        "📅 Укажите *дату заезда*\n✅ Формат: *YYYY-MM-DD* или *YYYY.MM.DD*\nПример: *2025-12-20*",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_hotel_checkout":
      await ctx.reply(
        "📅 Укажите *дату выезда*\n✅ Формат: *YYYY-MM-DD* или *YYYY.MM.DD*\nПример: *2025-12-27*",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_hotel_roomcat":
      await ctx.reply(
        "⭐️ Укажите *категорию номера* (например: Standard / Deluxe / Suite):",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_hotel_accommodation":
      await ctx.reply(
        "🛏 Укажите *размещение*\nНапример: *DBL*, *SGL*, *2ADL+1CHD* и т.д.",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_hotel_food":
      await ctx.reply("🍽 Укажите *питание* (например: BB / HB / FB / AI / UAI):", {
        parse_mode: "Markdown",
        ...wizNavKeyboard(),
      });
      return;

    case "svc_hotel_halal":
      await ctx.reply("🥗 *Halal питание?* Ответьте `да` или `нет`:", {
        parse_mode: "Markdown",
        ...wizNavKeyboard(),
      });
      return;

    case "svc_hotel_transfer":
      await ctx.reply(
        "🚗 Укажите *трансфер* (Индивидуальный / Групповой / Отсутствует):",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_hotel_changeable":
      await ctx.reply("🔁 *Можно вносить изменения?* Ответьте `да` или `нет`:", {
        parse_mode: "Markdown",
        ...wizNavKeyboard(),
      });
      return;

    case "svc_hotel_pax":
      await ctx.reply(
        "👥 Укажите количество человек в формате *ADT/CHD/INF*\n" +
          "Пример: *2/1/0* (2 взрослых, 1 ребёнок, 0 младенцев)",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_create_price": {
      const cat = ctx.session?.serviceDraft?.category;
      const label = cat === "refused_hotel" ? "за отель" : "за тур";
      await ctx.reply(
        `💰 Укажите *цену НЕТТО* (${label})\nПример: *1130* или *1130 USD*`,
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;
    }

    case "svc_create_grossPrice": {
      const cat = ctx.session?.serviceDraft?.category;
      const label = cat === "refused_hotel" ? "за отель" : "за тур";
      await ctx.reply(
        `💳 Укажите *цену БРУТТО* (${label})\n` +
          "Пример: *1250* или *1250 USD*\n" +
          `Или напишите *пропустить* — бот посчитает автоматически (+${
            DEFAULT_GROSS_MARKUP_PERCENT || 10
          }%).`,
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;
    }

    case "svc_create_expiration":
      await ctx.reply(
        "⏳ До какой даты и времени тур *актуален*?\n" +
          "✅ Формат: *YYYY-MM-DD HH:mm* или *YYYY.MM.DD HH:mm*\n" +
          "Или напишите `нет`.",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_create_photo":
      await ctx.reply(
        "🖼 Отправьте *одно фото* (одним сообщением)\nили напишите `пропустить`.",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    default:
      await ctx.reply("Продолжаем создание услуги 👇", wizNavKeyboard());
      return;
  }
}

async function finishCreateServiceFromWizard(ctx) {
  try {
    const draft = ctx.session?.serviceDraft;
    const category = draft?.category;

    if (!draft || (category !== "refused_tour" && category !== "refused_hotel")) {
      await ctx.reply(
        "⚠️ Не вижу данных мастера.\n" +
          "Пожалуйста, начните создание услуги заново через «🧳 Мои услуги»."
      );
      resetServiceWizard(ctx);
      return;
    }

    const priceNum = normalizePrice(draft.price);
    if (priceNum === null) {
      await ctx.reply(
        "😕 Не понял цену.\nВведите число, например: *1130* или *1130 USD*.",
        { parse_mode: "Markdown" }
      );
      ctx.session.state = "svc_create_price";
      return;
    }

    const grossNum = normalizePrice(draft.grossPrice);
    if (grossNum === null && String(draft.grossPrice || "").trim()) {
      await ctx.reply(
        "😕 Не понял цену брутто.\nВведите число (например *1250*) или напишите *пропустить* — посчитаю автоматически.",
        { parse_mode: "Markdown" }
      );
      ctx.session.state = "svc_create_grossPrice";
      return;
    }

    draft.grossPriceNum = grossNum;

    let grossNumFinal = normalizePrice(draft.grossPrice);
    if (grossNumFinal === null) grossNumFinal = calcGrossFromNet(priceNum);
    draft.grossPriceNum = grossNumFinal;

    let details;
    let title;

    if (category === "refused_tour") {
      details = buildDetailsForRefusedTour(draft, priceNum);
      title =
        draft.title && draft.title.trim()
          ? draft.title.trim()
          : autoTitleRefusedTour(draft);
    } else {
      details = buildDetailsForRefusedHotel(draft, priceNum);
      title =
        draft.title && draft.title.trim()
          ? draft.title.trim()
          : autoTitleRefusedHotel(draft);
    }

    const payload = {
      category,
      title,
      price: priceNum,
      details,
      images: draft.images || [],
    };

    const chatId = getActorId(ctx);
    if (!chatId) return;

    const { data } = await axios.post(
      `/api/telegram/provider/${chatId}/services`,
      payload
    );

    if (!data || !data.success) {
      console.log("[tg-bot] createServiceFromWizard resp:", data);
      await ctx.reply(
        "⚠️ Не удалось сохранить услугу.\nПопробуйте позже или добавьте через кабинет."
      );
      resetServiceWizard(ctx);
      return;
    }

    await ctx.reply(
      `✅ Готово!\n\n` +
        `Услуга #${data.service.id} создана и отправлена на модерацию.\n` +
        `После одобрения она появится в поиске Travella и в боте.`
    );

    resetServiceWizard(ctx);

    await ctx.reply("Что делаем дальше? 👇", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📋 Мои услуги", callback_data: "prov_services:list" }],
          [{ text: "➕ Создать услугу", callback_data: "prov_services:create" }],
          [{ text: "⬅️ Назад", callback_data: "prov_services:back" }],
        ],
      },
    });
  } catch (e) {
    console.error(
      "[tg-bot] finishCreateServiceFromWizard error:",
      e?.response?.data || e
    );
    await ctx.reply("⚠️ Ошибка при сохранении услуги. Попробуйте позже.");
    resetServiceWizard(ctx);
  }
}

/* ===================== PHONE LINKING ===================== */

async function handlePhoneRegistration(ctx, requestedRole, phone) {
  try {
    if (ctx.chat?.type && ctx.chat.type !== "private") {
      await ctx.reply(
        "📌 Привязка номера доступна только в личных сообщениях с ботом.\n" +
          "Откройте бота и нажмите /start."
      );
      return;
    }

    const chatId = ctx.chat.id;
    const username = ctx.from.username || null;
    const firstName = ctx.from.first_name || null;

    const payload = { role: requestedRole, phone, chatId, username, firstName };
    console.log("[bot] handlePhoneRegistration payload:", payload);

    const { data } = await axios.post(`/api/telegram/link`, payload);
    console.log("[bot] /api/telegram/link response:", data);

    if (!data || !data.success) {
      await ctx.reply("⚠️ Не удалось привязать номер. Попробуйте позже.");
      return;
    }

    const finalRole =
      data.role === "provider" || data.role === "provider_lead"
        ? "provider"
        : "client";

    if (!ctx.session) ctx.session = {};
    ctx.session.role = finalRole;
    ctx.session.linked = true;

    if (data.existed && data.role === "client") {
      await ctx.reply(
        "✅ Готово!\n\n" +
          "Ваш Telegram привязан к аккаунту *клиента Travella*.\n" +
          "Теперь бот сможет показывать ваши разделы и отправлять уведомления.",
        { parse_mode: "Markdown" }
      );
    } else if (data.existed && data.role === "provider") {
      await ctx.reply(
        "✅ Готово!\n\n" +
          "Ваш Telegram привязан к аккаунту *поставщика Travella*.\n" +
          "Теперь бот сможет показывать ваши услуги и заявки.",
        { parse_mode: "Markdown" }
      );

      if (data.requestedRole === "client") {
        await ctx.reply(
          "ℹ️ По этому номеру уже есть аккаунт поставщика.\n\n" +
            "Если хотите использовать Travella как клиент — зарегистрируйтесь на сайте отдельным номером или email."
        );
      }
    } else if (data.created === "client") {
      await ctx.reply(
        "🎉 Добро пожаловать!\n\n" +
          "Мы создали для вас *клиентский аккаунт* по этому номеру.\n" +
          "Данные можно дополннить на сайте.",
        { parse_mode: "Markdown" }
      );
    } else if (data.created === "provider_lead") {
      await ctx.reply(
        "📝 Заявка принята!\n\n" +
          "Мы зарегистрировали вас как *нового поставщика*.\n" +
          "После модерации менеджер свяжется с вами.\n\n" +
          `🌐 Сайт: ${SITE_URL}`,
        { parse_mode: "Markdown" }
      );
    } else {
      await ctx.reply("✅ Привязка выполнена.");
    }

    await ctx.reply("📌 Готово! Меню доступно ниже 👇", getMainMenuKeyboard(finalRole));
  } catch (e) {
    console.error("[tg-bot] handlePhoneRegistration error:", e?.response?.data || e);
    await ctx.reply("⚠️ Ошибка привязки номера. Попробуйте позже.");
  }
}

/* ===================== /start ===================== */

bot.start(async (ctx) => {
  logUpdate(ctx, "/start");

  const actorId = getActorId(ctx);
  if (!actorId) {
    await ctx.reply("⚠️ Не удалось определить пользователя. Попробуйте позже.");
    return;
  }

  const startPayloadRaw = (ctx.startPayload || "").trim();

  try {
    let role = null;

    try {
      const resClient = await axios.get(`/api/telegram/profile/client/${actorId}`);
      if (resClient.data && resClient.data.success) role = "client";
    } catch (e) {
      if (e?.response?.status !== 404) {
        console.log("[tg-bot] profile client error:", e?.response?.data || e.message || e);
      }
    }

    if (!role) {
      try {
        const resProv = await axios.get(`/api/telegram/profile/provider/${actorId}`);
        if (resProv.data && resProv.data.success) role = "provider";
      } catch (e) {
        if (e?.response?.status !== 404) {
          console.log("[tg-bot] profile provider error:", e?.response?.data || e.message || e);
        }
      }
    }

    if (role) {
      if (!ctx.session) ctx.session = {};
      ctx.session.role = role;
      ctx.session.linked = true;

      if (startPayloadRaw === "start") {
        await ctx.reply("🏠 Главное меню:", getMainMenuKeyboard(role));
        return;
      }

      if (startPayloadRaw === "my_empty") {
        if (role !== "provider") {
          await ctx.reply(
            "🧳 Раздел «Мои услуги» доступен только поставщикам.\n\n" +
              "Если вы поставщик — привяжите номер как поставщик или зарегистрируйтесь на сайте:\n" +
              `${SITE_URL}`,
            getMainMenuKeyboard("client")
          );
          return;
        }

        await ctx.reply(
          "🛑 У вас сейчас нет *актуальных* услуг в боте.\n\n" +
            "Что можно сделать:\n" +
            "• Создать новую услугу\n" +
            "• Открыть список и продлить/активировать услуги\n",
          { parse_mode: "Markdown" }
        );

        await ctx.reply("🧳 Выберите действие:", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "📤 Выбрать мою услугу", switch_inline_query_current_chat: "#my " }],
              [{ text: "📋 Мои услуги", callback_data: "prov_services:list" }],
              [{ text: "➕ Создать услугу", callback_data: "prov_services:create" }],
              [{ text: "⬅️ Назад", callback_data: "prov_services:back" }],
            ],
          },
        });
        return;
      }

      if (startPayloadRaw === "search_empty") {
        await ctx.reply(
          "😕 Сейчас нет *актуальных* предложений по выбранному типу.\n\n" +
            "Попробуйте другой тип услуги или проверьте позже 👇",
          { parse_mode: "Markdown" }
        );

        await ctx.reply("🔎 Выберите тип услуги (отправка в текущий чат):", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "📍 Отказной тур", switch_inline_query_current_chat: "#tour refused_tour" }],
              [{ text: "🏨 Отказной отель", switch_inline_query_current_chat: "#tour refused_hotel" }],
              [{ text: "✈️ Отказной авиабилет", switch_inline_query_current_chat: "#tour refused_flight" }],
              [{ text: "🎫 Отказной билет", switch_inline_query_current_chat: "#tour refused_ticket" }],
            ],
          },
        });

        await ctx.reply("🏠 Главное меню:", getMainMenuKeyboard(role));
        return;
      }

      await ctx.reply(
        "✅ Аккаунт найден.\n\nВыберите раздел в меню ниже 👇",
        getMainMenuKeyboard(role)
      );
      return;
    }

    if (
      startPayloadRaw === "start" ||
      startPayloadRaw === "my_empty" ||
      startPayloadRaw === "search_empty"
    ) {
      await ctx.reply(
        "👋 Чтобы бот работал корректно, нужно привязать аккаунт по номеру телефона.\n\n" +
          "Сейчас сделаем это 👇"
      );
      await askRole(ctx);
      return;
    }

    await ctx.reply(
      "👋 Добро пожаловать в Travella!\n\n" +
        "Чтобы показать ваши бронирования/заявки — привяжем аккаунт по номеру телефона."
    );
    await askRole(ctx);
  } catch (e) {
    console.error("[tg-bot] /start error:", e?.response?.data || e);
    await ctx.reply("⚠️ Ошибка. Попробуйте позже.");
  }
});

/* ===================== ROLE PICK ===================== */

bot.action(/^role:(client|provider)$/, async (ctx) => {
  try {
    const role = ctx.match[1];
    if (!ctx.session) ctx.session = {};
    ctx.session.requestedRole = role;

    await ctx.answerCbQuery();

    await ctx.reply(
      role === "client"
        ? "👤 *Роль: Клиент*\n\n" +
            "📲 Отправьте номер телефона, указанный при регистрации на *travella.uz*.\n\n" +
            "Можно текстом: <code>+998901234567</code>\n" +
            "или нажмите кнопку ниже 👇"
        : "🏢 *Роль: Поставщик*\n\n" +
            "📲 Отправьте номер телефона, указанный при регистрации на *travella.uz*.\n\n" +
            "Можно текстом или через кнопку ниже 👇",
      {
        parse_mode: "HTML",
        reply_markup: {
          keyboard: [[{ text: "📲 Отправить мой номер", request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      }
    );
  } catch (e) {
    console.error("[tg-bot] role action error:", e);
  }
});

bot.on("contact", async (ctx) => {
  logUpdate(ctx, "contact");

  const contact = ctx.message.contact;
  if (!contact || !contact.phone_number) {
    await ctx.reply("⚠️ Не удалось прочитать номер. Попробуйте ещё раз.");
    return;
  }

  if (ctx.chat?.type && ctx.chat.type !== "private") {
    await ctx.reply(
      "📌 Привязка номера доступна только в личных сообщениях с ботом.\nОткройте бота и нажмите /start."
    );
    return;
  }

  const phone = contact.phone_number;
  const requestedRole = ctx.session?.requestedRole || "client";
  await handlePhoneRegistration(ctx, requestedRole, phone);
});

// ==== TEXT PHONE INPUT (не мешаем мастеру/датам) ====
bot.hears(/^\+?\d[\d\s\-()]{5,}$/i, async (ctx, next) => {
  const st = ctx.session?.state || null;

  if (
    st &&
    (String(st).startsWith("svc_create_") ||
      String(st).startsWith("svc_hotel_") ||
      String(st).startsWith("svc_edit_"))
  ) {
    return next();
  }

  const t = String(ctx.message?.text || "").trim();
  if (normalizeDateInput(t)) return next();

  if (!ctx.session || !ctx.session.requestedRole) return next();

  const phone = t;
  const requestedRole = ctx.session.requestedRole;
  await handlePhoneRegistration(ctx, requestedRole, phone);
});

/* ===================== MAIN MENU BUTTONS ===================== */

bot.hears(/🔍 Найти услугу/i, async (ctx) => {
  logUpdate(ctx, "hears Найти услугу");

  const maybeProvider = await ensureProviderRole(ctx);
  const maybeClient = maybeProvider ? null : await ensureClientRole(ctx);
  const linked = !!ctx.session?.linked;
  const role = maybeProvider || maybeClient || ctx.session?.role || null;

  if (!linked && !role) {
    await ctx.reply(
      "📌 Чтобы искать и бронировать услуги, нужно привязать аккаунт по номеру телефона."
    );
    await askRole(ctx);
    return;
  }

  await ctx.reply("🔎 Выберите тип услуги (отправка в текущий чат):", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📍 Отказной тур", switch_inline_query_current_chat: "#tour refused_tour" }],
        [{ text: "🏨 Отказной отель", switch_inline_query_current_chat: "#tour refused_hotel" }],
        [{ text: "✈️ Отказной авиабилет", switch_inline_query_current_chat: "#tour refused_flight" }],
        [{ text: "🎫 Отказной билет", switch_inline_query_current_chat: "#tour refused_ticket" }],
      ],
    },
  });

  await ctx.reply("💡 Нажмите кнопку, выберите карточку — бот отправит её в этот чат.");
});

bot.hears(/❤️ Избранное/i, async (ctx) => {
  logUpdate(ctx, "hears Избранное");
  await ctx.reply(
    "❤️ Избранное в боте пока в разработке.\n\n" +
      "Сейчас вы можете добавлять и смотреть избранное на сайте в разделе «Избранное»:\n" +
      `${SITE_URL}`
  );
});

bot.hears(/📄 (Мои брони|Бронирования)/i, async (ctx) => {
  logUpdate(ctx, "hears Бронирования");

  const maybeProvider = await ensureProviderRole(ctx);
  const linked = !!ctx.session?.linked;
  const role = maybeProvider || ctx.session?.role || null;

  if (!linked && !role) {
    await ctx.reply("📌 Чтобы показать ваши бронирования, нужно привязать аккаунт по номеру телефона.");
    await askRole(ctx);
    return;
  }

  await ctx.reply(
    "📄 Раздел бронирований в боте пока в разработке.\n\n" +
      "Все бронирования доступны в личном кабинете на сайте:\n" +
      `${SITE_URL}`
  );
});

bot.hears(/📨 (Мои заявки|Заявки)/i, async (ctx) => {
  logUpdate(ctx, "hears Заявки");

  const maybeProvider = await ensureProviderRole(ctx);
  const linked = !!ctx.session?.linked;
  const role = maybeProvider || ctx.session?.role || null;

  if (!linked && !role) {
    await ctx.reply("📌 Чтобы показать ваши заявки, нужно привязать аккаунт по номеру телефона.");
    await askRole(ctx);
    return;
  }

  await ctx.reply(
    "📨 Раздел заявок в боте пока в разработке.\n\n" +
      "Заявки/отклики доступны в личном кабинете на сайте:\n" +
      `${SITE_URL}`
  );
});

bot.hears(/👤 Профиль/i, async (ctx) => {
  logUpdate(ctx, "hears Профиль");

  const maybeProvider = await ensureProviderRole(ctx);
  const linked = !!ctx.session?.linked;
  const role = maybeProvider || ctx.session?.role || null;

  if (!linked && !role) {
    await ctx.reply(
      "👤 Похоже, аккаунт ещё не привязан.\n\n" +
        "Давайте привяжем по номеру телефона 👇"
    );
    await askRole(ctx);
    return;
  }

  if (role === "provider") {
    await ctx.reply(
      `🏢 Профиль поставщика можно изменить в личном кабинете:\n\n${SITE_URL}/dashboard/profile`
    );
    return;
  }

  await ctx.reply(`👤 Профиль клиента можно изменить на сайте:\n\n${SITE_URL}`);
});

bot.hears(/🏢 Стать поставщиком/i, async (ctx) => {
  logUpdate(ctx, "hears Стать поставщиком");
  await ctx.reply(
    "🏢 Хотите стать поставщиком Travella?\n\n" +
      "Заполните форму на сайте и дождитесь модерации:\n" +
      `${SITE_URL}\n\n` +
      "Мы свяжемся с вами по указанным контактам."
  );
});

/* ===================== PROVIDER MENU: МОИ УСЛУГИ ===================== */

bot.hears(/🧳 Мои услуги/i, async (ctx) => {
  logUpdate(ctx, "hears Мои услуги");

  const role = await ensureProviderRole(ctx);
  if (role !== "provider") {
    await ctx.reply(
      "🧳 Раздел «Мои услуги» доступен только поставщикам.\n\n" +
        "Если хотите размещать туры/отели — зарегистрируйтесь как поставщик на сайте:\n" +
        `${SITE_URL}`
    );
    return;
  }

  await ctx.reply("🧳 Выберите действие:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📤 Выбрать мою услугу", switch_inline_query_current_chat: "#my " }],
        [{ text: "📋 Мои услуги", callback_data: "prov_services:list" }],
        [{ text: "➕ Создать услугу", callback_data: "prov_services:create" }],
        [{ text: "⬅️ Назад", callback_data: "prov_services:back" }],
      ],
    },
  });
});

bot.action("prov_services:back", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    try {
      await ctx.editMessageReplyMarkup(undefined);
    } catch (_) {}

    const role = (await ensureProviderRole(ctx)) || ctx.session?.role || "client";
    await safeReply(ctx, "🏠 Главное меню:", getMainMenuKeyboard(role));
  } catch (e) {
    console.error("[tg-bot] prov_services:back error:", e?.response?.data || e);
  }
});

bot.action("prov_services:create", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.reply("➕ Ок! Давайте создадим новую услугу 👇");

    if (!ctx.session) ctx.session = {};
    ctx.session.serviceDraft = { category: null, images: [] };
    ctx.session.wizardStack = [];
    ctx.session.state = "svc_create_choose_category";

    await ctx.reply("Выберите категорию отказной услуги:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📍 Отказной тур", callback_data: "svc_new_cat:refused_tour" }],
          [{ text: "🏨 Отказной отель", callback_data: "svc_new_cat:refused_hotel" }],
          [{ text: "✈️ Отказной авиабилет", callback_data: "svc_new_cat:refused_flight" }],
          [{ text: "🎫 Отказной билет", callback_data: "svc_new_cat:refused_ticket" }],
          [{ text: "⬅️ Назад", callback_data: "prov_services:list" }],
        ],
      },
    });
  } catch (e) {
    console.error("[tg-bot] prov_services:create error:", e?.response?.data || e);
  }
});

bot.action("prov_services:list", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const role = await ensureProviderRole(ctx);
    if (role !== "provider") {
      await safeReply(ctx, "⚠️ Раздел доступен только поставщикам.", getMainMenuKeyboard("client"));
      return;
    }

    const actorId = getActorId(ctx);
    if (!actorId) {
      await safeReply(ctx, "⚠️ Не удалось определить пользователя. Откройте бота в ЛС и попробуйте ещё раз.");
      return;
    }

    await safeReply(ctx, "⏳ Загружаю ваши услуги...");
    const { data } = await axios.get(`/api/telegram/provider/${actorId}/services`);

    if (!data || !data.success || !Array.isArray(data.items)) {
      console.log("[tg-bot] provider services malformed:", data);
      await safeReply(ctx, "⚠️ Не удалось загрузить услуги. Попробуйте позже.");
      return;
    }

    if (!data.items.length) {
      await safeReply(
        ctx,
        "Пока нет опубликованных услуг.\n\nНажмите «➕ Создать услугу» или добавьте через кабинет.",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "➕ Создать услугу", callback_data: "prov_services:create" }],
              [{ text: "🌐 Открыть кабинет", url: `${SITE_URL}/dashboard/services/marketplace?from=tg` }],
              [{ text: "⬅️ Назад", callback_data: "prov_services:back" }],
            ],
          },
        }
      );
      return;
    }

    await safeReply(ctx, `✅ Найдено услуг: ${data.items.length}.\nПоказываю первые 10 (по ближайшей дате).`);

    const itemsSorted = [...data.items].sort((a, b) => {
      const da = getStartDateForSort(a);
      const db = getStartDateForSort(b);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da.getTime() - db.getTime();
    });

    for (const svc of itemsSorted.slice(0, 10)) {
      const category = svc.category || svc.type || "refused_tour";

      let details = svc.details || {};
      if (typeof details === "string") {
        try { details = JSON.parse(details); } catch { details = {}; }
      }

      const { text, photoUrl } = buildServiceMessage(svc, category, "provider");
      const status = svc.status || "draft";
      const isActive = isServiceActual(details, svc);
      const expirationRaw = details.expiration || svc.expiration || null;

      const headerLines = [];
      headerLines.push(escapeMarkdown(`#${svc.id} · ${CATEGORY_LABELS[category] || "Услуга"}`));
      headerLines.push(escapeMarkdown(`Статус: ${status}${!isActive ? " (неактуально)" : ""}`));
      if (expirationRaw) headerLines.push(escapeMarkdown(`Актуально до: ${expirationRaw}`));

      const msg = headerLines.join("\n") + "\n\n" + text;
      const manageUrl = `${SITE_URL}/dashboard?from=tg&service=${svc.id}`;

      const keyboard = {
        inline_keyboard: [
          [{ text: "🌐 Открыть в кабинете", url: manageUrl }],
          [{ text: "🔁 Открыть меню в боте", url: buildBotStartUrl() }],
        ],
      };

      if (photoUrl) {
        try {
          if (photoUrl.startsWith("tgfile:")) {
            const fileId = photoUrl.replace(/^tgfile:/, "");
            await ctx.replyWithPhoto(fileId, { caption: msg, parse_mode: "Markdown", reply_markup: keyboard });
          } else {
            await ctx.replyWithPhoto(photoUrl, { caption: msg, parse_mode: "Markdown", reply_markup: keyboard });
          }
        } catch (e) {
          console.error("[tg-bot] replyWithPhoto failed, fallback to text:", e?.response?.data || e?.message || e);
          await ctx.reply(msg, { parse_mode: "Markdown", reply_markup: keyboard });
        }
      } else {
        await ctx.reply(msg, { parse_mode: "Markdown", reply_markup: keyboard });
      }
    }

    await safeReply(ctx, "Что делаем дальше? 👇", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📋 Мои услуги", callback_data: "prov_services:list" }],
          [{ text: "➕ Создать услугу", callback_data: "prov_services:create" }],
          [{ text: "⬅️ Назад", callback_data: "prov_services:back" }],
        ],
      },
    });
  } catch (e) {
    console.error("[tg-bot] provider services error:", e?.response?.data || e?.message || e);
    await safeReply(ctx, "⚠️ Не удалось загрузить услуги. Попробуйте позже.");
  }
});

/* ===================== WIZARD: CANCEL/BACK ===================== */

bot.action("svc_wiz:cancel", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    resetServiceWizard(ctx);
    await safeReply(ctx, "❌ Создание услуги отменено.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📋 Мои услуги", callback_data: "prov_services:list" }],
          [{ text: "➕ Создать услугу", callback_data: "prov_services:create" }],
          [{ text: "⬅️ Назад", callback_data: "prov_services:back" }],
        ],
      },
    });
  } catch (e) {
    console.error("[tg-bot] svc_wiz:cancel error:", e?.response?.data || e);
  }
});

bot.action("svc_wiz:back", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const cur = ctx.session?.state || null;
    if (!cur || !(String(cur).startsWith("svc_create_") || String(cur).startsWith("svc_hotel_"))) return;

    const stack = ctx.session?.wizardStack || [];
    const prev = stack.length ? stack.pop() : null;

    if (!prev) {
      resetServiceWizard(ctx);
      await safeReply(ctx, "⬅️ Возвращаюсь в меню.", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📋 Мои услуги", callback_data: "prov_services:list" }],
            [{ text: "➕ Создать услугу", callback_data: "prov_services:create" }],
            [{ text: "⬅️ Назад", callback_data: "prov_services:back" }],
          ],
        },
      });
      return;
    }

    ctx.session.state = prev;
    await promptWizardState(ctx, prev);
  } catch (e) {
    console.error("[tg-bot] svc_wiz:back error:", e?.response?.data || e);
  }
});

/* ===================== CREATE: choose category ===================== */

bot.action(
  /^svc_new_cat:(refused_tour|refused_hotel|refused_flight|refused_ticket)$/,
  async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const category = ctx.match[1];

      if (!ctx.session) ctx.session = {};
      if (!ctx.session.serviceDraft) ctx.session.serviceDraft = {};
      ctx.session.serviceDraft.category = category;

      if (category !== "refused_tour" && category !== "refused_hotel") {
        await ctx.reply(
          "⚠️ Создание через бот пока доступно только для категорий «Отказной тур» и «Отказной отель».\n\n" +
            "Для остальных категорий используйте, пожалуйста, личный кабинет:\n" +
            `${SITE_URL}`
        );
        resetServiceWizard(ctx);
        return;
      }

      ctx.session.wizardStack = [];

      if (category === "refused_tour") {
        ctx.session.state = "svc_create_title";
        await promptWizardState(ctx, "svc_create_title");
        return;
      }

      ctx.session.state = "svc_hotel_country";
      await promptWizardState(ctx, "svc_hotel_country");
    } catch (e) {
      console.error("[tg-bot] svc_new_cat action error:", e);
    }
  }
);

/* ===================== QUICK REQUEST ===================== */

bot.action(/^request:(\d+)$/, async (ctx) => {
  try {
    const serviceId = Number(ctx.match[1]);
    if (!ctx.session) ctx.session = {};
    ctx.session.pendingRequestServiceId = serviceId;
    ctx.session.state = "awaiting_request_message";

    await ctx.answerCbQuery();

    await safeReply(
      ctx,
      "📩 *Быстрый запрос*\n\n" +
        "Напишите сообщение по услуге:\n" +
        "• пожелания\n" +
        "• даты\n" +
        "• количество человек\n\n" +
        "Если контактный номер отличается от Telegram — добавьте его в сообщение.",
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    console.error("[tg-bot] request action error:", e);
  }
});

/* ===================== TEXT HANDLER (wizard + quick request) ===================== */

bot.on("text", async (ctx, next) => {
  try {
    const state = ctx.session?.state || null;

    // 1) быстрый запрос
    if (state === "awaiting_request_message" && ctx.session.pendingRequestServiceId) {
      const serviceId = ctx.session.pendingRequestServiceId;
      const msg = ctx.message.text;
      const from = ctx.from || {};
      const chatId = ctx.chat.id;

      if (!MANAGER_CHAT_ID) {
        await ctx.reply("⚠️ Быстрый запрос сейчас недоступен. Попробуйте позже.");
      } else {
        const safeFirst = escapeMarkdown(from.first_name || "");
        const safeLast = escapeMarkdown(from.last_name || "");
        const safeUsername = escapeMarkdown(from.username || "нет username");
        const safeMsg = escapeMarkdown(msg);

        const textForManager =
          "🆕 *Новый быстрый запрос из бота Travella*\n\n" +
          `Услуга ID: *${escapeMarkdown(serviceId)}*\n` +
          `От: ${safeFirst} ${safeLast} (@${safeUsername})\n` +
          `Telegram chatId: \`${chatId}\`\n\n` +
          "*Сообщение:*\n" +
          safeMsg;

        await bot.telegram.sendMessage(MANAGER_CHAT_ID, textForManager, {
          parse_mode: "Markdown",
        });

        await ctx.reply(
          "✅ Спасибо!\n\n" +
            "Запрос отправлен менеджеру Travella.\n" +
            "Мы свяжемся с вами в ближайшее время."
        );
      }

      ctx.session.state = null;
      ctx.session.pendingRequestServiceId = null;
      return;
    }

    // 2) мастер создания отказных (tour + hotel)
    if (state && (state.startsWith("svc_create_") || state.startsWith("svc_hotel_"))) {
      const text = ctx.message.text.trim();

      if (text.toLowerCase() === "отмена") {
        resetServiceWizard(ctx);
        await ctx.reply("❌ Создание услуги отменено.");
        await ctx.reply("🧳 Выберите действие:", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "📋 Мои услуги", callback_data: "prov_services:list" }],
              [{ text: "➕ Создать услугу", callback_data: "prov_services:create" }],
              [{ text: "⬅️ Назад", callback_data: "prov_services:back" }],
            ],
          },
        });
        return;
      }

      if (!ctx.session.serviceDraft) ctx.session.serviceDraft = {};
      const draft = ctx.session.serviceDraft;

      switch (state) {
        case "svc_create_title":
          draft.title = text;
          pushWizardState(ctx, "svc_create_title");
          ctx.session.state = "svc_create_tour_country";
          await promptWizardState(ctx, "svc_create_tour_country");
          return;

        case "svc_create_tour_country":
          draft.country = text;
          pushWizardState(ctx, "svc_create_tour_country");
          ctx.session.state = "svc_create_tour_from";
          await promptWizardState(ctx, "svc_create_tour_from");
          return;

        case "svc_create_tour_from":
          draft.fromCity = text;
          pushWizardState(ctx, "svc_create_tour_from");
          ctx.session.state = "svc_create_tour_to";
          await promptWizardState(ctx, "svc_create_tour_to");
          return;

        case "svc_create_tour_to":
          draft.toCity = text;
          pushWizardState(ctx, "svc_create_tour_to");
          ctx.session.state = "svc_create_tour_start";
          await promptWizardState(ctx, "svc_create_tour_start");
          return;

        case "svc_create_tour_start": {
          const norm = normalizeDateInput(text);
          if (!norm) {
            await ctx.reply(
              "😕 Не понял дату начала.\nВведите *YYYY-MM-DD* или *YYYY.MM.DD*, например *2025-12-09*.",
              { parse_mode: "Markdown", ...wizNavKeyboard() }
            );
            return;
          }
          if (isPastYMD(norm)) {
            await ctx.reply("⚠️ Эта дата уже в прошлом. Укажите будущую дату.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          draft.startDate = norm;
          pushWizardState(ctx, "svc_create_tour_start");
          ctx.session.state = "svc_create_tour_end";
          await promptWizardState(ctx, "svc_create_tour_end");
          return;
        }

        case "svc_create_tour_end": {
          const normEnd = normalizeDateInput(text);
          if (!normEnd) {
            await ctx.reply("😕 Не понял дату окончания. Введите YYYY-MM-DD или YYYY.MM.DD.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          if (draft.startDate && isBeforeYMD(normEnd, draft.startDate)) {
            await ctx.reply(
              "⚠️ Дата окончания раньше даты начала.\n" +
                `Начало: ${draft.startDate}\n` +
                "Укажите корректную дату окончания.",
              { parse_mode: "Markdown", ...wizNavKeyboard() }
            );
            return;
          }
          if (isPastYMD(normEnd)) {
            await ctx.reply("⚠️ Эта дата уже в прошлом. Укажите будущую дату окончания.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          draft.endDate = normEnd;
          pushWizardState(ctx, "svc_create_tour_end");
          ctx.session.state = "svc_create_flight_departure";
          await promptWizardState(ctx, "svc_create_flight_departure");
          return;
        }

        case "svc_create_flight_departure": {
          const low = text.toLowerCase();
          if (low === "пропустить" || low === "skip" || low === "-" || low === "нет") {
            draft.departureFlightDate = null;
            pushWizardState(ctx, "svc_create_flight_departure");
            ctx.session.state = "svc_create_flight_return";
            await promptWizardState(ctx, "svc_create_flight_return");
            return;
          }

          const norm = normalizeDateInput(text);
          if (!norm) {
            await ctx.reply(
              "😕 Не понял дату рейса вылета.\nВведите *YYYY-MM-DD* или *YYYY.MM.DD* (например *2025-12-09*) или *пропустить*.",
              { parse_mode: "Markdown", ...wizNavKeyboard() }
            );
            return;
          }
          if (isPastYMD(norm)) {
            await ctx.reply("⚠️ Эта дата уже в прошлом. Укажите будущую дату или *пропустить*.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          draft.departureFlightDate = norm;
          pushWizardState(ctx, "svc_create_flight_departure");
          ctx.session.state = "svc_create_flight_return";
          await promptWizardState(ctx, "svc_create_flight_return");
          return;
        }

        case "svc_create_flight_return": {
          const low = text.toLowerCase();
          if (low === "пропустить" || low === "skip" || low === "-" || low === "нет") {
            draft.returnFlightDate = null;
            pushWizardState(ctx, "svc_create_flight_return");
            ctx.session.state = "svc_create_flight_details";
            await promptWizardState(ctx, "svc_create_flight_details");
            return;
          }

          const norm = normalizeDateInput(text);
          if (!norm) {
            await ctx.reply(
              "😕 Не понял дату рейса обратно.\nВведите *YYYY-MM-DD* или *YYYY.MM.DD* (например *2025-12-15*) или *пропустить*.",
              { parse_mode: "Markdown", ...wizNavKeyboard() }
            );
            return;
          }
          if (isPastYMD(norm)) {
            await ctx.reply("⚠️ Эта дата уже в прошлом. Укажите будущую дату или *пропустить*.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          if (draft.departureFlightDate && isBeforeYMD(norm, draft.departureFlightDate)) {
            await ctx.reply(
              "⚠️ Дата рейса обратно раньше даты вылета.\n" +
                `Вылет: ${draft.departureFlightDate}\n` +
                "Укажите корректную дату обратно или *пропустить*.",
              { parse_mode: "Markdown", ...wizNavKeyboard() }
            );
            return;
          }
          draft.returnFlightDate = norm;
          pushWizardState(ctx, "svc_create_flight_return");
          ctx.session.state = "svc_create_flight_details";
          await promptWizardState(ctx, "svc_create_flight_details");
          return;
        }

        case "svc_create_flight_details": {
          const low = text.toLowerCase();
          draft.flightDetails =
            low === "пропустить" || low === "skip" || low === "-" || low === "нет"
              ? null
              : text;
          pushWizardState(ctx, "svc_create_flight_details");
          ctx.session.state = "svc_create_tour_hotel";
          await promptWizardState(ctx, "svc_create_tour_hotel");
          return;
        }

        case "svc_create_tour_hotel":
          draft.hotel = text;
          pushWizardState(ctx, "svc_create_tour_hotel");
          ctx.session.state = "svc_create_tour_accommodation";
          await promptWizardState(ctx, "svc_create_tour_accommodation");
          return;

        case "svc_create_tour_accommodation":
          draft.accommodation = text;
          pushWizardState(ctx, "svc_create_tour_accommodation");
          ctx.session.state = "svc_create_price";
          await promptWizardState(ctx, "svc_create_price");
          return;

        // ===== HOTEL FLOW =====
        case "svc_hotel_country":
          draft.country = text;
          pushWizardState(ctx, "svc_hotel_country");
          ctx.session.state = "svc_hotel_city";
          await promptWizardState(ctx, "svc_hotel_city");
          return;

        case "svc_hotel_city":
          draft.toCity = text;
          pushWizardState(ctx, "svc_hotel_city");
          ctx.session.state = "svc_hotel_name";
          await promptWizardState(ctx, "svc_hotel_name");
          return;

        case "svc_hotel_name":
          draft.hotel = text;
          pushWizardState(ctx, "svc_hotel_name");
          ctx.session.state = "svc_hotel_checkin";
          await promptWizardState(ctx, "svc_hotel_checkin");
          return;

        case "svc_hotel_checkin": {
          const norm = normalizeDateInput(text);
          if (!norm) {
            await ctx.reply("😕 Не понял дату заезда. Введите YYYY-MM-DD или YYYY.MM.DD.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          if (isPastYMD(norm)) {
            await ctx.reply("⚠️ Эта дата в прошлом. Укажите будущую дату заезда.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          draft.startDate = norm;
          pushWizardState(ctx, "svc_hotel_checkin");
          ctx.session.state = "svc_hotel_checkout";
          await promptWizardState(ctx, "svc_hotel_checkout");
          return;
        }

        case "svc_hotel_checkout": {
          const normEnd = normalizeDateInput(text);
          if (!normEnd) {
            await ctx.reply("😕 Не понял дату выезда. Введите YYYY-MM-DD или YYYY.MM.DD.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          if (draft.startDate && isBeforeYMD(normEnd, draft.startDate)) {
            await ctx.reply(
              "⚠️ Дата выезда раньше даты заезда.\n" +
                `Заезд: ${draft.startDate}\n` +
                "Укажите корректную дату выезда.",
              { parse_mode: "Markdown", ...wizNavKeyboard() }
            );
            return;
          }
          if (isPastYMD(normEnd)) {
            await ctx.reply("⚠️ Эта дата в прошлом. Укажите будущую дату выезда.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          draft.endDate = normEnd;
          pushWizardState(ctx, "svc_hotel_checkout");
          ctx.session.state = "svc_hotel_roomcat";
          await promptWizardState(ctx, "svc_hotel_roomcat");
          return;
        }

        case "svc_hotel_roomcat":
          draft.roomCategory = text;
          pushWizardState(ctx, "svc_hotel_roomcat");
          ctx.session.state = "svc_hotel_accommodation";
          await promptWizardState(ctx, "svc_hotel_accommodation");
          return;

        case "svc_hotel_accommodation":
          draft.accommodation = text;
          pushWizardState(ctx, "svc_hotel_accommodation");
          ctx.session.state = "svc_hotel_food";
          await promptWizardState(ctx, "svc_hotel_food");
          return;

        case "svc_hotel_food":
          draft.food = text;
          pushWizardState(ctx, "svc_hotel_food");
          ctx.session.state = "svc_hotel_halal";
          await promptWizardState(ctx, "svc_hotel_halal");
          return;

        case "svc_hotel_halal": {
          const yn = parseYesNo(text);
          if (yn === null) {
            await ctx.reply("😕 Ответьте `да` или `нет`.", { parse_mode: "Markdown", ...wizNavKeyboard() });
            return;
          }
          draft.halal = yn;
          pushWizardState(ctx, "svc_hotel_halal");
          ctx.session.state = "svc_hotel_transfer";
          await promptWizardState(ctx, "svc_hotel_transfer");
          return;
        }

        case "svc_hotel_transfer":
          draft.transfer = text;
          pushWizardState(ctx, "svc_hotel_transfer");
          ctx.session.state = "svc_hotel_changeable";
          await promptWizardState(ctx, "svc_hotel_changeable");
          return;

        case "svc_hotel_changeable": {
          const yn = parseYesNo(text);
          if (yn === null) {
            await ctx.reply("😕 Ответьте `да` или `нет`.", { parse_mode: "Markdown", ...wizNavKeyboard() });
            return;
          }
          draft.changeable = yn;
          pushWizardState(ctx, "svc_hotel_changeable");
          ctx.session.state = "svc_hotel_pax";
          await promptWizardState(ctx, "svc_hotel_pax");
          return;
        }

        case "svc_hotel_pax": {
          const pax = parsePaxTriple(text);
          if (!pax) {
            await ctx.reply("😕 Не понял формат. Введите строго *ADT/CHD/INF*, например *2/1/0*.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          draft.adt = pax.adt;
          draft.chd = pax.chd;
          draft.inf = pax.inf;
          pushWizardState(ctx, "svc_hotel_pax");
          ctx.session.state = "svc_create_price";
          await promptWizardState(ctx, "svc_create_price");
          return;
        }

        case "svc_create_price":
          draft.price = text;
          pushWizardState(ctx, "svc_create_price");
          ctx.session.state = "svc_create_grossPrice";
          await promptWizardState(ctx, "svc_create_grossPrice");
          return;

        case "svc_create_grossPrice": {
          const lower = text.trim().toLowerCase();
          draft.grossPrice = lower === "пропустить" || lower === "нет" ? null : text;
          pushWizardState(ctx, "svc_create_grossPrice");
          ctx.session.state = "svc_create_expiration";
          await promptWizardState(ctx, "svc_create_expiration");
          return;
        }

        case "svc_create_expiration": {
          const lower = text.trim().toLowerCase();
          const normExp = normalizeDateTimeInput(text);

          if (normExp === null && lower !== "нет") {
            await ctx.reply(
              "😕 Не понял дату актуальности.\n" +
                "Введите *YYYY-MM-DD HH:mm* или *YYYY.MM.DD HH:mm* (например *2025-12-15 21:30*) или `нет`.",
              { parse_mode: "Markdown", ...wizNavKeyboard() }
            );
            return;
          }

          if (normExp && isPastDateTime(normExp)) {
            await ctx.reply("⚠️ Дата актуальности уже в прошлом. Укажите будущую или `нет`.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }

          draft.expiration = normExp;
          pushWizardState(ctx, "svc_create_expiration");
          ctx.session.state = "svc_create_photo";
          await promptWizardState(ctx, "svc_create_photo");
          return;
        }

        case "svc_create_photo":
          if (text.trim().toLowerCase() === "пропустить") {
            draft.images = [];
            await finishCreateServiceFromWizard(ctx);
            return;
          }
          await ctx.reply("🖼 Отправьте фото сообщением (как картинку) или напишите `пропустить`.", {
            parse_mode: "Markdown",
            ...wizNavKeyboard(),
          });
          return;

        default:
          break;
      }
    }
  } catch (e) {
    console.error("[tg-bot] error handling text:", e);
    try {
      await ctx.reply(
        "⚠️ Произошла ошибка.\n" +
          "Попробуйте ещё раз или начните заново через «🧳 Мои услуги» → «➕ Создать услугу»."
      );
    } catch (_) {}
  }

  return next();
});

/* ===================== PHOTO HANDLER (wizard create) ===================== */

bot.on("photo", async (ctx, next) => {
  try {
    const state = ctx.session?.state || null;

    if (state === "svc_create_photo" && ctx.session?.serviceDraft) {
      const photos = ctx.message.photo || [];
      if (!photos.length) {
        await ctx.reply("⚠️ Не удалось прочитать фото. Попробуйте ещё раз.");
        return;
      }

      const largest = photos[photos.length - 1];
      const fileId = largest.file_id;

      // сохраняем tg:fileId
      ctx.session.serviceDraft.telegramPhotoFileId = fileId;
      ctx.session.serviceDraft.images = [`tg:${fileId}`];

      await finishCreateServiceFromWizard(ctx);
      return;
    }
  } catch (e) {
    console.error("[tg-bot] photo handler error:", e);
  }
  return next();
});

/* ===================== /tour_123 ===================== */

async function findServiceByIdViaSearch(actorId, serviceId, role = "client") {
  const basePath =
    role === "provider"
      ? `/api/telegram/provider/${actorId}/search`
      : `/api/telegram/client/${actorId}/search`;

  for (const category of REFUSED_CATEGORIES) {
    try {
      const { data } = await axios.get(basePath, { params: { category } });

      if (!data || !data.success || !Array.isArray(data.items)) continue;

      const svc = data.items.find((s) => Number(s.id) === Number(serviceId));
      if (svc) return { svc, category };
    } catch (e) {
      console.error(
        "[tg-bot] findServiceByIdViaSearch error:",
        e?.response?.data || e.message || e
      );
    }
  }
  return null;
}

bot.hears(/^\/tour_(\d+)$/i, async (ctx) => {
  try {
    const serviceId = Number(ctx.match[1]);
    const actorId = getActorId(ctx);
    if (!actorId) {
      await ctx.reply("⚠️ Не удалось определить пользователя. Попробуйте позже.");
      return;
    }

    // FIX: корректная роль (агент должен видеть net)
    const maybeProvider = await ensureProviderRole(ctx);
    const role = maybeProvider || ctx.session?.role || "client";

    await ctx.reply("⏳ Ищу по ID...");

    const found = await findServiceByIdViaSearch(actorId, serviceId, role);
    if (!found) {
      await ctx.reply(
        "😕 Не нашёл услугу с таким ID.\n" +
          "Возможно, она снята с продажи или не относится к отказным."
      );
      return;
    }

    const { svc, category } = found;
    const { text, photoUrl, serviceUrl } = buildServiceMessage(svc, category, role);

    const keyboard = {
      inline_keyboard: [
        [
          { text: "Подробнее на сайте", url: serviceUrl },
          { text: "📩 Быстрый запрос", callback_data: `request:${svc.id}` },
        ],
      ],
    };

    if (photoUrl) {
      try {
        if (photoUrl.startsWith("tgfile:")) {
          const fileId = photoUrl.replace(/^tgfile:/, "");
          await ctx.replyWithPhoto(fileId, { caption: text, parse_mode: "Markdown", reply_markup: keyboard });
        } else {
          await ctx.replyWithPhoto(photoUrl, { caption: text, parse_mode: "Markdown", reply_markup: keyboard });
        }
      } catch (e) {
        console.error("[tg-bot] replyWithPhoto failed in /tour, fallback to text:", e?.response?.data || e?.message || e);
        await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
      }
    } else {
      await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
    }
  } catch (e) {
    console.error("[tg-bot] /tour_ handler error:", e);
    await ctx.reply("⚠️ Не удалось загрузить. Попробуйте позже.");
  }
});

/* ===================== INLINE SEARCH ===================== */

bot.on("inline_query", async (ctx) => {
  try {
    logUpdate(ctx, "inline_query");

    const qRaw = ctx.inlineQuery?.query || "";
    const q = qRaw.toLowerCase().trim();
    const isMy = q.startsWith("#my");

    // определяем категорию
    let category = "refused_tour";
    if (q.startsWith("#hotel")) category = "refused_hotel";
    else if (q.startsWith("#flight")) category = "refused_flight";
    else if (q.startsWith("#ticket")) category = "refused_ticket";
    else if (q.startsWith("#tour")) category = "refused_tour";
    else if (q.startsWith("#my")) {
      // мои услуги
    } else {
      if (q.includes("отель") || q.includes("hotel")) category = "refused_hotel";
      else if (q.includes("авиа") || q.includes("flight") || q.includes("avia")) category = "refused_flight";
      else if (q.includes("билет") || q.includes("ticket")) category = "refused_ticket";
      else category = "refused_tour";
    }

    const userId = ctx.from.id;

    // роль для inline
    const roleForInline = await resolveRoleByUserId(userId, ctx);

    // Требуем привязку аккаунта
    if (!roleForInline) {
      await ctx.answerInlineQuery([], {
        cache_time: 3,
        is_personal: true,
        switch_pm_text: "🔐 Сначала привяжите аккаунт (номер телефона)",
        switch_pm_parameter: "start",
      });
      return;
    }

    // "Мои услуги" только провайдеру
    if (isMy && roleForInline !== "provider") {
      await ctx.answerInlineQuery([], {
        cache_time: 3,
        is_personal: true,
        switch_pm_text: "🧳 Мои услуги доступны поставщикам. Открыть бота",
        switch_pm_parameter: "start",
      });
      return;
    }

    const cacheKey = isMy ? `my:${userId}` : `search:${userId}:${category}`;
    let data = cacheGet(cacheKey);

    if (!data) {
      if (isMy) {
        const resp = await axios.get(`/api/telegram/provider/${userId}/services`);
        data = resp.data;
      } else {
        const searchPath =
          roleForInline === "provider"
            ? `/api/telegram/provider/${userId}/search`
            : `/api/telegram/client/${userId}/search`;

        const resp = await axios.get(searchPath, { params: { category } });
        data = resp.data;
      }
      cacheSet(cacheKey, data);
    }

    if (!data || !data.success || !Array.isArray(data.items)) {
      console.log("[tg-bot] inline search resp malformed:", data);
      await ctx.answerInlineQuery([], {
        cache_time: 3,
        is_personal: true,
        switch_pm_text: "⚠️ Ошибка загрузки. Открыть бота",
        switch_pm_parameter: "start",
      });
      return;
    }

    // ===================== DEBUG INLINE FILTER =====================
    const DEBUG_INLINE = String(process.env.DEBUG_INLINE || "").trim() === "1";
    if (DEBUG_INLINE) {
      console.log("\n[tg-bot][inline] qRaw =", qRaw);
      console.log("[tg-bot][inline] isMy =", isMy, "category =", category, "role =", roleForInline);
      console.log("[tg-bot][inline] items from API =", Array.isArray(data.items) ? data.items.length : "not array");
      const sample = (Array.isArray(data.items) ? data.items : []).slice(0, 10).map((svc) => {
        const det = parseDetailsAny(svc.details);
        const status = String(svc.status || "");
        const isActive = (() => {
          try { return isServiceActual(det, svc); } catch { return false; }
        })();
        return {
          id: svc.id,
          category: svc.category || svc.type || category,
          status,
          exp: det.expiration || svc.expiration || null,
          isActive,
          start: det.startDate || det.departureFlightDate || null,
          end: det.endDate || det.returnFlightDate || null,
          details_isActive: det.isActive,
        };
      });
      console.log("[tg-bot][inline] sample:", sample);
    }
    // ===============================================================

    // ✅ itemsForInline: для #my показываем ВСЁ (кроме archived), для поиска — только актуальные
    let itemsForInline = Array.isArray(data.items) ? data.items : [];

    if (isMy) {
      itemsForInline = itemsForInline.filter(
        (svc) => String(svc.status || "").toLowerCase() !== "archived"
      );
    } else {
      itemsForInline = itemsForInline.filter((svc) => {
        try {
          const det = parseDetailsAny(svc.details);
          return isServiceActual(det, svc);
        } catch (_) {
          return false;
        }
      });
    }

    if (!itemsForInline.length) {
      if (isMy) {
        await ctx.answerInlineQuery([], {
          cache_time: 3,
          is_personal: true,
          switch_pm_text: "🧳 У вас пока нет услуг. Открыть бота",
          switch_pm_parameter: "my_empty",
        });
      } else {
        await ctx.answerInlineQuery([], {
          cache_time: 3,
          is_personal: true,
          switch_pm_text: "😕 Нет актуальных предложений. Открыть бота",
          switch_pm_parameter: "search_empty",
        });
      }
      return;
    }

    const itemsSorted = [...itemsForInline].sort((a, b) => {
      const da = getStartDateForSort(a);
      const db = getStartDateForSort(b);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da.getTime() - db.getTime();
    });

    const results = [];

    for (const svc of itemsSorted.slice(0, 50)) {
      const svcCategory = svc.category || category || "refused_tour";

      const { text, photoUrl, serviceUrl } = buildServiceMessage(svc, svcCategory, roleForInline);
      const description = buildInlineDescription(svc, svcCategory, roleForInline);

      const manageUrl = `${SITE_URL}/dashboard?from=tg&service=${svc.id}`;

      const keyboardForClient = {
        inline_keyboard: [
          [
            { text: "Подробнее на сайте", url: serviceUrl },
            { text: "📩 Быстрый запрос", callback_data: `request:${svc.id}` },
          ],
        ],
      };

      const keyboardForMy = {
        inline_keyboard: [
          [{ text: "🌐 Открыть в кабинете", url: manageUrl }],
          [{ text: "🔁 Открыть меню в боте", url: buildBotStartUrl() }],
        ],
      };

      // thumb_url для inline
      let thumbUrl = null;
      if (photoUrl && photoUrl.startsWith("tgfile:")) {
        const fileId = photoUrl.replace(/^tgfile:/, "").trim();
        try {
          thumbUrl = await getPublicThumbUrlFromTgFile(bot, fileId);
        } catch (e) {
          console.log("[tg-bot] getFileLink failed:", e?.message || e);
          thumbUrl = null;
        }
      } else if (photoUrl && (photoUrl.startsWith("http://") || photoUrl.startsWith("https://"))) {
        thumbUrl = photoUrl;
      }

      const title = truncate(
        normalizeTitleSoft(svc.title || CATEGORY_LABELS[svcCategory] || "Услуга"),
        60
      );

      // ✅ Если есть реальное публичное фото → type "photo"
      // иначе → article (и Telegram не выкинет результат)
      const inlinePhotoUrl =
        typeof thumbUrl === "string" &&
        (thumbUrl.startsWith("http://") || thumbUrl.startsWith("https://"))
          ? thumbUrl
          : null;

      if (inlinePhotoUrl) {
        results.push({
          id: `${svcCategory}:${svc.id}`,
          type: "photo",
          photo_url: inlinePhotoUrl,
          // thumb_url опционально
          ...(thumbUrl ? { thumb_url: thumbUrl } : {}),
          title,
          description,
          caption: text,
          parse_mode: "Markdown",
          reply_markup: isMy ? keyboardForMy : keyboardForClient,
        });
      } else {
        results.push({
          id: `${svcCategory}:${svc.id}`,
          type: "article",
          title,
          description,
          input_message_content: {
            message_text: text,
            parse_mode: "Markdown",
            disable_web_page_preview: false,
          },
          ...(thumbUrl ? { thumb_url: thumbUrl } : {}),
          reply_markup: isMy ? keyboardForMy : keyboardForClient,
        });
      }
    }

    await ctx.answerInlineQuery(results, { cache_time: 3, is_personal: true });
  } catch (e) {
    console.error("[tg-bot] inline_query error:", e?.response?.data || e?.message || e);
    try {
      await ctx.answerInlineQuery([], {
        cache_time: 3,
        is_personal: true,
        switch_pm_text: "⚠️ Ошибка. Открыть бота",
        switch_pm_parameter: "start",
      });
    } catch (_) {}
  }
});

// ⚠️ здесь НЕТ bot.launch() — запуск делаем из index.js
module.exports = { bot };
