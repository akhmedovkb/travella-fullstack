const express = require("express");
const router = express.Router();

const {
  createLead,
  listLeads,
  updateLeadStatus,
  listLeadPages,
  decideLead,               // 👈 НОВОЕ
} = require("../controllers/leadController");

const authenticateToken = require("../middleware/authenticateToken");

// Публично (лендинги / бот)
router.post("/", createLead);

// Админка
router.get("/", authenticateToken, listLeads);
router.get("/pages", authenticateToken, listLeadPages);

// Старое обновление статуса (оставляем)
router.patch("/:id", authenticateToken, updateLeadStatus);

// 🔥 НОВОЕ: принять / отклонить лид
router.patch("/:id/decision", authenticateToken, decideLead);

module.exports = router;
