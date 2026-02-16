// backend/utils/telegram.js

/* eslint-disable no-useless-escape */
const pool = require("../db");
const axios = require("axios");

// старый (основной) бот — ВСЕ callback/edit/getChat по нему ДЛЯ СТАРЫХ СЦЕНАРИЕВ
const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();

// новый клиентский бот (отказные)
const CLIENT_BOT_TOKEN = (process.env.TELEGRAM_CLIENT_BOT_TOKEN || "").trim();

const SITE = (process.env.SITE_PUBLIC_URL || "").replace(/\/+$/, "");

// enabled — это “включён ли основной бот”
const enabled = !!BOT_TOKEN;

// enabledOld = включён старый бот
const enabledOld = !!BOT_TOKEN;

// enabledClient = включён новый (отказной) бот
const enabledClient = !!CLIENT_BOT_TOKEN;

// Админские чаты (можно передать один id или список через запятую/пробел)
const ADMIN_CHAT_IDS =
  (process.env.ADMIN_TG_CHAT_IDS ||
    process.env.ADMIN_TG_CHAT ||
    process.env.TELEGRAM_ADMIN_CHAT_IDS ||
    process.env.TELEGRAM_ADMIN_CHAT ||
    "")
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/* ================== low-level helpers ================== */

function _tgApiByToken(token) {
  const t = String(token || "").trim();
  return t ? `https://api.telegram.org/bot${t}` : "";
}

/**
 * tgSend:
 * - по умолчанию шлёт через старого бота (TELEGRAM_BOT_TOKEN)
 * - можно передать tokenOverride (4-й аргумент), чтобы слать через другой токен (например, новый бот)
 * Это НЕ ломает существующие вызовы.
 */
async function tgSend(chatId, text, extra = {}, tokenOverride = "", throwOnError = false) {
  // Если явно указан tokenOverride — используем его.
  // Иначе пробуем старого бота, а при отсутствии — нового.
  const override = String(tokenOverride || "").trim();
  const primaryToken = override || BOT_TOKEN || CLIENT_BOT_TOKEN;
  const primaryApi = _tgApiByToken(primaryToken);

  // normalize chatId (Telegram accepts number; safer to keep numeric ids)
  const cid =
    typeof chatId === "string" && /^-?\d+$/.test(chatId.trim())
      ? Number(chatId.trim())
      : chatId;

  if (!primaryToken || !primaryApi || !cid || !text) {
    const err = new Error("tgSend: missing token/api/chatId/text");
    if (throwOnError) throw err;
    return false;
  }

  const payload = {
    chat_id: cid,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  };

  const shouldFallbackToClient =
    !override && // fallback делаем только когда токен не задан явно
    Boolean(CLIENT_BOT_TOKEN) &&
    Boolean(BOT_TOKEN) &&
    primaryToken === BOT_TOKEN; // первично шлём старым ботом

  try {
    const res = await axios.post(`${primaryApi}/sendMessage`, payload);
    if (res?.data?.ok) return true;

    console.error("[tg] sendMessage not ok:", res?.data);

    // мягкий fallback на клиент-бота
    if (shouldFallbackToClient) {
      try {
        const api2 = _tgApiByToken(CLIENT_BOT_TOKEN);
        const res2 = await axios.post(`${api2}/sendMessage`, payload);
        if (res2?.data?.ok) return true;
        console.error("[tg] sendMessage (fallback client) not ok:", res2?.data);
      } catch (e2) {
        console.error("[tg] sendMessage (fallback client) error:", e2?.response?.data || e2?.message || e2);
      }
    }

    const err = new Error("tgSend: sendMessage not ok");
    err.details = res?.data;
    if (throwOnError) throw err;
    return false;
  } catch (e) {
    const data = e?.response?.data;
    console.error("[tg] sendMessage error:", data || e?.message || e);

    if (shouldFallbackToClient) {
      const desc = String(data?.description || "");
      const code = Number(data?.error_code || 0);
      const isLikelyBotMismatch =
        code === 400 ||
        code === 401 ||                 // ✅ важно
        code === 403 ||
        /unauthorized/i.test(desc) ||   // ✅ важно
        /chat not found/i.test(desc) ||
        /bot was blocked/i.test(desc) ||
        /forbidden/i.test(desc);

      if (isLikelyBotMismatch) {
        try {
          const api2 = _tgApiByToken(CLIENT_BOT_TOKEN);
          const res2 = await axios.post(`${api2}/sendMessage`, payload);
          if (res2?.data?.ok) return true;
          console.error("[tg] sendMessage (fallback client) not ok:", res2?.data);
        } catch (e2) {
          console.error("[tg] sendMessage (fallback client) error:", e2?.response?.data || e2?.message || e2);
        }
      }
    }

    if (throwOnError) throw e;
    return false;
  }
}

