// backend/telegram/bot.js
require("dotenv").config();
const { Telegraf, session } = require("telegraf");
const axios = require("axios");

// ==== CONFIG ====

const CLIENT_TOKEN = process.env.TELEGRAM_CLIENT_BOT_TOKEN || "";
const OLD_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

console.log("=== BOT.JS LOADED ===");
console.log("[tg-bot] CLIENT TOKEN RAW:", CLIENT_TOKEN || "<empty>");
console.log("[tg-bot] OLD TOKEN RAW   :", OLD_TOKEN || "<empty>");

if (!CLIENT_TOKEN && !OLD_TOKEN) {
  throw new Error("No TELEGRAM_CLIENT_BOT_TOKEN / TELEGRAM_BOT_TOKEN in env");
}

// Используем НОВЫЙ клиентский токен
const BOT_TOKEN = CLIENT_TOKEN || OLD_TOKEN;
console.log("[tg-bot] Using CLIENT token for Telegraf bot");

const API_BASE = (
  process.env.API_BASE_URL ||
  process.env.SITE_API_URL ||
  "http://localhost:8080"
).replace(/\/+$/, "");

const SITE_URL = (process.env.SITE_PUBLIC_URL || "https://travella.uz").replace(
  /\/+$/,
  ""
);

console.log("[tg-bot] API_BASE =", API_BASE);

// ==== INIT BOT ====

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// Логируем все апдейты (очень помогает в дебаге)
bot.use(async (ctx, next) => {
  try {
    const type = ctx.updateType;
    const subTypes = ctx.updateSubTypes;
    const fromId = ctx.chat && ctx.chat.id;
    const username = ctx.from && ctx.from.username;
    console.log("[tg-bot] update:", {
      type,
      subTypes,
      fromId,
      username,
    });
  } catch (e) {
    console.warn("[tg-bot] log middleware error:", e?.message || e);
  }
  return next();
});

// ==== HELPERS ====

