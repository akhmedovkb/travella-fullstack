// backend/utils/telegram.js

/* eslint-disable no-useless-escape */
const pool = require("../db");
const axios = require("axios");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : "";
const SITE = (process.env.SITE_PUBLIC_URL || "").replace(/\/+$/, "");
const enabled = !!BOT_TOKEN;
// Админские чаты (можно передать один id или список через запятую/пробел)
const ADMIN_CHAT_IDS =
  (process.env.ADMIN_TG_CHAT_IDS || process.env.ADMIN_TG_CHAT || "")
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

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
    const res = await axios.post(`${API}/sendMessage`, payload);
    if (!res?.data?.ok) {
      console.error("[tg] sendMessage not ok:", res?.data);
    }
    return Boolean(res?.data?.ok);
  } catch (e) {
    console.error("[tg] sendMessage error:", e?.response?.data || e?.message || e);
    return false;
  }
}

async function tgAnswerCallbackQuery(cbQueryId, text, opts = {}) {
  if (!enabled || !cbQueryId) return;
  try {
    await axios.post(`${API}/answerCallbackQuery`, {
      callback_query_id: cbQueryId,
      text,
      show_alert: Boolean(opts.show_alert),
    });
  } catch (e) {
    console.error("[tg] answerCallbackQuery error:", e?.response?.data || e?.message || e);
  }
}

async function tgEditMessageReplyMarkup({ chat_id, message_id, reply_markup }) {
  if (!enabled || !chat_id || !message_id) return;
  try {
    await axios.post(`${API}/editMessageReplyMarkup`, {
      chat_id,
      message_id,
      reply_markup,
    });
  } catch (e) {
    console.error("[tg] editMessageReplyMarkup error:", e?.response?.data || e?.message || e);
  }
}

/* ===== LEADS: клавиатуры (назначение и статусы) ===== */
function buildLeadKB({ state = "new", id, phone, adminUrl, assigneeName }) {
  const digits = (phone || "").replace(/[^\d+]/g, "");
  const wa = digits ? `https://wa.me/${digits.replace(/^\+/, "")}` : null;
  const contactRow = [
    ...(digits ? [{ text: "Позвонить", url: `tel:${digits}` }] : []),
    ...(wa ? [{ text: "WhatsApp", url: wa }] : []),
  ];
  const adminRow = adminUrl ? [{ text: "Админка: Лиды", url: adminUrl }] : [];
  const assignRow = assigneeName
    ? [{ text: `👤 Ответственный: ${assigneeName}`, callback_data: `noop:${id}` },
       { text: "↩️ Снять", callback_data: `lead:${id}:unassign` }]
    : [{ text: "👤 Назначить мне", callback_data: `lead:${id}:assign:self` }];

  if (state === "working") {
    return {
      inline_keyboard: [
        [{ text: "✅ Принято в работу", callback_data: `noop:${id}` }],
        assignRow,
        contactRow.length ? contactRow : undefined,
        adminRow.length ? adminRow : undefined,
      ].filter(Boolean),
    };
  }
  if (state === "closed") {
    return {
      inline_keyboard: [
        [{ text: "✅ Закрыт (готово)", callback_data: `noop:${id}` }],
        assignRow,
        contactRow.length ? contactRow : undefined,
        adminRow.length ? adminRow : undefined,
      ].filter(Boolean),
    };
  }
  return {
    inline_keyboard: [
      [
        { text: "🟦 В работу", callback_data: `lead:${id}:working` },
        { text: "✅ Закрыт",   callback_data: `lead:${id}:closed`  },
      ],
      assignRow,
      contactRow.length ? contactRow : undefined,
      adminRow.length ? adminRow : undefined,
    ].filter(Boolean),
  };
}

// very small cache to avoid frequent getChat calls
const __chatUserCache = new Map(); // chatId -> username (without @)
async function tgGetUsername(chatId) {
  if (!enabled || !chatId) return "";
  if (__chatUserCache.has(chatId)) return __chatUserCache.get(chatId) || "";
  try {
    const res = await axios.post(`${API}/getChat`, { chat_id: chatId });
    const uname = res?.data?.result?.username || "";
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
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/\n/g, "\n");
}