// token-aware: отправка фото (sendPhoto) с caption.
// photo: url | file_id | "tgfile:<file_id>"
async function tgSendPhoto(chatId, photo, caption, opts = {}, tokenOverride = null, throwOnError = false) {
  const token = tokenOverride || BOT_TOKEN || CLIENT_BOT_TOKEN;
  const api = _tgApiByToken(token);

  // normalize chatId
  const cid =
    typeof chatId === "string" && /^-?\d+$/.test(chatId.trim())
      ? Number(chatId.trim())
      : chatId;

  if (!token || !api || !cid) return false;

  const cleanPhoto = String(photo || "").startsWith("tgfile:")
    ? String(photo || "").replace(/^tgfile:/, "").trim()
    : photo;

  const payload = {
    chat_id: cid,
    photo: cleanPhoto,
    caption: String(caption || "").slice(0, 1024),
    parse_mode: opts?.parse_mode || "HTML",
    reply_markup: opts?.reply_markup,
  };

  try {
    const { data } = await axios.post(`${api}/sendPhoto`, payload);
    return data;
  } catch (e) {
    const desc = e?.response?.data?.description || e?.message || String(e);
    console.error("[tg] sendPhoto error:", desc);
    if (throwOnError) throw e;
    return false;
  }
}

// token-aware
async function tgAnswerCallbackQuery(cbQueryId, text, opts = {}, tokenOverride = "") {
  const token = tokenOverride || BOT_TOKEN || CLIENT_BOT_TOKEN;
  const api = _tgApiByToken(token);

  // ВАЖНО: отвечать должен тот бот, который получил callback.
  if (!token || !cbQueryId || !api) return;

  try {
    await axios.post(`${api}/answerCallbackQuery`, {
      callback_query_id: cbQueryId,
      text,
      show_alert: Boolean(opts.show_alert),
    });
  } catch (e) {
    console.error(
      "[tg] answerCallbackQuery error:",
      e?.response?.data || e?.message || e
    );
  }
}

// token-aware
async function tgEditMessageReplyMarkup(
  { chat_id, message_id, reply_markup },
  tokenOverride = ""
) {
  const token = tokenOverride || BOT_TOKEN || CLIENT_BOT_TOKEN;
  const api = _tgApiByToken(token);

  if (!token || !chat_id || !message_id || !api) return;

  try {
    await axios.post(`${api}/editMessageReplyMarkup`, {
      chat_id,
      message_id,
      reply_markup,
    });
  } catch (e) {
    console.error(
      "[tg] editMessageReplyMarkup error:",
      e?.response?.data || e?.message || e
    );
  }
}

/* ================== helpers: phone → WA ================== */
function _toIntlDigitsForWA(phone) {
  // Возвращает только цифры без "+", если длина 10–15 (международный формат). Иначе "".
  const d = String(phone || "").replace(/\D/g, "");
  if (!d) return "";
  // допускаем любые страны: 10–15 цифр
  if (d.length >= 10 && d.length <= 15) return d;
  // допускаем локальный UZ: 9 цифр → добавим код страны
  if (d.length === 9) return `998${d}`;
  // допускаем уже с 998 и 12 цифр
  if (d.startsWith("998") && d.length === 12) return d;
  return "";
}

