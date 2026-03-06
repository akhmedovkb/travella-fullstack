//backend/routes/telegramWebAuthRoutes.js

const express = require("express");
const { loginWithTelegram } = require("../controllers/telegramWebAuthController");

const router = express.Router();

router.post("/telegram-web-login", loginWithTelegram);

module.exports = router;
