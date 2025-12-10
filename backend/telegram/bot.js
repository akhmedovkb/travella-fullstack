// backend/telegram/bot.js
require("dotenv").config();
const { Telegraf, session } = require("telegraf");
const axios = require("axios");

// ==== CONFIG & LOGS ====

const CLIENT_TOKEN = process.env.TELEGRAM_CLIENT_BOT_TOKEN || "";
const OLD_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

console.log("=== BOT.JS LOADED ===");
console.log("[tg-bot] CLIENT TOKEN RAW:", CLIENT_TOKEN || "<empty>");
console.log("[tg-bot] OLD TOKEN RAW   :", OLD_TOKEN || "<empty>");

const BOT_TOKEN = CLIENT_TOKEN || OLD_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("No TELEGRAM_CLIENT_BOT_TOKEN/TELEGRAM_BOT_TOKEN in env");
} else if (CLIENT_TOKEN) {
  console.log("[tg-bot] Using CLIENT token for Telegraf bot");
} else {
  console.log("[tg-bot] WARNING: using OLD TELEGRAM_BOT_TOKEN (no client token)");
}

const API_BASE = (
  process.env.API_BASE_URL ||
  process.env.SITE_API_URL ||
  "http://localhost:8080"
).replace(/\/+$/, "");

console.log("[tg-bot] API_BASE =", API_BASE);

// ==== INIT BOT ====

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// ==== HELPERS ====

// Клавиатура главного меню
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
  await ctx.reply("Кем вы пользуетесь Travella?", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🤖 Я клиент", callback_data: "role:client" }],
        [{ text: "🏢 Я поставщик", callback_data: "role:provider" }],
      ],
    },
  });
}

// Определяем роль пользователя (client / provider) по chatId.
// Используется и в /start, и в хендлерах меню.
async function resolveRoleByChat(ctx) {
  const chatId = ctx.chat.id;

  // если уже есть в сессии — используем
  if (ctx.session && ctx.session.role) {
    return ctx.session.role;
  }

  // 1. пробуем как клиента
  try {
    const resClient = await axios.get(
      `${API_BASE}/api/telegram/profile/client/${chatId}`
    );
    if (resClient.data && resClient.data.success) {
      if (!ctx.session) ctx.session = {};
      ctx.session.role = "client";
      ctx.session.linked = true;
      console.log("[tg-bot] resolved role by profile: client");
      return "client";
    }
  } catch (e) {
    // 404 — это ок, просто не клиент
    if (e.response && e.response.status !== 404) {
      console.warn(
        "[tg-bot] resolveRoleByChat client error:",
        e.response.data || e.message
      );
    }
  }

  // 2. пробуем как поставщика
  try {
    const resProv = await axios.get(
      `${API_BASE}/api/telegram/profile/provider/${chatId}`
    );
    if (resProv.data && resProv.data.success) {
      if (!ctx.session) ctx.session = {};
      ctx.session.role = "provider";
      ctx.session.linked = true;
      console.log("[tg-bot] resolved role by profile: provider");
      return "provider";
    }
  } catch (e) {
    if (e.response && e.response.status !== 404) {
      console.warn(
        "[tg-bot] resolveRoleByChat provider error:",
        e.response.data || e.message
      );
    }
  }

  console.log("[tg-bot] resolveRoleByChat: role not found");
  return null;
}

