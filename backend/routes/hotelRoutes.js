// backend/routes/hotelRoutes.js
const express = require("express");
const router = express.Router();
const { searchHotels } = require("../controllers/hotelController");

router.get("/search", searchHotels);

module.exports = router;
