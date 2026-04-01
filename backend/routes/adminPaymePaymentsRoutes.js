//backend/routes/adminPaymePaymentsRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const { adminPaymePayments } = require("../controllers/adminPaymePaymentsController");

const router = express.Router();

router.get("/payments", authenticateToken, requireAdmin, adminPaymePayments);

module.exports = router;
