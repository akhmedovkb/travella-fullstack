// backend/utils/telegram.js
const pool = require("../db");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : "";
const SITE = (process.env.SITE_PUBLIC_URL || "").replace(/\/+$/, "");

// Небезопасно слать, если нет токена
const enabled = !!BOT_TOKEN;

// Универсальная посылка
async function tgSend(chatId, text, extra = {}) {
  if (!enabled || !chatId || !text) return false;
  try {
    const payload = {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...extra,
    };
    // Node 18+ имеет fetch глобально. Для Node < 18 — добавь node-fetch.
    const res = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Сохранение chat_id после /start
async function linkProviderChat(providerId, chatId, username = null) {
  if (!providerId || !chatId) return;
  await pool.query(
    `UPDATE providers SET telegram_chat_id=$2, social = COALESCE(social, $3)
     WHERE id=$1 AND (telegram_chat_id IS DISTINCT FROM $2)`,
    [providerId, chatId, username ? `@${username}` : null]
  );
}
async function linkClientChat(clientId, chatId, username = null) {
  if (!clientId || !chatId) return;
  await pool.query(
    `UPDATE clients SET telegram_chat_id=$2, telegram = COALESCE(telegram, $3)
     WHERE id=$1 AND (telegram_chat_id IS DISTINCT FROM $2)`,
    [clientId, chatId, username ? `@${username}` : null]
  );
}

// Получение chat_id
async function getProviderChatId(providerId) {
  if (!providerId) return null;
  const q = await pool.query(
    `SELECT telegram_chat_id FROM providers WHERE id=$1`,
    [providerId]
  );
  return q.rows[0]?.telegram_chat_id || null;
}
async function getClientChatId(clientId) {
  if (!clientId) return null;
  const q = await pool.query(
    `SELECT telegram_chat_id FROM clients WHERE id=$1`,
    [clientId]
  );
  return q.rows[0]?.telegram_chat_id || null;
}

// Общий формат сообщений
function fmtDates(dates = []) {
  const list = Array.isArray(dates) ? dates : [];
  if (!list.length) return "—";
  return list.join(", ");
}
function serviceUrl(providerId, bookingId = null) {
  // ссылка в кабинет поставщика на брони
  if (bookingId) return `${SITE}/dashboard/bookings#${bookingId}`;
  return `${SITE}/profile/provider/${providerId}`;
}

// ==== НОТИФИКАЦИИ ПО СОБЫТИЯМ ====

// 1) При создании заявки (pending) — слать поставщику
async function notifyNewRequest({ booking, provider, client, service }) {
  try {
    const chatId = await getProviderChatId(booking.provider_id);
    if (!chatId) return;
    const text =
      `<b>🆕 Новая заявка</b>\n` +
      `Услуга: <b>${service?.title || "—"}</b>\n` +
      `Даты: <b>${fmtDates(booking.dates)}</b>\n` +
      (client?.name ? `Клиент: <b>${client.name}</b>\n` : "") +
      (booking.client_message ? `Комментарий: ${booking.client_message}\n` : "") +
      `\nОткрыть: ${serviceUrl(booking.provider_id, booking.id)}`;
    await tgSend(chatId, text);
  } catch {}
}

// 2) Провайдер указал цену (quote) — слать клиенту/заявителю
async function notifyQuote({ booking, price, currency, note, client, requester }) {
  try {
    // приоритет: если есть requester_provider_id — значит «провайдер-заявитель»,
    // иначе обычный клиент
    const chatId = booking.requester_provider_id
      ? await getProviderChatId(booking.requester_provider_id)
      : await getClientChatId(booking.client_id);
    if (!chatId) return;

    const text =
      `<b>💬 Предложение по заявке</b>\n` +
      `Цена: <b>${price} ${currency || "USD"}</b>\n` +
      (note ? `Комментарий: ${note}\n` : "") +
      `Даты: <b>${fmtDates(booking.dates)}</b>\n` +
      `\nОткрыть: ${serviceUrl(booking.provider_id, booking.id)}`;
    await tgSend(chatId, text);
  } catch {}
}

// 3) Подтверждение — слать второй стороне
async function notifyConfirmed({ booking }) {
  try {
    // провайдеру:
    const chatProv = await getProviderChatId(booking.provider_id);
    if (chatProv) {
      await tgSend(
        chatProv,
        `<b>✅ Бронь подтверждена</b>\nДаты: <b>${fmtDates(booking.dates)}</b>\n${serviceUrl(booking.provider_id, booking.id)}`
      );
    }
    // клиенту/заявителю:
    const chatClient = booking.requester_provider_id
      ? await getProviderChatId(booking.requester_provider_id)
      : await getClientChatId(booking.client_id);
    if (chatClient) {
      await tgSend(
        chatClient,
        `<b>✅ Бронь подтверждена</b>\nДаты: <b>${fmtDates(booking.dates)}</b>\n${serviceUrl(booking.provider_id, booking.id)}`
      );
    }
  } catch {}
}

// 4) Отклонение — слать второй стороне
async function notifyRejected({ booking, reason }) {
  try {
    const chat = booking.requester_provider_id
      ? await getProviderChatId(booking.requester_provider_id)
      : await getClientChatId(booking.client_id);
    if (!chat) return;
    const text =
      `<b>⛔️ Заявка отклонена</b>\n` +
      (reason ? `Причина: ${reason}\n` : "") +
      `Даты: <b>${fmtDates(booking.dates)}</b>\n` +
      `${serviceUrl(booking.provider_id, booking.id)}`;
    await tgSend(chat, text);
  } catch {}
}

// 5) Отмена — слать второй стороне (клиент отменил)
async function notifyCancelled({ booking }) {
  try {
    const chat = await getProviderChatId(booking.provider_id);
    if (!chat) return;
    const text =
      `<b>❎ Заявка отменена клиентом</b>\n` +
      `Даты: <b>${fmtDates(booking.dates)}</b>\n` +
      `${serviceUrl(booking.provider_id, booking.id)}`;
    await tgSend(chat, text);
  } catch {}
}

// 6) Отмена — слать второй стороне (отменил провайдер-заявитель исходящую)
async function notifyCancelledByRequester({ booking }) {
  try {
    const chat = await getProviderChatId(booking.provider_id);
    if (!chat) return;
    const text =
      `<b>❎ Заявка отменена заявителем</b>\n` +
      `Даты: <b>${fmtDates(booking.dates)}</b>\n` +
      `${serviceUrl(booking.provider_id, booking.id)}`;
    await tgSend(chat, text);
  } catch {}
}

module.exports = {
  enabled,
  tgSend,
  linkProviderChat,
  linkClientChat,
  notifyNewRequest,
  notifyQuote,
  notifyConfirmed,
  notifyRejected,
  notifyCancelled,
  notifyCancelledByRequester,
};