// Получить профиль (client / provider) для текущего чата
async function fetchProfile(ctx, role) {
  const chatId = ctx.chat.id;
  const url = `${API_BASE}/api/telegram/profile/${role}/${chatId}`;
  try {
    const { data } = await axios.get(url);
    if (data && data.success) {
      return data.user;
    }
  } catch (e) {
    console.error(
      `[tg-bot] fetchProfile ${role} error:`,
      e.response?.data || e.message
    );
  }
  return null;
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

// Логируем все апдейты (кратко)
bot.use((ctx, next) => {
  const t = ctx.updateType;
  const sub = ctx.updateSubTypes;
  const fromId = ctx.from?.id;
  const username = ctx.from?.username;
  console.log("[tg-bot] update:", {
    type: t,
    subTypes: sub,
    fromId,
    username,
  });
  return next();
});

bot.start(async (ctx) => {
  const chatId = ctx.chat.id;
  console.log("[tg-bot] /start from", {
    chatId,
    username: ctx.from?.username,
  });

  try {
    let role = await resolveRoleByChat(ctx);

    if (role) {
      // Уже привязан → сразу главное меню
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
    await ctx.reply("Не удалось прочитать номер телефона. Попробуйте ещё раз.");
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
    return;
  }

  const phone = ctx.message.text.trim();
  const requestedRole = ctx.session.requestedRole;

  await handlePhoneRegistration(ctx, requestedRole, phone, false);
});

// ==== ГЛАВНОЕ МЕНЮ: РЕАЛЬНЫЕ ХЕНДЛЕРЫ ====

// 🔍 Найти услугу
bot.hears("🔍 Найти услугу", async (ctx) => {
  console.log("[tg-bot] main menu: Найти услугу");
  await ctx.reply(
    "Скоро здесь появится поиск по базе Travella прямо в Telegram.\n\n" +
      "Пока вы можете подобрать туры и услуги на сайте:\nhttps://travella.uz"
  );
});

// ❤️ Избранное
bot.hears("❤️ Избранное", async (ctx) => {
  console.log("[tg-bot] main menu: Избранное");
  const role = await resolveRoleByChat(ctx);

  if (role === "provider") {
    // Для поставщика можно позже выводить избранные заявки/клиентов
    await ctx.reply(
      "Раздел избранного для поставщиков появится чуть позже.\n" +
        "Пока следите за заявками в личном кабинете Travella."
    );
    return;
  }

  // Клиент: пока нет отдельного Telegram-API для wishlist — даём честное сообщение
  await ctx.reply(
    "Избранные услуги сейчас доступны в личном кабинете Travella на сайте.\n\n" +
      "Зайдите на https://travella.uz и авторизуйтесь, чтобы увидеть сохранённые туры."
  );
});

// 📄 Мои брони
bot.hears("📄 Мои брони", async (ctx) => {
  console.log("[tg-bot] main menu: Мои брони");
  const role = await resolveRoleByChat(ctx);

  if (role === "provider") {
    // Для поставщика используем существующий Telegram-API:
    // GET /api/telegram/provider/:chatId/bookings
    const chatId = ctx.chat.id;
    try {
      const url = `${API_BASE}/api/telegram/provider/${chatId}/bookings`;
      const { data } = await axios.get(url);
      const bookings =
        data?.bookings || data?.items || data?.rows || [];

      if (!bookings.length) {
        await ctx.reply("У вас пока нет бронирований от клиентов.");
        return;
      }

      // Покажем первые 5 бронирований
      const top = bookings.slice(0, 5);
      let text = "Ваши ближайшие бронирования:\n\n";
      for (const b of top) {
        const id = b.id || b.booking_id || "?";
        const title =
          b.service_title || b.title || b.service_name || "Услуга";
        const clientName = b.client_name || b.client || "Клиент";
        const dates =
          (b.start_date && b.end_date
            ? `${b.start_date} — ${b.end_date}`
            : b.start_date || b.date || "");
        const status = b.status || "unknown";

        text += `#${id} • ${title}\n`;
        text += `Клиент: ${clientName}\n`;
        if (dates) text += `Даты: ${dates}\n`;
        text += `Статус: ${status}\n\n`;
      }

      if (bookings.length > top.length) {
        text += `…и ещё ${bookings.length - top.length} бронирований.\n`;
      }

      await ctx.reply(text);
    } catch (e) {
      console.error(
        "[tg-bot] provider bookings error:",
        e.response?.data || e.message
      );
      await ctx.reply(
        "Не удалось загрузить список бронирований. Попробуйте позже."
      );
    }
    return;
  }

  // Клиент: пока честно говорим, что смотреть брони лучше на сайте
  await ctx.reply(
    "Список ваших броней сейчас доступен в личном кабинете Travella на сайте.\n\n" +
      "Зайдите на https://travella.uz и откройте раздел «Мои брони»."
  );
});

// 📨 Мои заявки
bot.hears("📨 Мои заявки", async (ctx) => {
  console.log("[tg-bot] main menu: Мои заявки");
  const role = await resolveRoleByChat(ctx);

  if (role === "provider") {
    // Здесь позже можно подвязать Telegram-API под заявки поставщика
    await ctx.reply(
      "В ближайшее время здесь появятся ваши заявки из Travella.\n" +
        "Пока смотрите их в кабинете поставщика на сайте."
    );
    return;
  }

  await ctx.reply(
    "Заявки по вашим услугам и турам сейчас доступны в личном кабинете клиента на сайте Travella."
  );
});

// 👤 Профиль
bot.hears("👤 Профиль", async (ctx) => {
  console.log("[tg-bot] main menu: Профиль");
  const role = await resolveRoleByChat(ctx);

  if (!role) {
    await ctx.reply(
      "Похоже, аккаунт ещё не привязан.\n" +
        "Нажмите /start и привяжите номер телефона."
    );
    return;
  }

  const profile = await fetchProfile(ctx, role);
  if (!profile) {
    await ctx.reply(
      "Не удалось получить ваш профиль. Попробуйте позже или зайдите на сайт travella.uz."
    );
    return;
  }

  const name = profile.name || "Без имени";
  const phone = profile.phone || "не указан";
  const id = profile.id || "?";

  if (role === "client") {
    await ctx.reply(
      `👤 Профиль клиента Travella\n\n` +
        `ID: ${id}\n` +
        `Имя: ${name}\n` +
        `Телефон: ${phone}\n\n` +
        `Полный профиль можно отредактировать на сайте:\nhttps://travella.uz`
    );
  } else {
    await ctx.reply(
      `🏢 Профиль поставщика Travella\n\n` +
        `ID: ${id}\n` +
        `Название: ${name}\n` +
        `Телефон: ${phone}\n\n` +
        `Детали профиля и услуги доступны в кабинете поставщика:\nhttps://travella.uz`
    );
  }
});

// 🏢 Стать поставщиком
bot.hears("🏢 Стать поставщиком", async (ctx) => {
  console.log("[tg-bot] main menu: Стать поставщиком");
  const role = await resolveRoleByChat(ctx);

  if (role === "provider") {
    await ctx.reply(
      "Вы уже привязаны как поставщик Travella. 🎉\n" +
        "Управлять услугами можно в кабинете поставщика на сайте:\nhttps://travella.uz"
    );
    return;
  }

  await ctx.reply(
    "Чтобы стать поставщиком Travella (гид, отель, транспорт, турагент),\n" +
      "заполните анкету на сайте:\nhttps://travella.uz\n\n" +
      "Наш менеджер свяжется с вами и поможет подключиться."
  );
});

// ⚠️ ВАЖНО: здесь НЕ вызывать bot.launch() в Railway,
// запуск делает index.js через require("./telegram/bot")

module.exports = { bot };
