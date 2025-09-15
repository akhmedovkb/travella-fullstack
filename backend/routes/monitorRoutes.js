const express = require("express");
const router = express.Router();
const monitor = require("../utils/apiMonitor");

// Сводка по GeoNames
router.get("/geonames", (req, res) => {
  return res.json(monitor.getSummary("geonames"));
});

// Последние события (по умолчанию 50)
router.get("/geonames/events", (req, res) => {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || "50", 10)));
  return res.json(monitor.getEvents("geonames", limit));
});

module.exports = router;
