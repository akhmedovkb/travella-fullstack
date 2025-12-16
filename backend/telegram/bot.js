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

function getMainMenuKeyboard(role) {
  // 👇 для поставщика показываем "Мои услуги" вместо "Стать поставщиком"
  if (role === "provider") {
    return {
      reply_markup: {
        keyboard: [
          [{ text: "🔍 Найти услугу" }, { text: "🧳 Мои услуги" }],
          [{ text: "📄 Мои брони" }, { text: "📨 Мои заявки" }],
          [{ text: "👤 Профиль" }],
        ],
        resize_keyboard: true,
      },
    };
  }

  // 👇 для клиента оставляем старое меню
  return {
    reply_markup: {
      keyboard: [
        [{ text: "🔍 Найти услугу" }, { text: "❤️ Избранное" }],
        [{ text: "📄 Мои брони" }, { text: "📨 Мои заявки" }],
        [{ text: "👤 Профиль" }, { text: "🏢 Стать поставщиком" }],
      ],
      resize_keyboard: true,
    },
  };
}

async function askRole(ctx) {
  await ctx.reply("Кем вы пользуетесь Travella?", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🤖 Я клиент", callback_data: "role:client" }],
        [{ text: "🏢 Я поставщик", callback_data: "role:provider" }],
      ],
    },
  });
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

  const titleRaw = svc.title || CATEGORY_LABELS[category] || "Услуга";
  const title = escapeMarkdown(titleRaw);

  // Направление
  const directionParts = [];
  if (d.directionFrom && d.directionTo) {
    directionParts.push(
      `${escapeMarkdown(d.directionFrom)} → ${escapeMarkdown(d.directionTo)}`
    );
  }
  if (d.directionCountry) {
    directionParts.push(escapeMarkdown(d.directionCountry));
  }
  const direction =
    directionParts.length > 0 ? directionParts.join(" · ") : null;

  // Даты
  const dates =
    d.startFlightDate && d.endFlightDate
      ? `Даты: ${escapeMarkdown(d.startFlightDate)} → ${escapeMarkdown(
          d.endFlightDate
        )}`
      : d.startDate && d.endDate
      ? `Даты: ${escapeMarkdown(d.startDate)} → ${escapeMarkdown(d.endDate)}`
      : null;

  // Отель
  const hotel = d.hotel || d.hotelName || null;
  const hotelSafe = hotel ? escapeMarkdown(hotel) : null;

  // Размещение
  const accommodation = d.accommodation || null;
  const accommodationSafe = accommodation ? escapeMarkdown(accommodation) : null;

  // Цена (по роли)
  const priceRaw = pickPrice(d, svc, role);
  const price =
    priceRaw !== null && priceRaw !== undefined
      ? escapeMarkdown(priceRaw)
      : null;

  // Поставщик + Telegram
  const providerNameRaw = svc.provider_name || "Поставщик Travella";
  const providerName = escapeMarkdown(providerNameRaw);
  const providerTelegram = svc.provider_telegram || null;

  let providerLine;
  let telegramLine = null;

  if (providerTelegram) {
    let username = String(providerTelegram).trim();
    username = username.replace(/^@/, "");
    username = username.replace(/^https?:\/\/t\.me\//i, "");

    const rawUsername = username;
    const mdUsername = escapeMarkdown(username);

    providerLine = `Поставщик: [${providerName}](tg://resolve?domain=${rawUsername})`;
    telegramLine = `Telegram: @${mdUsername}`;
  } else {
    providerLine = `Поставщик: ${providerName}`;
  }

  const lines = [];
  lines.push(`*${title}*`);
  if (direction) lines.push(direction);
  if (dates) lines.push(dates);
  if (hotelSafe) lines.push(`Отель: ${hotelSafe}`);
  if (accommodationSafe) lines.push(`Размещение: ${accommodationSafe}`);
  if (price) lines.push(`Цена: *${price}*`);
  lines.push(providerLine);
  if (telegramLine) lines.push(telegramLine);
  lines.push("");
  lines.push(`Подробнее и бронирование: ${SITE_URL}`);

  const text = lines.join("\n");
  const photoUrl = getFirstImageUrl(svc);
  const serviceUrl = SITE_URL;

  return { text, photoUrl, serviceUrl };
}

