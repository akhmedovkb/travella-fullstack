// backend/routes/requestRoutes.js
const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");
const {
  createRequest,
  getMyRequests,
  createQuickRequest,
  getProviderRequests,
  getProviderStats,
  updateRequestStatus,
  deleteRequest,
  manualCleanupExpired,
} = require("../controllers/requestController");

/** Создание «быстрого запроса» с маркетплейса */
router.post("/", authenticateToken, createQuickRequest);       // то, что дергает фронт
router.post("/quick", authenticateToken, createQuickRequest);  // алиас
router.post("/", authenticateToken, createRequest);
router.post("/quick", authenticateToken, createRequest);

/** Заявки текущего клиента */
router.get("/my", authenticateToken, getMyRequests);

/** Входящие провайдера (с авто-очисткой) */
router.get("/provider", authenticateToken, getProviderRequests);
router.get("/provider/inbox", authenticateToken, getProviderRequests); // алиас

/** Счётчики провайдера (с авто-очисткой) */
router.get("/provider/stats", authenticateToken, getProviderStats);

/** Обновить статус (например, processed) */
router.put("/:id/status", authenticateToken, updateRequestStatus);

/** Алиас для старого фронта: PUT /:id/processed */
router.put("/:id/processed", authenticateToken, (req, res, next) => {
  req.body = { ...(req.body || {}), status: "processed" };
  return updateRequestStatus(req, res, next);
});

/** Удалить вручную */
router.delete("/:id", authenticateToken, deleteRequest);

/** Ручной триггер авто-очистки */
router.post("/cleanup-expired", authenticateToken, manualCleanupExpired);

module.exports = router;
