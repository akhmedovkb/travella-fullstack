// backend/routes/adminRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const authenticateToken = require("../middleware/authenticateToken");
const {
  tgSend,
  notifyModerationApproved,
  notifyModerationRejected,
  notifyModerationUnpublished,
} = require("../utils/telegram");

// простая проверка роли
const requireAdmin = require("../middleware/requireAdmin");
const leadController = require("../controllers/leadController");

// Deeplink "Открыть в боте" (Bot Otkaznyx Turov)
const TG_BOT_USERNAME = String(process.env.TELEGRAM_BOT_USERNAME || "")
  .replace(/^@/, "")
  .trim();
const CLIENT_TOKEN = process.env.TELEGRAM_CLIENT_BOT_TOKEN || "";
function botOpenLink(serviceId) {
  if (!TG_BOT_USERNAME) return "";
  return `https://t.me/${TG_BOT_USERNAME}?start=svc_${serviceId}`;
}

function phoneToDigits(phone) {
  return String(phone || "").replace(/\D/g, "");
}

/* ---------- СПИСКИ (идут первыми) ---------- */

// /api/admin/services/pending
router.get("/services/pending", authenticateToken, requireAdmin, async (req, res) => {
  const q = await pool.query(
    `SELECT s.*, p.name AS provider_name, p.type AS provider_type
       FROM services s
       JOIN providers p ON p.id = s.provider_id
      WHERE s.moderation_status = 'pending'
      ORDER BY s.submitted_at ASC NULLS LAST, s.updated_at DESC`
  );
  res.json(q.rows);
});

// /api/admin/services/rejected
router.get("/services/rejected", authenticateToken, requireAdmin, async (req, res) => {
  const q = await pool.query(
    `SELECT s.*, p.name AS provider_name, p.type AS provider_type
       FROM services s
       JOIN providers p ON p.id = s.provider_id
      WHERE s.moderation_status = 'rejected'
      ORDER BY COALESCE(s.rejected_at, s.updated_at) DESC`
  );
  res.json(q.rows);
});

/* ---------- ДЕЙСТВИЯ и карточка (после списков; :id только цифры) ---------- */

// карточка услуги для предпросмотра
router.get("/services/:id(\\d+)", authenticateToken, requireAdmin, async (req, res) => {
  const q = await pool.query(
    `SELECT s.*, p.name AS provider_name, p.type AS provider_type
       FROM services s
       JOIN providers p ON p.id = s.provider_id
      WHERE s.id = $1`,
    [req.params.id]
  );
  if (!q.rows.length) return res.status(404).json({ message: "Not found" });
  res.json(q.rows[0]);
});

