
const express = require("express");
const router = express.Router();
const {
  registerClient, loginClient, getClientProfile
} = require("../controllers/clientController");
const authenticateToken = require("../middleware/authenticateToken");

router.post("/register", registerClient);
router.post("/login", loginClient);
router.get("/profile", authenticateToken, getClientProfile);

module.exports = router;
