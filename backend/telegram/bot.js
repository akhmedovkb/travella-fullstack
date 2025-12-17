// backend/telegram/bot.js

require("dotenv").config();
const { Telegraf, session } = require("telegraf");
const axiosBase = require("axios");

// ==== CONFIG ====

const CLIENT_TOKEN = process.env.TELEGRAM_CLIENT_BOT_TOKEN || "";

if (!CLIENT_TOKEN) {
  throw new Error(
    "TELEGRAM_CLIENT_BOT_TOKEN is required for backend/telegram/bot.js"
  );
}

const BOT_TOKEN = CLIENT_TOKEN;

// Публичный URL Travella для кнопок "Подробнее"
const SITE_URL = (
  process.env.SITE_PUBLIC_URL ||
  process.env.SITE_URL ||
  "https://travella.uz"
).replace(/\/+$/, "");

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

// ВАЖНО: Telegram скачивает photoUrl снаружи. Поэтому для картинок нужен публичный URL (https://...).
const API_PUBLIC_BASE = (
  process.env.API_PUBLIC_URL ||
  process.env.SITE_API_PUBLIC_URL ||
  process.env.API_BASE_PUBLIC_URL ||
  process.env.SITE_API_URL || // если он у тебя публичный
  ""
).replace(/\/+$/, "");

console.log("=== BOT.JS LOADED ===");
console.log("[tg-bot] Using TELEGRAM_CLIENT_BOT_TOKEN (polling)");
console.log("[tg-bot] API_BASE =", API_BASE);
console.log("[tg-bot] API_PUBLIC_BASE =", API_PUBLIC_BASE || "(not set)");
console.log("[tg-bot] SITE_URL =", SITE_URL);
console.log(
  "[tg-bot] MANAGER_CHAT_ID =",
  MANAGER_CHAT_ID ? MANAGER_CHAT_ID : "(not set)"
);
console.log("[tg-bot] PRICE_CURRENCY =", PRICE_CURRENCY);

// axios инстанс
const axios = axiosBase.create({
  baseURL: API_BASE,
  timeout: 10000,
});

// ==== INIT BOT ====

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// ==== HELPERS ====

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

  // если в строке уже есть нижний регистр — считаем, что всё ок
  if (/[a-zа-яё]/.test(s)) return s;

  // заменяем только "слова" из букв
  return s.replace(/[A-Za-zА-ЯЁа-яё]+/g, (w) => {
    if (w.length <= 3) return w; // аббревиатуры
    // если слово целиком в верхнем регистре — нормализуем
    if (w === w.toUpperCase()) {
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }
    return w;
  });
}

