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

function getMainMenuKeyboard(role) {
  // пока меню одинаковое для ролей
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

/**
 * Преобразуем услугу из /api/telegram/client/:chatId/search
 * в красивый текст + url картинки + url на сайт
 */
function buildServiceMessage(svc, category) {
  let d = svc.details || {};
  if (typeof d === "string") {
    try {
      d = JSON.parse(d);
    } catch {
      d = {};
    }
  }

  const title = svc.title || CATEGORY_LABELS[category] || "Услуга";

  // Направление
  const directionParts = [];
  if (d.directionFrom && d.directionTo) {
    directionParts.push(`${d.directionFrom} → ${d.directionTo}`);
  }
  if (d.directionCountry) {
    directionParts.push(d.directionCountry);
  }
  const direction =
    directionParts.length > 0 ? directionParts.join(" · ") : null;

  // Даты
  const dates =
    d.startFlightDate && d.endFlightDate
      ? `Даты: ${d.startFlightDate} → ${d.endFlightDate}`
      : d.startDate && d.endDate
      ? `Даты: ${d.startDate} → ${d.endDate}`
      : null;

  // Отель + размещение
  const hotel = d.hotel || d.hotelName || null;
  const accommodation = d.accommodation || null;

  // Цена
  const netPrice =
    d.netPrice || d.price || d.grossPrice || d.amount || svc.price || null;

  // Поставщик
  const providerName = svc.provider_name || "Поставщик Travella";
  const providerTelegram = svc.provider_telegram || null;
  let providerLine;

  if (providerTelegram) {
    const username = String(providerTelegram).replace(/^@/, "");
    providerLine = `Поставщик: [${providerName}](https://t.me/${username})`;
  } else {
    providerLine = `Поставщик: ${providerName}`;
  }

  const lines = [];
  lines.push(`*${title}*`);
  if (direction) lines.push(direction);
  if (dates) lines.push(dates);
  if (hotel) lines.push(`Отель: ${hotel}`);
  if (accommodation) lines.push(`Размещение: ${accommodation}`);
  if (netPrice) lines.push(`Цена (нетто): *${netPrice}*`);
  lines.push(providerLine);
  lines.push("");
  lines.push(`Подробнее и бронирование: ${SITE_URL}`);

  const text = lines.join("\n");

  const photoUrl =
    Array.isArray(svc.images) && svc.images.length
      ? svc.images[0].url || svc.images[0].src || svc.images[0]
      : null;

  // пока прямой страницы услуги нет — оставляем общий SITE_URL
  const serviceUrl = SITE_URL;

  return { text, photoUrl, serviceUrl };
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
      const resClient = await axios.get(
        `/api/telegram/profile/client/${chatId}`
      );
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
        const resProv = await axios.get(
          `/api/telegram/profile/provider/${chatId}`
        );
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
});

// заглушки, чтобы не было 404
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
      "Пока все ваши брони доступны в личном кабинете на сайте travella.uz."
  );
});

bot.hears(/📨 Мои заявки/i, async (ctx) => {
  logUpdate(ctx, "hears Мои заявки");
  await ctx.reply(
    "Пока раздел заявок в боте в разработке.\n" +
      "Вы можете смотреть отклики и заявки на сайте travella.uz."
  );
});