/* ================== LEADS: клавиатуры (назначение и статусы) ===== */
function buildLeadKB({ state = "new", id, phone, adminUrl, assigneeName }) {
  const intl = _toIntlDigitsForWA(phone);
  const wa = intl ? `https://wa.me/${intl}` : null;
  const contactRow = wa ? [{ text: "WhatsApp", url: wa }] : [];

  const adminRow = adminUrl ? [{ text: "Админка: Лиды", url: adminUrl }] : [];
  const assignRow = assigneeName
    ? [
        {
          text: `👤 Ответственный: ${assigneeName}`,
          callback_data: `noop:${id}`,
        },
        { text: "↩️ Снять", callback_data: `lead:${id}:unassign` },
      ]
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
        { text: "✅ Закрыт", callback_data: `lead:${id}:closed` },
      ],
      assignRow,
      contactRow.length ? contactRow : undefined,
      adminRow.length ? adminRow : undefined,
    ].filter(Boolean),
  };
}

// very small cache to avoid frequent getChat calls
const __chatUserCache = new Map(); // key: token|chatId -> username (without @)

// token-aware
async function tgGetUsername(chatId, tokenOverride = "") {
  const token = tokenOverride || BOT_TOKEN || CLIENT_BOT_TOKEN;
  const api = _tgApiByToken(token);

  if (!token || !chatId || !api) return "";

  const cacheKey = `${token}|${chatId}`;
  if (__chatUserCache.has(cacheKey)) return __chatUserCache.get(cacheKey) || "";

  try {
    const res = await axios.post(`${api}/getChat`, { chat_id: chatId });
    const uname = res?.data?.result?.username || "";
    __chatUserCache.set(cacheKey, uname);
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
    const sameMonth =
      d1.getUTCFullYear() === d2.getUTCFullYear() &&
      d1.getUTCMonth() === d2.getUTCMonth();
    const monthNames = [
      "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec",
    ];
    const pad = (n) => String(n).padStart(2, "0");
    const dd1 = pad(d1.getUTCDate());
    const dd2 = pad(d2.getUTCDate());
    const mm1 = monthNames[d1.getUTCMonth()];
    const mm2 = monthNames[d2.getUTCMonth()];
    const YYYY = d2.getUTCFullYear();
    return sameMonth
      ? `${dd1}–${dd2} ${mm2} ${YYYY}`
      : `${dd1} ${mm1} – ${dd2} ${mm2} ${YYYY}`;
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
  await pool.query(`UPDATE providers SET telegram_chat_id=$2 WHERE id=$1`, [
    providerId,
    chatId,
  ]);
}
async function linkClientChat(clientId, chatId) {
  if (!clientId || !chatId) return;
  await pool.query(`UPDATE clients SET telegram_chat_id=$2 WHERE id=$1`, [
    clientId,
    chatId,
  ]);
}

async function getProviderChatId(providerId) {
  if (!providerId) return null;
  const q = await pool.query(
    `SELECT COALESCE(telegram_web_chat_id, telegram_chat_id) AS chat_id
       FROM providers
      WHERE id=$1`,
    [providerId]
  );
  return q.rows[0]?.chat_id || null;
}

async function getClientChatId(clientId) {
  if (!clientId) return null;
  const q = await pool.query(
    `SELECT telegram_chat_id FROM clients WHERE id=$1`,
    [clientId]
  );
  return q.rows[0]?.telegram_chat_id || null;
}

/* ================== ACTORS HELPERS ================== */

function _isRefusedCategory(category) {
  const c = String(category || "").toLowerCase();
  return (
    c === "refused_tour" ||
    c === "refused_hotel" ||
    c === "refused_flight" ||
    c === "refused_ticket" ||
    c === "refused_event_ticket"
  );
}

function _tokenForRefusedActors(category) {
  // Для refused_* шлём клиенту/агенту новым ботом (если включён), иначе старым.
  return _isRefusedCategory(category) && CLIENT_BOT_TOKEN ? CLIENT_BOT_TOKEN : "";
}

async function getBookingActors(input) {
  const bookingId = typeof input === "object" ? input?.id : input;
  if (!bookingId) return null;

  const q = await pool.query(
    `
    SELECT
      b.id, COALESCE(b.status,'') AS status,
      COALESCE(
        (SELECT array_agg(d.date::date ORDER BY d.date)
           FROM booking_dates d
          WHERE d.booking_id = b.id),
        CASE WHEN b.date IS NULL THEN ARRAY[]::date[] ELSE ARRAY[b.date::date] END
      ) AS dates,

      b.provider_id, b.client_id, b.requester_provider_id,

      s.id AS service_id, s.title AS service_title, s.category AS service_category,

      p.id   AS provider__id,
      p.name AS provider__name,
      p.phone AS provider__phone,
      COALESCE(p.telegram_web_chat_id, p.telegram_chat_id) AS provider__chat,

      c.id   AS client__id,
      c.name AS client__name,
      c.phone AS client__phone,
      c.telegram_chat_id AS client__chat,

      p2.id   AS agent__id,
      p2.name AS agent__name,
      p2.phone AS agent__phone,
      COALESCE(p2.telegram_web_chat_id, p2.telegram_chat_id) AS agent__chat
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

  const refusedToken = _tokenForRefusedActors(row.service_category);

  // ✅ ВАЖНО:
  // - провайдера (его кабинет/старые нотифы) — старым ботом
  // - клиента/агента по refused_* — новым ботом (если есть), иначе старым
  const [unameProv, unameClient, unameAgent] = await Promise.all([
    tgGetUsername(row.provider__chat), // всегда старый
    tgGetUsername(row.client__chat, refusedToken),
    tgGetUsername(row.agent__chat, refusedToken),
  ]);

  return {
    id: row.id,
    status: row.status || "",
    dates: row.dates || [],
    serviceTitle: row.service_title || "",
    serviceCategory: row.service_category || "",
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

async function getRequestActors(requestId) {
  const q = await pool.query(
    `
    SELECT
      r.id,
      COALESCE(r.status,'new') AS status,
      r.note, r.created_at,
      r.service_id,
      s.title AS service_title,
      s.category AS service_category,
      s.provider_id AS to_provider_id,

      c.id    AS client_id,
      c.name  AS client_name,
      c.phone AS client_phone,
      c.telegram_chat_id AS client_chat,

      p2.id    AS agent_id,
      p2.name  AS agent_name,
      p2.phone AS agent_phone,
      COALESCE(p2.telegram_web_chat_id, p2.telegram_chat_id) AS agent_chat,

      p.id AS provider_id,
      COALESCE(p.telegram_web_chat_id, p.telegram_chat_id) AS provider_chat
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

  const refusedToken = _tokenForRefusedActors(row.service_category);

  const [unameClient, unameAgent] = await Promise.all([
    tgGetUsername(row.client_chat, refusedToken),
    tgGetUsername(row.agent_chat, refusedToken),
  ]);

  const from = row.agent_id
    ? {
        kind: "agent",
        id: row.agent_id,
        name: row.agent_name,
        phone: row.agent_phone,
        chatId: row.agent_chat,
        username: unameAgent,
      }
    : {
        kind: "client",
        id: row.client_id,
        name: row.client_name,
        phone: row.client_phone,
        chatId: row.client_chat,
        username: unameClient,
      };

  return {
    row,
    from,
    toProviderChat: row.provider_chat || null,
  };
}

/* ================== BOOKINGS ================== */
async function notifyNewRequest({ booking }) {
  try {
    const a = await getBookingActors(booking);
    if (!a?.provider?.chatId) return;

    const title = a.serviceTitle || "Услуга";
    const dates = fmtDates(a.dates);
    const lines = [];

    lines.push(`<b>🆕 Заявка на бронь №${a.id}</b>`);
    lines.push(`🏷️ Услуга: <b>${esc(title)}</b>`);
    lines.push(`📅 Даты: <b>${dates}</b>`);

    if (a.agent) {
      lines.push(
        lineContact("🧑‍💼", "Агент", a.agent.name, a.agent.phone, a.agent.username)
      );
      if (a.client?.name || a.client?.phone || a.client?.username) {
        lines.push(
          lineContact("👤", "Клиент", a.client.name, a.client.phone, a.client.username)
        );
      }
    } else {
      lines.push(
        lineContact("👤", "Клиент", a.client?.name, a.client?.phone, a.client?.username)
      );
    }

    lines.push("");
    lines.push(`🔗 Открыть: ${urlProvider("bookings")}`);

    // провайдеру — всегда через старого бота
    await tgSend(a.provider.chatId, lines.join("\n"));
  } catch (e) {
    console.error("[tg] notifyNewRequest failed:", e?.response?.data || e?.message || e);
  }
}

async function notifyQuote({ booking, price, currency, note }) {
  try {
    const a = await getBookingActors(booking);
    if (!a) return;

    const dest = a.agent?.chatId
      ? { chatId: a.agent.chatId, isProv: true }
      : { chatId: a.client?.chatId, isProv: false };
    if (!dest.chatId) return;

    const lines = [];
    lines.push(`<b>💬 Предложение по брони №${a.id}</b>`);
    if (a.serviceTitle) lines.push(`🏷️ Услуга: <b>${esc(a.serviceTitle)}</b>`);
    lines.push(`📅 Даты: <b>${fmtDates(a.dates)}</b>`);
    lines.push(`💵 Цена: <b>${Number(price) || 0} ${esc(currency || "USD")}</b>`);
    if (note) lines.push(`📝 Комментарий: ${esc(note)}`);

    lines.push(
      lineContact(
        "🏢",
        "Поставщик",
        a.provider?.name,
        a.provider?.phone,
        a.provider?.username
      )
    );

    lines.push("");
    lines.push(
      `🔗 Открыть: ${dest.isProv ? urlProvider("bookings") : urlClient("bookings")}`
    );

    const tokenOverride = _tokenForRefusedActors(a.serviceCategory);
    await tgSend(dest.chatId, lines.join("\n"), {}, tokenOverride);
  } catch (e) {
    console.error("[tg] notifyQuote failed:", e?.response?.data || e?.message || e);
  }
}

async function notifyConfirmed({ booking }) {
  try {
    const a = await getBookingActors(booking);
    if (!a) return;

    const base = [];
    base.push(`<b>✅ Бронь подтверждена №${a.id}</b>`);
    if (a.serviceTitle) base.push(`🏷️ Услуга: <b>${esc(a.serviceTitle)}</b>`);
    base.push(`📅 Даты: <b>${fmtDates(a.dates)}</b>`);

    const applicantLines = [];
    if (a.agent) {
      applicantLines.push(
        lineContact("🧑‍💼", "Агент", a.agent.name, a.agent.phone, a.agent.username)
      );
      if (a.client?.name || a.client?.phone || a.client?.username) {
        applicantLines.push(
          lineContact("👤", "Клиент", a.client.name, a.client.phone, a.client.username)
        );
      }
    } else {
      applicantLines.push(
        lineContact(
          "👤",
          "Клиент",
          a.client?.name,
          a.client?.phone,
          a.client?.username
        )
      );
    }

    const textForProvider = [
      ...base,
      ...applicantLines,
      "",
      `🔗 Открыть: ${urlProvider("bookings")}`,
    ].join("\n");

    const textForClient = [
      ...base,
      lineContact(
        "🏢",
        "Поставщик",
        a.provider?.name,
        a.provider?.phone,
        a.provider?.username
      ),
      "",
      `🔗 Открыть: ${urlClient("bookings")}`,
    ].join("\n");

    // refused_*:
    // - клиент/агент: новый бот (если есть), иначе старый
    // - провайдер: старый
    const tokenOverride = _tokenForRefusedActors(a.serviceCategory);

    if (a.client?.chatId) await tgSend(a.client.chatId, textForClient, {}, tokenOverride);
    if (a.provider?.chatId) await tgSend(a.provider.chatId, textForProvider);
    if (a.agent?.chatId) await tgSend(a.agent.chatId, textForProvider, {}, tokenOverride);
  } catch (e) {
    console.error("[tg] notifyConfirmed failed:", e?.response?.data || e?.message || e);
  }
}

async function notifyRejected({ booking, reason }) {
  try {
    const a = await getBookingActors(booking);
    if (!a) return;

    const dest = a.agent?.chatId
      ? { chatId: a.agent.chatId, isProv: true }
      : { chatId: a.client?.chatId, isProv: false };
    if (!dest.chatId) return;

    const lines = [];
    lines.push(`<b>❌ Бронь отклонена №${a.id}</b>`);
    if (a.serviceTitle) lines.push(`🏷️ Услуга: <b>${esc(a.serviceTitle)}</b>`);
    lines.push(`📅 Даты: <b>${fmtDates(a.dates)}</b>`);
    if (reason) lines.push(`📝 Причина: ${esc(reason)}`);

    lines.push(
      lineContact(
        "🏢",
        "Поставщик",
        a.provider?.name,
        a.provider?.phone,
        a.provider?.username
      )
    );

    lines.push("");
    lines.push(
      `🔗 Открыть: ${dest.isProv ? urlProvider("bookings") : urlClient("bookings")}`
    );

    const tokenOverride = _tokenForRefusedActors(a.serviceCategory);
    await tgSend(dest.chatId, lines.join("\n"), {}, tokenOverride);
  } catch (e) {
    console.error("[tg] notifyRejected failed:", e?.response?.data || e?.message || e);
  }
}

async function notifyCancelled({ booking }) {
  try {
    const a = await getBookingActors(booking);
    if (!a) return;

    const dest = a.agent?.chatId
      ? { chatId: a.agent.chatId, isProv: true }
      : { chatId: a.client?.chatId, isProv: false };
    if (!dest.chatId) return;

    const text =
      `<b>⚠️ Бронь отменена №${a.id}</b>\n` +
      (a.serviceTitle ? `🏷️ Услуга: <b>${esc(a.serviceTitle)}</b>\n` : "") +
      `📅 Даты: <b>${fmtDates(a.dates)}</b>\n\n` +
      `🔗 Открыть: ${dest.isProv ? urlProvider("bookings") : urlClient("bookings")}`;

    const tokenOverride = _tokenForRefusedActors(a.serviceCategory);
    await tgSend(dest.chatId, text, {}, tokenOverride);
  } catch (e) {
    console.error("[tg] notifyCancelled failed:", e?.response?.data || e?.message || e);
  }
}

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
    console.error(
      "[tg] notifyCancelledByRequester failed:",
      e?.response?.data || e?.message || e
    );
  }
}

