// backend/routes/telegramRoutes.js
const express = require("express");
const router = express.Router();
const { linkProviderChat, linkClientChat /*, tgSend*/ } = require("../utils/telegram");

const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "devsecret";
// Если при установке вебхука в Telegram вы передавали secret_token,
// можно дополнительно проверить его в заголовке:
const HEADER_TOKEN = process.env.TELEGRAM_WEBHOOK_TOKEN || "";

// POST https://<backend>/api/telegram/webhook/<SECRET>
router.post(`/webhook/${SECRET}`, async (req, res) => {
  try {
    // Опциональная проверка секретного заголовка
    if (HEADER_TOKEN) {
      const got =
        req.get("X-Telegram-Bot-Api-Secret-Token") ||
        req.get("x-telegram-bot-api-secret-token");
      if (got !== HEADER_TOKEN) {
        return res.sendStatus(403);
      }
    }

    const update = req.body || {};
    // Нас интересует только текстовое сообщение со /start.
    const msg =
      update.message ||
      update.edited_message ||
      null;

    if (!msg || !msg.chat) {
      return res.sendStatus(200);
    }

    const chatId = msg.chat.id;
    // иногда username может быть в chat.username (для приватных чатов от пользователя)
    const username =
      msg.from?.username ||
      msg.chat?.username ||
      null;

    const text = String(msg.text || "").trim();
    // Ищем /start и извлекаем payload после команды.
    // Поддерживаем: "/start", "/start@BotName", пробелы и payload.
    const m = text.match(/^\/start(?:@\S+)?(?:\s+(.+))?$/i);
    const payload = (m && m[1] ? m[1] : "").trim(); // например: "p_123", "c_456", "p-123", "c-456"

    if (m) {
      // Нормализуем вид payload
      // Разрешим разделители "_" или "-" и регистр не важен.
      const norm = payload.replace(/\s+/g, "").toLowerCase(); // "p_123" | "p-123" | "c_456" | "c-456"
      let providerId = null;
      let clientId = null;

      // p_123 / p-123
      let mp = norm.match(/^p[-_]?(\d+)$/);
      if (mp) providerId = Number(mp[1]);

      // c_456 / c-456
      let mc = norm.match(/^c[-_]?(\d+)$/);
      if (mc) clientId = Number(mc[1]);

      if (Number.isFinite(providerId) && providerId > 0) {
        await linkProviderChat(providerId, chatId, username);
        // При желании можно отправить подтверждение:
        // await tgSend(chatId, "Профиль поставщика привязан. Будете получать уведомления.");
        return res.json({ ok: true });
      }

      if (Number.isFinite(clientId) && clientId > 0) {
        await linkClientChat(clientId, chatId, username);
        // При желании можно отправить подтверждение:
        // await tgSend(chatId, "Профиль клиента привязан. Будете получать уведомления.");
        return res.json({ ok: true });
      }

      // Если пришёл /start без полезной нагрузки — просто ок
      return res.json({ ok: true });
    }

    // необязательный авто-ответ на прочие сообщения:
    // await tgSend(chatId, "Бот подключен. Теперь вы будете получать уведомления.");

    return res.json({ ok: true });
  } catch (e) {
    // Telegram ждёт 200, чтобы не ретраить. Возвращаем ok.
    return res.json({ ok: true });
  }
});

module.exports = router;
