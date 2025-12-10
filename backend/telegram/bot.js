// backend/telegram/bot.js
require("dotenv").config();
const { Telegraf, session } = require("telegraf");
const axios = require("axios");
const pool = require("../db");

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
  console.log(
    "[tg-bot] WARNING: using OLD TELEGRAM_BOT_TOKEN for Telegraf (fallback)"
  );
}

const API_BASE = (
  process.env.API_BASE_URL ||
  process.env.SITE_API_URL ||
  "http://localhost:8080"
).replace(/\/+$/, "");
const SITE_PUBLIC_URL = (process.env.SITE_PUBLIC_URL || "https://travella.uz").replace(
  /\/+$/,
  ""
);

console.log("[tg-bot] API_BASE =", API_BASE);

// ==== INIT BOT ====

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

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
  await ctx.reply("Кем вы пользуетесь Travella?", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🤖 Я клиент", callback_data: "role:client" }],
        [{ text: "🏢 Я поставщик", callback_data: "role:provider" }],
      ],
    },
  });
}

/** Загрузка услуги из БД по id (минимальный набор полей) */
async function loadServiceById(serviceId) {
  const res = await pool.query(
    `
      SELECT
        s.id,
        s.title,
        s.description,
        p.name AS provider_name
      FROM services s
      LEFT JOIN providers p ON p.id = s.provider_id
      WHERE s.id = $1
      LIMIT 1
    `,
    [serviceId]
  );
  return res.rows[0] || null;
}

/** Отрисовать карточку услуги в чате с кнопками */
async function sendServiceCard(ctx, serviceId) {
  try {
    const svc = await loadServiceById(serviceId);
    if (!svc) {
      await ctx.reply("Эта услуга не найдена или уже неактуальна.");
      return;
    }

    let text = `🧾 Услуга #${svc.id}\n\n${svc.title || "Без названия"}`;
    if (svc.provider_name) {
      text += `\nПоставщик: ${svc.provider_name}`;
    }

    if (svc.description) {
      const cut =
        svc.description.length > 400
          ? svc.description.slice(0, 400) + "…"
          : svc.description;
      text += `\n\n${cut}`;
    }

    const kb = {
      inline_keyboard: [
        [
          { text: "🔐 Запросить бронь", callback_data: `book:${svc.id}` },
          { text: "❓ Задать вопрос", callback_data: `question:${svc.id}` },
        ],
      ],
    };

    if (SITE_PUBLIC_URL) {
      kb.inline_keyboard.push([
        {
          text: "🌐 Открыть на сайте",
          url: `${SITE_PUBLIC_URL}/service/${svc.id}`,
        },
      ]);
    }

    await ctx.reply(text, { reply_markup: kb });
  } catch (e) {
    console.error("[tg-bot] sendServiceCard error:", e);
    await ctx.reply("Не удалось загрузить эту услугу. Попробуйте позже.");
  }
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
      // сюда попадём, даже если человек нажал «я клиент», но телефон уже у поставщика
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

    // если deep-link был s_<id> — показываем карточку
    const deepServiceId = ctx.session?.deepServiceId;
    if (deepServiceId) {
      await sendServiceCard(ctx, deepServiceId);
    }
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
    const text = ctx.message?.text || "";
    // выцепляем payload после /start
    let payload = ctx.startPayload || "";
    if (!payload) {
      const m = text.match(/^\/start(?:@\S+)?(?:\s+(.+))?$/i);
      if (m && m[1]) payload = m[1].trim();
    }

    let deepServiceId = null;
    if (payload) {
      const norm = payload.replace(/\s+/g, "").toLowerCase();
      const ms = norm.match(/^s[-_]?(\d+)$/); // s_123, s-123, s123
      if (ms) deepServiceId = Number(ms[1]);
    }

    if (!ctx.session) ctx.session = {};
    if (deepServiceId) {
      ctx.session.deepServiceId = deepServiceId;
    }

    console.log("[tg-bot] /start from", {
      chatId,
      username: ctx.from.username,
      payload,
      deepServiceId,
    });

    // 1. пробуем узнать профиль как клиента
    let role = null;

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
      if (e.response?.status !== 404) {
        console.warn(
          "[tg-bot] profile client error:",
          e.response?.data || e.message
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
        if (e.response?.status !== 404) {
          console.warn(
            "[tg-bot] profile provider error:",
            e.response?.data || e.message
          );
        }
      }
    }

    console.log("[tg-bot] resolved role on /start:", role || "<none>");

    if (role) {
      // Уже привязан → сразу главное меню
      if (!ctx.session) ctx.session = {};
      ctx.session.role = role;
      ctx.session.linked = true;

      await ctx.reply(
        "Добро пожаловать в Travella! 👋\nГлавное меню доступно ниже.",
        getMainMenuKeyboard(role)
      );

      // если deep-link введён — показываем карточку
      if (ctx.session.deepServiceId) {
        await sendServiceCard(ctx, ctx.session.deepServiceId);
      }
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

// ==== ОБРАБОТЧИКИ ГЛАВНОГО МЕНЮ ====

// Мои брони
bot.hears("📄 Мои брони", async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const role = ctx.session?.role || "client";

    if (role === "provider") {
      // панель поставщика
      const { data } = await axios.get(
        `${API_BASE}/api/telegram/provider/${chatId}/bookings`
      );

      if (!data || !Array.isArray(data.items) || data.items.length === 0) {
        await ctx.reply("У вас пока нет бронирований как у поставщика.");
        return;
      }

      const lines = data.items.slice(0, 10).map((b) => {
        const period =
          b.start_date && b.end_date
            ? `${b.start_date} — ${b.end_date}`
            : b.start_date || "";
        return (
          `#${b.id} · статус: ${b.status || "—"}\n` +
          (b.service_title ? `Услуга: ${b.service_title}\n` : "") +
          (period ? `Даты: ${period}\n` : "") +
          (b.client_name ? `Клиент: ${b.client_name}\n` : "")
        );
      });

      await ctx.reply(
        "Ваши брони как поставщика (последние):\n\n" + lines.join("\n")
      );
      return;
    }

    // клиент
    const { data } = await axios.get(
      `${API_BASE}/api/telegram/client/${chatId}/bookings`
    );

    if (!data || !Array.isArray(data.items) || data.items.length === 0) {
      await ctx.reply("У вас пока нет броней на Travella.");
      return;
    }

    const lines = data.items.slice(0, 10).map((b) => {
      const period =
        b.start_date && b.end_date
          ? `${b.start_date} — ${b.end_date}`
          : b.start_date || "";
      return (
        `#${b.id} · статус: ${b.status || "—"}\n` +
        (b.service_title ? `Услуга: ${b.service_title}\n` : "") +
        (b.provider_name ? `Поставщик: ${b.provider_name}\n` : "") +
        (period ? `Даты: ${period}\n` : "")
      );
    });

    await ctx.reply("Ваши последние брони:\n\n" + lines.join("\n"));
  } catch (e) {
    console.error("[tg-bot] error in 'Мои брони':", e.response?.data || e);
    await ctx.reply("Не удалось загрузить брони. Попробуйте позже.");
  }
});

