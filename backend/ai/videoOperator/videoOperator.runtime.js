// backend/ai/videoOperator/videoOperator.runtime.js

const { createJob, addEvent, updateJob, listJobs, getJob } = require("../core/aiJobStore");
const { routeAiTask } = require("../core/taskRouter");
const { getAiVideoProfileSetting } = require("../core/aiRuntimeSettings");
const { createAvatarVideo, getAvatarVideo } = require("./heygen.client");
const { findRefusedServiceByCode, findLatestRefusedService, listRecentRefusedServices } = require("./refusedServiceLookup");
const { saveHeygenVideoArtifact, saveVideoOperatorImportedMedia } = require("./videoArtifactStore");
const { renderSoundPlanToArtifact } = require("./soundRenderWorker");
const {
  buildHook,
  buildScript,
  buildMotionPrompt,
  buildAnalysis,
  buildScriptReview,
  buildPublishingDrafts,
} = require("./videoPromptSystem");

function clean(value, fallback = "") {
  const s = String(value ?? "").trim();
  return s || fallback;
}

function estimateSpeechSeconds(script = "") {
  const words = String(script || "").trim().split(/\s+/).filter(Boolean).length;
  if (!words) return 0;
  return Math.max(5, Math.round(words / 2.5));
}

function normalizeSoundCue(cue = {}, index = 0) {
  const time = Number(cue.time);
  const volume = Number(cue.volume);
  const duration = Number(cue.duration);
  return {
    id: clean(cue.id, `sfx_${index + 1}`),
    assetId: clean(cue.assetId, "soft_whoosh_01"),
    label: clean(cue.label, "Soft whoosh").slice(0, 80),
    url: clean(cue.url, ""),
    mimeType: clean(cue.mimeType, ""),
    time: Number.isFinite(time) ? Math.max(0, Math.round(time * 100) / 100) : 0,
    duration: Number.isFinite(duration) ? Math.max(0.05, Math.min(120, Math.round(duration * 100) / 100)) : undefined,
    volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, Math.round(volume * 100) / 100)) : 0.22,
    enabled: cue.enabled === false ? false : true,
    fadeIn: Math.max(0, Math.min(3, Number(cue.fadeIn ?? 0.05))),
    fadeOut: Math.max(0, Math.min(3, Number(cue.fadeOut ?? 0.25))),
    note: clean(cue.note, "").slice(0, 200),
  };
}

function buildSoundPlan(output = {}, options = {}) {
  const script = String(output.script || "").trim();
  const seconds = estimateSpeechSeconds(script);
  const duration = Number(options.durationSeconds || seconds || 35);
  const clamp = (value) => Math.max(0, Math.min(Math.max(0, duration - 0.4), Math.round(value * 100) / 100));
  const lower = script.toLowerCase();
  const cues = [
    { assetId: "soft_whoosh_01", label: "Soft whoosh", time: clamp(0.35), volume: 0.2, note: "Открывающий hook." },
  ];

  if (/(отказ|сроч|горит|быстро|сегодня)/i.test(script)) {
    cues.push({ assetId: "urgency_whoosh_01", label: "Urgency whoosh", time: clamp(duration * 0.68), volume: 0.18, note: "Акцент срочности отказного предложения." });
  }
  if (/(цена|usd|доллар|сум|за двоих|за троих|за одного)/i.test(script)) {
    cues.push({ assetId: "soft_price_impact_01", label: "Soft price impact", time: clamp(duration * 0.55), volume: 0.22, note: "Акцент цены без игрового звучания." });
  }
  if (/(пять зв|5 зв|люкс|premium|deluxe|sea view|море|пляж|анталь|дананг|маврик)/i.test(lower)) {
    cues.push({ assetId: "luxury_sparkle_01", label: "Luxury sparkle", time: clamp(duration * 0.36), volume: 0.16, note: "Премиальный акцент на отель/отдых." });
  }
  cues.push({ assetId: "notification_click_01", label: "Notification click", time: clamp(duration * 0.92), volume: 0.18, note: "Финальный CTA." });

  return {
    status: "draft",
    preset: clean(options.preset, "Urgent Deal"),
    durationEstimateSeconds: duration,
    music: {
      assetId: clean(options.musicAssetId, "tropical_luxury_01"),
      label: clean(options.musicLabel, "Tropical luxury"),
      volume: 0.12,
      fadeIn: 1.2,
      fadeOut: 1.8,
      ducking: true,
      targetLufs: -21,
    },
    effects: cues.slice(0, 5).map(normalizeSoundCue),
    render: {
      status: "not_rendered",
      message: "FFmpeg render worker will mix this plan with the active HeyGen MP4.",
    },
    updatedAt: new Date().toISOString(),
  };
}

