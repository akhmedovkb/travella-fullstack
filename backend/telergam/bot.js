// backend/telegram/bot.js
const { Telegraf, Markup, session } = require("telegraf");
const dotenv = require("dotenv");
const axios = require("axios");

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("[tg-bot] ❌ TELEGRAM_BOT_TOKEN не задан в .env");
  // не падаем process.exit, чтобы API мог работать без бота
}

// Базовый URL бэкенда (используем для запросов позже)
// Пример: https://travella-production.up.railway.app
const API_BASE =
  (process.env.API_BASE_URL || "").replace(/\/+$/, "") || "";

// Текст кнопок (оставляем RU — их легко поменять)
const BTN_FIND_SERVICE = "🔍 Найти услугу";
const BTN_BOOKINGS = "📅 Мои брони";
const BTN_FAVORITES = "❤️ Избранное";
const BTN_REQUESTS = "🧾 Мои заявки";
const BTN_PROFILE = "👤 Профиль";
const BTN_BECOME_PROVIDER = "🏢 Стать поставщиком";
const BTN_BACK_MENU = "⬅️ В главное меню";
const BTN_REGISTER = "📝 Регистрация";

// Главное меню (reply-keyboard)
const mainKeyboard = Markup.keyboard([
  [BTN_FIND_SERVICE],
  [BTN_BOOKINGS, BTN_FAVORITES],
  [BTN_REQUESTS],
  [BTN_PROFILE, BTN_BECOME_PROVIDER],
]).resize();

// Клавиатура “назад в меню”
const backKeyboard = Markup.keyboard([[BTN_BACK_MENU]]).resize();

// Создаём бота только если есть токен
const bot = BOT_TOKEN ? new Telegraf(BOT_TOKEN) : null;

function resetSession(ctx) {
  ctx.session = { step: null, data: {} };
}

