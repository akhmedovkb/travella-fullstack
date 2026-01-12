//backend/controllers/telegramQuickRequestController.js

const pool = require("../db");
const { tgSend } = require("../utils/telegram");
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
    const providerChatId =
      row.telegram_refused_chat_id ||
      row.telegram_web_chat_id ||
      row.telegram_chat_id;

    if (!providerChatId) {
      return res.status(404).json({ error: "provider_chat_not_linked" });
    }
    const title = svc.rows[0].title || "Без названия";

    // 2️⃣ текст владельцу
    const text =
      `🆕 *Быстрый запрос по услуге*\n\n` +
      `📦 Услуга: *${title}*\n` +
      `🆔 ID: ${serviceId}\n\n` +
      `👤 От: ${firstName || ""} ${lastName || ""}` +
      (username ? ` (@${username})` : "") +
      `\n\n` +
      `💬 Сообщение:\n${message}`;

        // 2️⃣ сохранить запрос
    const ins = await pool.query(
      `INSERT INTO telegram_quick_requests
       (service_id, provider_id, provider_chat_id, requester_chat_id, message)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id`,
      [serviceId, row.provider_id, providerChatId, chatId, message]
    );
    const requestId = ins.rows[0].id;

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
