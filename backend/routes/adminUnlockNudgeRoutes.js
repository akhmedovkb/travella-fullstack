//backend/routes/adminUnlockNudgeRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");
const { getPaidNotOpened } = require("../controllers/adminUnlockNudgeController");

const router = express.Router();

router.get("/", authenticateToken, requireAdmin, getPaidNotOpened);

module.exports = router;