// Мои заявки
bot.hears("📨 Мои заявки", async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const role = ctx.session?.role || "client";

    if (role === "provider") {
      // TODO: можно будет добавить SQL по заявкам для провайдера
      await ctx.reply(
        "Раздел заявок для поставщиков скоро будет доступен в боте.\n" +
          "Пока что смотрите заявки в личном кабинете Travella."
      );
      return;
    }

    const { data } = await axios.get(
      `${API_BASE}/api/telegram/client/${chatId}/requests`
    );

    if (!data || !Array.isArray(data.items) || data.items.length === 0) {
      await ctx.reply("У вас пока нет заявок на Travella.");
      return;
    }

    const lines = data.items.slice(0, 10).map((r) => {
      return (
        `#${r.id} · статус: ${r.status || "—"}\n` +
        (r.service_title ? `Услуга: ${r.service_title}\n` : "") +
        (r.provider_name ? `Поставщик: ${r.provider_name}\n` : "") +
        (r.message ? `Комментарий: ${r.message}\n` : "") +
        (r.created_at ? `Создано: ${r.created_at}\n` : "")
      );
    });

    await ctx.reply("Ваши последние заявки:\n\n" + lines.join("\n"));
  } catch (e) {
    console.error("[tg-bot] error in 'Мои заявки':", e.response?.data || e);
    await ctx.reply("Не удалось загрузить заявки. Попробуйте позже.");
  }
});

