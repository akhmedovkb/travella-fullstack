// backend/utils/telegram.js
/* eslint-disable no-useless-escape */
const pool = require("../db");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : "";
const SITE = (process.env.SITE_PUBLIC_URL || "").replace(/\/+$/, "");
const enabled = !!BOT_TOKEN;

/* ================== low-level helpers ================== */

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

// very small cache to avoid frequent getChat calls
const __chatUserCache = new Map(); // chatId -> username (without @)
async function tgGetUsername(chatId) {
  if (!enabled || !chatId) return "";
  if (__chatUserCache.has(chatId)) return __chatUserCache.get(chatId) || "";
  try {
    const res = await fetch(`${API}/getChat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId }),
    });
    if (!res.ok) return "";
    const data = await res.json().catch(() => ({}));
    const uname = data?.result?.username || "";
    __chatUserCache.set(chatId, uname);
    return uname || "";
  } catch {
    return "";
  }
}

function esc(v) {
  if (v == null) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
function lineContact(prefixEmoji, prefixLabel, name, phone, username) {
  const parts = [];
  if (name) parts.push(`<b>${esc(name)}</b>`);
  if (phone) parts.push(`☎️ ${esc(phone)}`);
  if (username) parts.push(`@${esc(username)}`);
  return `${prefixEmoji} ${esc(prefixLabel)}: ${parts.join(" • ")}`;
}

/* ===== chat_id linking (как было) ===== */

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

/* ================== ACTORS HELPERS ================== */
/** Подтянуть максимум данных по брони, чтобы красиво сформировать «от кого» и контакты. */
async function getBookingActors(input) {
  const bookingId = typeof input === "object" ? input?.id : input;
  if (!bookingId) return null;

  const q = await pool.query(
    `
    SELECT
      b.id, b.status, b.dates, b.provider_id, b.client_id, b.requester_provider_id,
      s.id AS service_id, s.title AS service_title,

      -- основной провайдер (исполнитель)
      p.id   AS provider__id,
      p.name AS provider__name,
      p.phone AS provider__phone,
      p.telegram_chat_id AS provider__chat,

      -- клиент
      c.id   AS client__id,
      c.name AS client__name,
      c.phone AS client__phone,
      c.telegram_chat_id AS client__chat,

      -- провайдер-заявитель (агент), если есть
      pa.id   AS agent__id,
      pa.name AS agent__name,
      pa.phone AS agent__phone,
      pa.telegram_chat_id AS agent__chat

    FROM bookings b
    LEFT JOIN services  s  ON s.id = b.service_id
    LEFT JOIN providers p  ON p.id = b.provider_id
    LEFT JOIN clients   c  ON c.id = b.client_id
    LEFT JOIN providers pa ON pa.id = b.requester_provider_id
    WHERE b.id = $1
    `,
    [bookingId]
  );
  if (!q.rowCount) return null;
  const row = q.rows[0];

  // usernames (если чаты есть)
  const unameClient  = row.client__chat  ? await tgGetUsername(row.client__chat)  : "";
  const unameProv    = row.provider__chat? await tgGetUsername(row.provider__chat): "";
  const unameAgent   = row.agent__chat   ? await tgGetUsername(row.agent__chat)   : "";

  return {
    id: row.id,
    status: row.status || "",
    dates: row.dates || [],
    serviceTitle: row.service_title || "",
    provider: {
      id: row.provider__id,
      name: row.provider__name,
      phone: row.provider__phone,
      chatId: row.provider__chat,
      username: unameProv,
    },
    client: {
      id: row.client__id,
      name: row.client__name,
      phone: row.client__phone,
      chatId: row.client__chat,
      username: unameClient,
    },
    agent: row.agent__id
      ? {
          id: row.agent__id,
          name: row.agent__name,
          phone: row.agent__phone,
          chatId: row.agent__chat,
          username: unameAgent,
        }
      : null,
  };
}

/** Для заявок (быстрые запросы/requests) — кто кому. */
async function getRequestActors(requestId) {
  const q = await pool.query(
    `
    SELECT
      r.id, COALESCE(r.status,'new') AS status, r.note, r.created_at,
      r.service_id,
      s.title AS service_title,
      s.provider_id AS to_provider_id,

      -- исходный клиент (может быть "настоящий клиент")
      c.id AS client_id, c.name AS client_name, c.phone AS client_phone, c.telegram_chat_id AS client_chat,

      -- «клиент» может быть проксирован провайдером-заявителем (агентом)
      p2.id   AS agent_id,
      p2.name AS agent_name,
      p2.phone AS agent_phone,
      p2.telegram_chat_id AS agent_chat

    FROM requests r
    LEFT JOIN services  s  ON s.id = r.service_id
    LEFT JOIN clients   c  ON c.id = r.client_id
    LEFT JOIN providers p2 ON (p2.email IS NOT DISTINCT FROM c.email OR p2.phone IS NOT DISTINCT FROM c.phone)
    WHERE r.id = $1
    `,
    [requestId]
  );
  if (!q.rowCount) return null;

  const row = q.rows[0];

  const toProvChat = await getProviderChatId(row.to_provider_id);
  const unameClient = row.client_chat ? await tgGetUsername(row.client_chat) : "";
  const unameAgent  = row.agent_chat  ? await tgGetUsername(row.agent_chat)  : "";

  return {
    row,
    toProviderChat: toProvChat,
    from: row.agent_id
      ? { kind: "agent",   id: row.agent_id,   name: row.agent_name,   phone: row.agent_phone,   chatId: row.agent_chat,   username: unameAgent }
      : { kind: "client",  id: row.client_id,  name: row.client_name,  phone: row.client_phone,  chatId: row.client_chat,  username: unameClient },
  };
}

/* ================== BOOKINGS (улучшенные тексты) ================== */
/** Новая бронь → провайдеру (гид/транспорт/любой исполнитель) */
async function notifyNewRequest({ booking }) {
  try {
    const a = await getBookingActors(booking);
    if (!a?.provider?.chatId) return;

    const title = a.serviceTitle || "Услуга";
    const dates = fmtDates(a.dates);
    const lines = [];

    // Заголовок
    lines.push(`<b>🆕 Заявка на бронь №${a.id}</b>`);
    lines.push(`🏷️ Услуга: <b>${esc(title)}</b>`);
    lines.push(`📅 Даты: <b>${dates}</b>`);

    // «От кого»
    if (a.agent) {
      lines.push(lineContact("🧑‍💼", "Агент", a.agent.name, a.agent.phone, a.agent.username));
      if (a.client?.name || a.client?.phone || a.client?.username) {
        lines.push(lineContact("👤", "Клиент", a.client.name, a.client.phone, a.client.username));
      }
    } else {
      lines.push(lineContact("👤", "Клиент", a.client?.name, a.client?.phone, a.client?.username));
    }

    lines.push("");
    lines.push(`🔗 Открыть: ${urlProvider("bookings")}`);

    await tgSend(a.provider.chatId, lines.join("\n"));
  } catch {}
}

/** Провайдер отправил оффер (цену) → клиенту/заявителю */
async function notifyQuote({ booking, price, currency, note }) {
  try {
    const a = await getBookingActors(booking);
    if (!a) return;

    // кому отправляем: если есть агент-заявитель → ему, иначе клиенту
    const dest = a.agent?.chatId ? { chatId: a.agent.chatId, isProv: true } : { chatId: a.client?.chatId, isProv: false };
    if (!dest.chatId) return;

    const lines = [];
    lines.push(`<b>💬 Предложение по брони №${a.id}</b>`);
    if (a.serviceTitle) lines.push(`🏷️ Услуга: <b>${esc(a.serviceTitle)}</b>`);
    lines.push(`📅 Даты: <b>${fmtDates(a.dates)}</b>`);
    lines.push(`💵 Цена: <b>${Number(price) || 0} ${esc(currency || "USD")}</b>`);
    if (note) lines.push(`📝 Комментарий: ${esc(note)}`);

    // от кого пришло предложение
    lines.push(lineContact("🏢", "Поставщик", a.provider?.name, a.provider?.phone, a.provider?.username));

    lines.push("");
    lines.push(`🔗 Открыть: ${dest.isProv ? urlProvider("bookings") : urlClient("bookings")}`);

    await tgSend(dest.chatId, lines.join("\n"));
  } catch {}
}

/** Подтверждение → обеим сторонам (и агенту, если есть) */
async function notifyConfirmed({ booking }) {
  try {
    const a = await getBookingActors(booking);
    if (!a) return;
    const msg =
      `<b>✅ Бронь подтверждена №${a.id}</b>\n` +
      (a.serviceTitle ? `🏷️ Услуга: <b>${esc(a.serviceTitle)}</b>\n` : "") +
      `📅 Даты: <b>${fmtDates(a.dates)}</b>`;

    if (a.client?.chatId) {
      await tgSend(a.client.chatId, `${msg}\n\n🔗 Открыть: ${urlClient("bookings")}`);
    }
    if (a.provider?.chatId) {
      await tgSend(a.provider.chatId, `${msg}\n\n🔗 Открыть: ${urlProvider("bookings")}`);
    }
    if (a.agent?.chatId) {
      await tgSend(a.agent.chatId, `${msg}\n\n🔗 Открыть: ${urlProvider("bookings")}`);
    }
  } catch {}
}

/** Отклонение → заявителю (клиенту или агенту) */
async function notifyRejected({ booking, reason }) {
  try {
    const a = await getBookingActors(booking);
    if (!a) return;
    const dest = a.agent?.chatId ? { chatId: a.agent.chatId, isProv: true } : { chatId: a.client?.chatId, isProv: false };
    if (!dest.chatId) return;

    const lines = [];
    lines.push(`<b>❌ Бронь отклонена №${a.id}</b>`);
    if (a.serviceTitle) lines.push(`🏷️ Услуга: <b>${esc(a.serviceTitle)}</b>`);
    lines.push(`📅 Даты: <b>${fmtDates(a.dates)}</b>`);
    if (reason) lines.push(`📝 Причина: ${esc(reason)}`);
    lines.push("");
    lines.push(`🔗 Открыть: ${dest.isProv ? urlProvider("bookings") : urlClient("bookings")}`);

    await tgSend(dest.chatId, lines.join("\n"));
  } catch {}
}

/** Отмена системой/провайдером → клиенту/заявителю */
async function notifyCancelled({ booking }) {
  try {
    const a = await getBookingActors(booking);
    if (!a) return;
    const dest = a.agent?.chatId ? { chatId: a.agent.chatId, isProv: true } : { chatId: a.client?.chatId, isProv: false };
    if (!dest.chatId) return;

    const text =
      `<b>⚠️ Бронь отменена №${a.id}</b>\n` +
      (a.serviceTitle ? `🏷️ Услуга: <b>${esc(a.serviceTitle)}</b>\n` : "") +
      `📅 Даты: <b>${fmtDates(a.dates)}</b>\n\n` +
      `🔗 Открыть: ${dest.isProv ? urlProvider("bookings") : urlClient("bookings")}`;
    await tgSend(dest.chatId, text);
  } catch {}
}

/** Отмена клиентом/заявителем → провайдеру */
async function notifyCancelledByRequester({ booking }) {
  try {
    const a = await getBookingActors(booking);
    if (!a?.provider?.chatId) return;
    const text =
      `<b>⚠️ Заявитель отменил бронь №${a.id}</b>\n` +
      (a.serviceTitle ? `🏷️ Услуга: <b>${esc(a.serviceTitle)}</b>\n` : "") +
      `📅 Даты: <b>${fmtDates(a.dates)}</b>\n\n` +
      `🔗 Открыть: ${urlProvider("bookings")}`;
    await tgSend(a.provider.chatId, text);
  } catch {}
}

/* ================== REQUESTS (быстрые заявки / inbox) ================== */
/** Новая заявка → провайдеру (любой тип провайдера) */
async function notifyReqNew({ request_id }) {
  try {
    const a = await getRequestActors(request_id);
    if (!a?.toProviderChat) return;

    const lines = [];
    lines.push(`<b>🆕 Новая заявка №${a.row.id}</b>`);
    if (a.row.service_title) lines.push(`🏷️ Услуга: <b>${esc(a.row.service_title)}</b>`);

    // от кого (клиент или агент)
    if (a.from?.kind === "agent") {
      lines.push(lineContact("🧑‍💼", "Агент", a.from.name, a.from.phone, a.from.username));
    } else {
      lines.push(lineContact("👤", "Клиент", a.from?.name, a.from?.phone, a.from?.username));
    }

    if (a.row.note) lines.push(`📝 Сообщение: ${esc(a.row.note)}`);
    lines.push("");
    lines.push(`🔗 Открыть: ${urlProvider("requests")}`);

    await tgSend(a.toProviderChat, lines.join("\n"));
  } catch {}
}

/** Статус заявки изменён провайдером → заявителю (клиенту или провайдеру-агенту) */
async function notifyReqStatusChanged({ request_id, status }) {
  try {
    const a = await getRequestActors(request_id);
    if (!a?.from?.chatId) return;

    const statusMap = {
      processed: "ℹ️ Заявка обработана",
      accepted:  "✅ Заявка принята",
      rejected:  "❌ Заявка отклонена",
      new:       "🆕 Заявка создана",
    };
    const title = statusMap[status] || `ℹ️ Статус: ${status}`;

    const lines = [];
    lines.push(`<b>${title} №${a.row.id}</b>`);
    if (a.row.service_title) lines.push(`🏷️ Услуга: <b>${esc(a.row.service_title)}</b>`);
    if (a.row.note) lines.push(`📝 Сообщение: ${esc(a.row.note)}`);

    lines.push("");
    const link = a.from.kind === "agent" ? urlProvider("requests") : urlClient("requests");
    lines.push(`🔗 Открыть: ${link}`);

    await tgSend(a.from.chatId, lines.join("\n"));
  } catch {}
}

/** Заявитель удалил/отменил заявку → провайдеру */
async function notifyReqCancelledByRequester({ request_id }) {
  try {
    const a = await getRequestActors(request_id);
    if (!a?.toProviderChat) return;

    const text =
      `<b>⚠️ Заявка отменена заявителем №${a.row.id}</b>\n` +
      (a.row.service_title ? `🏷️ Услуга: <b>${esc(a.row.service_title)}</b>\n` : "") +
      `🔗 Открыть: ${urlProvider("requests")}`;
    await tgSend(a.toProviderChat, text);
  } catch {}
}

/** Провайдер удалил заявку → заявителю */
async function notifyReqDeletedByProvider({ request_id }) {
  try {
    const a = await getRequestActors(request_id);
    if (!a?.from?.chatId) return;

    const link = a.from.kind === "agent" ? urlProvider("requests") : urlClient("requests");
    const text =
      `<b>🗑️ Заявка удалена провайдером №${a.row.id}</b>\n` +
      (a.row.service_title ? `🏷️ Услуга: <b>${esc(a.row.service_title)}</b>\n` : "") +
      `🔗 Открыть: ${link}`;
    await tgSend(a.from.chatId, text);
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
  // REQUESTS:
  notifyReqNew,
  notifyReqStatusChanged,
  notifyReqCancelledByRequester,
  notifyReqDeletedByProvider,
};
