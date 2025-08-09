const express = require("express");
const router = express.Router();

const {
  // auth
  registerProvider,
  loginProvider,
  // profile
  getProviderProfile,
  updateProviderProfile,
  changeProviderPassword,
  // services
  addService,
  getServices,
  updateService,
  deleteService,
  // calendar
  getBookedDates,
  getBlockedDates,
  saveBlockedDates,
  getBlockedDatesHistory,
  exportBlockedDatesICS,
} = require("../controllers/providerController");

const authenticateToken = require("../middleware/authenticateToken");

/* ===== Аутентификация ===== */
router.post("/register", registerProvider);
router.post("/login", loginProvider);

/* ===== Профиль ===== */
router.get("/profile", authenticateToken, getProviderProfile);
router.put("/profile", authenticateToken, updateProviderProfile);
router.put("/change-password", authenticateToken, changeProviderPassword);

/* ===== Услуги ===== */
router.post("/services", authenticateToken, addService);
router.get("/services", authenticateToken, getServices);
router.put("/services/:id", authenticateToken, updateService);
router.delete("/services/:id", authenticateToken, deleteService);

/* ===== Календарь ===== */
router.get("/booked-dates", authenticateToken, getBookedDates);
router.get("/blocked-dates", authenticateToken, getBlockedDates);              // → ["YYYY-MM-DD", ...]
router.get("/blocked-dates/history", authenticateToken, getBlockedDatesHistory);
router.post("/blocked-dates", authenticateToken, saveBlockedDates);            // { add:[{date,reason}], remove:[...] }
router.get("/blocked-dates/export", authenticateToken, exportBlockedDatesICS); // .ics

module.exports = router;
