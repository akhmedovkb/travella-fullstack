//backend/routes/adminPaymeLabRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const {
  paymeLabRun,
} = require("../controllers/adminPaymeLabController");

const router = express.Router();

router.post(
  "/run",
  authenticateToken,
  requireAdmin,
  paymeLabRun
);

module.exports = router;
