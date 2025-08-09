const express = require("express");
const router = express.Router();
const {
  registerProvider,
  loginProvider,
  getProviderProfile,
  updateProviderProfile,
  changeProviderPassword,
  addService,
  getServices,
  updateService,
  deleteService,
  getBookedDates,
  getBlockedDates,
  saveBlockedDates, // ✅ используем только его
} = require("../controllers/providerController");

const authenticateToken = require("../middleware/authenticateToken");

// 👉 Аутентификация
router.post("/register", registerProvider);
router.post("/login", loginProvider);

// 👉 Профиль
router.get("/profile", authenticateToken, getProviderProfile);
router.put("/profile", authenticateToken, updateProviderProfile);
router.put("/change-password", authenticateToken, changeProviderPassword);

// 👉 Услуги
router.post("/services", authenticateToken, addService);
router.get("/services", authenticateToken, getServices);
router.put("/services/:id", authenticateToken, updateService);
router.delete("/services/:id", authenticateToken, deleteService);

// 👉 Календарь
router.get("/booked-dates", authenticateToken, getBookedDates);
router.get("/blocked-dates", authenticateToken, getBlockedDates);
router.post("/blocked-dates", authenticateToken, saveBlockedDates); // ✅ актуальный маршрут

module.exports = router;
