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
  getHotelBrief,          
  listHotelsByCity,       
  // инспекции
  listHotelInspections,
  createHotelInspection,
  likeInspection,
  listInspectionComments,
  createInspectionComment,
  listAllHotelInspections,
  listMyHotels,
} = require("../controllers/hotelsController");

const authenticateToken = require("../middleware/authenticateToken");
const multer = require("multer");

/** Мягкая авторизация: если есть Authorization — парсим токен; если нет — не блокируем запрос */
function tryAuth(req, res, next) {
  const hdr = req.headers?.authorization || "";
  if (!hdr) return next();
  authenticateToken(req, res, () => next());
}

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
const providerOrAdmin = allowRoles("provider", "tour_agent", "agency", "supplier", "hotel");

// Создание инспекции — только для провайдера/турагента/агентства/поставщика
const providerOnly    = allowRoles("provider", "tour_agent", "agency", "supplier", "hotel");
const reviewerOnly    = allowRoles("provider", "tour_agent", "agency", "supplier", "hotel", "client", "user");

const inspectionUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 13,
    fileSize: 100 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const mimetype = String(file.mimetype || "").toLowerCase();
    if (mimetype.startsWith("image/") || mimetype.startsWith("video/")) return cb(null, true);
    return cb(new Error("unsupported_media_type"));
  },
});

// Лайк — авторизованный toggle (уникальность на пользователя)
// Разрешаем: провайдер/агент/агентство/поставщик/клиент/юзер
const canLike = allowRoles("provider", "tour_agent", "agency", "supplier", "client", "user");

/* ==================== Публичные ==================== */
router.get("/search", searchHotels);
router.get("/ranked", listRankedHotels);
router.get("/_list", listHotels);

/* ===  список по городу для каскада === */
router.get("/by-city", listHotelsByCity);   // /api/hotels/by-city?city=Samarkand

/* ===== МОИ ОТЕЛИ (для провайдера) — ДО динамических ===== */
router.get("/mine", providerOnly, listMyHotels);

/* --- лайки инспекций (авторизация обязательна) --- */
// ставим выше, чтобы не конфликтовало с "/:id/inspections"
router.post("/inspections/:id/like", canLike, likeInspection);
router.get("/inspections/:id/comments", tryAuth, listInspectionComments);
router.post("/inspections/:id/comments", reviewerOnly, createInspectionComment);
router.get("/inspections", tryAuth, listAllHotelInspections);

/* --- инспекции отелей --- */
// просмотр — публичный, но с tryAuth (если есть токен, «мои» поднимутся выше и будет liked_by_me)
router.get("/:id/inspections", tryAuth, listHotelInspections);
// создание обзора — провайдеры и клиенты; поддерживает JSON и multipart/form-data с полем files
router.post("/:id/inspections", reviewerOnly, inspectionUpload.array("files", 13), createHotelInspection);

/* === "бриф" отеля для конструктора === */
router.get("/:id/brief", getHotelBrief);   // /api/hotels/:id/brief

/* --- карточка отеля --- */
router.get("/:id", tryAuth, getHotel);  // ← чтобы распарсить токен и пропустить админа

/* ==================== CRUD отеля (для провайдера/админа) ==================== */
router.post("/", providerOrAdmin, createHotel);
router.put("/:id", providerOrAdmin, updateHotel);

module.exports = router;
