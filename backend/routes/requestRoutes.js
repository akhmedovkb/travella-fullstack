// backend/routes/requestRoutes.js
const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");
const ctrl = require("../controllers/requestController") || {};

// Берём всё, что может быть экспортировано под разными именами
const {
  createQuickRequest,
  getProviderRequests,
  getProviderStats,
  // возможные варианты имён
  updateRequestStatus,
  updateStatusByProvider,
  deleteRequest,
  deleteByProvider,
  manualCleanupExpired,
  getMyRequests,
  updateMyRequest,
  touchByProvider,
  // опционально, если у вас есть отдельный аутбокс
  getProviderOutgoingRequests,
} = ctrl;

// Небольшой helper: взять первый существующий хэндлер
const firstFn = (...fns) => fns.find((f) => typeof f === "function");

// Алиасы
const updateStatus = firstFn(updateRequestStatus, updateStatusByProvider);
const removeRequest = firstFn(deleteRequest, deleteByProvider);

// ---------- Создать быстрый запрос ----------
if (!firstFn(createQuickRequest)) {
  throw new Error("requestController.createQuickRequest is not exported");
}
router.post("/", authenticateToken, createQuickRequest);
router.post("/quick", authenticateToken, createQuickRequest);

// ---------- Входящие / исходящие провайдера ----------
if (firstFn(getProviderRequests)) {
  router.get("/provider", authenticateToken, getProviderRequests);
  router.get("/provider/inbox", authenticateToken, getProviderRequests);
}
// Если есть отдельный аутбокс — используем его;
// иначе прокидываем box=outgoing в общий хэндлер.
if (firstFn(getProviderOutgoingRequests)) {
  router.get("/provider/outgoing", authenticateToken, getProviderOutgoingRequests);
} else if (firstFn(getProviderRequests)) {
  // (редкий фолбэк, если вдруг нет отдельного хэндлера)
    router.get("/provider/outgoing", authenticateToken, getProviderRequests);
      }
}

if (firstFn(getProviderStats)) {
  router.get("/provider/stats", authenticateToken, getProviderStats);
}

// ---------- Обновить статус ----------
if (updateStatus) {
  router.put("/:id/status", authenticateToken, updateStatus);

  // алиас «processed»
  router.put("/:id/processed", authenticateToken, (req, res, next) => {
    req.body = { ...(req.body || {}), status: "processed" };
    return updateStatus(req, res, next);
  });
}

// ---------- Удалить заявку ----------
if (removeRequest) {
  router.delete("/:id", authenticateToken, removeRequest);
}

// ---------- Мои заявки клиента ----------
if (firstFn(getMyRequests)) {
  router.get("/my", authenticateToken, getMyRequests);
}

// Клиент обновляет свою заявку
if (firstFn(updateMyRequest)) {
  router.put("/:id", authenticateToken, updateMyRequest);
}

// Провайдер «коснулся» заявки
if (firstFn(touchByProvider)) {
  router.post("/:id/touch", authenticateToken, touchByProvider);
}

if (firstFn(manualCleanupExpired)) {
  router.post("/cleanup-expired", authenticateToken, manualCleanupExpired);
}

module.exports = router;
