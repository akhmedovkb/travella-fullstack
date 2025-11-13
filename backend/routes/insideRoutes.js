// backend/routes/insideRoutes.js
const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/insideController");
const { authenticateToken } = require("../middleware/authenticateToken");

// ---------- Клиентские эндпоинты (совпадают с фронтом) ----------

// GET /api/inside/me — статус текущего пользователя
router.get("/me", authenticateToken, ctrl.getInsideMe);

// GET /api/inside/:userId — статус по явному id (можно тоже защитить)
router.get("/:userId", authenticateToken, ctrl.getInsideById);

// GET /api/inside/ — универсальный статус (можно без auth)
router.get("/", ctrl.getInsideStatus);

// POST /api/inside/request-completion — запросить завершение главы
router.post("/request-completion", authenticateToken, ctrl.requestCompletion);

// ---------- Админ (подключаем ТОЛЬКО если функции есть, чтобы не падало) ----------
if (typeof ctrl.adminListParticipants === "function") {
  router.get("/admin/participants", authenticateToken, ctrl.adminListParticipants);
}
if (typeof ctrl.adminCreateParticipant === "function") {
  router.post("/admin/participants", authenticateToken, ctrl.adminCreateParticipant);
}
if (typeof ctrl.adminUpdateParticipant === "function") {
  router.put("/admin/participants/:id", authenticateToken, ctrl.adminUpdateParticipant);
}

if (typeof ctrl.adminListRequests === "function") {
  router.get("/admin/requests", authenticateToken, ctrl.adminListRequests);
}
if (typeof ctrl.adminApproveRequest === "function") {
  router.post("/admin/requests/:id/approve", authenticateToken, ctrl.adminApproveRequest);
}
if (typeof ctrl.adminRejectRequest === "function") {
  router.post("/admin/requests/:id/reject", authenticateToken, ctrl.adminRejectRequest);
}

module.exports = router;
