//backend/routes/adminTravelSalesRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const {
  getAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  getDailySales,
  createDailySale,
  updateDailySale,
  deleteDailySale,
  getPayments,
  createPayment,
  updatePayment,
  deletePayment,
  getSalesReport,
  getAgentBalanceReport,
} = require("../controllers/adminTravelSalesController");

const router = express.Router();

router.get("/agents", authenticateToken, requireAdmin, getAgents);
router.post("/agents", authenticateToken, requireAdmin, createAgent);
router.put("/agents/:id", authenticateToken, requireAdmin, updateAgent);
router.delete("/agents/:id", authenticateToken, requireAdmin, deleteAgent);

router.get("/daily-sales", authenticateToken, requireAdmin, getDailySales);
router.post("/daily-sales", authenticateToken, requireAdmin, createDailySale);
router.put("/daily-sales/:id", authenticateToken, requireAdmin, updateDailySale);
router.delete("/daily-sales/:id", authenticateToken, requireAdmin, deleteDailySale);

router.get("/payments", authenticateToken, requireAdmin, getPayments);
router.post("/payments", authenticateToken, requireAdmin, createPayment);
router.put("/payments/:id", authenticateToken, requireAdmin, updatePayment);
router.delete("/payments/:id", authenticateToken, requireAdmin, deletePayment);

router.get("/reports/sales", authenticateToken, requireAdmin, getSalesReport);
router.get("/reports/agent-balance", authenticateToken, requireAdmin, getAgentBalanceReport);

module.exports = router;