// approve (только для pending)
router.post("/services/:id(\\d+)/approve", authenticateToken, requireAdmin, async (req, res) => {
  const adminId = req.user.id;

  const { rows } = await pool.query(
    `UPDATE services
        SET moderation_status = 'approved',
            status            = 'published',
            approved_at       = NOW(),
            approved_by       = $2,
            published_at      = NOW(),
            rejected_at       = NULL,
            rejected_by       = NULL,
            rejected_reason   = NULL,
            updated_at        = NOW()
      WHERE id = $1 AND moderation_status = 'pending'
      RETURNING id, status, moderation_status, published_at`,
    [req.params.id, adminId]
  );

  if (!rows.length) {
    return res.status(400).json({ message: "Service not in pending" });
  }

  // TG → поставщику (выбор правильного чата + правильного бота)
  try {
    const info = await pool.query(
      `SELECT 
          s.title,
          s.category,
          p.telegram_refused_chat_id,
          p.telegram_web_chat_id,
          p.telegram_chat_id
       FROM services s
       JOIN providers p ON p.id = s.provider_id
       WHERE s.id = $1`,
      [rows[0].id]
    );

    const row = info.rows[0] || {};
    const refusedChatId = row.telegram_refused_chat_id || null;
    const fallbackChatId = row.telegram_web_chat_id || row.telegram_chat_id || null;

    const chatId = refusedChatId || fallbackChatId;

    // если используем telegram_refused_chat_id — это чат нового (client/refused) бота
    const tokenOverride = refusedChatId ? (process.env.TELEGRAM_CLIENT_BOT_TOKEN || "") : "";

    if (chatId) {
      await tgSend(
        chatId,
        `✅ Ваша услуга одобрена и опубликована\n\n📌 ${row.title || ""}`,
        {},
        tokenOverride
      );
    }

    // 🔔 Авто-уведомление ВСЕМ о новом "отказе" (только refused_*)
    try {
      const cat = String(row.category || "").toLowerCase();
      if (cat.startsWith("refused_")) {
        // соберём chat_id всех пользователей "отказного" бота
        // клиенты: clients.telegram_chat_id
        // поставщики: providers.telegram_refused_chat_id
        const [c1, c2] = await Promise.all([
          pool.query(`SELECT telegram_chat_id FROM clients WHERE telegram_chat_id IS NOT NULL`),
          pool.query(`SELECT telegram_refused_chat_id FROM providers WHERE telegram_refused_chat_id IS NOT NULL`),
        ]);

        const set = new Set();
        (c1.rows || []).forEach((r) => r.telegram_chat_id && set.add(String(r.telegram_chat_id)));
        (c2.rows || []).forEach((r) => r.telegram_refused_chat_id && set.add(String(r.telegram_refused_chat_id)));

        const serviceId = rows[0].id;
        const title = row.title || `Услуга #${serviceId}`;
        const link = botOpenLink(serviceId);

        const extra =
          link
            ? {
                reply_markup: {
                  inline_keyboard: [[{ text: "Открыть в боте", url: link }]],
                },
              }
            : {};

        const text = `🆕 Новый отказ опубликован!\n\n📌 ${title}`;

        // отправим пачками, чтобы не зависнуть
        const ids = Array.from(set);
        const batchSize = 25;
        for (let i = 0; i < ids.length; i += batchSize) {
          const chunk = ids.slice(i, i + batchSize);
          await Promise.all(
            chunk.map((chatId2) =>
              tgSend(chatId2, text, extra, CLIENT_TOKEN).catch(() => false)
            )
          );
        }
      }
    } catch (e2) {
      console.error("[admin approve] broadcast refused failed:", e2?.message || e2);
    }
    
  } catch (e) {
    console.error("[admin approve] tg notify failed:", e?.message || e);
  }

  res.json({ ok: true, service: rows[0] });
});

// reject (только для pending)
router.post("/services/:id(\\d+)/reject", authenticateToken, requireAdmin, async (req, res) => {
  const adminId = req.user.id;
  const { reason = "" } = req.body || {};

  const { rows } = await pool.query(
    `UPDATE services
        SET moderation_status = 'rejected',
            status            = 'rejected',
            rejected_at       = NOW(),
            rejected_by       = $2,
            rejected_reason   = $3,
            updated_at        = NOW()
      WHERE id = $1 AND moderation_status = 'pending'
      RETURNING id, status, moderation_status, rejected_at, rejected_reason`,
    [req.params.id, adminId, reason]
  );

  if (!rows.length) {
    return res.status(400).json({ message: "Service not in pending" });
  }

  // TG → поставщику (выбор правильного чата + правильного бота)
  try {
    const info = await pool.query(
      `SELECT 
          s.title,
          p.telegram_refused_chat_id,
          p.telegram_web_chat_id,
          p.telegram_chat_id
       FROM services s
       JOIN providers p ON p.id = s.provider_id
       WHERE s.id = $1`,
      [rows[0].id]
    );

    const row = info.rows[0] || {};
    const refusedChatId = row.telegram_refused_chat_id || null;
    const fallbackChatId = row.telegram_web_chat_id || row.telegram_chat_id || null;

    const chatId = refusedChatId || fallbackChatId;
    const tokenOverride = refusedChatId ? (process.env.TELEGRAM_CLIENT_BOT_TOKEN || "") : "";

    if (chatId) {
      await tgSend(
        chatId,
        `❌ Ваша услуга отклонена\n\n📌 ${row.title || ""}\n\nПричина:\n${reason || "Не указана"}`,
        {},
        tokenOverride
      );
    }
  } catch (e) {
    console.error("[admin reject] tg notify failed:", e?.message || e);
  }

  res.json({ ok: true, service: rows[0] });
});

// снять с публикации
router.post("/services/:id(\\d+)/unpublish", authenticateToken, requireAdmin, async (req, res) => {
  const adminId = req.user.id;
  const { rows } = await pool.query(
    `UPDATE services
        SET status         = 'archived',
            published_at   = NULL,
            unpublished_at = NOW(),
            unpublished_by = $2,
            updated_at     = NOW()
      WHERE id = $1 AND status = 'published'
      RETURNING id, status, unpublished_at, unpublished_by`,
    [req.params.id, adminId]
  );
  if (!rows.length) return res.status(400).json({ message: "Service not in published" });

  // TG → администраторам
  notifyModerationUnpublished({ service: rows[0].id }).catch(() => {});
  res.json({ ok: true, service: rows[0] });
});

