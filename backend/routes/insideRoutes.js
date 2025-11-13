// backend/routes/insideRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/insideController");
const { authenticateToken } = require("../middleware/authenticateToken");

// ---------- Client routes ----------

// GET /api/inside/me — статус текущего пользователя
router.get("/inside/me", authenticateToken, ctrl.getMe);

// POST /api/inside/request-completion — запросить завершение главы у куратора
router.post("/inside/request-completion", authenticateToken, ctrl.requestCompletion);

// ---------- Admin routes ----------
router.get("/admin/inside/participants", authenticateToken, ctrl.adminListParticipants);
router.post("/admin/inside/participants", authenticateToken, ctrl.adminCreateParticipant);
router.put("/admin/inside/participants/:id", authenticateToken, ctrl.adminUpdateParticipant);

router.get("/admin/inside/requests", authenticateToken, ctrl.adminListRequests);
router.post("/admin/inside/requests/:id/approve", authenticateToken, ctrl.adminApproveRequest);
router.post("/admin/inside/requests/:id/reject", authenticateToken, ctrl.adminRejectRequest);

module.exports = router;
