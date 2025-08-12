const express = require("express");
const router = express.Router();
const authenticateToken = require("../middleware/authenticateToken");
const {
  createRequest,
  getMyRequests,
  getProviderRequests,
  addProposal,
  acceptRequest,
  rejectRequest,
} = require("../controllers/requestController");

// клиент создаёт запрос
router.post("/", authenticateToken, createRequest);

// клиент видит свои запросы
router.get("/my", authenticateToken, getMyRequests);

// провайдер видит входящие
router.get("/provider", authenticateToken, getProviderRequests);

// провайдер отправляет предложение
router.post("/:id/proposal", authenticateToken, addProposal);

// клиент принимает / отклоняет
router.post("/:id/accept", authenticateToken, acceptRequest);
router.post("/:id/reject", authenticateToken, rejectRequest);

module.exports = router;
