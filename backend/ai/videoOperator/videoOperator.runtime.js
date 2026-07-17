// backend/ai/videoOperator/videoOperator.runtime.js

const { createJob, addEvent, updateJob, listJobs, getJob } = require("../core/aiJobStore");
const { routeAiTask } = require("../core/taskRouter");
const { createAvatarVideo, getAvatarVideo } = require("./heygen.client");
const { findRefusedServiceByCode, findLatestRefusedService, listRecentRefusedServices } = require("./refusedServiceLookup");
const { saveHeygenVideoArtifact } = require("./videoArtifactStore");
const {
  buildHook,
  buildScript,
  buildAnalysis,
  buildScriptReview,
  buildPublishingDrafts,
} = require("./videoPromptSystem");

function clean(value, fallback = "") {
  const s = String(value ?? "").trim();
  return s || fallback;
}

function extractHeygenVideoId(response) {
  return (
    response?.data?.video_id ||
    response?.data?.videoId ||
    response?.data?.id ||
    response?.event_data?.video_id ||
    response?.event_data?.videoId ||
    response?.video?.video_id ||
    response?.video?.videoId ||
    response?.video_id ||
    response?.videoId ||
    response?.callback_id ||
    response?.id ||
    ""
  );
}

function getHeygenStatus(response) {
  const eventType = String(response?.event_type || response?.event || response?.type || "").toLowerCase();
  if (/(complete|completed|ready|success)/.test(eventType)) return "completed";
  if (/(fail|failed|error)/.test(eventType)) return "failed";

  return (
    response?.data?.status ||
    response?.status ||
    response?.data?.video_status ||
    response?.video_status ||
    response?.event_data?.status ||
    response?.event_data?.video_status ||
    response?.video?.status ||
    response?.video?.video_status ||
    "submitted"
  );
}

function extractHeygenVideoUrl(response) {
  return (
    response?.data?.video_url ||
    response?.data?.videoUrl ||
    response?.data?.url ||
    response?.data?.download_url ||
    response?.data?.downloadUrl ||
    response?.event_data?.video_url ||
    response?.event_data?.videoUrl ||
    response?.event_data?.url ||
    response?.event_data?.download_url ||
    response?.event_data?.downloadUrl ||
    response?.video?.video_url ||
    response?.video?.videoUrl ||
    response?.video?.url ||
    response?.video?.download_url ||
    response?.video?.downloadUrl ||
    response?.video_url ||
    response?.videoUrl ||
    response?.download_url ||
    response?.downloadUrl ||
    response?.url ||
    ""
  );
}

function isHeygenReady(status) {
  return ["completed", "complete", "done", "ready", "success"].includes(String(status || "").toLowerCase());
}

function findHeygenVideoId(job = {}) {
  const fromOutput = job.output?.heygen?.videoId || job.output?.heygen?.video_id || "";
  if (fromOutput) return String(fromOutput);

  const events = Array.isArray(job.events) ? [...job.events].reverse() : [];
  for (const event of events) {
    const fromMeta = event?.meta?.videoId || event?.meta?.video_id || "";
    if (fromMeta) return String(fromMeta);
    const match = String(event?.message || "").match(/Video ID:\s*([a-zA-Z0-9_-]+)/i);
    if (match?.[1]) return match[1];
  }
  return "";
}

function findVideoOperatorJobByHeygenVideoId(videoId) {
  const target = String(videoId || "").trim();
  if (!target) return null;
  return listJobs({ employeeId: "video_operator", limit: 100 }).find((job) => findHeygenVideoId(job) === target) || null;
}

async function saveArtifactIfReady(job, output, heygen) {
  if (!isHeygenReady(heygen?.status) || !heygen?.videoUrl || heygen?.artifact?.url || heygen?.artifact?.status === "saving") {
    return { output, heygen };
  }

  addEvent(job.id, {
    step: "artifact",
    type: "tool_call",
    tool: "TravellaMediaStore",
    message: "Видео готово в HeyGen. Сохраняю MP4 в медиахранилище Travella.",
  });

  try {
    const artifact = await saveHeygenVideoArtifact({
      jobId: job.id,
      videoId: heygen.videoId,
      videoUrl: heygen.videoUrl,
      serviceCode: output.service?.code || output.service?.videoContext?.code || "",
    });
    const nextHeygen = { ...heygen, artifact };
    const nextOutput = { ...output, heygen: nextHeygen };
    addEvent(job.id, {
      step: "artifact",
      type: "tool_result",
      tool: "TravellaMediaStore",
      message: "MP4 сохранён в медиахранилище Travella.",
      meta: { provider: artifact.provider, url: artifact.url, key: artifact.key || artifact.publicId || "" },
    });
    return { output: nextOutput, heygen: nextHeygen };
  } catch (err) {
    const artifact = {
      status: "failed",
      error: err?.message || "media_artifact_save_failed",
      failedAt: new Date().toISOString(),
    };
    const nextHeygen = { ...heygen, artifact };
    const nextOutput = { ...output, heygen: nextHeygen };
    addEvent(job.id, {
      step: "artifact",
      level: "error",
      tool: "TravellaMediaStore",
      message: artifact.error,
    });
    return { output: nextOutput, heygen: nextHeygen };
  }
}

