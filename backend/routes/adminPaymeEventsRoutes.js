// backend/routes/adminPaymeEventsRoutes.js
const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const {
  adminPaymeEvents,
  adminPaymeEventDetails,
} = require("../controllers/adminPaymeEventsController");

const router = express.Router();

// GET /api/admin/payme/events?limit=200&offset=0&q=...&method=...&stage=...
router.get("/events", authenticateToken, requireAdmin, adminPaymeEvents);

// GET /api/admin/payme/events/:id
router.get("/events/:id", authenticateToken, requireAdmin, adminPaymeEventDetails);

module.exports = router;