/** ============================ Мидлвары ============================ */
if (bot) {
  bot.use(session());

  // Логирование простое (можно выключить, если мешает)
  bot.use(async (ctx, next) => {
    try {
      const from = ctx.from
        ? `${ctx.from.id} (${ctx.from.username || ctx.from.first_name || "?"})`
        : "unknown";
      console.log(`[tg-bot] update from ${from}: ${ctx.updateType}`);
    } catch {
      // no-op
    }
    return next();
  });

  /** ============================ /start ============================ */
  bot.start(async (ctx) => {
    resetSession(ctx);
    const name = ctx.from?.first_name || ctx.from?.username || "";
    let text = "Добро пожаловать в Travella!";

    if (name) {
      text = `Привет, ${name}! 👋\n\nЭто бот маркетплейса Travella.`;
    } else {
      text = "Привет! 👋\n\nЭто бот маркетплейса Travella.";
    }

    text +=
      "\n\nЗдесь скоро можно будет:\n" +
      "• искать услуги маркетплейса,\n" +
      "• смотреть свои брони и заявки,\n" +
      "• привязать аккаунт клиента или поставщика.\n\n" +
      "Выберите действие из меню ниже.";

    await ctx.reply(text, mainKeyboard);
  });

  // Команда /menu — просто показать клавиатуру
  bot.command("menu", async (ctx) => {
    resetSession(ctx);
    await ctx.reply("Главное меню:", mainKeyboard);
  });

  /** ============================ Регистрация / профиль ============================ */
  // Кнопка "Профиль" или "Регистрация" → выбор роли
  bot.hears([BTN_PROFILE, BTN_REGISTER, BTN_BECOME_PROVIDER], async (ctx) => {
    resetSession(ctx);
    ctx.session.step = "reg_choose_role";
    await ctx.reply(
      "Кем вы пользуетесь Travella?",
      Markup.inlineKeyboard([
        [
          Markup.button.callback("🙋 Я клиент", "reg_role_client"),
          Markup.button.callback("🏢 Я поставщик", "reg_role_provider"),
        ],
      ])
    );
  });

  // Выбор роли
  bot.action(["reg_role_client", "reg_role_provider"], async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      // ignore
    }

    const role = ctx.callbackQuery.data === "reg_role_client" ? "client" : "provider";
    ctx.session.step = "reg_wait_phone";
    ctx.session.data = { role };

    const who = role === "client" ? "клиента" : "поставщика";

    await ctx.reply(
      `Ок, будем привязывать аккаунт ${who}.\n\n` +
        "Отправьте пожалуйста номер телефона, который вы указали на сайте travella.uz.\n\n" +
        "Можно просто прислать текстом:\n" +
        "<code>+998901234567</code>\n\n" +
        "или воспользоваться кнопкой ниже.",
      Markup.keyboard([
        [Markup.button.contactRequest("📱 Отправить номер")],
        [BTN_BACK_MENU],
      ]).resize(),
      { parse_mode: "HTML" }
    );
  });

  // Обработка контакта (когда жмут кнопку "отправить номер")
  bot.on("contact", async (ctx) => {
    if (ctx.session?.step !== "reg_wait_phone") return;

    const phone = ctx.message.contact?.phone_number;
    if (!phone) {
      await ctx.reply("Не удалось прочитать номер телефона. Попробуйте отправить его текстом.");
      return;
    }
    await handlePhoneRegistration(ctx, phone);
  });

  // Обработка текста, если мы ждём телефон
  bot.hears(BTN_BACK_MENU, async (ctx) => {
    resetSession(ctx);
    await ctx.reply("Возвращаемся в главное меню:", mainKeyboard);
  });

  bot.on("text", async (ctx) => {
    const step = ctx.session?.step;

    // Если ждём телефон в процессе регистрации
    if (step === "reg_wait_phone") {
      const phone = (ctx.message.text || "").trim();
      if (!phone) {
        await ctx.reply("Пожалуйста, отправьте номер телефона или нажмите кнопку ниже.");
        return;
      }
      await handlePhoneRegistration(ctx, phone);
      return;
    }

    // Иначе — обрабатываем как команду/меню
    const text = (ctx.message.text || "").trim();

    if (text === BTN_FIND_SERVICE) {
      await handleSearchStart(ctx);
    } else if (text === BTN_BOOKINGS) {
      await handleMyBookings(ctx);
    } else if (text === BTN_FAVORITES) {
      await handleMyFavorites(ctx);
    } else if (text === BTN_REQUESTS) {
      await handleMyRequests(ctx);
    } else if (text === BTN_PROFILE) {
      // если пользователь нажал "Профиль" после регистрации — просто подсказка
      await ctx.reply(
        "Пока здесь только привязка по телефону.\n" +
          "Скоро здесь появится просмотр вашего профиля Travella.",
        mainKeyboard
      );
    } else {
      // дефолт
      await ctx.reply(
        "Я пока не понимаю это сообщение.\nВыберите действие из меню ниже:",
        mainKeyboard
      );
    }
  });

  /** ============================ Обработчики (регистрация) ============================ */

  async function handlePhoneRegistration(ctx, rawPhone) {
    const role = ctx.session?.data?.role || "client";
    const chatId = ctx.from?.id;
    const username = ctx.from?.username || "";
    const firstName = ctx.from?.first_name || "";
    const phone = String(rawPhone || "").trim();

    // Нормализуем + убираем пробелы
    const cleanPhone = phone.replace(/\s+/g, "");

    // 👉 ВАЖНО: сейчас мы НИЧЕГО не меняем в базе,
    // а просто благодарим пользователя.
    // Позже сюда добавим реальный запрос в БД / к API.
    try {
      // TODO: здесь можно будет:
      // 1) искать клиента/поставщика по телефону в БД
      // 2) обновлять telegram_chat_id у найденной записи
      // 3) если не найдено — просить сначала зарегистрироваться на сайте

      console.log("[tg-bot] registration request:", {
        role,
        chatId,
        username,
        firstName,
        phone: cleanPhone,
      });

      await ctx.reply(
        "Спасибо! 🙌\n\n" +
          "Мы зафиксировали ваш номер телефона и Telegram.\n" +
          "Скоро здесь появится полноценная привязка к аккаунту Travella и просмотр ваших бронирований.\n\n" +
          "Пока можете пользоваться маркетплейсом на сайте:\n" +
          "https://travella.uz",
        mainKeyboard
      );
      resetSession(ctx);
    } catch (e) {
      console.error("[tg-bot] handlePhoneRegistration error:", e.message || e);
      await ctx.reply(
        "Произошла ошибка при обработке номера. Попробуйте позже или зарегистрируйтесь через сайт travella.uz.",
        mainKeyboard
      );
      resetSession(ctx);
    }
  }

  /** ============================ Обработчики (поиск / маркетплейс) ============================ */

  async function handleSearchStart(ctx) {
    // Скромный MVP: просто спрашиваем текст запроса и отдаем заглушку.
    ctx.session.step = "search_wait_query";
    await ctx.reply(
      "Введите, что вы ищете:\n\n" +
        "Например:\n" +
        "• «отказной тур Паттайя»\n" +
        "• «гид Самарканд»\n" +
        "• «транспорт Ташкент»\n\n" +
        "Скоро здесь будет полноценный поиск по маркетплейсу Travella.",
      backKeyboard
    );

    // Следующее текстовое сообщение пойдёт в этот обработчик:
    bot.once("text", async (ctx2) => {
      const q = (ctx2.message.text || "").trim();
      if (q === BTN_BACK_MENU) {
        resetSession(ctx2);
        await ctx2.reply("Главное меню:", mainKeyboard);
        return;
      }

      // TODO: здесь будет реальный вызов API поиска, например:
      // const res = await axios.post(`${API_BASE}/api/marketplace/search`, { query: q });

      await ctx2.reply(
        `Вы ищете: “${q}”.\n\nПолноценный поиск по маркетплейсу будет подключён позже.\nПока воспользуйтесь сайтом: https://travella.uz`,
        mainKeyboard
      );
      resetSession(ctx2);
    });
  }

  async function handleMyBookings(ctx) {
    // TODO: позже подтянем реальные брони по chat_id/телефону
    await ctx.reply(
      "Просмотр бронирований из бота пока в разработке.\n" +
        "Ваши брони можно посмотреть на сайте в разделе «Брони»:\n" +
        "https://travella.uz",
      mainKeyboard
    );
  }

  async function handleMyFavorites(ctx) {
    await ctx.reply(
      "Избранное в боте пока не подключено.\n" +
        "На сайте travella.uz вы можете добавлять услуги в избранное и управлять ими.",
      mainKeyboard
    );
  }

  async function handleMyRequests(ctx) {
    await ctx.reply(
      "Список заявок из бота пока в разработке.\n" +
        "На сайте вы можете посмотреть раздел «Запросы».",
      mainKeyboard
    );
  }
}

/**
 * Экспортируем бота для telegramRoutes.js
 * (router будет вызывать bot.handleUpdate(update))
 */
module.exports = {
  bot,
};