function urlProvider(path) {
  if (!SITE) return "";
  const slug = String(path || "").replace(/^\/+/, "");
  return `${SITE}/dashboard/${slug}`;
}
function urlClient(path) {
  if (!SITE) return "";
  const slug = String(path || "").replace(/^\/+/, "");
  return `${SITE}/client/${slug}`;
}

function urlAdmin(path) {
  if (!SITE) return "";
  const slug = String(path || "").replace(/^\/+/, "");
  // по умолчанию открываем очередь модерации
  return `${SITE}/admin/${slug || "moderation"}`;
}

/** format dates like 12–14 Sep 2025 */
function fmtDates(arr) {
  try {
    const dates = Array.isArray(arr) ? arr : [];
    if (!dates.length) return "—";
    const [a, b] = [dates[0], dates[dates.length - 1]];
    const d1 = new Date(a);
    const d2 = new Date(b);
    const sameMonth = d1.getUTCFullYear() === d2.getUTCFullYear() && d1.getUTCMonth() === d2.getUTCMonth();
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const pad = (n) => String(n).padStart(2, "0");
    const dd1 = pad(d1.getUTCDate());
    const dd2 = pad(d2.getUTCDate());
    const mm1 = monthNames[d1.getUTCMonth()];
    const mm2 = monthNames[d2.getUTCMonth()];
    const YYYY = d2.getUTCFullYear();
    return sameMonth ? `${dd1}–${dd2} ${mm2} ${YYYY}` : `${dd1} ${mm1} – ${dd2} ${mm2} ${YYYY}`;
  } catch {
    return "";
  }
}

function lineContact(emoji, label, name, phone, username) {
  const parts = [];
  if (name) parts.push(`<b>${esc(name)}</b>`);
  if (phone) parts.push(esc(phone));
  if (username) parts.push(`@${String(username).replace(/^@/, "")}`);
  const val = parts.length ? parts.join(" · ") : "—";
  return `${emoji} ${esc(label)}: ${val}`;
}

