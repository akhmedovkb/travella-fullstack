//backend/routes/adminUnlockFunnelRoutes.js

const express = require("express");
const router = express.Router();
const { getUnlockFunnel } = require("../controllers/adminUnlockFunnelController");

router.get("/", getUnlockFunnel);

module.exports = router;
