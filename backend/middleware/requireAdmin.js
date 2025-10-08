// backend/middleware/requireAdmin.js
const pool = require("../db");

module.exports = async function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ message: "Unauthorized" });

  const role = String(req.user.role || "").toLowerCase();
  const roles = []
    .concat(req.user.roles || [])
    .flatMap(r => String(r).split(","))
    .map(s => s.trim().toLowerCase());

  const tokenSaysAdmin =
    req.user.is_admin === true ||
    req.user.isAdmin === true ||
    req.user.is_moderator === true ||
    req.user.moderator === true ||
    role === "admin" ||
    role === "moderator" ||
    roles.includes("admin") ||
    roles.includes("moderator") ||
    (Array.isArray(req.user.providers) && req.user.providers.some(p => p?.is_admin));

  if (tokenSaysAdmin) return next();

  // Фоллбэк: проверяем по БД
  const providerId = Number(req.user.id || req.user.provider_id);
  if (!Number.isInteger(providerId)) {
    return res.status(403).json({ message: "Admin only" });
  }

  try {
    const { rows } = await pool.query(
      "SELECT is_admin FROM providers WHERE id = $1",
      [providerId]
    );
    if (rows[0]?.is_admin) return next();
    return res.status(403).json({ message: "Admin only" });
  } catch (e) {
    console.error("requireAdmin DB check failed:", e);
    return res.status(500).json({ message: "Internal error" });
  }
};
