const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");
const ctrl = require("../controllers/requestController");

const {
  createQuickRequest,
  getProviderRequests,
  getProviderOutgoingRequests,   // ← НОВОЕ
  getProviderStats,
  updateRequestStatus,
  updateStatusByProvider,        // ← есть в контроллере
  deleteRequest,
  deleteByProvider,              // ← НОВОЕ
  manualCleanupExpired,
  getMyRequests,
  updateMyRequest,
  touchByProvider,
} = ctrl;

// создать быстрый запрос
router.post("/", authenticateToken, createQuickRequest);
router.post("/quick", authenticateToken, createQuickRequest);

// входящие провайдера
router.get("/provider", authenticateToken, getProviderRequests);
router.get("/provider/inbox", authenticateToken, getProviderRequests);

// исходящие провайдера (правильный хэндлер)
router.get("/provider/outgoing", authenticateToken, getProviderOutgoingRequests);

// счётчики
router.get("/provider/stats", authenticateToken, getProviderStats);

// отметить/сменить статус (универсальный и провайдерский)
router.put("/:id/status", authenticateToken, updateRequestStatus);
router.put("/:id/processed", authenticateToken, (req, res, next) => {
  req.body = { ...(req.body || {}), status: "processed" };
  return updateRequestStatus(req, res, next);
});
router.patch("/provider/:id", authenticateToken, updateStatusByProvider);

// удалить заявку
// - для автора (клиент/зеркальный клиент провайдера) ИЛИ для «инициатора» — используем общий DELETE
router.delete("/:id", authenticateToken, deleteRequest);
// - для владельца услуги (входящие) — безопаснее отдельный провайдерский DELETE
router.delete("/provider/:id", authenticateToken, deleteByProvider);

// ручная очистка просроченных
router.post("/cleanup-expired", authenticateToken, manualCleanupExpired);

// мои заявки клиента
router.get("/my", authenticateToken, getMyRequests);
router.put("/:id", authenticateToken, updateMyRequest);

// пометить как прочитано провайдером
router.post("/:id/touch", authenticateToken, touchByProvider);

module.exports = router;