// ✅ Санитизация странных разделителей (’n / 'n / &n) → стрелка
// Используем для дат И направления
function normalizeWeirdSeparator(s) {
  if (!s) return s;
  return String(s)
    .replace(/\s*['’]n\s*/gi, " → ")
    .replace(/\s*&n\s*/gi, " → ")
    .replace(/\s+→\s+/g, " → ")
    .trim();
}

// ✅ совместимость со старым названием (если где-то осталось)
function normalizeDateSeparator(s) {
  return normalizeWeirdSeparator(s);
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

async function safeReply(ctx, text, extra) {
  // обычное сообщение — можно reply
  if (ctx.chat?.id) return ctx.reply(text, extra);

  // callback из inline — шлём в ЛС пользователю
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
    console.log("[tg-bot]", label, {
      type,
      subTypes,
      fromId,
      username,
    });
  } catch (_) {}
}

// Маппинг подписей для категорий
const CATEGORY_LABELS = {
  refused_tour: "Отказной тур",
  refused_hotel: "Отказной отель",
  refused_flight: "Отказной авиабилет",
  refused_ticket: "Отказной билет",
};

/**
 * Даты
 */

// нормализуем дату: 2025-12-15 / 2025.12.15 / 2025/12/15 -> 2025-12-15
function normalizeDateInput(raw) {
  if (!raw) return null;
  const txt = String(raw).trim();

  if (/^нет$/i.test(txt)) return null;

  const m = txt.match(/^(\d{4})[.\-/](\d{2})[.\-/](\d{2})$/);
  if (!m) return null;

  const [, y, mm, dd] = m;
  return `${y}-${mm}-${dd}`;
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
    d.startFlightDate ||
    d.departureFlightDate ||
    d.startDate ||
    d.start_flight_date;
  return parseDateSafe(raw);
}

/**
 * Картинки
 *
 * В services.images у нас могут быть:
 * - base64 data:image...
 * - http(s) URL
 * - относительный /path
 * - "tg:<file_id>" (если фото добавлено через Telegram)
 *
 * Для обычных сообщений можно слать file_id напрямую.
 * Для inline thumb_url нужен только http(s), поэтому tg:file_id там игнорируем.
 */
function getFirstImageUrl(svc) {
  let arr = svc.images;

  if (!arr) return null;

  if (typeof arr === "string") {
    try {
      const parsed = JSON.parse(arr);
      arr = parsed;
    } catch {
      arr = [arr];
    }
  }

  if (!Array.isArray(arr) || !arr.length) return null;

  let v = arr[0];

  if (v && typeof v === "object") {
    v = v.url || v.src || v.path || v.location || v.href || null;
  }

  if (typeof v !== "string") return null;
  v = v.trim();
  if (!v) return null;

  // ✅ поддержка tg:fileId (из мастера)
  if (v.startsWith("tg:")) {
    const fileId = v.slice(3).trim();
    if (!fileId) return null;
    return `tgfile:${fileId}`; // спец-маркер, ниже обработаем
  }

  // base64 (data:image/...) — отдаём через наш прокси-роут
  if (v.startsWith("data:image")) {
    // Telegram должен видеть URL снаружи (не 127.0.0.1)
    if (!API_PUBLIC_BASE) return null;
    return `${API_PUBLIC_BASE}/api/telegram/service-image/${svc.id}`;
  }

  // Полный URL
  if (v.startsWith("http://") || v.startsWith("https://")) {
    return v;
  }

  // Относительный путь от корня сайта
  if (v.startsWith("/")) {
    return SITE_URL + v;
  }

  return null;
}

// выбираем цену в зависимости от роли
function pickPrice(details, svc, role) {
  const d = details || {};
  if (role === "provider") {
    // поставщик видит нетто
    return d.netPrice ?? d.price ?? d.grossPrice ?? svc.price ?? null;
  }
  // клиент — брутто
  return d.grossPrice ?? d.price ?? d.netPrice ?? svc.price ?? null;
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

  // ✅ заголовок
  const titleRaw = svc.title || CATEGORY_LABELS[category] || "Услуга";
  const titlePretty = normalizeTitleSoft(titleRaw);
  const title = escapeMarkdown(titlePretty);

  // Направление (страна/города) + чистим странные ’n
  const directionParts = [];
  const from = d.directionFrom ? normalizeWeirdSeparator(d.directionFrom) : null;
  const to = d.directionTo ? normalizeWeirdSeparator(d.directionTo) : null;
  const country = d.directionCountry ? normalizeWeirdSeparator(d.directionCountry) : null;

  if (from && to) {
    directionParts.push(
      `${escapeMarkdown(from)} → ${escapeMarkdown(to)}`
    );
  } else if (from) {
    directionParts.push(escapeMarkdown(from));
  } else if (to) {
    directionParts.push(escapeMarkdown(to));
  }
  if (country) directionParts.push(escapeMarkdown(country));

  const direction =
    directionParts.length > 0 ? directionParts.join(" · ") : null;

  // Даты: маркетплейс-стандарт (если есть обе — покажем диапазон; если одна — "Дата:")
  const startRaw =
    d.startFlightDate ||
    d.departureFlightDate ||
    d.startDate ||
    null;

  const endRaw =
    d.endFlightDate ||
    d.returnFlightDate ||
    d.endDate ||
    null;

  const startClean = startRaw ? normalizeWeirdSeparator(startRaw) : null;
  const endClean = endRaw ? normalizeWeirdSeparator(endRaw) : null;

  let dates = null;
  if (startClean && endClean && String(startClean) !== String(endClean)) {
    dates = `Даты: ${escapeMarkdown(startClean)} → ${escapeMarkdown(endClean)}`;
  } else if (startClean) {
    dates = `Дата: ${escapeMarkdown(startClean)}`;
  }

  // Отель
  const hotel = d.hotel || d.hotelName || null;
  const hotelSafe = hotel ? escapeMarkdown(hotel) : null;

  // Размещение
  const accommodation = d.accommodation || null;
  const accommodationSafe = accommodation ? escapeMarkdown(accommodation) : null;

  // Цена (по роли) + валюта
  const priceRaw = pickPrice(d, svc, role);
  const priceWithCur = formatPriceWithCurrency(priceRaw);
  const price =
    priceWithCur !== null && priceWithCur !== undefined
      ? escapeMarkdown(priceWithCur)
      : null;

  const priceLabel = role === "provider" ? "Цена (netto)" : "Цена";

  // Поставщик + Telegram
  const providerNameRaw = svc.provider_name || "Поставщик Travella";
  const providerName = escapeMarkdown(providerNameRaw);
  const providerTelegram = svc.provider_telegram || null;

  let providerLine;
  let telegramLine = null;

  const providerId = svc.provider_id || svc.providerId || svc.provider?.id || null;
  const providerProfileUrl = providerId ? `${SITE_URL}/profile/provider/${providerId}` : null;

  if (providerProfileUrl) {
    providerLine = `Поставщик: [${providerName}](${providerProfileUrl})`;
  } else {
    providerLine = `Поставщик: ${providerName}`;
  }

  if (providerTelegram) {
    let username = String(providerTelegram).trim();
    username = username.replace(/^@/, "");
    username = username.replace(/^https?:\/\/t\.me\//i, "");
    const mdUsername = escapeMarkdown(username);
    telegramLine = `Telegram: @${mdUsername}`;
  }


  // ✅ URL на конкретную карточку (как на сайте)
  const serviceUrl = `${SITE_URL}?service=${svc.id}`;
  // Если у тебя уже есть прямой маршрут — лучше так:
  // const serviceUrl = `${SITE_URL}/service/${svc.id}`;

  const lines = [];
  lines.push(`*${title}*`);
  if (direction) lines.push(direction);
  if (dates) lines.push(dates);
  if (hotelSafe) lines.push(`Отель: ${hotelSafe}`);
  if (accommodationSafe) lines.push(`Размещение: ${accommodationSafe}`);
  if (price) lines.push(`${priceLabel}: *${price}*`);
  lines.push(providerLine);
  if (telegramLine) lines.push(telegramLine);
  lines.push("");
  lines.push(`Подробнее и бронирование: ${serviceUrl}`);

  const text = lines.join("\n");
  const photoUrl = getFirstImageUrl(svc);

  return { text, photoUrl, serviceUrl };
}

// ---- helper: доопределить роль поставщика по chatId, если сессия пуста ----
async function ensureProviderRole(ctx) {
  if (ctx.session?.role === "provider") {
    return "provider";
  }
  const chatId = ctx.chat?.id;
  if (!chatId) return ctx.session?.role || null;

  try {
    const resProv = await axios.get(`/api/telegram/profile/provider/${chatId}`);
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
    // ignore 404
    if (e?.response?.status !== 404) {
      console.log("[tg-bot] resolveRoleByUserId error:", e?.response?.data || e.message || e);
    }
  }
  return "client";
}

/* ===================== SERVICE WIZARD (создание refused_tour) ===================== */

function resetServiceWizard(ctx) {
  if (!ctx.session) return;
  ctx.session.state = null;
  ctx.session.serviceDraft = null;
  ctx.session.wizardStack = null;
}

function parseYesNo(text) {
  const t = text.trim().toLowerCase();
  if (["да", "ha", "xa", "yes", "y"].includes(t)) return true;
  if (["нет", "yo'q", "yoq", "yo‘q", "yok", "no", "n"].includes(t))
    return false;
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

// собираем details для refused_tour из draft
function buildDetailsForRefusedTour(draft, priceNum) {
  return {
    title: draft.title || "",
    directionCountry: draft.country || "",
    directionFrom: draft.fromCity || "",
    directionTo: draft.toCity || "",
    startDate: draft.startDate || "",
    endDate: draft.endDate || "",
    hotel: draft.hotel || "",
    accommodation: draft.accommodation || "",
    netPrice: priceNum,
    grossPrice:
      typeof draft.grossPriceNum === "number" ? draft.grossPriceNum : null,
    expiration: draft.expiration || null,
    isActive: true,
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
  if (prevState && String(prevState).startsWith("svc_create_")) {
    ctx.session.wizardStack.push(prevState);
  }
}

async function promptWizardState(ctx, state) {
  // На каждом шаге даём одинаковые кнопки "Назад/Отмена"
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
        {
          parse_mode: "Markdown",
          ...wizNavKeyboard(),
        }
      );
      return;

    case "svc_create_price":
      await ctx.reply(
        "💰 Укажите *цену НЕТТО* (за тур)\n" + "Пример: *1130* или *1130 USD*",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_create_gross_price":
      await ctx.reply(
        "💳 Укажите *цену БРУТТО* (за тур)\n" + "Пример: *1250* или *1250 USD*",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_create_expiration":
      await ctx.reply(
        "⏳ До какой даты тур *актуален*?\n" +
          "✅ Формат: *YYYY-MM-DD* или *YYYY.MM.DD*\n" +
          "Или напишите `нет`.",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_create_photo":
      await ctx.reply(
        "🖼 Отправьте *одно фото* тура (одним сообщением)\n" +
          "или напишите `пропустить`.",
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
    if (!draft || draft.category !== "refused_tour") {
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
        "😕 Не понял цену.\n" + "Введите число, например: *1130* или *1130 USD*.",
        { parse_mode: "Markdown" }
      );
      ctx.session.state = "svc_create_price";
      return;
    }

    const grossNum = normalizePrice(draft.grossPrice);
    if (grossNum === null) {
      await ctx.reply(
        "😕 Не понял цену брутто.\n" +
          "Введите число, например: *1250* или *1250 USD*.",
        { parse_mode: "Markdown" }
      );
      ctx.session.state = "svc_create_gross_price";
      return;
    }
    draft.grossPriceNum = grossNum;

    const details = buildDetailsForRefusedTour(draft, priceNum);

    const payload = {
      category: "refused_tour",
      title: draft.title,
      price: priceNum,
      details,
      images: draft.images || [],
    };

    const chatId = ctx.chat.id;

    const { data } = await axios.post(
      `/api/telegram/provider/${chatId}/services`,
      payload
    );

    if (!data || !data.success) {
      console.log("[tg-bot] createServiceFromWizard resp:", data);
      await ctx.reply(
        "⚠️ Не удалось сохранить услугу.\n" +
          "Попробуйте позже или добавьте через кабинет."
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

    // вернём в подменю "Мои услуги"
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

/* ===================== Регистрация / привязка телефона ===================== */

// Основная логика привязки телефона к аккаунту / созданию нового
async function handlePhoneRegistration(ctx, requestedRole, phone) {
  try {
    const chatId = ctx.chat.id;
    const username = ctx.from.username || null;
    const firstName = ctx.from.first_name || null;

    const payload = {
      role: requestedRole,
      phone,
      chatId,
      username,
      firstName,
    };

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

    await ctx.reply(
      "📌 Готово! Меню доступно ниже 👇",
      getMainMenuKeyboard(finalRole)
    );
  } catch (e) {
    console.error("[tg-bot] handlePhoneRegistration error:", e?.response?.data || e);
    await ctx.reply("⚠️ Ошибка привязки номера. Попробуйте позже.");
  }
}

// ==== /start ====

bot.start(async (ctx) => {
  logUpdate(ctx, "/start");
  const chatId = ctx.chat.id;

  try {
    let role = null;

    try {
      const resClient = await axios.get(`/api/telegram/profile/client/${chatId}`);
      if (resClient.data && resClient.data.success) {
        role = "client";
      }
    } catch (e) {
      if (e?.response?.status !== 404) {
        console.log("[tg-bot] profile client error:", e?.response?.data || e.message || e);
      }
    }

    if (!role) {
      try {
        const resProv = await axios.get(`/api/telegram/profile/provider/${chatId}`);
        if (resProv.data && resProv.data.success) {
          role = "provider";
        }
      } catch (e) {
        if (e?.response?.status !== 404) {
          console.log(
            "[tg-bot] profile provider error:",
            e?.response?.data || e.message || e
          );
        }
      }
    }

    if (role) {
      if (!ctx.session) ctx.session = {};
      ctx.session.role = role;
      ctx.session.linked = true;

      await ctx.reply(
        "✅ Аккаунт найден.\n\nВыберите раздел в меню ниже 👇",
        getMainMenuKeyboard(role)
      );
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

// ==== INLINE-роль: "Я клиент" / "Я поставщик" ====

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
    console.error("[tg-bot] role: action error:", e);
  }
});

// ==== CONTACT (кнопка "Отправить мой номер") ====

bot.on("contact", async (ctx) => {
  logUpdate(ctx, "contact");
  const contact = ctx.message.contact;
  if (!contact || !contact.phone_number) {
    await ctx.reply("⚠️ Не удалось прочитать номер. Попробуйте ещё раз.");
    return;
  }

  const phone = contact.phone_number;
  const requestedRole = ctx.session?.requestedRole || "client";

  await handlePhoneRegistration(ctx, requestedRole, phone);
});

// ==== ТЕКСТОВЫЙ ВВОД ТЕЛЕФОНА ====

bot.hears(/^\+?\d[\d\s\-()]{5,}$/i, async (ctx, next) => {
  const st = ctx.session?.state || null;

  // ✅ 1) Если идёт мастер — НЕ глотаем сообщение, а пропускаем дальше в bot.on("text")
  if (st && String(st).startsWith("svc_create_")) {
    return next();
  }

  // ✅ 2) Если это похоже на дату — тоже пропускаем дальше
  const t = String(ctx.message?.text || "").trim();
  if (normalizeDateInput(t)) {
    return next();
  }

  // ✅ 3) Телефон регистрируем только если пользователь реально в режиме привязки
  if (!ctx.session || !ctx.session.requestedRole) {
    return next();
  }

  const phone = t;
  const requestedRole = ctx.session.requestedRole;

  await handlePhoneRegistration(ctx, requestedRole, phone);
});

// ==== ГЛАВНОЕ МЕНЮ: КНОПКИ ====

bot.hears(/🔍 Найти услугу/i, async (ctx) => {
  logUpdate(ctx, "hears Найти услугу");

  await ctx.reply("🔎 Выберите тип услуги:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📍 Отказной тур", callback_data: "find:refused_tour" }],
        [{ text: "🏨 Отказной отель", callback_data: "find:refused_hotel" }],
        [{ text: "✈️ Отказной авиабилет", callback_data: "find:refused_flight" }],
        [{ text: "🎫 Отказной билет", callback_data: "find:refused_ticket" }],
      ],
    },
  });

  await ctx.reply(
    "📤 Хотите отправить отказной тур в любой чат?\n" +
      "Нажмите кнопку ниже, выберите тур — и он отправится в текущий чат.",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📤 Выбрать отказной тур", switch_inline_query_current_chat: "#allotkaztur " }],
        ],
      },
    }
  );
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
      "🏢 Профиль поставщика можно изменить в личном кабинете:\n\n" +
        `${SITE_URL}/dashboard/profile`
    );
    return;
  }

  await ctx.reply(
    "👤 Профиль клиента можно изменить на сайте в разделе «Профиль»:\n\n" +
      `${SITE_URL}`
  );
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

/* ===================== МОИ УСЛУГИ: ПОДМЕНЮ 3 КНОПКИ ===================== */

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

  // показываем подменю
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

// Назад из подменю — в главное меню
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

// Создать услугу из подменю — просто как svc_new
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

// Листинг услуг из подменю
bot.action("prov_services:list", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const role = await ensureProviderRole(ctx);
    if (role !== "provider") {
      await safeReply(
        ctx,
        "⚠️ Раздел доступен только поставщикам.",
        getMainMenuKeyboard("client")
      );
      return;
    }

    const chatId = ctx.chat.id;

    await safeReply(ctx, "⏳ Загружаю ваши услуги...");

    const { data } = await axios.get(`/api/telegram/provider/${chatId}/services`);

    if (!data || !data.success || !Array.isArray(data.items)) {
      console.log("[tg-bot] provider services malformed:", data);
      await safeReply(ctx, "⚠️ Не удалось загрузить услуги. Попробуйте позже.");
      return;
    }

    if (!data.items.length) {
      await safeReply(
        ctx,
        "Пока нет опубликованных услуг.\n\n" +
          "Нажмите «➕ Создать услугу» или добавьте через кабинет.",
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

      let details = svc.details || {};
      if (typeof details === "string") {
        try {
          details = JSON.parse(details);
        } catch {
          details = {};
        }
      }

      const { text, photoUrl } = buildServiceMessage(svc, category, "provider");

      const status = svc.status || "draft";

      // === ЛОГИКА АКТУАЛЬНОСТИ ===
      let isActive =
        typeof details.isActive === "boolean" ? details.isActive : true;

      const expirationRaw = details.expiration || svc.expiration || null;
      if (expirationRaw) {
        const exp = new Date(expirationRaw);
        if (!Number.isNaN(exp.getTime()) && exp < new Date()) {
          isActive = false;
        }
      }

      const endRaw =
        details.endFlightDate ||
        details.returnFlightDate ||
        details.endDate ||
        null;
      if (endRaw) {
        const ed = new Date(endRaw);
        if (!Number.isNaN(ed.getTime()) && ed < new Date()) {
          isActive = false;
        }
      }

      const headerLines = [];
      headerLines.push(`#${svc.id} · ${CATEGORY_LABELS[category] || "Услуга"}`);
      headerLines.push(`Статус: ${status}${!isActive ? " (неактуально)" : ""}`);
      if (expirationRaw) headerLines.push(`Актуально до: ${expirationRaw}`);

      const msg = headerLines.join("\n") + "\n\n" + text;

      const manageUrl = `${SITE_URL}/dashboard?from=tg&service=${svc.id}`;

      const keyboard = {
        inline_keyboard: [
          [{ text: "✏️ Редактировать", callback_data: `svc:${svc.id}:edit` }],
          [{ text: "🌐 Открыть в кабинете", url: manageUrl }],
          [{ text: "🛑 Снять с продажи", callback_data: `svc:${svc.id}:unpublish` }],
          [
            { text: "♻️ Продлить на 7 дней", callback_data: `svc:${svc.id}:extend7` },
            { text: "📁 Архивировать", callback_data: `svc:${svc.id}:archive` },
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
          await ctx.reply(msg, {
            parse_mode: "Markdown",
            reply_markup: keyboard,
          });
        }
      } else {
        await ctx.reply(msg, {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      }
    }

    // В конце — снова подменю
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
    console.error("[tg-bot] provider services error:", e?.response?.data || e.message || e);
    await safeReply(ctx, "⚠️ Не удалось загрузить услуги. Попробуйте позже.");
  }
});

/* ===================== МАСТЕР: НОВОЕ — Назад/Отмена ===================== */

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
    if (!cur || !String(cur).startsWith("svc_create_")) {
      return;
    }

    const stack = ctx.session?.wizardStack || [];
    const prev = stack.length ? stack.pop() : null;

    if (!prev) {
      // если некуда назад — выходим в подменю
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

/* ===================== НОВОЕ: старт мастера создания услуги ===================== */

bot.action("svc_new", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const role = await ensureProviderRole(ctx);
    if (role !== "provider") {
      await ctx.reply(
        "⚠️ Создавать услуги через бот могут только поставщики.\n\n" +
          "Зарегистрируйтесь как поставщик на сайте:\n" +
          `${SITE_URL}`
      );
      return;
    }

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
          [{ text: "❌ Отмена", callback_data: "svc_wiz:cancel" }],
        ],
      },
    });
  } catch (e) {
    console.error("[tg-bot] svc_new action error:", e);
  }
});

