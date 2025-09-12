//backend/routes/adminRoutes.js

const express = require("express");
const router = express.Router();
const pool = require("../db");
const authenticateToken = require("../middleware/authenticateToken");

// простая проверка роли
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin only" });
  }
  next();
}

// список на модерации
router.get("/services/pending", authenticateToken, requireAdmin, async (req, res) => {
  const q = await pool.query(
    `SELECT s.*, p.name AS provider_name, p.type AS provider_type
       FROM services s
       JOIN providers p ON p.id = s.provider_id
      WHERE s.status='pending'
      ORDER BY s.submitted_at ASC`
  );
  res.json(q.rows);
});

// карточка услуги (для предпросмотра в админке)
router.get("/services/:id", authenticateToken, requireAdmin, async (req, res) => {
  const q = await pool.query(
    `SELECT s.*, p.name AS provider_name, p.type AS provider_type
       FROM services s
       JOIN providers p ON p.id = s.provider_id
      WHERE s.id=$1`,
    [req.params.id]
  );
  if (!q.rows.length) return res.status(404).json({ message: "Not found" });
  res.json(q.rows[0]);
});

// approve
router.post("/services/:id/approve", authenticateToken, requireAdmin, async (req, res) => {
  const adminId = req.user.id;
  const { rows } = await pool.query(
    `UPDATE services
        SET status='published',
            approved_at=NOW(),
            approved_by=$2,
            published_at=NOW(),     -- в момент апрува публикуем
            rejected_at=NULL,
            rejected_reason=NULL
      WHERE id=$1 AND status='pending'
      RETURNING id, status, published_at`,
    [req.params.id, adminId]
  );
  if (!rows.length) return res.status(400).json({ message: "Service not in pending" });
  res.json({ ok: true, service: rows[0] });
});

// reject
router.post("/services/:id/reject", authenticateToken, requireAdmin, async (req, res) => {
  const adminId = req.user.id;
  const { reason = "" } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE services
        SET status='rejected',
            rejected_at=NOW(),
            rejected_by=$2,
            rejected_reason=$3
      WHERE id=$1 AND status='pending'
      RETURNING id, status, rejected_at, rejected_reason`,
    [req.params.id, adminId, reason]
  );
  if (!rows.length) return res.status(400).json({ message: "Service not in pending" });
  res.json({ ok: true, service: rows[0] });
});

// unpublish (снять с витрины)
router.post("/services/:id/unpublish", authenticateToken, requireAdmin, async (req, res) => {
  const adminId = req.user.id;
    const { rows } = await pool.query(
    `UPDATE services
        SET status='archived',
            published_at = NULL,
            unpublished_at = NOW(),
            unpublished_by = $2
      WHERE id=$1 AND status='published'
      RETURNING id, status`,
    [req.params.id, adminId]
  );
  if (!rows.length) return res.status(400).json({ message: "Service not in published" });
  res.json({ ok: true, service: rows[0] });
});

module.exports = router;