// ---- helper: доопределить роль поставщика по chatId, если сессия пуста ----
async function ensureProviderRole(ctx) {
  if (ctx.session?.role === "provider") {
    return "provider";
  }
  const chatId = ctx.chat.id;
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
    changeable: typeof draft.changeable === "boolean" ? draft.changeable : null,
    visaIncluded:
      typeof draft.visaIncluded === "boolean" ? draft.visaIncluded : null,
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
        "Создаём новую услугу: *Отказной тур*.\n\n" +
          "Отправьте, пожалуйста, *название тура* (как вы хотите показывать его в Travella).",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_create_tour_country":
      await ctx.reply("Укажите *страну направления* (например, Таиланд):", {
        parse_mode: "Markdown",
        ...wizNavKeyboard(),
      });
      return;

    case "svc_create_tour_from":
      await ctx.reply("Укажите *город вылета* (например, Ташкент):", {
        parse_mode: "Markdown",
        ...wizNavKeyboard(),
      });
      return;

    case "svc_create_tour_to":
      await ctx.reply("Укажите *город прибытия* (например, Бангкок):", {
        parse_mode: "Markdown",
        ...wizNavKeyboard(),
      });
      return;

    case "svc_create_tour_start":
      await ctx.reply(
        "Укажите *дату начала тура* в формате ГГГГ-ММ-ДД (например, 2025-12-09):",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_create_tour_end":
      await ctx.reply("Укажите *дату окончания тура* в формате ГГГГ-ММ-ДД:", {
        parse_mode: "Markdown",
        ...wizNavKeyboard(),
      });
      return;

    case "svc_create_tour_hotel":
      await ctx.reply("Укажите *отель* (как в ваучере, можно с категорией):", {
        parse_mode: "Markdown",
        ...wizNavKeyboard(),
      });
      return;

    case "svc_create_tour_accommodation":
      await ctx.reply(
        "Опишите *размещение* (тип номера, размещение ADT/CHD/INF):",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_create_price":
      await ctx.reply(
        "Укажите *цену нетто* (за тур, в валюте, например 1130 или 1130 USD):",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_create_changeable":
      await ctx.reply("Можно ли *менять туриста* в туре? Напишите `да` или `нет`.", {
        parse_mode: "Markdown",
        ...wizNavKeyboard(),
      });
      return;

    case "svc_create_visa":
      await ctx.reply("Включена ли *виза* в этот тур? Напишите `да` или `нет`.", {
        parse_mode: "Markdown",
        ...wizNavKeyboard(),
      });
      return;

    case "svc_create_expiration":
      await ctx.reply(
        "До какой даты тур *актуален*? Укажите дату ГГГГ-ММ-ДД или напишите `нет`, если только по дате вылета.",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    case "svc_create_photo":
      await ctx.reply(
        "Отправьте одно *фото тура* одним сообщением или напишите `пропустить`.",
        { parse_mode: "Markdown", ...wizNavKeyboard() }
      );
      return;

    default:
      await ctx.reply("Продолжим создание услуги.", wizNavKeyboard());
      return;
  }
}

async function finishCreateServiceFromWizard(ctx) {
  try {
    const draft = ctx.session?.serviceDraft;
    if (!draft || draft.category !== "refused_tour") {
      await ctx.reply(
        "Не удалось создать услугу: нет данных мастера. Попробуйте ещё раз."
      );
      resetServiceWizard(ctx);
      return;
    }

    const priceNum = normalizePrice(draft.price);
    if (priceNum === null) {
      await ctx.reply(
        "Не понял цену. Пожалуйста, введите число, например 1130 или 1130 USD."
      );
      ctx.session.state = "svc_create_price";
      return;
    }

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
        "Не удалось сохранить услугу. Попробуйте позже или через кабинет."
      );
      resetServiceWizard(ctx);
      return;
    }

    await ctx.reply(
      `Готово! ✅\n\nУслуга #${data.service.id} создана и отправлена на модерацию.\n` +
        "После одобрения она появится в поиске Travella и в боте."
    );

    resetServiceWizard(ctx);

    // вернём в подменю "Мои услуги"
    await ctx.reply("Что дальше?", {
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
    await ctx.reply("Произошла ошибка при сохранении услуги. Попробуйте позже.");
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
      await ctx.reply("Произошла ошибка при привязке телефона. Попробуйте позже.");
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
        "Спасибо. 🙌\n\nМы привязали ваш Telegram к аккаунту клиента Travella.\n" +
          "Теперь бот сможет показывать ваши брони, заявки и отправлять уведомления."
      );
    } else if (data.existed && data.role === "provider") {
      await ctx.reply(
        "Спасибо. 🙌\n\nМы привязали ваш Telegram к аккаунту поставщика Travella.\n" +
          "Теперь бот сможет показывать ваши заявки и отправлять уведомления."
      );

      if (data.requestedRole === "client") {
        await ctx.reply(
          "Вы выбрали роль клиента, но по этому номеру уже есть аккаунт поставщика.\n" +
            "Если хотите пользоваться Travella как клиент, зарегистрируйтесь отдельно на сайте travella.uz с другим номером или email."
        );
      }
    } else if (data.created === "client") {
      await ctx.reply(
        "🎉 Добро пожаловать в Travella!\n\n" +
          "Мы создали для вас клиентский аккаунт по этому номеру телефона.\n" +
          "Позже вы сможете дополнить данные на сайте travella.uz."
      );
    } else if (data.created === "provider_lead") {
      await ctx.reply(
        "👋 Мы приняли вашу заявку как нового поставщика Travella.\n" +
          "Наш менеджер свяжется с вами.\n" +
          "Также вы можете заполнить форму на сайте."
      );
    } else {
      await ctx.reply("Привязка выполнена.");
    }

    await ctx.reply(
      "В любой момент можете открыть главное меню и выбрать нужный раздел.",
      getMainMenuKeyboard(finalRole)
    );
  } catch (e) {
    console.error("[tg-bot] handlePhoneRegistration error:", e?.response?.data || e);
    await ctx.reply("Произошла ошибка при привязке телефона. Попробуйте позже.");
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
        "Добро пожаловать в Travella! 👋\nГлавное меню доступно ниже.",
        getMainMenuKeyboard(role)
      );
      return;
    }

    await ctx.reply(
      "Добро пожаловать в Travella! 👋\n\n" +
        "Сначала давайте привяжем ваш аккаунт по номеру телефона."
    );
    await askRole(ctx);
  } catch (e) {
    console.error("[tg-bot] /start error:", e?.response?.data || e);
    await ctx.reply("Произошла ошибка. Попробуйте позже.");
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
        ? "Ок, будем привязывать аккаунт клиента.\n\n" +
            "Отправьте, пожалуйста, номер телефона, который вы указали на сайте travella.uz.\n\n" +
            "Можно просто прислать текстом:\n<code>+998901234567</code>\n\n" +
            "или воспользоваться кнопкой ниже."
        : "Ок, будем привязывать аккаунт поставщика.\n\n" +
            "Отправьте, пожалуйста, номер телефона, который вы указали при регистрации на travella.uz\n" +
            "или используйте кнопку ниже.",
      {
        parse_mode: "HTML",
        reply_markup: {
          keyboard: [
            [{ text: "📲 Отправить мой номер", request_contact: true }],
          ],
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
    await ctx.reply("Не удалось прочитать номер телефона. Попробуйте ещё раз.");
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

  await ctx.reply("Выберите тип услуги:", {
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
    "Хотите вставить отказной тур в любой чат?\n" +
      "Нажмите кнопку ниже, выберите тур и он отправится в этот чат.",
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
    "Избранное скоро появится в боте.\n" +
      "Пока вы можете добавлять и смотреть избранное на сайте travella.uz во вкладке «Избранное»."
  );
});

bot.hears(/📄 Мои брони/i, async (ctx) => {
  logUpdate(ctx, "hears Мои брони");

  const maybeProvider = await ensureProviderRole(ctx);
  const linked = !!ctx.session?.linked;
  const role = maybeProvider || ctx.session?.role || null;

  if (!linked && !role) {
    await ctx.reply(
      "Чтобы показать ваши брони, нужно привязать аккаунт Travella по номеру телефона."
    );
    await askRole(ctx);
    return;
  }

  await ctx.reply(
    "Пока бронирование через бот мы ещё доделываем.\n" +
      "Пока все ваши брони доступны в личном кабинете на сайте travella.uz."
  );
});

bot.hears(/📨 Мои заявки/i, async (ctx) => {
  logUpdate(ctx, "hears Мои заявки");

  const maybeProvider = await ensureProviderRole(ctx);
  const linked = !!ctx.session?.linked;
  const role = maybeProvider || ctx.session?.role || null;

  if (!linked && !role) {
    await ctx.reply(
      "Чтобы показать ваши заявки, нужно привязать аккаунт Travella по номеру телефона."
    );
    await askRole(ctx);
    return;
  }

  await ctx.reply(
    "Пока раздел заявок в боте в разработке.\n" +
      "Вы можете смотреть отклики и заявки на сайте travella.uz."
  );
});

bot.hears(/👤 Профиль/i, async (ctx) => {
  logUpdate(ctx, "hears Профиль");

  const maybeProvider = await ensureProviderRole(ctx);
  const linked = !!ctx.session?.linked;
  const role = maybeProvider || ctx.session?.role || null;

  if (!linked && !role) {
    await ctx.reply(
      "Похоже, ваш аккаунт ещё не привязан к Travella.\n\n" +
        "Давайте привяжем по номеру телефона:"
    );
    await askRole(ctx);
    return;
  }

  if (role === "provider") {
    await ctx.reply(
      "Ваш профиль поставщика Travella можно дополнить и изменить в личном кабинете.\n\n" +
        `Ссылка: ${SITE_URL}/dashboard/profile`
    );
    return;
  }

  await ctx.reply(
    "Ваш профиль клиента можно дополнить и изменить на сайте travella.uz во вкладке «Профиль».\n\n" +
      `Ссылка: ${SITE_URL}`
  );
});

bot.hears(/🏢 Стать поставщиком/i, async (ctx) => {
  logUpdate(ctx, "hears Стать поставщиком");
  await ctx.reply(
    "Чтобы стать поставщиком Travella, заполните форму на сайте\n" +
      "https://travella.uz и дождитесь модерации.\n\n" +
      "Мы также свяжемся с вами по указанным контактам."
  );
});

/* ===================== МОИ УСЛУГИ: ПОДМЕНЮ 3 КНОПКИ ===================== */

bot.hears(/🧳 Мои услуги/i, async (ctx) => {
  logUpdate(ctx, "hears Мои услуги");

  const role = await ensureProviderRole(ctx);

  if (role !== "provider") {
    await ctx.reply(
      "Раздел «Мои услуги» доступен только поставщикам Travella.\n" +
        "Если вы хотите размещать свои туры и отели, зарегистрируйтесь как поставщик на сайте travella.uz."
    );
    return;
  }

  // показываем подменю
  await ctx.reply("Выберите действие:", {
    reply_markup: {
      inline_keyboard: [
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
    await safeReply(ctx, "Главное меню:", getMainMenuKeyboard(role));
  } catch (e) {
    console.error("[tg-bot] prov_services:back error:", e?.response?.data || e);
  }
});

// Создать услугу из подменю — просто как svc_new
bot.action("prov_services:create", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    // запускаем тот же флоу, что и кнопка svc_new
    await ctx.reply("Ок, давайте создадим новую услугу в боте.");
    // имитируем нажатие svc_new
    // (просто вызываем ту же логику ниже)
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
        "Раздел доступен только поставщикам.",
        getMainMenuKeyboard("client")
      );
      return;
    }

    const chatId = ctx.chat.id;

    await safeReply(ctx, "Загружаю ваши услуги маркетплейса...");

    const { data } = await axios.get(`/api/telegram/provider/${chatId}/services`);

    if (!data || !data.success || !Array.isArray(data.items)) {
      console.log("[tg-bot] provider services malformed:", data);
      await safeReply(ctx, "Не удалось загрузить услуги. Попробуйте позже.");
      return;
    }

    if (!data.items.length) {
      await safeReply(
        ctx,
        "У вас пока нет услуг в маркетплейсе.\n" +
          "Нажмите «➕ Создать услугу» или добавьте через кабинет.",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "➕ Создать услугу", callback_data: "prov_services:create" }],
              [{ text: "🌐 Открыть кабинет Travella", url: `${SITE_URL}/dashboard/services/marketplace?from=tg` }],
              [{ text: "⬅️ Назад", callback_data: "prov_services:back" }],
            ],
          },
        }
      );
      return;
    }

    await safeReply(
      ctx,
      `Найдено услуг: ${data.items.length}. Показываю первые 10 (по ближайшей дате).`
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
          [{ text: "Открыть в кабинете", url: manageUrl }],
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
    await safeReply(ctx, "Что дальше?", {
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
    await safeReply(ctx, "Не удалось загрузить услуги. Попробуйте позже.");
  }
});