bot.action(
  /^svc_new_cat:(refused_tour|refused_hotel|refused_flight|refused_ticket)$/,
  async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const category = ctx.match[1];

      if (!ctx.session) ctx.session = {};
      if (!ctx.session.serviceDraft) ctx.session.serviceDraft = {};
      ctx.session.serviceDraft.category = category;

      // Полный мастер сейчас реализован ТОЛЬКО для refused_tour
      if (category !== "refused_tour") {
        await ctx.reply(
          "⚠️ Создание через бот пока доступно только для категории «Отказной тур».\n\n" +
            "Для остальных категорий используйте, пожалуйста, личный кабинет:\n" +
            `${SITE_URL}`
        );
        resetServiceWizard(ctx);
        return;
      }

      // стартуем мастер
      ctx.session.wizardStack = [];
      ctx.session.state = "svc_create_title";
      await promptWizardState(ctx, "svc_create_title");
    } catch (e) {
      console.error("[tg-bot] svc_new_cat action error:", e);
    }
  }
);

// ==== ДЕЙСТВИЯ С УСЛУГАМИ ПРОВАЙДЕРА (снять / продлить / архивировать) ====

bot.action(/^svc:(\d+):(unpublish|extend7|archive)$/, async (ctx) => {
  try {
    const serviceId = Number(ctx.match[1]);
    const action = ctx.match[2];
    const chatId = ctx.chat.id;

    await ctx.answerCbQuery();

    let endpoint;
    if (action === "unpublish") {
      endpoint = `/api/telegram/provider/${chatId}/services/${serviceId}/unpublish`;
    } else if (action === "extend7") {
      endpoint = `/api/telegram/provider/${chatId}/services/${serviceId}/extend7`;
    } else {
      endpoint = `/api/telegram/provider/${chatId}/services/${serviceId}/archive`;
    }

    const { data } = await axios.post(endpoint);

    if (!data || !data.success) {
      console.log("[tg-bot] svc action error resp:", data);
      await ctx.reply(
        "⚠️ Не удалось обновить услугу.\n" +
          "Попробуйте позже или выполните действие в кабинете."
      );
      return;
    }

    let msg;
    if (action === "unpublish") {
      msg = "🛑 Услуга снята с продажи и больше не показывается в поиске.";
    } else if (action === "extend7") {
      msg = "♻️ Актуальность продлена на 7 дней. Таймер обновлён в кабинете.";
    } else {
      msg = "📁 Услуга архивирована и скрыта из маркетплейса. При необходимости откройте её в кабинете.";
    }

    await ctx.reply(msg);
  } catch (e) {
    console.error("[tg-bot] svc action handler error:", e?.response?.data || e);
    try {
      await ctx.answerCbQuery("Ошибка, попробуйте ещё раз", { show_alert: true });
    } catch (_) {}
  }
});

