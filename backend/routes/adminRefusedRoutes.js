// backend/routes/adminRefusedRoutes.js
const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const {
  listActualRefused,
  getRefusedById,
  askActualNow,
} = require("../controllers/adminRefusedController");

router.use(authenticateToken);
router.use(requireAdmin);

// список
router.get("/refused/actual", listActualRefused);

// детальная карточка
router.get("/refused/:id", getRefusedById);

// отправить вопрос актуальности
router.post("/refused/:id/ask-actual", askActualNow);

module.exports = router;
