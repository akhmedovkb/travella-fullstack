// backend/routes/telegramRoutes.js
const express = require("express");
const router = express.Router();
const {
   linkProviderChat,
   linkClientChat,
   tgSend,
 } = require("../utils/telegram");

// RU/UZ/EN привет после успешной привязки
const WELCOME_TEXT =
  "Вы подключили бот! Ожидайте сообщения по заявкам!\n" +
  "Botni uladingiz! Arizalar bo‘yicha xabarlarni kuting!\n" +
  "You have connected the bot! Please wait for request notifications!";

const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "devsecret";
// Если при установке вебхука в Telegram вы передавали secret_token,
// можно дополнительно проверить его в заголовке:
const HEADER_TOKEN = process.env.TELEGRAM_WEBHOOK_TOKEN || "";

// --- debug logging: печать один раз при старте
console.log(
  `[tg] routes mounted: /api/telegram/webhook/${SECRET} (header token ${HEADER_TOKEN ? "ON" : "OFF"})`
);

// POST https://<backend>/api/telegram/webhook/<SECRET>
router.post(`/webhook/${SECRET}`, async (req, res) => {
  try {
    // --- debug: базовая информация о запросе (всегда логируем факт попадания)
    const hdr =
      req.get("X-Telegram-Bot-Api-Secret-Token") ||
      req.get("x-telegram-bot-api-secret-token") ||
      "";
    console.log("[tg] webhook hit", {
      path: req.originalUrl,
      hasBody: !!req.body,
      hasHeader: !!hdr,
      headerLen: hdr ? hdr.length : 0,
    });

    // Опциональная проверка секретного заголовка
    if (HEADER_TOKEN && hdr !== HEADER_TOKEN) {
      console.warn("[tg] 403: bad secret token", {
        hasHeader: !!hdr,
        headerLen: hdr ? hdr.length : 0,
      });
      return res.sendStatus(403);
    }

    const update = req.body || {};

    // Нас интересует только текстовое сообщение со /start (покроем edited_message тоже).
    const msg =
      update.message ||
      update.edited_message ||
      update.channel_post ||
      update.edited_channel_post ||
      null;

    if (!msg || !msg.chat) {
      // Telegram ожидает 200, иначе будет ретраить
      return res.sendStatus(200);
    }

    const chatId = msg.chat.id;
    console.log("[tg] message", {
      chatId,
      text: (msg.text || "").slice(0, 60),
    });

    // username иногда приходит в chat.username (для приватных чатов)
    const username = msg.from?.username || msg.chat?.username || null;

    const text = String(msg.text || "").trim();
    // Ищем /start и извлекаем payload после команды.
    // Поддерживаем: "/start", "/start@BotName", пробелы и payload.
    const m = text.match(/^\/start(?:@\S+)?(?:\s+(.+))?$/i);
    const payload = (m && m[1] ? m[1] : "").trim(); // например: "p_123", "c_456", "p-123", "c-456"

    if (m) {
      // Нормализуем вид payload: разделители "_" или "-", регистр не важен.
      const norm = payload.replace(/\s+/g, "").toLowerCase(); // "p_123" | "p-123" | "c_456" | "c-456"
      let providerId = null;
      let clientId = null;

      // p_123 / p-123
      const mp = norm.match(/^p[-_]?(\d+)$/);
      if (mp) providerId = Number(mp[1]);

      // c_456 / c-456
      const mc = norm.match(/^c[-_]?(\d+)$/);
      if (mc) clientId = Number(mc[1]);

      if (Number.isFinite(providerId) && providerId > 0) {
        // В utils/telegram можно принимать (id, chatId) или (id, chatId, username) — не ломает совместимость
        await linkProviderChat(providerId, chatId, username);
       // Мгновенно подтверждаем на трёх языках
       await tgSend(chatId, WELCOME_TEXT);
        return res.json({ ok: true, linked: "provider", id: providerId });
      }

      if (Number.isFinite(clientId) && clientId > 0) {
        await linkClientChat(clientId, chatId, username);
        await tgSend(chatId, WELCOME_TEXT);
        return res.json({ ok: true, linked: "client", id: clientId });
      }

     // Если пришёл /start без payload — просто приветствуем
     await tgSend(chatId, WELCOME_TEXT);
     return res.json({ ok: true, linked: null });
    }

  // Не /start — просто ok (ничего не шлём)
    return res.json({ ok: true });
  } catch (e) {
    // Telegram ждёт 200, чтобы не ретраить. Возвращаем ok.
    console.error("[tg] webhook error:", e?.message || e);
    return res.json({ ok: true });
  }
});

// --- debug endpoint: curl https://<backend>/api/telegram/webhook/<SECRET>/_debug/ping
router.get(`/webhook/${SECRET}/_debug/ping`, (req, res) => {
  console.log("[tg] ping", new Date().toISOString(), { path: req.originalUrl });
  res.json({ ok: true, ts: new Date().toISOString() });
});

module.exports = router;
