//providerRoutes.js

const express = require("express");
const router = express.Router();
const {
  registerProvider,
  loginProvider,
  getProviderProfile,
  updateProviderProfile,
  changeProviderPassword, // ✅ добавлено сюда
  addService,
  getServices,
  updateService,
  deleteService,
  getBookedDates,
  getBlockedDates,
  updateBlockedDates,
  unblockDate,
  deleteBlockedDate,
} = require("../controllers/providerController");

const authenticateToken = require("../middleware/authenticateToken");

// 👉 Аутентификация
router.post("/register", registerProvider);
router.post("/login", loginProvider);

// 👉 Профиль
router.get("/profile", authenticateToken, getProviderProfile);
router.put("/profile", authenticateToken, updateProviderProfile);

// 👉 Смена пароля поставщика
router.put("/change-password", authenticateToken, changeProviderPassword);

// 👉 Услуги
router.post("/services", authenticateToken, addService);        // Добавить услугу
router.get("/services", authenticateToken, getServices);        // Получить все услуги
router.put("/services/:id", authenticateToken, updateService);  // Обновить услугу
router.delete("/services/:id", authenticateToken, deleteService); // Удалить услугу

// 👉 Календарь
router.get("/booked-dates", authenticateToken, getBookedDates);
router.get("/blocked-dates", authenticateToken, getBlockedDates);
router.post("/unblock-date", authenticateToken, unblockDate);
router.post("/blocked-dates", authenticateToken, updateBlockedDates);
router.delete("/blocked-dates", authenticateToken, deleteBlockedDate);
router.post('/blocked-dates', authenticateToken, saveBlockedDates);

module.exports = router;
