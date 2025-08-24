// backend/routes/requestRoutes.js
const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");
const ctrl = require("../controllers/requestController") || {};

const {
  createQuickRequest,
  getProviderRequests,
  getProviderOutgoingRequests,
  getProviderStats,
  updateRequestStatus,
  updateStatusByProvider,
  deleteRequest,
  deleteByProvider,
  manualCleanupExpired,
  getMyRequests,
  updateMyRequest,
  touchByProvider,
} = ctrl;

const has = (fn) => typeof fn === "function";

// ---------- Создать быстрый запрос ----------
if (!has(createQuickRequest)) {
  throw new Error("requestController.createQuickRequest is not exported");
}
router.post("/", authenticateToken, createQuickRequest);
router.post("/quick", authenticateToken, createQuickRequest);

// ---------- Входящие провайдера ----------
if (has(getProviderRequests)) {
  router.get("/provider", authenticateToken, getProviderRequests);
  router.get("/provider/inbox", authenticateToken, getProviderRequests);
}

// ---------- Исходящие провайдера ----------
if (has(getProviderOutgoingRequests)) {
  router.get("/provider/outgoing", authenticateToken, getProviderOutgoingRequests);
} else if (has(getProviderRequests)) {
  // фолбэк, если outbox отдается тем же хэндлером
  router.get("/provider/outgoing", authenticateToken, getProviderRequests);
}

// ---------- Счётчики ----------
if (has(getProviderStats)) {
  router.get("/provider/stats", authenticateToken, getProviderStats);
}

// ---------- Обновить статус ----------
if (has(updateRequestStatus)) {
  router.put("/:id/status", authenticateToken, updateRequestStatus);
  // алиас "processed"
  router.put("/:id/processed", authenticateToken, (req, res, next) => {
    req.body = { ...(req.body || {}), status: "processed" };
    return updateRequestStatus(req, res, next);
  });
}
// провайдерская форма (optional)
if (has(updateStatusByProvider)) {
  router.patch("/provider/:id", authenticateToken, updateStatusByProvider);
}

// ---------- Удалить заявку ----------
/** Автор/инициатор (клиент/зеркальный клиент провайдера, а также колонки-provider* если есть) */
if (has(deleteRequest)) {
  router.delete("/:id", authenticateToken, deleteRequest);
}
/** Владелец услуги (входящие у провайдера) */
if (has(deleteByProvider)) {
  router.delete("/provider/:id", authenticateToken, deleteByProvider);
}

// ---------- Мои заявки клиента ----------
if (has(getMyRequests)) {
  router.get("/my", authenticateToken, getMyRequests);
}
if (has(updateMyRequest)) {
  router.put("/:id", authenticateToken, updateMyRequest);
}

// ---------- Пометить как прочитано провайдером ----------
if (has(touchByProvider)) {
  router.post("/:id/touch", authenticateToken, touchByProvider);
}

// ---------- Ручная очистка просроченных ----------
if (has(manualCleanupExpired)) {
  router.post("/cleanup-expired", authenticateToken, manualCleanupExpired);
}

module.exports = router;
