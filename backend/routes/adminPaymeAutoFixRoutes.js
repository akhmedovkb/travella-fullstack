// backend/routes/adminPaymeAutoFixRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const {
  adminPaymeAutoFix,
} = require("../controllers/adminPaymeAutoFixController");

const router = express.Router();

router.post(
  "/autofix",
  authenticateToken,
  requireAdmin,
  adminPaymeAutoFix
);

module.exports = router;
