//backend/routes/adminRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const authenticateToken = require("../middleware/authenticateToken");
const {
  notifyModerationApproved,
  notifyModerationRejected,
  notifyModerationUnpublished,
} = require("../utils/telegram");

// простая проверка роли
const requireAdmin = require("../middleware/requireAdmin");

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
      WHERE s.status = 'rejected'
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

// approve (в т.ч. подтверждение ранее отклонённых)
router.post("/services/:id(\\d+)/approve", authenticateToken, requireAdmin, async (req, res) => {
  const adminId = req.user.id;
  const { rows } = await pool.query(
    `UPDATE services
        SET moderation_status = 'approved',
            status         = 'published',
            approved_at    = NOW(),
            approved_by    = $2,
            published_at   = NOW(),
            -- чистим следы отклонения, если было
            rejected_at    = NULL,
            rejected_by    = NULL,
            rejected_reason= NULL,
            updated_at     = NOW()
      WHERE id = $1 AND moderation_status = 'pending'
      RETURNING id, status, published_at`,
    [req.params.id, adminId]
  );
  if (!rows.length) return res.status(400).json({ message: "Service must be pending or rejected" });
    // TG → администраторам
  notifyModerationApproved({ service: rows[0].id }).catch(()=>{});
  
    // TG → поставщику
  const info = await pool.query(
    `SELECT s.title, p.telegram_chat_id
       FROM services s
       JOIN providers p ON p.id = s.provider_id
      WHERE s.id = $1`,
    [rows[0].id]
  );

  if (info.rows[0]?.telegram_chat_id) {
    tgSend(
      info.rows[0].telegram_chat_id,
      `✅ Ваша услуга одобрена и опубликована\n\n📌 ${info.rows[0].title}`
    ).catch(() => {});
  }

  res.json({ ok: true, service: rows[0] });
});

// reject (оставляем только для pending)
router.post("/services/:id(\\d+)/reject", authenticateToken, requireAdmin, async (req, res) => {
  const adminId = req.user.id;
  const { reason = "" } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE services
        SET moderation_status = 'rejected',
            status          = 'rejected',
            rejected_at     = NOW(),
            rejected_by     = $2,
            rejected_reason = $3,
            updated_at      = NOW()
      WHERE id = $1 AND moderation_status = 'pending'
      RETURNING id, status, rejected_at, rejected_reason`,
    [req.params.id, adminId, reason]
  );
  if (!rows.length) return res.status(400).json({ message: "Service not in pending" });
    // TG → администраторам
  notifyModerationRejected({ service: rows[0].id, reason }).catch(()=>{});

    // TG → поставщику
  const info = await pool.query(
    `SELECT s.title, p.telegram_chat_id
       FROM services s
       JOIN providers p ON p.id = s.provider_id
      WHERE s.id = $1`,
    [rows[0].id]
  );

  if (info.rows[0]?.telegram_chat_id) {
    tgSend(
      info.rows[0].telegram_chat_id,
      `❌ Ваша услуга отклонена\n\n📌 ${info.rows[0].title}\n\nПричина:\n${reason || "Не указана"}`
    ).catch(() => {});
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
  notifyModerationUnpublished({ service: rows[0].id }).catch(()=>{});
  res.json({ ok: true, service: rows[0] });
});

// --- Change provider password (admin only) ---
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
