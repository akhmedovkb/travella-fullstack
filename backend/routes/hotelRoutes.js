//backend/routes/hotelRoutes.js
const express = require("express");
const router = express.Router();

const {
  searchHotels,
  getHotel,
  createHotel,
  listHotels,
} = require("../controllers/hotelController");

const {
  createInspection,
  listInspections,
} = require("../controllers/hotelInspectionController");

// поиск
router.get("/search", searchHotels);
router.get("/", searchHotels); // алиас

// карточка / создание
router.get("/:id", getHotel);
router.post("/", createHotel);

// инспекции
router.get("/:hotelId/inspections", listInspections);
router.post("/:hotelId/inspections", createInspection);

// (опционально) список без фильтра
// router.get("/_list/all", listHotels);

module.exports = router;