function saveSoundPlanForVideoJob({ jobId, soundPlan = null, actor = {} }) {
  const job = getJob(jobId);
  if (!job || job.employeeId !== "video_operator") {
    return { success: false, error: { code: "JOB_NOT_FOUND", message: "AI job not found" } };
  }
  const output = job.output || {};
  const plan = soundPlan && typeof soundPlan === "object"
    ? {
        ...buildSoundPlan(output, soundPlan),
        ...soundPlan,
        music: { ...buildSoundPlan(output, soundPlan).music, ...(soundPlan.music || {}) },
        effects: (Array.isArray(soundPlan.effects) ? soundPlan.effects : []).slice(0, 8).map(normalizeSoundCue),
        status: clean(soundPlan.status, "draft"),
        updatedAt: new Date().toISOString(),
        updatedBy: actor,
      }
    : { ...buildSoundPlan(output), updatedBy: actor };
  const nextOutput = {
    ...output,
    soundPlan: plan,
    nextStep: output.heygen?.videoId
      ? "Sound Director подготовил звуковой план. Следующий этап — рендер музыки и SFX."
      : "Sound Director подготовил звуковой план. Сначала создай HeyGen video.",
  };
  const nextJob = updateJob(job.id, { output: nextOutput });
  addEvent(job.id, {
    step: "sound",
    type: "tool_result",
    tool: "SoundDirector",
    message: "Sound Director подготовил музыку и SFX-план для ролика.",
    meta: { effects: plan.effects.length, preset: plan.preset, actor },
  });
  return { success: true, job: nextJob, output: nextJob.output };
}

