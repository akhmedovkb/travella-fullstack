// backend/routes/telegramRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const telegramClientController = require("../controllers/telegramClientController");
const telegramProviderController = require("../controllers/telegramProviderController");

const {
  tgSend,
  tgAnswerCallbackQuery,
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

// Публичный URL сайта (для редиректов относительных путей картинок)
const SITE_PUBLIC_URL = (
  process.env.SITE_PUBLIC_URL ||
  process.env.SITE_URL ||
  ""
).replace(/\/+$/, "");

// ---------- Общая проверка секрета (path || query || header) ----------
function verifySecret(req) {
  const hdr =
    req.get("X-Telegram-Bot-Api-Secret-Token") ||
    req.get("x-telegram-bot-api-secret-token") ||
    "";
  if (HEADER_TOKEN && hdr === HEADER_TOKEN) return true;

  if (req.params && req.params.secret && req.params.secret === SECRET_PATH) return true;

  const q = req.query || {};
  if (q.secret && q.secret === SECRET_PATH) return true;

  return false;
}

// ---------- Универсальный хэндлер webhook (объединяем всё) ----------
async function handleWebhook(req, res) {
  try {
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

    // 1) callback_query для лидов
    if (update.callback_query) {
      const cq = update.callback_query;
      const data = String(cq.data || "");
      if (/^noop:\d+$/.test(data)) {
        await tgAnswerCallbackQuery(cq.id, "Готово ✅");
        return res.json({ ok: true });
      }

      let mAssign = data.match(/^lead:(\d+):assign:self$/);
      let mUn = data.match(/^lead:(\d+):unassign$/);
      if (mAssign || mUn) {
        const leadId = Number((mAssign || mUn)[1]);
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
          await tgAnswerCallbackQuery(
            cq.id,
            "Привяжите бота к профилю провайдера (/start p_<id>)",
            { show_alert: true }
          );
          return res.json({ ok: true });
        }
        await pool.query(
          `UPDATE leads SET assignee_provider_id = $2 WHERE id = $1`,
          [leadId, mUn ? null : prov.id]
        );
        await tgAnswerCallbackQuery(
          cq.id,
          mUn ? "Ответственный снят" : `Назначено: ${prov.name}`
        );

        const row =
          (
            await pool.query(
              `SELECT phone, status FROM leads WHERE id = $1`,
              [leadId]
            )
          ).rows[0] || {};
        const kb = buildLeadKB({
          state: row.status || "new",
          id: leadId,
          phone: row.phone || "",
          adminUrl: `${(process.env.SITE_PUBLIC_URL || "").replace(/\/+$/, "")}/admin/leads`,
          assigneeName: mUn ? null : prov.name,
        });
        await tgEditMessageReplyMarkup({
          chat_id: cq.message.chat.id,
          message_id: cq.message.message_id,
          reply_markup: kb,
        });
        return res.json({ ok: true });
      }

      const m = data.match(/^lead:(\d+):(working|closed)$/);
      if (!m) {
        await tgAnswerCallbackQuery(cq.id, "Неизвестное действие");
        return res.json({ ok: true });
      }
      const leadId = Number(m[1]);
      const newStatus = m[2];

      await pool.query(`UPDATE leads SET status = $2 WHERE id = $1`, [
        leadId,
        newStatus,
      ]);
      await tgAnswerCallbackQuery(
        cq.id,
        newStatus === "working"
          ? `Лид #${leadId} взят в работу`
          : `Лид #${leadId} закрыт`
      );

      let phone = "",
        assigneeName = null;
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

      const kb = buildLeadKB({
        state: newStatus,
        id: leadId,
        phone,
        adminUrl: `${(process.env.SITE_PUBLIC_URL || "").replace(/\/+$/, "")}/admin/leads`,
        assigneeName,
      });

      await tgEditMessageReplyMarkup({
        chat_id: cq.message.chat.id,
        message_id: cq.message.message_id,
        reply_markup: kb,
      });

      return res.json({ ok: true });
    }

    // 2) /start p_<id> / c_<id> для линковки
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
        const norm = payload.replace(/\s+/g, "").toLowerCase();
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

    return res.json({ ok: true });
  } catch (e) {
    console.error("[tg] webhook error:", e?.message || e);
    return res.json({ ok: true });
  }
}

// ---------- Маршруты вебхука ----------
router.post("/webhook/:secret", handleWebhook);
router.post("/webhook", handleWebhook);

// debug ping
router.get("/webhook/:secret/_debug/ping", (req, res) => {
  if (!verifySecret(req)) return res.sendStatus(403);
  console.log("[tg] ping", new Date().toISOString(), { path: req.originalUrl });
  res.json({ ok: true, ts: new Date().toISOString() });
});

/**
 * 🔥 ВРЕМЕННЫЙ РОУТ ДЛЯ КАРТИНОК ИЗ services.images (base64)
 *
 * GET /api/telegram/service-image/:id
 * Находит услугу в таблице services по id, берёт первую запись из images,
 * если это data:image/...;base64,... — декодирует и отдаёт бинарную картинку.
 */
