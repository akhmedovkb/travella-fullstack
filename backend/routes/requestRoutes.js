// backend/routes/requestRoutes.js
const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");
const {
  getProviderRequests,
  getProviderStats,
  updateRequestStatus,
  deleteRequest,
  manualCleanupExpired,
} = require("../controllers/requestController");

// Входящие провайдера (с авто-очисткой)
router.get("/provider", authenticateToken, getProviderRequests);
router.get("/provider/inbox", authenticateToken, getProviderRequests); // алиас

// Счётчики провайдера (тоже с авто-очисткой перед подсчётом)
router.get("/provider/stats", authenticateToken, getProviderStats);

// Обновить статус (например, processed)
router.put("/:id/status", authenticateToken, updateRequestStatus);

// Удалить вручную
router.delete("/:id", authenticateToken, deleteRequest);

// Ручной триггер авто-очистки (можно дергать с "Обновить")
router.post("/cleanup-expired", authenticateToken, manualCleanupExpired);

module.exports = router;
