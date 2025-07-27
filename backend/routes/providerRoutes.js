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
  deleteService
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
router.get("/booked-dates", authenticate, getBookedDates);

module.exports = router;