/* ===================== МАСТЕР: НОВОЕ — Назад/Отмена ===================== */

bot.action("svc_wiz:cancel", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    resetServiceWizard(ctx);
    await safeReply(ctx, "Создание услуги отменено.", {
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
      await safeReply(ctx, "Возвращаюсь назад.", {
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
        "Создавать услуги через бот могут только поставщики Travella.\n" +
          "Зарегистрируйтесь как поставщик на сайте travella.uz."
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
          "Пока создание через бот доступно только для категории «Отказной тур».\n" +
            "Для остальных категорий воспользуйтесь, пожалуйста, кабинетом Travella."
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
        "Не удалось обновить услугу. Попробуйте позже или через кабинет."
      );
      return;
    }

    let msg;
    if (action === "unpublish") {
      msg = "Услуга снята с продажи. Она больше не показывается в поиске Travella.";
    } else if (action === "extend7") {
      msg = "Актуальность услуги продлена на 7 дней. Таймер обновлён в кабинете.";
    } else {
      msg =
        "Услуга архивирована и скрыта из маркетплейса. Вы всегда можете открыть её в кабинете.";
    }

    await ctx.reply(msg);
  } catch (e) {
    console.error("[tg-bot] svc action handler error:", e?.response?.data || e);
    try {
      await ctx.answerCbQuery("Ошибка, попробуйте ещё раз", { show_alert: true });
    } catch (_) {}
  }
});

