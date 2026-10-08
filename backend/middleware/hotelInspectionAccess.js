const authenticateToken = require("./authenticateToken");

function tryAuth(req, res, next) {
  const header = req.headers?.authorization || "";
  if (!header) return next();
  return authenticateToken(req, res, next);
}

function allowRoles(...roles) {
  const allowed = roles.map((role) => String(role).toLowerCase());

  return (req, res, next) => {
    authenticateToken(req, res, () => {
      const user = req.user || {};
      const userRoles = new Set(
        [user.role, user.type, ...(Array.isArray(user.roles) ? user.roles : [])]
          .filter(Boolean)
          .map((role) => String(role).toLowerCase())
      );

      const permitted =
        userRoles.has("admin") ||
        userRoles.has("moderator") ||
        allowed.some((role) => userRoles.has(role));

      if (!permitted) return res.status(403).json({ error: "forbidden" });
      return next();
    });
  };
}

module.exports = { tryAuth, allowRoles };
