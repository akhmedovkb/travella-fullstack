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

const BOT_TOKEN = CLIENT_TOKEN || OLD_TOKEN;

if (!BOT_TOKEN) {
  throw new Error("No TELEGRAM_CLIENT_BOT_TOKEN/TELEGRAM_BOT_TOKEN in env");
}

const API_BASE = (
  process.env.API_BASE_URL ||
  process.env.SITE_API_URL ||
  "http://localhost:8080"
).replace(/\/+$/, "");

console.log("[tg-bot] Using CLIENT token for Telegraf bot");
console.log("[tg-bot] API_BASE =", API_BASE);

// ==== INIT BOT ====

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// ==== CONSTANTS ====

const BTN_FIND = "🔍 Найти услугу";
const BTN_FAV = "❤️ Избранное";
const BTN_BOOKINGS = "📄 Мои брони";
const BTN_REQUESTS = "📨 Мои заявки";
const BTN_PROFILE = "👤 Профиль";
const BTN_BECOME_PROVIDER = "🏢 Стать поставщиком";

const CATEGORY_LABEL = {
  refused_tour: "Отказной тур",
  refused_hotel: "Отказной отель",
  refused_flight: "Отказной авиабилет",
  refused_event: "Отказной билет на мероприятие",
};

function getMainMenuKeyboard(role) {
  // role: "client" | "provider" (пока меню одинаковое)
  return {
    reply_markup: {
      keyboard: [
        [{ text: BTN_FIND }, { text: BTN_FAV }],
        [{ text: BTN_BOOKINGS }, { text: BTN_REQUESTS }],
        [{ text: BTN_PROFILE }, { text: BTN_BECOME_PROVIDER }],
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

// =================== ПРИВЯЗКА ТЕЛЕФОНА ===================

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

    console.log("[bot] handlePhoneRegistration payload:", payload);

    const { data } = await axios.post(
      `${API_BASE}/api/telegram/link`,
      payload
    );

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

// =================== /start ===================

bot.start(async (ctx) => {
  const chatId = ctx.chat.id;

  try {
    console.log("[tg-bot] /start from", {
      chatId,
      username: ctx.from?.username,
    });

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
      // 404 — это нормально
    }

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
        // тоже может быть 404
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

// =================== INLINE-роль ===================

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

// =================== CONTACT ===================

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

// =================== ТЕКСТОВЫЙ ВВОД ТЕЛЕФОНА ===================

bot.hears(/^\+?\d[\d\s\-()]{5,}$/i, async (ctx) => {
  if (!ctx.session || !ctx.session.requestedRole) {
    return;
  }

  const phone = ctx.message.text.trim();
  const requestedRole = ctx.session.requestedRole;

  await handlePhoneRegistration(ctx, requestedRole, phone, false);
});

// =================== ПОИСК ОТКАЗНЫХ УСЛУГ ===================

function formatServiceForMessage(service) {
  const d = service.details || {};
  const cat = service.category;
  const catLabel = CATEGORY_LABEL[cat] || "Отказная услуга";

  const emoji =
    cat === "refused_tour"
      ? "✈️"
      : cat === "refused_hotel"
      ? "🏨"
      : cat === "refused_flight"
      ? "🛫"
      : cat === "refused_event"
      ? "🎫"
      : "🔥";

  const lines = [];
  lines.push(`${emoji} ${catLabel}`);

  if (service.title) {
    lines.push(`Название: ${service.title}`);
  }

  const dirParts = [];
  if (d.directionCountry) dirParts.push(d.directionCountry);
  const cities = [d.directionFrom, d.directionTo].filter(Boolean).join(" → ");
  if (cities) dirParts.push(cities);
  if (dirParts.length) {
    lines.push(`Направление: ${dirParts.join(" / ")}`);
  }

  const dateStart = d.startDate || d.checkInDate || d.departureDate;
  const dateEnd = d.endDate || d.checkOutDate || d.returnDate;

  if (dateStart || dateEnd) {
    lines.push(
      `Даты: ${dateStart || "?"} — ${dateEnd || "?"}`
    );
  }

  if (d.hotelName || d.hotel) {
    lines.push(`Отель: ${d.hotelName || d.hotel}`);
  }

  const price =
    d.netPrice || service.price_from || service.price || null;
  if (price) {
    const currency =
      d.currency || service.currency || "USD";
    lines.push(`Цена нетто: ${price} ${currency}`);
  }

  if (service.provider_name) {
    lines.push(`Поставщик: ${service.provider_name}`);
  }

  return lines.join("\n");
}

async function handleSearchQuery(ctx, query) {
  try {
    const chatId = ctx.chat.id;
    const text = (query || "").trim();

    if (!text) {
      await ctx.reply("Введите, пожалуйста, страну, город или ключевое слово для поиска отказных услуг.");
      return;
    }

    await ctx.reply("Ищу отказные туры/отели/авиабилеты/билеты...");

    const { data } = await axios.post(
      `${API_BASE}/api/telegram/client/${chatId}/search`,
      {
        query: text,
        type: "all",
      }
    );

    if (!data || !data.success) {
      console.error("[tg-bot] search error resp:", data);
      await ctx.reply("Не удалось выполнить поиск. Попробуйте позже.");
      return;
    }

    const items = data.items || [];

    if (!items.length) {
      await ctx.reply(
        "По вашему запросу не найдено отказных туров/отелей/авиабилетов/билетов.\n" +
          "Попробуйте изменить запрос (например: только страну или город)."
      );
      return;
    }

    const countShown = Math.min(items.length, 5);
    await ctx.reply(
      `Нашёл ${items.length} предложений. Показываю первые ${countShown}:`
    );

    for (const s of items.slice(0, countShown)) {
      const msg = formatServiceForMessage(s);
      await ctx.reply(msg, {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "📩 Быстрый запрос",
                callback_data: `fastreq:${s.id}`,
              },
            ],
          ],
        },
      });
    }
  } catch (e) {
    console.error("[tg-bot] handleSearchQuery error:", e?.response?.data || e);
    await ctx.reply("Произошла ошибка при поиске. Попробуйте позже.");
  }
}

// Кнопка "Найти услугу"
bot.hears(BTN_FIND, async (ctx) => {
  if (!ctx.session) ctx.session = {};
  ctx.session.state = "wait_search_query";

  await ctx.reply(
    "Введите страну, город или ключевое слово для поиска отказных туров/отелей/авиабилетов/билетов.\n\n" +
      "Например: <b>Тайланд</b>, <b>Пхукет</b>, <b>Дубай</b>.",
    { parse_mode: "HTML" }
  );
});

// Остальные кнопки — пока простые сообщения (не ломаем текущую логику)

bot.hears(BTN_PROFILE, async (ctx) => {
  await ctx.reply(
    "Ваш профиль клиента можно дополнить и изменить на сайте Travella:\n" +
      "https://travella.uz",
    { disable_web_page_preview: false }
  );
});

bot.hears(BTN_BECOME_PROVIDER, async (ctx) => {
  await ctx.reply(
    "Чтобы стать поставщиком Travella, заполните форму на сайте:\nhttps://travella.uz и дождитесь модерации.\n" +
      "Мы также свяжемся с вами по указанным контактам.",
    { disable_web_page_preview: false }
  );
});

bot.hears(BTN_FAV, async (ctx) => {
  await ctx.reply(
    "Не удалось загрузить избранное. Эта функция скоро будет подключена к вашему аккаунту Travella."
  );
});

bot.hears(BTN_BOOKINGS, async (ctx) => {
  await ctx.reply(
    "Не удалось загрузить брони. Скоро бот начнет показывать ваши бронирования из Travella."
  );
});

bot.hears(BTN_REQUESTS, async (ctx) => {
  await ctx.reply(
    "Не удалось загрузить заявки. В ближайшее время бот будет показывать ваши запросы."
  );
});

// Обработка быстрых запросов (пока просто заглушка, но без ошибок)
bot.action(/^fastreq:(\d+)$/, async (ctx) => {
  const serviceId = ctx.match[1];
  try {
    await ctx.answerCbQuery();
  } catch (_) {}

  await ctx.reply(
    "Функция быстрого запроса через бот в процессе доработки.\n" +
      `Вы можете найти эту услугу на Travella по ID: ${serviceId} или написать поставщику прямо по контактам в карточке.`
  );
});

// Общий обработчик текстов — ловим состояние поиска
bot.on("text", async (ctx) => {
  const text = ctx.message.text || "";

  // если это одна из кнопок — её уже обработали через bot.hears
  if (
    text === BTN_FIND ||
    text === BTN_FAV ||
    text === BTN_BOOKINGS ||
    text === BTN_REQUESTS ||
    text === BTN_PROFILE ||
    text === BTN_BECOME_PROVIDER
  ) {
    return;
  }

  if (ctx.session && ctx.session.state === "wait_search_query") {
    ctx.session.state = null;
    await handleSearchQuery(ctx, text);
    return;
  }

  // Остальные текстовые сообщения пока игнорируем
});

// ⚠️ ВАЖНО: здесь нет bot.launch() в исходнике,
// но index.js его вызывает. Поэтому экспортируем только bot.

module.exports = { bot };
