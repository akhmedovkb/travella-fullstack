const express = require("express");
const router = express.Router();
const pool = require("../db");
const authenticateToken = require("../middleware/authenticateToken");

// Простая проверка роли; подстройте под ваш JWT/пользователей
function assertModerator(req, res) {
  if (!req.user || !["admin", "moderator"].includes(req.user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

// Выставить/добавить баллы провайдеру
router.post("/boosts", authenticateToken, async (req, res) => {
  try {
    if (!assertModerator(req, res)) return;
    const { providerId, points, reason, expiresAt } = req.body;
    if (!providerId || typeof points !== "number") {
      return res.status(400).json({ error: "providerId and numeric points are required" });
    }
    const r = await pool.query(
      `INSERT INTO provider_moderator_points(provider_id, points, reason, created_by, expires_at)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [providerId, points, reason || null, req.user?.email || "moderator", expiresAt || null]
    );
    res.json({ ok: true, item: r.rows[0] });
  } catch (e) {
    console.error("POST /moderation/boosts error:", e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Посмотреть историю баллов провайдера
router.get("/boosts/:providerId", authenticateToken, async (req, res) => {
  try {
    if (!assertModerator(req, res)) return;
    const r = await pool.query(
      `SELECT * FROM provider_moderator_points
       WHERE provider_id = $1
       ORDER BY created_at DESC`,
      [req.params.providerId]
    );
    res.json({ items: r.rows });
  } catch (e) {
    console.error("GET /moderation/boosts/:providerId error:", e);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
