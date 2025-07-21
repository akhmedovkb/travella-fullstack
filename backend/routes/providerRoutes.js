const express = require("express");
const router = express.Router();
const {
  registerProvider,
  loginProvider,
  getProviderProfile,
  updateProviderProfile
} = require("../controllers/providerController");

const authenticateToken = require("../middleware/authenticateToken");

// POST /api/providers/register
router.post("/register", registerProvider);

// POST /api/providers/login
router.post("/login", loginProvider);

// GET /api/providers/profile
router.get("/profile", authenticateToken, getProviderProfile);

// PUT /api/providers/profile
router.put("/profile", authenticateToken, updateProviderProfile);

module.exports = router;
