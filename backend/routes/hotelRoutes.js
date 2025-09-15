const express = require("express");
const router = express.Router();

const {
  searchHotels,
  getHotel,
  createHotel,
  listHotels,
  updateHotel,
} = require("../controllers/hotelsController");

const authenticateToken = require("../middleware/authenticateToken");

// пускаем провайдеров/админов
function providerOrAdmin(req, res, next) {
  authenticateToken(req, res, () => {
    const role = req.user?.role || req.user?.type;
    if (role === "provider" || role === "admin" || role === "moderator") return next();
    return res.status(403).json({ error: "forbidden" });
  });
}

// поиск (публичный)
router.get("/search", searchHotels);

// админский список (простой пагинированный)
router.get("/_list", listHotels);

// карточка (публичная)
router.get("/:id", getHotel);

// создание/обновление (требует провайдера/админа)
router.post("/", providerOrAdmin, createHotel);
router.put("/:id", providerOrAdmin, updateHotel);

module.exports = router;
