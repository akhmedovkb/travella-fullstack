// backend/telegram/handlers/serviceActualHandler.js

const db = require("../../db");
const { tgAnswerCallbackQuery, tgSend } = require("../../utils/telegram");
const { isServiceActual } = require("../helpers/serviceActual");
const { buildSvcActualKeyboard } = require("../keyboards/serviceActual");

function safeJsonParseMaybe(v) {
  if (!v) return {};
  if (typeof v === "object") return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

async function loadServiceWithProvider(serviceId) {
  const q = await db.query(
    `
    SELECT
      s.id, s.title, s.category, s.status, s.details,
      -- ВАЖНО: напоминания об актуальности могут отправляться в отдельный чат отказов.
      -- Поэтому разрешаем callback из любого из привязанных чатов провайдера.
      COALESCE(p.telegram_refused_chat_id, p.telegram_web_chat_id, p.telegram_chat_id) AS telegram_chat_id,
      p.telegram_refused_chat_id,
      p.telegram_web_chat_id,
      p.telegram_chat_id
    FROM services s
    JOIN providers p ON p.id = s.provider_id
    WHERE s.id = $1
    LIMIT 1
    `,
    [serviceId]
  );
  return q.rows[0] || null;
}

/**
 * ВАЖНО:
 * Раньше getMeta() возвращал "обрезанную" мету (только часть ключей),
 * из-за чего при сохранении пропадали lockUntil/lastSentBy/lastSendOk и т.п.
 * Теперь возвращаем meta-объект целиком.
 */
function getMeta(details) {
  const d = details || {};
  const meta =
    d.tg_actual_reminders_meta && typeof d.tg_actual_reminders_meta === "object"
      ? d.tg_actual_reminders_meta
      : {};
  return meta;
}

async function saveDetails(serviceId, details) {
  await db.query(`UPDATE services SET details = $2 WHERE id = $1`, [
    serviceId,
    JSON.stringify(details),
  ]);
}

async function handleServiceActualCallback(ctxLike) {
  // ctxLike: { callbackQueryId, data, fromChatId }
  const { callbackQueryId, data, fromChatId } = ctxLike;
  const tokenOverride =
    ctxLike.tokenOverride || process.env.TELEGRAM_CLIENT_BOT_TOKEN || "";

  // data: svc_actual:<id>:<action>
  // Добавили ping
  const m = /^svc_actual:(\d+):(yes|no|extend7|ping)$/.exec(String(data || ""));
  if (!m) return { handled: false };

  const serviceId = Number(m[1]);
  const action = m[2];

  const row = await loadServiceWithProvider(serviceId);
  if (!row) {
    if (callbackQueryId) {
      await tgAnswerCallbackQuery(
        callbackQueryId,
        "Услуга не найдена",
        { show_alert: true },
        tokenOverride
      );
    }
    return { handled: true };
  }

  // Защита: отвечать может только владелец чата (провайдер)
  if (row.telegram_chat_id && fromChatId) {
    const allowed = new Set(
      [row.telegram_refused_chat_id, row.telegram_web_chat_id, row.telegram_chat_id]
        .filter(Boolean)
        .map((x) => String(x))
    );
    if (allowed.size && !allowed.has(String(fromChatId))) {
      if (callbackQueryId) {
        await tgAnswerCallbackQuery(
          callbackQueryId,
          "Нет доступа",
          { show_alert: true },
          tokenOverride
        );
      }
      return { handled: true };
    }
  }

  const details = safeJsonParseMaybe(row.details);
  const meta = getMeta(details);
  const nowIso = new Date().toISOString();

  const d = details;

  // даты (универсально)
  const dateInfo =
    (d.startDate && d.endDate && `${d.startDate} → ${d.endDate}`) ||
    (d.checkinDate && d.checkoutDate && `${d.checkinDate} → ${d.checkoutDate}`) ||
    (d.checkInDate && d.checkOutDate && `${d.checkInDate} → ${d.checkOutDate}`) ||
    (d.departureFlightDate &&
      `${d.departureFlightDate}${
        d.returnFlightDate ? ` → ${d.returnFlightDate}` : ""
      }`) ||
    (d.eventDate && String(d.eventDate)) ||
    "";

  // направление/локация/отель
  const placeInfo =
    [d.directionCountry, d.directionFrom, d.directionTo].filter(Boolean).join(" / ") ||
    [d.country, d.city].filter(Boolean).join(" / ") ||
    (d.hotel && String(d.hotel)) ||
    "";

  // --- PING (Проверить) ---
  if (action === "ping") {
    const actual = isServiceActual(details, row);

    if (callbackQueryId) {
      await tgAnswerCallbackQuery(
        callbackQueryId,
        actual ? "✅ Сейчас отмечено как актуально" : "⛔ Сейчас отмечено как неактуально",
        { show_alert: false },
        tokenOverride
      );
    }

    if (row.telegram_chat_id) {
      const txt =
        `🔄 <b>Проверка статуса</b>\n\n` +
        `Код: <code>#R${serviceId}</code>\n` +
        `Услуга: <b>${escapeHtml(row.title || "Услуга")}</b>\n` +
        (placeInfo ? `Направление/отель: <b>${escapeHtml(placeInfo)}</b>\n` : "") +
        (dateInfo ? `Даты: <b>${escapeHtml(dateInfo)}</b>\n` : "") +
        `Категория: <code>${escapeHtml(row.category)}</code>\n` +
        `Сейчас: ${actual ? "✅ актуально" : "⛔ неактуально"}`;

      await tgSend(
        row.telegram_chat_id,
        txt,
        {
          parse_mode: "HTML",
          reply_markup: buildSvcActualKeyboard(serviceId, { isActual: actual }),
        },
        tokenOverride
      );
    }

    return { handled: true };
  }

  // --- Общая заготовка next ---
  // Всегда при любом ответе:
  // - сбрасываем ignoredDays
  // - фиксируем lastAnswer/lastAnswerAt
  // - lastConfirmedAt
  // - сбрасываем lockUntil (если был выставлен админом)
  const next = {
    ...details,
    tg_actual_reminders_meta: {
      ...meta,
      ignoredDays: 0,
      lockUntil: null,
      lastConfirmedAt: nowIso,
      lastAnswer: action,
      lastAnswerAt: nowIso,
    },
  };

  // --- YES ---
  if (action === "yes") {
    next.isActive = true;
    await saveDetails(serviceId, next);

    if (callbackQueryId) {
      await tgAnswerCallbackQuery(
        callbackQueryId,
        "Отлично ✅",
        { show_alert: false },
        tokenOverride
      );
    }

    if (row.telegram_chat_id) {
      const txt =
        `✅ Подтверждено: <b>${escapeHtml(row.title || "Услуга")}</b>\n` +
        `Код: <code>#R${serviceId}</code>\n` +
        (placeInfo ? `Направление/отель: <b>${escapeHtml(placeInfo)}</b>\n` : "") +
        (dateInfo ? `Даты: <b>${escapeHtml(dateInfo)}</b>\n` : "") +
        `— актуально`;

      await tgSend(row.telegram_chat_id, txt, { parse_mode: "HTML" }, tokenOverride);
    }

    return { handled: true };
  }

  // --- NO ---
  if (action === "no") {
    next.isActive = false;
    await saveDetails(serviceId, next);

    if (callbackQueryId) {
      await tgAnswerCallbackQuery(
        callbackQueryId,
        "Снято с актуальности ⛔",
        { show_alert: false },
        tokenOverride
      );
    }

    if (row.telegram_chat_id) {
      const txt =
        `⛔ Снято с актуальности: <b>${escapeHtml(row.title || "Услуга")}</b>\n` +
        `Код: <code>#R${serviceId}</code>\n` +
        (placeInfo ? `Направление/отель: <b>${escapeHtml(placeInfo)}</b>\n` : "") +
        (dateInfo ? `Даты: <b>${escapeHtml(dateInfo)}</b>\n` : "");

      await tgSend(row.telegram_chat_id, txt, { parse_mode: "HTML" }, tokenOverride);
    }

    return { handled: true };
  }

  // --- EXTEND7 ---
  {
    // продлеваем expiration на 7 дней
    const cur = details.expiration ? new Date(details.expiration) : null;
    const base = cur && !Number.isNaN(cur.getTime()) ? cur : new Date();
    const extended = addDays(base, 7);

    next.expiration = extended.toISOString();
    next.isActive = true;

    await saveDetails(serviceId, next);

    const actual = isServiceActual(next, row);

    if (callbackQueryId) {
      await tgAnswerCallbackQuery(
        callbackQueryId,
        "Продлено на 7 дней ♻️",
        { show_alert: false },
        tokenOverride
      );
    }

    if (row.telegram_chat_id) {
      const txt =
        `♻️ Продлено на 7 дней: <b>${escapeHtml(row.title || "Услуга")}</b>\n` +
        `Код: <code>#R${serviceId}</code>\n` +
        (placeInfo ? `Направление/отель: <b>${escapeHtml(placeInfo)}</b>\n` : "") +
        (dateInfo ? `Даты: <b>${escapeHtml(dateInfo)}</b>\n` : "") +
        `Новая актуальность до: <b>${escapeHtml(
          extended.toISOString().slice(0, 10)
        )}</b>` +
        (actual
          ? ""
          : `\n\n⚠️ Но сейчас услуга всё равно выглядит неактуальной по датам/флагам.`);

      await tgSend(
        row.telegram_chat_id,
        txt,
        {
          parse_mode: "HTML",
          reply_markup: buildSvcActualKeyboard(serviceId, { isActual: actual }),
        },
        tokenOverride
      );
    }

    return { handled: true };
  }
}

module.exports = { handleServiceActualCallback };
