// backend/telegram/bot.js
require("dotenv").config();

const { Telegraf, session, Markup } = require("telegraf");
const axiosBase = require("axios");

const {
  parseDateFlexible,
  isServiceActual,
  normalizeDateTimeInput: normalizeDateTimeInputHelper,
} = require("./helpers/serviceActual");
const { buildSvcActualKeyboard } = require("./keyboards/serviceActual");
const { handleServiceActualCallback } = require("./handlers/serviceActualHandler");

/* ===================== CONFIG ===================== */

const CLIENT_TOKEN = process.env.TELEGRAM_CLIENT_BOT_TOKEN || "";
if (!CLIENT_TOKEN) {
  throw new Error(
    "TELEGRAM_CLIENT_BOT_TOKEN is required for backend/telegram/bot.js"
  );
}
const BOT_TOKEN = CLIENT_TOKEN;

// Username бота (без @). Нужен для стабильных ссылок в inline.
const BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME || "")
  .replace(/^@/, "")
  .trim();

// Шаблон ссылки на карточку услуги на сайте.
const SERVICE_URL_TEMPLATE = (
  process.env.SERVICE_URL_TEMPLATE || "{SITE_URL}?service={id}"
).trim();

// Публичный URL Travella для кнопок "Подробнее"
const SITE_URL = (
  process.env.SITE_PUBLIC_URL ||
  process.env.SITE_URL ||
  "https://travella.uz"
).replace(/\/+$/, "");

// ⚠️ Плейсхолдер НЕ форсим — лучше article без thumb_url, чем 404 -> "Не найдено"
const INLINE_PLACEHOLDER_THUMB = "";

// Кому отправлять "быстрые запросы" из бота
const MANAGER_CHAT_ID = process.env.TELEGRAM_MANAGER_CHAT_ID || "";

// Валюта отображения цены
const PRICE_CURRENCY = (process.env.PRICE_CURRENCY || "USD").trim();

// Для /tour_123 и inline-поиска — работаем с отказными категориями
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

// Публичная база для отдачи картинок (если API проксируется через домен)
const API_PUBLIC_BASE = (
  process.env.API_PUBLIC_URL ||
  process.env.SITE_API_PUBLIC_URL ||
  process.env.API_BASE_PUBLIC_URL ||
  process.env.SITE_API_URL ||
  SITE_URL
).replace(/\/+$/, "");

// ✅ ВАЖНО для Telegram inline-картинок:
// Используем прямой публичный backend (Railway), НЕ сайт (travella.uz), чтобы не было редиректов/прокси.
const TG_IMAGE_BASE = (
  process.env.TG_IMAGE_BASE ||            // <-- добавим в env (Railway URL)
  process.env.API_PUBLIC_URL ||           // если уже задано, тоже ок
  process.env.SITE_API_PUBLIC_URL ||
  process.env.API_BASE_PUBLIC_URL ||
  API_BASE                                // fallback
).replace(/\/+$/, "");

console.log("=== BOT.JS LOADED ===");
console.log("[tg-bot] Using TELEGRAM_CLIENT_BOT_TOKEN (polling)");
console.log("[tg-bot] API_BASE =", API_BASE);
console.log("[tg-bot] API_PUBLIC_BASE =", API_PUBLIC_BASE || "(not set)");
console.log("[tg-bot] TG_IMAGE_BASE =", TG_IMAGE_BASE || "(not set)");
console.log("[tg-bot] SITE_URL =", SITE_URL);
console.log("[tg-bot] BOT_USERNAME =", BOT_USERNAME || "(not set)");
console.log("[tg-bot] SERVICE_URL_TEMPLATE =", SERVICE_URL_TEMPLATE);
console.log(
  "[tg-bot] MANAGER_CHAT_ID =",
  MANAGER_CHAT_ID ? MANAGER_CHAT_ID : "(not set)"
);
console.log("[tg-bot] PRICE_CURRENCY =", PRICE_CURRENCY);

/* ===================== AXIOS ===================== */

const axios = axiosBase.create({
  baseURL: API_BASE,
  timeout: 10000,
});


/* ===================== OPTIONAL DB (requests MVP: id + status) ===================== */
// ⚠️ Мягко: если db.js недоступен/не настроен — бот продолжит работать как раньше (без request_id/статусов)
let pool = null;
try {
  // bot.js обычно лежит в backend/telegram/, db.js в backend/db.js
  pool = require("../db");
} catch (e) {
  console.warn("[tg-bot] DB pool not available (requests MVP disabled):", e?.message || e);
}

let _reqTablesReady = false;
async function ensureReqTables() {
  if (!pool || _reqTablesReady) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS telegram_service_requests (
        id BIGSERIAL PRIMARY KEY,
        service_id BIGINT NOT NULL,
        client_tg_id BIGINT NOT NULL,
        client_username TEXT,
        client_first_name TEXT,
        client_last_name TEXT,
        source TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // ✅ Таблица логов сообщений по заявкам
    await pool.query(`
      CREATE TABLE IF NOT EXISTS telegram_service_request_messages (
        id BIGSERIAL PRIMARY KEY,
        request_id BIGINT NOT NULL
          REFERENCES telegram_service_requests(id)
          ON DELETE CASCADE,
        sender_role TEXT NOT NULL, -- 'client' | 'manager'
        sender_tg_id BIGINT,
        text TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    _reqTablesReady = true;
  } catch (e) {
    console.error("[tg-bot] ensureReqTables error:", e?.message || e);
    _reqTablesReady = false;
  }
}

async function createReqRow({ serviceId, from, source }) {
  try {
    await ensureReqTables();
    if (!pool) return null;
    const r = await pool.query(
      `INSERT INTO telegram_service_requests
       (service_id, client_tg_id, client_username, client_first_name, client_last_name, source)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id`,
      [
        Number(serviceId),
        Number(from?.id || 0),
        from?.username ? String(from.username) : null,
        from?.first_name ? String(from.first_name) : null,
        from?.last_name ? String(from.last_name) : null,
        source ? String(source) : null,
      ]
    );
    return r?.rows?.[0]?.id ? Number(r.rows[0].id) : null;
  } catch (e) {
    console.error("[tg-bot] createReqRow error:", e?.message || e);
    return null;
  }
}

async function updateReqStatus(requestId, status) {
  try {
    await ensureReqTables();
    if (!pool) return false;
    await pool.query(
      `UPDATE telegram_service_requests SET status=$2 WHERE id=$1`,
      [Number(requestId), String(status)]
    );
    return true;
  } catch (e) {
    console.error("[tg-bot] updateReqStatus error:", e?.message || e);
    return false;
  }
}

async function getReqById(requestId) {
  try {
    await ensureReqTables();
    if (!pool) return null;

    const r = await pool.query(
      `SELECT id, service_id, client_tg_id, client_username, client_first_name, client_last_name, status
       FROM telegram_service_requests
       WHERE id = $1
       LIMIT 1`,
      [Number(requestId)]
    );

    return r?.rows?.[0] || null;
  } catch (e) {
    console.error("[tg-bot] getReqById error:", e?.message || e);
    return null;
  }
}

async function logReqMessage({ requestId, senderRole, senderTgId, text }) {
  try {
    await ensureReqTables();
    if (!pool) return false;

    const cleanText = String(text || "").trim();
    if (!cleanText) return false;

    await pool.query(
      `INSERT INTO telegram_service_request_messages (request_id, sender_role, sender_tg_id, text)
       VALUES ($1, $2, $3, $4)`,
      [Number(requestId), String(senderRole), senderTgId ? Number(senderTgId) : null, cleanText]
    );

    return true;
  } catch (e) {
    console.error("[tg-bot] logReqMessage error:", e?.message || e);
    return false;
  }
}

async function getReqMessages(requestId, limit = 20) {
  try {
    await ensureReqTables();
    if (!pool) return [];

    const r = await pool.query(
      `SELECT sender_role, sender_tg_id, text, created_at
       FROM telegram_service_request_messages
       WHERE request_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [Number(requestId), Number(limit)]
    );

    return Array.isArray(r?.rows) ? r.rows : [];
  } catch (e) {
    console.error("[tg-bot] getReqMessages error:", e?.message || e);
    return [];
  }
}

function isManagerChat(ctx) {
  return String(ctx?.chat?.id || "") === String(MANAGER_CHAT_ID || "");
}

/* ===================== INLINE CACHE (LRU + inflight + per-key TTL) ===================== */

const INLINE_CACHE_TTL_MS = 15000;          // общий дефолт (fallback)
const INLINE_CACHE_MAX = 250;               // лимит записей, чтобы не раздувать память

const inlineCache = new Map();              // key -> { ts, ttl, data }
const inlineInflight = new Map();           // key -> Promise

function cacheGet(key) {
  const v = inlineCache.get(key);
  if (!v) return null;

  const ttl = Number(v.ttl || INLINE_CACHE_TTL_MS);
  if (Date.now() - v.ts > ttl) {
    inlineCache.delete(key);
    return null;
  }

  // LRU: освежаем порядок (последний использованный -> в конец)
  inlineCache.delete(key);
  inlineCache.set(key, v);

  return v.data;
}

function cacheSet(key, data, ttlMs = INLINE_CACHE_TTL_MS) {
  inlineCache.set(key, { ts: Date.now(), ttl: ttlMs, data });

  // LRU-prune
  while (inlineCache.size > INLINE_CACHE_MAX) {
    const oldestKey = inlineCache.keys().next().value;
    inlineCache.delete(oldestKey);
  }
}

// Чтобы не долбить API при быстрых inline-вводах (Telegram шлёт много запросов)
async function getOrFetchCached(key, ttlMs, fetcher) {
  const cached = cacheGet(key);
  if (cached) return cached;

  if (inlineInflight.has(key)) {
    try {
      return await inlineInflight.get(key);
    } catch (_) {
      inlineInflight.delete(key);
    }
  }

  const p = (async () => {
    const data = await fetcher();
    cacheSet(key, data, ttlMs);
    return data;
  })();

  inlineInflight.set(key, p);

  try {
    return await p;
  } finally {
    inlineInflight.delete(key);
  }
}


// ===================== AUTH REHYDRATE (FIX PENDING STUCK) =====================
// Если админ одобрил лид через сайт, Telegraf-сессия про это не знает.
// Поэтому при pending/!linked мы раз в несколько секунд перепроверяем БД через API
// и обновляем ctx.session (pending=false, linked=true, role=...).
const AUTH_RECHECK_TTL_MS = 6000;

async function rehydrateAuthSessionIfNeeded(ctx) {
  try {
    if (!ctx.session) ctx.session = {};

    const actorId = ctx?.from?.id || ctx?.chat?.id || null;
    if (!actorId) return false;

    const needCheck = !!ctx.session.pending || !ctx.session.linked;
    if (!needCheck) return false;

    const last = Number(ctx.session._authRecheckTs || 0);
    if (Date.now() - last < AUTH_RECHECK_TTL_MS) return false;
    ctx.session._authRecheckTs = Date.now();

    // 1) provider?
    try {
      const r = await axios.get(`/api/telegram/profile/provider/${actorId}`);
      if (r?.data?.success && r?.data?.user?.id) {
        ctx.session.pending = false;
        ctx.session.linked = true;
        ctx.session.role = "provider";
        ctx.session.requestedRole = null;
        return true;
      }
    } catch (e) {
      // 404 ok -> try client
    }

    // 2) client?
    try {
      const r = await axios.get(`/api/telegram/profile/client/${actorId}`);
      if (r?.data?.success && r?.data?.user?.id) {
        ctx.session.pending = false;
        ctx.session.linked = true;
        ctx.session.role = "client";
        ctx.session.requestedRole = null;
        return true;
      }
    } catch (e) {
      // not found -> still pending/unlinked
    }

    return false;
  } catch (e) {
    console.error("[tg-bot] rehydrateAuthSessionIfNeeded error:", e?.message || e);
    return false;
  }
}


/* ===================== INIT BOT ===================== */

const bot = new Telegraf(BOT_TOKEN);
// ============================================================
// HARDENING: бот не должен падать из-за ошибок Telegram API
// ============================================================
function logTgErr(prefix, err) {
  const msg = err?.response?.description || err?.message || String(err);
  const code = err?.code || err?.response?.error_code;
  console.error(prefix, code ? `(code=${code})` : "", msg);
}

// 1) Ловим любые ошибки, которые Telegraf “видит” в хендлерах
bot.catch((err, ctx) => {
  const who = ctx?.from?.id ? `from=${ctx.from.id}` : "";
  const chat = ctx?.chat?.id ? `chat=${ctx.chat.id}` : "";
  logTgErr(`[tg-bot] handler error ${who} ${chat}`.trim(), err);
});

// 2) Оборачиваем основные методы ctx.*, чтобы sendMessage/edit/etc
//    никогда не приводили к unhandled rejection
bot.use(async (ctx, next) => {
  const wrap = (name, fn) => {
    if (!fn) return fn;
    return (...args) => {
      try {
        const p = fn(...args);
        // если это Promise — гасим ошибки отправки
        if (p && typeof p.then === "function" && typeof p.catch === "function") {
          return p.catch((err) => {
            logTgErr(`[tg-bot] ${name} failed`, err);
            return null;
          });
        }
        return p;
      } catch (err) {
        logTgErr(`[tg-bot] ${name} threw`, err);
        return null;
      }
    };
  };

  // reply / media
  ctx.reply = wrap("ctx.reply", ctx.reply?.bind(ctx));
  ctx.replyWithPhoto = wrap("ctx.replyWithPhoto", ctx.replyWithPhoto?.bind(ctx));
  ctx.replyWithDocument = wrap("ctx.replyWithDocument", ctx.replyWithDocument?.bind(ctx));
  ctx.replyWithMediaGroup = wrap("ctx.replyWithMediaGroup", ctx.replyWithMediaGroup?.bind(ctx));

  // callbacks / edits
  ctx.answerCbQuery = wrap("ctx.answerCbQuery", ctx.answerCbQuery?.bind(ctx));
  ctx.editMessageText = wrap("ctx.editMessageText", ctx.editMessageText?.bind(ctx));
  ctx.editMessageReplyMarkup = wrap(
    "ctx.editMessageReplyMarkup",
    ctx.editMessageReplyMarkup?.bind(ctx)
  );

  return next();
});

// ✅ Сессия всегда по пользователю (важно для inline/групп -> ЛС)
bot.use(
  session({
    getSessionKey: (ctx) => String(ctx?.from?.id || ctx?.chat?.id || "anon"),
  })
);

// ===================== HARD MODERATION GUARD (IRONCLAD) =====================
// Блокирует ЛЮБЫЕ действия, пока аккаунт в pending (модерация не пройдена).
// Разрешает только: /start, выбор роли role:*, отправку номера (contact или текстом в режиме привязки).
bot.use(async (ctx, next) => {
  try {
    // ✅ FIX: если одобрили через сайт — обновим pending/linked из БД
    await rehydrateAuthSessionIfNeeded(ctx);

    const isStartCmd =
      ctx.updateType === "message" &&
      typeof ctx.message?.text === "string" &&
      ctx.message.text.trim().startsWith("/start");

    const isRolePick =
      ctx.updateType === "callback_query" &&
      typeof ctx.callbackQuery?.data === "string" &&
      /^role:(client|provider)$/.test(ctx.callbackQuery.data);

    const isContact =
      ctx.updateType === "message" && !!ctx.message?.contact?.phone_number;

    const isPhoneText =
      ctx.updateType === "message" &&
      typeof ctx.message?.text === "string" &&
      /^\+?\d[\d\s\-()]{5,}$/i.test(ctx.message.text.trim()) &&
      // пропускаем телефон ТОЛЬКО если пользователь реально находится в процессе привязки
      !!ctx.session?.requestedRole;

    const isInline = ctx.updateType === "inline_query";

    // ✅ Если pending — режем всё, кроме /start / выбора роли / отправки телефона
    if (ctx.session?.pending) {
      if (isStartCmd || isRolePick || isContact || isPhoneText) {
        return next();
      }

      // inline — тоже режем "железобетонно"
      if (isInline) {
        return ctx.answerInlineQuery([], {
          cache_time: 3,
          is_personal: true,
          switch_pm_text: "⏳ Заявка на модерации. Дождитесь одобрения",
          switch_pm_parameter: "start",
        });
      }

      // callback_query: обязательно отвечаем, чтобы не крутился лоадер
      if (ctx.updateType === "callback_query") {
        try {
          await ctx.answerCbQuery("⏳ Заявка на модерации. Дождитесь одобрения", {
            show_alert: true,
          });
        } catch {}
        return;
      }

      // message / всё остальное
      await ctx.reply(
        "⏳ Ваша заявка находится на модерации.\nПожалуйста, дождитесь одобрения администратора."
      );
      return;
    }

    // ✅ Если не pending, но не привязан — не даём выполнять действия в обход /start
    // (но не мешаем самому процессу привязки)
    const isLinked = !!ctx.session?.linked;

    if (!isLinked) {
      // разрешаем базовые шаги привязки
      if (isStartCmd || isRolePick || isContact || isPhoneText) {
        return next();
      }

      if (isInline) {
        return ctx.answerInlineQuery([], {
          cache_time: 3,
          is_personal: true,
          switch_pm_text: "🔐 Сначала привяжите аккаунт (номер телефона)",
          switch_pm_parameter: "start",
        });
      }

      if (ctx.updateType === "callback_query") {
        try {
          await ctx.answerCbQuery("🔐 Сначала привяжите аккаунт через /start", {
            show_alert: true,
          });
        } catch {}
        return;
      }

      await ctx.reply("🔐 Сначала привяжите аккаунт (номер телефона) через /start.");
      return;
    }

    return next();
  } catch (e) {
    console.error("[tg-bot] hardGuard middleware error:", e);
    return next();
  }
});


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

