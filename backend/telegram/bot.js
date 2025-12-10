// backend/telegram/bot.js
require("dotenv").config();
const { Telegraf, session } = require("telegraf");
const axios = require("axios");

console.log("=== BOT.JS LOADED ===");

// ====== ENV / TOKENS ======
const CLIENT_TOKEN = process.env.TELEGRAM_CLIENT_BOT_TOKEN || "";
const OLD_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

console.log("[tg-bot] CLIENT TOKEN RAW:", CLIENT_TOKEN || "(empty)");
console.log("[tg-bot] OLD TOKEN RAW   :", OLD_TOKEN || "(empty)");

// ⚠️ Используем ТОЛЬКО CLIENT_TOKEN. Старый нужен только для старого webhook-бота.
if (!CLIENT_TOKEN) {
  console.warn(
    "[tg-bot] No TELEGRAM_CLIENT_BOT_TOKEN in env, client bot will be DISABLED"
  );
  module.exports = { bot: null };
  return;
}

const BOT_TOKEN = CLIENT_TOKEN;
console.log("[tg-bot] Using CLIENT token for Telegraf bot");

// BASE URL API
const API_BASE = (
  process.env.API_BASE_URL ||
  process.env.SITE_API_URL ||
  "http://localhost:8080"
).replace(/\/+$/, "");

console.log("[tg-bot] API_BASE =", API_BASE);

// ====== INIT BOT ======
const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// Глобальный лог всех апдейтов
bot.use((ctx, next) => {
  const from = ctx.from || {};
  console.log("[tg-bot] update:", {
    type: ctx.updateType,
    subTypes: ctx.updateSubTypes,
    fromId: from.id,
    username: from.username,
  });
  return next();
});

// Глобальный catch, чтобы видеть любые падения
bot.catch((err, ctx) => {
  console.error("[tg-bot] GLOBAL ERROR for update", ctx.update, "=>", err);
});

// ====== HELPERS ======

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
  console.log("[tg-bot] askRole for", ctx.from?.id);
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
      role: requestedRole,
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

// ====== /start ======

bot.start(async (ctx) => {
  const chatId = ctx.chat.id;
  console.log("[tg-bot] /start from", {
    chatId,
    username: ctx.from?.username,
  });

  try {
    // СНАЧАЛА гарантированно что-то отвечаем,
    // чтобы убедиться, что отправка сообщений работает
    await ctx.reply(
      "Добро пожаловать в Travella! 👋\nПроверяю, привязан ли ваш аккаунт…"
    );

    let role = null;

    // 1. пробуем узнать профиль как клиента
    try {
      const resClient = await axios.get(
        `${API_BASE}/api/telegram/profile/client/${chatId}`
      );
      console.log(
        "[tg-bot] profile client resp:",
        resClient.status,
        resClient.data
      );
      if (resClient.data && resClient.data.success) {
        role = "client";
      }
    } catch (e) {
      const st = e?.response?.status;
      if (st === 404) {
        console.log("[tg-bot] profile: not a client (404)");
      } else {
        console.warn(
          "[tg-bot] /start client profile error:",
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
        console.log(
          "[tg-bot] profile provider resp:",
          resProv.status,
          resProv.data
        );
        if (resProv.data && resProv.data.success) {
          role = "provider";
        }
      } catch (e) {
        const st = e?.response?.status;
        if (st === 404) {
          console.log("[tg-bot] profile: not a provider (404)");
        } else {
          console.warn(
            "[tg-bot] /start provider profile error:",
            e?.response?.data || e.message || e
          );
        }
      }
    }

    console.log("[tg-bot] resolved role on /start:", role);

    if (role) {
      if (!ctx.session) ctx.session = {};
      ctx.session.role = role;
      ctx.session.linked = true;

      await ctx.reply(
        "Ваш Telegram уже привязан к аккаунту Travella. Главное меню ниже 👇",
        getMainMenuKeyboard(role)
      );
      return;
    }

    // ❌ Аккаунт ещё не привязан → спрашиваем роль
    await ctx.reply(
      "Сначала давайте привяжем ваш аккаунт по номеру телефона."
    );
    await askRole(ctx);
  } catch (e) {
    console.error("[tg-bot] /start error:", e?.response?.data || e);
    await ctx.reply("Произошла ошибка. Попробуйте позже.");
  }
});

// ====== INLINE-роль: "Я клиент" / "Я поставщик" ======

bot.action(/^role:(client|provider)$/, async (ctx) => {
  try {
    const role = ctx.match[1];
    console.log("[tg-bot] role action:", {
      fromId: ctx.from?.id,
      role,
    });

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

// ====== CONTACT (кнопка "Отправить мой номер") ======

bot.on("contact", async (ctx) => {
  const contact = ctx.message.contact;
  console.log("[tg-bot] contact received:", {
    fromId: ctx.from?.id,
    phone: contact?.phone_number,
  });

  if (!contact || !contact.phone_number) {
    await ctx.reply("Не удалось прочитать номер телефона. Попробуйте ещё раз.");
    return;
  }

  const phone = contact.phone_number;
  const requestedRole = ctx.session?.requestedRole || "client";

  await handlePhoneRegistration(ctx, requestedRole, phone, true);
});

// ====== ТЕКСТОВЫЙ ВВОД ТЕЛЕФОНА ======

bot.hears(/^\+?\d[\d\s\-()]{5,}$/i, async (ctx) => {
  if (!ctx.session || !ctx.session.requestedRole) {
    console.log(
      "[tg-bot] phone-like text, but no requestedRole in session; ignore"
    );
    return;
  }

  const phone = ctx.message.text.trim();
  const requestedRole = ctx.session.requestedRole;

  console.log("[tg-bot] phone text from", ctx.from?.id, "=>", phone);
  await handlePhoneRegistration(ctx, requestedRole, phone, false);
});

// ⚠️ Здесь НЕТ bot.launch() — запуск делает index.js
module.exports = { bot };