function shouldUseLatestService(command) {
  const text = String(command || "").toLowerCase();
  return /(сегодня|лучший|последн|актуальн|любой|сам выбери|выбери сам)/i.test(text);
}

function formatServiceSuggestions(services = []) {
  return services
    .slice(0, 6)
    .map((service) => {
      const ctx = service.videoContext || {};
      const price = ctx.price ? `, ${ctx.price} ${ctx.currency || "USD"}` : "";
      return `${service.code} — ${ctx.title || service.title || ctx.category || "отказное предложение"}${price}`;
    })
    .join("\n");
}

async function runVideoOperatorTask({ command, actor = {}, runtimeRoute = null }) {
  const route = runtimeRoute || routeAiTask(command);
  const job = createJob({
    employeeId: "video_operator",
    type: route.action,
    command,
    input: { route, actor },
    status: "running",
  });

  try {
    addEvent(job.id, { step: "runtime", type: "thought", message: "Понял задачу и выбрал нужного цифрового сотрудника." });
    addEvent(job.id, { step: "task_router", type: "tool_call", tool: "TaskRouter", message: "TaskRouter определил: сотрудник Video Operator, действие " + route.action + ".", meta: route });

    let service = null;

    if (!route.serviceCode && shouldUseLatestService(command)) {
      addEvent(job.id, { step: "source", type: "tool_call", tool: "MarketplaceLookup", message: "Код не указан. Ищу последний активный отказной тур в базе Travella." });
      const latest = await findLatestRefusedService();
      if (!latest.found) {
        const error = { code: latest.reason || "NO_REFUSED_SERVICES", message: "Не нашёл активные отказные туры в базе Travella." };
        addEvent(job.id, { step: "source", level: "error", message: error.message });
        updateJob(job.id, { status: "failed", error });
        return { success: false, job: getJob(job.id), error };
      }
      service = latest.service;
      route.serviceCode = service.code;
    }

    if (!route.serviceCode) {
      addEvent(job.id, { step: "source", level: "error", message: "В задаче не найден код отказного тура формата R857." });
      const error = { code: "SERVICE_CODE_REQUIRED", message: "Напиши код отказного тура, например: Создай видео для R857" };
      updateJob(job.id, { status: "failed", error });
      return { success: false, job: getJob(job.id), error };
    }

    let lookup = { found: true, service };
    if (!service) {
      addEvent(job.id, { step: "source", type: "tool_call", tool: "MarketplaceLookup", message: `Ищу реальный отказной тур ${route.serviceCode} в базе Travella.` });
      lookup = await findRefusedServiceByCode(route.serviceCode);
    }

    if (!lookup.found) {
      const suggestions = await listRecentRefusedServices({ limit: 6 }).catch(() => []);
      const suggestionText = formatServiceSuggestions(suggestions);
      const message = suggestionText
        ? `Не нашёл активный отказной тур ${route.serviceCode} в базе Travella.\n\nДоступные отказные предложения:\n${suggestionText}\n\nНапиши, например: “Создай видео для ${suggestions[0]?.code || "R..." }”.`
        : `Не нашёл активный отказной тур ${route.serviceCode} в базе Travella.`;
      const error = { code: lookup.reason || "NOT_FOUND", message, suggestions: suggestions.map((x) => ({ id: x.id, code: x.code, title: x.title, category: x.category, status: x.status })) };
      addEvent(job.id, { step: "source", level: "error", message: error.message });
      updateJob(job.id, { status: "failed", error });
      return { success: false, job: getJob(job.id), error };
    }

    service = lookup.service;
    const ctx = service.videoContext;
    addEvent(job.id, { step: "source", type: "tool_result", tool: "MarketplaceLookup", message: `Нашёл ${ctx.category}: ${ctx.title}.`, meta: { serviceId: service.id, code: service.code } });

    const analysis = buildAnalysis(ctx);
    addEvent(job.id, { step: "analysis", type: "thought", message: "Анализирую направление, цену, срочность, аудиторию и главный триггер." });
    addEvent(job.id, { step: "analysis", type: "tool_result", tool: "OfferAnalyzer", message: "Проанализировал оффер, цену, срочность и главный триггер.", meta: analysis });

    const scriptOptions = {
      scriptMode: route.scriptMode || "default",
      variantSalt: route.variantSalt || "",
    };
    const hook = buildHook(ctx, scriptOptions);
    addEvent(job.id, { step: "plan", type: "tool_call", tool: "HookBuilder", message: "Подбираю безопасный хук для первых 3 секунд." });
    addEvent(job.id, { step: "plan", type: "tool_result", tool: "HookBuilder", message: "Хук готов без неподтверждённых обещаний." });

    const script = buildScript(ctx, scriptOptions);
    const scriptReview = buildScriptReview(ctx, script);
    const publishingDrafts = buildPublishingDrafts(ctx);
    addEvent(job.id, { step: "plan", type: "tool_call", tool: "AvatarScriptBuilder", message: "Готовлю текст для AI-аватара по правилам Travella." });
    addEvent(job.id, { step: "plan", type: "tool_result", tool: "AvatarScriptBuilder", message: "Сценарий готов и ждёт ручного утверждения." });
    addEvent(job.id, { step: "review", type: "tool_result", tool: "PromptQualityCheck", message: scriptReview.approvalGate, meta: { status: scriptReview.status, missingFields: scriptReview.missingFields } });

    const output = {
      route,
      service,
      analysis,
      hook,
      script,
      scriptReview,
      publishingDrafts,
      nextStep:
        route.action === "prepare_video"
          ? "Сценарий готов к проверке. Проверь текст ниже и только потом нажми “Утвердить и отправить в HeyGen”."
          : "Сценарий готов к проверке. HeyGen не запустится без ручного утверждения.",
    };

    updateJob(job.id, { status: "script_ready", output });
    addEvent(job.id, { step: "result", type: "tool_result", tool: "AiJobStore", message: "Результат сохранён в истории Travella AI OS." });

    return { success: true, job: getJob(job.id), output };
  } catch (err) {
    const error = { code: "VIDEO_OPERATOR_ERROR", message: err?.message || "Video Operator failed" };
    addEvent(job.id, { step: "runtime", level: "error", message: error.message });
    updateJob(job.id, { status: "failed", error });
    return { success: false, job: getJob(job.id), error };
  }
}

