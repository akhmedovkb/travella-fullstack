const express = require("express");
const router = express.Router();

const { getClientPublicProfile } = require("../controllers/profileController");

// Публичный (без авторизации): профиль клиента по id
router.get("/client/:id", getClientPublicProfile);

module.exports = router;

