//backend/telegram/bot.js

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

// экранирование текста для Telegram Markdown (В1)
function escapeMarkdown(text) {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/_/g, "\\_")
    .replace(/\*/g, "\\*")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/`/g, "\\`");
}

function getMainMenuKeyboard(role) {
  // 👇 для поставщика показываем "Мои услуги" вместо "Стать поставщиком"
  if (role === "provider") {
    return {
      reply_markup: {
        keyboard: [
          [{ text: "🔍 Найти услугу" }, { text: "🧳 Мои услуги" }],
          [{ text: "📄 Мои брони" }, { text: "📨 Мои заявки" }],
          [{ text: "👤 Профиль" }],
        ],
        resize_keyboard: true,
      },
    };
  }

  // 👇 для клиента оставляем старое меню
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

// безопасно достаём первую картинку из услуги (services.images)
function getFirstImageUrl(svc) {
  let arr = svc.images;

  if (!arr) return null;

  // если в БД лежит строка
  if (typeof arr === "string") {
    try {
      const parsed = JSON.parse(arr);
      arr = parsed;
    } catch {
      arr = [arr];
    }
  }

  if (!Array.isArray(arr) || !arr.length) return null;

  let v = arr[0];

  if (v && typeof v === "object") {
    v = v.url || v.src || v.path || v.location || v.href || null;
  }

  if (typeof v !== "string") return null;
  v = v.trim();
  if (!v) return null;

  // 🔥 поддержка base64 (data:image/...)
  if (v.startsWith("data:image")) {
    return `${API_BASE.replace(
      /\/+$/,
      ""
    )}/api/telegram/service-image/${svc.id}`;
  }

  // Полный URL
  if (v.startsWith("http://") || v.startsWith("https://")) {
    return v;
  }

  // Относительный путь от корня сайта
  if (v.startsWith("/")) {
    return SITE_URL + v;
  }

  // Всё остальное — для Telegram не годится
  return null;
}

// выбираем цену в зависимости от роли
function pickPrice(details, svc, role) {
  const d = details || {};
  if (role === "provider") {
    // поставщик видит нетто
    return d.netPrice ?? d.price ?? d.grossPrice ?? svc.price ?? null;
  }
  // клиент — брутто
  return d.grossPrice ?? d.price ?? d.netPrice ?? svc.price ?? null;
}

// безопасный парсинг дат для сортировки
function parseDateSafe(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;

  let d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;

  // пробуем формат 2026.01.02
  const s2 = s.replace(/\./g, "-");
  d = new Date(s2);
  if (!Number.isNaN(d.getTime())) return d;

  return null;
}

// достаём дату вылета/старта тура из svc.details для сортировки
function getStartDateForSort(svc) {
  let d = svc.details || {};
  if (typeof d === "string") {
    try {
      d = JSON.parse(d);
    } catch {
      d = {};
    }
  }
  const raw =
    d.startFlightDate ||
    d.departureFlightDate ||
    d.startDate ||
    d.start_flight_date;
  return parseDateSafe(raw);
}

/**
 * Преобразуем услугу из /api/telegram/client/:chatId/search
 * в красивый текст + url картинки + url на сайт
 *
 * role: "client" | "provider"
 */
function buildServiceMessage(svc, category, role = "client") {
  let d = svc.details || {};
  if (typeof d === "string") {
    try {
      d = JSON.parse(d);
    } catch {
      d = {};
    }
  }

  const titleRaw = svc.title || CATEGORY_LABELS[category] || "Услуга";
  const title = escapeMarkdown(titleRaw);

  // Направление
  const directionParts = [];
  if (d.directionFrom && d.directionTo) {
    directionParts.push(
      `${escapeMarkdown(d.directionFrom)} → ${escapeMarkdown(
        d.directionTo
      )}`
    );
  }
  if (d.directionCountry) {
    directionParts.push(escapeMarkdown(d.directionCountry));
  }
  const direction =
    directionParts.length > 0 ? directionParts.join(" · ") : null;

  // Даты
  const dates =
    d.startFlightDate && d.endFlightDate
      ? `Даты: ${escapeMarkdown(d.startFlightDate)} → ${escapeMarkdown(
          d.endFlightDate
        )}`
      : d.startDate && d.endDate
      ? `Даты: ${escapeMarkdown(d.startDate)} → ${escapeMarkdown(
          d.endDate
        )}`
      : null;

  // Отель
  const hotel = d.hotel || d.hotelName || null;
  const hotelSafe = hotel ? escapeMarkdown(hotel) : null;

  // Размещение (в полном тексте — оставляем)
  const accommodation = d.accommodation || null;
  const accommodationSafe = accommodation
    ? escapeMarkdown(accommodation)
    : null;

  // Цена (по роли)
  const priceRaw = pickPrice(d, svc, role);
  const price =
    priceRaw !== null && priceRaw !== undefined
      ? escapeMarkdown(priceRaw)
      : null;

  // Поставщик + Telegram
  const providerNameRaw = svc.provider_name || "Поставщик Travella";
  const providerName = escapeMarkdown(providerNameRaw);
  const providerTelegram = svc.provider_telegram || null;

  let providerLine;
  let telegramLine = null;

  if (providerTelegram) {
    let username = String(providerTelegram).trim();
    username = username.replace(/^@/, "");
    username = username.replace(/^https?:\/\/t\.me\//i, "");

    const rawUsername = username;
    const mdUsername = escapeMarkdown(username);

    providerLine = `Поставщик: [${providerName}](tg://resolve?domain=${rawUsername})`;
    telegramLine = `Telegram: @${mdUsername}`;
  } else {
    providerLine = `Поставщик: ${providerName}`;
  }

  const lines = [];
  lines.push(`*${title}*`);
  if (direction) lines.push(direction);
  if (dates) lines.push(dates);
  if (hotelSafe) lines.push(`Отель: ${hotelSafe}`);
  if (accommodationSafe) lines.push(`Размещение: ${accommodationSafe}`);
  if (price) lines.push(`Цена: *${price}*`);
  lines.push(providerLine);
  if (telegramLine) lines.push(telegramLine);
  lines.push("");
  lines.push(`Подробнее и бронирование: ${SITE_URL}`);

  const text = lines.join("\n");
  const photoUrl = getFirstImageUrl(svc);

  const serviceUrl = SITE_URL;

  return { text, photoUrl, serviceUrl };
}

// ---- helper: доопределить роль поставщика по chatId, если сессия пуста ----
async function ensureProviderRole(ctx) {
  if (ctx.session?.role === "provider") {
    return "provider";
  }
  const chatId = ctx.chat.id;
  try {
    const resProv = await axios.get(
      `/api/telegram/profile/provider/${chatId}`
    );
    if (resProv.data && resProv.data.success) {
      if (!ctx.session) ctx.session = {};
      ctx.session.role = "provider";
      ctx.session.linked = true;
      return "provider";
    }
  } catch (e) {
    if (e?.response?.status !== 404) {
      console.log(
        "[tg-bot] ensureProviderRole error:",
        e?.response?.data || e.message || e
      );
    }
  }
  return ctx.session?.role || null;
}

/* ===================== SERVICE WIZARD (создание refused_tour) ===================== */

function resetServiceWizard(ctx) {
  if (!ctx.session) return;
  ctx.session.state = null;
  ctx.session.serviceDraft = null;
}

function parseYesNo(text) {
  const t = text.trim().toLowerCase();
  if (["да", "ha", "xa", "yes", "y"].includes(t)) return true;
  if (["нет", "yo'q", "yok", "no", "n"].includes(t)) return false;
  return null;
}

function normalizePrice(text) {
  const cleaned = String(text || "")
    .replace(/[^0-9.,]/g, "")
    .replace(",", ".");
  const n = parseFloat(cleaned);
  if (Number.isNaN(n)) return null;
  return n;
}

// собираем details для refused_tour из draft
function buildDetailsForRefusedTour(draft, priceNum) {
  return {
    title: draft.title || "",
    directionCountry: draft.country || "",
    directionFrom: draft.fromCity || "",
    directionTo: draft.toCity || "",
    startDate: draft.startDate || "",
    endDate: draft.endDate || "",
    hotel: draft.hotel || "",
    accommodation: draft.accommodation || "",
    netPrice: priceNum,
    changeable:
      typeof draft.changeable === "boolean" ? draft.changeable : null,
    visaIncluded:
      typeof draft.visaIncluded === "boolean" ? draft.visaIncluded : null,
    expiration: draft.expiration || null,
    isActive: true,
  };
}

async function finishCreateServiceFromWizard(ctx) {
  try {
    const draft = ctx.session?.serviceDraft;
    if (!draft || draft.category !== "refused_tour") {
      await ctx.reply(
        "Не удалось создать услугу: нет данных мастера. Попробуйте ещё раз."
      );
      resetServiceWizard(ctx);
      return;
    }

    const priceNum = normalizePrice(draft.price);
    const details = buildDetailsForRefusedTour(draft, priceNum);

    const payload = {
      category: "refused_tour",
      title: draft.title,
      price: priceNum,
      details,
      images: draft.images || [],
    };

    const chatId = ctx.chat.id;

    const { data } = await axios.post(
      `/api/telegram/provider/${chatId}/services`,
      payload
    );

    if (!data || !data.success) {
      console.log("[tg-bot] createServiceFromWizard resp:", data);
      await ctx.reply(
        "Не удалось сохранить услугу. Попробуйте позже или через кабинет."
      );
      resetServiceWizard(ctx);
      return;
    }

    await ctx.reply(
      `Готово! ✅\n\nУслуга #${data.service.id} создана и отправлена на модерацию.\n` +
        "После одобрения она появится в поиске Travella и в боте."
    );
    resetServiceWizard(ctx);
  } catch (e) {
    console.error("[tg-bot] finishCreateServiceFromWizard error:", e);
    await ctx.reply("Произошла ошибка при сохранении услуги. Попробуйте позже.");
    resetServiceWizard(ctx);
  }
}

/* ===================== Регистрация / привязка телефона ===================== */

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

// ... (ДАЛЬШЕ ИДЁТ ВЕСЬ ТВОЙ СТАРЫЙ КОД, я не буду его повторять целиком,
// чтобы не утонуть в полотне. Ниже показываю только изменённые места.)

// --- пропускаем: bot.start, role:..., contact, телефон, Найти услугу, заглушки и т.п. ---
// они остаются БЕЗ ИЗМЕНЕНИЙ до блока "МОИ УСЛУГИ (панель поставщика)"

// ==== МОИ УСЛУГИ (панель поставщика) ====

bot.hears(/🧳 Мои услуги/i, async (ctx) => {
  logUpdate(ctx, "hears Мои услуги");

  // 👇 доопределяем роль по chatId, чтобы не требовать /start каждый раз
  const role = await ensureProviderRole(ctx);

  if (role !== "provider") {
    await ctx.reply(
      "Раздел «Мои услуги» доступен только поставщикам Travella.\n" +
        "Если вы хотите размещать свои туры и отели, зарегистрируйтесь как поставщик на сайте travella.uz."
    );
    return;
  }

  const chatId = ctx.chat.id;

  try {
    // 🔥 НОВОЕ: кнопка создания услуги через бота + ссылка в кабинет
    await ctx.reply(
      "Вы можете создать новую отказную услугу прямо в боте или в кабинете Travella:",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "➕ Создать услугу в боте",
                callback_data: "svc_new",
              },
            ],
            [
              {
                text: "🌐 Открыть кабинет Travella",
                url: `${SITE_URL}/dashboard/services/marketplace?from=tg`,
              },
            ],
          ],
        },
      }
    );

    await ctx.reply("Загружаю ваши услуги маркетплейса...");

    const { data } = await axios.get(
      `/api/telegram/provider/${chatId}/services`
    );

    if (!data || !data.success || !Array.isArray(data.items)) {
      console.log("[tg-bot] provider services malformed:", data);
      await ctx.reply("Не удалось загрузить услуги. Попробуйте позже.");
      return;
    }

    if (!data.items.length) {
      await ctx.reply(
        "У вас пока нет услуг в маркетплейсе.\n" +
          "Добавьте их через бот или в личном кабинете на сайте travella.uz."
      );
      return;
    }

    await ctx.reply(
      `Найдено услуг: ${data.items.length}. Показываю первые 10 (по ближайшей дате).`
    );

    // сортировка по ближайшей дате (используем уже написанный getStartDateForSort)
    const itemsSorted = [...data.items].sort((a, b) => {
      const da = getStartDateForSort(a);
      const db = getStartDateForSort(b);

      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da.getTime() - db.getTime(); // раньше дата -> выше
    });

    for (const svc of itemsSorted.slice(0, 10)) {
      const category = svc.category || svc.type || "refused_tour";

      // аккуратно распарсим details
      let details = svc.details || {};
      if (typeof details === "string") {
        try {
          details = JSON.parse(details);
        } catch {
          details = {};
        }
      }

      const { text, photoUrl } = buildServiceMessage(
        svc,
        category,
        "provider"
      );

      const status = svc.status || "draft";

      // === ЛОГИКА АКТУАЛЬНОСТИ ===
      let isActive =
        typeof details.isActive === "boolean" ? details.isActive : true;

      // тайм-лимит: expiration_at в таблице или expiration в details
      const expirationRaw = details.expiration || svc.expiration || null;
      if (expirationRaw) {
        const exp = new Date(expirationRaw);
        if (!Number.isNaN(exp.getTime()) && exp < new Date()) {
          isActive = false;
        }
      }

      // даты тура / перелёта: если тур уже прошёл, считаем неактуальным
      const endRaw =
        details.endFlightDate ||
        details.returnFlightDate ||
        details.endDate ||
        null;
      if (endRaw) {
        const ed = new Date(endRaw);
        if (!Number.isNaN(ed.getTime()) && ed < new Date()) {
          isActive = false;
        }
      }

      const headerLines = [];

      headerLines.push(
        `#${svc.id} · ${CATEGORY_LABELS[category] || "Услуга"}`
      );
      headerLines.push(
        `Статус: ${status}${!isActive ? " (неактуально)" : ""}`
      );
      if (expirationRaw) {
        headerLines.push(`Актуально до: ${expirationRaw}`);
      }

      const msg = headerLines.join("\n") + "\n\n" + text;

      // ссылка в кабинет — пока просто dashboard с query
      const manageUrl = `${SITE_URL}/dashboard?from=tg&service=${svc.id}`;

      // === УПРАВЛЕНИЕ УСЛУГОЙ ЧЕРЕЗ БОТА (как было) ===
      const keyboard = {
        inline_keyboard: [
          [
            {
              text: "Открыть в кабинете",
              url: manageUrl,
            },
          ],
          [
            {
              text: "🛑 Снять с продажи",
              callback_data: `svc:${svc.id}:unpublish`,
            },
          ],
          [
            {
              text: "♻️ Продлить на 7 дней",
              callback_data: `svc:${svc.id}:extend7`,
            },
            {
              text: "📁 Архивировать",
              callback_data: `svc:${svc.id}:archive`,
            },
          ],
        ],
      };

      if (photoUrl) {
        await ctx.replyWithPhoto(photoUrl, {
          caption: msg,
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      } else {
        await ctx.reply(msg, {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      }
    }
  } catch (e) {
    console.error(
      "[tg-bot] provider services error:",
      e?.response?.data || e.message || e
    );
    await ctx.reply("Не удалось загрузить услуги. Попробуйте позже.");
  }
});

// ==== НОВОЕ: старт мастера создания услуги ====

bot.action("svc_new", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const role = await ensureProviderRole(ctx);
    if (role !== "provider") {
      await ctx.reply(
        "Создавать услуги через бот могут только поставщики Travella.\n" +
          "Зарегистрируйтесь как поставщик на сайте travella.uz."
      );
      return;
    }

    if (!ctx.session) ctx.session = {};
    ctx.session.serviceDraft = { category: null, images: [] };
    ctx.session.state = "svc_create_choose_category";

    await ctx.reply("Выберите категорию отказной услуги:", {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "📍 Отказной тур",
              callback_data: "svc_new_cat:refused_tour",
            },
          ],
          [
            {
              text: "🏨 Отказной отель",
              callback_data: "svc_new_cat:refused_hotel",
            },
          ],
          [
            {
              text: "✈️ Отказной авиабилет",
              callback_data: "svc_new_cat:refused_flight",
            },
          ],
          [
            {
              text: "🎫 Отказной билет",
              callback_data: "svc_new_cat:refused_ticket",
            },
          ],
        ],
      },
    });
  } catch (e) {
    console.error("[tg-bot] svc_new action error:", e);
  }
});

