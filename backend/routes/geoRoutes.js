// backend/routes/geoRoutes.js
const express = require("express");
const router = express.Router();

const geo = require("../controllers/geoController");

// публичный autocomplete (можно и без токена)
router.get("/airports", geo.searchAirports);
router.get("/airports/iata/:code", geo.getAirportByIata);

module.exports = router;