/* ================== LINK CHAT IDS ================== */
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
      b.id, COALESCE(b.status,'') AS status,
      -- даты из booking_dates, с запасным кейсом на b.date
      COALESCE(
        (SELECT array_agg(d.date::date ORDER BY d.date)
           FROM booking_dates d
          WHERE d.booking_id = b.id),
        CASE WHEN b.date IS NULL THEN ARRAY[]::date[] ELSE ARRAY[b.date::date] END
      ) AS dates,

      b.provider_id, b.client_id, b.requester_provider_id,

      s.id AS service_id, s.title AS service_title,

      -- основной провайдер (исполнитель)
      p.id   AS provider__id,
      p.name AS provider__name,
      p.phone AS provider__phone,
      p.telegram_chat_id AS provider__chat,

      -- исходный клиент
      c.id   AS client__id,
      c.name AS client__name,
      c.phone AS client__phone,
      c.telegram_chat_id AS client__chat,

      -- агент-заявитель (если колонка requester_provider_id есть — ок; если нет, запрос всё равно не упадёт)
      p2.id   AS agent__id,
      p2.name AS agent__name,
      p2.phone AS agent__phone,
      p2.telegram_chat_id AS agent__chat
    FROM bookings b
    LEFT JOIN services  s ON s.id = b.service_id
    LEFT JOIN providers p ON p.id = b.provider_id
    LEFT JOIN clients   c ON c.id = b.client_id
    LEFT JOIN providers p2 ON p2.id = b.requester_provider_id
    WHERE b.id = $1
    LIMIT 1
    `,
    [bookingId]
  );
  if (!q.rowCount) return null;
  const row = q.rows[0];

  const [unameProv, unameClient, unameAgent] = await Promise.all([
    tgGetUsername(row.provider__chat),
    tgGetUsername(row.client__chat),
    tgGetUsername(row.agent__chat),
  ]);

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


/** Подтянуть максимум данных по inbox-заявке */
async function getRequestActors(requestId) {
  const q = await pool.query(
    `
    SELECT
      r.id,
      COALESCE(r.status,'new') AS status,
      r.note, r.created_at,
      r.service_id,
      s.title AS service_title,
      s.provider_id AS to_provider_id,

      -- исходный клиент (может быть настоящий клиент)
      c.id    AS client_id,
      c.name  AS client_name,
      c.phone AS client_phone,
      c.telegram_chat_id AS client_chat,

      -- «клиент» может оказаться провайдером (агентом): матчим по email/phone
      p2.id    AS agent_id,
      p2.name  AS agent_name,
      p2.phone AS agent_phone,
      p2.telegram_chat_id AS agent_chat,

      -- провайдер, которому адресована заявка
      p.id AS provider_id,
      p.telegram_chat_id AS provider_chat
    FROM requests r
    LEFT JOIN services  s ON s.id = r.service_id
    LEFT JOIN clients   c ON c.id = r.client_id
    LEFT JOIN providers p ON p.id  = s.provider_id
    LEFT JOIN providers p2 ON (
      p2.email IS NOT DISTINCT FROM c.email
      OR p2.phone IS NOT DISTINCT FROM c.phone
    )
    WHERE r.id = $1
    LIMIT 1
    `,
    [requestId]
  );
  if (!q.rowCount) return null;
  const row = q.rows[0];

  const [unameClient, unameAgent] = await Promise.all([
    tgGetUsername(row.client_chat),
    tgGetUsername(row.agent_chat),
  ]);

  const from = row.agent_id
    ? { kind: "agent", id: row.agent_id, name: row.agent_name, phone: row.agent_phone, chatId: row.agent_chat, username: unameAgent }
    : { kind: "client", id: row.client_id, name: row.client_name, phone: row.client_phone, chatId: row.client_chat, username: unameClient };

  return {
    row,
    from,
    toProviderChat: row.provider_chat || null,
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
  } catch (e) {
  console.error("[tg] notify<Имя> failed:", e?.response?.data || e?.message || e);
}

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
  } catch (e) {
  console.error("[tg] notify<Имя> failed:", e?.response?.data || e?.message || e);
}
}

/** Подтверждение → обеим сторонам (и агенту, если есть) */
async function notifyConfirmed({ booking }) {
  try {
    const a = await getBookingActors(booking);
    if (!a) return;

    // Базовые строки (общие для всех получателей)
    const base = [];
    base.push(`<b>✅ Бронь подтверждена №${a.id}</b>`);
    if (a.serviceTitle) base.push(`🏷️ Услуга: <b>${esc(a.serviceTitle)}</b>`);
    base.push(`📅 Даты: <b>${fmtDates(a.dates)}</b>`);

    // Кто заявитель (как в ноти о новой заявке)
    const applicantLines = [];
    if (a.agent) {
      applicantLines.push(
        lineContact("🧑‍💼", "Агент",  a.agent.name,  a.agent.phone,  a.agent.username)
      );
      if (a.client?.name || a.client?.phone || a.client?.username) {
        applicantLines.push(
          lineContact("👤", "Клиент", a.client.name, a.client.phone, a.client.username)
        );
      }
    } else {
      applicantLines.push(
        lineContact("👤", "Клиент", a.client?.name, a.client?.phone, a.client?.username)
      );
    }

    // Текст для провайдера (и для агента, если он есть): показываем заявителя
    const textForProvider = [...base, ...applicantLines, "", `🔗 Открыть: ${urlProvider("bookings")}`].join("\n");
    const textForAgent    = textForProvider;

    // Текст для клиента: полезнее показать контакт поставщика
    const textForClient   = [
      ...base,
      lineContact("🏢", "Поставщик", a.provider?.name, a.provider?.phone, a.provider?.username),
      "",
      `🔗 Открыть: ${urlClient("bookings")}`
    ].join("\n");

    if (a.client?.chatId)   { await tgSend(a.client.chatId,   textForClient); }
    if (a.provider?.chatId) { await tgSend(a.provider.chatId, textForProvider); }
    if (a.agent?.chatId)    { await tgSend(a.agent.chatId,    textForAgent); }
  } catch (e) {
    console.error("[tg] notifyConfirmed failed:", e?.response?.data || e?.message || e);
  }
}

/** Отклонение → заявителю (клиенту или агенту) */
/** Отклонение → заявителю (клиенту или агенту) + показываем, КТО поставщик */
async function notifyRejected({ booking, reason }) {
  try {
    const a = await getBookingActors(booking);
    if (!a) return;

    // кому шлём: если есть агент-заявитель → ему, иначе клиенту
    const dest = a.agent?.chatId
      ? { chatId: a.agent.chatId, isProv: true }   // заявитель — провайдер (агент)
      : { chatId: a.client?.chatId, isProv: false }; // заявитель — клиент

    if (!dest.chatId) return;

    const lines = [];
    lines.push(`<b>❌ Бронь отклонена №${a.id}</b>`);
    if (a.serviceTitle) lines.push(`🏷️ Услуга: <b>${esc(a.serviceTitle)}</b>`);
    lines.push(`📅 Даты: <b>${fmtDates(a.dates)}</b>`);
    if (reason) lines.push(`📝 Причина: ${esc(reason)}`);

    // ⬇️ добавили подробный блок про Поставщика для получателя (клиента/агента)
    lines.push(
      lineContact("🏢", "Поставщик", a.provider?.name, a.provider?.phone, a.provider?.username)
    );

    lines.push("");
    lines.push(`🔗 Открыть: ${dest.isProv ? urlProvider("bookings") : urlClient("bookings")}`);

    await tgSend(dest.chatId, lines.join("\n"));
  } catch (e) {
    console.error("[tg] notifyRejected failed:", e?.response?.data || e?.message || e);
  }
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
  } catch (e) {
  console.error("[tg] notify<Имя> failed:", e?.response?.data || e?.message || e);
}

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
  } catch (e) {
  console.error("[tg] notify<Имя> failed:", e?.response?.data || e?.message || e);
}

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
  } catch (e) {
  console.error("[tg] notify<Имя> failed:", e?.response?.data || e?.message || e);
}

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
  } catch (e) {
  console.error("[tg] notify<Имя> failed:", e?.response?.data || e?.message || e);
}

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
  } catch (e) {
  console.error("[tg] notify<Имя> failed:", e?.response?.data || e?.message || e);
}

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
  } catch (e) {
  console.error("[tg] notify<Имя> failed:", e?.response?.data || e?.message || e);
}

}

/* ================== LEADS ================== */
function _leadServiceLabel(svc) {
  const map = {
    tour: "Туры",
    checkup: "Check-up",
    ayurveda: "Аюрведа",
    treatment: "Лечение",
    b2b: "B2B",
  };
  return map[svc] || (svc ? String(svc) : "—");
}

async function notifyLeadNew({ lead }) {
  try {
    if (!lead) return;

    const lines = [];
    lines.push(`<b>🔔 Новый лид</b>`);
    lines.push(`🏷️ Сервис: <b>${esc(_leadServiceLabel(lead.service))}</b>`);
    if (lead.page)   lines.push(`🧭 Страница: ${esc(lead.page)}`);
    if (lead.lang)   lines.push(`🌐 Язык: ${esc(lead.lang)}`);

    // контакты
    const who = [];
    if (lead.name)  who.push(`<b>${esc(lead.name)}</b>`);
    if (lead.phone) who.push(esc(lead.phone));
    lines.push(`👤 Контакт: ${who.length ? who.join(" · ") : "—"}`);

    if (lead.city)        lines.push(`📍 Город/даты: ${esc(lead.city)}`);
    if (lead.pax != null) lines.push(`👥 Кол-во: <b>${esc(String(lead.pax))}</b>`);
    if (lead.comment)     lines.push(`📝 Комментарий: ${esc(lead.comment)}`);

    lines.push("");
    lines.push(`🔗 Открыть: ${urlAdmin("leads")}`);

    const text = lines.join("\n");

    // клавиатура state=new (ответственный ещё не выбран)
    const reply_markup = buildLeadKB({
      state: "new",
      id: lead.id,
      phone: lead.phone,
      adminUrl: urlAdmin("leads"),
      assigneeName: null,
    });

    const ids = await getAdminChatIds();
    await Promise.all(ids.map((chatId) => tgSend(chatId, text, { reply_markup })));
  } catch (e) {
    console.error("[tg] notifyLeadNew failed:", e?.message || e);
  }
}

module.exports = {
  enabled,
  tgSend,
  tgAnswerCallbackQuery,
  tgEditMessageReplyMarkup,
  buildLeadKB,
  linkProviderChat,
  linkClientChat,
    // ADMIN / MODERATION:
  notifyModerationNew,
  notifyModerationApproved,
  notifyModerationRejected,
  notifyModerationUnpublished,
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
  // LEADS:
  notifyLeadNew,
};


/* ================== MODERATION (ADMIN) ================== */
async function getAdminChatIds() {
  // 1) из ENV
  const fromEnv = ADMIN_CHAT_IDS.map((v) => (Number(v) || v)).filter(Boolean);
  // 2) из БД (провайдеры с админскими флагами/ролями)
  try {
   const q = await pool.query(`
      SELECT DISTINCT telegram_chat_id
        FROM providers
       WHERE telegram_chat_id IS NOT NULL
         AND (
              is_admin = true
           OR lower(coalesce(role,'')) LIKE '%admin%'
           OR lower(coalesce(role,'')) LIKE '%moderator%'
         )
    `);
    const db = q.rows.map((r) => r.telegram_chat_id).filter(Boolean);
    return [...new Set([...fromEnv, ...db])];
  } catch {
    return [...new Set(fromEnv)];
  }
}

async function _enrichService(svcOrId) {
  if (svcOrId && typeof svcOrId === "object" && svcOrId.id) return svcOrId;
  const id = Number(svcOrId);
  if (!Number.isFinite(id)) return {};
  const q = await pool.query(
    `SELECT s.id, s.title, s.category, s.status, s.details,
            s.provider_id,
            p.name AS provider_name,
            p.type AS provider_type
       FROM services s
  LEFT JOIN providers p ON p.id = s.provider_id
      WHERE s.id = $1
      LIMIT 1`,
    [id]
  );
  return q.rows[0] || {};
}

function _fmtMoney(x) {
  const n = Number(x || 0);
  return new Intl.NumberFormat().format(n);
}

function _serviceLines(s) {
  const lines = [];
  const d = typeof s.details === "object" ? s.details : {};
  lines.push(`🏷️ <b>${esc(s.title || "Услуга")}</b>`);
  if (s.category) lines.push(`📂 Категория: ${esc(s.category)}`);
  if (s.provider_name) {
    const t = s.provider_type ? ` (${esc(s.provider_type)})` : "";
    lines.push(`🏢 Поставщик: <b>${esc(s.provider_name)}</b>${t}`);
  }
  if (d.netPrice != null || d.grossPrice != null) {
    lines.push(`💵 Netto: <b>${_fmtMoney(d.netPrice)}</b> / Gross: <b>${_fmtMoney(d.grossPrice)}</b>`);
  }
  return lines;
}

// i18n-вариант для блоков RU / UZ / EN
function _serviceLinesI18n(s, lang) {
  const d = typeof s.details === "object" ? s.details : {};
  const title = s.title || (lang === "en" ? "Service" : lang === "uz" ? "Xizmat" : "Услуга");
  const labels = {
    ru: { cat: "Категория", supp: "Поставщик", net: "Netto", gross: "Gross" },
    uz: { cat: "Kategoriya", supp: "Ta’minotchi", net: "Netto", gross: "Gross" },
    en: { cat: "Category",  supp: "Supplier",   net: "Net",   gross: "Gross" },
  }[lang] || { cat: "Категория", supp: "Поставщик", net: "Netto", gross: "Gross" };

  const out = [];
  out.push(`🏷️ <b>${esc(title)}</b>`);
  if (s.category) out.push(`📂 ${labels.cat}: ${esc(s.category)}`);
  if (s.provider_name) {
    const t = s.provider_type ? ` (${esc(s.provider_type)})` : "";
    out.push(`🏢 ${labels.supp}: <b>${esc(s.provider_name)}</b>${t}`);
  }
  if (d.netPrice != null || d.grossPrice != null) {
    out.push(`💵 ${labels.net}: <b>${_fmtMoney(d.netPrice)}</b> / ${labels.gross}: <b>${_fmtMoney(d.grossPrice)}</b>`);
  }
  return out;
}

async function _sendToAdmins(text) {
  const ids = await getAdminChatIds();
  await Promise.all(ids.map((id) => tgSend(id, text)));
}

async function notifyModerationNew({ service }) {
  try {
    const s = await _enrichService(service);
    const lines = [
      `<b>🆕 Новая услуга на модерации</b>`,
      ..._serviceLines(s),
      "",
      `🔗 Открыть: ${urlAdmin("moderation")}`,
    ];
    await _sendToAdmins(lines.join("\n"));
  } catch (e) {
    console.error("[tg] notifyModerationNew failed:", e?.message || e);
  }
}

async function notifyModerationApproved({ service }) {
  try {
    const s = await _enrichService(service);
    // 1) автору услуги (RU/UZ/EN) — с переводом лейблов
    const chatId = await getProviderChatId(s.provider_id);
    if (chatId) {
      const textProvider =
        `✅ Услуга одобрена\n${_serviceLinesI18n(s, "ru").join("\n")}\n\n` +
        `✅ Xizmat tasdiqlandi\n${_serviceLinesI18n(s, "uz").join("\n")}\n\n` +
        `✅ Service approved\n${_serviceLinesI18n(s, "en").join("\n")}`;
      await tgSend(chatId, textProvider);
    }
    // 2) как и раньше — уведомим админов (для лога модерации)
    const linesAdmin = [
      `<b>✅ Услуга одобрена</b>`,
      ..._serviceLines(s),
      "",
      `🔗 Модерация: ${urlAdmin("moderation")}`,
    ];
    await _sendToAdmins(linesAdmin.join("\n"));
  } catch (e) {
    console.error("[tg] notifyModerationApproved failed:", e?.message || e);
  }
}

async function notifyModerationRejected({ service, reason }) {
  try {
    const s = await _enrichService(service);
    // 1) автору услуги (RU/UZ/EN) — с переводом лейблов
    const chatId = await getProviderChatId(s.provider_id);
    if (chatId) {
      const reasonLine = reason ? `📝 Причина: ${esc(reason)}` : "";
      const textProvider =
        `❌ Услуга отклонена\n${_serviceLinesI18n(s, "ru").join("\n")}\n${reasonLine}\n\n` +
        `❌ Xizmat rad etildi\n${_serviceLinesI18n(s, "uz").join("\n")}\n${reasonLine}\n\n` +
        `❌ Service rejected\n${_serviceLinesI18n(s, "en").join("\n")}\n${reasonLine}`;
      await tgSend(chatId, textProvider);
    }
    // 2) админам — как и раньше
    const linesAdmin = [
      `<b>❌ Услуга отклонена</b>`,
      ..._serviceLines(s),
      reason ? `📝 Причина: ${esc(reason)}` : "",
      "",
      `🔗 Модерация: ${urlAdmin("moderation")}`,
    ].filter(Boolean);
    await _sendToAdmins(linesAdmin.join("\n"));
  } catch (e) {
    console.error("[tg] notifyModerationRejected failed:", e?.message || e);
  }
}

async function notifyModerationUnpublished({ service }) {
  try {
    const s = await _enrichService(service);
    // 1) автору услуги — уведомление о снятии (RU/UZ/EN) с переводами лейблов
    const chatId = await getProviderChatId(s.provider_id);
    if (chatId) {
      const textProvider =
        `📦 Услуга снята с публикации\n${_serviceLinesI18n(s, "ru").join("\n")}\n\n` +
        `📦 Xizmat nashrdan olindi\n${_serviceLinesI18n(s, "uz").join("\n")}\n\n` +
        `📦 Listing unpublished\n${_serviceLinesI18n(s, "en").join("\n")}`;
      await tgSend(chatId, textProvider);
    }
    // 2) админам — как и раньше
    const linesAdmin = [
      `<b>📦 Услуга снята с публикации</b>`,
      ..._serviceLines(s),
      "",
      `🔗 Модерация: ${urlAdmin("moderation")}`,
    ];
    await _sendToAdmins(linesAdmin.join("\n"));
  } catch (e) {
    console.error("[tg] notifyModerationUnpublished failed:", e?.message || e);
  }
}
