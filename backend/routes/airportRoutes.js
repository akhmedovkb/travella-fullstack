// backend/routes/airportRoutes.js
const express = require("express");
const router = express.Router();

const { searchAirports } = require("../controllers/airportController");

// публичный autocomplete
// GET /api/airports/search?q=tash&lang=ru&limit=10
router.get("/search", searchAirports);

module.exports = router;
