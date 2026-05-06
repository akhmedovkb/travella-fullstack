// backend/routes/providerSupportRoutes.js
const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const {
  adminSupportSettings,
  adminUpdateSupportSettings,
  adminSupportDonations,
} = require("../controllers/providerSupportController");

const router = express.Router();

router.get("/provider-support/settings", authenticateToken, requireAdmin, adminSupportSettings);
router.put("/provider-support/settings", authenticateToken, requireAdmin, adminUpdateSupportSettings);
router.get("/provider-support/donations", authenticateToken, requireAdmin, adminSupportDonations);

module.exports = router;
