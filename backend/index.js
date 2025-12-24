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

/* ===================== INLINE CACHE ===================== */

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

/* ===================== INIT BOT ===================== */

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
  if (ctx.chat?.id) return ctx.reply(text, extra);
  const uid = ctx.from?.id;
  if (!uid) return;
  return bot.telegram.sendMessage(uid, text, extra);
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

function editImagesKeyboard(images = []) {
  const rows = [];

  if (images.length) {
    const delRow = images.map((_, i) => ({
      text: `❌ ${i + 1}`,
      callback_data: `svc_edit_img_del:${i}`,
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
  const step = ctx.session?.editWiz?.step;
  const draft = ctx.session?.serviceDraft;

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
        `📝 Название (текущее: ${draft.title || "(пусто)"}).\nВведите новую или "пропустить":`,
        editWizNavKeyboard()
      );
      return;

    // TOURS
    case "svc_edit_tour_country":
      await safeReply(
        ctx,
        `🌍 Страна направления (текущее: ${draft.country || "(пусто)"}).\nВведите новую или "пропустить":`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_tour_from":
      await safeReply(
        ctx,
        `🛫 Город вылета (текущее: ${draft.fromCity || "(пусто)"}).\nВведите новый или "пропустить":`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_tour_to":
      await safeReply(
        ctx,
        `🛬 Город прибытия (текущее: ${draft.toCity || "(пусто)"}).\nВведите новый или "пропустить":`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_tour_start":
      await safeReply(
        ctx,
        `📅 Дата начала (текущее: ${draft.startDate || "(пусто)"}).\nФормат YYYY-MM-DD или "пропустить":`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_tour_end":
      await safeReply(
        ctx,
        `📅 Дата окончания (текущее: ${draft.endDate || "(пусто)"}).\nФормат YYYY-MM-DD или "пропустить":`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_flight_departure":
      await safeReply(
        ctx,
        `🛫 Дата рейса вылета (текущее: ${draft.departureFlightDate || "(нет)"}).\nВведите YYYY-MM-DD, или "нет" чтобы убрать, или "пропустить":`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_flight_return":
      await safeReply(
        ctx,
        `🛬 Дата рейса обратно (текущее: ${draft.returnFlightDate || "(нет)"}).\nВведите YYYY-MM-DD, или "нет" чтобы убрать, или "пропустить":`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_flight_details":
      await safeReply(
        ctx,
        `✈️ Детали рейса (текущее: ${draft.flightDetails || "(нет)"}).\nВведите текст, или "нет" чтобы убрать, или "пропустить":`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_tour_hotel":
      await safeReply(
        ctx,
        `🏨 Отель (текущее: ${draft.hotel || "(пусто)"}).\nВведите новый или "пропустить":`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_tour_accommodation":
      await safeReply(
        ctx,
        `🛏 Размещение (текущее: ${draft.accommodation || "(пусто)"}).\nВведите новое или "пропустить":`,
        editWizNavKeyboard()
      );
      return;

    // REFUSED HOTEL
    case "svc_edit_hotel_country":
      await safeReply(
        ctx,
        `🌍 Страна (текущее: ${draft.country || "(пусто)"}).\nВведите новую или "пропустить":`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_hotel_city":
      await safeReply(
        ctx,
        `🏙 Город (текущее: ${draft.toCity || "(пусто)"}).\nВведите новый или "пропустить":`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_hotel_name":
      await safeReply(
        ctx,
        `🏨 Отель (текущее: ${draft.hotel || "(пусто)"}).\nВведите новый или "пропустить":`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_hotel_checkin":
      await safeReply(
        ctx,
        `📅 Дата заезда (текущее: ${draft.startDate || "(пусто)"}).\nYYYY-MM-DD или "пропустить":`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_hotel_checkout":
      await safeReply(
        ctx,
        `📅 Дата выезда (текущее: ${draft.endDate || "(пусто)"}).\nYYYY-MM-DD или "пропустить":`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_hotel_roomcat":
      await safeReply(
        ctx,
        `⭐️ Категория номера (текущее: ${draft.roomCategory || "(пусто)"}).\nВведите или "пропустить":`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_hotel_accommodation":
      await safeReply(
        ctx,
        `🛏 Размещение (текущее: ${draft.accommodation || "(пусто)"}).\nВведите или "пропустить":`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_hotel_food":
      await safeReply(
        ctx,
        `🍽 Питание (текущее: ${draft.food || "(пусто)"}).\nВведите или "пропустить":`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_hotel_halal":
      await safeReply(
        ctx,
        `🥗 Halal? (текущее: ${draft.halal ? "да" : "нет"}).\nОтветьте да/нет или "пропустить":`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_hotel_transfer":
      await safeReply(
        ctx,
        `🚗 Трансфер (текущее: ${draft.transfer || "(пусто)"}).\nВведите или "пропустить":`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_hotel_changeable":
      await safeReply(
        ctx,
        `🔁 Можно изменения? (текущее: ${draft.changeable ? "да" : "нет"}).\nда/нет или "пропустить":`,
        editWizNavKeyboard()
      );
      return;
    case "svc_edit_hotel_pax":
      await safeReply(
        ctx,
        `👥 ADT/CHD/INF (текущее: ${draft.adt ?? 0}/${draft.chd ?? 0}/${draft.inf ?? 0}).\nВведите 2/1/0 или "пропустить":`,
        editWizNavKeyboard()
      );
      return;
      
    // IMAGES
    case "svc_edit_images": {
        const raw = (text || "").trim().toLowerCase();

        if (["готово", "ok", "okay", "done", "finish"].includes(raw)) {
          ctx.session.editWiz = ctx.session.editWiz || {};
          ctx.session.editWiz.step = "svc_edit_confirm";
          ctx.session.state = "svc_edit_confirm";
          await safeReply(ctx, "✅ Ок. Теперь можно продолжить редактирование или сохранить изменения.", {
            reply_markup: {
              inline_keyboard: [
                [{ text: "💾 Сохранить", callback_data: "svc_edit_confirm_save" }],
                [{ text: "✏️ Продолжить редактирование", callback_data: "svc_edit_confirm_continue" }],
                [{ text: "❌ Отмена", callback_data: "svc_edit_confirm_cancel" }],
              ],
            },
          });
          return true;
        }

        await safeReply(
          ctx,
          "📷 Пришлите фото сообщением (как картинку).\nУдаление/очистка — кнопками ниже.\nКогда закончите — нажмите «✅ Готово».",
          buildEditImagesKeyboard(draft)
        );
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
  if (await handleSvcEditWizardText(ctx)) return;

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
          "✅ Спасибо!\n\nЗапрос отправлен менеджеру Travella.\nМы свяжемся с вами в ближайшее время."
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
              "😕 Не понял дату рейса вылета.\nВведите *YYYY-MM-DD* или *YYYY.MM.DD* или *пропустить*.",
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
              "😕 Не понял дату рейса обратно.\nВведите *YYYY-MM-DD* или *YYYY.MM.DD* или *пропустить*.",
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
                `Вылет: ${draft.departureFlightDate}\nУкажите корректную дату обратно или *пропустить*.`,
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


    // 2) Фото в мастере создания услуги
    const wizStep = ctx.session?.wiz?.step;
    const state = ctx.session?.state;
    const draft = ctx.session?.serviceDraft;

    const isCreateImages =
      (state === "svc_create_photo" && !!draft) ||
      (wizStep === "create_images" && !!draft);

    if (!isCreateImages) {
      return next();
    }

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

    await safeReply(
      ctx,
      `✅ Фото добавлено. Сейчас выбрано: ${draft.images.length} шт.\n\nОтправьте ещё фото или напишите «готово».`
    );
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

    const cacheKey = `${isMy ? "my" : "search"}:${roleForInline}:${userId}:${category}`;
    let data = cacheGet(cacheKey);

    if (!data) {
      if (isMy) {
        const resp = await axios.get(`/api/telegram/provider/${userId}/services`);
        data = resp.data;
      } else {
        const resp = await axios.get(`/api/telegram/client/${userId}/search`, {
          params: { category },
        });
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
          [{ text: "🔁 Открыть меню в боте", url: buildBotStartUrl() }],
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

      
      const inlinePhotoUrl =
        typeof thumbUrl === "string" && thumbUrl.startsWith("https://")
          ? thumbUrl
          : null;


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
        inlinePhotoUrl,
      });

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
        ...(inlinePhotoUrl ? { thumb_url: inlinePhotoUrl } : {}),
        reply_markup: isMy ? keyboardForMy : keyboardForClient,
      });
    }

    try {
      await ctx.answerInlineQuery(results, { cache_time: 3, is_personal: true });
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

bot.action(/^svc_edit_img_remove:(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const idx = Number(ctx.match[1]);
    const draft =
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

    // Переходим в подтверждение/выбор следующего поля.
    if (ctx.session?.editWiz) {
      ctx.session.editWiz.step = "svc_edit_confirm";
    } else {
      ctx.session.state = "svc_edit_confirm";
    }

    await safeReply(ctx, "✅ Ок. Теперь можно продолжить редактирование или сохранить изменения.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "💾 Сохранить", callback_data: "svc_edit_confirm_save" }],
          [{ text: "✏️ Продолжить редактирование", callback_data: "svc_edit_confirm_continue" }],
          [{ text: "❌ Отмена", callback_data: "svc_edit_confirm_cancel" }],
        ],
      },
    });
  } catch (e) {
    console.error("svc_edit_img_done error:", e);
    await safeReply(ctx, "⚠️ Не удалось завершить редактирование изображений.");
  }
});

// bot.launch() — запуск делаем из index.js
module.exports = { bot };