// ==== РЕДАКТИРОВАНИЕ УСЛУГИ (пока через кабинет) ====

bot.action(/^svc:(\d+):edit$/, async (ctx) => {
  try {
    const serviceId = Number(ctx.match[1]);
    await ctx.answerCbQuery();

    if (!Number.isFinite(serviceId) || serviceId <= 0) {
      await safeReply(ctx, "⚠️ Некорректный ID услуги.");
      return;
    }

    // ведём сразу в кабинет на нужную услугу
    const editUrl = `${SITE_URL}/dashboard?from=tg&service=${serviceId}`;

    await safeReply(
      ctx,
      `✏️ Редактирование услуги #${serviceId}\n\nОткрываю в кабинете 👇`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🌐 Открыть редактор", url: editUrl }],
            [{ text: "⬅️ Назад к моим услугам", callback_data: "prov_services:list" }],
          ],
        },
      }
    );
  } catch (e) {
    console.error("[tg-bot] svc edit handler error:", e?.response?.data || e);
    try {
      await ctx.answerCbQuery("Ошибка, попробуйте ещё раз", { show_alert: true });
    } catch (_) {}
  }
});

// ==== ПОИСК ОТКАЗНЫХ УСЛУГ (кнопка "Найти услугу") ====

// ✅ FIX: роль определяем через ensureProviderRole, иначе агент видел gross
bot.action(
  /^find:(refused_tour|refused_hotel|refused_flight|refused_ticket)$/,
  async (ctx) => {
    try {
      const category = ctx.match[1];

      await ctx.answerCbQuery();
      logUpdate(ctx, `action search ${category}`);

      // ✅ правильная роль
      const maybeProvider = await ensureProviderRole(ctx);
      const role = maybeProvider || ctx.session?.role || "client";

      const chatId = ctx.chat.id;

      await ctx.reply("⏳ Ищу подходящие предложения...");

      const { data } = await axios.get(`/api/telegram/client/${chatId}/search`, {
        params: { category },
      });

      if (!data || !data.success || !Array.isArray(data.items)) {
        console.log("[tg-bot] search resp malformed:", data);
        await ctx.reply("⚠️ Ошибка загрузки. Попробуйте позже.");
        return;
      }

      if (!data.items.length) {
        await ctx.reply("😕 По этой категории сейчас нет предложений.");
        return;
      }

      await ctx.reply(`✅ Нашёл предложений: ${data.items.length}\nПоказываю топ 10 👇`);

      for (const svc of data.items.slice(0, 10)) {
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
              await ctx.replyWithPhoto(fileId, {
                caption: text,
                parse_mode: "Markdown",
                reply_markup: keyboard,
              });
            } else {
              await ctx.replyWithPhoto(photoUrl, {
                caption: text,
                parse_mode: "Markdown",
                reply_markup: keyboard,
              });
            }
          } catch (e) {
            console.error(
              "[tg-bot] replyWithPhoto failed in search, fallback to text:",
              e?.response?.data || e?.message || e
            );
            await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
          }
        } else {
          await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
        }
      }
    } catch (e) {
      console.error("[tg-bot] error in search:", e?.response?.data || e.message || e);
      await ctx.reply("⚠️ Не удалось загрузить услуги. Попробуйте позже.");
    }
  }
);

