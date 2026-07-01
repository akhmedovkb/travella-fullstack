// backend/routes/activityEventsRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");
const {
  trackActivityEvent,
  getActivityEvents,
  getActivityOverview,
  getActivitySessions,
  getActivityTimeline,
  getActivityFunnel,
  getActivityHotLeads,
  getActivityServices,
} = require("../controllers/activityEventsController");

const router = express.Router();

function tryAuth(req, res, next) {
  const hdr = req.headers?.authorization || "";
  if (!hdr) return next();
  authenticateToken(req, res, () => next());
}

router.post("/activity/track", tryAuth, trackActivityEvent);

router.get("/admin/activity-events", authenticateToken, requireAdmin, getActivityEvents);
router.get("/admin/activity-events/overview", authenticateToken, requireAdmin, getActivityOverview);
router.get("/admin/activity-events/sessions", authenticateToken, requireAdmin, getActivitySessions);
router.get("/admin/activity-events/timeline", authenticateToken, requireAdmin, getActivityTimeline);
router.get("/admin/activity-events/funnel", authenticateToken, requireAdmin, getActivityFunnel);
router.get("/admin/activity-events/hot-leads", authenticateToken, requireAdmin, getActivityHotLeads);
router.get("/admin/activity-events/services", authenticateToken, requireAdmin, getActivityServices);

module.exports = router;
