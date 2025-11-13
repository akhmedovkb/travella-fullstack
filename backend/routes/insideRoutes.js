//backend/routes/insideRoutes.js
const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authenticateToken");
const inside = require("../controllers/insideController");

router.get("/me", authenticateToken, inside.getMe);
router.post("/request-completion", authenticateToken, inside.requestCompletion);

// опционально для админки:
// router.post("/approve-completion", authenticateToken, inside.approveCompletion);

module.exports = router;
