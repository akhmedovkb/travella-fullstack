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

const PUBLIC_BASE = (
  process.env.SITE_PUBLIC_URL ||
  "https://travella.uz"
).replace(/\/+$/, "");

console.log("[tg-bot] API_BASE =", API_BASE);

// ==== INIT BOT ====

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// Логируем все апдейты (чтобы на проде видеть, что вообще приходит)
bot.use(async (ctx, next) => {
  try {
    const u = ctx.update || {};
    const info = {
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

function getInlineCategoryKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Отказной тур",
            switch_inline_query_current_chat: "#refused_tour",
          },
          {
            text: "Отказной отель",
            switch_inline_query_current_chat: "#refused_hotel",
          },
        ],
        [
          {
            text: "Отказной авиабилет",
            switch_inline_query_current_chat: "#refused_flight",
          },
          {
            text: "Отказной билет",
            switch_inline_query_current_chat: "#refused_event",
          },
        ],
        [
          {
            text: "Главное меню",
            callback_data: "goto:main",
          },
        ],
      ],
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
  if (direction) line += ` · ${direction}`;
  return `${cat}: ${line}`;
}

/**
 * Детальное описание услуги для карточки (при клике)
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

  if (details.hotel) lines.push(`Отель: ${details.hotel}`);
  if (details.roomCategory) lines.push(`Категория номера: ${details.roomCategory}`);
  if (details.accommodation) lines.push(`Размещение: ${details.accommodation}`);
  if (details.food) lines.push(`Питание: ${details.food}`);
  if (details.transfer) lines.push(`Трансфер: ${details.transfer}`);

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

  if (lines.length <= 3 && Object.keys(details).length > 0) {
    lines.push(
      "Доп. детали: " +
        JSON.stringify(details, null, 2).substring(0, 800)
    );
  }

  return lines.join("\n");
}

// ==== PHONE LINKING ====

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

    // Главное меню
    await ctx.reply(
      "В любой момент можете открыть главное меню и выбрать нужный раздел.",
      getMainMenuKeyboard(finalRole)
    );

    // И сразу подсказка про inline-поиск отказных услуг
    await ctx.reply(
      "Быстрый поиск отказных туров / отелей / авиабилетов / билетов:",
      getInlineCategoryKeyboard()
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
    } catch (e) {}

    if (!role) {
      try {
        const resProv = await axios.get(
          `${API_BASE}/api/telegram/profile/provider/${chatId}`
        );
        console.log("[tg-bot] profile provider resp:", resProv.status, resProv.data);
        if (resProv.data && resProv.data.success) {
          role = "provider";
        }
      } catch (e) {}
    }

    console.log("[tg-bot] resolved role on /start:", role);

    if (role) {
      if (!ctx.session) ctx.session = {};
      ctx.session.role = role;
      ctx.session.linked = true;

      await ctx.reply(
        "Добро пожаловать в Travella! 👋\nГлавное меню доступно ниже.",
        getMainMenuKeyboard(role)
      );

      await ctx.reply(
        "Быстрый поиск отказных туров / отелей / авиабилетов / билетов:",
        getInlineCategoryKeyboard()
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

bot.action("goto:main", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const role = ctx.session?.role || "client";
    await ctx.reply("Главное меню ниже 👇", getMainMenuKeyboard(role));
  } catch (e) {
    console.error("[tg-bot] goto:main error:", e);
  }
});

// ==== CONTACT ====

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
  if (!ctx.session || !ctx.session.requestedRole) return;

  const phone = ctx.message.text.trim();
  const requestedRole = ctx.session.requestedRole;

  await handlePhoneRegistration(ctx, requestedRole, phone, false);
});

// ==== ГЛАВНОЕ МЕНЮ: КНОПКИ ====

bot.hears("🔍 Найти услугу", async (ctx) => {
  if (!ctx.session) ctx.session = {};
  ctx.session.search = null;

  await ctx.reply("Выберите тип услуги:", getInlineCategoryKeyboard());
});

// Остальные пункты меню пока с аккуратными текстами, чтобы ничего не ломать

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

// ==== INLINE MODE (встроенный бот) ====

// парсим категорию из inline-запроса
function categoryFromInlineQuery(q) {
  const t = (q || "").trim().toLowerCase();

  if (t.startsWith("#refused_tour") || t.startsWith("#tour")) return "refused_tour";
  if (t.startsWith("#refused_hotel") || t.startsWith("#hotel")) return "refused_hotel";
  if (t.startsWith("#refused_flight") || t.startsWith("#flight") || t.startsWith("#avia"))
    return "refused_flight";
  if (t.startsWith("#refused_event") || t.startsWith("#event") || t.startsWith("#ticket"))
    return "refused_event";

  // если ничего не указано — показываем просто топ отказных туров
  return null;
}

bot.on("inline_query", async (ctx) => {
  try {
    const iq = ctx.inlineQuery;
    const fromId = iq.from.id;
    const q = iq.query || "";

    console.log("[tg-bot] inline_query:", { fromId, q });

    const category = categoryFromInlineQuery(q);

    const payload = {
      limit: 20,
    };
    if (category) payload.category = category;

    const { data } = await axios.post(
      `${API_BASE}/api/telegram/client/${fromId}/search`,
      payload
    );

    if (!data || !data.success || !Array.isArray(data.items) || data.items.length === 0) {
      await ctx.answerInlineQuery([], {
        cache_time: 5,
        switch_pm_text: "Нет подходящих услуг",
        switch_pm_parameter: "start",
      });
      return;
    }

    const results = data.items.map((item) => {
      const details = item.details || {};
      const title = item.title || details.title || "Без названия";
      const short = formatServiceShort(item);

      let thumb = null;
      if (Array.isArray(details.images) && details.images.length > 0) {
        thumb = details.images[0];
      } else if (details.mainImage) {
        thumb = details.mainImage;
      }

      const url = `${PUBLIC_BASE}/marketplace/service/${item.id}`;

      return {
        type: "article",
        id: String(item.id),
        title,
        description: short,
        thumb_url: thumb || undefined,
        input_message_content: {
          message_text:
            formatServiceDetails(item) +
            `\n\nПодробнее: ${url}`,
          parse_mode: "HTML",
        },
        reply_markup: {
          inline_keyboard: [
            [{ text: "Открыть на Travella", url }],
            [
              {
                text: "⚡ Быстрый запрос по этой услуге",
                callback_data: `quickReq:${item.id}`,
              },
            ],
          ],
        },
      };
    });

    await ctx.answerInlineQuery(results, {
      cache_time: 5,
      is_personal: true,
    });
  } catch (e) {
    console.error("[tg-bot] inline_query error:", e?.response?.data || e);
    try {
      await ctx.answerInlineQuery([], {
        cache_time: 2,
        switch_pm_text: "Ошибка, откройте чат с ботом",
        switch_pm_parameter: "start",
      });
    } catch {}
  }
});

bot.action(/^quickReq:(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const id = ctx.match[1];
    await ctx.reply(
      "Скоро здесь появится быстрый запрос по услуге #" +
        id +
        ". Пока можете оставить заявку прямо на сайте travella.uz."
    );
  } catch (e) {
    console.error("[tg-bot] quickReq error:", e);
  }
});

// ⚠️ ВАЖНО: здесь НЕТ bot.launch()
// Запуском занимается index.js, который импортирует { bot }

module.exports = { bot };
