// backend/ai/videoOperator/videoOperator.runtime.js

const { createJob, addEvent, updateJob, listJobs, getJob } = require("../core/aiJobStore");
const { routeAiTask } = require("../core/taskRouter");
const { findRefusedServiceByCode } = require("./refusedServiceLookup");

function clean(value, fallback = "") {
  const s = String(value ?? "").trim();
  return s || fallback;
}

function buildHook(ctx) {
  const destination = clean(ctx.destination, "это направление");
  const price = clean(ctx.price);
  const currency = clean(ctx.currency, "USD");
  if (price) return `Отказной тур в ${destination}: можно забрать пакет за ${price} ${currency}, пока его не перехватили.`;
  return `Появился отказной пакет в ${destination} — такие предложения обычно уходят очень быстро.`;
}

function buildScript(ctx) {
  const lines = [];
  lines.push(`Есть горячее отказное предложение от Travella.`);
  lines.push(`${clean(ctx.title, ctx.category)}.`);
  if (ctx.fromCity || ctx.destination) lines.push(`Вылет: ${clean(ctx.fromCity, "Ташкент")}. Направление: ${clean(ctx.destination, "уточняется")}.`);
  if (ctx.dates) lines.push(`Даты: ${ctx.dates}.`);
  if (ctx.hotel) lines.push(`Отель: ${ctx.hotel}${ctx.room ? `, номер ${ctx.room}` : ""}.`);
  if (ctx.meal) lines.push(`Питание: ${ctx.meal}.`);
  if (ctx.people) lines.push(`Размещение: ${ctx.people}.`);
  if (ctx.flight) lines.push(`Перелёт: ${ctx.flight}.`);
  if (ctx.includes) lines.push(`В пакет входит: ${ctx.includes}.`);
  if (ctx.price) lines.push(`Цена: ${ctx.price} ${clean(ctx.currency, "USD")}.`);
  lines.push(`Важно: ${clean(ctx.urgency, "предложение отказное, поэтому может уйти в любой момент")}.`);
  lines.push(`Чтобы забрать это предложение, откройте Travella и свяжитесь с поставщиком.`);
  return lines.join("\n");
}

function buildAnalysis(ctx) {
  const triggers = [];
  if (ctx.price) triggers.push("цена");
  if (ctx.hotel) triggers.push("отель");
  if (ctx.flight) triggers.push("перелёт");
  triggers.push("срочность отказного предложения");
  return {
    mainOffer: `${clean(ctx.category, "Отказное предложение")} ${ctx.code || ""}`.trim(),
    target: "клиенты, которые готовы быстро принять решение по готовому туру",
    triggers,
    recommendedFormat: "vertical_9_16_avatar_video",
  };
}

async function runVideoOperatorTask({ command, actor = {} }) {
  const route = routeAiTask(command);
  const job = createJob({
    employeeId: "video_operator",
    type: route.action,
    command,
    input: { route, actor },
    status: "running",
  });

  try {
    addEvent(job.id, { step: "task_router", message: "Задача распознана и передана Video Operator.", meta: route });

    if (!route.serviceCode) {
      addEvent(job.id, { step: "source", level: "error", message: "В задаче не найден код отказного тура формата R857." });
      const error = { code: "SERVICE_CODE_REQUIRED", message: "Напиши код отказного тура, например: Создай видео для R857" };
      updateJob(job.id, { status: "failed", error });
      return { success: false, job: getJob(job.id), error };
    }

    addEvent(job.id, { step: "source", message: `Ищу реальный отказной тур ${route.serviceCode} в базе Travella.` });
    const lookup = await findRefusedServiceByCode(route.serviceCode);

    if (!lookup.found) {
      const error = { code: lookup.reason || "NOT_FOUND", message: `Не нашёл активный отказной тур ${route.serviceCode} в базе Travella.` };
      addEvent(job.id, { step: "source", level: "error", message: error.message });
      updateJob(job.id, { status: "failed", error });
      return { success: false, job: getJob(job.id), error };
    }

    const service = lookup.service;
    const ctx = service.videoContext;
    addEvent(job.id, { step: "source", message: `Нашёл ${ctx.category}: ${ctx.title}.`, meta: { serviceId: service.id, code: service.code } });

    const analysis = buildAnalysis(ctx);
    addEvent(job.id, { step: "analysis", message: "Проанализировал оффер, цену, срочность и главный триггер.", meta: analysis });

    const hook = buildHook(ctx);
    addEvent(job.id, { step: "plan", message: "Собрал хук для первых 3 секунд." });

    const script = buildScript(ctx);
    addEvent(job.id, { step: "plan", message: "Подготовил текст для AI-аватара." });

    const output = {
      route,
      service,
      analysis,
      hook,
      script,
      nextStep:
        route.action === "prepare_video"
          ? "Сценарий готов. Следующий этап — утверждение и запуск HeyGen."
          : "Сценарий готов. Можно утверждать и запускать создание видео.",
    };

    updateJob(job.id, { status: "completed", output });
    addEvent(job.id, { step: "result", message: "Результат сохранён в истории Travella AI OS." });

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
  const output = { hook: buildHook(normalized), script: buildScript(normalized), service: { videoContext: normalized }, manual: true };
  updateJob(job.id, { status: "completed", output });
  addEvent(job.id, { step: "manual", message: "Сценарий создан из ручного контекста." });
  return { success: true, job: getJob(job.id), output };
}

module.exports = { runVideoOperatorTask, createScriptFromManualContext, listVideoOperatorJobs: (opts) => listJobs({ employeeId: "video_operator", ...opts }) };
