// backend/routes/activityEventsRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");
const {
  trackActivityEvent,
  getActivityEvents,
  getActivitySessions,
} = require("../controllers/activityEventsController");

const router = express.Router();

function tryAuth(req, res, next) {
  const hdr = req.headers?.authorization || "";
  if (!hdr) return next();
  authenticateToken(req, res, () => next());
}

router.post("/activity/track", tryAuth, trackActivityEvent);
router.get("/admin/activity-events", authenticateToken, requireAdmin, getActivityEvents);
router.get("/admin/activity-events/sessions", authenticateToken, requireAdmin, getActivitySessions);

module.exports = router;
