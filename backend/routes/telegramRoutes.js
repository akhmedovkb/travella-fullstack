// backend/routes/telegramRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

const {
  tgSend,
  tgAnswerCallbackQuery,       // ← убедись, что эти две функции экспортируются из utils/telegram
  tgEditMessageReplyMarkup,
  linkProviderChat,
  linkClientChat,
  buildLeadKB,
} = require("../utils/telegram");

// ---------- ENV / секреты ----------
const SECRET_PATH = process.env.TELEGRAM_WEBHOOK_SECRET || "devsecret"; // для URL /webhook/<SECRET>
const HEADER_TOKEN = process.env.TELEGRAM_WEBHOOK_TOKEN || "";          // если задашь при setWebhook: secret_token=...
console.log(
  `[tg] routes mounted: /api/telegram/webhook/${SECRET_PATH} (header token ${HEADER_TOKEN ? "ON" : "OFF"})`
);

// RU/UZ/EN привет после привязки
const WELCOME_TEXT =
  "Вы подключили бот! Ожидайте сообщения по заявкам!\n" +
  "Botni uladingiz! Arizalar bo‘yicha xabarlarni kuting!\n" +
  "You have connected the bot! Please wait for request notifications!";

// ---------- Общая проверка секрета (path || query || header) ----------
function verifySecret(req) {
  // 1) header token (если задавали secret_token при setWebhook)
  const hdr =
    req.get("X-Telegram-Bot-Api-Secret-Token") ||
    req.get("x-telegram-bot-api-secret-token") ||
    "";
  if (HEADER_TOKEN && hdr === HEADER_TOKEN) return true;

  // 2) path /webhook/<SECRET>
  if (req.params && req.params.secret && req.params.secret === SECRET_PATH) return true;

  // 3) query ?secret=<SECRET>
  const q = req.query || {};
  if (q.secret && q.secret === SECRET_PATH) return true;

  return false;
}

// ---------- Универсальный хэндлер webhook (объединяем всё) ----------
async function handleWebhook(req, res) {
  try {
    // Telegram ждёт 200 всегда; логируем попадание
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

    if (!verifySecret(req)) {
      console.warn("[tg] 403: bad secret");
      return res.sendStatus(403);
    }

    const update = req.body || {};

    // 1) Нажатие inline-кнопки статуса лида
    if (update.callback_query) {
      const cq = update.callback_query;
      const data = String(cq.data || "");
      if (/^noop:\d+$/.test(data)) {
        await tgAnswerCallbackQuery(cq.id, "Готово ✅");
        return res.json({ ok: true });
      }
      /* --- Назначение/снятие ответственного --- */
      let mAssign = data.match(/^lead:(\d+):assign:self$/);
      let mUn = data.match(/^lead:(\d+):unassign$/);
      if (mAssign || mUn) {
        const leadId = Number((mAssign || mUn)[1]);
        // кто нажал кнопку: попробуем найти его провайдера по telegram_chat_id
        const who = cq.from?.id;
        let prov = null;
        try {
          const r = await pool.query(
            `SELECT id, name FROM providers WHERE telegram_chat_id = $1 LIMIT 1`,
            [who]
          );
          prov = r.rows[0] || null;
        } catch {}
        if (!prov && mAssign) {
          await tgAnswerCallbackQuery(cq.id, "Привяжите бота к профилю провайдера (/start p_<id>)", { show_alert: true });
          return res.json({ ok: true });
        }
        await pool.query(
          `UPDATE leads SET assignee_provider_id = $2 WHERE id = $1`,
          [leadId, mUn ? null : prov.id]
        );
        await tgAnswerCallbackQuery(cq.id, mUn ? "Ответственный снят" : `Назначено: ${prov.name}`);

        // подтянем телефон и текущее состояние статуса для клавиатуры
        const row = (await pool.query(
          `SELECT phone, status FROM leads WHERE id = $1`,
          [leadId]
        )).rows[0] || {};
        const kb = buildLeadKB({
          state: row.status || "new",
          id: leadId,
          phone: row.phone || "",
          adminUrl: `${(process.env.SITE_PUBLIC_URL || "").replace(/\/+$/,"")}/admin/leads`,
          assigneeName: mUn ? null : prov.name,
        });
        await tgEditMessageReplyMarkup({
          chat_id: cq.message.chat.id,
          message_id: cq.message.message_id,
          reply_markup: kb,
        });
        return res.json({ ok: true });
      }

      /* --- Смена статуса --- */
      const m = data.match(/^lead:(\d+):(working|closed)$/);
      if (!m) {
        await tgAnswerCallbackQuery(cq.id, "Неизвестное действие");
        return res.json({ ok: true });
      }
      const leadId = Number(m[1]);
      const newStatus = m[2];

      await pool.query(`UPDATE leads SET status = $2 WHERE id = $1`, [leadId, newStatus]);
      await tgAnswerCallbackQuery(
        cq.id,
        newStatus === "working" ? `Лид #${leadId} взят в работу` : `Лид #${leadId} закрыт`
      );

      // подтянем телефон и имя ответственного
      let phone = "", assigneeName = null;
      try {
        const r = await pool.query(
          `SELECT l.phone, p.name AS assignee_name
             FROM leads l
        LEFT JOIN providers p ON p.id = l.assignee_provider_id
            WHERE l.id=$1 LIMIT 1`,
          [leadId]
        );
        phone = r.rows[0]?.phone || "";
        assigneeName = r.rows[0]?.assignee_name || null;
      } catch {}

      // заменяем клавиатуру на «итоговую» (одна инертная кнопка + контакты + админка)
      const kb = buildLeadKB({
        state: newStatus,
        id: leadId,
        phone,
        adminUrl: `${(process.env.SITE_PUBLIC_URL || "").replace(/\/+$/,"")}/admin/leads`,
        assigneeName,
      });

      await tgEditMessageReplyMarkup({
        chat_id: cq.message.chat.id,
        message_id: cq.message.message_id,
        reply_markup: kb,
      });

      return res.json({ ok: true });
    }

    // 2) Сообщение /start (линковка чатов провайдера/клиента)
    const msg =
      update.message ||
      update.edited_message ||
      update.channel_post ||
      update.edited_channel_post ||
      null;

    if (msg && msg.chat) {
      const chatId = msg.chat.id;
      const username = msg.from?.username || msg.chat?.username || null;
      const text = String(msg.text || "").trim();

      const mStart = text.match(/^\/start(?:@\S+)?(?:\s+(.+))?$/i);
      const payload = (mStart && mStart[1] ? mStart[1] : "").trim();

      if (mStart) {
        const norm = payload.replace(/\s+/g, "").toLowerCase(); // "p_123" | "p-123" | "c_456" | "c-456"
        let providerId = null;
        let clientId = null;
        const mp = norm.match(/^p[-_]?(\d+)$/);
        const mc = norm.match(/^c[-_]?(\d+)$/);
        if (mp) providerId = Number(mp[1]);
        if (mc) clientId = Number(mc[1]);

        if (Number.isFinite(providerId) && providerId > 0) {
          await linkProviderChat(providerId, chatId, username);
          await tgSend(chatId, WELCOME_TEXT);
          return res.json({ ok: true, linked: "provider", id: providerId });
        }
        if (Number.isFinite(clientId) && clientId > 0) {
          await linkClientChat(clientId, chatId, username);
          await tgSend(chatId, WELCOME_TEXT);
          return res.json({ ok: true, linked: "client", id: clientId });
        }

        await tgSend(chatId, WELCOME_TEXT);
        return res.json({ ok: true, linked: null });
      }
    }

    // 3) Остальные апдейты — ок
    return res.json({ ok: true });
  } catch (e) {
    console.error("[tg] webhook error:", e?.message || e);
    // Возвращаем 200, чтобы Telegram не ретраил бесконечно
    return res.json({ ok: true });
  }
}

