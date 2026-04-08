//backend/routes/serviceStatsRoutes.js

const express = require("express");
const {
  registerServiceView,
  getServiceStats,
} = require("../controllers/serviceStatsController");

const router = express.Router();

router.post("/:id/view", registerServiceView);
router.get("/:id", getServiceStats);

module.exports = router;