async function createScriptFromManualContext(ctx = {}) {
  const command = `Создай сценарий для ${ctx.code || "ручного контекста"}`;
  const job = createJob({ employeeId: "video_operator", type: "manual_script", command, input: ctx, status: "running" });
  const normalized = { ...ctx, category: ctx.category || "Отказной тур" };
  const script = buildScript(normalized);
  const output = {
    hook: buildHook(normalized),
    script,
    scriptReview: buildScriptReview(normalized, script),
    publishingDrafts: buildPublishingDrafts(normalized),
    service: { videoContext: normalized },
    manual: true,
    nextStep: "Сценарий готов к проверке. HeyGen не запустится без ручного утверждения.",
  };
  updateJob(job.id, { status: "script_ready", output });
  addEvent(job.id, { step: "manual", message: "Сценарий создан из ручного контекста." });
  return { success: true, job: getJob(job.id), output };
}

async function startHeygenForVideoJob({ jobId, actor = {} }) {
  const job = getJob(jobId);
  if (!job) {
    return { success: false, error: { code: "JOB_NOT_FOUND", message: "AI job not found" } };
  }

  const output = job.output || {};
  if (!output.script) {
    return { success: false, job, error: { code: "SCRIPT_REQUIRED", message: "Сначала нужно подготовить сценарий." } };
  }

  if (output.heygen?.videoId) {
    return { success: true, job, output, message: "HeyGen уже был запущен для этой задачи." };
  }

  addEvent(job.id, {
    step: "heygen",
    type: "tool_call",
    tool: "HeyGen",
    message: "Получено ручное утверждение сценария. Отправляю текст в HeyGen.",
    meta: { actor },
  });

  try {
    const response = await createAvatarVideo({
      script: output.script,
      title: `${output.service?.videoContext?.code || "Travella"} ${output.service?.videoContext?.title || "Video"}`,
      aspectRatio: "9:16",
      resolution: "1080p",
      idempotencyKey: `travella-ai-video-${job.id}`,
    });

    const videoId = extractHeygenVideoId(response);
    const heygen = {
      provider: "heygen",
      status: getHeygenStatus(response),
      videoId,
      videoUrl: extractHeygenVideoUrl(response),
      response,
      submittedAt: new Date().toISOString(),
    };

    const saved = await saveArtifactIfReady(job, output, heygen);
    const nextOutput = saved.output;
    const nextHeygen = saved.heygen;
    updateJob(job.id, { status: isHeygenReady(nextHeygen.status) ? "video_ready" : "video_submitted", output: nextOutput });
    addEvent(job.id, {
      step: "heygen",
      type: "tool_result",
      tool: "HeyGen",
      message: videoId ? `HeyGen принял задачу. Video ID: ${videoId}` : "HeyGen принял задачу.",
      meta: { videoId, status: nextHeygen.status },
    });

    return { success: true, job: getJob(job.id), output: nextOutput };
  } catch (err) {
    if (err?.code === "AI_VIDEO_DISABLED") {
      const nextOutput = {
        ...output,
        heygen: {
          provider: "heygen",
          status: "disabled",
          error: err.message,
          checkedAt: new Date().toISOString(),
        },
      };
      updateJob(job.id, { status: "script_ready", output: nextOutput, error: null });
      addEvent(job.id, {
        step: "heygen",
        level: "warn",
        tool: "HeyGen",
        message: err.message,
      });
      return {
        success: false,
        job: getJob(job.id),
        output: nextOutput,
        error: { code: "AI_VIDEO_DISABLED", message: err.message },
      };
    }

    const heygen = {
      provider: "heygen",
      status: "failed",
      error: err?.message || "HeyGen request failed",
      failedAt: new Date().toISOString(),
    };
    const nextOutput = { ...output, heygen };
    updateJob(job.id, { status: "video_failed", output: nextOutput, error: { code: "HEYGEN_FAILED", message: heygen.error } });
    addEvent(job.id, { step: "heygen", level: "error", tool: "HeyGen", message: heygen.error });
    return { success: false, job: getJob(job.id), output: nextOutput, error: { code: "HEYGEN_FAILED", message: heygen.error } };
  }
}