async function importMediaForVideoJob({ jobId, file, actor = {} }) {
  const job = getJob(jobId);
  if (!job || job.employeeId !== "video_operator") {
    return { success: false, error: { code: "JOB_NOT_FOUND", message: "AI job not found" } };
  }
  if (!file?.buffer?.length) {
    return { success: false, job, output: job.output, error: { code: "EMPTY_FILE", message: "Файл пустой." } };
  }

  const output = job.output || {};
  const serviceCode = output.service?.code || output.service?.videoContext?.code || "";
  const artifact = await saveVideoOperatorImportedMedia({ jobId: job.id, file, serviceCode });
  const media = {
    id: `media_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    type: artifact.type,
    label: clean(file.originalname, artifact.type || "media").slice(0, 120),
    url: artifact.url,
    provider: artifact.provider,
    key: artifact.key || artifact.publicId || "",
    mimeType: artifact.mimeType,
    bytes: artifact.bytes,
    thumbnailUrl: artifact.thumbnailUrl || artifact.url,
    durationSeconds: artifact.durationSeconds || null,
    uploadedAt: new Date().toISOString(),
    uploadedBy: actor,
  };
  const soundPlan = output.soundPlan || buildSoundPlan(output);
  const mediaLibrary = Array.isArray(soundPlan.mediaLibrary) ? soundPlan.mediaLibrary : [];
  const nextOutput = {
    ...output,
    soundPlan: {
      ...soundPlan,
      mediaLibrary: [media, ...mediaLibrary].slice(0, 80),
      updatedAt: new Date().toISOString(),
      updatedBy: actor,
    },
    nextStep: "Медиа импортировано в Timeline Studio. Добавь файл на нужную дорожку и сохрани sound plan.",
  };
  const nextJob = updateJob(job.id, { output: nextOutput });
  addEvent(job.id, {
    step: "sound",
    type: "tool_result",
    tool: "MediaImporter",
    message: `Импортирован файл для Timeline Studio: ${media.label}.`,
    meta: { type: media.type, url: media.url, actor },
  });
  return { success: true, job: nextJob, output: nextJob.output, media };
}

async function renderSoundPlanForVideoJob({ jobId, actor = {} }) {
  const job = getJob(jobId);
  if (!job || job.employeeId !== "video_operator") {
    return { success: false, error: { code: "JOB_NOT_FOUND", message: "AI job not found" } };
  }
  const output = job.output || {};
  if (!output.heygen?.videoId && !output.heygen?.videoUrl && !output.heygen?.artifact?.url) {
    return { success: false, job, output, error: { code: "ACTIVE_VIDEO_REQUIRED", message: "Сначала нужно готовое HeyGen video." } };
  }
  if (!output.soundPlan) {
    return { success: false, job, output, error: { code: "SOUND_PLAN_REQUIRED", message: "Сначала создай sound plan." } };
  }

  const renderingPlan = {
    ...output.soundPlan,
    render: {
      ...(output.soundPlan.render || {}),
      status: "rendering",
      startedAt: new Date().toISOString(),
      actor,
    },
  };
  updateJob(job.id, { output: { ...output, soundPlan: renderingPlan } });
  addEvent(job.id, {
    step: "sound",
    type: "tool_call",
    tool: "SoundRenderWorker",
    message: "Начинаю сведение музыки и SFX с активным HeyGen MP4.",
    meta: { actor, effects: renderingPlan.effects?.length || 0 },
  });

  try {
    const artifact = await renderSoundPlanToArtifact({ job, output: { ...output, soundPlan: renderingPlan } });
    const nextOutput = {
      ...output,
      soundPlan: {
        ...renderingPlan,
        render: {
          status: "rendered",
          artifact,
          renderedAt: new Date().toISOString(),
          actor,
        },
      },
      soundEnhancedVideo: artifact,
      nextStep: "Sound Director свёл звук. Можно передавать sound-enhanced video в Content Manager и Publishing Manager.",
    };
    const nextJob = updateJob(job.id, { output: nextOutput });
    addEvent(job.id, {
      step: "sound",
      type: "tool_result",
      tool: "SoundRenderWorker",
      message: "Звук сведён, MP4 сохранён в Travella Media.",
      meta: { url: artifact.url, provider: artifact.provider, actor },
    });
    return { success: true, job: nextJob, output: nextJob.output };
  } catch (err) {
    const failedOutput = {
      ...output,
      soundPlan: {
        ...renderingPlan,
        render: {
          ...(renderingPlan.render || {}),
          status: "failed",
          error: err?.message || "sound_render_failed",
          code: err?.code || "sound_render_failed",
          failedAt: new Date().toISOString(),
        },
      },
    };
    const nextJob = updateJob(job.id, { output: failedOutput });
    addEvent(job.id, {
      step: "sound",
      level: "error",
      tool: "SoundRenderWorker",
      message: err?.message || "sound_render_failed",
      meta: { code: err?.code || "sound_render_failed" },
    });
    return { success: false, job: nextJob, output: nextJob.output, error: { code: err?.code || "SOUND_RENDER_FAILED", message: err?.message || "sound_render_failed" } };
  }
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

  const attempts = normalizeHeygenAttempts(job.output?.heygenAttempts);
  for (const attempt of attempts) {
    const fromAttempt = attempt?.videoId || attempt?.video_id || "";
    if (fromAttempt) return String(fromAttempt);
  }

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
  return listJobs({ employeeId: "video_operator", limit: 100 }).find((job) => {
    if (String(job.output?.heygen?.videoId || job.output?.heygen?.video_id || "") === target) return true;
    return normalizeHeygenAttempts(job.output?.heygenAttempts).some((attempt) => String(attempt?.videoId || attempt?.video_id || "") === target);
  }) || null;
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

function normalizeHeygenAttempts(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function getNextHeygenVersion(output = {}) {
  const attempts = normalizeHeygenAttempts(output.heygenAttempts);
  const versions = attempts
    .concat(output.heygen ? [output.heygen] : [])
    .map((item) => Number(item?.version || 0))
    .filter((value) => Number.isFinite(value));
  return Math.max(0, ...versions) + 1;
}

function prepareHeygenOutputForRun(output = {}, regenerate = false) {
  if (!regenerate) return { output, version: getNextHeygenVersion(output) };
  const attempts = normalizeHeygenAttempts(output.heygenAttempts);
  const previous = output.heygen
    ? {
        ...output.heygen,
        version: Number(output.heygen.version || attempts.length + 1),
        archivedAt: new Date().toISOString(),
      }
    : null;
  const nextOutput = {
    ...output,
    heygen: null,
    heygenAttempts: previous ? attempts.concat(previous) : attempts,
  };
  return { output: nextOutput, version: getNextHeygenVersion(nextOutput) };
}

function listHeygenVersions(output = {}) {
  const attempts = normalizeHeygenAttempts(output.heygenAttempts);
  const current = output.heygen ? [{ ...output.heygen, active: true }] : [];
  return attempts
    .map((item) => ({ ...item, active: false }))
    .concat(current)
    .map((item, index) => ({ ...item, version: Number(item.version || index + 1) }))
    .sort((a, b) => Number(a.version || 0) - Number(b.version || 0));
}

function selectHeygenVersionForVideoJob({ jobId, version, actor = {} }) {
  const job = getJob(jobId);
  if (!job) {
    return { success: false, error: { code: "JOB_NOT_FOUND", message: "AI job not found" } };
  }

  const output = job.output || {};
  const targetVersion = Number(version);
  if (!Number.isFinite(targetVersion) || targetVersion < 1) {
    return { success: false, job, error: { code: "HEYGEN_VERSION_REQUIRED", message: "Нужно выбрать версию HeyGen." } };
  }

  const versions = listHeygenVersions(output);
  const selected = versions.find((item) => Number(item.version) === targetVersion);
  if (!selected) {
    return { success: false, job, error: { code: "HEYGEN_VERSION_NOT_FOUND", message: `Версия v${targetVersion} не найдена.` } };
  }
  if (selected.active) {
    return { success: true, job, output, message: `Версия v${targetVersion} уже активна.` };
  }

  const nextHeygen = { ...selected, active: undefined, activatedAt: new Date().toISOString(), activatedBy: actor?.id || null };
  const nextAttempts = versions
    .filter((item) => Number(item.version) !== targetVersion)
    .map((item) => ({ ...item, active: undefined }))
    .sort((a, b) => Number(a.version || 0) - Number(b.version || 0));
  const nextOutput = { ...output, heygen: nextHeygen, heygenAttempts: nextAttempts };
  const nextJob = updateJob(job.id, {
    status: isHeygenReady(nextHeygen.status) ? "video_ready" : "video_submitted",
    output: nextOutput,
    error: null,
  });
  addEvent(job.id, {
    step: "heygen",
    type: "tool_result",
    tool: "HeyGenVersionSelector",
    message: `Активная версия HeyGen: v${targetVersion}.`,
    meta: { version: targetVersion, actor },
  });
  return { success: true, job: getJob(job.id) || nextJob, output: (getJob(job.id) || nextJob).output };
}

function shouldUseLatestService(command) {
  const text = String(command || "").toLowerCase();
  return /(сегодня|лучший|последн|актуальн|любой|сам выбери|выбери сам)/i.test(text);
}

function formatRouteCategory(route = {}) {
  const labels = {
    refused_tour: "отказной тур",
    author_tour: "авторский тур",
    refused_hotel: "отказной отель",
    refused_flight: "отказной авиабилет",
    refused_ticket: "отказной билет",
    refused_event_ticket: "отказной билет на мероприятие",
  };
  const filters = Array.isArray(route.categoryFilters) ? route.categoryFilters : [];
  if (!filters.length) return "отказное предложение";
  return filters.map((item) => labels[item] || item).join(" / ");
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

function buildVideoOperatorOutput({ route = {}, service, scriptOptions = {} }) {
  const ctx = service.videoContext;
  const analysis = buildAnalysis(ctx);
  const hook = buildHook(ctx, scriptOptions);
  const script = buildScript(ctx, scriptOptions);
  const motionPrompt = buildMotionPrompt(ctx, scriptOptions);
  const scriptReview = buildScriptReview(ctx, script);
  const publishingDrafts = buildPublishingDrafts(ctx);

  return {
    route,
    service,
    analysis,
    hook,
    script,
    motionPrompt,
    scriptReview,
    publishingDrafts,
    nextStep:
      route.action === "prepare_video"
        ? "Сценарий готов к проверке. Проверь текст ниже и только потом нажми “Утвердить и отправить в HeyGen”."
        : "Сценарий готов к проверке. HeyGen не запустится без ручного утверждения.",
  };
}

function extractServiceCodeFromJob(job = {}) {
  const fromInput = job.input?.route?.serviceCode || job.output?.route?.serviceCode || "";
  if (fromInput) return String(fromInput).trim();
  const events = Array.isArray(job.events) ? [...job.events].reverse() : [];
  for (const event of events) {
    const fromMeta = event?.meta?.code || event?.meta?.serviceCode || "";
    if (fromMeta) return String(fromMeta).trim();
  }
  const match = String(job.command || "").match(/\b([RAHE]\s*\d+)\b/i);
  return match?.[1] ? match[1].replace(/\s+/g, "").toUpperCase() : "";
}

function hasPromptBuildCompleted(job = {}) {
  if (job.output?.script || job.output?.motionPrompt) return true;
  const events = Array.isArray(job.events) ? job.events : [];
  return events.some((event) => event.tool === "AvatarScriptBuilder" && /готов/i.test(event.message || "")) &&
    events.some((event) => event.tool === "MotionPromptBuilder" && /готов/i.test(event.message || ""));
}

async function repairVideoOperatorJob(job) {
  if (!job || job.employeeId !== "video_operator" || job.output?.script) return job;
  if (!hasPromptBuildCompleted(job)) return job;
  const serviceCode = extractServiceCodeFromJob(job);
  if (!serviceCode) return job;
  const route = job.input?.route || routeAiTask(job.command || serviceCode);
  const lookup = await findRefusedServiceByCode(serviceCode, { categoryFilters: route.categoryFilters || [] }).catch((err) => ({ found: false, error: err }));
  if (!lookup?.found) return job;
  const scriptOptions = {
    scriptMode: route.scriptMode || "default",
    variantSalt: route.variantSalt || "",
  };
  const output = buildVideoOperatorOutput({ route: { ...route, serviceCode }, service: lookup.service, scriptOptions });
  updateJob(job.id, { status: "script_ready", output });
  addEvent(job.id, {
    step: "repair",
    type: "tool_result",
    tool: "AiJobStore",
    message: "Восстановил речь и Custom Motion из Travella DB после неполной записи job.",
  });
  return getJob(job.id) || job;
}

async function listVideoOperatorJobs({ limit = 25, repair = false } = {}) {
  const rows = listJobs({ employeeId: "video_operator", limit });
  if (!repair) return rows;
  await Promise.all(rows.map((job) => repairVideoOperatorJob(job)));
  return listJobs({ employeeId: "video_operator", limit });
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
      addEvent(job.id, { step: "source", type: "tool_call", tool: "MarketplaceLookup", message: `Код не указан. Ищу последний активный ${formatRouteCategory(route)} в базе Travella.` });
      const latest = await findLatestRefusedService({ categoryFilters: route.categoryFilters || [] });
      if (!latest.found) {
        const error = { code: latest.reason || "NO_REFUSED_SERVICES", message: `Не нашёл активные предложения: ${formatRouteCategory(route)}.` };
        addEvent(job.id, { step: "source", level: "error", message: error.message });
        updateJob(job.id, { status: "failed", error });
        return { success: false, job: getJob(job.id), error };
      }
      service = latest.service;
      route.serviceCode = service.code;
    }

    if (!route.serviceCode) {
      addEvent(job.id, { step: "source", level: "error", message: "В задаче не найден код отказного тура формата R857." });
      const error = { code: "SERVICE_CODE_REQUIRED", message: "Напиши код предложения, например: R857, A857, H857 или E857. Можно также написать: “Создай видео для последнего отказного авиабилета”." };
      updateJob(job.id, { status: "failed", error });
      return { success: false, job: getJob(job.id), error };
    }

    let lookup = { found: true, service };
    if (!service) {
      addEvent(job.id, { step: "source", type: "tool_call", tool: "MarketplaceLookup", message: `Ищу реальное предложение ${route.serviceCode} (${formatRouteCategory(route)}) в базе Travella.` });
      lookup = await findRefusedServiceByCode(route.serviceCode, { categoryFilters: route.categoryFilters || [] });
    }

    if (!lookup.found) {
      const suggestions = await listRecentRefusedServices({ limit: 6, categoryFilters: route.categoryFilters || [] }).catch(() => []);
      const suggestionText = formatServiceSuggestions(suggestions);
      const message = suggestionText
        ? `Не нашёл активное предложение ${route.serviceCode} (${formatRouteCategory(route)}) в базе Travella.\n\nДоступные варианты:\n${suggestionText}\n\nНапиши, например: “Создай видео для ${suggestions[0]?.code || "R..." }”.`
        : `Не нашёл активное предложение ${route.serviceCode} (${formatRouteCategory(route)}) в базе Travella.`;
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

    const output = buildVideoOperatorOutput({ route, service, scriptOptions });
    const scriptReview = output.scriptReview;
    addEvent(job.id, { step: "plan", type: "tool_call", tool: "AvatarScriptBuilder", message: "Готовлю текст для AI-аватара по правилам Travella." });
    addEvent(job.id, { step: "plan", type: "tool_result", tool: "AvatarScriptBuilder", message: "Сценарий готов и ждёт ручного утверждения." });
    addEvent(job.id, { step: "plan", type: "tool_result", tool: "MotionPromptBuilder", message: "Custom Motion для HeyGen готов к ручной проверке." });
    addEvent(job.id, { step: "review", type: "tool_result", tool: "PromptQualityCheck", message: scriptReview.approvalGate, meta: { status: scriptReview.status, missingFields: scriptReview.missingFields } });

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
  const motionPrompt = buildMotionPrompt(normalized);
  const output = {
    hook: buildHook(normalized),
    script,
    motionPrompt,
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

async function startHeygenForVideoJob({ jobId, actor = {}, regenerate = false }) {
  const job = getJob(jobId);
  if (!job) {
    return { success: false, error: { code: "JOB_NOT_FOUND", message: "AI job not found" } };
  }

  const output = job.output || {};
  if (!output.script) {
    return { success: false, job, error: { code: "SCRIPT_REQUIRED", message: "Сначала нужно подготовить сценарий." } };
  }

  if (output.heygen?.videoId && !regenerate) {
    return { success: true, job, output, message: "HeyGen уже был запущен для этой задачи." };
  }
  const prepared = prepareHeygenOutputForRun(output, regenerate);
  const runOutput = prepared.output;
  const version = prepared.version;

  addEvent(job.id, {
    step: "heygen",
    type: "tool_call",
    tool: "HeyGen",
    message: regenerate ? `Запускаю новую версию HeyGen v${version}.` : "Получено ручное утверждение сценария. Отправляю текст в HeyGen.",
    meta: { actor, regenerate: Boolean(regenerate), version },
  });

  let generationProfile = null;
  try {
    const profile = await getAiVideoProfileSetting();
    generationProfile = {
      avatarId: profile.avatarId || "",
      voiceId: profile.voiceId || "",
      engine: profile.engine || "avatar_iv",
      voiceSpeed: profile.voiceSpeed ?? 1,
      expressiveness: profile.expressiveness || "medium",
      aspectRatio: profile.aspectRatio || "9:16",
      resolution: profile.resolution || "1080p",
      source: profile.source || "",
    };
    const response = await createAvatarVideo({
      script: runOutput.script,
      motionPrompt: runOutput.motionPrompt,
      avatarId: generationProfile.avatarId,
      voiceId: generationProfile.voiceId,
      aspectRatio: generationProfile.aspectRatio,
      resolution: generationProfile.resolution,
      engine: generationProfile.engine,
      voiceSpeed: generationProfile.voiceSpeed,
      expressiveness: generationProfile.expressiveness,
      title: `${runOutput.service?.videoContext?.code || "Travella"} ${runOutput.service?.videoContext?.title || "Video"} v${version}`,
      idempotencyKey: `travella-ai-video-${job.id}-v${version}`,
    });

    const videoId = extractHeygenVideoId(response);
    const heygen = {
      provider: "heygen",
      status: getHeygenStatus(response),
      version,
      videoId,
      videoUrl: extractHeygenVideoUrl(response),
      profile: generationProfile,
      scriptSnapshot: runOutput.script,
      motionPromptSnapshot: runOutput.motionPrompt,
      response,
      submittedAt: new Date().toISOString(),
    };

    const saved = await saveArtifactIfReady(job, runOutput, heygen);
    const nextOutput = saved.output;
    const nextHeygen = saved.heygen;
    updateJob(job.id, { status: isHeygenReady(nextHeygen.status) ? "video_ready" : "video_submitted", output: nextOutput });
    addEvent(job.id, {
      step: "heygen",
      type: "tool_result",
      tool: "HeyGen",
      message: videoId ? `HeyGen принял версию v${version}. Video ID: ${videoId}` : `HeyGen принял версию v${version}.`,
      meta: { videoId, status: nextHeygen.status, profile: nextHeygen.profile, version },
    });

    return { success: true, job: getJob(job.id), output: nextOutput };
  } catch (err) {
    if (err?.code === "AI_VIDEO_DISABLED") {
      const nextOutput = {
        ...runOutput,
        heygen: {
          provider: "heygen",
          status: "disabled",
          version,
          error: err.message,
          profile: generationProfile,
          scriptSnapshot: runOutput.script,
          motionPromptSnapshot: runOutput.motionPrompt,
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
      version,
      error: err?.message || "HeyGen request failed",
      profile: generationProfile,
      scriptSnapshot: runOutput.script,
      motionPromptSnapshot: runOutput.motionPrompt,
      failedAt: new Date().toISOString(),
    };
    const nextOutput = { ...runOutput, heygen };
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
  const attempts = normalizeHeygenAttempts(output.heygenAttempts);
  const activeVideoId = String(output.heygen?.videoId || output.heygen?.video_id || "");
  const attemptIndex = attempts.findIndex((attempt) => String(attempt?.videoId || attempt?.video_id || "") === payloadVideoId);
  const webhookTargetsActive = activeVideoId === payloadVideoId || attemptIndex < 0;
  const targetHeygen = webhookTargetsActive ? (output.heygen || {}) : (attempts[attemptIndex] || {});
  const payloadStatus = getHeygenStatus(payload);
  let response = payload;
  let status = payloadStatus;
  let videoUrl = extractHeygenVideoUrl(payload) || targetHeygen.videoUrl || "";

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
    ...targetHeygen,
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

  const saved = await saveArtifactIfReady(job, webhookTargetsActive ? output : { ...output, heygen }, heygen);
  if (!webhookTargetsActive) {
    const nextAttempts = attempts.slice();
    nextAttempts[attemptIndex] = saved.heygen;
    const nextOutput = { ...output, heygen: output.heygen || null, heygenAttempts: nextAttempts };
    updateJob(job.id, { output: nextOutput });
    addEvent(job.id, {
      step: "heygen",
      type: "tool_result",
      tool: "HeyGenWebhook",
      message: `HeyGen webhook обновил историю v${saved.heygen.version || attemptIndex + 1}: ${saved.heygen.status}.`,
      meta: { videoId: payloadVideoId, status: saved.heygen.status, version: saved.heygen.version || attemptIndex + 1, active: false },
    });
    return { success: true, accepted: true, job: getJob(job.id), output: nextOutput };
  }

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
  selectHeygenVersionForVideoJob,
  saveSoundPlanForVideoJob,
  importMediaForVideoJob,
  renderSoundPlanForVideoJob,
  refreshHeygenForVideoJob,
  handleHeygenWebhook,
  runHeygenVideoPollerOnce,
  listVideoOperatorJobs,
};
