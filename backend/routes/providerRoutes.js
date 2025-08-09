const express = require("express");
const router = express.Router();
const {
  registerProvider,
  loginProvider,
  getProviderProfile,
  updateProviderProfile,
  addService,
  getServices,
  getBookedDates,
  getBlockedDates,
  saveBlockedDates,
  getBlockedDatesHistory,
  exportBlockedDatesICS
} = require("../controllers/providerController");

const authenticateToken = require("../middleware/authenticateToken");

// 👉 Аутентификация
router.post("/register", registerProvider);
router.post("/login", loginProvider);

// 👉 Профиль
router.get("/profile", authenticateToken, getProviderProfile);
router.put("/profile", authenticateToken, updateProviderProfile);

// 👉 Услуги
router.post("/services", authenticateToken, addService);
router.get("/services", authenticateToken, getServices);

// 👉 Календарь: брони
router.get("/booked-dates", authenticateToken, getBookedDates);

// 👉 Календарь: блокировки
router.get("/blocked-dates", authenticateToken, getBlockedDates);
router.post("/blocked-dates", authenticateToken, saveBlockedDates);

// 👉 История
router.get("/blocked-dates/history", authenticateToken, getBlockedDatesHistory);

// 👉 Экспорт .ics
router.get("/blocked-dates/export", authenticateToken, exportBlockedDatesICS);

module.exports = router;