async function refreshHeygenForVideoJob({ jobId }) {
  const job = getJob(jobId);
  if (!job) return { success: false, error: { code: "JOB_NOT_FOUND", message: "AI job not found" } };

  const output = job.output || {};
  const videoId = output.heygen?.videoId || findHeygenVideoId(job);
  if (!videoId) {
    return { success: false, job, error: { code: "HEYGEN_VIDEO_REQUIRED", message: "Для этой задачи HeyGen ещё не запускался." } };
  }

  try {
    const response = await getAvatarVideo(videoId);
    const heygen = {
      provider: "heygen",
      ...(output.heygen || {}),
      videoId,
      status: getHeygenStatus(response),
      videoUrl: extractHeygenVideoUrl(response) || output.heygen?.videoUrl || "",
      response,
      refreshedAt: new Date().toISOString(),
    };
    const saved = await saveArtifactIfReady(job, output, heygen);
    const nextOutput = saved.output;
    const nextHeygen = saved.heygen;
    updateJob(job.id, { status: isHeygenReady(nextHeygen.status) ? "video_ready" : job.status, output: nextOutput });
    addEvent(job.id, {
      step: "heygen",
      type: "tool_result",
      tool: "HeyGen",
      message: `Статус HeyGen обновлён: ${nextHeygen.status}.`,
      meta: { videoId, status: nextHeygen.status },
    });
    return { success: true, job: getJob(job.id), output: nextOutput };
  } catch (err) {
    addEvent(job.id, { step: "heygen", level: "error", tool: "HeyGen", message: err?.message || "HeyGen refresh failed" });
    return { success: false, job: getJob(job.id), error: { code: "HEYGEN_REFRESH_FAILED", message: err?.message || "HeyGen refresh failed" } };
  }
}

