// backend/routes/adminResetRoutes.js
const router = require("express").Router();
const authenticateToken = require("../middleware/authenticateToken");
const {
  resetClient,
  resetProvider,
} = require("../controllers/adminResetController");

// Только админ
function adminOnly(req, res, next) {
  const role = req.user?.role || req.user?.type || null;
  if (role !== "admin") {
    return res.status(403).json({ ok: false, error: "admin_only" });
  }
  next();
}

router.post("/reset-client", authenticateToken, adminOnly, resetClient);
router.post("/reset-provider", authenticateToken, adminOnly, resetProvider);

module.exports = router;
