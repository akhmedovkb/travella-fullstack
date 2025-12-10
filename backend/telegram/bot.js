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

if (CLIENT_TOKEN) {
  console.log("[tg-bot] Using CLIENT token for Telegraf bot");
} else {
  console.log("[tg-bot] Using OLD token for Telegraf bot");
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

// Логируем все апдейты (чтобы на проде видеть, что вообще приходит)
bot.use(async (ctx, next) => {
  try {
    const u = ctx.update || {};
    let info = {
      type: ctx.updateType,
      subTypes: ctx.updateSubTypes,
    };
    if (ctx.from) {
      info.fromId = ctx.from.id;
      info.username = ctx.from.username;
    }
    console.log("[tg-bot] update:", info);
  } catch (e) {
    console.error("[tg-bot] log middleware error:", e);
  }
  return next();
});

// ==== HELPERS ====

function getMainMenuKeyboard(role) {
  // role: "client" | "provider"
  // можно потом различать меню по ролям
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

// ---- Форматирование услуг для поиска ----

function humanCategory(category) {
  switch (category) {
    case "refused_tour":
      return "Отказной тур";
    case "refused_hotel":
      return "Отказной отель";
    case "refused_flight":
      return "Отказной авиабилет";
    case "refused_event":
      return "Отказной билет на мероприятие";
    default:
      return category || "Услуга";
  }
}

/**
 * Короткая строка для списка услуг
 */
function formatServiceShort(item) {
  const cat = humanCategory(item.category);
  const details = item.details || {};
  const title = item.title || details.title || "Без названия";
  const directionParts = [
    details.directionFrom,
    details.directionTo || details.directionCountry,
  ].filter(Boolean);

  const direction =
    directionParts.length > 0 ? directionParts.join(" → ") : null;

  let line = `${title}`;
  if (direction) line += `\nМаршрут: ${direction}`;
  return `${cat}: ${line}`;
}

/**
 * Детальное описание услуги для карточки
 */
function formatServiceDetails(item) {
  const cat = humanCategory(item.category);
  const details = item.details || {};
  const title = item.title || details.title || "Без названия";

  const lines = [];
  lines.push(`${cat}`);
  lines.push(`Название: ${title}`);

  const directionParts = [
    details.directionFrom,
    details.directionTo || details.directionCountry,
  ].filter(Boolean);
  if (directionParts.length > 0) {
    lines.push(`Маршрут: ${directionParts.join(" → ")}`);
  }

  if (details.startDate || details.endDate) {
    lines.push(
      `Даты: ${details.startDate || "?"} — ${details.endDate || "?"}`
    );
  }

  if (details.hotel) {
    lines.push(`Отель: ${details.hotel}`);
  }

  if (details.roomCategory) {
    lines.push(`Категория номера: ${details.roomCategory}`);
  }

  if (details.accommodation) {
    lines.push(`Размещение: ${details.accommodation}`);
  }

  if (details.food) {
    lines.push(`Питание: ${details.food}`);
  }

  if (details.transfer) {
    lines.push(`Трансфер: ${details.transfer}`);
  }

  if (details.netPrice || details.price) {
    lines.push(
      `Цена нетто: ${details.netPrice || details.price} ${
        details.currency || ""
      }`.trim()
    );
  }

  if (details.expiration) {
    lines.push(`Актуально до: ${details.expiration}`);
  }

  // Если совсем мало инфы — добавим "сырые" детали как JSON одной строкой
  if (lines.length <= 3 && Object.keys(details).length > 0) {
    lines.push(
      "Доп. детали: " +
        JSON.stringify(details, null, 2).substring(0, 800)
    );
  }

  return lines.join("\n");
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

// /start внутри Telegraf
bot.start(async (ctx) => {
  const chatId = ctx.chat.id;

  try {
    console.log("[tg-bot] /start from", {
      chatId,
      username: ctx.from?.username,
    });

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
        // тоже может быть 404 — не привязан как поставщик
      }
    }

    console.log("[tg-bot] resolved role on /start:", role);

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
    // если мы вообще не ждём номер — игнор
    return;
  }

  const phone = ctx.message.text.trim();
  const requestedRole = ctx.session.requestedRole;

  await handlePhoneRegistration(ctx, requestedRole, phone, false);
});

// ==== ГЛАВНОЕ МЕНЮ: КНОПКИ ====

/**
 * 1. "🔍 Найти услугу"
 *    → показываем выбор типа:
 *       - Отказной тур
 *       - Отказной авиабилет
 *       - Отказной отель
 *       - Отказной билет
 */
bot.hears("🔍 Найти услугу", async (ctx) => {
  if (!ctx.session) ctx.session = {};
  ctx.session.search = null; // очищаем прошлый поиск

  await ctx.reply("Выберите тип услуги:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🧳 Отказной тур", callback_data: "search:type:refused_tour" }],
        [{ text: "✈️ Отказной авиабилет", callback_data: "search:type:refused_flight" }],
        [{ text: "🏨 Отказной отель", callback_data: "search:type:refused_hotel" }],
        [{ text: "🎫 Отказной билет", callback_data: "search:type:refused_event" }],
      ],
    },
  });
});

