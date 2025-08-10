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
  saveBlockedDates
} = require("../controllers/providerController");

const authenticateToken = require("../middleware/authenticateToken");

// Auth
router.post("/register", registerProvider);
router.post("/login", loginProvider);

// Profile
router.get("/profile", authenticateToken, getProviderProfile);
router.put("/profile", authenticateToken, updateProviderProfile);
router.put("/change-password", authenticateToken, changeProviderPassword);

// Services
router.post("/services", authenticateToken, addService);
router.get("/services", authenticateToken, getServices);
router.put("/services/:id", authenticateToken, updateService);
router.delete("/services/:id", authenticateToken, deleteService);

// Calendar
router.get("/booked-dates", authenticateToken, getBookedDates);
router.post("/blocked-dates", authenticateToken, saveBlockedDates);

module.exports = router;
