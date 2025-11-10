// backend/routes/leadRoutes.js

const express = require("express");
const router = express.Router();
const { createLead, listLeads, updateLeadStatus, listLeadPages } = require("../controllers/leadController");
const authenticateToken = require("../middleware/authenticateToken");

// Публичная точка для форм лендинга
router.post("/", createLead);

// Список лидов — только авторизованные (админ/модератор/провайдер по твоим правилам)
router.get("/", authenticateToken, listLeads);
router.get("/pages", authenticateToken, listLeadPages);

// Обновление статуса
router.patch("/:id", authenticateToken, updateLeadStatus);

module.exports = router;
