// backend/routes/clientRoutes.js
const express = require("express");
const router = express.Router();
const {
  register,
  login,
  getProfile,
  updateProfile,
  getStats,
  changePassword, // ← добавили
} = require("../controllers/clientController");
const authenticateToken = require("../middleware/authenticateToken");

// Public
router.post("/register", register);
router.post("/login", login);

// Private (совместимость: /profile и /me)
router.get("/profile", authenticateToken, getProfile);
router.put("/profile", authenticateToken, updateProfile);

router.get("/me", authenticateToken, getProfile);
router.put("/me", authenticateToken, updateProfile);

// Прогресс/статистика клиента
router.get("/stats", authenticateToken, getStats);

// Смена пароля клиента
router.post("/change-password", authenticateToken, changePassword);

module.exports = router;