// Избранное (клиент)
bot.hears("❤️ Избранное", async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const role = ctx.session?.role || "client";

    if (role === "provider") {
      await ctx.reply(
        "Избранное для поставщиков пока недоступно в боте.\n" +
          "Скоро мы добавим этот раздел."
      );
      return;
    }

    const { data } = await axios.get(
      `${API_BASE}/api/telegram/client/${chatId}/favorites`
    );

    if (!data || !Array.isArray(data.items) || data.items.length === 0) {
      await ctx.reply("У вас пока нет избранных услуг на Travella.");
      return;
    }

    const lines = data.items.slice(0, 10).map((f) => {
      const locParts = [];
      if (f.country) locParts.push(f.country);
      if (f.city) locParts.push(f.city);
      const loc = locParts.join(", ");
      return (
        `${f.service_title || "Услуга"}\n` +
        (loc ? `Локация: ${loc}\n` : "") +
        (f.provider_name ? `Поставщик: ${f.provider_name}\n` : "")
      );
    });

    await ctx.reply("Ваше избранное:\n\n" + lines.join("\n"));
  } catch (e) {
    console.error("[tg-bot] error in 'Избранное':", e.response?.data || e);
    await ctx.reply("Не удалось загрузить избранное. Попробуйте позже.");
  }
});

// Профиль
bot.hears("👤 Профиль", async (ctx) => {
  const role = ctx.session?.role || "client";
  await ctx.reply(
    role === "provider"
      ? "Ваш профиль поставщика можно отредактировать в личном кабинете Travella."
      : "Ваш профиль клиента можно дополнить и изменить на сайте travella.uz."
  );
});

// Стать поставщиком
bot.hears("🏢 Стать поставщиком", async (ctx) => {
  await ctx.reply(
    "Чтобы стать поставщиком Travella, заполните форму на сайте https://travella.uz и дождитесь модерации.\n" +
      "Мы также свяжемся с вами по указанным контактам."
  );
});

// Найти услугу (пока без inline-поиска; сделаем отдельно)
bot.hears("🔍 Найти услугу", async (ctx) => {
  await ctx.reply(
    "Поиск услуг через бот мы готовим.\n" +
      "Сейчас вы можете найти и забронировать услуги на сайте https://travella.uz."
  );
});

// ==== CALLBACK-КНОПКИ ДЛЯ КАРТОЧКИ УСЛУГИ ====

// Запросить бронь
bot.action(/^book:(\d+)$/, async (ctx) => {
  const serviceId = Number(ctx.match[1]);
  const chatId = ctx.from?.id || ctx.chat?.id;
  try {
    await ctx.answerCbQuery("Отправляем запрос на бронь...");

    const { data } = await axios.post(
      `${API_BASE}/api/telegram/client/${chatId}/service/${serviceId}/request`,
      { type: "booking" }
    );

    if (!data || !data.success) {
      await ctx.reply(
        "Не удалось создать заявку на бронь. Возможно, Telegram ещё не привязан к клиентскому аккаунту."
      );
      return;
    }

    await ctx.reply(
      `Заявка на бронь отправлена! 🎉\nНомер заявки: #${data.requestId}`
    );
  } catch (e) {
    console.error("[tg-bot] book:<id> error:", e.response?.data || e);
    const status = e.response?.status;
    if (status === 404) {
      await ctx.reply(
        "Похоже, ваш Telegram ещё не привязан к клиентскому аккаунту Travella.\n" +
          "Нажмите /start и завершите привязку, затем повторите попытку."
      );
    } else {
      await ctx.reply("Не удалось создать заявку. Попробуйте позже.");
    }
  }
});

// Задать вопрос
bot.action(/^question:(\d+)$/, async (ctx) => {
  const serviceId = Number(ctx.match[1]);
  const chatId = ctx.from?.id || ctx.chat?.id;
  try {
    await ctx.answerCbQuery("Отправляем вопрос поставщику...");

    const { data } = await axios.post(
      `${API_BASE}/api/telegram/client/${chatId}/service/${serviceId}/request`,
      { type: "question" }
    );

    if (!data || !data.success) {
      await ctx.reply(
        "Не удалось отправить вопрос. Возможно, Telegram ещё не привязан к клиентскому аккаунту."
      );
      return;
    }

    await ctx.reply(
      `Ваш вопрос по услуге отправлен поставщику. ✉️\nНомер обращения: #${data.requestId}`
    );
  } catch (e) {
    console.error("[tg-bot] question:<id> error:", e.response?.data || e);
    const status = e.response?.status;
    if (status === 404) {
      await ctx.reply(
        "Похоже, ваш Telegram ещё не привязан к клиентскому аккаунту Travella.\n" +
          "Нажмите /start и завершите привязку, затем повторите попытку."
      );
    } else {
      await ctx.reply("Не удалось отправить вопрос. Попробуйте позже.");
    }
  }
});

// ⚠️ ВАЖНО: здесь НЕТ bot.launch()
// Запуском занимается index.js

module.exports = { bot };
