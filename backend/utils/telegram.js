// backend/utils/telegram.js
const pool = require("../db");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : "";
const SITE = (process.env.SITE_PUBLIC_URL || "").replace(/\/+$/, "");
const enabled = !!BOT_TOKEN;

/* ================== helpers ================== */

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
    const res = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function fmtDates(arr) {
  if (!Array.isArray(arr) || !arr.length) return "—";
  return arr.map((d) => String(d).slice(0, 10)).join(", ");
}
function urlProvider(tab = "bookings") {
  return `${SITE}/dashboard?tab=${tab}`;
}
function urlClient(tab = "bookings") {
  return `${SITE}/client?tab=${tab}`;
}

/* ===== chat_id linking ===== */

async function linkProviderChat(providerId, chatId) {
  if (!providerId || !chatId) return;
  await pool.query(`UPDATE providers SET telegram_chat_id=$2 WHERE id=$1`, [providerId, chatId]);
}
async function linkClientChat(clientId, chatId) {
  if (!clientId || !chatId) return;
  await pool.query(`UPDATE clients SET telegram_chat_id=$2 WHERE id=$1`, [clientId, chatId]);
}
async function getProviderChatId(providerId) {
  if (!providerId) return null;
  const q = await pool.query(`SELECT telegram_chat_id FROM providers WHERE id=$1`, [providerId]);
  return q.rows[0]?.telegram_chat_id || null;
}
async function getClientChatId(clientId) {
  if (!clientId) return null;
  const q = await pool.query(`SELECT telegram_chat_id FROM clients WHERE id=$1`, [clientId]);
  return q.rows[0]?.telegram_chat_id || null;
}

/* ================== BOOKINGS (уже были) ================== */
/** Новая бронь → провайдеру */
async function notifyNewRequest({ booking, client, service }) {
  try {
    const chat = await getProviderChatId(booking.provider_id);
    if (!chat) return;

    const title = service?.title || "Услуга";
    const dates = fmtDates(booking?.dates || []);
    const clientName = client?.name || "Клиент";

    const text =
      `<b>🆕 Новая бронь</b>\n` +
      `Услуга: <b>${title}</b>\n` +
      `Клиент: <b>${clientName}</b>\n` +
      `Даты: <b>${dates}</b>\n\n` +
      `Открыть: ${urlProvider("bookings")}`;
    await tgSend(chat, text);
  } catch {}
}

/** Провайдер отправил оффер → клиенту/заявителю */
async function notifyQuote({ booking, price, currency, note }) {
  try {
    // если бронирует провайдер → уведомляем провайдера-заявителя, иначе клиента
    let chat = null;
    if (booking?.requester_provider_id) {
      chat = await getProviderChatId(booking.requester_provider_id);
    } else {
      chat = await getClientChatId(booking?.client_id);
    }
    if (!chat) return;

    const text =
      `<b>💬 Предложение по брони</b>\n` +
      `Цена: <b>${Number(price) || 0} ${currency || "USD"}</b>\n` +
      (note ? `Комментарий: ${note}\n` : "") +
      `Даты: <b>${fmtDates(booking?.dates)}</b>\n\n` +
      `Открыть: ${booking?.requester_provider_id ? urlProvider("bookings") : urlClient("bookings")}`;
    await tgSend(chat, text);
  } catch {}
}

/** Подтверждение → обеим сторонам */
async function notifyConfirmed({ booking }) {
  try {
    const chatClient = await getClientChatId(booking?.client_id);
    if (chatClient) {
      await tgSend(
        chatClient,
        `<b>✅ Бронь подтверждена</b>\nДаты: <b>${fmtDates(booking.dates)}</b>\nОткрыть: ${urlClient("bookings")}`
      );
    }
    const chatProvider = await getProviderChatId(booking?.provider_id);
    if (chatProvider) {
      await tgSend(
        chatProvider,
        `<b>✅ Бронь подтверждена</b>\nДаты: <b>${fmtDates(booking.dates)}</b>\nОткрыть: ${urlProvider("bookings")}`
      );
    }
    if (booking?.requester_provider_id) {
      const chatRequesterProv = await getProviderChatId(booking.requester_provider_id);
      if (chatRequesterProv) {
        await tgSend(
          chatRequesterProv,
          `<b>✅ Бронь подтверждена</b>\nДаты: <b>${fmtDates(booking.dates)}</b>\nОткрыть: ${urlProvider("bookings")}`
        );
      }
    }
  } catch {}
}

/** Отклонение → заявителю */
async function notifyRejected({ booking, reason }) {
  try {
    let chat = null;
    if (booking?.requester_provider_id) {
      chat = await getProviderChatId(booking.requester_provider_id);
    } else {
      chat = await getClientChatId(booking?.client_id);
    }
    if (!chat) return;

    const text =
      `<b>❌ Бронь отклонена</b>` +
      (reason ? `\nПричина: ${reason}` : "") +
      `\nДаты: <b>${fmtDates(booking?.dates)}</b>\n\n` +
      `Открыть: ${booking?.requester_provider_id ? urlProvider("bookings") : urlClient("bookings")}`;
    await tgSend(chat, text);
  } catch {}
}

