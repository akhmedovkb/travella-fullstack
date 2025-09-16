// routes/hotelRoutes.js
const express = require("express");
const router = express.Router();

const {
  searchHotels,
  listRankedHotels,
  getHotel,
  createHotel,
  listHotels,
  updateHotel,
  // inspections
  listHotelInspections,
  createHotelInspection,
} = require("../controllers/hotelsController");

const authenticateToken = require("../middleware/authenticateToken");

/** Ролевой гард: пускаем только указанные роли (админ/модер — всегда ок) */
function allowRoles(...roles) {
  const wanted = roles.map((r) => String(r).toLowerCase());
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
        wanted.some((r) => pool.has(r));
      if (!ok) return res.status(403).json({ error: "forbidden" });
      next();
    });
  };
}

// Создавать / редактировать может провайдер/турагент/агентство (и админ/модер)
const providerOrAdmin = allowRoles("provider", "tour_agent", "agency", "supplier", "admin", "moderator");
// Оставлять инспекцию — только для провайдера/турагента/агентства
const providerOnly = allowRoles("provider", "tour_agent", "agency", "supplier");

/* ---------- ПУБЛИЧНЫЕ ---------- */
router.get("/search", searchHotels);
router.get("/ranked", listRankedHotels);
router.get("/_list", listHotels);

/* ---------- ИНСПЕКЦИИ ОТЕЛЕЙ ---------- */
// просмотр — публичный
router.get("/:id/inspections", listHotelInspections);
// создание — только провайдер/турагент/агентство
router.post("/:id/inspections", providerOnly, createHotelInspection);

/* ---------- КАРТОЧКА ОТЕЛЯ ---------- */
router.get("/:id", getHotel);

/* ---------- CRUD (для провайдера/админа) ---------- */
router.post("/", providerOrAdmin, createHotel);
router.put("/:id", providerOrAdmin, updateHotel);

module.exports = router;
