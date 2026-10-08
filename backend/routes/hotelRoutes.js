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
  listHotelReadiness,
  updateHotel,
  getHotelBrief,          
  listHotelsByCity,       
  quoteHotel,
  // инспекции
  listHotelInspections,
  createHotelInspection,
  updateHotelInspection,
  deleteHotelInspection,
  moderateHotelInspection,
  reportHotelInspection,
  likeInspection,
  listInspectionComments,
  createInspectionComment,
  moderateInspectionComment,
  reportInspectionComment,
  listAllHotelInspections,
  getHotelInspectionMedia,
  listMyHotels,
} = require("../controllers/hotelsController");

const { tryAuth, allowRoles } = require("../middleware/hotelInspectionAccess");
const inspectionUpload = require("../middleware/hotelInspectionUpload");

// Создание/редактирование отеля — провайдер/турагент/агентство/поставщик (админ/модер тоже ок)
const providerOrAdmin = allowRoles("provider", "tour_agent", "agency", "supplier", "hotel");

// Создание инспекции — только для провайдера/турагента/агентства/поставщика
const providerOnly    = allowRoles("provider", "tour_agent", "agency", "supplier", "hotel");
const reviewerOnly    = allowRoles("provider", "tour_agent", "agency", "supplier", "hotel", "client", "user");

// Лайк — авторизованный toggle (уникальность на пользователя)
// Разрешаем: провайдер/агент/агентство/поставщик/клиент/юзер
const canLike = allowRoles("provider", "tour_agent", "agency", "supplier", "client", "user");

/* ==================== Публичные ==================== */
router.get("/search", tryAuth, searchHotels);
router.get("/ranked", tryAuth, listRankedHotels);
router.get("/_list", tryAuth, listHotels);
router.get("/readiness", allowRoles("provider", "tour_agent", "agency", "supplier", "hotel"), listHotelReadiness);
// R2 media proxy for Hotel Passport uploads. Must stay before dynamic /:id route.
// R2 object keys contain slashes, therefore the wildcard route is required.
router.get("/media/*", getHotelInspectionMedia);
router.get("/media/:key", getHotelInspectionMedia);

/* ===  список по городу для каскада === */
router.get("/by-city", listHotelsByCity);   // /api/hotels/by-city?city=Samarkand
router.post("/quote", tryAuth, quoteHotel);

/* ===== МОИ ОТЕЛИ (для провайдера) — ДО динамических ===== */
router.get("/mine", providerOnly, listMyHotels);

/* --- лайки инспекций (авторизация обязательна) --- */
// ставим выше, чтобы не конфликтовало с "/:id/inspections"
router.post("/inspections/:id/like", canLike, likeInspection);
router.patch("/inspections/:id", reviewerOnly, inspectionUpload, updateHotelInspection);
router.put("/inspections/:id", reviewerOnly, inspectionUpload, updateHotelInspection);
router.delete("/inspections/:id", reviewerOnly, deleteHotelInspection);
router.patch("/inspections/:id/moderation", allowRoles("admin", "moderator"), moderateHotelInspection);
router.put("/inspections/:id/moderation", allowRoles("admin", "moderator"), moderateHotelInspection);
router.post("/inspections/:id/report", tryAuth, reportHotelInspection);
router.patch("/inspections/comments/:commentId/moderation", allowRoles("admin", "moderator"), moderateInspectionComment);
router.put("/inspections/comments/:commentId/moderation", allowRoles("admin", "moderator"), moderateInspectionComment);
router.post("/inspections/comments/:commentId/report", tryAuth, reportInspectionComment);
router.get("/inspections/:id/comments", tryAuth, listInspectionComments);
router.post("/inspections/:id/comments", reviewerOnly, createInspectionComment);
router.get("/inspections", tryAuth, listAllHotelInspections);

/* --- инспекции отелей --- */
// просмотр — публичный, но с tryAuth (если есть токен, «мои» поднимутся выше и будет liked_by_me)
router.get("/:id/inspections", tryAuth, listHotelInspections);
// создание обзора — провайдеры и клиенты; поддерживает JSON и multipart/form-data с полем files
router.post("/:id/inspections", reviewerOnly, inspectionUpload, createHotelInspection);

/* === "бриф" отеля для конструктора === */
router.get("/:id/brief", getHotelBrief);   // /api/hotels/:id/brief

/* --- карточка отеля --- */
router.get("/:id", tryAuth, getHotel);  // ← чтобы распарсить токен и пропустить админа

/* ==================== CRUD отеля (для провайдера/админа) ==================== */
router.post("/", providerOrAdmin, createHotel);
router.put("/:id", providerOrAdmin, updateHotel);

module.exports = router;
