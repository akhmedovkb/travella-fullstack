// backend/routes/adminPaymeLabRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const {
  paymeLabRun,
  createTopupOrder,
  inspectTopupOrder,
} = require("../controllers/adminPaymeLabController");

const router = express.Router();

router.post("/run", authenticateToken, requireAdmin, paymeLabRun);
router.post("/orders/create", authenticateToken, requireAdmin, createTopupOrder);
router.get("/orders/:orderId/inspect", authenticateToken, requireAdmin, inspectTopupOrder);

module.exports = router;
