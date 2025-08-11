// backend/routes/clientRoutes.js
const express = require("express");
const router = express.Router();
const {
  register,
  login,
  getProfile,
  updateProfile,
  getStats, // ← stats
} = require("../controllers/clientController");
const authenticateToken = require("../middleware/authenticateToken");

// Public
router.post("/register", register);
router.post("/login", login);

// Private (совместимость с фронтом: /profile и /me)
router.get("/profile", authenticateToken, getProfile);
router.put("/profile", authenticateToken, updateProfile);

// Алиасы под текущий фронт (/api/clients/me)
router.get("/me", authenticateToken, getProfile);
router.put("/me", authenticateToken, updateProfile);

// Прогресс/статистика клиента
router.get("/stats", authenticateToken, getStats);

module.exports = router;