bot.action(/^svc_new_cat:(refused_tour|refused_hotel|refused_flight|refused_ticket)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const category = ctx.match[1];

    if (!ctx.session) ctx.session = {};
    if (!ctx.session.serviceDraft) ctx.session.serviceDraft = {};
    ctx.session.serviceDraft.category = category;

    // Полный мастер сейчас реализован ТОЛЬКО для refused_tour
    if (category !== "refused_tour") {
      await ctx.reply(
        "Пока создание через бот доступно только для категории «Отказной тур».\n" +
          "Для остальных категорий воспользуйтесь, пожалуйста, кабинетом Travella."
      );
      resetServiceWizard(ctx);
      return;
    }

    ctx.session.state = "svc_create_title";

    await ctx.reply(
      "Создаём новую услугу: *Отказной тур*.\n\n" +
        "Отправьте, пожалуйста, *название тура* (как вы хотите показывать его в Travella).",
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    console.error("[tg-bot] svc_new_cat action error:", e);
  }
});

// ==== ДЕЙСТВИЯ С УСЛУГАМИ ПРОВАЙДЕРА (снять / продлить / архивировать) ====

// (здесь оставляем твой существующий bot.action(/^svc:(\d+):(unpublish|extend7|archive)$/ ...)
// без изменений — я его не переписываю, он уже работает)

