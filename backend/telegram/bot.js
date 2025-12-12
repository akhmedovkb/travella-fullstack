// backend/telegram/bot.js

require("dotenv").config();
const { Telegraf, session } = require("telegraf");
const axiosBase = require("axios");

// ==== CONFIG ====

const CLIENT_TOKEN = process.env.TELEGRAM_CLIENT_BOT_TOKEN || "";
const OLD_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

if (!CLIENT_TOKEN && !OLD_TOKEN) {
  throw new Error("No TELEGRAM_CLIENT_BOT_TOKEN/TELEGRAM_BOT_TOKEN in env");
}

const BOT_TOKEN = CLIENT_TOKEN || OLD_TOKEN;

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

console.log("=== BOT.JS LOADED ===");
console.log("[tg-bot] CLIENT TOKEN RAW:", CLIENT_TOKEN || "(none)");
console.log("[tg-bot] OLD TOKEN RAW   :", OLD_TOKEN || "(none)");
console.log(
  "[tg-bot] Using",
  CLIENT_TOKEN ? "CLIENT" : "OLD",
  "token for Telegraf bot"
);
console.log("[tg-bot] API_BASE =", API_BASE);
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

// ✅ получаем "картинку" для Telegram
// - для обычных сообщений можно вернуть Telegram file_id (если tg:<fileId>)
// - для inline thumb_url можно использовать только https URL (file_id НЕ подойдёт)
function getFirstImageUrl(svc, { forInline = false } = {}) {
  let arr = svc.images;

  if (!arr) return null;

  // если в БД лежит строка
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

  // ✅ tg:<fileId> — умеем показывать фото в обычных сообщениях
  if (v.startsWith("tg:")) {
    if (forInline) return null; // thumb_url не может быть file_id
    const fileId = v.slice(3).trim();
    return fileId || null;
  }

  // 🔥 поддержка base64 (data:image/...)
  if (v.startsWith("data:image")) {
    return `${API_BASE.replace(/\/+$/, "")}/api/telegram/service-image/${svc.id}`;
  }

  // Полный URL
  if (v.startsWith("http://") || v.startsWith("https://")) {
    // thumb_url лучше только https, но оставляем как есть
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
 * Преобразуем услугу из /api/telegram/client/:chatId/search
 * в красивый текст + url картинки + url на сайт
 *
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

  // ✅ для обычных сообщений можно file_id
  const photoUrl = getFirstImageUrl(svc, { forInline: false });
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

// ✅ сравнение дат без сюрпризов таймзоны
function toUtcDay(dateStr) {
  const m = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return Date.UTC(y, mo - 1, d);
}

function isPastDate(dateStr) {
  const v = toUtcDay(dateStr);
  if (v === null) return false;
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return v < todayUtc;
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
    changeable:
      typeof draft.changeable === "boolean" ? draft.changeable : null,
    visaIncluded:
      typeof draft.visaIncluded === "boolean" ? draft.visaIncluded : null,
    expiration: draft.expiration || null,
    isActive: true,
  };
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
  } catch (e) {
    console.error("[tg-bot] finishCreateServiceFromWizard error:", e?.response?.data || e);
    await ctx.reply(
      "Произошла ошибка при сохранении услуги. Попробуйте позже."
    );
    resetServiceWizard(ctx);
  }
}

/* ===================== Регистрация / привязка телефона ===================== */

async function handlePhoneRegistration(ctx, requestedRole, phone, fromContact) {
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
      await ctx.reply(
        "Произошла ошибка при привязке телефона. Попробуйте позже."
      );
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
    console.error(
      "[tg-bot] handlePhoneRegistration error:",
      e?.response?.data || e
    );
    await ctx.reply(
      "Произошла ошибка при привязке телефона. Попробуйте позже."
    );
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
        console.log(
          "[tg-bot] profile client resp:",
          resClient.status,
          resClient.data
        );
      }
    } catch (e) {
      if (e?.response?.status !== 404) {
        console.log(
          "[tg-bot] profile client error:",
          e?.response?.data || e.message || e
        );
      }
    }

    if (!role) {
      try {
        const resProv = await axios.get(`/api/telegram/profile/provider/${chatId}`);
        if (resProv.data && resProv.data.success) {
          role = "provider";
          console.log(
            "[tg-bot] profile provider resp:",
            resProv.status,
            resProv.data
          );
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

      console.log("[tg-bot] resolved role on /start:", role);

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
            [
              {
                text: "📲 Отправить мой номер",
                request_contact: true,
              },
            ],
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

  await handlePhoneRegistration(ctx, requestedRole, phone, true);
});

// ==== ТЕКСТОВЫЙ ВВОД ТЕЛЕФОНА ====

bot.hears(/^\+?\d[\d\s\-()]{5,}$/i, async (ctx) => {
  if (!ctx.session || !ctx.session.requestedRole) {
    return;
  }

  const phone = ctx.message.text.trim();
  const requestedRole = ctx.session.requestedRole;

  await handlePhoneRegistration(ctx, requestedRole, phone, false);
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
          [
            {
              text: "📤 Выбрать отказной тур",
              switch_inline_query_current_chat: "#allotkaztur ",
            },
          ],
        ],
      },
    }
  );
});

// заглушки
bot.hears(/❤️ Избранное/i, async (ctx) => {
  logUpdate(ctx, "hears Избранное");
  await ctx.reply(
    "Избранное скоро появится в боте.\n" +
      "Пока вы можете добавлять и смотреть избранное на сайте travella.uz во вкладке «Избранное»."
  );
});

bot.hears(/📄 Мои брони/i, async (ctx) => {
  logUpdate(ctx, "hears Мои брони");
  await ctx.reply(
    "Пока бронирование через бот мы ещё доделываем.\n" +
      "Пока все ваши брони доступны в личном кабин
