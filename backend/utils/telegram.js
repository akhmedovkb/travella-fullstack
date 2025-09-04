// backend/utils/telegram.js
const pool = require("../db");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : "";
const SITE = (process.env.SITE_PUBLIC_URL || "").replace(/\/+$/, "");

// Можно ли отправлять сообщения
const enabled = !!BOT_TOKEN;

/* ---------------- helpers ---------------- */

// Безопасная экранизация для parse_mode: "HTML"
function esc(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Форматирование дат (уникальные, отсортированные)
function fmtDates(dates = []) {
  const list = Array.isArray(dates) ? dates.map(String).filter(Boolean) : [];
  const uniq = [...new Set(list)].sort();
  return uniq.length ? uniq.join(", ") : "—";
}

// Ссылка в кабинет/профиль
function serviceUrl(providerId, bookingId = null) {
  // Если SITE задан, будет абсолютный URL (для кнопки)
  // Если SITE пуст, вернём относительный путь — как раньше (текстом тоже ок)
  if (bookingId) return `${SITE}/dashboard/bookings#${bookingId}`;
  return `${SITE}/profile/provider/${providerId}`;
}

// Инлайн-кнопка «Открыть» — только с абсолютным https? URL
function openBtn(url) {
  if (!url || !/^https?:\/\//i.test(url)) return {};
  return {
    reply_markup: {
      inline_keyboard: [[{ text: "Открыть", url }]],
    },
  };
}

/* ------------- low-level send ------------- */

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
    // Node 18+ имеет fetch глобально; для Node < 18 — подключи node-fetch.
    const res = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("tgSend non-OK:", res.status, body);
    }
    return res.ok;
  } catch (e) {
    console.warn("tgSend failed:", e?.message || e);
    return false;
  }
}

/* ------- link chat_id after /start ------- */

async function linkProviderChat(providerId, chatId, username = null) {
  if (!providerId || !chatId) return;
  await pool.query(
    `UPDATE providers
        SET telegram_chat_id = $2,
            social = COALESCE(social, $3)
      WHERE id = $1
        AND (telegram_chat_id IS DISTINCT FROM $2)`,
    [providerId, chatId, username ? `@${username}` : null]
  );
}

async function linkClientChat(clientId, chatId, username = null) {
  if (!clientId || !chatId) return;
  await pool.query(
    `UPDATE clients
        SET telegram_chat_id = $2,
            telegram = COALESCE(telegram, $3)
      WHERE id = $1
        AND (telegram_chat_id IS DISTINCT FROM $2)`,
    [clientId, chatId, username ? `@${username}` : null]
  );
}

/* ------------- read chat_id ------------- */

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

/* ------------- notifications ------------- */

// 1) Новая заявка -> провайдеру
async function notifyNewRequest({ booking, provider, client, service }) {
  try {
    const chatId = await getProviderChatId(booking.provider_id);
    if (!chatId) return;

    const url = serviceUrl(booking.provider_id, booking.id);
    const text =
      `<b>🆕 Новая заявка</b>\n` +
      `Услуга: <b>${esc(service?.title || "—")}</b>\n` +
      `Даты: <b>${esc(fmtDates(booking.dates))}</b>\n` +
      (client?.name ? `Клиент: <b>${esc(client.name)}</b>\n` : "") +
      (booking.client_message ? `Комментарий: ${esc(booking.client_message)}\n` : "") +
      (url ? `\nОткрыть: ${esc(url)}` : "");

    await tgSend(chatId, text, openBtn(url));
  } catch {}
}

// 2) Провайдер указал цену -> клиенту/заявителю
async function notifyQuote({ booking, price, currency, note /*, client, requester */ }) {
  try {
    const chatId = booking.requester_provider_id
      ? await getProviderChatId(booking.requester_provider_id)
      : await getClientChatId(booking.client_id);
    if (!chatId) return;

    const url = serviceUrl(booking.provider_id, booking.id);
    const text =
      `<b>💬 Предложение по заявке</b>\n` +
      `Цена: <b>${esc(String(price))} ${esc(currency || "USD")}</b>\n` +
      (note ? `Комментарий: ${esc(note)}\n` : "") +
      `Даты: <b>${esc(fmtDates(booking.dates))}</b>\n` +
      (url ? `\nОткрыть: ${esc(url)}` : "");

    await tgSend(chatId, text, openBtn(url));
  } catch {}
}

// 3) Подтверждение -> обеим сторонам
async function notifyConfirmed({ booking }) {
  try {
    const url = serviceUrl(booking.provider_id, booking.id);
    const text =
      `<b>✅ Бронь подтверждена</b>\n` +
      `Даты: <b>${esc(fmtDates(booking.dates))}</b>\n` +
      (url ? `${esc(url)}` : "");

    // Провайдеру
    const chatProv = await getProviderChatId(booking.provider_id);
    if (chatProv) await tgSend(chatProv, text, openBtn(url));

    // Клиенту/заявителю
    const chatClient = booking.requester_provider_id
      ? await getProviderChatId(booking.requester_provider_id)
      : await getClientChatId(booking.client_id);
    if (chatClient) await tgSend(chatClient, text, openBtn(url));
  } catch {}
}

// 4) Отклонение -> второй стороне
async function notifyRejected({ booking, reason }) {
  try {
    const chat = booking.requester_provider_id
      ? await getProviderChatId(booking.requester_provider_id)
      : await getClientChatId(booking.client_id);
    if (!chat) return;

    const url = serviceUrl(booking.provider_id, booking.id);
    const text =
      `<b>⛔️ Заявка отклонена</b>\n` +
      (reason ? `Причина: ${esc(reason)}\n` : "") +
      `Даты: <b>${esc(fmtDates(booking.dates))}</b>\n` +
      (url ? `${esc(url)}` : "");

    await tgSend(chat, text, openBtn(url));
  } catch {}
}

// 5) Отмена клиентом -> провайдеру
async function notifyCancelled({ booking }) {
  try {
    const chat = await getProviderChatId(booking.provider_id);
    if (!chat) return;

    const url = serviceUrl(booking.provider_id, booking.id);
    const text =
      `<b>❎ Заявка отменена клиентом</b>\n` +
      `Даты: <b>${esc(fmtDates(booking.dates))}</b>\n` +
      (url ? `${esc(url)}` : "");

    await tgSend(chat, text, openBtn(url));
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
};
