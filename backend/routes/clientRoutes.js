// backend/routes/clientRoutes.js
const express = require("express");
const router = express.Router();
const { register, login, getProfile, updateProfile } = require("../controllers/clientController");
const authenticateToken = require("../middleware/authenticateToken");

// Public
router.post("/register", register);
router.post("/login", login);

// Private
router.get("/profile", authenticateToken, getProfile);
router.put("/profile", authenticateToken, updateProfile);

module.exports = router;
