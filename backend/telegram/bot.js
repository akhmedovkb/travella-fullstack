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

  /** ============================ /start ============================ */
  bot.start(async (ctx) => {
    resetSession(ctx);
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

  // Открыть список услуг marketplace (отказные)
  bot.action("supplier_services", async (ctx) => {
    try {
      await ctx.answerCbQuery().catch(() => {});
      await handleProviderServices(ctx);
    } catch (e) {
      console.error("[tg-bot] supplier_services error:", e);
    }
  });

  // Подтверждение брони
  bot.action(/supplier_confirm_(\d+)/, async (ctx) => {
    const bookingId = ctx.match[1];
    const chatId = ctx.from.id;

    try {
      await ctx.answerCbQuery().catch(() => {});
      if (!API_BASE) {
        await ctx.reply(
          "API_BASE_URL / SITE_API_URL не настроен на сервере. Обратитесь к администратору."
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
        await ctx.reply(
          "API_BASE_URL / SITE_API_URL не настроен на сервере. Обратитесь к администратору."
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

  /** ============================ Обработчики (поиск / маркетплейс) ============================ */

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
          [Markup.button.callback("📦 Мои услуги", "supplier_services")],
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

  // Получить и вывести все отказные услуги поставщика (marketplace)
  async function handleProviderServices(ctx) {
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
        `${API_BASE}/api/telegram/provider/${chatId}/services`
      );

      const list = resp.data?.services || [];
      if (!list.length) {
        await ctx.reply("У вас пока нет отказных услуг в маркетплейсе.");
        return;
      }

      const typeMap = {
        refused_tour: "Отказной тур",
        refused_hotel: "Отказной отель",
        refused_flight: "Отказной авиабилет",
        refused_ticket: "Отказной билет",
      };

      for (const s of list) {
        const typeLabel = typeMap[s.category] || s.category || "Услуга";
        const details = s.details || {};
        const dirParts = [
          details.directionCountry || details.country,
          details.directionTo || details.city,
        ].filter(Boolean);
        const direction = dirParts.join(" → ");

        let dates = "";
        if (details.startDate && details.endDate) {
          dates = `${details.startDate} — ${details.endDate}`;
        } else if (details.startDate) {
          dates = details.startDate;
        }

        const status = s.status || "draft";

        let text =
          `📦 <b>${typeLabel}</b>\n` +
          `ID: <code>${s.id}</code>\n` +
          `Название: ${s.title || "без названия"}\n`;
        if (direction) text += `Направление: ${direction}\n`;
        if (dates) text += `Даты: ${dates}\n`;
        text += `Статус модерации: <b>${status}</b>`;

        await ctx.reply(text, { parse_mode: "HTML" });
      }
    } catch (e) {
      console.error(
        "[tg-bot] handleProviderServices error:",
        e.response?.data || e.message || e
      );
      const { kb } = await getRoleAndKeyboard(ctx);
      await ctx.reply(
        "Ошибка при загрузке услуг. Попробуйте позже.",
        kb
      );
    }
  }
}

/**
 * Экспортируем бота для index.js
 */
module.exports = {
  bot,
};