/* ================== REQUESTS ================== */
async function notifyReqNew({ request_id }) {
  try {
    const a = await getRequestActors(request_id);
    if (!a?.toProviderChat) return;

    const lines = [];
    lines.push(`<b>🆕 Новая заявка №${a.row.id}</b>`);
    if (a.row.service_title)
      lines.push(`🏷️ Услуга: <b>${esc(a.row.service_title)}</b>`);

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
    console.error("[tg] notifyReqNew failed:", e?.response?.data || e?.message || e);
  }
}

async function notifyReqStatusChanged({ request_id, status }) {
  try {
    const a = await getRequestActors(request_id);
    if (!a?.from?.chatId) return;

    const statusMap = {
      processed: "ℹ️ Заявка обработана",
      accepted: "✅ Заявка принята",
      rejected: "❌ Заявка отклонена",
      new: "🆕 Заявка создана",
    };
    const title = statusMap[status] || `ℹ️ Статус: ${status}`;

    const lines = [];
    lines.push(`<b>${title} №${a.row.id}</b>`);
    if (a.row.service_title)
      lines.push(`🏷️ Услуга: <b>${esc(a.row.service_title)}</b>`);
    if (a.row.note) lines.push(`📝 Сообщение: ${esc(a.row.note)}`);

    lines.push("");
    const link = a.from.kind === "agent" ? urlProvider("requests") : urlClient("requests");
    lines.push(`🔗 Открыть: ${link}`);

    const tokenOverride = _tokenForRefusedActors(a.row?.service_category);
    await tgSend(a.from.chatId, lines.join("\n"), {}, tokenOverride);
  } catch (e) {
    console.error(
      "[tg] notifyReqStatusChanged failed:",
      e?.response?.data || e?.message || e
    );
  }
}

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
    console.error(
      "[tg] notifyReqCancelledByRequester failed:",
      e?.response?.data || e?.message || e
    );
  }
}