function buildServicesTextList(items, role = "provider") {
  const lines = [];

  for (const svc of items) {
    const category = svc.category || svc.type || "refused_tour";
    const d = parseDetailsAny(svc.details);

    const catLabel = CATEGORY_LABELS[category] || "Услуга";
    const startRaw = d.departureFlightDate || d.startDate || null;
    const endRaw = d.returnFlightDate || d.endDate || null;

    let datePart = "";
    if (startRaw && endRaw && String(startRaw) !== String(endRaw)) {
      datePart = `${prettyDateTime(startRaw)}–${prettyDateTime(endRaw)}`;
    } else if (startRaw) {
      datePart = `${prettyDateTime(startRaw)}`;
    }

    const priceRaw = pickPrice(d, svc, role);
    const priceWithCur = formatPriceWithCurrency(priceRaw);

    const title = normalizeTitleSoft(
      (typeof svc.title === "string" && svc.title.trim()) ? svc.title.trim() : (catLabel || "Услуга")
    );

    // ссылка на кабинет
    const manageUrl = `${SITE_URL}/dashboard?from=tg&service=${svc.id}`;

    const parts = [];
    parts.push(`#${svc.id}`);
    parts.push(catLabel);
    if (title) parts.push(title);
    if (datePart) parts.push(datePart);
    if (priceWithCur) parts.push(priceWithCur);

    // одна строка
    lines.push(`• ${parts.join(" · ")}\n  ${manageUrl}`);
  }

  return lines;
}

function chunkText(lines, maxLen = 3800) {
  const chunks = [];
  let buf = "";

  for (const line of lines) {
    if ((buf + "\n" + line).length > maxLen) {
      if (buf.trim()) chunks.push(buf.trim());
      buf = line;
    } else {
      buf = buf ? (buf + "\n" + line) : line;
    }
  }

  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

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
function formatMoney(v) {
  if (v === null || v === undefined) return "";
  const n = Number(String(v).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n)) return String(v);
  // без жёсткой валюты: если хочешь, можно добавить PRICE_CURRENCY
  return String(v).includes("USD") || String(v).includes("usd") ? String(v) : `${n}`;
}

function pickServiceTitle(service) {
  const d = service?.details || {};
  // refused_tour / author_tour
  if (d.title) return String(d.title);
  // refused_hotel
  if (d.hotelName) return String(d.hotelName);
  if (d.hotel) return String(d.hotel);
  // fallback
  if (service?.title) return String(service.title);
  if (service?.name) return String(service.name);
  return "";
}

function pickServicePrice(service) {
  const d = service?.details || {};
  // чаще всего у тебя цена в details.netPrice
  if (d.netPrice !== undefined && d.netPrice !== null && String(d.netPrice).trim() !== "") {
    return String(d.netPrice);
  }
  // fallback
  if (service?.price !== undefined && service?.price !== null && String(service.price).trim() !== "") {
    return String(service.price);
  }
  return "";
}

async function fetchServiceBrief(serviceId) {
  try {
    // ⚠️ ВАЖНО: endpoint должен соответствовать твоему API.
    // 1) попробуем /services/:id
    let r = await axios.get(`/services/${serviceId}`);
    let service = r?.data?.service || r?.data || null;

    // если API отдаёт details строкой — распарсим
    if (service && typeof service.details === "string") {
      try { service.details = JSON.parse(service.details); } catch {}
    }

    if (!service) return null;

    const title = pickServiceTitle(service);
    const price = pickServicePrice(service);

    return { title, price, raw: service };
  } catch (e1) {
    // 2) запасной вариант: /api/services/:id (если у тебя так)
    try {
      let r2 = await axios.get(`/api/services/${serviceId}`);
      let service2 = r2?.data?.service || r2?.data || null;

      if (service2 && typeof service2.details === "string") {
        try { service2.details = JSON.parse(service2.details); } catch {}
      }

      if (!service2) return null;

      const title = pickServiceTitle(service2);
      const price = pickServicePrice(service2);

      return { title, price, raw: service2 };
    } catch (e2) {
      return null;
    }
  }
}

// Бережная нормализация заголовка
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

// Санитизация странных разделителей (’n / 'n / &n) → стрелка
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
    "👋 Добро пожаловать в *Travella*!\n\nВыберите роль, чтобы продолжить 👇",
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

// ✅ Для идентификации пользователя всегда используем ctx.from.id
function getActorId(ctx) {
  return ctx?.from?.id || ctx?.chat?.id || null;
}

async function safeReply(ctx, text, extra) {
  const uid = ctx.from?.id;

  async function sendViaReply() {
    // reply работает только когда есть ctx.chat.id
    if (ctx.chat?.id) return ctx.reply(text, extra);
    throw new Error("NO_CHAT_ID_FOR_REPLY");
  }

  async function sendViaDM() {
    if (!uid) throw new Error("NO_USER_ID");
    return bot.telegram.sendMessage(uid, text, extra);
  }

  // 1) пробуем обычный reply (если можно)
  try {
    return await sendViaReply();
  } catch (e1) {
    // 2) если reply не прошёл — пробуем ЛС
    try {
      return await sendViaDM();
    } catch (e2) {
      // 3) если упали из-за ECONNRESET/сетевых проблем — сделаем 1 ретрай
      const msg = String(e2?.message || e1?.message || "");
      const code = e2?.code || e1?.code;

      const isConnReset =
        code === "ECONNRESET" ||
        msg.includes("ECONNRESET") ||
        msg.includes("network") ||
        msg.includes("FetchError");

      if (!isConnReset) throw e2; // это не сеть — пусть логируется выше

      // маленькая пауза и повтор
      await new Promise((r) => setTimeout(r, 600));

      // повторяем через DM (самый стабильный вариант)
      if (uid) {
        try {
          return await bot.telegram.sendMessage(uid, text, extra);
        } catch (e3) {
          // если и второй раз не вышло — просто пробросим
          throw e3;
        }
      }

      throw e2;
    }
  }
}

function statusLabelForManager(status) {
  return status === "accepted"
    ? "✅ Принято"
    : status === "booked"
    ? "⏳ Забронировано"
    : status === "rejected"
    ? "❌ Отклонено"
    : "🆕 Новый";
}

function parseManagerDirectReply(text) {
  if (!text) return null;
  const s = String(text).trim();

  // Форматы:
  // #123 текст
  // #123: текст
  // #123 - текст
  const m = s.match(/^#(\d+)\s*[:\-]?\s+([\s\S]+)$/);
  if (!m) return null;

  return {
    requestId: Number(m[1]),
    message: String(m[2] || "").trim(),
  };
}

function formatTashkentTime(ts) {
  try {
    if (!ts) return "";
    const d = new Date(ts);
    // Asia/Tashkent (UTC+5), 24h
    const parts = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Asia/Tashkent",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
    return parts; // например: 15.01.2026, 13:05
  } catch {
    return "";
  }
}

function replaceStatusLine(text, newStatusLabel) {
  if (typeof text !== "string") return text;

  // если строка статуса уже есть — заменяем
  if (text.includes("\nСтатус: ")) {
    return text.replace(
      /\nСтатус:\s.*(\n|$)/,
      `\nСтатус: ${newStatusLabel}\n`
    );
  }

  // если нет — аккуратно добавляем после заголовка
  return text.replace(
    /\n\n/,
    `\n\nСтатус: ${newStatusLabel}\n`
  );
}


/* ===================== EDIT WIZARD NAV (svc_edit_*) ===================== */

function editWizNavKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "⏭ Пропустить", callback_data: "svc_edit:skip" }],
        [
          { text: "⬅️ Назад", callback_data: "svc_edit_back" },
          { text: "❌ Отмена", callback_data: "svc_edit_cancel" },
        ],
      ],
    },
  };
}


function editConfirmKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "💾 Сохранить", callback_data: "svc_edit_save" }],
        [{ text: "✏️ Продолжить редактирование", callback_data: "svc_edit_continue" }],
        [{ text: "❌ Отмена", callback_data: "svc_edit_cancel" }],
      ],
    },
  };
}


function editImagesKeyboard(images = []) {
  const rows = [];

  if (images.length) {
    const delRow = images.map((_, i) => ({
      text: `❌ ${i + 1}`,
      callback_data: `svc_edit_img_remove:${i}`,
    }));
    rows.push(delRow);
    rows.push([{ text: "🧹 Очистить все", callback_data: "svc_edit_img_clear" }]);
  }

  rows.push([
    { text: "⬅️ Назад", callback_data: "svc_edit_back" },
    { text: "✅ Готово", callback_data: "svc_edit_img_done" },
  ]);

  return {
    reply_markup: {
      inline_keyboard: rows,
    },
  };
}

function buildEditImagesKeyboard(draft) {
  const images = Array.isArray(draft?.images) ? draft.images : [];
  const rows = [];

  // Кнопки удаления по индексу (ограничим до 8, чтобы не раздувать клавиатуру)
  const max = Math.min(images.length, 8);
  if (max > 0) {
    const btns = [];
    for (let i = 0; i < max; i++) {
      btns.push(Markup.button.callback(`❌ ${i + 1}`, `svc_edit_img_remove:${i}`));
      // по 4 в ряд
      if (btns.length === 4) {
        rows.push(btns.splice(0, btns.length));
      }
    }
    if (btns.length) rows.push(btns);
  }

  rows.push([
    Markup.button.callback("🧹 Очистить все", "svc_edit_img_clear"),
    Markup.button.callback("✅ Готово", "svc_edit_img_done"),
  ]);

  return Markup.inlineKeyboard(rows);
}

async function handleSvcEditWizardPhoto(ctx) {
  // В проекте сейчас "источник правды" для редактирования — ctx.session.serviceDraft
  // (promptEditState() берёт данные оттуда). Поэтому здесь поддерживаем оба варианта.
  const step = String(ctx.session?.editWiz?.step || ctx.session?.state || "");
  const draft = ctx.session?.serviceDraft || ctx.session?.editDraft;

  if (step !== "svc_edit_images" || !draft) return false;

  const photos = ctx.message?.photo;
  if (!Array.isArray(photos) || photos.length === 0) {
    await safeReply(ctx, "⚠️ Пришлите фото (как изображение), чтобы добавить его к услуге.");
    return true;
  }

  // Берём самый большой размер
  const best = photos[photos.length - 1];
  const fileId = best?.file_id;
  if (!fileId) {
    await safeReply(ctx, "⚠️ Не удалось получить file_id. Попробуйте отправить фото ещё раз.");
    return true;
  }

  const tgRef = `tg:${fileId}`;
  if (!Array.isArray(draft.images)) draft.images = [];
  draft.images.push(tgRef);

  const count = draft.images.length;
  await safeReply(
    ctx,
    `✅ Фото добавлено. Сейчас в услуге: ${count} шт.\n\nОтправьте ещё фото или нажмите «✅ Готово».`,
    buildEditImagesKeyboard(draft)
  );

  return true;
}