router.get("/service-image/:id", async (req, res) => {
  try {
    const serviceId = Number(req.params.id);
    if (!Number.isFinite(serviceId) || serviceId <= 0) {
      return res.status(400).send("Bad service id");
    }

    const result = await pool.query(
      "SELECT images FROM services WHERE id = $1 LIMIT 1",
      [serviceId]
    );
    if (!result.rows.length) {
      return res.status(404).send("Service not found");
    }

    let images = result.rows[0].images;
    if (!images) {
      return res.status(404).send("No images");
    }

    if (typeof images === "string") {
      try {
        const parsed = JSON.parse(images);
        images = parsed;
      } catch {
        images = [images];
      }
    }

    if (!Array.isArray(images) || !images.length) {
      return res.status(404).send("No images");
    }

    let v = images[0];

    if (v && typeof v === "object") {
      v = v.url || v.src || v.path || v.location || v.href || null;
    }

    if (!v || typeof v !== "string") {
      return res.status(404).send("No valid image");
    }

    v = v.trim();
    if (!v) {
      return res.status(404).send("Empty image");
    }

    // Если уже http/https — можно сделать редирект (на случай если в БД URL)
    if (v.startsWith("http://") || v.startsWith("https://")) {
      return res.redirect(v);
    }

    // Если относительный путь — редиректим на сайт
    if (v.startsWith("/") && SITE_PUBLIC_URL) {
      return res.redirect(SITE_PUBLIC_URL + v);
    }

    // Основной случай: data:image/...;base64,XXXX
    if (!v.startsWith("data:image")) {
      return res.status(400).send("Unsupported image format");
    }

    const m = v.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!m) {
      return res.status(400).send("Invalid data URL format");
    }

    const mimeType = m[1] || "image/jpeg";
    const b64 = m[2];
    let buf;
    try {
      buf = Buffer.from(b64, "base64");
    } catch {
      return res.status(400).send("Invalid base64 data");
    }

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Length", buf.length);
    res.setHeader("Cache-Control", "public, max-age=86400"); // кэшируем на день
    return res.send(buf);
  } catch (e) {
    console.error("[tg] /service-image error:", e?.message || e);
    return res.status(500).send("Internal error");
  }
});

// ----- JSON API для НОВОГО клиентского бота -----

// привязка аккаунта по телефону
router.post("/link", telegramClientController.linkAccount);

// быстрый профиль по chatId
router.get(
  "/profile/:role/:chatId",
  telegramClientController.getProfileByChat
);

// поиск отказных услуг по категории (НОВЫЙ bot)
// GET /api/telegram/client/:chatId/search?category=refused_tour
router.get(
  "/client/:chatId/search",
  telegramClientController.searchClientServices
);

// 🔍 Старый простой поиск по категории (если ещё используется где-то)
// GET /api/telegram/client/:chatId/search-category?type=refused_tour
router.get(
  "/client/:chatId/search-category",
  telegramClientController.searchCategory
);

/**
 * setWebhook утилита (старый бот)
 */
router.get("/setWebhook", async (req, res) => {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN || "";
    if (!token)
      return res.status(500).json({ ok: false, error: "token_missing" });

    const base = (
      process.env.API_BASE_URL || process.env.SITE_API_URL || ""
    ).replace(/\/+$/, "");
    if (!base)
      return res.status(500).json({ ok: false, error: "api_base_missing" });

    const secret = req.query.secret || SECRET_PATH;
    const useHeader = String(req.query.useHeader || "0") === "1";

    const url = `${base}/api/telegram/webhook?secret=${encodeURIComponent(
      secret
    )}`;

    const axios = (await import("axios")).default;
    const payload = { url };
    if (useHeader && HEADER_TOKEN) payload.secret_token = HEADER_TOKEN;

    const resp = await axios.post(
      `https://api.telegram.org/bot${token}/setWebhook`,
      payload
    );
    res.json(resp.data);
  } catch (e) {
    console.error("setWebhook error:", e?.response?.data || e?.message || e);
    res.status(500).json({ ok: false, error: "set_webhook_failed" });
  }
});

// ПАНЕЛЬ ПОСТАВЩИКА
router.get(
  "/provider/:chatId/bookings",
  telegramProviderController.getProviderBookings
);

router.post(
  "/provider/:chatId/bookings/:bookingId/confirm",
  telegramProviderController.confirmBooking
);

router.post(
  "/provider/:chatId/bookings/:bookingId/reject",
  telegramProviderController.rejectBooking
);

// marketplace-услуги поставщика (для нового бота)
router.get(
  "/provider/:chatId/services",
  telegramClientController.getProviderServices
);

// действия с услугами поставщика из бота
router.post(
  "/provider/service/:serviceId/toggle-active",
  telegramClientController.toggleProviderServiceActive
);

router.post(
  "/provider/service/:serviceId/extend-7",
  telegramClientController.extendProviderServiceExpiration7
);

router.post(
  "/provider/service/:serviceId/archive",
  telegramClientController.archiveProviderService
);

module.exports = router;
