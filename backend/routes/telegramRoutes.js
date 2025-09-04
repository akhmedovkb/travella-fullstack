// backend/routes/telegramRoutes.js
const express = require("express");
const router = express.Router();
const { linkProviderChat, linkClientChat } = require("../utils/telegram");

const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "devsecret";

// https://<backend>/api/telegram/webhook/<SECRET>
router.post(`/webhook/${SECRET}`, async (req, res) => {
  try {
    const update = req.body;
    const msg = update?.message || update?.edited_message;
    if (!msg || !msg.chat) return res.sendStatus(200);

    const chatId = msg.chat.id;
    const username = msg.from?.username || null;
    const txt = String(msg.text || "").trim();

    // ожидаем deep-link payload в /start
    // формируем ссылку вида: https://t.me/<bot>?start=p_123  или  c_456
    if (/^\/start\b/.test(txt)) {
      const payload = txt.split(" ").slice(1).join(" ").trim(); // p_123, c_456
      if (/^p_\d+$/.test(payload)) {
        const providerId = Number(payload.split("_")[1]);
        await linkProviderChat(providerId, chatId, username);
        return res.json({ ok: true });
      }
      if (/^c_\d+$/.test(payload)) {
        const clientId = Number(payload.split("_")[1]);
        await linkClientChat(clientId, chatId, username);
        return res.json({ ok: true });
      }
    }

    // ответить чем-то дружелюбным
    // (не обязательно)
    // await tgSend(chatId, "Бот подключен. Теперь вы будете получать уведомления.");

    return res.json({ ok: true });
  } catch (e) {
    return res.json({ ok: true });
  }
});

module.exports = router;
