// backend/routes/requestRoutes.js
const express = require("express");
const router = express.Router();
const auth = require("../middleware/authenticateToken");
const ctrl = require("../controllers/requestController");

// Клиент создаёт запрос (изменения условий)
router.post("/", auth, ctrl.createRequest);

// Клиент: мои запросы; Провайдер: запросы по его услугам
router.get("/my", auth, ctrl.listMyRequests);

// Оба участника пишут сообщения
router.post("/:id/reply", auth, ctrl.reply);

// Провайдер присылает предложение (JSON), статус -> proposed
router.post("/:id/proposal", auth, ctrl.propose);

// Клиент принимает/отклоняет предложение
router.post("/:id/accept", auth, ctrl.accept);
router.post("/:id/decline", auth, ctrl.decline);

module.exports = router;
