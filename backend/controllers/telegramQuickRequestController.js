//backend/controllers/telegramQuickRequestController.js

const pool = require("../db");
const { tgSend } = require("../utils/telegram");

async function sendQuickRequest(req, res) {
  try {
    const { serviceId, chatId, message, username, firstName, lastName } =
      req.body;

    if (!serviceId || !chatId || !message) {
      return res.status(400).json({ error: "missing fields" });
    }

    // 1️⃣ услуга + владелец
    const svc = await pool.query(
      `
      SELECT s.id, s.title, p.id AS provider_id, p.telegram_chat_id
      FROM services s
      JOIN providers p ON p.id = s.provider_id
      WHERE s.id = $1
      LIMIT 1
      `,
      [serviceId]
    );

    if (!svc.rowCount || !svc.rows[0].telegram_chat_id) {
      return res.status(404).json({ error: "provider_not_found" });
    }

    const providerChatId = svc.rows[0].telegram_chat_id;
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

    // 3️⃣ отправка владельцу
    await tgSend(providerChatId, text, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "💬 Ответить клиенту",
              callback_data: `qr:reply:${chatId}:${serviceId}`,
            },
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
