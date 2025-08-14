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
// ожидает body: { status: 'processed' | 'rejected' | ... }
router.put("/:id/status", authenticateToken, updateRequestStatus);

// ✅ Алиас для старого фронта: PUT /:id/processed
router.put("/:id/processed", authenticateToken, (req, res, next) => {
  // принудительно подставляем нужный статус и пробрасываем в общий контроллер
  req.body = { ...(req.body || {}), status: "processed" };
  return updateRequestStatus(req, res, next);
});

// Удалить вручную
router.delete("/:id", authenticateToken, deleteRequest);

// Ручной триггер авто-очистки (можно дергать с "Обновить")
router.post("/cleanup-expired", authenticateToken, manualCleanupExpired);

module.exports = router;
