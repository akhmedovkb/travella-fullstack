// backend/telegram/bot.js

const { Telegraf, Markup } = require("telegraf");
const dotenv = require("dotenv");
const axios = require("axios");

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_CLIENT_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error("[tg-bot] ❌ TELEGRAM_CLIENT_BOT_TOKEN не задан в .env");
  // не падаем process.exit, чтобы API мог работать без бота
}

// Базовый URL бэкенда (используем для запросов позже)
const API_BASE =
  (process.env.API_BASE_URL ||
    process.env.SITE_API_URL ||
    "").replace(/\/+$/, "") || "";

// Базовый URL фронта (для ссылок в inline-результатах и карточках)
const FRONT_BASE =
  (process.env.FRONTEND_URL ||
    process.env.SITE_PUBLIC_URL ||
    "https://travella.uz").replace(/\/+$/, "");

// username бота для диплинков вида https://t.me/<username>?start=s_123
const BOT_USERNAME = process.env.TELEGRAM_CLIENT_BOT_USERNAME || "";

// Текст кнопок
const BTN_FIND_SERVICE = "🔍 Найти услугу";
const BTN_BOOKINGS = "📅 Мои брони";
const BTN_FAVORITES = "❤️ Избранное";
const BTN_REQUESTS = "🧾 Мои заявки";
const BTN_PROFILE = "👤 Профиль";
const BTN_BECOME_PROVIDER = "🏢 Стать поставщиком";
const BTN_BACK_MENU = "⬅️ В главное меню";
const BTN_REGISTER = "📝 Регистрация";
const BTN_SUPPLIER_PANEL = "🏢 Панель поставщика";

// ======= Базовые клавиатуры (fallback) =======

const defaultMainKeyboard = Markup.keyboard([
  [BTN_FIND_SERVICE],
  [BTN_BOOKINGS, BTN_FAVORITES],
  [BTN_SUPPLIER_PANEL],
  [BTN_REQUESTS],
  [BTN_PROFILE, BTN_BECOME_PROVIDER],
]).resize();

const backKeyboard = Markup.keyboard([[BTN_BACK_MENU]]).resize();

// Создаём бота только если есть токен
const bot = BOT_TOKEN ? new Telegraf(BOT_TOKEN) : null;

/* ====================== Простая сессия в памяти (Map) ====================== */

const sessions = new Map();

function getSession(ctx) {
  const chatId = ctx.from?.id || ctx.chat?.id;
  if (!chatId) return { step: null, data: {} };
  if (!sessions.has(chatId)) {
    sessions.set(chatId, { step: null, data: {} });
  }
  return sessions.get(chatId);
}

function resetSession(ctx) {
  const chatId = ctx.from?.id || ctx.chat?.id;
  if (!chatId) return;
  sessions.set(chatId, { step: null, data: {} });
}

/* ====================== Определение роли и динамическое меню ====================== */

/**
 * Вызывает API:
 *  - /api/telegram/profile/provider/:chatId
 *  - /api/telegram/profile/client/:chatId
 * Возвращает { role: "provider" | "client" | "none", id?, name?, raw? }
 */
async function getUserRoleByChat(chatId) {
  if (!API_BASE || !chatId) return { role: "none" };

  // 1. Проверяем поставщика
  try {
    const prov = await axios.get(
      `${API_BASE}/api/telegram/profile/provider/${chatId}`
    );
    if (prov.data?.success && prov.data.user) {
      return {
        role: "provider",
        id: prov.data.user.id,
        name: prov.data.user.name,
        raw: prov.data.user,
      };
    }
  } catch {
    // ignore
  }

  // 2. Проверяем клиента
  try {
    const cli = await axios.get(
      `${API_BASE}/api/telegram/profile/client/${chatId}`
    );
    if (cli.data?.success && cli.data.user) {
      return {
        role: "client",
        id: cli.data.user.id,
        name: cli.data.user.name,
        raw: cli.data.user,
      };
    }
  } catch {
    // ignore
  }

  return { role: "none" };
}

/**
 * Собрать клавиатуру для роли
 */
