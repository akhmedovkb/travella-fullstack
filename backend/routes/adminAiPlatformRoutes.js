// backend/routes/adminAiPlatformRoutes.js

const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");
const { getAiConfig } = require("../ai/core/aiConfig");
const { listAiEmployees } = require("../ai/core/aiEmployeeRegistry");
const { listJobs, getJob } = require("../ai/core/aiJobStore");
const { runAiRuntime } = require("../ai/core/aiRuntime");
const {
  runVideoOperatorTask,
  createScriptFromManualContext,
  listVideoOperatorJobs,
} = require("../ai/videoOperator/videoOperator.runtime");

router.use(authenticateToken);
router.use(requireAdmin);

router.get("/status", (req, res) => {
  const config = getAiConfig();
  const jobs = listJobs({ limit: 100 });
  res.json({
    success: true,
    employees: listAiEmployees(),
    video: {
      enabled: config.video.enabled,
      heygenReady: config.video.heygen.ready,
      format: config.video.format,
      resolution: config.video.resolution,
    },
    metrics: {
      jobs: jobs.length,
      activeJobs: jobs.filter((x) => ["created", "queued", "running", "processing"].includes(String(x.status || "").toLowerCase())).length,
    },
  });
});

router.post("/tasks", async (req, res) => {
  const command = String(req.body?.command || "").trim();
  if (!command) return res.status(400).json({ success: false, message: "Command is required" });

  const result = await runAiRuntime({
    command,
    employeeId: req.body?.employeeId || "auto",
    actor: { id: req.user?.id || req.user?.userId || null, role: req.user?.role || req.user?.roles || null },
  });

  const status = result.success ? 200 : result.error?.code === "SERVICE_CODE_REQUIRED" ? 400 : 404;
  return res.status(status).json(result);
});

// Backward compatibility with previous frontend stage.
router.post("/video-operator/script", async (req, res) => {
  const code = String(req.body?.code || "").trim();
  if (code && /^R\s*\d+/i.test(code)) {
    const result = await runVideoOperatorTask({ command: `Создай сценарий для ${code}`, actor: { id: req.user?.id || null } });
    return res.status(result.success ? 200 : 404).json(result);
  }
  const result = await createScriptFromManualContext(req.body || {});
  return res.json(result);
});

router.post("/video-operator/heygen-video", async (req, res) => {
  const code = String(req.body?.code || "").trim();
  const result = await runVideoOperatorTask({ command: `Подготовь видео для ${code || "отказного тура"}`, actor: { id: req.user?.id || null } });
  if (!result.success) return res.status(404).json(result);
  return res.json({
    ...result,
    output: {
      ...result.output,
      heygen: { status: "not_started", message: "HeyGen запуск будет подключён следующим этапом после утверждения реального data-flow." },
    },
  });
});

router.get("/video-operator/jobs", (req, res) => {
  res.json({ success: true, jobs: listVideoOperatorJobs({ limit: req.query.limit || 30 }) });
});

router.post("/video-operator/jobs/:id/refresh", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ success: false, message: "Job not found" });
  res.json({ success: true, job, message: "На этом этапе обновление статуса HeyGen ещё не подключено." });
});

module.exports = router;
