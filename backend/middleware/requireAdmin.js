//backend/middleware/requireAdmin.js

module.exports = function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ message: "Unauthorized" });

  const role = String(req.user.role || "").toLowerCase();
  const isAdmin =
    req.user.is_admin === true ||
    role === "admin" ||
    req.user.is_moderator === true ||
    role === "moderator";

  if (isAdmin) return next();
  return res.status(403).json({ message: "Admin only" });
};
