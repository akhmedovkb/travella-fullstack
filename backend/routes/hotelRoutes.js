// backend/routes/hotelRoutes.js
const express = require("express");
const router = express.Router();

const {
  searchHotels,
  createHotel,
  getHotel,
  listHotels,
} = require("../controllers/hotelController");

// поиск для автодополнения
router.get("/search", searchHotels);

// CRUD-часть
router.post("/", createHotel);
router.get("/:id", getHotel);
router.get("/", listHotels);

module.exports = router;
