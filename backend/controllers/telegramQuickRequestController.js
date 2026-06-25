//backend/controllers/telegramQuickRequestController.js

const pool = require("../db");
const { tgSend } = require("../utils/telegram");
const { logProviderFunnelEvent } = require("../utils/providerFunnel");
const { upsertProviderLeadCrm } = require("../utils/providerLeadCrm");
const ANTISPAM_MINUTES = 3;
async function sendQuickRequest(req, res) {
  try {
    const { serviceId, chatId, message, username, firstName, lastName } =
      req.body;

    if (!serviceId || !chatId || !message) {
      return res.status(400).json({ error: "missing fields" });
    }
    
    // 🛑 антиспам: 1 запрос / 3 минуты (service + chat)
    const spam = await pool.query(
      `SELECT created_at
       FROM telegram_quick_requests
       WHERE service_id=$1 AND requester_chat_id=$2
       ORDER BY created_at DESC
       LIMIT 1`,
      [serviceId, chatId]
    );
    if (
      spam.rows[0] &&
      Date.now() - new Date(spam.rows[0].created_at).getTime() <
        ANTISPAM_MINUTES * 60 * 1000
    ) {
      return res.status(429).json({ error: "too_many_requests" });
    }

    // 1️⃣ услуга + владелец
    const svc = await pool.query(
      `
      SELECT 
        s.id,
        s.title,
        s.category,
        s.status,
        s.moderation_status,
        s.expiration_at,
        s.deleted_at,
        p.id AS provider_id,
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

    if (!svc.rowCount) {
      return res.status(404).json({ error: "provider_not_found" });
    }

    const row = svc.rows[0];
    const serviceStatus = String(row.status || "").toLowerCase();
    const moderationStatus = String(row.moderation_status || "approved").toLowerCase();
    const isPublished = ["published", "approved", "active"].includes(serviceStatus);
    const isApproved = ["approved", "published", "active"].includes(moderationStatus || "approved");
    const isExpired = row.expiration_at && new Date(row.expiration_at).getTime() <= Date.now();
    if (row.deleted_at || !isPublished || !isApproved || isExpired) {
      return res.status(404).json({ error: "service_not_available" });
    }

    const providerChatId =
      row.telegram_refused_chat_id ||
      row.telegram_web_chat_id ||
      row.telegram_chat_id;

    if (!providerChatId) {
      return res.status(404).json({ error: "provider_chat_not_linked" });
    }
    const title = svc.rows[0].title || "Без названия";

    // 2️⃣ сохранить запрос (сначала создаём requestId)
    const ins = await pool.query(
      `INSERT INTO telegram_quick_requests
       (service_id, provider_id, provider_chat_id, requester_chat_id, message)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id`,
      [serviceId, row.provider_id, providerChatId, chatId, message]
    );
    const requestId = ins.rows[0].id;

    await logProviderFunnelEvent({
      source: "telegram_quick_request",
      actorRole: "telegram_client",
      actorId: chatId,
      telegramChatId: chatId,
      providerId: row.provider_id,
      serviceId,
      category: row.category,
      eventName: "quick_request_created",
      step: "quick_request",
      status: "created",
      meta: {
        request_id: requestId,
        request_table: "telegram_quick_requests",
        username: username || null,
        first_name: firstName || null,
        last_name: lastName || null,
        has_message: !!message,
      },
    });

    await upsertProviderLeadCrm({
      source: "telegram_request",
      requestTable: "telegram_quick_requests",
      requestId,
      providerId: row.provider_id,
      telegramChatId: chatId,
      serviceId,
      status: "new",
      note: message,
      meta: {
        category: row.category,
        service_title: row.title,
        username: username || null,
        first_name: firstName || null,
        last_name: lastName || null,
      },
    });
    
    // 3️⃣ текст владельцу
    const text =
      `🆕 *Быстрый запрос по услуге*\n\n` +
      `📦 Услуга: *${title}*\n` +
      `🆔 ID: ${serviceId}\n` +
      `🧾 Запрос: #${requestId}\n\n` +
      `👤 От: ${firstName || ""} ${lastName || ""}` +
      (username ? ` (@${username})` : "") +
      `\n\n` +
      `💬 Сообщение:\n${message}`;

    // 3️⃣ отправка владельцу
    await tgSend(providerChatId, text, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "💬 Ответить",
              callback_data: `qr:reply:${requestId}`,
            },
            {
              text: "✅ Принято",
              callback_data: `qr:ack:${requestId}`,
            }
          ],
        ],
      },
    });

    return res.json({ success: true });
  } catch (e) {
    console.error("[quick-request] error:", e);
    return res.status(500).json({ error: "internal_error" });
  }
}

module.exports = { sendQuickRequest };
