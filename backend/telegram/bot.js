// backend/telegram/bot.js
require("dotenv").config();
const { Telegraf, session } = require("telegraf");
const axios = require("axios");

// ==== CONFIG & ENV LOGS ====

// Токены в окружении
const CLIENT_TOKEN = process.env.TELEGRAM_CLIENT_BOT_TOKEN || "";
const OLD_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

console.log("[tg-bot] env tokens:", {
  hasClientToken: !!CLIENT_TOKEN,
  hasOldToken: !!OLD_TOKEN,
});

// Этот файл — ТОЛЬКО для НОВОГО клиентского бота (OTKAZNYX_TUROV_UZB_BOT)
if (!CLIENT_TOKEN) {
  console.warn(
    "[tg-bot] TELEGRAM_CLIENT_BOT_TOKEN is empty — bot will NOT be started"
  );
  module.exports = { bot: null };
  return;
}

const BOT_TOKEN = CLIENT_TOKEN;

const API_BASE = (
  process.env.API_BASE_URL ||
  process.env.SITE_API_URL ||
  "http://localhost:8080"
).replace(/\/+$/, "");

console.log("[tg-bot] init:", {
  BOT_TOKEN_START: BOT_TOKEN.slice(0, 10) + "...",
  API_BASE,
});

// ==== INIT BOT ====

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// Глобальный логгер всех апдейтов
bot.use(async (ctx, next) => {
  try {
    const t = ctx.updateType;
    const chatId = ctx.chat && ctx.chat.id;
    const fromId = ctx.from && ctx.from.id;
    const text =
      (ctx.message && ctx.message.text) ||
      (ctx.callbackQuery && ctx.callbackQuery.data) ||
      null;

    console.log("[tg-bot] update:", {
      type: t,
      chatId,
      fromId,
      text,
    });

    return await next();
  } catch (e) {
    console.error("[tg-bot] middleware error:", e);
  }
});

// ==== HELPERS ====

function getMainMenuKeyboard(role) {
  // role: "client" | "provider"
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
  console.log("[tg-bot] askRole for chat", ctx.chat && ctx.chat.id);
  await ctx.reply("Кем вы пользуетесь Travella?", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🤖 Я клиент", callback_data: "role:client" }],
        [{ text: "🏢 Я поставщик", callback_data: "role:provider" }],
      ],
    },
  });
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

    const { data } = await axios.post(
      `${API_BASE}/api/telegram/link`,
      payload
    );

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

    // ✅ СРАЗУ показываем главное меню
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
  console.log("[tg-bot] /start from", chatId);

  try {
    // 1. пробуем узнать профиль как клиента
    let role = null;

    try {
      const resClient = await axios.get(
        `${API_BASE}/api/telegram/profile/client/${chatId}`
      );
      if (resClient.data && resClient.data.success) {
        role = "client";
      }
    } catch (e) {
      if (e?.response?.status !== 404) {
        console.warn(
          "[tg-bot] /start profile client error:",
          e?.response?.data || e.message || e
        );
      }
    }

    // 2. если не клиент — пробуем как поставщик
    if (!role) {
      try {
        const resProv = await axios.get(
          `${API_BASE}/api/telegram/profile/provider/${chatId}`
        );
        if (resProv.data && resProv.data.success) {
          role = "provider";
        }
      } catch (e) {
        if (e?.response?.status !== 404) {
          console.warn(
            "[tg-bot] /start profile provider error:",
            e?.response?.data || e.message || e
          );
        }
      }
    }

    if (role) {
      // Уже привязан → сразу главное меню
      if (!ctx.session) ctx.session = {};
      ctx.session.role = role;
      ctx.session.linked = true;

      console.log(
        "[tg-bot] /start: user already linked as",
        role,
        "chat",
        chatId
      );

      await ctx.reply(
        "Добро пожаловать в Travella! 👋\nГлавное меню доступно ниже.",
        getMainMenuKeyboard(role)
      );
      return;
    }

    // ❌ Аккаунт ещё не привязан → спрашиваем роль
    console.log("[tg-bot] /start: user not linked yet, asking role");
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
    console.log("[tg-bot] role chosen:", role, "chat", ctx.chat && ctx.chat.id);

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
  console.log("[tg-bot] contact received:", contact);

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
    console.log(
      "[tg-bot] phone-like text ignored (no requestedRole):",
      ctx.message.text
    );
    return;
  }

  const phone = ctx.message.text.trim();
  const requestedRole = ctx.session.requestedRole;

  console.log("[tg-bot] phone text received:", {
    phone,
    requestedRole,
  });

  await handlePhoneRegistration(ctx, requestedRole, phone, false);
});

// ⚠️ Здесь НЕТ bot.launch() — его вызывает index.js
module.exports = { bot };
