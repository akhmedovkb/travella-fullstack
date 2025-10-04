// backend/middleware/authenticateToken.js
const jwt = require("jsonwebtoken");
const pool = require("../db");
const JWT_SECRET = process.env.JWT_SECRET || "changeme_in_env";

module.exports = async function authenticateToken(req, res, next) {
  try {
    const hdr = req.headers["authorization"];
    if (!hdr) return res.status(401).json({ message: "Missing Authorization" });

    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : hdr;

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ message: "Invalid token" });
    }

    // id из разных вариантов токена
    const id =
      payload.id ??
      payload.userId ??
      payload.uid ??
      payload.clientId ??
      payload.providerId ??
      payload.sub ??
      null;

    // роль из токена, если есть
    let role = payload.role ?? payload.type ?? null;
    if (!role) {
      if (payload.providerId || payload.isProvider === true || payload.roleId === "provider")
        role = "provider";
      else if (payload.clientId || payload.isClient === true || payload.roleId === "client")
        role = "client";
    }

    // --- обогащаем по БД: минимально и безопасно ---
    const flags = {};
    if (id) {
      try {
        // читаем только существующие поля
        const p = await pool.query(
          "SELECT id, is_admin FROM providers WHERE id=$1 LIMIT 1",
          [id]
        );
        if (p.rowCount > 0) {
          if (!role) role = "provider";
          flags.is_admin = !!p.rows[0].is_admin;

          // мягкая попытка прочитать необязательные поля (могут отсутствовать)
          try {
            const f = await pool.query(
              "SELECT is_moderator, moderator, permissions FROM providers WHERE id=$1 LIMIT 1",
              [id]
            );
            if (f.rowCount > 0) {
              flags.is_moderator = !!(f.rows[0].is_moderator || f.rows[0].moderator);
              flags.permissions = f.rows[0].permissions || [];
            }
          } catch { /* ок, колонок может не быть */ }
        } else if (!role) {
          const c = await pool.query("SELECT id FROM clients WHERE id=$1 LIMIT 1", [id]);
          if (c.rowCount > 0) role = "client";
        }
      } catch (dbErr) {
        console.error("auth role/flags infer error:", dbErr);
      }
    }

    // финальные флаги
    const roleLc = String(role || "").toLowerCase();
    const isAdminToken =
      payload.is_admin === true ||
      payload.moderator === true ||
      roleLc === "admin" ||
      roleLc === "moderator";

    const is_admin = !!(flags.is_admin || isAdminToken);
    const is_moderator = !!(flags.is_moderator || roleLc === "moderator");

    req.user = {
      ...payload,
      id,
      role,
      is_admin,
      is_moderator,
      permissions: flags.permissions || payload.permissions || [],
    };
    return next();
  } catch (e) {
    console.error("auth middleware error:", e);
    return res.status(401).json({ message: "Unauthorized" });
  }
};