// Главное меню (пока одинаковое для клиента и поставщика)
function getMainMenuKeyboard(role) {
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

// Универсальный helper для запросов к нашему API
async function apiGet(path) {
  const url = `${API_BASE}${path}`;
  return axios.get(url, { timeout: 10000 });
}

// Основная логика привязки телефона к аккаунту / созданию нового
async function handlePhoneRegistration(ctx, requestedRole, phone, fromContact) {
  try {
    const chatId = ctx.chat.id;
    const username = ctx.from.username || null;
    const firstName = ctx.from.first_name || null;

    const payload = {
      role: requestedRole, // "client" | "provider"
      phone,
      chatId,
      username,
      firstName,
    };

    console.log("[tg-bot] handlePhoneRegistration payload:", payload);

    const { data } = await axios.post(`${API_BASE}/api/telegram/link`, payload);

    console.log("[tg-bot] /api/telegram/link response:", data);

    if (!data || !data.success) {
      await ctx.reply(
        "Произошла ошибка при привязке телефона. Попробуйте позже."
      );
      return;
    }

    // фактическая роль по БД
    // provider_lead считаем «профиль поставщика в процессе»
    const finalRole =
      data.role === "provider" || data.role === "provider_lead"
        ? "provider"
        : "client";

    if (!ctx.session) ctx.session = {};
    ctx.session.role = finalRole;
    ctx.session.linked = true;

    // ---- Текст в зависимости от кейса ----
    if (data.existed && data.role === "client") {
      await ctx.reply(
        "Спасибо. 🙌\n\nМы привязали ваш Telegram к аккаунту клиента Travella.\n" +
          "Теперь бот сможет показывать ваши брони, заявки и отправлять уведомления."
      );
    } else if (data.existed && data.role === "provider") {
      // сюда попадём, даже если человек нажал «я клиент», но телефон уже у поставщика
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

    // ✅ СРАЗУ показываем главное меню и НИЧЕГО больше не спрашиваем
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
  const chatId = ctx.chat.id;
  console.log(
    "[tg-bot] /start from",
    { chatId, username: ctx.from && ctx.from.username }
  );

  try {
    // 1. пробуем узнать профиль как клиента
    let role = null;

    try {
      const resClient = await axios.get(
        `${API_BASE}/api/telegram/profile/client/${chatId}`
      );
      console.log("[tg-bot] profile client resp:", resClient.status, resClient.data);
      if (resClient.data && resClient.data.success) {
        role = "client";
      }
    } catch (e) {
      // 404 — это нормально, значит не клиент
      if (e.response && e.response.status !== 404) {
        console.warn("[tg-bot] profile client error:", e.response.data || e.message);
      }
    }

    // 2. если не клиент — пробуем как поставщик
    if (!role) {
      try {
        const resProv = await axios.get(
          `${API_BASE}/api/telegram/profile/provider/${chatId}`
        );
        console.log("[tg-bot] profile provider resp:", resProv.status, resProv.data);
        if (resProv.data && resProv.data.success) {
          role = "provider";
        }
      } catch (e) {
        if (e.response && e.response.status !== 404) {
          console.warn(
            "[tg-bot] profile provider error:",
            e.response.data || e.message
          );
        }
      }
    }

    if (role) {
      // Уже привязан → сразу главное меню
      if (!ctx.session) ctx.session = {};
      ctx.session.role = role;
      ctx.session.linked = true;

      await ctx.reply(
        "Добро пожаловать в Travella! 👋\nГлавное меню доступно ниже.",
        getMainMenuKeyboard(role)
      );
      return;
    }

    // ❌ Аккаунт ещё не привязан → спрашиваем роль
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
    const role = ctx.match[1]; // 'client' | 'provider'

    if (!ctx.session) ctx.session = {};
    ctx.session.requestedRole = role;

    await ctx.answerCbQuery(); // убираем "часики" на кнопке

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
  const contact = ctx.message.contact;
  if (!contact || !contact.phone_number) {
    await ctx.reply(
      "Не удалось прочитать номер телефона. Попробуйте ещё раз."
    );
    return;
  }

  const phone = contact.phone_number;
  const requestedRole = ctx.session?.requestedRole || "client";

  await handlePhoneRegistration(ctx, requestedRole, phone, true);
});

// ==== ТЕКСТОВЫЙ ВВОД ТЕЛЕФОНА ====

bot.hears(/^\+?\d[\d\s\-()]{5,}$/i, async (ctx) => {
  // если пользователь на шаге привязки прислал номер текстом
  if (!ctx.session || !ctx.session.requestedRole) {
    // если мы вообще не ждём номер — игнор
    return;
  }

  const phone = ctx.message.text.trim();
  const requestedRole = ctx.session.requestedRole;

  await handlePhoneRegistration(ctx, requestedRole, phone, false);
});

// ==== ОБРАБОТКА КНОПОК ГЛАВНОГО МЕНЮ ====

// Общий helper для Избранного / Брони / Заявки
async function handleClientList(ctx, kind) {
  const chatId = ctx.chat.id;
  const role = ctx.session?.role || "client";

  const prettyName =
    kind === "favorites"
      ? "избранное"
      : kind === "bookings"
      ? "брони"
      : "заявки";

  try {
    await ctx.reply(`Загружаю ${prettyName}…`);

    // сейчас делаем только клиентский профиль
    const path = `/api/telegram/client/${chatId}/${kind}`;

    const resp = await apiGet(path);
    const data = resp.data || {};

    console.log(`[tg-bot] ${kind} resp:`, data);

    if (data.notFound) {
      await ctx.reply(
        "Телеграм ещё не привязан к клиентскому аккаунту. Нажмите /start и привяжите номер."
      );
      return;
    }

    const list =
      Array.isArray(data.items) && data.items.length
        ? data.items
        : Array.isArray(data[kind]) && data[kind].length
        ? data[kind]
        : [];

    if (!list.length) {
      if (kind === "favorites") {
        await ctx.reply("У вас пока нет избранных услуг.");
      } else if (kind === "bookings") {
        await ctx.reply("У вас пока нет бронирований через Travella.");
      } else {
        await ctx.reply("У вас пока нет активных заявок.");
      }
      return;
    }

    // Собираем человекочитаемый список (до 5 строк)
    const lines = list.slice(0, 5).map((item, idx) => {
      const title =
        item.title ||
        item.service_title ||
        item.serviceName ||
        item.name ||
        `Услуга #${item.id || idx + 1}`;

      const status = item.status ? ` — ${item.status}` : "";

      // Пробуем вытащить какие-то даты
      const dateField =
        item.start_date ||
        item.startDate ||
        item.date_from ||
        item.date ||
        null;

      const dateStr = dateField ? ` (${String(dateField).slice(0, 10)})` : "";

      return `${idx + 1}. ${title}${status}${dateStr}`;
    });

    let header = "";
    if (kind === "favorites") {
      header = `Найдено ${list.length} избранных услуг:`;
    } else if (kind === "bookings") {
      header = `Найдено ${list.length} бронирований:`;
    } else {
      header = `Найдено ${list.length} заявок:`;
    }

    const extra =
      list.length > 5 ? `\n… и ещё ${list.length - 5} в вашем аккаунте.` : "";

    await ctx.reply(`${header}\n\n${lines.join("\n")}${extra}`);
  } catch (e) {
    console.error(`[tg-bot] error in '${kind}':`, e?.response?.data || e);
    await ctx.reply(
      `Не удалось загрузить ${prettyName}. Попробуйте позже.`
    );
  }
}

// 🔍 Найти услугу
bot.hears("🔍 Найти услугу", async (ctx) => {
  await ctx.reply(
    "Поиск услуг через бот мы готовим.\n" +
      "Сейчас вы можете найти и забронировать услуги на сайте Travella:",
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "Открыть Travella",
              url: SITE_URL,
            },
          ],
        ],
      },
    }
  );
});

// ❤️ Избранное
bot.hears("❤️ Избранное", (ctx) => handleClientList(ctx, "favorites"));

// 📄 Мои брони
bot.hears("📄 Мои брони", (ctx) => handleClientList(ctx, "bookings"));

// 📨 Мои заявки
bot.hears("📨 Мои заявки", (ctx) => handleClientList(ctx, "requests"));

// 👤 Профиль
bot.hears("👤 Профиль", async (ctx) => {
  await ctx.reply(
    "Ваш профиль клиента можно дополнить и изменить на сайте Travella:",
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "Открыть профиль на сайте",
              url: SITE_URL,
            },
          ],
        ],
      },
    }
  );
});

// 🏢 Стать поставщиком
bot.hears("🏢 Стать поставщиком", async (ctx) => {
  await ctx.reply(
    "Чтобы стать поставщиком Travella, заполните форму на сайте " +
      `${SITE_URL} и дождитесь модерации.\n\n` +
      "Мы также свяжемся с вами по указанным контактам.",
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "Стать поставщиком",
              url: SITE_URL,
            },
          ],
        ],
      },
    }
  );
});

// ⚠️ ВАЖНО: здесь НЕТ bot.launch()
// Запуском занимается backend/index.js
module.exports = { bot };
