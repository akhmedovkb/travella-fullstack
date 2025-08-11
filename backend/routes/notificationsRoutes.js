// backend/routes/notificationsRoutes.js
const express = require("express");
const router = express.Router();
const auth = require("../middleware/authenticateToken");
const { getCounts } = require("../controllers/notificationsController");

router.get("/counts", auth, getCounts);

module.exports = router;
