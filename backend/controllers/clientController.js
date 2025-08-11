const db = require("../db"); // замени при необходимости
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// ============ AUTH (register/login) как было у тебя ============
// оставь твою реализацию register/login, ниже — новый функционал

// GET /api/clients/me
exports.getMe = async (req, res) => {
  try {
    if (req.user?.role !== "client") {
      return res.status(403).json({ message: "Only client" });
    }
    const { rows } = await db.query(
      "SELECT id, name, phone, avatar_url FROM clients WHERE id = $1",
      [req.user.id]
    );
    return res.json(rows[0] || {});
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to get profile" });
  }
};

// PUT /api/clients/me  { name?, phone?, avatar_base64?, remove_avatar? }
exports.updateMe = async (req, res) => {
  try {
    if (req.user?.role !== "client") {
      return res.status(403).json({ message: "Only client" });
    }
    const { name, phone, avatar_base64, remove_avatar } = req.body;

    // на простом этапе пишем dataURL прямо в колонку avatar_url
    let avatarUrlSql = "";
    let params = [name || null, phone || null, req.user.id];

    if (remove_avatar) {
      avatarUrlSql = ", avatar_url = NULL";
    } else if (avatar_base64) {
      avatarUrlSql = ", avatar_url = $4";
      params = [name || null, phone || null, req.user.id, `data:image/jpeg;base64,${avatar_base64}`];
    }

    const sql = `
      UPDATE clients
         SET name = COALESCE($1, name),
             phone = COALESCE($2, phone)
             ${avatarUrlSql}
       WHERE id = $3
       RETURNING id, name, phone, avatar_url`;
    const { rows } = await db.query(sql, params);

    return res.json(rows[0] || {});
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to update profile" });
  }
};

// POST /api/clients/change-password { password }
exports.changePassword = async (req, res) => {
  try {
    if (req.user?.role !== "client") {
      return res.status(403).json({ message: "Only client" });
    }
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ message: "Password too short" });
    }
    const hash = await bcrypt.hash(password, 10);
    await db.query("UPDATE clients SET password_hash = $1 WHERE id = $2", [
      hash,
      req.user.id,
    ]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to change password" });
  }
};

// GET /api/clients/stats
exports.getStats = async (req, res) => {
  try {
    if (req.user?.role !== "client") {
      return res.status(403).json({ message: "Only client" });
    }
    const clientId = req.user.id;

    const reqTotal = await db.query(
      "SELECT COUNT(*)::int AS c FROM change_requests WHERE client_id = $1",
      [clientId]
    );
    const reqActive = await db.query(
      "SELECT COUNT(*)::int AS c FROM change_requests WHERE client_id = $1 AND status IN ('new','accepted','in_progress')",
      [clientId]
    );

    const bookTotal = await db.query(
      "SELECT COUNT(*)::int AS c FROM bookings WHERE client_id = $1",
      [clientId]
    );
    const bookCompleted = await db.query(
      "SELECT COUNT(*)::int AS c FROM bookings WHERE client_id = $1 AND status = 'completed'",
      [clientId]
    );
    const bookCancelled = await db.query(
      "SELECT COUNT(*)::int AS c FROM bookings WHERE client_id = $1 AND status = 'cancelled'",
      [clientId]
    );

    // очень простая модель рейтинга/поинтов
    const points = (bookCompleted.rows[0]?.c || 0) * 50;
    let tier = "Bronze";
    let next = 500;
    if (points >= 2000) { tier = "Platinum"; next = points; }
    else if (points >= 1000) { tier = "Gold"; next = 2000; }
    else if (points >= 500)  { tier = "Silver"; next = 1000; }

    const rating = 3.0 + Math.min(2, (bookCompleted.rows[0]?.c || 0) * 0.1); // условно

    res.json({
      rating,
      points,
      tier,
      next_tier_at: next,
      requests_total: reqTotal.rows[0].c,
      requests_active: reqActive.rows[0].c,
      bookings_total: bookTotal.rows[0].c,
      bookings_completed: bookCompleted.rows[0].c,
      bookings_cancelled: bookCancelled.rows[0].c,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to get stats" });
  }
};