async function promptEditState(ctx, state) {
  const draft = ctx.session?.serviceDraft || {};

  switch (state) {
    case "svc_edit_title":
      await safeReply(
        ctx,
        `📝 Название (текущее: ${draft.title || "(пусто)"}).\nВведите новую или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    // TOURS
    case "svc_edit_tour_country":
      await safeReply(
        ctx,
        `🌍 Страна направления (текущее: ${draft.country || "(пусто)"}).\nВведите новую или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_tour_from":
      await safeReply(
        ctx,
        `🛫 Город вылета (текущее: ${draft.fromCity || "(пусто)"}).\nВведите новый или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_tour_to":
      await safeReply(
        ctx,
        `🛬 Город прибытия (текущее: ${draft.toCity || "(пусто)"}).\nВведите новый или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_tour_start":
      await safeReply(
        ctx,
        `📅 Дата начала (текущее: ${draft.startDate || "(пусто)"}).\nФормат YYYY-MM-DD или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_tour_end":
      await safeReply(
        ctx,
        `📅 Дата окончания (текущее: ${draft.endDate || "(пусто)"}).\nФормат YYYY-MM-DD или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_flight_departure":
      await safeReply(
        ctx,
        `🛫 Дата рейса вылета (текущее: ${draft.departureFlightDate || "(нет)"}).\nВведите YYYY-MM-DD, или "нет" чтобы убрать, или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_flight_return":
      await safeReply(
        ctx,
        `🛬 Дата рейса обратно (текущее: ${draft.returnFlightDate || "(нет)"}).\nВведите YYYY-MM-DD, или "нет" чтобы убрать, или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_flight_details":
      await safeReply(
        ctx,
        `✈️ Детали рейса (текущее: ${draft.flightDetails || "(нет)"}).\nВведите текст, или "нет" чтобы убрать, или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_tour_hotel":
      await safeReply(
        ctx,
        `🏨 Отель (текущее: ${draft.hotel || "(пусто)"}).\nВведите новый или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_tour_accommodation":
      await safeReply(
        ctx,
        `🛏 Размещение (текущее: ${draft.accommodation || "(пусто)"}).\nВведите новое или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    // REFUSED HOTEL
    case "svc_edit_hotel_country":
      await safeReply(
        ctx,
        `🌍 Страна (текущее: ${draft.country || "(пусто)"}).\nВведите новую или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_hotel_city":
      await safeReply(
        ctx,
        `🏙 Город (текущее: ${draft.toCity || "(пусто)"}).\nВведите новый или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_hotel_name":
      await safeReply(
        ctx,
        `🏨 Отель (текущее: ${draft.hotel || "(пусто)"}).\nВведите новый или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_hotel_checkin":
      await safeReply(
        ctx,
        `📅 Дата заезда (текущее: ${draft.startDate || "(пусто)"}).\nYYYY-MM-DD или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_hotel_checkout":
      await safeReply(
        ctx,
        `📅 Дата выезда (текущее: ${draft.endDate || "(пусто)"}).\nYYYY-MM-DD или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_hotel_roomcat":
      await safeReply(
        ctx,
        `⭐️ Категория номера (текущее: ${draft.roomCategory || "(пусто)"}).\nВведите или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_hotel_accommodation":
      await safeReply(
        ctx,
        `🛏 Размещение (текущее: ${draft.accommodation || "(пусто)"}).\nВведите или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_hotel_food":
      await safeReply(
        ctx,
        `🍽 Питание (текущее: ${draft.food || "(пусто)"}).\nВведите или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_hotel_halal":
      await safeReply(
        ctx,
        `🥗 Halal? (текущее: ${draft.halal ? "да" : "нет"}).\nОтветьте да/нет или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_hotel_transfer":
      await safeReply(
        ctx,
        `🚗 Трансфер (текущее: ${draft.transfer || "(пусто)"}).\nВведите или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_hotel_changeable":
      await safeReply(
        ctx,
        `🔁 Можно изменения? (текущее: ${draft.changeable ? "да" : "нет"}).\nда/нет или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_hotel_pax":
      await safeReply(
        ctx,
        `👥 ADT/CHD/INF (текущее: ${draft.adt ?? 0}/${draft.chd ?? 0}/${draft.inf ?? 0}).\nВведите 2/1/0 или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
      
    // IMAGES
    case "svc_edit_images": {
      const images = ctx.session?.serviceDraft?.images || [];
      await safeReply(
        ctx,
        `🖼 Фото услуги\n\n` +
          `Сейчас: ${images.length} шт.\n\n` +
          `• Отправляйте фото — они добавятся\n` +
          `• Удаляйте кнопками ниже\n` +
          `• Нажмите «Готово», когда закончите`,
        editImagesKeyboard(images)
      );
      return;
    }
    // FINALS
    case "svc_edit_price":
      await safeReply(
        ctx,
        `💰 Цена НЕТТО (текущее: ${draft.price || "(пусто)"}).\nВведите число или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_grossPrice":
      await safeReply(
        ctx,
        `💳 Цена БРУТТО (текущее: ${draft.grossPrice || "(пусто)"}).\nВведите число или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_expiration":
      await safeReply(
        ctx,
        `⏳ Актуально до (YYYY-MM-DD HH:mm) или "нет"\nТекущее: ${draft.expiration || "(нет)"}\nВведите или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_isActive":
      await safeReply(
        ctx,
        `✅ Активна? (текущее: ${draft.isActive ? "да" : "нет"}).\nда/нет или нажмите «⏭ Пропустить»:`,
        editWizNavKeyboard()
      );
      return;

    case "svc_edit_confirm":
      await safeReply(
        ctx,
        "✅ Ок. Теперь можно продолжить редактирование или сохранить изменения.",
        editConfirmKeyboard()
      );
      return;

    default:
      await safeReply(
        ctx,
        "🤔 Не понял шаг редактирования. Нажмите ⬅️ Назад или ❌ Отмена.",
        editWizNavKeyboard()
      );
  }
}


// ===================== ACTUAL REMINDER CALLBACK (svc_actual:...) =====================
// Эти кнопки приходят из напоминаний об актуальности. Обрабатывать должен тот же бот, который отправил кнопки.
bot.action(/^svc_actual:(\d+):(yes|no|extend7|ping)(?::.*)?$/, async (ctx) => {
  try {
    const cbId = ctx.callbackQuery?.id || null;
    const data = ctx.callbackQuery?.data || "";
    const fromChatId = ctx.chat?.id || ctx.from?.id || null;
    const tokenOverride = process.env.TELEGRAM_CLIENT_BOT_TOKEN || "";

    const res = await handleServiceActualCallback({
      callbackQueryId: cbId,
      data,
      fromChatId,
      tokenOverride,
    });

    // если не наш обработчик — просто пропустим
    if (!res || !res.handled) {
      try { await ctx.answerCbQuery(); } catch {}
      return;
    }
  } catch (e) {
    console.error("[tg-bot] svc_actual handler error:", e?.response?.data || e?.message || e);
    // обязательно снимем “часики” в Telegram
    try { await ctx.answerCbQuery("Ошибка. Попробуйте ещё раз", { show_alert: true }); } catch {}
  }
});
// ===================== /ACTUAL REMINDER CALLBACK =====================

bot.action("svc_edit:skip", async (ctx) => {
  try {
    await ctx.answerCbQuery();


    if (!ctx.session) ctx.session = {};

    // ✅ поддерживаем и новый editWiz.step, и legacy ctx.session.state
    const currentState = String(ctx.session?.editWiz?.step || ctx.session?.state || "");

    if (!currentState || !ctx.session?.serviceDraft) {
      await safeReply(ctx, "⚠️ Нечего пропускать. Откройте редактирование услуги заново.");
      return;
    }

    const state = currentState;
    const category = String(ctx.session.serviceDraft?.category || "");

    // ✅ порядок шагов должен СОВПАДАТЬ с promptEditState() и handleSvcEditWizardText()
    const tourOrder = [
      "svc_edit_title",
      "svc_edit_tour_country",
      "svc_edit_tour_from",
      "svc_edit_tour_to",
      "svc_edit_tour_start",
      "svc_edit_tour_end",
      "svc_edit_flight_departure",
      "svc_edit_flight_return",
      "svc_edit_flight_details",
      "svc_edit_tour_hotel",
      "svc_edit_tour_accommodation",
      "svc_edit_price",
      "svc_edit_grossPrice",
      "svc_edit_expiration",
      "svc_edit_isActive",
      "svc_edit_images",
    ];

    const hotelOrder = [
      "svc_edit_title",
      "svc_edit_hotel_country",
      "svc_edit_hotel_city",
      "svc_edit_hotel_name",
      "svc_edit_hotel_checkin",
      "svc_edit_hotel_checkout",
      "svc_edit_hotel_roomcat",
      "svc_edit_hotel_accommodation",
      "svc_edit_hotel_food",
      "svc_edit_hotel_halal",
      "svc_edit_hotel_transfer",
      "svc_edit_hotel_changeable",
      "svc_edit_hotel_pax",
      "svc_edit_price",
      "svc_edit_grossPrice",
      "svc_edit_expiration",
      "svc_edit_isActive",
      "svc_edit_images",
    ];

    const isHotelFlow = category.includes("hotel");
    const order = isHotelFlow ? hotelOrder : tourOrder;

    const idx = order.indexOf(state);
    const nextState = idx >= 0 ? order[idx + 1] : null;

    // ✅ На шаге изображений «Пропустить» = перейти к подтверждению (оставить фото как есть)
    if (state === "svc_edit_images") {
      if (!Array.isArray(ctx.session.wizardStack)) ctx.session.wizardStack = [];
      ctx.session.wizardStack.push(state);

      ctx.session.state = "svc_edit_confirm";
      ctx.session.editWiz = ctx.session.editWiz || {};
      ctx.session.editWiz.step = "svc_edit_confirm";

      await promptEditState(ctx, "svc_edit_confirm");
      return;
    }


    if (!nextState) {
      await safeReply(ctx, "⚠️ Уже нечего пропускать на этом шаге.");
      return;
    }

    if (!Array.isArray(ctx.session.wizardStack)) ctx.session.wizardStack = [];
    ctx.session.wizardStack.push(state);

    // ✅ синхронизация new + legacy
    ctx.session.state = nextState;
    ctx.session.editWiz = ctx.session.editWiz || {};
    ctx.session.editWiz.step = nextState;

    await promptEditState(ctx, nextState);
  } catch (e) {
    console.error("svc_edit:skip error", e);
    await safeReply(ctx, "⚠️ Ошибка при пропуске. Попробуйте ещё раз.");
  }
});

bot.action("svc_edit_back", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const stack = ctx.session?.wizardStack || [];
    const prev = stack.pop();
    if (!prev) {
      await safeReply(ctx, "⏮ Назад больше некуда.", editWizNavKeyboard());
      return;
    }
    ctx.session.state = prev;
          // ✅ синхронизируем
      if (ctx.session.editWiz) ctx.session.editWiz.step = prev;
      await promptEditState(ctx, prev);
    } catch (e) {
    console.error("[tg-bot] svc_edit_back error:", e?.response?.data || e);
  }
});


bot.action("svc_edit_cancel", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    if (!ctx.session) return;

    ctx.session.state = null;
    ctx.session.wizardStack = [];
    ctx.session.serviceDraft = null;
    ctx.session.editingServiceId = null;

    // ✅ ВАЖНО: полностью вычищаем “след” редактирования
    ctx.session.editWiz = null;

    await safeReply(ctx, "❌ Редактирование отменено.");
  } catch (e) {
    console.error("[tg-bot] svc_edit_cancel error:", e?.response?.data || e);
  }
});


bot.action(/^svc_edit_start:(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();

    // 1) доступ только поставщику
    const role = await ensureProviderRole(ctx);
    if (role !== "provider") {
      await safeReply(ctx, "⚠️ Редактирование доступно только поставщикам.", getMainMenuKeyboard("client"));
      return;
    }

    // 2) кто редактирует
    const actorId = getActorId(ctx);
    if (!actorId) {
      await safeReply(ctx, "⚠️ Не удалось определить пользователя. Откройте бота в ЛС и попробуйте ещё раз.");
      return;
    }

    const serviceId = Number(ctx.match[1]);
    if (!serviceId) {
      await safeReply(ctx, "⚠️ Некорректный ID услуги.");
      return;
    }

    // 3) грузим услугу (используем твой endpoint списка)
    const { data } = await axios.get(`/api/telegram/provider/${actorId}/services`);
    if (!data || !data.success || !Array.isArray(data.items)) {
      await safeReply(ctx, "⚠️ Не удалось загрузить услуги. Попробуйте позже.");
      return;
    }

    const svc = data.items.find((s) => Number(s.id) === serviceId);
    if (!svc) {
      await safeReply(ctx, "⚠️ Услуга не найдена (возможно удалена/скрыта).");
      return;
    }

    const category = String(svc.category || svc.type || "refused_tour").trim();
    const det = parseDetailsAny(svc.details);

    // 4) собираем draft в формате, который ждёт твой edit-wizard
    const draft = {
      id: svc.id,
      category,

      // общие
      title: svc.title || det.title || "",
      price: det.netPrice ?? det.price ?? svc.price ?? "",
      grossPrice: det.grossPrice ?? svc.grossPrice ?? "",

      expiration: det.expiration || svc.expiration || "",
      isActive: typeof det.isActive === "boolean" ? det.isActive : (typeof svc.isActive === "boolean" ? svc.isActive : true),

      // туры
      country: det.directionCountry || "",
      fromCity: det.directionFrom || "",
      toCity: det.directionTo || "",
      startDate: det.startDate || "",
      endDate: det.endDate || "",
      departureFlightDate: det.departureFlightDate || "",
      returnFlightDate: det.returnFlightDate || "",
      flightDetails: det.flightDetails || "",
      hotel: det.hotel || "",
      accommodation: det.accommodation || "",

      // отели (wizard использует roomCategory / halal / transfer / changeable / adt/chd/inf)
      roomCategory: det.roomCategory || det.accommodationCategory || "",
      food: det.food || "",
      halal: typeof det.halal === "boolean" ? det.halal : false,
      transfer: det.transfer || "",
      changeable: typeof det.changeable === "boolean" ? det.changeable : false,

      // pax: поддержим оба варианта ключей (на случай старых данных)
      adt: Number.isFinite(det.adt) ? det.adt : (Number.isFinite(det.accommodationADT) ? det.accommodationADT : 0),
      chd: Number.isFinite(det.chd) ? det.chd : (Number.isFinite(det.accommodationCHD) ? det.accommodationCHD : 0),
      inf: Number.isFinite(det.inf) ? det.inf : (Number.isFinite(det.accommodationINF) ? det.accommodationINF : 0),
      images: parseImagesAny(svc.images),
    };

    // 5) стартуем wizard
    if (!ctx.session) ctx.session = {};
    ctx.session.serviceDraft = draft;
    ctx.session.editingServiceId = svc.id;
    ctx.session.wizardStack = [];
    ctx.session.state = "svc_edit_title";

    await safeReply(ctx, `✏️ Редактирование услуги #${svc.id}\n\nНачнём 👇`);
    await promptEditState(ctx, "svc_edit_title");
  } catch (e) {
    console.error("[tg-bot] svc_edit_start error:", e?.response?.data || e?.message || e);
    await safeReply(ctx, "⚠️ Не удалось запустить редактирование. Попробуйте позже.");
  }
});


async function finishEditWizard(ctx) {
  const actorId = getActorId(ctx);
  const draft = ctx.session?.serviceDraft;

  if (!draft?.id) {
    await safeReply(ctx, "⚠️ Не найден черновик редактирования.");
    resetServiceWizard(ctx);
    return;
  }

  try {
        // ✅ ВАЛИДАЦИИ
    const title = String(draft.title || "").trim();

    const category = String(draft.category || "").trim();
    const isHotel = category.includes("hotel");
    const country = String(draft.country || "").trim();
    const fromCity = String(draft.fromCity || "").trim();
    const toCity = String(draft.toCity || "").trim();

    // обязательные поля
    if (!title) {
      await safeReply(ctx, "⚠️ Укажите *Название* (обязательное поле).", { parse_mode: "Markdown", ...editWizNavKeyboard() });
      ctx.session.state = "svc_edit_title";
      ctx.session.editWiz = ctx.session.editWiz || {};
      ctx.session.editWiz.step = "svc_edit_title";
      await promptEditState(ctx, "svc_edit_title");
      return;
    }

    if (!country) {
      const next = isHotel ? "svc_edit_hotel_country" : "svc_edit_tour_country";
      await safeReply(ctx, "⚠️ Укажите *Страну* (обязательное поле).", { parse_mode: "Markdown", ...editWizNavKeyboard() });
      ctx.session.state = next;
      ctx.session.editWiz = ctx.session.editWiz || {};
      ctx.session.editWiz.step = next;
      await promptEditState(ctx, next);
      return;
    }

    // для тура: нужны оба города, для отеля: нужен город (toCity)
    if (!isHotel && (!fromCity || !toCity)) {
      const next = !fromCity ? "svc_edit_tour_from" : "svc_edit_tour_to";
      await safeReply(ctx, "⚠️ Укажите *города вылета и прибытия* (обязательные поля).", { parse_mode: "Markdown", ...editWizNavKeyboard() });
      ctx.session.state = next;
      ctx.session.editWiz = ctx.session.editWiz || {};
      ctx.session.editWiz.step = next;
      await promptEditState(ctx, next);
      return;
    }

    if (isHotel && !toCity) {
      await safeReply(ctx, "⚠️ Укажите *Город* (обязательное поле).", { parse_mode: "Markdown", ...editWizNavKeyboard() });
      ctx.session.state = "svc_edit_hotel_city";
      ctx.session.editWiz = ctx.session.editWiz || {};
      ctx.session.editWiz.step = "svc_edit_hotel_city";
      await promptEditState(ctx, "svc_edit_hotel_city");
      return;
    }

    // ✅ валидация цен перед сохранением (редактирование)
    if (draft.price != null && draft.grossPrice != null) {
      const ok = await validateGrossNotLessThanNet(
        ctx,
        draft.price,
        draft.grossPrice,
        "svc_edit_grossPrice"
      );
      if (!ok) return;
    }

    const payload = {
      title: draft.title || "",
      price: draft.price ?? null,
      grossPrice: draft.grossPrice ?? null,
      status: "pending",
      expiration: (draft.expiration === "" ? null : (draft.expiration ?? null)),
      isActive: !!draft.isActive,


      details: {
        // оставляем совместимость с твоими ключами
        category: draft.category,
        // цены: дублируем в details для совместимости с витриной/карточкой
        netPrice: draft.price ?? null,
        price: draft.price ?? null,
        grossPrice: draft.grossPrice ?? null,
        country: draft.country || "",
        fromCity: draft.fromCity || "",
        toCity: draft.toCity || "",
        startDate: draft.startDate || "",
        endDate: draft.endDate || "",
        hotel: draft.hotel || "",
        accommodation: draft.accommodation || "",
        roomCategory: draft.roomCategory || "",
        food: draft.food || "",
        halal: !!draft.halal,
        transfer: draft.transfer || "",
        changeable: !!draft.changeable,
        adt: draft.adt ?? 0,
        chd: draft.chd ?? 0,
        inf: draft.inf ?? 0,

        departureFlightDate: draft.departureFlightDate || null,
        returnFlightDate: draft.returnFlightDate || null,
        flightDetails: draft.flightDetails || null,

        expiration: (draft.expiration === "" ? null : (draft.expiration ?? null)),
        isActive: !!draft.isActive,
      },

      // ✅ images опционально: если не хочешь трогать — НЕ передавай вообще
      // но раз ты их уже тащишь в draft, можно отправлять (тогда будет replace)
      ...(Array.isArray(draft.images) ? { images: draft.images } : {}),
    };

    const { data } = await axios.patch(
      `/api/telegram/provider/${actorId}/services/${draft.id}`,
      payload
    );

    if (!data?.success) {
      console.log("[tg-bot] update service failed:", data);
      await safeReply(ctx, "⚠️ Не удалось сохранить изменения.");
      return;
    }

    await safeReply(ctx, `✅ Изменения сохранены (#${draft.id}).`);
  } catch (e) {
    console.error("[tg-bot] finishEditWizard error:", e?.response?.data || e?.message || e);
    await safeReply(ctx, "⚠️ Ошибка сохранения изменений.");
  } finally {
    resetServiceWizard(ctx);

    await safeReply(ctx, "Что делаем дальше? 👇", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📋 Мои услуги", callback_data: "prov_services:list" }],
          [{ text: "🖼 Карточками", callback_data: "prov_services:list_cards" }],
          [{ text: "➕ Создать услугу", callback_data: "prov_services:create" }],
          [{ text: "⬅️ Назад", callback_data: "prov_services:back" }],
        ],
      },
    });
  }
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

// Emoji по категориям
const CATEGORY_EMOJI = {
  refused_tour: "📍",
  refused_hotel: "🏨",
  refused_flight: "✈️",
  refused_ticket: "🎫",
};

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
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?$/);
  if (!m) return s;
  const [, y, mm, dd, hh, mi] = m;
  if (hh && mi) return `${dd}.${mm}.${y} ${hh}:${mi}`;
  return `${dd}.${mm}.${y}`;
}

function parseDateSafe(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;

  let d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;

  const s2 = s.replace(/\./g, "-");
  d = new Date(s2);
  if (!Number.isNaN(d.getTime())) return d;

  return null;
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

function getServiceDisplayTitle(svc) {
  const d = parseDetailsAny(svc?.details);

  // refused_tour / author_tour
  if (d?.title) return normalizeTitleSoft(String(d.title));

  // refused_hotel (разные варианты ключей)
  if (d?.hotelName) return normalizeTitleSoft(String(d.hotelName));
  if (d?.hotel) return normalizeTitleSoft(String(d.hotel));

  // fallback
  if (svc?.title) return normalizeTitleSoft(String(svc.title));
  if (svc?.name) return normalizeTitleSoft(String(svc.name));

  return "";
}

async function fetchTelegramService(serviceId, role) {
  try {
    const { data } = await axios.get(`/api/telegram/service/${serviceId}`, {
      params: { role },
    });
    if (!data?.success || !data?.service) return null;
    return data.service;
  } catch {
    return null;
  }
}

function parseImagesAny(images) {
  if (!images) return [];
  if (Array.isArray(images)) return images;

  if (typeof images === "string") {
    const s = images.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [s];
    }
  }

  // на всякий случай (если вдруг объект)
  if (typeof images === "object") {
    const u =
      images.url ||
      images.src ||
      images.path ||
      images.location ||
      images.href ||
      images.imageUrl ||
      images.image_url ||
      null;
    return u ? [String(u)] : [];
  }

  return [];
}


function getStartDateForSort(svc) {
  const d = parseDetailsAny(svc.details);
  const cat = String(svc.category || svc.type || "").toLowerCase();

  // helper: взять первое найденное поле
  const pick = (...keys) => {
    for (const k of keys) {
      const v = d?.[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (v instanceof Date) return v;
    }
    return null;
  };

  // 1) Самые частые поля по категориям
  let raw =
    (cat === "refused_hotel" &&
      pick(
        "checkinDate",
        "checkInDate",
        "check_in",
        "check_in_date",
        "arrivalDate",
        "arrival_date",
        "startDate",
        "start_date"
      )) ||
    (cat === "refused_ticket" &&
      pick("eventDate", "event_date", "date", "startDate", "start_date")) ||
    (cat === "refused_flight" &&
      pick(
        "departureFlightDate",
        "departureDate",
        "departure_date",
        "startFlightDate",
        "start_flight_date",
        "startDate",
        "start_date"
      )) ||
    // refused_tour и остальные
    pick(
      "departureFlightDate",
      "startDate",
      "start_date",
      "dateFrom",
      "date_from",
      "fromDate",
      "from_date",
      "beginDate",
      "begin_date"
    );

  let dt = parseDateSafe(raw);
  if (dt) return dt;

  // 2) Если start не найден — берём end/checkout как fallback
  raw = pick(
    "endDate",
    "end_date",
    "checkoutDate",
    "checkOutDate",
    "checkout_date",
    "returnFlightDate",
    "return_date"
  );
  dt = parseDateSafe(raw);
  if (dt) return dt;

  // 3) Совсем крайний случай — top-level
  dt = parseDateSafe(svc.startDate || svc.start_date || svc.date);
  return dt;
}



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

function getExpiryBadge(detailsRaw, svc) {
  const d = parseDetailsAny(detailsRaw);
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

/* ===================== DATES ===================== */

function normalizeDateInput(raw) {
  if (!raw) return null;
  const txt = String(raw).trim();
  if (/^(нет|пропустить|skip|-)\s*$/i.test(txt)) return null;

  const m = txt.match(/^(\d{4})[.\-/](\d{2})[.\-/](\d{2})$/);
  if (!m) return null;

  const [, y, mm, dd] = m;
  return `${y}-${mm}-${dd}`;
}

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

/* ===================== IMAGES ===================== */
/**
 * В services.images могут быть:
 * - base64 data:image...
 * - http(s) URL
 * - относительный /path
 * - "tg:<file_id>"
 */
function getFirstImageUrl(svc) {
  // 0) разные варианты поля "готовая ссылка"
  const directCandidates = [
    svc?.imageUrl,
    svc?.image_url,
    svc?.thumbnailUrl,
    svc?.thumbnail_url,
    svc?.image,
    svc?.photo,
  ];

  for (const c of directCandidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }

  let arr = svc?.images ?? null;

  if (typeof arr === "string") {
    try {
      arr = JSON.parse(arr);
    } catch {
      arr = [arr];
    }
  }
  if (!Array.isArray(arr)) arr = [];

  // fallback: фото из Telegram, если нет images
  if (!arr.length) {
    const d = parseDetailsAny(svc.details);
    const fid = (d.telegramPhotoFileId || "").trim();
    if (fid) return `tgfile:${fid}`;
    return null;
  }

  let v = arr[0];
  if (v && typeof v === "object") {
    v =
      v.url ||
      v.src ||
      v.path ||
      v.location ||
      v.href ||
      v.imageUrl ||
      v.image_url ||
      null;
  }
  if (typeof v !== "string") return null;

  v = v.trim();
  if (!v) return null;

  if (v.startsWith("tg:")) {
    const fileId = v.slice(3).trim();
    return fileId ? `tgfile:${fileId}` : null;
  }

  if (v.startsWith("data:image")) {
    // ✅ Telegram должен тянуть с прямого домена backend (Railway)
    return `${TG_IMAGE_BASE}/api/telegram/service-image/${svc.id}`;
  }
  
  if (v.startsWith("http://") || v.startsWith("https://")) return v;
  
  // относительные пути:
  if (v.startsWith("/")) return TG_IMAGE_BASE + v;
  
  // <-- ключевой фикс: если путь без "/" — тоже собираем URL
  return `${TG_IMAGE_BASE}/${v.replace(/^\/+/, "")}`;

}

function buildServiceMessage(svc, category, role = "client") {
  const d = parseDetailsAny(svc.details);

  const titleRaw = svc.title || CATEGORY_LABELS[category] || "Услуга";
  const titlePretty = normalizeTitleSoft(titleRaw);

  const emoji = CATEGORY_EMOJI[category] || "";
  const stars = extractStars(d);
  const titleDecor = [emoji, titlePretty, stars].filter(Boolean).join(" ");
  const title = escapeMarkdown(titleDecor);

  const directionParts = [];
  const from = d.directionFrom ? normalizeWeirdSeparator(d.directionFrom) : null;
  const to = d.directionTo ? normalizeWeirdSeparator(d.directionTo) : null;
  const country = d.directionCountry ? normalizeWeirdSeparator(d.directionCountry) : null;

  if (from && to) directionParts.push(`${escapeMarkdown(from)} → ${escapeMarkdown(to)}`);
  else if (from) directionParts.push(escapeMarkdown(from));
  else if (to) directionParts.push(escapeMarkdown(to));
  if (country) directionParts.push(escapeMarkdown(country));

  const direction = directionParts.length ? directionParts.join(" · ") : null;

  const startRaw = d.departureFlightDate || d.startDate || d.startFlightDate || null;
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

  const providerId = svc.provider_id || svc.providerId || svc.provider?.id || null;
  
  const providerProfileUrl = providerId
    ? `${SITE_URL}/profile/provider/${providerId}`
    : null;
  
  // ✅ кликабельный ТОЛЬКО профиль
  const providerLine = providerProfileUrl
    ? `Поставщик: [${providerName}](${providerProfileUrl})`
    : `Поставщик: ${providerName}`;
  
  // ✅ Telegram — кликабельный на t.me/username
  let telegramLine = null;
  if (providerTelegram) {
    let username = String(providerTelegram).trim();
    username = username.replace(/^@/, "");
    username = username.replace(/^https?:\/\/t\.me\//i, "");
    username = username.replace(/^tg:\/\/resolve\?domain=/i, "");
  
    if (username) {
      const safeUsername = escapeMarkdown(username);
      const tgUrl = `https://t.me/${encodeURIComponent(username)}`; // URL в markdown можно не экранировать
      telegramLine = `Telegram: [${safeUsername}](${tgUrl})`;
    }
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
  lines.push(`Подробнее и бронирование: [открыть](${serviceUrl})`);

  const text = lines.join("\n");
  const photoUrl = getFirstImageUrl(svc);

  return { text, photoUrl, serviceUrl };
}

/**
 * ✅ Точечный фикс по задаче:
 * - больше НЕ показываем "Отказной тур: ..." в inline description
 * - описание = только маршрут/страна/даты/цена (без префикса категории)
 */
function buildInlineDescription(svc, category, roleForInline) {
  const d = parseDetailsAny(svc.details);
  const parts = [];

  const from = d.directionFrom ? normalizeWeirdSeparator(d.directionFrom) : null;
  const to = d.directionTo ? normalizeWeirdSeparator(d.directionTo) : null;
  const country = d.directionCountry ? normalizeWeirdSeparator(d.directionCountry) : null;

  if (from && to) parts.push(`${from} → ${to}`);
  else if (to) parts.push(to);
  else if (from) parts.push(from);

  if (country) parts.push(country);

  const startRaw = d.departureFlightDate || d.startDate || d.startFlightDate || null;
  const endRaw = d.returnFlightDate || d.endDate || d.endFlightDate || null;

  if (startRaw && endRaw && String(startRaw) !== String(endRaw)) {
    parts.push(`${prettyDateTime(startRaw)}–${prettyDateTime(endRaw)}`);
  } else if (startRaw) {
    parts.push(prettyDateTime(startRaw));
  }

  const priceRaw = pickPrice(d, svc, roleForInline);
  const priceWithCur = formatPriceWithCurrency(priceRaw);
  if (priceWithCur) parts.push(priceWithCur);

  const s = parts.filter(Boolean).join(" · ").trim();
  return truncate(s || " ", 96);
}

/* ===================== ROLE RESOLUTION ===================== */

async function ensureProviderRole(ctx) {
  if (ctx.session?.role === "provider") return "provider";

  const actorId = getActorId(ctx);
  if (!actorId) return ctx.session?.role || null;

  try {
    const resProv = await axios.get(`/api/telegram/profile/provider/${actorId}`);
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

function forceCloseEditWizard(ctx) {
  if (!ctx?.session) return;

  // выключаем edit-wizard, чтобы он больше не перехватывал ввод
  if (typeof ctx.session.state === "string" && ctx.session.state.startsWith("svc_edit_")) {
    ctx.session.state = "";
  }
  if (
    ctx.session.editWiz &&
    typeof ctx.session.editWiz.step === "string" &&
    ctx.session.editWiz.step.startsWith("svc_edit_")
  ) {
    ctx.session.editWiz.step = "";
  }

  if (Array.isArray(ctx.session.wizardStack)) ctx.session.wizardStack = [];
  if (ctx.session.serviceDraft) delete ctx.session.serviceDraft;
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

function autoTitleRefusedHotel(draft) {
  const hotel = (draft.hotel || "Отель").trim();
  const city = (draft.toCity || "").trim();
  const range = shortDateRange(draft.startDate, draft.endDate);
  const parts = [hotel];
  if (city) parts.push(city);
  if (range) parts.push(range);
  return parts.join(" · ");
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

function buildDetailsForRefusedTour(draft, netPriceNum) {
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
    netPrice: netPriceNum,
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
        [{ text: "⏭ Пропустить", callback_data: "svc_wiz:skip" }],
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
function normReq(text) {
  const v = String(text ?? "").replace(/\s+/g, " ").trim();
  return v.length ? v : null;
}

// универсальная проверка “обязательное текстовое поле”
async function requireTextField(ctx, text, label, opts = {}) {
  const { min = 2 } = opts;
  const v = normReq(text);
  if (!v) {
    await ctx.reply(`⚠️ Поле *${label}* обязательно.\nВведите значение ещё раз.`, {
      parse_mode: "Markdown",
      ...wizNavKeyboard(),
    });
    return null;
  }
  if (v.length < min) {
    await ctx.reply(`⚠️ Слишком коротко для *${label}*.\nВведите минимум ${min} символа(ов).`, {
      parse_mode: "Markdown",
      ...wizNavKeyboard(),
    });
    return null;
  }
  return v;
}

// проверка gross >= net
async function validateGrossNotLessThanNet(ctx, netStr, grossStr, backToState) {
  const net = normalizePrice(netStr);
  const gross = normalizePrice(grossStr);

  // если gross пустой/пропуск — валидировать нечего
  if (grossStr == null || String(grossStr).trim() === "") return true;
  if (gross === null) return true; // это уже отдельно обрабатывается у тебя

  if (net !== null && gross < net) {
    await ctx.reply(
      `⚠️ Цена *БРУТТО* не может быть меньше *НЕТТО*.\n` +
        `НЕТТО: *${net}*\nБРУТТО: *${gross}*\n\nВведите корректную цену БРУТТО.`,
      { parse_mode: "Markdown", ...wizNavKeyboard() }
    );
    if (backToState) ctx.session.state = backToState;
    return false;
  }
  return true;
}

async function promptWizardState(ctx, state) {
  switch (state) {
    case "svc_create_title":
      await ctx.reply(
        "🆕 Создаём *Отказной тур*.\n\n✍️ Напишите *название тура*.",
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
        "📅 Укажите *дату начала тура*\n✅ Формат: *YYYY-MM-DD* или *YYYY.MM.DD*\nПример: *2025-12-09*",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_create_tour_end":
      await ctx.reply(
        "📅 Укажите *дату окончания тура*\n✅ Формат: *YYYY-MM-DD* или *YYYY.MM.DD*\nПример: *2025-12-15*",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_create_flight_departure":
      await ctx.reply(
        "🛫 Укажите *дату рейса вылета* (опционально)\n✅ Формат: *YYYY-MM-DD* или *YYYY.MM.DD*\nЕсли не нужно — нажмите «⏭ Пропустить».",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_create_flight_return":
      await ctx.reply(
        "🛬 Укажите *дату рейса обратно* (опционально)\n✅ Формат: *YYYY-MM-DD* или *YYYY.MM.DD*\nЕсли не нужно — нажмите «⏭ Пропустить».",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_create_flight_details":
      await ctx.reply(
        "✈️ Укажите *детали рейса* (номер/время/авиакомпания)\nЕсли не нужно — нажмите «⏭ Пропустить».",
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
        "🛏 Укажите *размещение*\nНапример: *DBL*, *SGL*, *2ADL+1CHD* и т.д.",
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
      await ctx.reply(
        "🍽 Укажите *питание* (например: BB / HB / FB / AI / UAI):",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
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
        "👥 Укажите количество человек в формате *ADT/CHD/INF*\nПример: *2/1/0*",
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
        `💳 Укажите *цену БРУТТО* (${label})\nПример: *1250* или *1250 USD*\n` +
          `Или нажмите «⏭ Пропустить» — посчитаю автоматически (+${
            DEFAULT_GROSS_MARKUP_PERCENT || 10
          }%).`,
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;
    }

    case "svc_create_expiration":
      await ctx.reply(
        "⏳ До какой даты и времени услуга *актуальна*?\n✅ Формат: *YYYY-MM-DD HH:mm* или *YYYY.MM.DD HH:mm*\nИли напишите `нет`.",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_create_photo":
      await ctx.reply(
        "🖼 Отправьте *одно фото* (одним сообщением)\nили нажмите «⏭ Пропустить».",
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
        "⚠️ Не вижу данных мастера.\nПожалуйста, начните заново через «🧳 Мои услуги»."
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
        "😕 Не понял цену брутто.\nВведите число (например *1250*) или нажмите «⏭ Пропустить».",
        { parse_mode: "Markdown" }
      );
      ctx.session.state = "svc_create_grossPrice";
      return;
    }

    draft.grossPriceNum = grossNum;
    let grossNumFinal = normalizePrice(draft.grossPrice);
    if (grossNumFinal === null) grossNumFinal = calcGrossFromNet(priceNum);
    draft.grossPriceNum = grossNumFinal;
    
    // ✅ ВАЛИДАЦИЯ: БРУТТО НЕ МОЖЕТ БЫТЬ МЕНЬШЕ НЕТТО
    // grossNumFinal уже финальный (введённый или рассчитанный)
    if (grossNumFinal !== null && grossNumFinal < priceNum) {
      await ctx.reply(
        `⚠️ Цена *БРУТТО* не может быть меньше *НЕТТО*.\n` +
          `Сейчас: нетто=${priceNum}, брутто=${grossNumFinal}.\n\n` +
          `Введите цену БРУТТО заново (например: *1250* или *1250 USD*) ` +
          `или нажмите «⏭ Пропустить».`,
        { parse_mode: "Markdown" }
      );
      ctx.session.state = "svc_create_grossPrice";
      return;
    }

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
      `✅ Готово!\n\nУслуга #${data.service.id} создана и отправлена на модерацию.\nПосле одобрения она появится в поиске.`
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
        "📌 Привязка номера доступна только в личных сообщениях.\nОткройте бота и нажмите /start."
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

    // ✅ pending/lead = НЕ даём меню и НЕ считаем привязку "одобренной"
    const isPending =
      data.role === "provider_lead" ||
      data.created === "provider_lead" ||
      data.pending === true;

    if (isPending) {
      ctx.session.role = null;
      ctx.session.linked = false;
      ctx.session.pending = true;
      ctx.session.pendingRole = finalRole;

      await ctx.reply(
        "🕒 Заявка принята и отправлена на модерацию.\n\n" +
          "⏳ Пожалуйста, дождитесь одобрения администратора.\n" +
          "После одобрения меню станет доступно.\n\n" +
          `🌐 Сайт: ${SITE_URL}`,
        { parse_mode: "Markdown" }
      );

      // ❗️ВАЖНО: тут выходим, меню ниже НЕ показываем
      return;
    }

    // ✅ Одобрено (аккаунт найден/создан не через lead)
    ctx.session.role = finalRole;
    ctx.session.linked = true;
    ctx.session.pending = false;
    ctx.session.pendingRole = null;


    if (data.existed && data.role === "client") {
      await ctx.reply(
        "✅ Готово!\n\nВаш Telegram привязан к аккаунту *клиента Travella*.",
        { parse_mode: "Markdown" }
      );
    } else if (data.existed && data.role === "provider") {
      await ctx.reply(
        "✅ Готово!\n\nВаш Telegram привязан к аккаунту *поставщика Travella*.",
        { parse_mode: "Markdown" }
      );

      if (data.requestedRole === "client") {
        await ctx.reply(
          "ℹ️ По этому номеру уже есть аккаунт поставщика.\nЕсли хотите быть клиентом — зарегистрируйтесь на сайте отдельно."
        );
      }
    } else if (data.created === "client") {
      await ctx.reply(
        "🎉 Добро пожаловать!\n\nМы создали для вас *клиентский аккаунт* по этому номеру.",
        { parse_mode: "Markdown" }
      );
    } else if (data.created === "provider_lead") {
      await ctx.reply(
        "📝 Заявка принята!\n\nМы зарегистрировали вас как *нового поставщика*.\nПосле модерации менеджер свяжется с вами.\n\n" +
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
      
      // ✅ Deep-link: refused_<serviceId> => показать конкретную услугу
      const mRef = startPayloadRaw.match(/^refused_(\d+)$/i);
      if (mRef) {
        const serviceId = Number(mRef[1]);

        try {
          // берём услугу и данные поставщика (имена полей подстрой под свою БД)
          const { data } = await axios.get(`/api/telegram/service/${serviceId}`, {
            params: { role },
          });

          if (!data?.success || !data?.service) {
            await ctx.reply("❗️Услуга не найдена или уже снята с публикации.");
            await ctx.reply("🏠 Главное меню:", getMainMenuKeyboard(role));
            return;
          }

          const svc = data.service;
          const category = String(svc.category || "").toLowerCase();

          // buildServiceMessage у тебя уже есть в bot.js (ты его используешь для карточек)
          const { text, photoUrl, serviceUrl } = buildServiceMessage(svc, category, role);

          const kb = {
            inline_keyboard: [
              [{ text: "Подробнее на сайте", url: serviceUrl }],
              [{ text: "📩 Быстрый запрос", callback_data: `quick:${serviceId}` }],
            ],
          };

          if (photoUrl) {
            await ctx.replyWithPhoto(photoUrl, {
              caption: text,
              parse_mode: "Markdown",
              reply_markup: kb,
            });
          } else {
            await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
          }

          return; // ✅ не показываем главное меню вместо услуги
        } catch (e) {
          console.log("[tg-bot] refused_<id> open error:", e?.response?.data || e?.message || e);
          await ctx.reply("⚠️ Не удалось открыть услугу. Попробуйте позже.");
          await ctx.reply("🏠 Главное меню:", getMainMenuKeyboard(role));
          return;
        }
      }

      if (startPayloadRaw === "start") {
        await ctx.reply("🏠 Главное меню:", getMainMenuKeyboard(role));
        return;
      }

      if (startPayloadRaw === "my_empty") {
        if (role !== "provider") {
          await ctx.reply(
            "🧳 «Мои услуги» доступны только поставщикам.\nЕсли вы поставщик — привяжите номер как поставщик.",
            getMainMenuKeyboard("client")
          );
          return;
        }

        await ctx.reply(
          "🛑 У вас сейчас нет *актуальных* услуг в боте.\n\nЧто можно сделать:\n• Создать новую услугу\n• Открыть список и продлить/активировать услуги\n",
          { parse_mode: "Markdown" }
        );

        await ctx.reply("🧳 Выберите действие:", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "📤 Выбрать мою услугу", switch_inline_query_current_chat: "#my refused_tour" }],
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
          "😕 Сейчас нет *актуальных* предложений по выбранному типу.\nПопробуйте другой тип услуги или проверьте позже 👇",
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

      await ctx.reply("✅ Аккаунт найден.\n\nВыберите раздел в меню ниже 👇", getMainMenuKeyboard(role));
      return;
    }

    if (
      startPayloadRaw === "start" ||
      startPayloadRaw === "my_empty" ||
      startPayloadRaw === "search_empty"
    ) {
      await ctx.reply(
        "👋 Чтобы бот работал корректно, нужно привязать аккаунт по номеру телефона.\nСейчас сделаем это 👇"
      );
      await askRole(ctx);
      return;
    }

    await ctx.reply(
      "👋 Добро пожаловать в Travella!\n\nЧтобы показать ваши бронирования/заявки — привяжем аккаунт по номеру телефона."
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
        ? "👤 *Роль: Клиент*\n\n📲 Отправьте номер телефона, указанный при регистрации на *travella.uz*.\n\n" +
            "Можно текстом: <code>+998901234567</code>\nили нажмите кнопку ниже 👇"
        : "🏢 *Роль: Поставщик*\n\n📲 Отправьте номер телефона, указанный при регистрации на *travella.uz*.\n\n" +
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
      "📌 Привязка номера доступна только в личных сообщениях.\nОткройте бота и нажмите /start."
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
  forceCloseEditWizard(ctx);
  resetServiceWizard(ctx);


  const maybeProvider = await ensureProviderRole(ctx);
  const maybeClient = maybeProvider ? null : await ensureClientRole(ctx);
  const linked = !!ctx.session?.linked;
  const role = maybeProvider || maybeClient || ctx.session?.role || null;

  if (!linked && !role) {
    await ctx.reply("📌 Чтобы искать и бронировать услуги, нужно привязать аккаунт по номеру телефона.");
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
    "❤️ Избранное в боте пока в разработке.\n\nСейчас вы можете добавлять и смотреть избранное на сайте:\n" +
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
    "📄 Раздел бронирований в боте пока в разработке.\n\nВсе бронирования доступны в личном кабинете на сайте:\n" +
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
    "📨 Раздел заявок в боте пока в разработке.\n\nЗаявки/отклики доступны в личном кабинете на сайте:\n" +
      `${SITE_URL}`
  );
});

bot.hears(/👤 Профиль/i, async (ctx) => {
  logUpdate(ctx, "hears Профиль");

  const maybeProvider = await ensureProviderRole(ctx);
  const linked = !!ctx.session?.linked;
  const role = maybeProvider || ctx.session?.role || null;

  if (!linked && !role) {
    await ctx.reply("👤 Похоже, аккаунт ещё не привязан.\n\nДавайте привяжем по номеру телефона 👇");
    await askRole(ctx);
    return;
  }

  if (role === "provider") {
    await ctx.reply(`🏢 Профиль поставщика можно изменить в кабинете:\n\n${SITE_URL}/dashboard/profile`);
    return;
  }

  await ctx.reply(`👤 Профиль клиента можно изменить на сайте:\n\n${SITE_URL}`);
});

bot.hears(/🏢 Стать поставщиком/i, async (ctx) => {
  logUpdate(ctx, "hears Стать поставщиком");
  await ctx.reply(
    "🏢 Хотите стать поставщиком Travella?\n\nЗаполните форму на сайте и дождитесь модерации:\n" +
      `${SITE_URL}\n\nМы свяжемся с вами по указанным контактам.`
  );
});

/* ===================== PROVIDER MENU: МОИ УСЛУГИ ===================== */

bot.hears(/🧳 Мои услуги/i, async (ctx) => {
  logUpdate(ctx, "hears Мои услуги");
  forceCloseEditWizard(ctx);
  resetServiceWizard(ctx);


  const role = await ensureProviderRole(ctx);
  if (role !== "provider") {
    await ctx.reply(
      "🧳 «Мои услуги» доступны только поставщикам.\n\nЕсли хотите размещать туры/отели — зарегистрируйтесь как поставщик на сайте:\n" +
        `${SITE_URL}`
    );
    return;
  }

await ctx.reply("🧳 Выберите действие:", {
  reply_markup: {
    inline_keyboard: [
      [{ text: "📤 Выбрать мою услугу", switch_inline_query_current_chat: "#my refused_tour" }],
      [{ text: "🖼 Карточками", callback_data: "prov_services:list_cards" }],
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
    // ✅ ВАЖНО: сбрасываем edit-wizard, чтобы создание НЕ перехватывалось редактированием
    ctx.session.editWiz = null;
    ctx.session.editDraft = null;
    ctx.session.editingServiceId = null;
    
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
  await ctx.answerCbQuery();

  // 🔴 принудительно закрываем wizard
  forceCloseEditWizard(ctx);

  // просто переиспользуем существующую логику
  return ctx.telegram.sendMessage(
    ctx.chat.id,
    "🧳 Выберите действие:",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📤 Выбрать мою услугу", switch_inline_query_current_chat: "#my refused_tour" }],
          [{ text: "🖼 Карточками", callback_data: "prov_services:list_cards" }],
          [{ text: "➕ Создать услугу", callback_data: "prov_services:create" }],
          [{ text: "⬅️ Назад", callback_data: "prov_services:back" }],
        ],
      },
    }
  );
});


bot.action("prov_services:list_cards", async (ctx) => {
  try {
    await ctx.answerCbQuery();
        // 🔴 ВАЖНО: принудительно закрываем wizard редактирования
    forceCloseEditWizard(ctx);

    const role = await ensureProviderRole(ctx);
    if (role !== "provider") {
      await safeReply(ctx, "⚠️ Раздел доступен только поставщикам.", getMainMenuKeyboard("client"));
      return;
    }

    const actorId = getActorId(ctx);
    if (!actorId) {
      await safeReply(
        ctx,
        "⚠️ Не удалось определить пользователя. Откройте бота в ЛС и попробуйте ещё раз."
      );
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

    await safeReply(
      ctx,
      `✅ Найдено услуг: ${data.items.length}.\nПоказываю первые 10 (по ближайшей дате).`
    );

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
      const details = parseDetailsAny(svc.details);

      const { text, photoUrl } = buildServiceMessage(svc, category, "provider");
      const status = svc.status || "draft";
      const isActive = isServiceActual(details, svc);
      const expirationRaw = details.expiration || svc.expiration || null;

      const headerLines = [];
      headerLines.push(
        escapeMarkdown(`#${svc.id} · ${CATEGORY_LABELS[category] || "Услуга"}`)
      );
      const isPending =
        svc.status === "pending" || svc.moderation_status === "pending";
      const isRejected =
        svc.status === "rejected" || svc.moderation_status === "rejected";

      const moderationComment =
        svc.moderation_comment ||
        svc.moderationComment ||
        null;

      let statusLabel = status;

      if (isPending) statusLabel = "⏳ На модерации";
      if (isRejected) statusLabel = "❌ Отклонено";
      
      headerLines.push(
        escapeMarkdown(
          `Статус: ${statusLabel}${!isPending && !isRejected && !isActive ? " (неактуально)" : ""}`
        )
      );
      
      if (isRejected && moderationComment) {
        headerLines.push(
          escapeMarkdown(`Причина: ${moderationComment}`)
        );
      }
      
      if (expirationRaw) headerLines.push(escapeMarkdown(`Актуально до: ${expirationRaw}`));

      const msg = headerLines.join("\n") + "\n\n" + text;
      const manageUrl = `${SITE_URL}/dashboard?from=tg&service=${svc.id}`;

const keyboard = {
  inline_keyboard: [
    [
      { text: "✏️ Редактировать", callback_data: `svc_edit_start:${svc.id}` },
      { text: "⏳ Продлить", callback_data: `svc_extend:${svc.id}` },
    ],
    [
      { text: "⛔ Снять", callback_data: `svc_unpublish:${svc.id}` },
      { text: "🗄 Архивировать", callback_data: `svc_archive:${svc.id}` },
    ],
    [
      { text: "🌐 Открыть в кабинете", url: manageUrl },
    ],
  ],
};



      if (photoUrl) {
        try {
          if (photoUrl.startsWith("tgfile:")) {
            const fileId = photoUrl.replace(/^tgfile:/, "");
            await ctx.replyWithPhoto(fileId, {
              caption: msg,
              parse_mode: "Markdown",
              reply_markup: keyboard,
            });
          } else {
            await ctx.replyWithPhoto(photoUrl, {
              caption: msg,
              parse_mode: "Markdown",
              reply_markup: keyboard,
            });
          }
        } catch (e) {
          console.error(
            "[tg-bot] replyWithPhoto failed, fallback to text:",
            e?.response?.data || e?.message || e
          );
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
    console.error(
      "[tg-bot] provider services error:",
      e?.response?.data || e?.message || e
    );
    await safeReply(ctx, "⚠️ Не удалось загрузить услуги. Попробуйте позже.");
  }
});

/* ===================== SERVICE ACTION BUTTONS ===================== */

bot.action(/^svc_extend:(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery("⏳ Продлеваю…");
    const serviceId = Number(ctx.match[1]);
    const actorId = getActorId(ctx);

    await axios.post(
      `/api/telegram/provider/${actorId}/services/${serviceId}/extend7`
    );

    await safeReply(ctx, "✅ Услуга продлена на 7 дней.");
  } catch (e) {
    console.error("[tg-bot] svc_extend error:", e?.response?.data || e);
    await safeReply(ctx, "⚠️ Не удалось продлить услугу.");
  }
});

bot.action(/^svc_unpublish:(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery("⛔ Снимаю…");
    const serviceId = Number(ctx.match[1]);
    const actorId = getActorId(ctx);

    await axios.post(
      `/api/telegram/provider/${actorId}/services/${serviceId}/unpublish`
    );

    await safeReply(ctx, "⛔ Услуга снята с публикации.");
  } catch (e) {
    console.error("[tg-bot] svc_unpublish error:", e?.response?.data || e);
    await safeReply(ctx, "⚠️ Не удалось снять услугу.");
  }
});

bot.action(/^svc_archive:(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery("🗄 Архивирую…");
    const serviceId = Number(ctx.match[1]);
    const actorId = getActorId(ctx);

    await axios.post(
      `/api/telegram/provider/${actorId}/services/${serviceId}/archive`
    );

    await safeReply(ctx, "🗄 Услуга архивирована.");
  } catch (e) {
    console.error("[tg-bot] svc_archive error:", e?.response?.data || e);
    await safeReply(ctx, "⚠️ Не удалось архивировать услугу.");
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
    if (!cur || !(String(cur).startsWith("svc_create_") || String(cur).startsWith("svc_hotel_")))
      return;

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

// ⏭ Пропустить шаг при СОЗДАНИИ услуги.
// Важно: пропуск разрешён только для опциональных полей.
bot.action("svc_wiz:skip", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const state = String(ctx.session?.state || "");
    const draft = ctx.session?.serviceDraft;
    if (!state || !draft) {
      await safeReply(ctx, "⚠️ Нечего пропускать. Начните создание услуги заново.");
      return;
    }

    const category = String(draft.category || "");

    const tourOrder = [
      "svc_create_title",
      "svc_create_tour_country",
      "svc_create_tour_from",
      "svc_create_tour_to",
      "svc_create_tour_start",
      "svc_create_tour_end",
      "svc_create_flight_departure",
      "svc_create_flight_return",
      "svc_create_flight_details",
      "svc_create_tour_hotel",
      "svc_create_tour_accommodation",
      "svc_create_price",
      "svc_create_grossPrice",
      "svc_create_expiration",
      "svc_create_photo",
    ];

    const hotelOrder = [
      "svc_hotel_country",
      "svc_hotel_city",
      "svc_hotel_name",
      "svc_hotel_checkin",
      "svc_hotel_checkout",
      "svc_hotel_roomcat",
      "svc_hotel_accommodation",
      "svc_hotel_food",
      "svc_hotel_halal",
      "svc_hotel_transfer",
      "svc_hotel_changeable",
      "svc_hotel_pax",
      "svc_create_price",
      "svc_create_grossPrice",
      "svc_create_expiration",
      "svc_create_photo",
    ];

    const isHotelFlow = category === "refused_hotel" || state.startsWith("svc_hotel_");
    const order = isHotelFlow ? hotelOrder : tourOrder;

    // какие шаги реально можно пропустить кнопкой
    const optional = new Set([
      "svc_create_flight_departure",
      "svc_create_flight_return",
      "svc_create_flight_details",
      "svc_create_grossPrice",
      "svc_create_expiration", // можно поставить "нет" (кнопка = быстрый переход)
      "svc_create_photo",
    ]);

    if (!optional.has(state)) {
      await safeReply(ctx, "⚠️ Этот шаг обязателен — его нельзя пропустить.", wizNavKeyboard());
      return;
    }

    // спец-логика: пропуск = записать дефолт/пустое и перейти дальше
    if (state === "svc_create_grossPrice") {
      draft.grossPrice = null;
    }
    if (state === "svc_create_expiration") {
      draft.expiration = null;
    }
    if (state === "svc_create_flight_departure") {
      draft.departureFlightDate = null;
    }
    if (state === "svc_create_flight_return") {
      draft.returnFlightDate = null;
    }
    if (state === "svc_create_flight_details") {
      draft.flightDetails = null;
    }

    // Иногда пользователи нажимают кнопку «Пропустить» под старым сообщением,
    // когда ctx.session.state уже успел измениться. Чтобы не получать
    // «Уже нечего пропускать», делаем явные переходы для optional-шагов.
    const forcedNext =
      state === "svc_create_flight_departure"
        ? "svc_create_flight_return"
        : state === "svc_create_flight_return"
          ? "svc_create_flight_details"
          : state === "svc_create_flight_details"
            ? "svc_create_tour_hotel"
            : state === "svc_create_grossPrice"
              ? "svc_create_expiration"
              : state === "svc_create_expiration"
                ? "svc_create_photo"
                : null;

    const idx = order.indexOf(state);
    const nextState = forcedNext || (idx >= 0 ? order[idx + 1] : null);

    // если пропускаем фото — сразу финализируем без фото
    if (state === "svc_create_photo") {
      draft.images = [];
      draft.telegramPhotoFileId = null;
      await finishCreateServiceFromWizard(ctx);
      return;
    }

    if (!nextState) {
      await safeReply(ctx, "⚠️ Уже нечего пропускать на этом шаге.");
      return;
    }

    pushWizardState(ctx, state);
    ctx.session.state = nextState;
    await promptWizardState(ctx, nextState);
  } catch (e) {
    console.error("[tg-bot] svc_wiz:skip error:", e?.response?.data || e);
    await safeReply(ctx, "⚠️ Ошибка при пропуске. Попробуйте ещё раз.");
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
          "⚠️ Создание через бот пока доступно только для «Отказной тур» и «Отказной отель».\n\n" +
            "Для остальных категорий используйте личный кабинет:\n" +
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
    ctx.session.pendingRequestSource = "inline";
    ctx.session.state = "awaiting_request_message";

    await ctx.answerCbQuery();

    await safeReply(
      ctx,
      "📩 *Быстрый запрос*\n\nНапишите сообщение по услуге:\n• пожелания\n• даты\n• количество человек\n\n" +
        "Если контактный номер отличается от Telegram — добавьте его в сообщение.",
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    console.error("[tg-bot] request action error:", e);
  }
});

/* ===================== REQUEST STATUS (manager buttons) ===================== */
bot.action(/^reqst:(\d+):(new|accepted|booked|rejected)$/, async (ctx) => {
try {
  if (!MANAGER_CHAT_ID || !isManagerChat(ctx)) {
    await ctx.answerCbQuery("⛔ Недостаточно прав", { show_alert: true });
    return;
  }

  const requestId = Number(ctx.match[1]);
  const status = String(ctx.match[2]);
  const statusLabel = statusLabelForManager(status);

  const ok = await updateReqStatus(requestId, status);
  if (!ok) {
    await ctx.answerCbQuery("⚠️ Не удалось обновить статус", { show_alert: true });
    return;
  }

  await ctx.answerCbQuery(statusLabel);

  // 🔁 Обновляем текст сообщения (показываем новый статус)
  try {
    const currentText = ctx.update.callback_query.message.text;
    const updatedText = replaceStatusLine(currentText, statusLabel);
    await ctx.editMessageText(updatedText, { parse_mode: "Markdown" });
  } catch (_) {}

  // ❌ Убираем кнопки, чтобы не нажимали повторно
  try {
    await ctx.editMessageReplyMarkup(undefined);
  } catch (_) {}

} catch (e) {
  console.error("[tg-bot] reqst action error:", e);
  try {
    await ctx.answerCbQuery("Ошибка", { show_alert: true });
  } catch {}
}
});

bot.action(/^reqreply:(\d+)$/, async (ctx) => {
  try {
    if (!MANAGER_CHAT_ID || !isManagerChat(ctx)) {
      await ctx.answerCbQuery("⛔ Недостаточно прав", { show_alert: true });
      return;
    }

    const requestId = Number(ctx.match[1]);

    if (!ctx.session) ctx.session = {};
    ctx.session.state = "awaiting_manager_reply";
    ctx.session.managerReplyRequestId = requestId;

    await ctx.answerCbQuery("✍️ Напишите ответ текстом");

    await ctx.reply(
      `✍️ Ответ менеджера по заявке #${requestId}\n\n` +
      `Отправьте одним сообщением текст, который нужно переслать клиенту.`
    );
  } catch (e) {
    console.error("[tg-bot] reqreply action error:", e?.message || e);
    try { await ctx.answerCbQuery("Ошибка", { show_alert: true }); } catch {}
  }
});

bot.action(/^reqadd:(\d+)$/, async (ctx) => {
  try {
    const requestId = Number(ctx.match[1]);
    if (!ctx.session) ctx.session = {};

    ctx.session.state = "awaiting_request_add";
    ctx.session.activeRequestId = requestId;

    await ctx.answerCbQuery();
    await ctx.reply(`💬 Дополнение к заявке #${requestId}\n\nНапишите сообщение — я отправлю менеджеру.`);
  } catch (e) {
    console.error("[tg-bot] reqadd action error:", e?.message || e);
    try { await ctx.answerCbQuery("Ошибка", { show_alert: true }); } catch {}
  }
});

bot.action(/^reqhist:(\d+)$/, async (ctx) => {
  try {
    if (!MANAGER_CHAT_ID || !isManagerChat(ctx)) {
      await ctx.answerCbQuery("⛔ Недостаточно прав", { show_alert: true });
      return;
    }

    const requestId = Number(ctx.match[1]);

    const req = await getReqById(requestId);
    if (!req) {
      await ctx.answerCbQuery("Заявка не найдена", { show_alert: true });
      return;
    }

    const msgs = await getReqMessages(requestId, 30);

    const header =
      `📜 *История по заявке #${requestId}*\n` +
      `Услуга ID: *${escapeMarkdown(String(req.service_id))}*\n` +
      `Статус: ${statusLabelForManager(req.status || "new")}\n`;

    if (!msgs.length) {
      await ctx.answerCbQuery();
      await ctx.reply(header + "\n\n(сообщений пока нет)", { parse_mode: "Markdown" });
      return;
    }

    const lines = msgs.map((m) => {
      const role = m.sender_role === "manager" ? "🧑‍💼 Менеджер" : "👤 Клиент";
      const when = formatTashkentTime(m.created_at);
      const txt = escapeMarkdown(String(m.text || ""));
      const whenLine = when ? `_${escapeMarkdown(when)}_` : "";
      return `*${role}* ${whenLine}\n${txt}`;
    });

    // Telegram лимит ~4096 символов. Чтоб не упасть — обрежем безопасно.
    let body = lines.join("\n\n");
    const maxLen = 3500;
    if (body.length > maxLen) body = body.slice(body.length - maxLen);

    await ctx.answerCbQuery();
    await ctx.reply(header + "\n\n" + body, { parse_mode: "Markdown" });
  } catch (e) {
    console.error("[tg-bot] reqhist action error:", e?.message || e);
    try { await ctx.answerCbQuery("Ошибка", { show_alert: true }); } catch {}
  }
});


// ✅ Alias для кнопок из deep-link карточек (refused_<id>), где callback_data = quick:<id>
bot.action(/^quick:(\d+)$/, async (ctx) => {
  try {
    const serviceId = Number(ctx.match[1]);
    if (!ctx.session) ctx.session = {};
    ctx.session.pendingRequestServiceId = serviceId;
    ctx.session.pendingRequestSource = "deeplink";
    ctx.session.state = "awaiting_request_message";

    await ctx.answerCbQuery();

    await safeReply(
      ctx,
      "📩 *Быстрый запрос*\n\nНапишите сообщение по услуге:\n• пожелания\n• даты\n• количество человек\n\n" +
        "Если контактный номер отличается от Telegram — добавьте его в сообщение.",
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    console.error("[tg-bot] quick action error:", e);
    try { await ctx.answerCbQuery("Ошибка. Попробуйте ещё раз", { show_alert: true }); } catch {}
  }
});


/* ===================== TEXT HANDLER (wizard + quick request) ===================== */


// Делегат для обработки текста в wizard-режиме редактирования услуги.
// Возвращает true, если сообщение было обработано и дальше по роутеру идти не нужно.
async function handleSvcEditWizardText(ctx) {
  try {
    const textRaw = (ctx.message?.text || "").trim();
    const text = textRaw;

    // ✅ ВОТ ЭТО КРИТИЧНО: state объявлен ДО ЛЮБОГО использования
    const legacy = String(ctx.session?.state || "");
    const editStep = String(ctx.session?.editWiz?.step || "");
    
    // ✅ если идёт создание — не даём edit-wizard перехватить ввод
    const state = legacy.startsWith("svc_create_") || legacy.startsWith("svc_hotel_")
      ? legacy
      : (editStep || legacy);
    
    // Если это НЕ режим редактирования — выходим
    if (!state.startsWith("svc_edit_")) return false;

    // ✅ черновик услуги
    const draft = ctx.session?.serviceDraft || {};
    ctx.session.serviceDraft = draft;

    const keep = () => {
      const v = String(text || "").toLowerCase().trim();
      return v === "пропустить" || v === "skip" || v === "-" || v === "—";
    };

    const isNo = () => {
      const v = String(text || "").toLowerCase().trim();
      return v === "нет" || v === "no" || v === "none" || v === "null";
    };

    const parseYesNoLocal = () => {
      const raw = String(text || "").toLowerCase().trim();
      // берём первое "слово" без эмодзи/знаков
      const v = raw
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .trim()
        .split(/\s+/)[0];
    
      if (["да", "y", "yes", "true", "1"].includes(v)) return true;
      if (["нет", "n", "no", "false", "0"].includes(v)) return false;
      return null;
    };

    const parseNum = () => {
      const v = String(text || "").replace(",", ".").trim();
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const parsePax = () => {
      const v = String(text || "").trim();
      const m = v.match(/^(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)$/);
      if (!m) return null;
      return { adt: Number(m[1]), chd: Number(m[2]), inf: Number(m[3]) };
    };

    // ✅ универсальная навигация: и new, и legacy
    const go = async (nextState, message) => {
      ctx.session.wizardStack = Array.isArray(ctx.session.wizardStack) ? ctx.session.wizardStack : [];
      ctx.session.wizardStack.push(state);

      ctx.session.editWiz = ctx.session.editWiz || {};
      ctx.session.editWiz.step = nextState;

      ctx.session.state = nextState; // legacy sync
      await safeReply(ctx, message, editWizNavKeyboard());
    };

    // ---- MAIN EDIT ROUTER ----
    switch (state) {
      case "svc_edit_title": {
        if (!keep()) draft.title = text;

        if (draft.category === "refused_hotel") {
          await go(
            "svc_edit_hotel_country",
            `🌍 Страна (текущее: ${draft.country || "(пусто)"}).\nВведите новую или нажмите «⏭ Пропустить»:`
          );
          return true;
        }

        await go(
          "svc_edit_tour_country",
          `🌍 Страна направления (текущее: ${draft.country || "(пусто)"}).\nВведите новую или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      // ---------- TOURS ----------
      case "svc_edit_tour_country": {
        if (!keep()) draft.country = text;
        await go("svc_edit_tour_from", `🛫 Город вылета (текущее: ${draft.fromCity || "(пусто)"}).\nВведите новый или нажмите «⏭ Пропустить»:`);
        return true;
      }

      case "svc_edit_tour_from": {
        if (!keep()) draft.fromCity = text;
        await go("svc_edit_tour_to", `🛬 Город прибытия (текущее: ${draft.toCity || "(пусто)"}).\nВведите новый или нажмите «⏭ Пропустить»:`);
        return true;
      }

      case "svc_edit_tour_to": {
        if (!keep()) draft.toCity = text;
        await go("svc_edit_tour_start", `📅 Дата начала (текущее: ${draft.startDate || "(пусто)"}).\nYYYY-MM-DD или YYYY.MM.DD или нажмите «⏭ Пропустить»:`);
        return true;
      }

      case "svc_edit_tour_start": {
        if (!keep()) {
          const norm = normalizeDateInput(text);
          if (!norm) {
            await safeReply(ctx, "⚠️ Нужна дата: YYYY-MM-DD или YYYY.MM.DD. Или «пропустить».", editWizNavKeyboard());
            return true;
          }
          draft.startDate = norm;
        }
        await go("svc_edit_tour_end", `📅 Дата окончания (текущее: ${draft.endDate || "(пусто)"}).\nYYYY-MM-DD или YYYY.MM.DD или нажмите «⏭ Пропустить»:`);
        return true;
      }

      case "svc_edit_tour_end": {
        if (!keep()) {
          const norm = normalizeDateInput(text);
          if (!norm) {
            await safeReply(ctx, "⚠️ Нужна дата: YYYY-MM-DD или YYYY.MM.DD. Или «пропустить».", editWizNavKeyboard());
            return true;
          }
          draft.endDate = norm;
        }

        await go(
          "svc_edit_flight_departure",
          `🛫 Дата рейса вылета (текущее: ${draft.departureFlightDate || "(нет)"}).\nВведите YYYY-MM-DD или YYYY.MM.DD, или "нет" чтобы убрать, или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_flight_departure": {
        if (!keep()) {
          if (isNo()) {
            draft.departureFlightDate = "";
          } else {
            const norm = normalizeDateInput(text);
            if (!norm) {
              await safeReply(ctx, "⚠️ Нужна дата (YYYY-MM-DD или YYYY.MM.DD) или «нет» / «пропустить».", editWizNavKeyboard());
              return true;
            }
            draft.departureFlightDate = norm;
          }
        }
        await go(
          "svc_edit_flight_return",
          `🛬 Дата рейса обратно (текущее: ${draft.returnFlightDate || "(нет)"}).\nВведите YYYY-MM-DD или YYYY.MM.DD, или "нет" чтобы убрать, или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_flight_return": {
        if (!keep()) {
          if (isNo()) {
            draft.returnFlightDate = "";
          } else {
            const norm = normalizeDateInput(text);
            if (!norm) {
              await safeReply(ctx, "⚠️ Нужна дата (YYYY-MM-DD или YYYY.MM.DD) или «нет» / «пропустить».", editWizNavKeyboard());
              return true;
            }
            draft.returnFlightDate = norm;
          }
        }
        await go(
          "svc_edit_flight_details",
          `✈️ Детали рейса (текущее: ${draft.flightDetails || "(нет)"}).\nВведите текст, или "нет" чтобы убрать, или нажмите «⏭ Пропустить»:`
        );
        return true;
      }

      case "svc_edit_flight_details": {
        if (!keep()) draft.flightDetails = isNo() ? "" : text;
        await go("svc_edit_tour_hotel", `🏨 Отель (текущее: ${draft.hotel || "(пусто)"}).\nВведите новый или нажмите «⏭ Пропустить»:`);
        return true;
      }

      case "svc_edit_tour_hotel": {
        if (!keep()) draft.hotel = text;
        await go("svc_edit_tour_accommodation", `🛏 Размещение (текущее: ${draft.accommodation || "(пусто)"}).\nВведите новое или нажмите «⏭ Пропустить»:`);
        return true;
      }

      case "svc_edit_tour_accommodation": {
        if (!keep()) draft.accommodation = text;
        await go("svc_edit_price", `💰 Цена НЕТТО (текущее: ${draft.price || "(пусто)"}).\nВведите число или нажмите «⏭ Пропустить»:`);
        return true;
      }

      // ---------- REFUSED HOTEL ----------
      case "svc_edit_hotel_country": {
        if (!keep()) draft.country = text;
        await go("svc_edit_hotel_city", `🏙 Город (текущее: ${draft.toCity || "(пусто)"}).\nВведите новый или нажмите «⏭ Пропустить»:`);
        return true;
      }

      case "svc_edit_hotel_city": {
        if (!keep()) draft.toCity = text;
        await go("svc_edit_hotel_name", `🏨 Отель (текущее: ${draft.hotel || "(пусто)"}).\nВведите новый или нажмите «⏭ Пропустить»:`);
        return true;
      }

      case "svc_edit_hotel_name": {
        if (!keep()) draft.hotel = text;
        await go("svc_edit_hotel_checkin", `📅 Дата заезда (текущее: ${draft.startDate || "(пусто)"}).\nYYYY-MM-DD или YYYY.MM.DD или нажмите «⏭ Пропустить»:`);
        return true;
      }

      case "svc_edit_hotel_checkin": {
        if (!keep()) {
          const norm = normalizeDateInput(text);
          if (!norm) {
            await safeReply(ctx, "⚠️ Нужна дата: YYYY-MM-DD или YYYY.MM.DD. Или «пропустить».", editWizNavKeyboard());
            return true;
          }
          draft.startDate = norm;
        }
        await go("svc_edit_hotel_checkout", `📅 Дата выезда (текущее: ${draft.endDate || "(пусто)"}).\nYYYY-MM-DD или YYYY.MM.DD или нажмите «⏭ Пропустить»:`);
        return true;
      }

      case "svc_edit_hotel_checkout": {
        if (!keep()) {
          const norm = normalizeDateInput(text);
          if (!norm) {
            await safeReply(ctx, "⚠️ Нужна дата: YYYY-MM-DD или YYYY.MM.DD. Или «пропустить».", editWizNavKeyboard());
            return true;
          }
          draft.endDate = norm;
        }
        await go("svc_edit_hotel_roomcat", `⭐️ Категория номера (текущее: ${draft.roomCategory || "(пусто)"}).\nВведите или нажмите «⏭ Пропустить»:`);
        return true;
      }

      case "svc_edit_hotel_roomcat": {
        if (!keep()) draft.roomCategory = text;
        await go("svc_edit_hotel_accommodation", `🛏 Размещение (текущее: ${draft.accommodation || "(пусто)"}).\nВведите или нажмите «⏭ Пропустить»:`);
        return true;
      }

      case "svc_edit_hotel_accommodation": {
        if (!keep()) draft.accommodation = text;
        await go("svc_edit_hotel_food", `🍽 Питание (текущее: ${draft.food || "(пусто)"}).\nВведите или нажмите «⏭ Пропустить»:`);
        return true;
      }

      case "svc_edit_hotel_food": {
        if (!keep()) draft.food = text;
        await go("svc_edit_hotel_halal", `🥗 Halal? (текущее: ${draft.halal ? "да" : "нет"}).\nОтветьте да/нет или нажмите «⏭ Пропустить»:`);
        return true;
      }

      case "svc_edit_hotel_halal": {
        if (!keep()) {
          const b = parseYesNoLocal();
          if (b === null) {
            await safeReply(ctx, "⚠️ Ответьте да/нет или «пропустить».", editWizNavKeyboard());
            return true;
          }
          draft.halal = b;
        }
        await go("svc_edit_hotel_transfer", `🚗 Трансфер (текущее: ${draft.transfer || "(пусто)"}).\nВведите или нажмите «⏭ Пропустить»:`);
        return true;
      }

      case "svc_edit_hotel_transfer": {
        if (!keep()) draft.transfer = text;
        await go("svc_edit_hotel_changeable", `🔁 Можно изменения? (текущее: ${draft.changeable ? "да" : "нет"}).\nда/нет или нажмите «⏭ Пропустить»:`);
        return true;
      }

      case "svc_edit_hotel_changeable": {
        if (!keep()) {
          const b = parseYesNoLocal();
          if (b === null) {
            await safeReply(ctx, "⚠️ Ответьте да/нет или «пропустить».", editWizNavKeyboard());
            return true;
          }
          draft.changeable = b;
        }
        await go("svc_edit_hotel_pax", `👥 ADT/CHD/INF (текущее: ${draft.adt ?? 0}/${draft.chd ?? 0}/${draft.inf ?? 0}).\nВведите 2/1/0 или нажмите «⏭ Пропустить»:`);
        return true;
      }

      case "svc_edit_hotel_pax": {
        if (!keep()) {
          const p = parsePax();
          if (!p) {
            await safeReply(ctx, '⚠️ Введите в формате "2/1/0" или «пропустить».', editWizNavKeyboard());
            return true;
          }
          draft.adt = p.adt;
          draft.chd = p.chd;
          draft.inf = p.inf;
        }
        await go("svc_edit_price", `💰 Цена НЕТТО (текущее: ${draft.price || "(пусто)"}).\nВведите число или нажмите «⏭ Пропустить»:`);
        return true;
      }

      // ---------- COMMON FINALS ----------
      case "svc_edit_price": {
        if (!keep()) {
          const n = parseNum();
          if (n === null || n < 0) {
            await safeReply(ctx, "⚠️ Введите корректное число или «пропустить».", editWizNavKeyboard());
            return true;
          }
          draft.price = n;
        }
        await go("svc_edit_grossPrice", `💳 Цена БРУТТО (текущее: ${draft.grossPrice || "(пусто)"}).\nВведите число или нажмите «⏭ Пропустить»:`);
        return true;
      }

      case "svc_edit_grossPrice": {
        if (!keep()) {
          const n = parseNum();
          if (n === null || n < 0) {
            await safeReply(ctx, "⚠️ Введите корректное число или «пропустить».", editWizNavKeyboard());
            return true;
          }
          draft.grossPrice = n;
        }
        await go("svc_edit_expiration", `⏳ Актуально до (YYYY-MM-DD HH:mm) или "нет"\nТекущее: ${draft.expiration || "(нет)"}\nВведите или нажмите «⏭ Пропустить»:`);
        return true;
      }

        case "svc_edit_expiration": {
          if (!keep()) {
            if (isNo()) {
              draft.expiration = null;
            } else {
              const norm = normalizeDateTimeInputHelper(text); // ✅ из helpers/serviceActual
              if (!norm) {
                await safeReply(
                  ctx,
                  "⚠️ Нужна дата: YYYY-MM-DD HH:mm (или YYYY.MM.DD HH:mm) или просто YYYY-MM-DD. Или «нет» / «пропустить».",
                  editWizNavKeyboard()
                );
                return true;
              }
              draft.expiration = norm;
            }
          }
        
          await go(
            "svc_edit_isActive",
            `✅ Активна? (текущее: ${draft.isActive ? "да" : "нет"}).\nда/нет или нажмите «⏭ Пропустить»:`
          );
          return true;
        }

          case "svc_edit_isActive": {
            if (!keep()) {
              const b = parseYesNoLocal();
              if (b === null) {
                await safeReply(ctx, "⚠️ Ответьте да/нет или «пропустить».", editWizNavKeyboard());
                return true;
              }
              draft.isActive = b;
          
              // ✅ ДОБАВИТЬ ВОТ ЭТО:
              if (b === true) {
                const now = new Date();
                const expRaw = draft.expiration || null;
                const exp = expRaw ? parseDateFlexible(expRaw) : null;
                if (!exp || exp.getTime() < now.getTime()) {
                  const next = new Date(now);
                  next.setDate(next.getDate() + 7);
                  draft.expiration = next.toISOString().slice(0, 10);
                }
              }
            }
          
            ctx.session.editWiz = ctx.session.editWiz || {};
            ctx.session.editWiz.step = "svc_edit_images";
            ctx.session.state = "svc_edit_images";
          
            await promptEditState(ctx, "svc_edit_images");
            return true;
          }


      case "svc_edit_images": {
        const raw = (text || "").trim().toLowerCase();

        if (raw === "пропустить" || raw === "skip" || raw === "оставить") {
          await finishEditWizard(ctx);
          return true;
        }

        if (raw === "удалить" || raw === "delete" || raw === "remove") {
          draft.images = [];
          await finishEditWizard(ctx);
          return true;
        }

        await safeReply(ctx, "📷 Пришлите фото сообщением (не как файл).\nИли «пропустить» / «удалить».", editWizNavKeyboard());
        return true;
      }

      default:
        await safeReply(ctx, "🤔 Не понял шаг редактирования. Нажмите ⬅️ Назад или ❌ Отмена.", editWizNavKeyboard());
        return true;
    }
  } catch (e) {
    console.error("handleSvcEditWizardText error:", e);
    try {
      await safeReply(ctx, "⚠️ Ошибка при обработке редактирования. Попробуйте ещё раз.");
    } catch (_) {}
    return true;
  }
}


bot.on("text", async (ctx, next) => {
  try {
    const state = ctx.session?.state || null;

    // ===================== EDIT WIZARD (svc_edit_*) =====================
    // Важно: чтобы редактирование услуг работало как раньше
    if (await handleSvcEditWizardText(ctx)) return;

    // ✅ 0) Менеджер может ответить без кнопок: "#<id> текст"
    if (MANAGER_CHAT_ID && isManagerChat(ctx)) {
      const parsed = parseManagerDirectReply(ctx.message?.text);
      if (parsed?.requestId && parsed?.message) {
        const requestId = Number(parsed.requestId);
        const replyText = String(parsed.message || "").trim();

        if (!replyText) {
          await ctx.reply("⚠️ Пустой ответ. Напишите текст сообщением.");
          return;
        }

        const req = await getReqById(requestId);
        if (!req) {
          await ctx.reply("⚠️ Заявка не найдена (или БД недоступна).");
          return;
        }

        // ✅ лог менеджера
        await logReqMessage({
          requestId,
          senderRole: "manager",
          senderTgId: ctx.from?.id,
          text: replyText,
        });

        // ✅ подтягиваем услугу для клиента (чтобы цена была БРУТТО)
        const svcForClient = await fetchTelegramService(req.service_id, "client");

        let titleLine = "";
        let priceLine = "";

        if (svcForClient) {
          const d = parseDetailsAny(svcForClient.details);
          const title = getServiceDisplayTitle(svcForClient);

          const priceRaw = pickPrice(d, svcForClient, "client"); // ✅ БРУТТО
          const priceWithCur = formatPriceWithCurrency(priceRaw);

          if (title) titleLine = `🏷 ${escapeMarkdown(title)}\n`;
          if (priceWithCur) priceLine = `💳 Цена (брутто): *${escapeMarkdown(priceWithCur)}*\n`;
        }

        const serviceUrl = SERVICE_URL_TEMPLATE
          .replace("{SITE_URL}", SITE_URL)
          .replace("{id}", String(req.service_id));

        const toClientText =
          `💬 Ответ по вашему запросу #${requestId}\n\n` +
          `Услуга ID: ${req.service_id}\n` +
          titleLine +
          priceLine +
          `Ссылка: ${serviceUrl}\n\n` +
          `Сообщение менеджера:\n${escapeMarkdown(replyText)}`;

        try {
          await bot.telegram.sendMessage(Number(req.client_tg_id), toClientText, {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [[
                { text: "💬 Дописать", callback_data: `reqadd:${requestId}` }
              ]]
            }
          });

          await ctx.reply(`✅ Отправлено клиенту (заявка #${requestId}).`);
        } catch (e) {
          console.error("[tg-bot] direct #reply send error:", e?.message || e);
          await ctx.reply("⚠️ Не удалось отправить клиенту. Возможно, клиент не писал боту / запретил сообщения.");
        }

        return; // важно: чтобы это сообщение не обработалось дальше
      }
    }

    // ✅ 1) Ответ менеджера клиенту (после нажатия "✍️ Ответить")
    if (
      MANAGER_CHAT_ID &&
      isManagerChat(ctx) &&
      ctx.session?.state === "awaiting_manager_reply" &&
      ctx.session?.managerReplyRequestId
    ) {
      const requestId = Number(ctx.session.managerReplyRequestId);
      const replyText = (ctx.message?.text || "").trim();

      if (!replyText) {
        await ctx.reply("⚠️ Пустой ответ. Напишите текст сообщением.");
        return;
      }

      const req = await getReqById(requestId);
      if (!req) {
        await ctx.reply("⚠️ Не найдена заявка в БД (или БД недоступна).");
        ctx.session.state = null;
        ctx.session.managerReplyRequestId = null;
        return;
      }

      // ✅ лог менеджера
      await logReqMessage({
        requestId,
        senderRole: "manager",
        senderTgId: ctx.from?.id,
        text: replyText,
      });

      // ✅ подтягиваем услугу для клиента (чтобы цена была БРУТТО)
      const svcForClient = await fetchTelegramService(req.service_id, "client");

      let titleLine = "";
      let priceLine = "";

      if (svcForClient) {
        const d = parseDetailsAny(svcForClient.details);
        const title = getServiceDisplayTitle(svcForClient);

        const priceRaw = pickPrice(d, svcForClient, "client"); // ✅ БРУТТО
        const priceWithCur = formatPriceWithCurrency(priceRaw);

        if (title) titleLine = `🏷 ${escapeMarkdown(title)}\n`;
        if (priceWithCur) priceLine = `💳 Цена (брутто): *${escapeMarkdown(priceWithCur)}*\n`;
      }

      const serviceUrl = SERVICE_URL_TEMPLATE
        .replace("{SITE_URL}", SITE_URL)
        .replace("{id}", String(req.service_id));

      const toClientText =
        `💬 Ответ по вашему запросу #${requestId}\n\n` +
        `Услуга ID: ${req.service_id}\n` +
        titleLine +
        priceLine +
        `Ссылка: ${serviceUrl}\n\n` +
        `Сообщение менеджера:\n${escapeMarkdown(replyText)}`;

      try {
        await bot.telegram.sendMessage(Number(req.client_tg_id), toClientText, {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[
              { text: "💬 Дописать", callback_data: `reqadd:${requestId}` }
            ]]
          }
        });

        await ctx.reply(`✅ Отправлено клиенту (заявка #${requestId}).`);
      } catch (e) {
        console.error("[tg-bot] send to client error:", e?.message || e);
        await ctx.reply("⚠️ Не удалось отправить клиенту. Возможно, клиент не писал боту / запретил сообщения.");
      }

      // ✅ сброс состояния менеджера
      ctx.session.state = null;
      ctx.session.managerReplyRequestId = null;
      return;
    }

    // ✅ 2) Клиент дописывает по существующей заявке (после кнопки "💬 Дописать")
    if (
      ctx.session?.state === "awaiting_request_add" &&
      ctx.session?.activeRequestId
    ) {
      const requestId = Number(ctx.session.activeRequestId);
      const msg = (ctx.message?.text || "").trim();
      const from = ctx.from || {};

      if (!msg) {
        await ctx.reply("⚠️ Пустое сообщение. Напишите текст сообщением.");
        return;
      }

      const req = await getReqById(requestId);
      if (!req) {
        await ctx.reply("⚠️ Заявка не найдена (или БД недоступна).");
        ctx.session.state = null;
        ctx.session.activeRequestId = null;
        return;
      }

      // ✅ Логируем дописку клиента
      await logReqMessage({
        requestId,
        senderRole: "client",
        senderTgId: from?.id,
        text: msg,
      });

      // ✅ (опционально красиво) менеджеру тоже можно показать название + НЕТТО
      // если хочешь — включим отдельно
      if (MANAGER_CHAT_ID) {
        const safeMsg = escapeMarkdown(msg);
        const safeUser = escapeMarkdown(from.username || "нет username");
        const safeFirst = escapeMarkdown(from.first_name || "");
        const safeLast = escapeMarkdown(from.last_name || "");

        await bot.telegram.sendMessage(
          MANAGER_CHAT_ID,
          `➕ *Дополнение по заявке #${escapeMarkdown(String(requestId))}*\n` +
            `Услуга ID: *${escapeMarkdown(String(req.service_id))}*\n\n` +
            `От: ${safeFirst} ${safeLast} (@${safeUser})\n\n` +
            `*Сообщение:*\n${safeMsg}`,
          { parse_mode: "Markdown" }
        );
      }

      await ctx.reply("✅ Дополнение отправлено менеджеру.");

      ctx.session.state = null; // activeRequestId оставляем
      return;
    }

    // ✅ 3) Быстрый запрос
    if (state === "awaiting_request_message" && ctx.session?.pendingRequestServiceId) {
      const serviceId = ctx.session.pendingRequestServiceId;
      const source = ctx.session.pendingRequestSource || null;
      const msg = ctx.message.text;
      const from = ctx.from || {};
      const chatId = ctx.chat.id;

      if (!MANAGER_CHAT_ID) {
        await ctx.reply("⚠️ Быстрый запрос сейчас недоступен. Попробуйте позже.");
      } else {
        const requestId = await createReqRow({ serviceId, from, source });

        // ✅ Логируем сообщение клиента (если БД доступна)
        if (requestId) {
          await logReqMessage({
            requestId,
            senderRole: "client",
            senderTgId: from?.id,
            text: msg,
          });
        }

        const safeFirst = escapeMarkdown(from.first_name || "");
        const safeLast = escapeMarkdown(from.last_name || "");
        const safeUsername = escapeMarkdown(from.username || "нет username");
        const safeMsg = escapeMarkdown(msg);

        const serviceUrl = SERVICE_URL_TEMPLATE
          .replace("{SITE_URL}", SITE_URL)
          .replace("{id}", String(serviceId));

        const textForManager =
          "🆕 *Новый быстрый запрос из Bot Otkaznyx Turov*\n\n" +
          (requestId ? `Заявка ID: *${escapeMarkdown(requestId)}*\n` : "") +
          `Услуга ID: *${escapeMarkdown(serviceId)}*\n` +
          `Ссылка: ${escapeMarkdown(serviceUrl)}\n` +
          `От: ${safeFirst} ${safeLast} (@${safeUsername})\n` +
          `Telegram chatId: \`${chatId}\`\n\n` +
          "*Сообщение:*\n" +
          safeMsg;

        const inline_keyboard = [];

        if (requestId) {
          inline_keyboard.push([
            { text: "✅ Принято", callback_data: `reqst:${requestId}:accepted` },
            { text: "⏳ Забронировано", callback_data: `reqst:${requestId}:booked` },
            { text: "❌ Отклонено", callback_data: `reqst:${requestId}:rejected` },
          ]);

          inline_keyboard.push([
            { text: "✍️ Ответить", callback_data: `reqreply:${requestId}` },
          ]);

          inline_keyboard.push([
            { text: "📜 История", callback_data: `reqhist:${requestId}` },
          ]);
        }

        if (from.username) {
          inline_keyboard.push([
            { text: "💬 Написать пользователю", url: `https://t.me/${String(from.username).replace(/^@/, "")}` },
          ]);
        }

        const replyMarkup = inline_keyboard.length ? { inline_keyboard } : undefined;

        await bot.telegram.sendMessage(MANAGER_CHAT_ID, textForManager, {
          parse_mode: "Markdown",
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        });

        await ctx.reply("✅ Спасибо!\n\nЗапрос отправлен! С вами свяжутся в ближайшее время.");
      }

      ctx.session.state = null;
      ctx.session.pendingRequestServiceId = null;
      ctx.session.pendingRequestSource = null;
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
        case "svc_create_title": {
          const v = await requireTextField(ctx, text, "Название", { min: 2 });
          if (!v) return;
          draft.title = v;
        
          pushWizardState(ctx, "svc_create_title");
          ctx.session.state = "svc_create_tour_country";
          await promptWizardState(ctx, "svc_create_tour_country");
          return;
        }

        case "svc_create_tour_country": {
          const v = await requireTextField(ctx, text, "Страна", { min: 2 });
          if (!v) return;
          draft.country = v;
        
          pushWizardState(ctx, "svc_create_tour_country");
          ctx.session.state = "svc_create_tour_from";
          await promptWizardState(ctx, "svc_create_tour_from");
          return;
        }

        case "svc_create_tour_from": {
          const v = await requireTextField(ctx, text, "Город вылета", { min: 2 });
          if (!v) return;
          draft.fromCity = v;
        
          pushWizardState(ctx, "svc_create_tour_from");
          ctx.session.state = "svc_create_tour_to";
          await promptWizardState(ctx, "svc_create_tour_to");
          return;
        }
          
        case "svc_create_tour_to": {
          const v = await requireTextField(ctx, text, "Город прибытия", { min: 2 });
          if (!v) return;
          draft.toCity = v;
        
          pushWizardState(ctx, "svc_create_tour_to");
          ctx.session.state = "svc_create_tour_start";
          await promptWizardState(ctx, "svc_create_tour_start");
          return;
        }

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
                `Начало: ${draft.startDate}\nУкажите корректную дату окончания.`,
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
          if (["пропустить", "skip", "-", "нет"].includes(low)) {
            draft.departureFlightDate = null;
            pushWizardState(ctx, "svc_create_flight_departure");
            ctx.session.state = "svc_create_flight_return";
            await promptWizardState(ctx, "svc_create_flight_return");
            return;
          }

          const norm = normalizeDateInput(text);
          if (!norm) {
            await ctx.reply(
              "😕 Не понял дату рейса вылета.\nВведите *YYYY-MM-DD* или *YYYY.MM.DD* или нажмите «⏭ Пропустить».",
              { parse_mode: "Markdown", ...wizNavKeyboard() }
            );
            return;
          }
          if (isPastYMD(norm)) {
            await ctx.reply("⚠️ Эта дата уже в прошлом. Укажите будущую дату или нажмите «⏭ Пропустить».", {
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
          if (["пропустить", "skip", "-", "нет"].includes(low)) {
            draft.returnFlightDate = null;
            pushWizardState(ctx, "svc_create_flight_return");
            ctx.session.state = "svc_create_flight_details";
            await promptWizardState(ctx, "svc_create_flight_details");
            return;
          }

          const norm = normalizeDateInput(text);
          if (!norm) {
            await ctx.reply(
              "😕 Не понял дату рейса обратно.\nВведите *YYYY-MM-DD* или *YYYY.MM.DD* или нажмите «⏭ Пропустить».",
              { parse_mode: "Markdown", ...wizNavKeyboard() }
            );
            return;
          }
          if (isPastYMD(norm)) {
            await ctx.reply("⚠️ Эта дата уже в прошлом. Укажите будущую дату или нажмите «⏭ Пропустить».", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
            return;
          }
          if (draft.departureFlightDate && isBeforeYMD(norm, draft.departureFlightDate)) {
            await ctx.reply(
              "⚠️ Дата рейса обратно раньше даты вылета.\n" +
                `Вылет: ${draft.departureFlightDate}\nУкажите корректную дату обратно или нажмите «⏭ Пропустить».`,
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
          draft.flightDetails = ["пропустить", "skip", "-", "нет"].includes(low) ? null : text;
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
        case "svc_hotel_country": {
          const v = await requireTextField(ctx, text, "Страна", { min: 2 });
          if (!v) return;
          draft.country = v;
        
          pushWizardState(ctx, "svc_hotel_country");
          ctx.session.state = "svc_hotel_city";
          await promptWizardState(ctx, "svc_hotel_city");
          return;
        }
        
        case "svc_hotel_city": {
          const v = await requireTextField(ctx, text, "Город", { min: 2 });
          if (!v) return;
          draft.toCity = v;
        
          pushWizardState(ctx, "svc_hotel_city");
          ctx.session.state = "svc_hotel_name";
          await promptWizardState(ctx, "svc_hotel_name");
          return;
        }

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
                `Заезд: ${draft.startDate}\nУкажите корректную дату выезда.`,
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
            await ctx.reply("😕 Ответьте `да` или `нет`.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
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
            await ctx.reply("😕 Ответьте `да` или `нет`.", {
              parse_mode: "Markdown",
              ...wizNavKeyboard(),
            });
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
            await ctx.reply(
              "😕 Не понял формат. Введите строго *ADT/CHD/INF*, например *2/1/0*.",
              { parse_mode: "Markdown", ...wizNavKeyboard() }
            );
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
              "😕 Не понял дату актуальности.\nВведите *YYYY-MM-DD HH:mm* или *YYYY.MM.DD HH:mm* или `нет`.",
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
          await ctx.reply("🖼 Отправьте фото сообщением (как картинку) или нажмите «⏭ Пропустить».", {
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
        "⚠️ Произошла ошибка.\nПопробуйте ещё раз или начните заново через «🧳 Мои услуги» → «➕ Создать услугу»."
      );
    } catch (_) {}
  }

  return next();
});

/* ===================== PHOTO HANDLER (wizard create) ===================== */

bot.on("photo", async (ctx, next) => {
  try {
    // 1) Фото в режиме редактирования изображений услуги
    if (await handleSvcEditWizardPhoto(ctx)) return;

    // 1b) Фото в старом режиме редактирования (если где-то ещё используется ctx.session.state)
    const legacyState = ctx.session?.state;
    const legacyDraft = ctx.session?.serviceDraft;
    if (legacyState === "svc_edit_images" && legacyDraft) {
      const photos = ctx.message?.photo;
      const best = Array.isArray(photos) && photos.length ? photos[photos.length - 1] : null;
      const fileId = best?.file_id;

      if (!fileId) {
        await safeReply(ctx, "⚠️ Не удалось получить file_id. Отправьте фото ещё раз.");
        return;
      }

      const tgRef = `tg:${fileId}`;
      if (!Array.isArray(legacyDraft.images)) legacyDraft.images = [];
      legacyDraft.images.push(tgRef);

      await safeReply(
        ctx,
        `✅ Фото добавлено. Сейчас в услуге: ${legacyDraft.images.length} шт.\n\nОтправьте ещё фото или нажмите «✅ Готово».`,
        buildEditImagesKeyboard(legacyDraft)
      );
      return;
    }


    // 2) Фото в мастере создания услуги (текущий мастер использует ctx.session.state)
    const state = ctx.session?.state;
    const draft = ctx.session?.serviceDraft;

    // Поддержка двух вариантов (на случай старого/другого кода):
    // - state === "svc_create_photo" (актуальный мастер)
    // - ctx.session.wiz.step === "create_images" (если где-то ещё используется)
    const wizStep = ctx.session?.wiz?.step;
    const isCreatePhotoStep = state === "svc_create_photo" || wizStep === "create_images";

    if (!isCreatePhotoStep || !draft) return next();

    const photos = ctx.message?.photo;
    const best = Array.isArray(photos) && photos.length ? photos[photos.length - 1] : null;
    const fileId = best?.file_id;

    if (!fileId) {
      await safeReply(ctx, "⚠️ Не удалось получить file_id. Отправьте фото ещё раз.");
      return;
    }

    const tgRef = `tg:${fileId}`;
    if (!Array.isArray(draft.images)) draft.images = [];
    draft.images.push(tgRef);
    draft.telegramPhotoFileId = fileId;

    // В мастере создания «Отказной тур/отель» по UX ожидается одно фото.
    // После получения фото — финализируем создание.
    if (state === "svc_create_photo") {
      await finishCreateServiceFromWizard(ctx);
      return;
    }

    // fallback (если где-то ещё используется многофото режим)
    await safeReply(ctx, `✅ Фото добавлено. Сейчас выбрано: ${draft.images.length} шт.`);
  } catch (e) {
    console.error("photo handler error:", e);
    await safeReply(ctx, "⚠️ Ошибка при обработке фото. Попробуйте ещё раз.");
  }
});

bot.on("inline_query", async (ctx) => {
  try {
    logUpdate(ctx, "inline_query");

    const qRaw = ctx.inlineQuery?.query || "";
    const q = String(qRaw).trim().toLowerCase();

    // ✅ "#tour refused_tour" или "#my refused_tour"
    const parts = q.split(/\s+/).filter(Boolean);
    const tag = parts[0] || "";
    const tokenCat = parts[1] || "";
    const isMy = tag === "#my";

    let category = "refused_tour";
    if (REFUSED_CATEGORIES.includes(tokenCat)) {
      category = tokenCat;
    } else {
      if (q.startsWith("#hotel")) category = "refused_hotel";
      else if (q.startsWith("#flight")) category = "refused_flight";
      else if (q.startsWith("#ticket")) category = "refused_ticket";
      else if (q.startsWith("#tour")) category = "refused_tour";
      else {
        if (q.includes("отель") || q.includes("hotel")) category = "refused_hotel";
        else if (q.includes("авиа") || q.includes("flight") || q.includes("avia")) category = "refused_flight";
        else if (q.includes("билет") || q.includes("ticket")) category = "refused_ticket";
        else category = "refused_tour";
      }
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

    // === INLINE CACHE KEYS ===
    const baseKey = `inline:${isMy ? "my" : "search"}:${roleForInline}:${userId}:${category || "all"}`;

    // отдельно кэшируем:
    // 1) сырой ответ API (короткий TTL)
    // 2) уже собранные inline-results (чуть длиннее, потому что там дорого: thumbs + message build)
    const apiKey = `${baseKey}:api`;
    const resKey = `${baseKey}:res:v4`;

    // === PAGINATION (Telegram offset) ===
    const offset = Number(String(ctx.inlineQuery?.offset || "0").trim() || 0) || 0;
    const pageSize = 10;        // можно 10/20, 10 обычно ок
    const maxBuild = 50;        // Telegram лимит, и у тебя уже slice(0, 50)

    // 1) пробуем отдать results из кэша (самый быстрый путь)
    const cachedRes = cacheGet(resKey);
    if (cachedRes && Array.isArray(cachedRes.resultsAll)) {
      const resultsAll = cachedRes.resultsAll;
      const page = resultsAll.slice(offset, offset + pageSize);
      const nextOffset = offset + pageSize < resultsAll.length ? String(offset + pageSize) : "";

      await ctx.answerInlineQuery(page, {
        cache_time: 1,
        is_personal: true,
        next_offset: nextOffset,
      });
      return;
    }

    // 2) иначе — берём API-данные через inflight-dedup
    const data = await getOrFetchCached(
      apiKey,
      12000, // TTL для API (короткий)
      async () => {
        if (isMy) {
          const resp = await axios.get(`/api/telegram/provider/${userId}/services`);
          return resp.data;
        } else {
          const resp = await axios.get(`/api/telegram/client/${userId}/search`, {
            params: { category },
          });
          return resp.data;
        }
      }
    );

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

    // DEBUG
    const DEBUG_INLINE = String(process.env.DEBUG_INLINE || "").trim() === "1";
    if (DEBUG_INLINE) {
      console.log("\n[tg-bot][inline] qRaw =", qRaw);
      console.log("[tg-bot][inline] isMy =", isMy, "category =", category, "role =", roleForInline);
      console.log("[tg-bot][inline] items from API =", data.items.length);
    }

    let itemsForInline = Array.isArray(data.items) ? data.items : [];

    // если категория указана токеном — фильтруем
    if (category && REFUSED_CATEGORIES.includes(category)) {
      itemsForInline = itemsForInline.filter(
        (svc) => String(svc.category || svc.type || "").trim() === category
      );
    }

    if (isMy) {
      itemsForInline = itemsForInline.filter(
        (svc) => String(svc.status || "").toLowerCase() !== "archived"
      );
    } else {
      itemsForInline = itemsForInline.filter((svc) => {
        try {
          const det = parseDetailsAny(svc.details);
          // ✅ подхватываем существующие изображения услуги
          let imagesArr = svc.images ?? [];
          if (typeof imagesArr === "string") {
            try {
              imagesArr = JSON.parse(imagesArr);
            } catch {
              imagesArr = imagesArr ? [imagesArr] : [];
            }
          }
          if (!Array.isArray(imagesArr)) imagesArr = [];

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

    function placeholderKindByCategory(category) {
      const c = String(category || "").toLowerCase();
      if (c === "refused_tour") return "tour";
      if (c === "refused_hotel") return "hotel";
      if (c === "refused_flight") return "flight";
      if (c === "refused_ticket" || c === "refused_event_ticket") return "ticket";
      return "default";
    }

    const TG_PLACEHOLDER = (kind = "default") =>
      `${TG_IMAGE_BASE}/api/telegram/placeholder/${encodeURIComponent(kind)}.png`;
    const results = [];

    for (const svc of itemsSorted.slice(0, 50)) {
      const svcCategory = svc.category || category || "refused_tour";

      const { text, photoUrl, serviceUrl } = buildServiceMessage(
        svc,
        svcCategory,
        roleForInline
      );
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
        ],
      };

      // ✅ thumb_url: только реальный публичный https (и НЕ placeholder)
      let thumbUrl = null;
      
      if (photoUrl && photoUrl.startsWith("tgfile:")) {
        const fileId = photoUrl.replace(/^tgfile:/, "").trim();
        try {
          thumbUrl = await getPublicThumbUrlFromTgFile(bot, fileId);
        } catch {
          thumbUrl = null;
        }
      } else if (photoUrl && (photoUrl.startsWith("http://") || photoUrl.startsWith("https://"))) {
        // ✅ inline thumb должен быть публичным и желательно https
        let u = photoUrl;
      // ✅ если ссылка пришла через SITE_URL (/api/...), переписываем на прямой TG_IMAGE_BASE
        if (u.startsWith(SITE_URL + "/api/")) {
          u = TG_IMAGE_BASE + u.slice(SITE_URL.length);
        }

        // если это наш сервисный эндпоинт - просим миниатюру
        if (u.includes("/api/telegram/service-image/")) {
          u = u.includes("?") ? `${u}&thumb=1` : `${u}?thumb=1`;
        }
      
        // Telegram thumb_url: лучше строго https
        if (u.startsWith("http://")) {
          // если у тебя в проде реально https — лучше чтобы сюда никогда не попадало
          // но на всякий случай не отправляем http как thumb
          thumbUrl = null;
        } else {
          thumbUrl = u;
        }
      }
      
      const phKind = placeholderKindByCategory(svcCategory);
      const finalThumbUrl =
        typeof thumbUrl === "string" && thumbUrl.startsWith("https://")
          ? thumbUrl
          : TG_PLACEHOLDER(phKind);

      // ✅ Точечный фикс по задаче:
      // - убираем "Отказной тур" как заголовок по умолчанию
      // - если есть hotel/hotelName — используем его как title в inline-карточке
      const det = parseDetailsAny(svc.details);
      const hotelForTitle = (det.hotel || det.hotelName || "").trim();

      const titleSource =
        hotelForTitle ||
        (typeof svc.title === "string" ? svc.title.trim() : "") ||
        "Услуга";

      const title = truncate(normalizeTitleSoft(titleSource), 60);

      console.log("[inline]", {
        svcId: svc.id,
        photoUrl,
        thumbUrl,
        finalThumbUrl,
      });

      results.push({
        id: `${svcCategory}:${svc.id}`,
        type: "article",
        title,
        description,
        input_message_content: {
          message_text: text,
          disable_web_page_preview: true,
        },
        // ✅ Всегда показываем картинку слева в выдаче (thumb)
        thumb_url: finalThumbUrl,
        reply_markup: isMy ? keyboardForMy : keyboardForClient,
      });
    }

          // ✅ Кэшируем уже собранные results (дорого пересобирать thumbs)
      cacheSet(resKey, { resultsAll: results }, 30000);
      
      // ✅ Pagination: Telegram offset
      const page = results.slice(offset, offset + pageSize);
      const nextOffset = offset + pageSize < results.length ? String(offset + pageSize) : "";
      
      try {
        await ctx.answerInlineQuery(page, {
          cache_time: 11,
          is_personal: true,
          next_offset: nextOffset,
        });
      } catch (e) {
        console.error(
          "[tg-bot] answerInlineQuery FAILED:",
          e?.response?.data || e?.message || e
        );
        try {
          await ctx.answerInlineQuery([], {
            cache_time: 1,
            is_personal: true,
            switch_pm_text: "⚠️ Ошибка inline (открыть бота)",
            switch_pm_parameter: "start",
          });
        } catch {}
      }
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

// ⚠️ здесь НЕТ 
/* ===================== EDIT IMAGES (ADD/REMOVE/CLEAR) ===================== */

bot.action(/^svc_edit_img_(?:remove|del):(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const idx = Number(ctx.match[1]);
    const draft =
      ctx.session?.editDraft ||
      ctx.session?.serviceDraft ||
      null;

    if (!draft || !Array.isArray(draft.images)) {
      await safeReply(ctx, "⚠️ Изображения не найдены.");
      return;
    }
    if (Number.isNaN(idx) || idx < 0 || idx >= draft.images.length) {
      await safeReply(ctx, "⚠️ Некорректный номер изображения.");
      return;
    }

    draft.images.splice(idx, 1);

    await safeReply(
      ctx,
      `✅ Удалено. Сейчас в услуге: ${draft.images.length} шт.\\n\\nОтправьте новое фото или нажмите «✅ Готово».`,
      buildEditImagesKeyboard(draft)
    );
  } catch (e) {
    console.error("svc_edit_img_remove error:", e);
    await safeReply(ctx, "⚠️ Не удалось удалить изображение.");
  }
});

bot.action("svc_edit_img_clear", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const draft =
      ctx.session?.editDraft ||
      ctx.session?.serviceDraft ||
      null;

    if (!draft) {
      await safeReply(ctx, "⚠️ Черновик услуги не найден.");
      return;
    }

    draft.images = [];

    await safeReply(
      ctx,
      "🧹 Все изображения очищены. Пришлите новое фото или нажмите «✅ Готово».",
      buildEditImagesKeyboard(draft)
    );
  } catch (e) {
    console.error("svc_edit_img_clear error:", e);
    await safeReply(ctx, "⚠️ Не удалось очистить изображения.");
  }
});

bot.action("svc_edit_img_done", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    if (!ctx.session) ctx.session = {};

    // ✅ переходим на шаг подтверждения, а НЕ сохраняем сразу
    ctx.session.state = "svc_edit_confirm";
    ctx.session.editWiz = ctx.session.editWiz || {};
    ctx.session.editWiz.step = "svc_edit_confirm";

    await promptEditState(ctx, "svc_edit_confirm");
  } catch (e) {
    console.error("svc_edit_img_done error:", e);
    await safeReply(ctx, "⚠️ Не удалось завершить редактирование изображений.");
  }
});

// bot.launch() — запуск делаем из index.js

bot.action("svc_edit_save", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    if (!ctx.session) ctx.session = {};
    await finishEditWizard(ctx);
  } catch (e) {
    console.error("svc_edit_save error:", e);
    await safeReply(ctx, "⚠️ Ошибка при сохранении изменений.");
  }
});

bot.action("svc_edit_continue", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    if (!ctx.session) ctx.session = {};

    // возвращаемся к первому шагу редактирования (можно поменять на любой другой)
    ctx.session.state = "svc_edit_title";
    ctx.session.editWiz = ctx.session.editWiz || {};
    ctx.session.editWiz.step = "svc_edit_title";

    await promptEditState(ctx, "svc_edit_title");
  } catch (e) {
    console.error("svc_edit_continue error:", e);
    await safeReply(ctx, "⚠️ Не удалось продолжить редактирование.");
  }
});


module.exports = { bot };