// ... далее остаётся твой код поиска, быстрых запросов, /tour_ и inline_query ...

// ==== ГЛОБАЛЬНЫЙ on("text"): добавляем обработку мастера ====

bot.on("text", async (ctx, next) => {
  try {
    const state = ctx.session?.state || null;

    // 1) быстрый запрос (как было)
    if (
      state === "awaiting_request_message" &&
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
        const safeFirst = escapeMarkdown(from.first_name || "");
        const safeLast = escapeMarkdown(from.last_name || "");
        const safeUsername = escapeMarkdown(from.username || "нет username");
        const safeMsg = escapeMarkdown(msg);

        const textForManager =
          "🆕 *Новый быстрый запрос из бота Travella*\n\n" +
          `Тур ID: *${escapeMarkdown(serviceId)}*\n` +
          `От: ${safeFirst} ${safeLast} (@${safeUsername})\n` +
          `Telegram chatId: \`${chatId}\`\n\n` +
          "*Сообщение клиента:*\n" +
          safeMsg;

        await bot.telegram.sendMessage(MANAGER_CHAT_ID, textForManager, {
          parse_mode: "Markdown",
        });

        await ctx.reply(
          "Спасибо! 🙌\n\nВаш запрос отправлен менеджеру Travella.\n" +
            "Мы свяжемся с вами в ближайшее время."
        );
      }

      ctx.session.state = null;
      ctx.session.pendingRequestServiceId = null;
      return;
    }

    // 2) мастер создания отказного тура
    if (state && state.startsWith("svc_create_")) {
      const text = ctx.message.text.trim();

      if (text.toLowerCase() === "отмена") {
        resetServiceWizard(ctx);
        await ctx.reply("Создание услуги отменено.");
        return;
      }

      if (!ctx.session.serviceDraft) ctx.session.serviceDraft = {};
      const draft = ctx.session.serviceDraft;

      switch (state) {
        case "svc_create_title":
          draft.title = text;
          ctx.session.state = "svc_create_tour_country";
          await ctx.reply("Укажите *страну направления* (например, Таиланд):", {
            parse_mode: "Markdown",
          });
          return;

        case "svc_create_tour_country":
          draft.country = text;
          ctx.session.state = "svc_create_tour_from";
          await ctx.reply(
            "Укажите *город вылета* (например, Ташкент):",
            { parse_mode: "Markdown" }
          );
          return;

        case "svc_create_tour_from":
          draft.fromCity = text;
          ctx.session.state = "svc_create_tour_to";
          await ctx.reply(
            "Укажите *город прибытия* (например, Бангкок):",
            { parse_mode: "Markdown" }
          );
          return;

        case "svc_create_tour_to":
          draft.toCity = text;
          ctx.session.state = "svc_create_tour_start";
          await ctx.reply(
            "Укажите *дату начала тура* в формате ГГГГ-ММ-ДД (например, 2025-12-09):",
            { parse_mode: "Markdown" }
          );
          return;

        case "svc_create_tour_start":
          draft.startDate = text;
          ctx.session.state = "svc_create_tour_end";
          await ctx.reply(
            "Укажите *дату окончания тура* в формате ГГГГ-ММ-ДД:",
            { parse_mode: "Markdown" }
          );
          return;

        case "svc_create_tour_end":
          draft.endDate = text;
          ctx.session.state = "svc_create_tour_hotel";
          await ctx.reply(
            "Укажите *отель* (как в ваучере, можно с категорией):",
            { parse_mode: "Markdown" }
          );
          return;

        case "svc_create_tour_hotel":
          draft.hotel = text;
          ctx.session.state = "svc_create_tour_accommodation";
          await ctx.reply(
            "Опишите *размещение* (тип номера, размещение ADT/CHD/INF):",
            { parse_mode: "Markdown" }
          );
          return;

        case "svc_create_tour_accommodation":
          draft.accommodation = text;
          ctx.session.state = "svc_create_price";
          await ctx.reply(
            "Укажите *цену нетто* (за тур, в валюте, например 1130 или 1130 USD):",
            { parse_mode: "Markdown" }
          );
          return;

        case "svc_create_price":
          draft.price = text;
          ctx.session.state = "svc_create_changeable";
          await ctx.reply(
            "Можно ли *менять туриста* в туре? Напишите `да` или `нет`.",
            { parse_mode: "Markdown" }
          );
          return;

        case "svc_create_changeable": {
          const v = parseYesNo(text);
          draft.changeable = v;
          ctx.session.state = "svc_create_visa";
          await ctx.reply(
            "Включена ли *виза* в этот тур? Напишите `да` или `нет`.",
            { parse_mode: "Markdown" }
          );
          return;
        }

        case "svc_create_visa": {
          const v2 = parseYesNo(text);
          draft.visaIncluded = v2;
          ctx.session.state = "svc_create_expiration";
          await ctx.reply(
            "До какой даты тур *актуален*? Укажите дату ГГГГ-ММ-ДД или напишите `нет`, если только по дате вылета.",
            { parse_mode: "Markdown" }
          );
          return;
        }

        case "svc_create_expiration":
          draft.expiration =
            text.trim().toLowerCase() === "нет" ? null : text.trim();
          ctx.session.state = "svc_create_photo";
          await ctx.reply(
            "Отправьте одно *фото тура* одним сообщением или напишите `пропустить`.",
            { parse_mode: "Markdown" }
          );
          return;

        case "svc_create_photo":
          if (text.trim().toLowerCase() === "пропустить") {
            draft.images = [];
            await finishCreateServiceFromWizard(ctx);
            return;
          }
          // если сюда пришёл текст, а не фото — просто напомним
          await ctx.reply(
            "Пожалуйста, отправьте фото сообщением с картинкой или напишите `пропустить`."
          );
          return;

        default:
          break;
      }
    }
  } catch (e) {
    console.error("[tg-bot] error handling text:", e);
  }

  return next();
});

// ==== ОБРАБОТКА ФОТО ДЛЯ МАСТЕРА ====

bot.on("photo", async (ctx, next) => {
  try {
    const state = ctx.session?.state || null;

    if (state === "svc_create_photo" && ctx.session?.serviceDraft) {
      const photos = ctx.message.photo || [];
      if (!photos.length) {
        await ctx.reply("Не удалось прочитать фото. Попробуйте ещё раз.");
        return;
      }

      const largest = photos[photos.length - 1];
      const fileId = largest.file_id;

      ctx.session.serviceDraft.images = [`tg:${fileId}`];

      await finishCreateServiceFromWizard(ctx);
      return;
    }
  } catch (e) {
    console.error("[tg-bot] photo handler error:", e);
  }

  return next();
});

// ==== INLINE-ПОИСК и остальной твой код остаётся как был ====

// ⚠️ здесь НЕТ bot.launch() — запуск делаем из index.js
module.exports = { bot };
