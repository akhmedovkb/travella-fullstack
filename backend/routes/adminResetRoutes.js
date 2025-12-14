// backend/routes/adminResetRoutes.js
const router = require("express").Router();
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const { resetClient, resetProvider } = require("../controllers/adminResetController");

// Эти роуты должны быть доступны админам/модераторам так же,
// как и остальные /api/admin/*
router.post("/reset-client", authenticateToken, requireAdmin, resetClient);
router.post("/reset-provider", authenticateToken, requireAdmin, resetProvider);

module.exports = router;
