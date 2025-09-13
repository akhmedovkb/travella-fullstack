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
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ message: "Unauthorized" });
  const role = String(req.user.role || "").toLowerCase();
  const isAdmin =
    req.user.is_admin === true ||
    role === "admin" ||
    req.user.is_moderator === true ||
    req.user.moderator === true ||
    role === "moderator";
  if (isAdmin) return next();
  return res.status(403).json({ message: "Admin only" });
}

/* ---------- СПИСКИ (идут первыми) ---------- */

// /api/admin/services/pending
router.get("/services/pending", authenticateToken, requireAdmin, async (req, res) => {
  const q = await pool.query(
    `SELECT s.*, p.name AS provider_name, p.type AS provider_type
       FROM services s
       JOIN providers p ON p.id = s.provider_id
      WHERE s.status = 'pending'
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
        SET status         = 'published',
            approved_at    = NOW(),
            approved_by    = $2,
            published_at   = NOW(),
            -- чистим следы отклонения, если было
            rejected_at    = NULL,
            rejected_by    = NULL,
            rejected_reason= NULL,
            updated_at     = NOW()
      WHERE id = $1 AND status IN ('pending','rejected')
      RETURNING id, status, published_at`,
    [req.params.id, adminId]
  );
  if (!rows.length) return res.status(400).json({ message: "Service must be pending or rejected" });
    // TG → администраторам
  notifyModerationApproved({ service: rows[0].id }).catch(()=>{});
  res.json({ ok: true, service: rows[0] });
});

// reject (оставляем только для pending)
router.post("/services/:id(\\d+)/reject", authenticateToken, requireAdmin, async (req, res) => {
  const adminId = req.user.id;
  const { reason = "" } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE services
        SET status          = 'rejected',
            rejected_at     = NOW(),
            rejected_by     = $2,
            rejected_reason = $3,
            updated_at      = NOW()
      WHERE id = $1 AND status = 'pending'
      RETURNING id, status, rejected_at, rejected_reason`,
    [req.params.id, adminId, reason]
  );
  if (!rows.length) return res.status(400).json({ message: "Service not in pending" });
    // TG → администраторам
  notifyModerationRejected({ service: rows[0].id, reason }).catch(()=>{});
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

module.exports = router;
