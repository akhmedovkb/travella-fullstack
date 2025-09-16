// routes/hotelRoutes.js
const express = require("express");
const router = express.Router();

const {
  // отели
  searchHotels,
  listRankedHotels,
  getHotel,
  createHotel,
  listHotels,
  updateHotel,
  // инспекции
  listHotelInspections,
  createHotelInspection,
  likeInspection,
} = require("../controllers/hotelsController");

const authenticateToken = require("../middleware/authenticateToken");

/** Разрешить только указанным ролям (админ/модер всегда ок) */
function allowRoles(...roles) {
  const want = roles.map((r) => String(r).toLowerCase());
  return (req, res, next) => {
    authenticateToken(req, res, () => {
      const u = req.user || {};
      const pool = new Set(
        [u.role, u.type, ...(Array.isArray(u.roles) ? u.roles : [])]
          .filter(Boolean)
          .map((r) => String(r).toLowerCase())
      );
      const ok =
        pool.has("admin") ||
        pool.has("moderator") ||
        want.some((r) => pool.has(r));
      if (!ok) return res.status(403).json({ error: "forbidden" });
      next();
    });
  };
}

// Создание/редактирование отеля — провайдер/турагент/агентство/поставщик (админ/модер тоже ок)
const providerOrAdmin = allowRoles("provider", "tour_agent", "agency", "supplier");

// Создание инспекции — только провайдер/турагент/агентство/поставщик
const providerOnly = allowRoles("provider", "tour_agent", "agency", "supplier");

/* ==================== Публичные ==================== */
router.get("/search", searchHotels);
router.get("/ranked", listRankedHotels);
router.get("/_list", listHotels);

/* --- лайки инспекций (публично; токен не обязателен) --- */
router.post("/inspections/:id/like", likeInspection);

/* --- инспекции отелей --- */
// просмотр — публичный
router.get("/:id/inspections", listHotelInspections);
// создание — только для провайдера/турагента/агентства/поставщика
router.post("/:id/inspections", providerOnly, createHotelInspection);

/* --- карточка отеля --- */
router.get("/:id", getHotel);

/* ==================== CRUD отеля (для провайдера/админа) ==================== */
router.post("/", providerOrAdmin, createHotel);
router.put("/:id", providerOrAdmin, updateHotel);

module.exports = router;
