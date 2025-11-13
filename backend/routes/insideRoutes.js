// backend/routes/insideRoutes.js
const express = require("express");
const router = express.Router();

// ВАЖНО: путь до контроллера проверь, у тебя сейчас /app/routes/...
// Если структура backend/{controllers,routes}, то так:
const ctrl = require("../controllers/insideController");

// GET /api/inside/me — статус текущего пользователя
router.get("/me", ctrl.getInsideMe);

// GET /api/inside/:userId — статус по явному id
router.get("/:userId", ctrl.getInsideById);

// GET /api/inside/status — универсальный статус (можно использовать там, где нет auth)
router.get("/", ctrl.getInsideStatus);

// POST /api/inside/request-completion — запросить завершение главы у куратора
router.post("/request-completion", ctrl.requestCompletion);

module.exports = router;