// ==== Быстрый запрос ====

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
    console.error("[tg-bot] request: action error:", e);
  }
});

// ==== ОБРАБОТКА ТЕКСТА ====

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

    // 2) мастер создания отказного тура
    if (state && state.startsWith("svc_create_")) {
      const text = ctx.message.text.trim();

      // текстовая отмена тоже работает
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
              "😕 Не понял дату начала.\n" +
                "Введите *YYYY-MM-DD* или *YYYY.MM.DD*, например *2025-12-09*.",
              { parse_mode: "Markdown", ...wizNavKeyboard() }
            );
            return;
          }
          if (isPastYMD(norm)) {
            await ctx.reply(
              "⚠️ Эта дата уже в прошлом.\n" +
                "Укажите будущую дату (*YYYY-MM-DD* или *YYYY.MM.DD*).",
              { parse_mode: "Markdown", ...wizNavKeyboard() }
            );
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
            await ctx.reply(
              "😕 Не понял дату окончания.\n" +
                "Введите *YYYY-MM-DD* или *YYYY.MM.DD*, например *2025-12-15*.",
              { parse_mode: "Markdown", ...wizNavKeyboard() }
            );
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
            await ctx.reply(
              "⚠️ Эта дата уже в прошлом.\n" + "Укажите будущую дату окончания.",
              { parse_mode: "Markdown", ...wizNavKeyboard() }
            );
            return;
          }
          draft.endDate = normEnd;
          pushWizardState(ctx, "svc_create_tour_end");
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

        case "svc_create_price":
          draft.price = text;
          pushWizardState(ctx, "svc_create_price");
          ctx.session.state = "svc_create_gross_price";
          await promptWizardState(ctx, "svc_create_gross_price");
          return;

        case "svc_create_gross_price": {
          draft.grossPrice = text;
          pushWizardState(ctx, "svc_create_gross_price");
          ctx.session.state = "svc_create_expiration";
          await promptWizardState(ctx, "svc_create_expiration");
          return;
        }

        case "svc_create_expiration": {
          const lower = text.trim().toLowerCase();
          const normExp = normalizeDateInput(text);

          if (normExp === null && lower !== "нет") {
            await ctx.reply(
              "😕 Не понял дату актуальности.\n" +
                "Введите *YYYY-MM-DD* или *YYYY.MM.DD* (например *2025-12-15*) или `нет`.",
              { parse_mode: "Markdown", ...wizNavKeyboard() }
            );
            return;
          }

          if (normExp && isPastYMD(normExp)) {
            await ctx.reply(
              "⚠️ Дата актуальности уже в прошлом.\n" +
                "Укажите будущую дату или напишите `нет`.",
              { parse_mode: "Markdown", ...wizNavKeyboard() }
            );
            return;
          }

          draft.expiration = normExp; // может быть null
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
          await ctx.reply(
            "🖼 Отправьте фото сообщением с картинкой или напишите `пропустить`.",
            { parse_mode: "Markdown", ...wizNavKeyboard() }
          );
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

// ==== ОБРАБОТКА ФОТО ДЛЯ МАСТЕРА ====

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

      // ✅ сохраняем "tg:fileId" — затем бот сможет показать это фото в карточке
      ctx.session.serviceDraft.images = [`tg:${fileId}`];

      await finishCreateServiceFromWizard(ctx);
      return;
    }
  } catch (e) {
    console.error("[tg-bot] photo handler error:", e);
  }

  return next();
});