async function handleHeygenWebhook({ payload = {}, headers = {} } = {}) {
  const payloadVideoId = extractHeygenVideoId(payload);
  if (!payloadVideoId) {
    return { success: false, accepted: false, error: { code: "HEYGEN_VIDEO_ID_REQUIRED", message: "Webhook payload has no HeyGen video id" } };
  }

  const job = findVideoOperatorJobByHeygenVideoId(payloadVideoId);
  if (!job) {
    return {
      success: false,
      accepted: true,
      error: { code: "JOB_NOT_FOUND", message: `No Travella AI job found for HeyGen video ${payloadVideoId}` },
    };
  }

  const output = job.output || {};
  const payloadStatus = getHeygenStatus(payload);
  let response = payload;
  let status = payloadStatus;
  let videoUrl = extractHeygenVideoUrl(payload) || output.heygen?.videoUrl || "";

  if (!videoUrl && isHeygenReady(payloadStatus)) {
    try {
      response = await getAvatarVideo(payloadVideoId);
      status = getHeygenStatus(response) || payloadStatus;
      videoUrl = extractHeygenVideoUrl(response) || videoUrl;
    } catch (err) {
      addEvent(job.id, {
        step: "heygen",
        level: "error",
        tool: "HeyGenWebhook",
        message: `Webhook пришёл, но не смог получить детали видео: ${err?.message || "HeyGen lookup failed"}`,
      });
    }
  }

  const heygen = {
    provider: "heygen",
    ...(output.heygen || {}),
    videoId: payloadVideoId,
    status,
    videoUrl,
    response,
    webhook: {
      receivedAt: new Date().toISOString(),
      eventType: payload?.event_type || payload?.event || payload?.type || "",
      signaturePresent: Boolean(headers?.["x-heygen-signature"] || headers?.["x-signature"]),
    },
  };

  const saved = await saveArtifactIfReady(job, output, heygen);
  const nextOutput = saved.output;
  const nextHeygen = saved.heygen;
  const failed = ["failed", "fail", "error"].includes(String(nextHeygen.status || "").toLowerCase());
  const nextStatus = failed ? "video_failed" : isHeygenReady(nextHeygen.status) ? "video_ready" : "video_submitted";

  updateJob(job.id, {
    status: nextStatus,
    output: nextOutput,
    error: failed ? { code: "HEYGEN_FAILED", message: "HeyGen reported failed status" } : null,
  });
  addEvent(job.id, {
    step: "heygen",
    type: "tool_result",
    tool: "HeyGenWebhook",
    message: `HeyGen webhook обновил статус: ${nextHeygen.status}.`,
    meta: { videoId: payloadVideoId, status: nextHeygen.status, hasVideoUrl: Boolean(nextHeygen.videoUrl) },
  });

  return { success: true, accepted: true, job: getJob(job.id), output: nextOutput };
}

function shouldPollHeygenJob(job = {}) {
  const status = String(job.status || "").toLowerCase();
  if (["failed", "video_failed"].includes(status)) return false;

  const heygen = job.output?.heygen || {};
  const videoId = heygen.videoId || findHeygenVideoId(job);
  if (!videoId) return false;

  const artifact = heygen.artifact || {};
  if (artifact.url) return false;

  return status === "video_submitted" || !isHeygenReady(heygen.status) || !heygen.videoUrl;
}

async function runHeygenVideoPollerOnce({ limit = 20 } = {}) {
  const candidates = listJobs({ employeeId: "video_operator", limit: 100 })
    .filter(shouldPollHeygenJob)
    .slice(0, Math.max(1, Math.min(Number(limit) || 20, 50)));

  const summary = {
    checked: 0,
    ready: 0,
    failed: 0,
    skipped: 0,
    jobs: [],
  };

  for (const job of candidates) {
    summary.checked += 1;
    const result = await refreshHeygenForVideoJob({ jobId: job.id });
    const nextJob = result.job || getJob(job.id) || job;
    const nextStatus = String(nextJob.status || "").toLowerCase();

    if (result.success && nextStatus === "video_ready") summary.ready += 1;
    if (!result.success || nextStatus === "video_failed") summary.failed += 1;

    summary.jobs.push({
      jobId: job.id,
      success: Boolean(result.success),
      status: nextJob.status || job.status || "",
      videoId: nextJob.output?.heygen?.videoId || findHeygenVideoId(nextJob),
      artifactReady: Boolean(nextJob.output?.heygen?.artifact?.url),
      error: result.error?.message || "",
    });
  }

  summary.skipped = Math.max(0, listJobs({ employeeId: "video_operator", limit: 100 }).filter(shouldPollHeygenJob).length - candidates.length);
  return summary;
}

module.exports = {
  runVideoOperatorTask,
  createScriptFromManualContext,
  startHeygenForVideoJob,
  refreshHeygenForVideoJob,
  handleHeygenWebhook,
  runHeygenVideoPollerOnce,
  listVideoOperatorJobs: (opts) => listJobs({ employeeId: "video_operator", ...opts }),
};