// DELETE /api/admin/leads/:id  (жесткое удаление: lead + client/provider + хвосты)
router.delete(
  "/leads/:id(\\d+)",
  authenticateToken,
  requireAdmin,
  leadController.deleteLeadFully
);


/* ===================== RESET endpoints (совместимо с фронтом Leads.jsx) ===================== */
/**
 * POST /api/admin/reset-provider
 * body: { leadId }
 * - удаляет provider по телефону лида
 * - сбрасывает lead: decision/status/decided_at
 */
router.post("/reset-provider", authenticateToken, requireAdmin, async (req, res) => {
  const leadId = Number(req.body?.leadId);
  if (!Number.isFinite(leadId)) {
    return res.status(400).json({ ok: false, message: "bad leadId" });
  }

  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    const leadRes = await db.query(`SELECT * FROM leads WHERE id=$1 FOR UPDATE`, [leadId]);
    if (!leadRes.rowCount) {
      await db.query("ROLLBACK");
      return res.status(404).json({ ok: false, message: "lead_not_found" });
    }

    const lead = leadRes.rows[0];
    const digits = phoneToDigits(lead.phone);

    const delProv = await db.query(
      `DELETE FROM providers
        WHERE regexp_replace(phone,'\\D','','g') = $1
        RETURNING id`,
      [digits]
    );

    await db.query(
      `UPDATE leads
          SET decision = NULL,
              decided_at = NULL,
              status = 'new'
        WHERE id = $1`,
      [leadId]
    );

    await db.query("COMMIT");

    return res.json({
      ok: true,
      providerFound: delProv.rowCount > 0,
      providerId: delProv.rows?.[0]?.id ?? null,
      leadReset: true,
    });
  } catch (e) {
    await db.query("ROLLBACK");
    console.error("[admin reset-provider] error:", e);
    return res.status(500).json({ ok: false, message: "reset_failed" });
  } finally {
    db.release();
  }
});

/**
 * POST /api/admin/reset-client
 * body: { leadId }
 * - удаляет client по телефону лида
 * - сбрасывает lead: decision/status/decided_at
 */
router.post("/reset-client", authenticateToken, requireAdmin, async (req, res) => {
  const leadId = Number(req.body?.leadId);
  if (!Number.isFinite(leadId)) {
    return res.status(400).json({ ok: false, message: "bad leadId" });
  }

  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    const leadRes = await db.query(`SELECT * FROM leads WHERE id=$1 FOR UPDATE`, [leadId]);
    if (!leadRes.rowCount) {
      await db.query("ROLLBACK");
      return res.status(404).json({ ok: false, message: "lead_not_found" });
    }

    const lead = leadRes.rows[0];
    const digits = phoneToDigits(lead.phone);

    const delClient = await db.query(
      `DELETE FROM clients
        WHERE regexp_replace(phone,'\\D','','g') = $1
        RETURNING id`,
      [digits]
    );

    await db.query(
      `UPDATE leads
          SET decision = NULL,
              decided_at = NULL,
              status = 'new'
        WHERE id = $1`,
      [leadId]
    );

    await db.query("COMMIT");

    return res.json({
      ok: true,
      clientFound: delClient.rowCount > 0,
      clientId: delClient.rows?.[0]?.id ?? null,
      leadReset: true,
    });
  } catch (e) {
    await db.query("ROLLBACK");
    console.error("[admin reset-client] error:", e);
    return res.status(500).json({ ok: false, message: "reset_failed" });
  } finally {
    db.release();
  }
});

/* --- Change provider password (admin only) --- */
// PATCH /api/admin/providers/:id/password
// body: { password: "NewPass123" }
router.patch(
  "/providers/:id(\\d+)/password",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    const { password } = req.body || {};

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Bad provider id" });
    }
    if (typeof password !== "string" || password.trim().length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 chars" });
    }

    try {
      const q = `
        UPDATE public.providers
           SET password  = $1,
               updated_at = NOW()
         WHERE id = $2
         RETURNING id, name, email
      `;
      const { rows } = await pool.query(q, [password.trim(), id]);
      if (!rows.length) {
        return res.status(404).json({ message: "Provider not found" });
      }

      return res.json({ ok: true, provider: rows[0] });
    } catch (e) {
      console.error("admin change password error:", e);
      return res.status(500).json({ message: "Internal error" });
    }
  }
);

module.exports = router;
