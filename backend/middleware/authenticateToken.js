// backend/middleware/authenticateToken.js
const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "changeme_in_env";

module.exports = function authenticateToken(req, res, next) {
  try {
    const hdr = req.headers["authorization"];
    if (!hdr) return res.status(401).json({ message: "Missing Authorization" });

    // Принимаем "Bearer xxx" или просто "xxx"
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : hdr;

    jwt.verify(token, JWT_SECRET, (err, payload) => {
      if (err) return res.status(401).json({ message: "Invalid token" });

      // Нормализуем id из разных возможных названий полей
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

      req.user = { ...payload, id, role };
      next();
    });
  } catch (e) {
    console.error("auth middleware error:", e);
    return res.status(401).json({ message: "Unauthorized" });
  }
};