// ==== /tour_123 ====

async function findServiceByIdViaSearch(chatId, serviceId) {
  for (const category of REFUSED_CATEGORIES) {
    try {
      const { data } = await axios.get(`/api/telegram/client/${chatId}/search`, {
        params: { category },
      });

      if (!data || !data.success || !Array.isArray(data.items)) continue;

      const svc = data.items.find((s) => Number(s.id) === Number(serviceId));
      if (svc) {
        return { svc, category };
      }
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
    const chatId = ctx.chat.id;

    // ✅ FIX: корректная роль (агент должен видеть net)
    const maybeProvider = await ensureProviderRole(ctx);
    const role = maybeProvider || ctx.session?.role || "client";

    await ctx.reply("⏳ Ищу по ID...");

    const found = await findServiceByIdViaSearch(chatId, serviceId);

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
          await ctx.replyWithPhoto(fileId, {
            caption: text,
            parse_mode: "Markdown",
            reply_markup: keyboard,
          });
        } else {
          await ctx.replyWithPhoto(photoUrl, {
            caption: text,
            parse_mode: "Markdown",
            reply_markup: keyboard,
          });
        }
      } catch (e) {
        console.error(
          "[tg-bot] replyWithPhoto failed in /tour, fallback to text:",
          e?.response?.data || e?.message || e
        );
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

// ==== INLINE-ПОИСК ====

bot.on("inline_query", async (ctx) => {
  try {
    logUpdate(ctx, "inline_query");

    const q = (ctx.inlineQuery?.query || "").toLowerCase().trim();
    const isMy = q.startsWith("#my");

    let category = "refused_tour";

    if (q.includes("отель") || q.includes("hotel") || q.includes("#hotel")) {
      category = "refused_hotel";
    } else if (q.includes("авиа") || q.includes("flight") || q.includes("avia")) {
      category = "refused_flight";
    } else if (q.includes("билет") || q.includes("ticket")) {
      category = "refused_ticket";
    } else if (
      q.includes("тур") ||
      q.includes("tour") ||
      q.includes("turov") ||
      q.includes("tur")
    ) {
      category = "refused_tour";
    }

    const chatId = ctx.from.id;

    // ✅ FIX: если inline делает агент — показываем net, иначе gross
    const roleForInline = await resolveRoleByUserId(chatId, ctx);

    let data = null;
    if (isMy) {
      // "Мои услуги" доступны только провайдеру
      if (roleForInline !== "provider") {
        await ctx.answerInlineQuery([], { cache_time: 3, is_personal: true });
        return;
      }
      const resp = await axios.get(`/api/telegram/provider/${chatId}/services`);
      data = resp.data;
    } else {
      const resp = await axios.get(`/api/telegram/client/${chatId}/search`, {
        params: { category },
      });
      data = resp.data;
    };

    if (!data || !data.success || !Array.isArray(data.items)) {
      console.log("[tg-bot] inline search resp malformed:", data);
      await ctx.answerInlineQuery([], { cache_time: 3 });
      return;
    }

    const itemsSorted = [...data.items].sort((a, b) => {
      const da = getStartDateForSort(a);
      const db = getStartDateForSort(b);

      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;

      return da.getTime() - db.getTime();
    });

    const results = itemsSorted.slice(0, 25).map((svc, idx) => {
      const svcCategory = (svc.category || svc.type || category);
      const { text, photoUrl, serviceUrl } = buildServiceMessage(
        svc,
        svcCategory,
        roleForInline
      );

      let d = svc.details || {};
      if (typeof d === "string") {
        try {
          d = JSON.parse(d);
        } catch {
          d = {};
        }
      }

      const truncate = (str, n = 40) =>
        str && str.length > n ? str.slice(0, n - 1) + "…" : str;

      const startFlight = d.startFlightDate || d.startDate;
      const endFlight = d.endFlightDate || d.endDate;

      let datesLine = "";
      if (startFlight && endFlight) {
        const sf = String(startFlight).replace(/-/g, ".");
        const ef = String(endFlight).replace(/-/g, ".");
        const raw = `ДАТЫ: ${sf} → ${ef}`;
        datesLine = normalizeWeirdSeparator(raw);
      } else if (startFlight) {
        const sf = String(startFlight).replace(/-/g, ".");
        datesLine = `ДАТА: ${normalizeWeirdSeparator(sf)}`;
      }

      const hotelNameRaw = d.hotel || d.hotelName || "";
      const hotelLine = hotelNameRaw ? `ОТЕЛЬ: ${truncate(hotelNameRaw, 45)}` : "";

      const priceInline = pickPrice(d, svc, roleForInline);
      const priceWithCur = formatPriceWithCurrency(priceInline);
      const priceLabelInline = roleForInline === "provider" ? "ЦЕНА NETTO" : "ЦЕНА";
      const priceLine = priceWithCur ? `${priceLabelInline}: ${priceWithCur}` : "";

      const descParts = [];
      if (datesLine) descParts.push(datesLine);
      if (hotelLine) descParts.push(hotelLine);
      if (priceLine) descParts.push(priceLine);

      let description = descParts.join(" · ");
      if (description.length > 140) description = description.slice(0, 137) + "…";

      // ✅ thumb_url: только http(s), tgfile нельзя
      let thumbUrl = null;
      if (photoUrl && !photoUrl.startsWith("tgfile:")) {
        if (photoUrl.startsWith("http://") || photoUrl.startsWith("https://")) {
          thumbUrl = photoUrl;
        }
      }

      return {
        type: "article",
        id: String(svc.id) + "_" + idx,
        title: normalizeTitleSoft(svc.title) || CATEGORY_LABELS[svcCategory] || "Услуга",
        description,
        thumb_url: thumbUrl || undefined,
        input_message_content: {
          message_text: text,
          parse_mode: "Markdown",
        },
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Подробнее на сайте", url: serviceUrl },
              { text: "📩 Быстрый запрос", callback_data: `request:${svc.id}` },
            ],
          ],
        },
      };
    });

    await ctx.answerInlineQuery(results, {
      cache_time: 5,
      is_personal: true,
      switch_pm_text: "Открыть главное меню бота",
      switch_pm_parameter: "start",
    });
  } catch (e) {
    console.error("[tg-bot] inline_query error:", e?.response?.data || e.message || e);
    try {
      await ctx.answerInlineQuery([], { cache_time: 3 });
    } catch (_) {}
  }
});

// ⚠️ здесь НЕТ bot.launch() — запуск делаем из index.js
module.exports = { bot };
