// backend/routes/adminRefusedRoutes.js
const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const {
  listActualRefused,
  getRefusedById,
  askActualNow,
  extendRefusedService,
  deleteRefusedService,
} = require("../controllers/adminRefusedController");

router.use(authenticateToken);
router.use(requireAdmin);

// список refused_* услуг
router.get("/refused/actual", listActualRefused);

// детальная карточка
router.get("/refused/:id", getRefusedById);

// отправить вопрос актуальности
router.post("/refused/:id/ask-actual", askActualNow);

// продлить на +7 дней
router.post("/refused/:id/extend", extendRefusedService);

// soft delete
router.delete("/refused/:id", deleteRefusedService);

module.exports = router;