/** Отмена системой/провайдером → клиенту/заявителю */
async function notifyCancelled({ booking }) {
  try {
    let chat = null;
    if (booking?.requester_provider_id) {
      chat = await getProviderChatId(booking.requester_provider_id);
    } else {
      chat = await getClientChatId(booking?.client_id);
    }
    if (chat) {
      await tgSend(
        chat,
        `<b>⚠️ Бронь отменена</b>\nДаты: <b>${fmtDates(booking.dates)}</b>\nОткрыть: ${booking?.requester_provider_id ? urlProvider("bookings") : urlClient("bookings")}`
      );
    }
  } catch {}
}

/** Отмена клиентом/заявителем → провайдеру */
async function notifyCancelledByRequester({ booking }) {
  try {
    const chat = await getProviderChatId(booking?.provider_id);
    if (!chat) return;
    await tgSend(
      chat,
      `<b>⚠️ Заявитель отменил бронь</b>\nДаты: <b>${fmtDates(booking.dates)}</b>\nОткрыть: ${urlProvider("bookings")}`
    );
  } catch {}
}

/* ================== REQUESTS (новое: заявки/inbox) ================== */
/** вытянуть заявку + стороны, определить кто заявитель: клиент или провайдер */
async function getRequestActors(requestId) {
  const q = await pool.query(
    `
    SELECT
      r.id, COALESCE(r.status,'new') AS status, r.note, r.created_at,
      s.id AS service_id, s.title AS service_title, s.provider_id,

      c.id AS client_id, c.name AS client_name, c.phone AS client_phone,

      -- если «клиент» на самом деле провайдер (зеркало) — найдём его по совпадению email/phone
      p2.id   AS requester_provider_id,
      p2.name AS requester_provider_name

    FROM requests r
    JOIN services  s ON s.id = r.service_id
    LEFT JOIN clients   c ON c.id = r.client_id
    LEFT JOIN providers p2 ON (p2.email IS NOT DISTINCT FROM c.email OR p2.phone IS NOT DISTINCT FROM c.phone)
    WHERE r.id = $1
    `,
    [requestId]
  );
  if (!q.rowCount) return null;

  const row = q.rows[0];
  const toProviderId = row.provider_id;
  const toProviderChat = await getProviderChatId(toProviderId);

  // заявитель: если найден p2 → провайдер, иначе обычный клиент
  const fromIsProvider = !!row.requester_provider_id;
  const fromChat = fromIsProvider
    ? await getProviderChatId(row.requester_provider_id)
    : await getClientChatId(row.client_id);

  return {
    row,
    toProviderId,
    toProviderChat,
    fromIsProvider,
    fromChat,
  };
}

/** Новая заявка → провайдеру (любой тип провайдера) */
async function notifyReqNew({ request_id }) {
  try {
    const a = await getRequestActors(request_id);
    if (!a || !a.toProviderChat) return;

    const text =
      `<b>🆕 Новая заявка</b>\n` +
      `Услуга: <b>${a.row.service_title || "—"}</b>\n` +
      (a.row.note ? `Сообщение: ${a.row.note}\n` : "") +
      `Открыть: ${urlProvider("requests")}`;
    await tgSend(a.toProviderChat, text);
  } catch {}
}

/** Статус заявки изменён провайдером → заявителю (клиенту или провайдеру) */
async function notifyReqStatusChanged({ request_id, status }) {
  try {
    const a = await getRequestActors(request_id);
    if (!a || !a.fromChat) return;

    const statusMap = {
      processed: "ℹ️ Заявка обработана",
      accepted:  "✅ Заявка принята",
      rejected:  "❌ Заявка отклонена",
      new:       "🆕 Заявка создана",
    };
    const title = statusMap[status] || `ℹ️ Статус: ${status}`;

    const link = a.fromIsProvider ? urlProvider("requests") : urlClient("requests");
    const text =
      `<b>${title}</b>\n` +
      `Услуга: <b>${a.row.service_title || "—"}</b>\n` +
      (a.row.note ? `Сообщение: ${a.row.note}\n` : "") +
      `Открыть: ${link}`;
    await tgSend(a.fromChat, text);
  } catch {}
}

/** Заявитель удалил/отменил заявку → провайдеру */
async function notifyReqCancelledByRequester({ request_id }) {
  try {
    const a = await getRequestActors(request_id);
    if (!a || !a.toProviderChat) return;

    const text =
      `<b>⚠️ Заявка отменена заявителем</b>\n` +
      `Услуга: <b>${a.row.service_title || "—"}</b>\n` +
      `Открыть: ${urlProvider("requests")}`;
    await tgSend(a.toProviderChat, text);
  } catch {}
}

/** Провайдер удалил заявку → заявителю */
async function notifyReqDeletedByProvider({ request_id }) {
  try {
    const a = await getRequestActors(request_id);
    if (!a || !a.fromChat) return;

    const link = a.fromIsProvider ? urlProvider("requests") : urlClient("requests");
    const text =
      `<b>🗑️ Заявка удалена провайдером</b>\n` +
      `Услуга: <b>${a.row.service_title || "—"}</b>\n` +
      `Открыть: ${link}`;
    await tgSend(a.fromChat, text);
  } catch {}
}

module.exports = {
  enabled,
  tgSend,
  linkProviderChat,
  linkClientChat,
  // BOOKINGS:
  notifyNewRequest,
  notifyQuote,
  notifyConfirmed,
  notifyRejected,
  notifyCancelled,
  notifyCancelledByRequester,
  // REQUESTS (новое):
  notifyReqNew,
  notifyReqStatusChanged,
  notifyReqCancelledByRequester,
  notifyReqDeletedByProvider,
};
