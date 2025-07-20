const express = require("express");
const router = express.Router();
const {
  registerProvider,
  loginProvider
} = require("../controllers/providerController");

// POST /api/providers/register
router.post("/register", registerProvider);

// POST /api/providers/login
router.post("/login", loginProvider);

module.exports = router;
