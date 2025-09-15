// backend/routes/hotelRoutes.js
const express = require("express");
const router = express.Router();

const {
  searchHotels,
  getHotel,
  createHotel,
  listHotels,
  updateHotel, // добавили апдейт
} = require("../controllers/hotelsController");

const {
  createInspection,
  listInspections,
} = require("../controllers/hotelInspectionController");

// ── Мягкий фолбек для мидлвара авторизации провайдера ──
// если файла нет — просто пропускаем запросы (не ломаем прод)
let requireProviderAuth = (req, _res, next) => next();
try {
  // eslint-disable-next-line global-require, import/no-unresolved
  ({ requireProviderAuth } = require("../middlewares/auth"));
} catch (_e) {
  console.warn("[hotelRoutes] middlewares/auth not found — running without provider auth");
}

/** 
 * ВАЖНО: все пути здесь относительные к префиксу, 
 * с которым вы монтируете роутер: app.use("/api/hotels", router)
 */

// Поиск
router.get("/search", searchHotels);
router.get("/", searchHotels); // алиас: без параметров вернёт список локальных по алфавиту

// Доп. список без фильтра (для админов — удобно листать/редактировать)
router.get("/_list/all", listHotels);

// Создание/обновление (можно защитить мидлваром авторизации провайдера)
router.post("/", requireProviderAuth, createHotel);
router.put("/:id", requireProviderAuth, updateHotel);

// Карточка отеля
router.get("/:id", getHotel);

// Инспекции
router.get("/:hotelId/inspections", listInspections);
router.post("/:hotelId/inspections", requireProviderAuth, createInspection);

module.exports = router;
