// backend/routes/insideRoutes.js
const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/insideController");
const authenticateToken = require("../middleware/authenticateToken");

// ---------- Админ-эндпоинты (СТАВИМ ВЫШЕ параметрических роутов) ----------

// Участники программы
if (typeof ctrl.adminListParticipants === "function") {
  router.get("/admin/participants", authenticateToken, ctrl.adminListParticipants);
}
if (typeof ctrl.adminCreateParticipant === "function") {
  router.post("/admin/participants", authenticateToken, ctrl.adminCreateParticipant);
}
if (typeof ctrl.adminUpdateParticipant === "function") {
  router.put("/admin/participants/:id", authenticateToken, ctrl.adminUpdateParticipant);
}
// 🔹 отчисление участника
if (typeof ctrl.adminExpelParticipant === "function") {
  router.post(
    "/admin/participants/:userId/expel",
    authenticateToken,
    ctrl.adminExpelParticipant
  );
}

// Заявки на завершение глав
if (typeof ctrl.adminListRequests === "function") {
  router.get("/admin/requests", authenticateToken, ctrl.adminListRequests);
}
if (typeof ctrl.adminApproveRequest === "function") {
  router.post("/admin/requests/:id/approve", authenticateToken, ctrl.adminApproveRequest);
}
if (typeof ctrl.adminRejectRequest === "function") {
  router.post("/admin/requests/:id/reject", authenticateToken, ctrl.adminRejectRequest);
}

// Главы (расписание набора групп)
if (typeof ctrl.adminListChapters === "function") {
  // список всех глав / расписания
  router.get("/admin/chapters", authenticateToken, ctrl.adminListChapters);
}
if (typeof ctrl.adminUpsertChapter === "function") {
  // создать/обновить главу по chapter_key
  router.post("/admin/chapters", authenticateToken, ctrl.adminUpsertChapter);
}

// ---------- Публичные эндпоинты ----------

// Ближайшая открытая глава с датой старта и количеством мест
if (typeof ctrl.getNextChapterPublic === "function") {
  router.get("/chapters/next", ctrl.getNextChapterPublic);
}

// Общий публичный статус (пока заглушка)
router.get("/", ctrl.getInsideStatus);

// ---------- Клиентские эндпоинты (требуют авторизации) ----------

// статус текущего клиента
router.get("/me", authenticateToken, ctrl.getInsideMe);

// статус по userId (для куратора / админа в интерфейсе, но с токеном)
router.get("/user/:userId", authenticateToken, ctrl.getInsideById);

// запрос на завершение текущей главы
router.post("/request-completion", authenticateToken, ctrl.requestCompletion);

// ручное присоединение к программе
router.post("/join", authenticateToken, ctrl.joinInside);

// последняя заявка клиента на завершение главы
router.get("/my-request", authenticateToken, ctrl.getMyLastRequest);

module.exports = router;