// ==== ПОИСК ОТКАЗНЫХ УСЛУГ (кнопка "Найти услугу") ====

bot.action(
  /^find:(refused_tour|refused_hotel|refused_flight|refused_ticket)$/,
  async (ctx) => {
    try {
      const category = ctx.match[1];

      await ctx.answerCbQuery();
      logUpdate(ctx, `action search ${category}`);

      const chatId = ctx.chat.id;
      const role = ctx.session?.role || "client";

      await ctx.reply("Ищу подходящие предложения...");

      const { data } = await axios.get(`/api/telegram/client/${chatId}/search`, {
        params: { category },
      });

      if (!data || !data.success || !Array.isArray(data.items)) {
        console.log("[tg-bot] search resp malformed:", data);
        await ctx.reply("Произошла ошибка при загрузке услуг. Попробуйте позже.");
        return;
      }

      if (!data.items.length) {
        await ctx.reply("К сожалению, по этой категории сейчас нет подходящих предложений.");
        return;
      }

      await ctx.reply(`Нашёл ${data.items.length} предложений.\nТоп 10 ниже:`);

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
      await ctx.reply("Не удалось загрузить услуги. Попробуйте позже.");
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
      "📩 Быстрый запрос\n\n" +
        "Напишите, пожалуйста, сообщение по этому туру (пожелания, даты, количество человек)\n" +
        "и оставьте контактный номер, если он отличается от Telegram.",
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
        await ctx.reply("Сейчас функция быстрого запроса временно недоступна.");
      } else {
        const safeFirst = escapeMarkdown(from.first_name || "");
        const safeLast = escapeMarkdown(from.last_name || "");
        const safeUsername = escapeMarkdown(from.username || "нет username");
        const safeMsg = escapeMarkdown(msg);

        const textForManager =
          "🆕 *Новый быстрый запрос из бота Travella*\n\n" +
          `Тур ID: *${escapeMarkdown(serviceId)}*\n` +
          `От: ${safeFirst} ${safeLast} (@${safeUsername})\n` +
          `Telegram chatId: \`${chatId}\`\n\n` +
          "*Сообщение клиента:*\n" +
          safeMsg;

        await bot.telegram.sendMessage(MANAGER_CHAT_ID, textForManager, {
          parse_mode: "Markdown",
        });

        await ctx.reply(
          "Спасибо! 🙌\n\nВаш запрос отправлен менеджеру Travella.\n" +
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
        await ctx.reply("Создание услуги отменено.");
        await ctx.reply("Выберите действие:", {
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
              "Не понял дату начала тура 😔\n" +
                "Напишите в формате ГГГГ-ММ-ДД, например 2025-12-09.",
              wizNavKeyboard()
            );
            return;
          }
          if (isPastYMD(norm)) {
            await ctx.reply(
              "Дата начала уже в прошлом.\n" +
                "Пожалуйста, укажите будущую дату в формате ГГГГ-ММ-ДД.",
              wizNavKeyboard()
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
              "Не понял дату окончания тура 😔\n" + "Напишите в формате ГГГГ-ММ-ДД.",
              wizNavKeyboard()
            );
            return;
          }
          if (draft.startDate && isBeforeYMD(normEnd, draft.startDate)) {
            await ctx.reply(
              "Дата окончания раньше даты начала.\n" +
                `Начало: ${draft.startDate}\n` +
                "Пожалуйста, укажите корректную дату окончания.",
              wizNavKeyboard()
            );
            return;
          }
          if (isPastYMD(normEnd)) {
            await ctx.reply(
              "Дата окончания уже в прошлом.\n" +
                "Пожалуйста, укажите будущую дату окончания.",
              wizNavKeyboard()
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
          ctx.session.state = "svc_create_changeable";
          await promptWizardState(ctx, "svc_create_changeable");
          return;

        case "svc_create_changeable": {
          const v = parseYesNo(text);
          if (v === null) {
            await ctx.reply(
              "Пожалуйста, напишите только `да` или `нет` про возможность смены туриста.",
              wizNavKeyboard()
            );
            return;
          }
          draft.changeable = v;
          pushWizardState(ctx, "svc_create_changeable");
          ctx.session.state = "svc_create_visa";
          await promptWizardState(ctx, "svc_create_visa");
          return;
        }

        case "svc_create_visa": {
          const v2 = parseYesNo(text);
          if (v2 === null) {
            await ctx.reply("Пожалуйста, напишите только `да` или `нет` про визу.", wizNavKeyboard());
            return;
          }
          draft.visaIncluded = v2;
          pushWizardState(ctx, "svc_create_visa");
          ctx.session.state = "svc_create_expiration";
          await promptWizardState(ctx, "svc_create_expiration");
          return;
        }

        case "svc_create_expiration": {
          const lower = text.trim().toLowerCase();
          const normExp = normalizeDateInput(text);

          if (normExp === null && lower !== "нет") {
            await ctx.reply(
              "Не понял дату актуальности 😔\n" +
                "Напишите в формате ГГГГ-ММ-ДД (например 2025-12-15) или `нет`.",
              wizNavKeyboard()
            );
            return;
          }

          if (normExp && isPastYMD(normExp)) {
            await ctx.reply(
              "Дата актуальности уже в прошлом.\n" +
                "Укажите будущую дату (ГГГГ-ММ-ДД) или напишите `нет`.",
              wizNavKeyboard()
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
            "Пожалуйста, отправьте фото сообщением с картинкой или напишите `пропустить`.",
            wizNavKeyboard()
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
        "Произошла ошибка. Попробуйте ещё раз или начните заново через «🧳 Мои услуги» → «➕ Создать услугу»."
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
        await ctx.reply("Не удалось прочитать фото. Попробуйте ещё раз.");
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
    const role = ctx.session?.role || "client";

    await ctx.reply("Ищу тур по этому ID...");

    const found = await findServiceByIdViaSearch(chatId, serviceId);

    if (!found) {
      await ctx.reply(
        "Не нашёл тур с таким ID.\n" +
          "Возможно, он уже снят с продажи или не относится к отказным."
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
    await ctx.reply("Не удалось загрузить тур. Попробуйте позже.");
  }
});

// ==== INLINE-ПОИСК ====

bot.on("inline_query", async (ctx) => {
  try {
    logUpdate(ctx, "inline_query");

    const q = (ctx.inlineQuery?.query || "").toLowerCase().trim();

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
    const roleForInline = "client";

    const { data } = await axios.get(`/api/telegram/client/${chatId}/search`, {
      params: { category },
    });

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
      const { text, photoUrl, serviceUrl } = buildServiceMessage(
        svc,
        category,
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
        datesLine = `ДАТЫ: ${sf} → ${ef}`;
      }

      const hotelNameRaw = d.hotel || d.hotelName || "";
      const hotelLine = hotelNameRaw ? `ОТЕЛЬ: ${truncate(hotelNameRaw, 45)}` : "";

      const priceInline = pickPrice(d, svc, roleForInline);
      const priceLine =
        priceInline !== null && priceInline !== undefined ? `ЦЕНА: ${priceInline}` : "";

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
        title: svc.title || CATEGORY_LABELS[category] || "Услуга",
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
