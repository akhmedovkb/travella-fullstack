// backend/routes/insideRoutes.js
const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/insideController");
const authenticateToken = require("../middleware/authenticateToken");

// ---------- Админ (ставим ВЫШЕ любых параметрических маршрутов) ----------
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

// ---------- Клиентские эндпоинты ----------
router.get("/me", authenticateToken, ctrl.getInsideMe);
router.get("/user/:userId", authenticateToken, ctrl.getInsideById);
router.get("/", ctrl.getInsideStatus);
router.post("/request-completion", authenticateToken, ctrl.requestCompletion);

router.post("/join", authenticateToken, ctrl.joinInside);

module.exports = router;
