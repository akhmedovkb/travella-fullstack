// backend/routes/adminAiPlatformRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");
const { getPublicAiStatus } = require("../ai/core/aiConfig");
const { listAiEmployees, getAiEmployee } = require("../ai/core/aiEmployeeRegistry");
const {
  prepareVideoOperatorScript,
  createVideoOperatorVideo,
  refreshVideoOperatorJob,
  listVideoOperatorJobs,
} = require("../ai/videoOperator/videoOperator.service");

const router = express.Router();

router.use(authenticateToken, requireAdmin);

router.get("/status", async (_req, res) => {
  res.json({
    ...getPublicAiStatus(),
    employees: listAiEmployees(),
  });
});

router.get("/employees", async (_req, res) => {
  res.json({ ok: true, employees: listAiEmployees() });
});

router.get("/employees/:id", async (req, res) => {
  const employee = getAiEmployee(req.params.id);
  if (!employee) return res.status(404).json({ ok: false, error: "employee_not_found" });
  res.json({ ok: true, employee });
});

router.get("/video-operator/jobs", async (req, res) => {
  const limit = Number(req.query.limit || 25);
  res.json({ ok: true, jobs: listVideoOperatorJobs(limit) });
});

router.post("/video-operator/script", async (req, res) => {
  try {
    const result = await prepareVideoOperatorScript(req.body || {});
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error("POST /api/admin/ai-platform/video-operator/script error:", error);
    res.status(500).json({ ok: false, error: error.message || "script_failed" });
  }
});

router.post("/video-operator/heygen-video", async (req, res) => {
  try {
    const result = await createVideoOperatorVideo(req.body || {});
    if (result.error) {
      return res.status(result.error.status || 500).json({ ok: false, ...result });
    }
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error("POST /api/admin/ai-platform/video-operator/heygen-video error:", error);
    res.status(error.status || 500).json({ ok: false, error: error.message || "heygen_failed", data: error.data || null });
  }
});

router.post("/video-operator/jobs/:jobId/refresh", async (req, res) => {
  try {
    const job = await refreshVideoOperatorJob(req.params.jobId);
    if (!job) return res.status(404).json({ ok: false, error: "job_not_found" });
    res.json({ ok: true, job });
  } catch (error) {
    console.error("POST /api/admin/ai-platform/video-operator/jobs/:jobId/refresh error:", error);
    res.status(error.status || 500).json({ ok: false, error: error.message || "refresh_failed", data: error.data || null });
  }
});

module.exports = router;