/**
 * 2. Выбор типа услуги (inline-кнопка)
 *    → запрашиваем с бэка список подходящих услуг
 *      и показываем список карточек.
 */
bot.action(/^search:type:(refused_tour|refused_hotel|refused_flight|refused_event)$/, async (ctx) => {
  try {
    const category = ctx.match[1];
    await ctx.answerCbQuery();

    if (!ctx.session) ctx.session = {};
    ctx.session.search = { category };

    const chatId = ctx.chat.id;

    const { data } = await axios.post(
      `${API_BASE}/api/telegram/client/${chatId}/search`,
      { category, limit: 10 }
    );

    if (!data || !data.success || !Array.isArray(data.items) || data.items.length === 0) {
      await ctx.reply("К сожалению, по этой категории сейчас нет подходящих предложений.");
      return;
    }

    // строим клавиатуру: каждая услуга — отдельная кнопка
    const kb = data.items.map((item) => {
      const title = item.title || (item.details && item.details.title) || "Без названия";
      const short = title.length > 40 ? title.slice(0, 37) + "…" : title;
      return [
        {
          text: short,
          callback_data: `search:svc:${item.id}`,
        },
      ];
    });

    await ctx.reply(
      `Нашли вот такие предложения по категории "${humanCategory(category)}":`,
      {
        reply_markup: {
          inline_keyboard: kb,
        },
      }
    );
  } catch (e) {
    console.error("[tg-bot] search:type error:", e?.response?.data || e);
    await ctx.reply("Не удалось загрузить список услуг. Попробуйте позже.");
  }
});

/**
 * 3. Клик по конкретной услуге
 *    → получаем все детали с бэка и показываем карточку
 */
bot.action(/^search:svc:(\d+)$/, async (ctx) => {
  try {
    const serviceId = Number(ctx.match[1]);
    await ctx.answerCbQuery();

    const chatId = ctx.chat.id;

    const { data } = await axios.post(
      `${API_BASE}/api/telegram/client/${chatId}/search`,
      { serviceId }
    );

    if (!data || !data.success || !data.item) {
      await ctx.reply("Не удалось загрузить детали услуги. Попробуйте позже.");
      return;
    }

    const text = formatServiceDetails(data.item);

    await ctx.reply(text, {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "⚡ Быстрый запрос по этой услуге",
              callback_data: `quickReq:${data.item.id}`,
            },
          ],
        ],
      },
    });
  } catch (e) {
    console.error("[tg-bot] search:svc error:", e?.response?.data || e);
    await ctx.reply("Не удалось загрузить детали услуги. Попробуйте позже.");
  }
});

// Пока "быстрый запрос" только-заглушка, чтобы не ломать ничего
bot.action(/^quickReq:(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const id = ctx.match[1];
    await ctx.reply(
      "Скоро здесь появится быстрый запрос по услуге #" + id +
        ". Пока можете оставить заявку прямо на сайте travella.uz."
    );
  } catch (e) {
    console.error("[tg-bot] quickReq error:", e);
  }
});

// Остальные кнопки меню — аккуратные заглушки (НЕ ломаем существующий функционал)

bot.hears("❤️ Избранное", async (ctx) => {
  await ctx.reply(
    "Избранное скоро появится в боте.\nПока вы можете добавлять и смотреть избранное на сайте travella.uz во вкладке «Избранное»."
  );
});

bot.hears("📄 Мои брони", async (ctx) => {
  await ctx.reply(
    "Показ бронирований через бота мы ещё доделываем.\nПока все ваши брони доступны в личном кабинете на сайте travella.uz."
  );
});

bot.hears("📨 Мои заявки", async (ctx) => {
  await ctx.reply(
    "Раздел «Мои заявки» вскоре появится в боте.\nСейчас заявки можно отслеживать в личном кабинете Travella."
  );
});

bot.hears("👤 Профиль", async (ctx) => {
  await ctx.reply(
    "Ваш профиль клиента можно дополнить и изменить на сайте travella.uz в разделе «Профиль»."
  );
});

bot.hears("🏢 Стать поставщиком", async (ctx) => {
  await ctx.reply(
    "Чтобы стать поставщиком Travella, заполните форму на сайте\nhttps://travella.uz и дождитесь модерации.\nМы также свяжемся с вами по указанным контактам."
  );
});

// ⚠️ ВАЖНО: здесь НЕТ bot.launch()
// Запуском занимается index.js, который импортирует { bot }

module.exports = { bot };