function buildMainKeyboardForRole(role) {
  if (role === "provider") {
    // Меню поставщика
    return Markup.keyboard([
      [BTN_FIND_SERVICE],
      [BTN_SUPPLIER_PANEL],
      [BTN_BOOKINGS, BTN_REQUESTS],
      [BTN_FAVORITES],
      [BTN_PROFILE],
    ]).resize();
  }

  if (role === "client") {
    // Меню клиента
    return Markup.keyboard([
      [BTN_FIND_SERVICE],
      [BTN_BOOKINGS, BTN_FAVORITES],
      [BTN_REQUESTS],
      [BTN_PROFILE, BTN_BECOME_PROVIDER],
    ]).resize();
  }

  // Не привязан — дефолтное меню
  return defaultMainKeyboard;
}

/**
 * Получить { role, kb } для текущего ctx
 */
async function getRoleAndKeyboard(ctx) {
  const chatId = ctx.from?.id || ctx.chat?.id;
  if (!API_BASE || !chatId) {
    return { role: "none", kb: defaultMainKeyboard };
  }
  const info = await getUserRoleByChat(chatId);
  return { role: info.role, kb: buildMainKeyboardForRole(info.role) };
}

/** ============================ Мидлвары и обработчики ============================ */
if (bot) {
  // Логирование
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

  /** ============================ /start (с поддержкой start=s_<id>) ============================ */
  bot.start(async (ctx) => {
    resetSession(ctx);

    // 1. Пытаемся вытащить payload (s_<id> и т.п.)
    let payload = ctx.startPayload || "";
    const rawText = ctx.message?.text || "";
    if (!payload) {
      const m = rawText.match(/^\/start(?:@\S+)?(?:\s+(.+))?/i);
      if (m && m[1]) payload = m[1].trim();
    }

    // Проверяем форматы s_123 / s-123
    let deepServiceId = null;
    if (payload) {
      const mSvc = payload.trim().toLowerCase().match(/^s[-_]?(\d+)$/);
      if (mSvc) {
        deepServiceId = Number(mSvc[1]);
      }
    }

    // Если deep-link с туром — показываем карточку тура + выходим
    if (deepServiceId && Number.isFinite(deepServiceId)) {
      await showServiceCard(ctx, deepServiceId);
      return;
    }

    // 2. Обычный /start
    const name = ctx.from?.first_name || ctx.from?.username || "";
    const { kb } = await getRoleAndKeyboard(ctx);

    let text = "Добро пожаловать в Travella!";

    if (name) {
      text = `Привет, ${name}! 👋\n\nЭто бот маркетплейса Travella.`;
    } else {
      text = "Привет! 👋\n\nЭто бот маркетплейса Travella.";
    }

    text +=
      "\n\nЗдесь можно будет:\n" +
      "• искать услуги маркетплейса,\n" +
      "• смотреть свои брони и заявки,\n" +
      "• привязать аккаунт клиента или поставщика.\n\n" +
      "Выберите действие из меню ниже.";

    await ctx.reply(text, kb);
  });

  // /menu — показать актуальное меню для роли
  bot.command("menu", async (ctx) => {
    resetSession(ctx);
    const { kb } = await getRoleAndKeyboard(ctx);
    await ctx.reply("Главное меню:", kb);
  });

  // /whoami — показать роль
  bot.command("whoami", async (ctx) => {
    const chatId = ctx.from.id;
    const info = await getUserRoleByChat(chatId);

    if (info.role === "provider") {
      await ctx.reply(
        `Вы авторизованы как <b>ПОСТАВЩИК</b> 🏢\n\n` +
          `ID: <code>${info.id}</code>\n` +
          `Имя: ${info.name}`,
        { parse_mode: "HTML" }
      );
      return;
    }

    if (info.role === "client") {
      await ctx.reply(
        `Вы авторизованы как <b>КЛИЕНТ</b> 🙋‍♂️\n\n` +
          `ID: <code>${info.id}</code>\n` +
          `Имя: ${info.name || "—"}`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const { kb } = await getRoleAndKeyboard(ctx);
    await ctx.reply(
      `Ваш Telegram пока не привязан к аккаунту Travella.\n\n` +
        `Нажмите «👤 Профиль» → выберите роль и привяжите номер.`,
      kb
    );
  });

  /** ============================ Регистрация / профиль ============================ */
  // "Профиль" / "Регистрация" / "Стать поставщиком" → выбор роли
  bot.hears([BTN_PROFILE, BTN_REGISTER, BTN_BECOME_PROVIDER], async (ctx) => {
    resetSession(ctx);
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

    const role =
      ctx.callbackQuery.data === "reg_role_client" ? "client" : "provider";

    const s = getSession(ctx);
    s.step = "reg_wait_phone";
    s.data = { role };

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
    const s = getSession(ctx);
    if (s.step !== "reg_wait_phone") return;

    const phone = ctx.message.contact?.phone_number;
    if (!phone) {
      await ctx.reply(
        "Не удалось прочитать номер телефона. Попробуйте отправить его текстом."
      );
      return;
    }
    await handlePhoneRegistration(ctx, phone);
  });

  // Кнопка "Назад в меню"
  bot.hears(BTN_BACK_MENU, async (ctx) => {
    resetSession(ctx);
    const { kb } = await getRoleAndKeyboard(ctx);
    await ctx.reply("Возвращаемся в главное меню:", kb);
  });

  /** ============================ Текстовые сообщения (меню + шаги) ============================ */
  bot.on("text", async (ctx) => {
    const s = getSession(ctx);
    const step = s.step;
    const text = (ctx.message.text || "").trim();

    // 1) Если ждём телефон в процессе регистрации
    if (step === "reg_wait_phone") {
      if (!text) {
        await ctx.reply(
          "Пожалуйста, отправьте номер телефона или нажмите кнопку ниже."
        );
        return;
      }
      await handlePhoneRegistration(ctx, text);
      return;
    }

    // 2) Если ждём текст поискового запроса
    if (step === "search_wait_query") {
      await handleSearchQuery(ctx, text);
      return;
    }

    // 3) Обычное меню
    if (text === BTN_FIND_SERVICE) {
      await handleSearchStart(ctx);
    } else if (text === BTN_BOOKINGS) {
      await handleMyBookings(ctx);
    } else if (text === BTN_FAVORITES) {
      await handleMyFavorites(ctx);
    } else if (text === BTN_REQUESTS) {
      await handleMyRequests(ctx);
    } else if (text === BTN_SUPPLIER_PANEL) {
      // перед панелью — проверяем, что он реально поставщик
      const info = await getUserRoleByChat(ctx.from.id);
      if (info.role !== "provider") {
        const { kb } = await getRoleAndKeyboard(ctx);
        await ctx.reply(
          "Ваш Telegram не привязан к аккаунту поставщика.\n" +
            "Нажмите «👤 Профиль» и выберите «Я поставщик», чтобы привязать номер.",
          kb
        );
        return;
      }
      await showProviderPanel(ctx);
    } else if (text === BTN_PROFILE) {
      const { kb } = await getRoleAndKeyboard(ctx);
      await ctx.reply(
        "Пока здесь только привязка по телефону.\n" +
          "Скоро здесь появится просмотр вашего профиля Travella.",
        kb
      );
    } else {
      const { kb } = await getRoleAndKeyboard(ctx);
      await ctx.reply(
        "Я пока не понимаю это сообщение.\nВыберите действие из меню ниже:",
        kb
      );
    }
  });

  /** ============================ Callback-кнопки панели поставщика ============================ */

  // Открыть список заявок поставщика
  bot.action("supplier_bookings", async (ctx) => {
    try {
      await ctx.answerCbQuery().catch(() => {});
      await handleProviderBookings(ctx);
    } catch (e) {
      console.error("[tg-bot] supplier_bookings error:", e);
    }
  });

  // Подтверждение брони
  bot.action(/supplier_confirm_(\d+)/, async (ctx) => {
    const bookingId = ctx.match[1];
    const chatId = ctx.from.id;

    try {
      await ctx.answerCbQuery().catch(() => {});
      if (!API_BASE) {
        const { kb } = await getRoleAndKeyboard(ctx);
        await ctx.reply(
          "API_BASE_URL / SITE_API_URL не настроен на сервере. Обратитесь к администратору.",
          kb
        );
        return;
      }

      await axios.post(
        `${API_BASE}/api/telegram/provider/${chatId}/bookings/${bookingId}/confirm`
      );

      // Удаляем кнопки под этим сообщением
      try {
        await ctx.editMessageReplyMarkup();
      } catch {
        // ignore
      }

      await ctx.reply(`Бронь #${bookingId} подтверждена ✅`);
    } catch (e) {
      console.error(
        "[tg-bot] supplier_confirm error:",
        e.response?.data || e.message || e
      );
      await ctx.reply("Ошибка при подтверждении. Попробуйте позже.");
    }
  });

  // Отклонение брони
  bot.action(/supplier_reject_(\d+)/, async (ctx) => {
    const bookingId = ctx.match[1];
    const chatId = ctx.from.id;

    try {
      await ctx.answerCbQuery().catch(() => {});
      if (!API_BASE) {
        const { kb } = await getRoleAndKeyboard(ctx);
        await ctx.reply(
          "API_BASE_URL / SITE_API_URL не настроен на сервере. Обратитесь к администратору.",
          kb
        );
        return;
      }

      await axios.post(
        `${API_BASE}/api/telegram/provider/${chatId}/bookings/${bookingId}/reject`
      );

      try {
        await ctx.editMessageReplyMarkup();
      } catch {
        // ignore
      }

      await ctx.reply(`Бронь #${bookingId} отклонена ❌`);
    } catch (e) {
      console.error(
        "[tg-bot] supplier_reject error:",
        e.response?.data || e.message || e
      );
      await ctx.reply("Ошибка при отклонении. Попробуйте позже.");
    }
  });

  /** ============================ Inline-режим (поиск туров с фильтрами) ============================ */

  bot.on("inline_query", async (ctx) => {
    const iq = ctx.inlineQuery || {};
    const rawQ = (iq.query || "").trim();
    const chatId = ctx.from?.id;

    if (!API_BASE) {
      return ctx.answerInlineQuery([], {
        cache_time: 5,
        is_personal: true,
      });
    }

    try {
      const roleInfo = await getUserRoleByChat(chatId);
      const role = roleInfo.role || "none";

      // Разбираем категорию и "чистый" запрос
      const { category, query } = parseInlineCategory(rawQ);

      // Если вообще ничего нет (ни текста, ни категории) — просто подсказка
      if (!query && !category) {
        const fallback = noResultsInline(
          "Начните вводить название тура, города или отеля.\n\n" +
            "Можно добавить префикс:\n" +
            "• «тур: самарканд» — отказные туры\n" +
            "• «отель: ташкент» — отказные отели\n" +
            "• «авиа: дубай» — отказные авиабилеты\n" +
            "• «билет: концерт» — билеты на мероприятия"
        );
        await ctx.answerInlineQuery(fallback, {
          cache_time: 5,
          is_personal: true,
        });
        return;
      }

      const params = {
        q: query || "",
        limit: 20,
        source: "telegram_inline",
        viewerRole: role,
      };
      if (category) {
        params.category = category; // backend может использовать для фильтрации
      }

      const resp = await axios.get(`${API_BASE}/api/marketplace/search`, {
        params,
      });

      const list =
        resp.data?.items || resp.data?.services || resp.data?.rows || [];

      const results = buildInlineResults(list, role);

      const finalResults =
        results.length > 0
          ? results
          : noResultsInline(
              "По запросу ничего не найдено в Travella.\n" +
                "Попробуйте другой запрос или зайдите на https://travella.uz"
            );

      await ctx.answerInlineQuery(finalResults, {
        cache_time: rawQ ? 30 : 5,
        is_personal: true,
        switch_pm_text: "Привязать Travella аккаунт",
        switch_pm_parameter: "link",
      });
    } catch (e) {
      console.error(
        "[tg-bot] inline_query error:",
        e.response?.data || e.message || e
      );
      const fallback = noResultsInline(
        "Ошибка при поиске. Попробуйте позже или зайдите на https://travella.uz"
      );
      await ctx.answerInlineQuery(fallback, {
        cache_time: 5,
        is_personal: true,
      });
    }
  });

  /** ============================ Callback-кнопки туров из deep-link ============================ */

  // "📝 Запросить бронь"
  bot.action(/svc_book_(\d+)/, async (ctx) => {
    const serviceId = Number(ctx.match[1]);
    try {
      await ctx.answerCbQuery().catch(() => {});
      const svc = await loadServiceById(serviceId);
      const title = svc?.title || `услуга #${serviceId}`;

      const url = `${FRONT_BASE}/services/${serviceId}`;

      await ctx.reply(
        `📝 <b>Запрос на бронирование</b>\n\n` +
          `Тур: <b>${title}</b>\n\n` +
          `Пока оформление брони через бота в разработке.\n` +
          `Вы можете оставить заявку на сайте Travella:\n${url}`,
        { parse_mode: "HTML" }
      );
    } catch (e) {
      console.error(
        "[tg-bot] svc_book error:",
        e.response?.data || e.message || e
      );
      await ctx.reply(
        "Не удалось обработать запрос на бронирование. Попробуйте позже."
      );
    }
  });

  // "❓ Задать вопрос"
  bot.action(/svc_ask_(\d+)/, async (ctx) => {
    const serviceId = Number(ctx.match[1]);
    try {
      await ctx.answerCbQuery().catch(() => {});
      const svc = await loadServiceById(serviceId);
      const title = svc?.title || `услуга #${serviceId}`;
      const url = `${FRONT_BASE}/services/${serviceId}`;

      await ctx.reply(
        `❓ <b>Задать вопрос по туру</b>\n\n` +
          `Тур: <b>${title}</b>\n\n` +
          `Напишите ваш вопрос в форме на сайте Travella на странице тура:\n${url}`,
        { parse_mode: "HTML" }
      );
    } catch (e) {
      console.error(
        "[tg-bot] svc_ask error:",
        e.response?.data || e.message || e
      );
      await ctx.reply(
        "Не удалось обработать запрос. Попробуйте позже или задайте вопрос на сайте."
      );
    }
  });

  /** ============================ Обработчики (регистрация) ============================ */

  async function handlePhoneRegistration(ctx, rawPhone) {
    const s = getSession(ctx);
    const role = s.data?.role || "client"; // "client" | "provider"

    const chatId = ctx.from?.id;
    const username = ctx.from?.username || "";
    const firstName = ctx.from?.first_name || "";
    const phone = String(rawPhone || "").trim();
    const cleanPhone = phone.replace(/\s+/g, "");

    try {
      if (!API_BASE) {
        const { kb } = await getRoleAndKeyboard(ctx);
        await ctx.reply(
          "API_BASE_URL / SITE_API_URL не настроен на сервере. Обратитесь к администратору.",
          kb
        );
        resetSession(ctx);
        return;
      }

      const resp = await axios.post(`${API_BASE}/api/telegram/link`, {
        role,
        phone: cleanPhone,
        chatId,
        username,
        firstName,
      });

      const { kb } = await getRoleAndKeyboard(ctx);

      if (resp.data?.notFound) {
        await ctx.reply(
          "Мы не нашли аккаунт Travella с таким номером телефона.\n" +
            "Сначала зарегистрируйтесь на сайте travella.uz, а затем повторите привязку.",
          kb
        );
        resetSession(ctx);
        return;
      }

      if (!resp.data?.success) {
        throw new Error("Unexpected response from /api/telegram/link");
      }

      const name = resp.data.name || firstName || "";

      await ctx.reply(
        `Спасибо, ${name || "друг"}! 🙌\n\n` +
          "Мы привязали ваш Telegram к аккаунту Travella.\n" +
          "Теперь бот сможет показывать ваши брони, заявки и отправлять уведомления.\n\n" +
          "В любой момент можете открыть главное меню и выбрать нужный раздел.",
        kb
      );
      resetSession(ctx);
    } catch (e) {
      console.error(
        "[tg-bot] handlePhoneRegistration error:",
        e.response?.data || e.message || e
      );
      const { kb } = await getRoleAndKeyboard(ctx);
      await ctx.reply(
        "Произошла ошибка при привязке телефона.\n" +
          "Попробуйте позже или выполните привязку через сайт travella.uz.",
        kb
      );
      resetSession(ctx);
    }
  }

  /** ============================ Обработчики (поиск / маркетплейс через текст) ============================ */

  async function handleSearchStart(ctx) {
    const s = getSession(ctx);
    s.step = "search_wait_query";

    await ctx.reply(
      "Введите, что вы ищете:\n\n" +
        "Например:\n" +
        "• «отказной тур Паттайя»\n" +
        "• «гид Самарканд»\n" +
        "• «транспорт Ташкент»\n\n" +
        "Скоро здесь будет полноценный поиск по маркетплейсу Travella.",
      backKeyboard
    );
  }

  async function handleSearchQuery(ctx, q) {
    // если пользователь передумал и нажал назад
    if (q === BTN_BACK_MENU) {
      resetSession(ctx);
      const { kb } = await getRoleAndKeyboard(ctx);
      await ctx.reply("Главное меню:", kb);
      return;
    }

    const { kb } = await getRoleAndKeyboard(ctx);

    // TODO: здесь будет реальный вызов API поиска
    await ctx.reply(
      `Вы ищете: “${q}”.\n\nПолноценный поиск по маркетплейсу будет подключён позже.\nПока воспользуйтесь сайтом: https://travella.uz`,
      kb
    );
    resetSession(ctx);
  }

  async function handleMyBookings(ctx) {
    const { kb } = await getRoleAndKeyboard(ctx);
    await ctx.reply(
      "Просмотр бронирований из бота пока в разработке.\n" +
        "Ваши брони можно посмотреть на сайте в разделе «Брони»:\n" +
        "https://travella.uz",
      kb
    );
  }

  async function handleMyFavorites(ctx) {
    const { kb } = await getRoleAndKeyboard(ctx);
    await ctx.reply(
      "Избранное в боте пока не подключено.\n" +
        "На сайте travella.uz вы можете добавлять услуги в избранное и управлять ими.",
      kb
    );
  }

  async function handleMyRequests(ctx) {
    const { kb } = await getRoleAndKeyboard(ctx);
    await ctx.reply(
      "Список заявок из бота пока в разработке.\n" +
        "На сайте вы можете посмотреть раздел «Запросы».",
      kb
    );
  }

  /** ============================ Панель поставщика ============================ */

  async function showProviderPanel(ctx) {
    const chatId = ctx.from.id;

    try {
      if (!API_BASE) {
        const { kb } = await getRoleAndKeyboard(ctx);
        await ctx.reply(
          "API_BASE_URL / SITE_API_URL не настроен на сервере. Обратитесь к администратору.",
          kb
        );
        return;
      }

      const resp = await axios.get(
        `${API_BASE}/api/telegram/profile/provider/${chatId}`
      );

      if (!resp.data?.success) {
        const { kb } = await getRoleAndKeyboard(ctx);
        await ctx.reply(
          "Я не нашёл привязанный аккаунт поставщика.\n" +
            "Сначала привяжите номер телефона через «👤 Профиль → Я поставщик».",
          kb
        );
        return;
      }

      await ctx.reply(
        "Панель поставщика:",
        Markup.inlineKeyboard([
          [Markup.button.callback("📅 Мои заявки", "supplier_bookings")],
        ])
      );
    } catch (e) {
      console.error(
        "[tg-bot] showProviderPanel error:",
        e.response?.data || e.message || e
      );
      const { kb } = await getRoleAndKeyboard(ctx);
      await ctx.reply("Ошибка, попробуйте позже.", kb);
    }
  }

  // Получить и вывести pending-заявки поставщика
  async function handleProviderBookings(ctx) {
    const chatId = ctx.from.id;

    try {
      if (!API_BASE) {
        const { kb } = await getRoleAndKeyboard(ctx);
        await ctx.reply(
          "API_BASE_URL / SITE_API_URL не настроен на сервере. Обратитесь к администратору.",
          kb
        );
        return;
      }

      const resp = await axios.get(
        `${API_BASE}/api/telegram/provider/${chatId}/bookings`,
        { params: { status: "pending" } }
      );

      const list = resp.data?.bookings || [];
      if (!list.length) {
        await ctx.reply("Новых заявок на бронирование нет 👍");
        return;
      }

      for (const b of list) {
        const start = b.start_date || b.date || "";
        const end = b.end_date || "";
        const text =
          `🆕 <b>Заявка #${b.id}</b>\n` +
          `Тур: <b>${b.service_title}</b>\n` +
          `Клиент: ${b.client_name}\n` +
          (start
            ? `Даты: ${start}${end ? " — " + end : ""}\n`
            : "") +
          `Гости: ${b.persons_adults || 0} взр / ${
            b.persons_children || 0
          } дет / ${b.persons_infants || 0} инф\n` +
          (b.client_message ? `Комментарий: ${b.client_message}` : "");

        await ctx.reply(text, {
          parse_mode: "HTML",
          reply_markup: Markup.inlineKeyboard([
            [
              Markup.button.callback(
                "✅ Подтвердить",
                `supplier_confirm_${b.id}`
              ),
              Markup.button.callback(
                "❌ Отклонить",
                `supplier_reject_${b.id}`
              ),
            ],
          ]),
        });
      }
    } catch (e) {
      console.error(
        "[tg-bot] handleProviderBookings error:",
        e.response?.data || e.message || e
      );
      const { kb } = await getRoleAndKeyboard(ctx);
      await ctx.reply("Ошибка при загрузке заявок. Попробуйте позже.", kb);
    }
  }

  /** ============================ Вспомогательные функции для inline и карточек ============================ */

  // Парсим категорию из inline-запроса:
  // "тур: самарканд" → { category: "refused_tour", query: "самарканд" }
  function parseInlineCategory(raw) {
    if (!raw) return { category: null, query: "" };

    const q = raw.trim();
    const lower = q.toLowerCase();

    // Паттерн: "<слово>[: -] остальной текст"
    const m = lower.match(
      /^(тур|отказной тур|отель|отказной отель|авиа|авиабилет|билет|мероприятие)\s*[:\-]?\s*(.*)$/
    );
    if (!m) {
      return { category: null, query: q };
    }

    const prefix = m[1];
    const tail = m[2] || "";

    let category = null;
    if (prefix === "тур" || prefix === "отказной тур") {
      category = "refused_tour";
    } else if (prefix === "отель" || prefix === "отказной отель") {
      category = "refused_hotel";
    } else if (prefix === "авиа" || prefix === "авиабилет") {
      category = "refused_flight";
    } else if (prefix === "билет" || prefix === "мероприятие") {
      category = "refused_ticket";
    }

    return {
      category,
      query: tail.trim(),
    };
  }

  // Загружаем одну услугу по id
  async function loadServiceById(serviceId) {
    if (!API_BASE || !serviceId) return null;
    try {
      const resp = await axios.get(
        `${API_BASE}/api/marketplace/services/${serviceId}`
      );
      // backend может вернуть {service: {...}} или сразу объект
      return resp.data?.service || resp.data || null;
    } catch (e) {
      console.error(
        "[tg-bot] loadServiceById error:",
        e.response?.data || e.message || e
      );
      return null;
    }
  }

  // Показать карточку тура по deep-link (start=s_<id>)
  async function showServiceCard(ctx, serviceId) {
    if (!serviceId || !Number.isFinite(serviceId)) {
      await ctx.reply("Некорректная ссылка на тур.");
      return;
    }

    if (!API_BASE) {
      await ctx.reply(
        "API_BASE_URL / SITE_API_URL не настроен на сервере. Обратитесь к администратору."
      );
      return;
    }

    const svc = await loadServiceById(serviceId);
    if (!svc) {
      await ctx.reply("Тур не найден или больше не доступен.");
      return;
    }

    const title = svc.title || "Услуга Travella";
    const details = svc.details || {};
    const providerName =
      (svc.provider &&
        (svc.provider.brand_name ||
          svc.provider.name ||
          svc.provider.company)) ||
      "";
    const direction =
      details.direction ||
      details.directionCity ||
      details.directionCountry ||
      details.direction_to ||
      svc.city ||
      svc.location ||
      "";
    const categoryLabel = svc.category || "";

    let priceText = "";
    const price = svc.price ?? details.price;
    const currency = details.currency || svc.currency || "USD";
    if (price != null) {
      priceText = `${price} ${currency}`;
    }

    const parts = [];
    if (direction) parts.push(direction);
    if (categoryLabel) parts.push(categoryLabel);
    if (providerName) parts.push(providerName);
    if (priceText) parts.push(priceText);

    const description = parts.join(" • ");

    const serviceUrl = `${FRONT_BASE}/services/${serviceId}`;

    const text =
      `📦 <b>${title}</b>\n` +
      (description ? description + "\n\n" : "\n") +
      `Полная информация о туре — на сайте:\n${serviceUrl}`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback("📝 Запросить бронь", `svc_book_${serviceId}`),
        Markup.button.callback("❓ Задать вопрос", `svc_ask_${serviceId}`),
      ],
      [
        Markup.button.url("🌐 Открыть в Travella", serviceUrl),
      ],
    ]);

    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: keyboard.reply_markup,
    });
  }

  function buildInlineResults(list, role) {
    const results = [];
    if (!Array.isArray(list)) return results;

    for (const s of list) {
      const id = String(s.id ?? `svc_${results.length}_${Date.now()}`);
      const title = s.title || "Услуга Travella";

      const details = s.details || {};
      const providerName =
        (s.provider &&
          (s.provider.brand_name || s.provider.name || s.provider.company)) ||
        "";
      const direction =
        details.direction ||
        details.directionCity ||
        details.directionCountry ||
        details.direction_to ||
        s.city ||
        s.location ||
        "";
      const categoryLabel = s.category || "";

      let priceText = "";
      const price = s.price ?? details.price;
      const currency = details.currency || s.currency || "USD";
      if (price != null) {
        priceText = `${price} ${currency}`;
      }

      const parts = [];
      if (direction) parts.push(direction);
      if (categoryLabel) parts.push(categoryLabel);
      if (providerName) parts.push(providerName);
      if (priceText) parts.push(priceText);

      const description = parts.join(" • ").slice(0, 250);

      // Картинка-превью
      let thumbUrl;
      const images = Array.isArray(s.images)
        ? s.images
        : Array.isArray(details.images)
        ? details.images
        : [];
      if (Array.isArray(images) && images.length) {
        const first = images[0];
        if (typeof first === "string" && /^https?:\/\//.test(first)) {
          thumbUrl = first;
        } else if (typeof first === "string" && FRONT_BASE) {
          thumbUrl = `${FRONT_BASE}/${first.replace(/^\/+/, "")}`;
        }
      }

      const serviceUrl = `${FRONT_BASE}/services/${s.id}`;

      const inlineKeyboard = [];

      inlineKeyboard.push([
        {
          text: "🌐 Открыть в Travella",
          url: serviceUrl,
        },
      ]);

      // Диплинк в бота для заявки: s_<id>
      if (BOT_USERNAME && s.id) {
        inlineKeyboard.push([
          {
            text: "📝 Оставить заявку",
            url: `https://t.me/${BOT_USERNAME}?start=s_${s.id}`,
          },
        ]);
      }

      const messageText =
        `📦 <b>${title}</b>\n` +
        (description ? description + "\n\n" : "") +
        `Подробнее: ${serviceUrl}`;

      const resultItem = {
        type: "article",
        id,
        title,
        description,
        input_message_content: {
          message_text: messageText,
          parse_mode: "HTML",
        },
        reply_markup: { inline_keyboard: inlineKeyboard },
      };

      if (thumbUrl) {
        resultItem.thumb_url = thumbUrl;
      }

      results.push(resultItem);
    }

    return results;
  }

  function noResultsInline(message) {
    const text =
      message ||
      "По запросу ничего не найдено в Travella.\n" +
        "Попробуйте другой запрос или откройте Travella в браузере.";

    return [
      {
        type: "article",
        id: "no_results",
        title: "Ничего не найдено",
        description:
          "Попробуйте другой запрос или откройте Travella в браузере.",
        input_message_content: {
          message_text: text,
        },
      },
    ];
  }
}

/**
 * Экспортируем бота для index.js
 */
module.exports = {
  bot,
};
