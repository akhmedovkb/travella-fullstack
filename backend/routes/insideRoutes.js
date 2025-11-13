// backend/routes/insideRoutes.js
const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/insideController");
// ВАЖНО: без деструктуризации — у нас default export функции
const authenticateToken = require("../middleware/authenticateToken");

// --- клиентские эндпоинты ---
router.get("/me", authenticateToken, ctrl.getInsideMe);

// --- админские эндпоинты (ставим ДО `/:userId`, чтобы 'admin' не перехватывался) ---
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

// --- публичный статус (можно без auth) ---
router.get("/", ctrl.getInsideStatus);

// --- запрос на завершение главы ---
router.post("/request-completion", authenticateToken, ctrl.requestCompletion);

// --- статус по явному id (ставим ПОСЛЕДНИМ, чтобы не ловил admin и пр.) ---
router.get("/:userId", authenticateToken, ctrl.getInsideById);

module.exports = router;
