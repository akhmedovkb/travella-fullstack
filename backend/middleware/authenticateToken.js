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

    // Нормализуем role (из токена)
    let role = payload.role ?? payload.type ?? null;
    if (!role) {
      if (payload.providerId || payload.isProvider === true || payload.roleId === "provider")
        role = "provider";
      else if (payload.clientId || payload.isClient === true || payload.roleId === "client")
        role = "client";
    }

        // ⬇️ Fallback/обогащение по БД: определяем роль и админ-флаги
    let flags = {};
    if (id) {
      try {
        // сначала проверим, провайдер ли
        const p = await pool.query(
          "SELECT id, role AS db_role, is_admin, is_moderator, moderator, permissions FROM providers WHERE id=$1 LIMIT 1",
          [id]
        );
        if (p.rowCount > 0) {
          if (!role) role = "provider";
          // флаги из БД
          flags.is_admin = !!p.rows[0].is_admin;
          flags.is_moderator = !!(p.rows[0].is_moderator || p.rows[0].moderator);
          flags.permissions = p.rows[0].permissions || [];
          // если роль до сих пор не определена — возьмём из колонки role
          if (!payload.role && p.rows[0].db_role) {
            role = p.rows[0].db_role;
          }
        } else if (!role) {
          // иначе попробуем как клиента
          const c = await pool.query("SELECT id FROM clients WHERE id=$1 LIMIT 1", [id]);
          if (c.rowCount > 0) role = "client";
        }
      } catch (dbErr) {
        // не рушим запрос, просто логируем
        console.error("auth role/flags infer error:", dbErr);
      }
    }

    // Нормализуем финальные признаки администратора
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
    };    return next();
  } catch (e) {
    console.error("auth middleware error:", e);
    return res.status(401).json({ message: "Unauthorized" });
  }
};
