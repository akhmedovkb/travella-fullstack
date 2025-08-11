// backend/middleware/authenticateToken.js
const jwt = require("jsonwebtoken");
const pool = require("../db"); // ⬅️ нужен доступ к БД
const JWT_SECRET = process.env.JWT_SECRET || "changeme_in_env";

module.exports = async function authenticateToken(req, res, next) {
  try {
    const hdr = req.headers["authorization"];
    if (!hdr) return res.status(401).json({ message: "Missing Authorization" });

    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : hdr;

    // Синхронная верификация, чтобы можно было использовать await ниже
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ message: "Invalid token" });
    }

    // Нормализуем id
    const id =
      payload.id ??
      payload.userId ??
      payload.uid ??
      payload.clientId ??
      payload.providerId ??
      payload.sub ??
      null;

    // Нормализуем role
    let role = payload.role ?? payload.type ?? null;
    if (!role) {
      if (payload.providerId || payload.isProvider === true || payload.roleId === "provider")
        role = "provider";
      else if (payload.clientId || payload.isClient === true || payload.roleId === "client")
        role = "client";
    }

    // ⬇️ Fallback: если роль все ещё не определена — узнаём по БД
    if (!role && id) {
      try {
        const p = await pool.query("SELECT id FROM providers WHERE id=$1 LIMIT 1", [id]);
        if (p.rowCount > 0) role = "provider";
        else {
          const c = await pool.query("SELECT id FROM clients WHERE id=$1 LIMIT 1", [id]);
          if (c.rowCount > 0) role = "client";
        }
      } catch (dbErr) {
        // не рушим запрос, просто логируем
        console.error("auth role infer error:", dbErr);
      }
    }

    req.user = { ...payload, id, role };
    return next();
  } catch (e) {
    console.error("auth middleware error:", e);
    return res.status(401).json({ message: "Unauthorized" });
  }
};