// ---------- Маршруты (поддерживаем и path-секрет, и query-секрет) ----------
router.post("/webhook/:secret", handleWebhook); // /api/telegram/webhook/<SECRET>
router.post("/webhook", handleWebhook);         // /api/telegram/webhook?secret=...

// debug ping
router.get("/webhook/:secret/_debug/ping", (req, res) => {
  if (!verifySecret(req)) return res.sendStatus(403);
  console.log("[tg] ping", new Date().toISOString(), { path: req.originalUrl });
  res.json({ ok: true, ts: new Date().toISOString() });
});

/**
 * Утилита для установки webhook через браузер:
 * GET /api/telegram/setWebhook?secret=<same_as_ENV>&useHeader=1
 * - если useHeader=1 — добавит secret_token (HEADER_TOKEN) в Webhook (Bot API будет класть его в заголовок)
 * - URL берётся из API_BASE_URL или SITE_API_URL
 */
router.get("/setWebhook", async (req, res) => {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN || "";
    if (!token) return res.status(500).json({ ok: false, error: "token_missing" });

    const base = (process.env.API_BASE_URL || process.env.SITE_API_URL || "").replace(/\/+$/, "");
    if (!base) return res.status(500).json({ ok: false, error: "api_base_missing" });

    const secret = req.query.secret || SECRET_PATH;
    const useHeader = String(req.query.useHeader || "0") === "1";

    // по умолчанию используем query-секрет
    const url = `${base}/api/telegram/webhook?secret=${encodeURIComponent(secret)}`;

    const axios = (await import("axios")).default;
    const payload = { url };
    if (useHeader && HEADER_TOKEN) payload.secret_token = HEADER_TOKEN;

    const resp = await axios.post(`https://api.telegram.org/bot${token}/setWebhook`, payload);
    res.json(resp.data);
  } catch (e) {
    console.error("setWebhook error:", e?.response?.data || e?.message || e);
    res.status(500).json({ ok: false, error: "set_webhook_failed" });
  }
});

module.exports = router;
