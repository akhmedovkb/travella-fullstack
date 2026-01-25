// backend/routes/financeModelRoutes.js
const express = require("express");
const router = express.Router();

const {
  listFinanceModels,
  getFinanceModel,
  createFinanceModel,
  deleteFinanceModel,
} = require("../controllers/financeModelController");

// Если захочешь закрыть авторизацией — раскомментируй:
// const authenticateToken = require("../middleware/authenticateToken");
// router.use(authenticateToken);

router.get("/", listFinanceModels);
router.post("/", createFinanceModel);
router.get("/:id", getFinanceModel);
router.delete("/:id", deleteFinanceModel);

module.exports = router;
