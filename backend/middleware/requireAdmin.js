// backend/middleware/requireAdmin.js
const pool = require("../db");

module.exports = async function requireAdmin(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const role = String(req.user.role || "").toLowerCase();

    const roles = []
      .concat(req.user.roles || [])
      .flatMap((r) => String(r).split(","))
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const tokenSaysAdmin =
      req.user.is_admin === true ||
      req.user.isAdmin === true ||
      role === "admin" ||
      roles.includes("admin");

    const tokenSaysModerator =
      req.user.is_moderator === true ||
      req.user.isModerator === true ||
      req.user.moderator === true ||
      role === "moderator" ||
      roles.includes("moderator");

    if (tokenSaysAdmin || tokenSaysModerator) return next();

    // fallback: проверяем провайдера по БД
    const providerId = Number(req.user.id || req.user.provider_id);
    if (!Number.isInteger(providerId)) {
      console.warn("[requireAdmin] DENY: bad providerId", {
        role,
        roles,
        id: req.user.id,
        provider_id: req.user.provider_id,
        is_admin: req.user.is_admin,
        is_moderator: req.user.is_moderator,
      });

      return res.status(403).json({
        ok: false,
        error: "admin_only",
        debug: {
          role,
          roles,
          id: req.user.id,
          provider_id: req.user.provider_id,
          is_admin: req.user.is_admin,
          is_moderator: req.user.is_moderator,
        },
      });
    }

    const { rows } = await pool.query(
      "SELECT is_admin, is_moderator FROM providers WHERE id = $1",
      [providerId]
    );

    if (rows[0]?.is_admin || rows[0]?.is_moderator) return next();

    console.warn("[requireAdmin] DENY: db says not admin", {
      providerId,
      db: rows[0] || null,
      role,
      roles,
      is_admin: req.user.is_admin,
      is_moderator: req.user.is_moderator,
    });

    return res.status(403).json({
      ok: false,
      error: "admin_only",
      debug: {
        providerId,
        role,
        roles,
        is_admin: req.user.is_admin,
        is_moderator: req.user.is_moderator,
        db: rows[0] || null,
      },
    });
  } catch (e) {
    console.error("requireAdmin error:", e);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
};
