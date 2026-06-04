// backend/routes/adminProviderFunnelRoutes.js
const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const {
  getProviderFunnelSummary,
  listProviderFunnelEvents,
} = require("../controllers/adminProviderFunnelController");

const router = express.Router();

function requireAdmin(req, res, next) {
  authenticateToken(req, res, () => {
    const user = req.user || {};
    const roles = []
      .concat(user.role || [])
      .concat(user.roles || [])
      .concat(user.type || [])
      .flatMap((x) => String(x || "").split(","))
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);

    const ok =
      user.is_admin === true ||
      user.moderator === true ||
      roles.some((role) => ["admin", "moderator", "super", "root"].includes(role));

    if (!ok) return res.status(403).json({ ok: false, error: "FORBIDDEN" });
    next();
  });
}

router.get("/provider-funnel/summary", requireAdmin, getProviderFunnelSummary);
router.get("/provider-funnel/events", requireAdmin, listProviderFunnelEvents);

module.exports = router;
