// backend/routes/financeModelRoutes.js
import express from "express";
import {
  listFinanceModels,
  getFinanceModel,
  createFinanceModel,
  deleteFinanceModel,
} from "../controllers/financeModelController.js";

// Если у тебя есть JWT middleware — можешь подключить его тут,
// но для старта можно оставить публично, или ограничить потом.
// import authenticateToken from "../middleware/authenticateToken.js";

const router = express.Router();

// router.use(authenticateToken);

router.get("/", listFinanceModels);
router.post("/", createFinanceModel);
router.get("/:id", getFinanceModel);
router.delete("/:id", deleteFinanceModel);

export default router;
