// backend/routes/adminRefusedRoutes.js
const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const {
  listActualRefused,
  getRefusedById,
  askActualNow,
  askActualBulk,
  publishRefusedService,
  publishRefusedBulk,
  extendRefusedService,
  deleteRefusedService,
  restoreRefusedService,
} = require("../controllers/adminRefusedController");

router.use(authenticateToken);
router.use(requireAdmin);

// список refused_* услуг
router.get("/refused/actual", listActualRefused);

// детальная карточка
router.get("/refused/:id", getRefusedById);

// отправить вопрос актуальности
router.post("/refused/:id/ask-actual", askActualNow);

// массово отправить вопрос актуальности по выбранным услугам
router.post("/refused/ask-actual/bulk", askActualBulk);

// опубликовать public-safe карточку в Telegram канал
router.post("/refused/:id/publish-public", publishRefusedService);

// массово опубликовать public-safe карточки в Telegram канал
router.post("/refused/publish-public/bulk", publishRefusedBulk);

// продлить на +7 дней
router.post("/refused/:id/extend", extendRefusedService);

// soft delete
router.delete("/refused/:id", deleteRefusedService);

// восстановить soft-deleted услугу
router.post("/refused/:id/restore", restoreRefusedService);

module.exports = router;
