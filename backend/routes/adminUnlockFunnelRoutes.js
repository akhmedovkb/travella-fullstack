//backend/routes/adminUnlockFunnelRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const { getUnlockFunnel } = require("../controllers/adminUnlockFunnelController");

const router = express.Router();

router.get("/", authenticateToken, getUnlockFunnel);

module.exports = router;
