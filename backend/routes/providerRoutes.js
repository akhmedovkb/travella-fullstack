
const express = require("express");
const router = express.Router();
const {
  registerProvider, loginProvider, getProviderProfile
} = require("../controllers/providerController");
const authenticateToken = require("../middleware/authenticateToken");

router.post("/register", registerProvider);
router.post("/login", loginProvider);
router.get("/profile", authenticateToken, getProviderProfile);

module.exports = router;