bot.hears(/👤 Профиль/i, async (ctx) => {
  logUpdate(ctx, "hears Профиль");
  await ctx.reply(
    "Ваш профиль клиента можно дополнить и изменить на сайте travella.uz во вкладке «Профиль».\n\n" +
      "Ссылка: https://travella.uz"
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

// ==== ПОИСК ОТКАЗНЫХ УСЛУГ (кнопка "Найти услугу") ====
// Красивый формат + фото + inline-кнопки

bot.action(
  /^find:(refused_tour|refused_hotel|refused_flight|refused_ticket)$/,
  async (ctx) => {
    try {
      const category = ctx.match[1]; // refused_tour | refused_hotel | ...

      await ctx.answerCbQuery();
      logUpdate(ctx, `action search ${category}`);

      const chatId = ctx.chat.id;

      await ctx.reply("Ищу подходящие предложения...");

      const { data } = await axios.get(
        `/api/telegram/client/${chatId}/search`,
        { params: { category } }
      );

      if (!data || !data.success || !Array.isArray(data.items)) {
        console.log("[tg-bot] search resp malformed:", data);
        await ctx.reply(
          "Произошла ошибка при загрузке услуг. Попробуйте позже."
        );
        return;
      }

      if (!data.items.length) {
        await ctx.reply(
          "К сожалению, по этой категории сейчас нет подходящих предложений."
        );
        return;
      }

      await ctx.reply(
        `Нашёл ${data.items.length} предложений.\nТоп 10 ниже:`
      );

      for (const svc of data.items.slice(0, 10)) {
        const { text, photoUrl, serviceUrl } = buildServiceMessage(
          svc,
          category
        );

        const keyboard = {
          inline_keyboard: [
            [
              { text: "Подробнее на сайте", url: serviceUrl },
              { text: "📩 Быстрый запрос", callback_data: `request:${svc.id}` },
            ],
          ],
        };

        if (photoUrl) {
          await ctx.replyWithPhoto(photoUrl, {
            caption: text,
            parse_mode: "Markdown",
            reply_markup: keyboard,
          });
        } else {
          await ctx.reply(text, {
            parse_mode: "Markdown",
            reply_markup: keyboard,
          });
        }
      }
    } catch (e) {
      console.error(
        "[tg-bot] error in search:",
        e?.response?.data || e.message || e
      );
      await ctx.reply(
        "Не удалось загрузить услуги. Попробуйте позже."
      );
    }
  }
);

// ==== Быстрый запрос по кнопке "📩 Быстрый запрос" ====
// Отправляем заявку в чат менеджера, без бэкенда

bot.action(/^request:(\d+)$/, async (ctx) => {
  try {
    const serviceId = Number(ctx.match[1]);
    if (!ctx.session) ctx.session = {};
    ctx.session.pendingRequestServiceId = serviceId;
    ctx.session.state = "awaiting_request_message";

    if (!MANAGER_CHAT_ID) {
      await ctx.answerCbQuery();
      await ctx.reply(
        "Функция быстрого запроса пока недоступна (не задан TELEGRAM_MANAGER_CHAT_ID)."
      );
      return;
    }

    await ctx.answerCbQuery();
    await ctx.reply(
      "📩 Быстрый запрос\n\n" +
        "Напишите, пожалуйста, сообщение по этому туру (пожелания, даты, количество человек)\n" +
        "и оставьте контактный номер, если он отличается от Telegram.",
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    console.error("[tg-bot] request: action error:", e);
  }
});

// Обработка текста, когда ждём быстрый запрос

bot.on("text", async (ctx, next) => {
  try {
    if (
      ctx.session &&
      ctx.session.state === "awaiting_request_message" &&
      ctx.session.pendingRequestServiceId
    ) {
      const serviceId = ctx.session.pendingRequestServiceId;
      const msg = ctx.message.text;
      const from = ctx.from || {};
      const chatId = ctx.chat.id;

      if (!MANAGER_CHAT_ID) {
        await ctx.reply(
          "Сейчас функция быстрого запроса временно недоступна."
        );
      } else {
        const textForManager =
          "🆕 *Новый быстрый запрос из бота Travella*\n\n" +
          `Тур ID: *${serviceId}*\n` +
          `От: ${from.first_name || ""} ${from.last_name || ""} (@${
            from.username || "нет username"
          })\n` +
          `Telegram chatId: \`${chatId}\`\n\n` +
          "*Сообщение клиента:*\n" +
          msg;

        await bot.telegram.sendMessage(MANAGER_CHAT_ID, textForManager, {
          parse_mode: "Markdown",
        });

        await ctx.reply(
          "Спасибо! 🙌\n\nВаш запрос отправлен менеджеру Travella.\n" +
            "Мы свяжемся с вами в ближайшее время."
        );
      }

      // Сбрасываем состояние
      ctx.session.state = null;
      ctx.session.pendingRequestServiceId = null;
      return;
    }
  } catch (e) {
    console.error("[tg-bot] error handling quick request text:", e);
  }

  // если это не быстрый запрос — пропускаем дальше к остальным обработчикам
  return next();
});

// ==== Команда /tour_123 — показать конкретный тур по ID ====

// Вспомогательная функция: ищем услугу по ID через уже готовый search API
async function findServiceByIdViaSearch(chatId, serviceId) {
  for (const category of REFUSED_CATEGORIES) {
    try {
      const { data } = await axios.get(
        `/api/telegram/client/${chatId}/search`,
        { params: { category } }
      );

      if (!data || !data.success || !Array.isArray(data.items)) continue;

      const svc = data.items.find(
        (s) => Number(s.id) === Number(serviceId)
      );
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
    const { text, photoUrl, serviceUrl } = buildServiceMessage(
      svc,
      category
    );

    const keyboard = {
      inline_keyboard: [
        [
          { text: "Подробнее на сайте", url: serviceUrl },
          { text: "📩 Быстрый запрос", callback_data: `request:${svc.id}` },
        ],
      ],
    };

    if (photoUrl) {
      await ctx.replyWithPhoto(photoUrl, {
        caption: text,
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
    } else {
      await ctx.reply(text, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
    }
  } catch (e) {
    console.error("[tg-bot] /tour_ handler error:", e);
    await ctx.reply("Не удалось загрузить тур. Попробуйте позже.");
  }
});

// ==== INLINE-ПОИСК (встроенный бот, как на скрине) ====
// @BOT_NAME в любом чате -> список отказных услуг

bot.on("inline_query", async (ctx) => {
  try {
    logUpdate(ctx, "inline_query");

    const q = (ctx.inlineQuery?.query || "").toLowerCase().trim();

    // Определяем категорию по тексту запроса
    let category = "refused_tour"; // по умолчанию — туры

    if (q.includes("отель") || q.includes("hotel") || q.includes("#hotel")) {
      category = "refused_hotel";
    } else if (
      q.includes("авиа") ||
      q.includes("flight") ||
      q.includes("avia")
    ) {
      category = "refused_flight";
    } else if (q.includes("билет") || q.includes("ticket")) {
      category = "refused_ticket";
    } else if (
      q.includes("tour") ||
      q.includes("тур") ||
      q.includes("turov")
    ) {
      category = "refused_tour";
    }

    const chatId = ctx.from.id; // для API это формальный параметр

    const { data } = await axios.get(
      `/api/telegram/client/${chatId}/search`,
      { params: { category } }
    );

    if (!data || !data.success || !Array.isArray(data.items)) {
      console.log("[tg-bot] inline search resp malformed:", data);
      await ctx.answerInlineQuery([], { cache_time: 3 });
      return;
    }

    const results = data.items.slice(0, 25).map((svc, idx) => {
      const { text, photoUrl, serviceUrl } = buildServiceMessage(
        svc,
        category
      );

      let d = svc.details || {};
      if (typeof d === "string") {
        try {
          d = JSON.parse(d);
        } catch {
          d = {};
        }
      }

      const directionParts = [];
      if (d.directionFrom && d.directionTo) {
        directionParts.push(`${d.directionFrom} → ${d.directionTo}`);
      }
      if (d.directionCountry) {
        directionParts.push(d.directionCountry);
      }
      const direction =
        directionParts.length > 0 ? directionParts.join(" · ") : "";

      const dates =
        d.startFlightDate && d.endFlightDate
          ? `Даты: ${d.startFlightDate} → ${d.endFlightDate}`
          : d.startDate && d.endDate
          ? `Даты: ${d.startDate} → ${d.endDate}`
          : "";

      const netPrice =
        d.netPrice || d.price || d.grossPrice || d.amount || svc.price || null;

      const descriptionParts = [];
      if (direction) descriptionParts.push(direction);
      if (dates) descriptionParts.push(dates);
      if (netPrice) descriptionParts.push(`Цена нетто: ${netPrice}`);

      const description = descriptionParts.join(" | ") || "Отказная услуга";

      return {
        type: "article",
        id: String(svc.id) + "_" + idx,
        title: svc.title || CATEGORY_LABELS[category] || "Услуга",
        description,
        thumb_url: photoUrl || undefined,
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
    console.error(
      "[tg-bot] inline_query error:",
      e?.response?.data || e.message || e
    );
    try {
      await ctx.answerInlineQuery([], { cache_time: 3 });
    } catch (_) {}
  }
});

// ⚠️ здесь НЕТ bot.launch() — запуск делаем из index.js
module.exports = { bot };