async function notifyReqDeletedByProvider({ request_id }) {
  try {
    const a = await getRequestActors(request_id);
    if (!a?.from?.chatId) return;

    const link = a.from.kind === "agent" ? urlProvider("requests") : urlClient("requests");
    const text =
      `<b>🗑️ Заявка удалена провайдером №${a.row.id}</b>\n` +
      (a.row.service_title ? `🏷️ Услуга: <b>${esc(a.row.service_title)}</b>\n` : "") +
      `🔗 Открыть: ${link}`;

    const tokenOverride = _tokenForRefusedActors(a.row?.service_category);
    await tgSend(a.from.chatId, text, {}, tokenOverride);
  } catch (e) {
    console.error(
      "[tg] notifyReqDeletedByProvider failed:",
      e?.response?.data || e?.message || e
    );
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
    if (lead.page) lines.push(`🧭 Страница: ${esc(lead.page)}`);
    if (lead.lang) lines.push(`🌐 Язык: ${esc(lead.lang)}`);

    const who = [];
    if (lead.name) who.push(`<b>${esc(lead.name)}</b>`);
    if (lead.phone) who.push(esc(lead.phone));
    lines.push(`👤 Контакт: ${who.length ? who.join(" · ") : "—"}`);

    if (lead.city) lines.push(`📍 Город/даты: ${esc(lead.city)}`);
    if (lead.pax != null) lines.push(`👥 Кол-во: <b>${esc(String(lead.pax))}</b>`);
    if (lead.comment) lines.push(`📝 Комментарий: ${esc(lead.comment)}`);

    lines.push("");
    lines.push(`🔗 Открыть: ${urlAdmin("leads")}`);

    const text = lines.join("\n");

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

/* ================== MODERATION (ADMIN) ================== */
async function getAdminChatIds() {
  const fromEnv = ADMIN_CHAT_IDS.map((v) => Number(v)).filter(Number.isFinite);

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
    lines.push(
      `💵 Netto: <b>${_fmtMoney(d.netPrice)}</b> / Gross: <b>${_fmtMoney(
        d.grossPrice
      )}</b>`
    );
  }
  return lines;
}

function _serviceLinesI18n(s, lang) {
  const d = typeof s.details === "object" ? s.details : {};
  const title =
    s.title || (lang === "en" ? "Service" : lang === "uz" ? "Xizmat" : "Услуга");
  const labels =
    {
      ru: { cat: "Категория", supp: "Поставщик", net: "Netto", gross: "Gross" },
      uz: { cat: "Kategoriya", supp: "Ta’minotchi", net: "Netto", gross: "Gross" },
      en: { cat: "Category", supp: "Supplier", net: "Net", gross: "Gross" },
    }[lang] || { cat: "Категория", supp: "Поставщик", net: "Netto", gross: "Gross" };

  const out = [];
  out.push(`🏷️ <b>${esc(title)}</b>`);
  if (s.category) out.push(`📂 ${labels.cat}: ${esc(s.category)}`);
  if (s.provider_name) {
    const t = s.provider_type ? ` (${esc(s.provider_type)})` : "";
    out.push(`🏢 ${labels.supp}: <b>${esc(s.provider_name)}</b>${t}`);
  }
  if (d.netPrice != null || d.grossPrice != null) {
    out.push(
      `💵 ${labels.net}: <b>${_fmtMoney(d.netPrice)}</b> / ${labels.gross}: <b>${_fmtMoney(
        d.grossPrice
      )}</b>`
    );
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
    const chatId = await getProviderChatId(s.provider_id);
    if (chatId) {
      const textProvider =
        `✅ Услуга одобрена\n${_serviceLinesI18n(s, "ru").join("\n")}\n\n` +
        `✅ Xizmat tasdiqlandi\n${_serviceLinesI18n(s, "uz").join("\n")}\n\n` +
        `✅ Service approved\n${_serviceLinesI18n(s, "en").join("\n")}`;
      
      const tokenOverride = _tokenForRefusedActors(s.category);
      await tgSend(chatId, textProvider, {}, tokenOverride);
    }

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
    const chatId = await getProviderChatId(s.provider_id);
    if (chatId) {
      const reasonLine = reason ? `📝 Причина: ${esc(reason)}` : "";
      const textProvider =
        `❌ Услуга отклонена\n${_serviceLinesI18n(s, "ru").join("\n")}\n${reasonLine}\n\n` +
        `❌ Xizmat rad etildi\n${_serviceLinesI18n(s, "uz").join("\n")}\n${reasonLine}\n\n` +
        `❌ Service rejected\n${_serviceLinesI18n(s, "en").join("\n")}\n${reasonLine}`;
      
      const tokenOverride = _tokenForRefusedActors(s.category);
      await tgSend(chatId, textProvider, {}, tokenOverride);

    }

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
    const chatId = await getProviderChatId(s.provider_id);
    if (chatId) {
      const textProvider =
        `📦 Услуга снята с публикации\n${_serviceLinesI18n(s, "ru").join("\n")}\n\n` +
        `📦 Xizmat nashrdan olindi\n${_serviceLinesI18n(s, "uz").join("\n")}\n\n` +
        `📦 Listing unpublished\n${_serviceLinesI18n(s, "en").join("\n")}`;
      
      const tokenOverride = _tokenForRefusedActors(s.category);
      await tgSend(chatId, textProvider, {}, tokenOverride);

    }

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

/* ====================== ADMIN NOTIFY HELPERS ====================== */
async function tgSendToAdmins(text, extra = {}) {
  const ids = await getAdminChatIds();
  if (!ids.length) return { ok: false, error: "no_admin_chat_ids" };

  const results = await Promise.allSettled(
    ids.map((chatId) => tgSend(chatId, text, extra))
  );

  return { ok: true, count: ids.length, results };
}

/* ====================== HEALTH CHECK ====================== */

function _maskToken(t) {
  if (!t) return "";
  const s = String(t);
  if (s.length <= 10) return "***";
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

async function _tgGetMe(token) {
  if (!token) return { ok: false, error: "missing_token" };
  const api = _tgApiByToken(token);
  if (!api) return { ok: false, error: "missing_api" };

  try {
    // Telegram expects GET for getMe (POST also works, but keep canonical)
    const res = await axios.get(`${api}/getMe`, { timeout: 8000 });
    if (res?.data?.ok) {
      return {
        ok: true,
        username: res.data?.result?.username || "",
        id: res.data?.result?.id || null,
      };
    }
    return { ok: false, error: "not_ok", details: res?.data || null };
  } catch (e) {
    return { ok: false, error: "request_failed", details: e?.response?.data || e?.message || String(e) };
  }
}

/**
 * getTelegramHealth({ probe: boolean })
 * - probe=false: только проверка ENV/конфигурации (без запросов к Telegram)
 * - probe=true : дополнительно делает getMe по каждому токену
 */
async function getTelegramHealth({ probe = false } = {}) {
  const managerChatId =
    process.env.TELEGRAM_MANAGER_CHAT_ID ||
    process.env.TELEGRAM_MANAGER_CHAT ||
    "";

  const out = {
    ok: true,
    ts: new Date().toISOString(),
    env: {
      has_old_bot_token: Boolean(BOT_TOKEN),
      has_client_bot_token: Boolean(CLIENT_BOT_TOKEN),
      old_bot_token_masked: _maskToken(BOT_TOKEN),
      client_bot_token_masked: _maskToken(CLIENT_BOT_TOKEN),
      admin_chat_ids_count: Array.isArray(ADMIN_CHAT_IDS) ? ADMIN_CHAT_IDS.length : 0,
      has_manager_chat_id: Boolean(managerChatId),
      tz: process.env.TZ || "",
    },
    bots: {
      old: { enabled: enabledOld },
      client: { enabled: enabledClient },
    },
  };

  // базовые проверки
  if (!BOT_TOKEN && !CLIENT_BOT_TOKEN) {
    out.ok = false;
    out.error = "no_bot_tokens";
  }

  if (probe) {
    out.bots.old.getMe = await _tgGetMe(BOT_TOKEN);
    out.bots.client.getMe = await _tgGetMe(CLIENT_BOT_TOKEN);

    // если есть токен, но getMe не ок — это важно
    const oldFail = BOT_TOKEN && out.bots.old.getMe && !out.bots.old.getMe.ok;
    const clientFail =
      CLIENT_BOT_TOKEN && out.bots.client.getMe && !out.bots.client.getMe.ok;

    if (oldFail || clientFail) out.ok = false;
  }

  return out;
}

module.exports = {
  enabled,
  tgSend,
  tgSendPhoto,
  tgSendToAdmins,

  // HEALTH:
  getTelegramHealth,

  tgAnswerCallbackQuery,
  tgEditMessageReplyMarkup,
  tgGetUsername,

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
