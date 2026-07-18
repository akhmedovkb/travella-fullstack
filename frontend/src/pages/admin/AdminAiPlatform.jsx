// frontend/src/pages/admin/AdminAiPlatform.jsx

import React from "react";
import { apiGet, apiPatch, apiPost } from "../../api";

const EMPLOYEES = [
  { id: "video_operator", icon: "🎬", name: "Video Operator", subtitle: "AI-видео для отказных предложений", live: true },
  { id: "sales_manager", icon: "💼", name: "Sales Manager", subtitle: "Продажи и быстрые заявки", live: false },
  { id: "content_manager", icon: "📝", name: "Content Manager", subtitle: "Посты, captions, сторис", live: true },
  { id: "publishing_manager", icon: "🗓️", name: "Publishing Manager", subtitle: "Очередь и статусы публикаций", live: true },
  { id: "support_manager", icon: "🎧", name: "Support Manager", subtitle: "Ответы клиентам и поставщикам", live: false },
  { id: "hotel_auditor", icon: "🏨", name: "Hotel Auditor", subtitle: "Инспекции отелей", live: false },
  { id: "finance_auditor", icon: "📊", name: "Finance Auditor", subtitle: "Балансы и сверки", live: false },
];

const HEYGEN_VOICE_PRESETS = [
  { label: "MY1", value: "ce04d2becc764610b4b3f89155285a45" },
  { label: "MY2", value: "2f5588e77acb4d3aa4482570c0390644" },
  { label: "MY3", value: "aaea0796357b4614a69e14e1d05fc185" },
  { label: "MY4", value: "e0e96bd5207449f8bd69a6ad0fb95a2d" },
  { label: "MY5", value: "4ef0fa222bcf488f9145db9a0c716de8" },
  { label: "MY6", value: "75d34e45780f44888ccaf49cb93222ee" },
];

const HEYGEN_AVATAR_PRESETS = [
  { label: "MY1", value: "563cee663c5a494a99a34f0867f6c0b2" },
  { label: "MY2", value: "9c8b04c737bc4f2bbc4bd7d42ec33281" },
];

function cn(...items) { return items.filter(Boolean).join(" "); }
function fmtDate(value) { try { return new Date(value).toLocaleString("ru-RU"); } catch { return "—"; } }
function isToday(value) {
  if (!value) return false;
  const d = new Date(value);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function Pill({ children, tone = "slate" }) {
  const map = {
    green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    red: "bg-rose-50 text-rose-700 ring-rose-100",
    yellow: "bg-amber-50 text-amber-700 ring-amber-100",
    blue: "bg-blue-50 text-blue-700 ring-blue-100",
    black: "bg-slate-950 text-white ring-slate-950",
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
  };
  return <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-black ring-1", map[tone] || map.slate)}>{children}</span>;
}

function getJobStatusMeta(job = {}) {
  const status = String(job.status || "").toLowerCase();
  const hasScript = Boolean(job.output?.script);
  const hasHeygen = Boolean(job.output?.heygen?.videoId);
  const hasVideo = Boolean(job.output?.heygen?.videoUrl);

  if (status === "failed") return { label: "Ошибка", tone: "red" };
  if (status === "video_failed") return { label: "Видео: ошибка", tone: "red" };
  if (status === "video_ready" || hasVideo) return { label: "Видео готово", tone: "green" };
  if (status === "video_submitted" || hasHeygen) return { label: "HeyGen запущен", tone: "blue" };
  if (status === "script_ready" || (status === "completed" && hasScript)) return { label: "Сценарий готов", tone: "blue" };
  if (["created", "queued", "running", "processing"].includes(status)) return { label: "В работе", tone: "yellow" };
  return { label: job.status || "—", tone: "slate" };
}

function EmployeeTabs({ selected, onSelect }) {
  return (
    <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
      <div className="flex min-w-max gap-2">
        {EMPLOYEES.map((e) => (
          <button
            key={e.id}
            type="button"
            disabled={!e.live}
            onClick={() => onSelect(e.id)}
            className={cn(
              "flex items-center gap-3 rounded-2xl px-4 py-3 text-left transition",
              selected === e.id ? "bg-slate-950 text-white" : "bg-white text-slate-700 hover:bg-slate-50",
              !e.live ? "cursor-not-allowed opacity-50" : ""
            )}
          >
            <span className="text-xl">{e.icon}</span>
            <span>
              <span className="block text-sm font-black">{e.name}</span>
              <span className={cn("block text-xs font-semibold", selected === e.id ? "text-slate-300" : "text-slate-400")}>{e.live ? e.subtitle : "soon"}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value, helper }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-black text-slate-950">{value}</div>
      <div className="mt-1 text-xs font-bold text-slate-500">{helper}</div>
    </div>
  );
}

function ToolEvent({ ev }) {
  const type = ev.type || "event";
  const icon = type === "tool_call" ? "⚙️" : type === "tool_result" ? "✅" : ev.level === "error" ? "⚠️" : "🧠";
  const title = ev.tool || ev.step || "Runtime";
  return (
    <div className="flex gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3 text-sm">
      <div className="mt-0.5 text-lg">{icon}</div>
      <div className="min-w-0">
        <div className="font-black text-slate-900">{title}</div>
        <div className="mt-1 font-semibold leading-6 text-slate-600">{ev.message}</div>
      </div>
    </div>
  );
}

function ServicePreview({ service }) {
  if (!service) return null;
  const c = service.videoContext || {};
  return (
    <div className="mt-4 rounded-3xl border border-blue-100 bg-blue-50/70 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-blue-700">Travella DB object</div>
          <div className="mt-1 text-lg font-black text-slate-950">{c.code} · {c.title}</div>
          <div className="mt-1 text-sm font-semibold text-slate-600">{c.category || service.category} · {service.status || "—"}</div>
        </div>
        {c.price ? <Pill tone="blue">{c.price} {c.currency || "USD"}</Pill> : null}
      </div>
      <div className="mt-4 grid gap-3 text-sm font-semibold text-slate-700 md:grid-cols-2">
        <div><b>Направление:</b> {c.destination || "—"}</div>
        <div><b>Даты:</b> {c.dates || "—"}</div>
        <div><b>Отель:</b> {c.hotel || "—"}</div>
        <div><b>Размещение:</b> {c.people || "—"}</div>
        <div><b>Питание:</b> {c.meal || "—"}</div>
        <div><b>Поставщик:</b> {c.supplier || service.provider?.name || "—"}</div>
      </div>
    </div>
  );
}

function ScriptReview({ review }) {
  if (!review) return null;
  const checks = Array.isArray(review.checks) ? review.checks : [];
  return (
    <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-blue-700">Prompt quality check</div>
          <div className="mt-1 text-sm font-black text-slate-950">
            {review.status === "needs_review" ? "Нужна внимательная проверка" : "Готово к ручной проверке"}
          </div>
        </div>
        <Pill tone={review.status === "needs_review" ? "yellow" : "blue"}>Перед HeyGen</Pill>
      </div>
      {checks.length ? (
        <div className="mt-3 space-y-2">
          {checks.map((check) => (
            <div key={check.id || check.label} className="flex items-start gap-2 rounded-2xl bg-white px-3 py-2 text-xs font-bold text-slate-700 ring-1 ring-blue-100">
              <span className={check.passed ? "text-emerald-600" : "text-amber-600"}>{check.passed ? "✓" : "!"}</span>
              <span>{check.label}</span>
            </div>
          ))}
        </div>
      ) : null}
      {review.missingFields?.length ? (
        <div className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 ring-1 ring-amber-100">
          Не хватает данных: {review.missingFields.join(", ")}. Сценарий не выдумывает эти поля.
        </div>
      ) : null}
      <div className="mt-3 text-xs font-bold text-slate-500">{review.approvalGate || "HeyGen запускается только после ручного подтверждения сценария."}</div>
    </div>
  );
}

function findHeygenVideoIdFromEvents(events = []) {
  for (const ev of [...events].reverse()) {
    const fromMeta = ev?.meta?.videoId || ev?.meta?.video_id || "";
    if (fromMeta) return String(fromMeta);
    const match = String(ev?.message || "").match(/Video ID:\s*([a-zA-Z0-9_-]+)/i);
    if (match?.[1]) return match[1];
  }
  return "";
}

function Message({ msg, onStartHeygen, onRefreshHeygen, canStartHeygen, aiVideoEnabled, heygenReady, heygenLoading, refreshLoading }) {
  const user = msg.role === "user";
  const inferredVideoId = findHeygenVideoIdFromEvents(msg.events || []);
  const heygen = msg.output?.heygen || (inferredVideoId ? { provider: "heygen", status: "submitted", videoId: inferredVideoId } : null);
  const artifact = heygen?.artifact || null;
  const jobStatus = String(msg.job?.status || "").toLowerCase();
  const canShowHeygenAction = !user && msg.job?.id && msg.output?.script && !heygen?.videoId && !["video_submitted", "video_ready", "video_failed"].includes(jobStatus);
  const canShowRefreshAction = !user && msg.job?.id && heygen?.videoId && !heygen?.videoUrl;
  const heygenActionLabel = canStartHeygen
    ? heygenLoading === msg.job?.id ? "Отправляю..." : "Утвердить и отправить в HeyGen"
    : !heygenReady ? "HeyGen не настроен" : !aiVideoEnabled ? "Включи HeyGen" : "HeyGen недоступен";
  return (
    <div className={cn("flex", user ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[92%] rounded-[1.6rem] px-5 py-4 shadow-sm", user ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-900")}>
        <div className={cn("mb-2 text-xs font-black uppercase tracking-wide", user ? "text-slate-300" : "text-slate-500")}>{user ? "Ты" : "Travella AI Runtime"}</div>
        <div className="whitespace-pre-wrap text-sm font-semibold leading-7">{msg.text}</div>
        <ServicePreview service={msg.output?.service} />
        {msg.events?.length ? <div className="mt-4 space-y-2">{msg.events.map((ev, i) => <ToolEvent key={`${ev.at || i}_${i}`} ev={ev} />)}</div> : null}
        {msg.output?.hook ? <div className="mt-4 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-100"><div className="text-xs font-black uppercase tracking-wide text-amber-700">Хук</div><div className="mt-2 text-sm font-black leading-6 text-slate-950">{msg.output.hook}</div></div> : null}
        {msg.output?.script ? <div className="mt-3 rounded-2xl bg-slate-950 p-4 text-white"><div className="text-xs font-black uppercase tracking-wide text-slate-300">Сценарий для AI-аватара</div><div className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-7 text-slate-100">{msg.output.script}</div></div> : null}
        <ScriptReview review={msg.output?.scriptReview} />
        {heygen ? (
          <div className="mt-3 rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-100">
            <div className="text-xs font-black uppercase tracking-wide text-emerald-700">HeyGen</div>
            <div className="mt-2 text-sm font-black leading-6 text-slate-950">Статус: {heygen.status || "submitted"}</div>
            {heygen.videoId ? <div className="mt-1 text-xs font-bold text-slate-500">Video ID: {heygen.videoId}</div> : null}
            {heygen.videoUrl ? (
              <a
                href={heygen.videoUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex rounded-2xl bg-emerald-700 px-4 py-2 text-xs font-black text-white hover:bg-emerald-800"
              >
                Открыть видео
              </a>
            ) : null}
            {artifact ? (
              <div className={cn("mt-3 rounded-2xl p-3 ring-1", artifact.url ? "bg-white text-slate-700 ring-emerald-100" : "bg-amber-50 text-amber-800 ring-amber-100")}>
                <div className="text-xs font-black uppercase tracking-wide">{artifact.url ? "Travella Media" : "Travella Media не сохранено"}</div>
                {artifact.url ? (
                  <a href={artifact.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex rounded-2xl bg-slate-950 px-4 py-2 text-xs font-black text-white hover:bg-slate-800">
                    Открыть сохранённый MP4
                  </a>
                ) : (
                  <div className="mt-1 text-xs font-bold">{artifact.error || "media_storage_not_configured"}</div>
                )}
              </div>
            ) : null}
            {heygen.error ? <div className="mt-2 text-sm font-bold text-rose-700">{heygen.error}</div> : null}
          </div>
        ) : null}
        {canShowRefreshAction ? (
          <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-emerald-100 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs font-bold text-slate-500">Видео отправлено в HeyGen. Можно проверить готовность.</div>
            <button
              type="button"
              onClick={() => onRefreshHeygen?.(msg.job)}
              disabled={refreshLoading === msg.job.id}
              className="rounded-2xl bg-emerald-700 px-4 py-2 text-xs font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {refreshLoading === msg.job.id ? "Обновляю..." : "Обновить статус"}
            </button>
          </div>
        ) : null}
        {canShowHeygenAction ? (
          <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs font-bold text-slate-500">Проверь сценарий выше. Только эта кнопка отправляет текст в HeyGen.</div>
            <button
              type="button"
              onClick={() => onStartHeygen?.(msg.job)}
              disabled={!canStartHeygen || heygenLoading === msg.job.id}
              className="rounded-2xl bg-slate-950 px-4 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {heygenActionLabel}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Inspector({ task }) {
  const service = task?.output?.service || null;
  const ctx = service?.videoContext || {};
  const statusMeta = getJobStatusMeta(task || {});
  return (
    <aside className="space-y-4">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-xs font-black uppercase tracking-wide text-slate-500">Inspector</div>
        <h3 className="mt-1 text-xl font-black text-slate-950">Контекст текущей задачи</h3>
        {!task ? <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-500">Пока нет активной задачи. Выбери быструю команду под чатом или напиши: “Создай сценарий для R941”, “Создай видео для последнего отказного авиабилета”, “Сделай агрессивнее H502”.</div> : null}
        {task ? <div className="mt-4 space-y-3 text-sm font-semibold text-slate-600">
          <div className="rounded-2xl bg-slate-50 p-4"><div className="text-slate-400">Задача</div><b className="text-slate-950">{task.command}</b></div>
          <div className="flex justify-between rounded-2xl bg-slate-50 p-4"><span>Статус</span><b className="text-slate-950">{statusMeta.label}</b></div>
          <div className="flex justify-between rounded-2xl bg-slate-50 p-4"><span>Источник</span><b className="text-slate-950">{service ? "Travella DB" : "—"}</b></div>
          <div className="flex justify-between rounded-2xl bg-slate-50 p-4"><span>Код</span><b className="text-slate-950">{ctx.code || "—"}</b></div>
          <div className="rounded-2xl bg-slate-50 p-4"><div className="text-slate-400">Объект</div><b className="text-slate-950">{ctx.title || "—"}</b></div>
          <div className="rounded-2xl bg-slate-50 p-4"><div className="text-slate-400">Следующий этап</div><b className="text-slate-950">Утверждение сценария → HeyGen</b></div>
        </div> : null}
      </div>
    </aside>
  );
}

function ContentInspector({ videos }) {
  const approvedCount = videos.filter((video) => video.publishingPackage?.status === "approved").length;
  const publishedCount = videos.filter((video) => video.publishingPackage?.publicationStatus?.status === "published_all").length;
  return (
    <aside className="space-y-4">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-xs font-black uppercase tracking-wide text-slate-500">Inspector</div>
        <h3 className="mt-1 text-xl font-black text-slate-950">Контекст публикаций</h3>
        <div className="mt-4 space-y-3 text-sm font-semibold text-slate-600">
          <div className="flex justify-between rounded-2xl bg-slate-50 p-4"><span>Готовых видео</span><b className="text-slate-950">{videos.length}</b></div>
          <div className="flex justify-between rounded-2xl bg-slate-50 p-4"><span>Утверждено</span><b className="text-slate-950">{approvedCount}</b></div>
          <div className="flex justify-between rounded-2xl bg-slate-50 p-4"><span>Опубликовано везде</span><b className="text-slate-950">{publishedCount}</b></div>
          <div className="rounded-2xl bg-slate-50 p-4"><div className="text-slate-400">Сотрудник</div><b className="text-slate-950">Content Manager</b></div>
          <div className="rounded-2xl bg-slate-50 p-4"><div className="text-slate-400">Задача</div><b className="text-slate-950">Подготовить тексты для ручной публикации</b></div>
          <div className="rounded-2xl bg-slate-50 p-4"><div className="text-slate-400">Следующий этап</div><b className="text-slate-950">Проверка текста → публикация вручную</b></div>
        </div>
      </div>
    </aside>
  );
}

function PublishingInspector({ videos, publishingStatus, onRunTelegramDue, onCopySchedulerReport, schedulerLoading, schedulerFeedback }) {
  const approved = getApprovedVideos(videos);
  const partial = approved.filter((video) => video.publishingPackage?.publicationStatus?.status === "published_partial").length;
  const complete = approved.filter((video) => video.publishingPackage?.publicationStatus?.status === "published_all").length;
  const waiting = Math.max(0, approved.length - partial - complete);
  const telegramQueue = approved
    .map((video) => {
      const telegram = video.publishingPackage?.publicationStatus?.channels?.telegram || {};
      const plannedTime = new Date(telegram.plannedAt || 0).getTime();
      if (!Number.isFinite(plannedTime) || plannedTime <= 0 || hasTelegramPublicationEvidence(telegram)) return null;
      return { video, telegram, plannedTime };
    })
    .filter(Boolean)
    .sort((a, b) => a.plannedTime - b.plannedTime);
  const telegramDue = telegramQueue.filter((item) => item.plannedTime <= Date.now()).length;
  const nextTelegramPlan = telegramQueue[0] || null;
  const schedulerEnabled = Boolean(publishingStatus?.schedulerEnabled);
  const schedulerReadyReason = publishingStatus?.schedulerReadyReason || (schedulerEnabled ? "ready" : "unknown");
  const statusTelegramQueue = publishingStatus?.telegramQueue || {};
  const statusTelegramDue = Number(statusTelegramQueue.due);
  const statusTelegramPlanned = Number(statusTelegramQueue.planned);
  const telegramDueCount = Number.isFinite(statusTelegramDue) ? statusTelegramDue : telegramDue;
  const telegramPlannedCount = Number.isFinite(statusTelegramPlanned) ? statusTelegramPlanned : telegramQueue.length;
  const nextTelegramPlanStatus = statusTelegramQueue.next || null;
  const nextTelegramPlannedAt = nextTelegramPlan?.telegram?.plannedAt || nextTelegramPlanStatus?.plannedAt || "";
  const nextTelegramPlannedMs = new Date(nextTelegramPlannedAt || 0).getTime();
  const nextTelegramIsDue = Number.isFinite(nextTelegramPlannedMs) && nextTelegramPlannedMs > 0 && nextTelegramPlannedMs <= Date.now();
  const nextTelegramDueAgeMin = nextTelegramIsDue ? Math.max(0, Math.round((Date.now() - nextTelegramPlannedMs) / 60000)) : 0;
  const telegramDueRun = publishingStatus?.telegramDueRun || {};
  const lastDueRun = telegramDueRun.lastRun || null;
  const schedulerReasonLabels = {
    ready: "готов",
    disabled_by_env: "выключен ENV",
    telegram_env_missing: "нет Telegram ENV",
    test_mode: "test mode",
    unknown: "не готов",
  };
  const schedulerReasonLabel = schedulerReasonLabels[schedulerReadyReason] || schedulerReasonLabels.unknown;
  const schedulerIntervalMin = Math.max(1, Math.round(Number(publishingStatus?.schedulerIntervalMs || 60000) / 60000));
  const schedulerBatchLimit = Number(publishingStatus?.schedulerBatchLimit || 5);
  const manualRunWillPublish = Math.min(telegramDueCount, schedulerBatchLimit);
  const manualRunRemaining = Math.max(0, telegramDueCount - manualRunWillPublish);
  const manualRunBatchCapped = telegramDueCount > schedulerBatchLimit;
  const manualRunHint = schedulerLoading || telegramDueRun.running
    ? "Ручной запуск недоступен: scheduler уже выполняется."
    : telegramDueCount
      ? `Готово к ручному запуску: ${telegramDueCount}.`
      : "Ручной запуск недоступен: нет due Telegram.";
  const lastDueRunFinishedMs = new Date(lastDueRun?.finishedAt || lastDueRun?.startedAt || 0).getTime();
  const schedulerIntervalMs = Math.max(60000, Number(publishingStatus?.schedulerIntervalMs || 60000));
  const nextSchedulerCheckAt = schedulerEnabled && Number.isFinite(lastDueRunFinishedMs) && lastDueRunFinishedMs > 0
    ? new Date(lastDueRunFinishedMs + schedulerIntervalMs).toISOString()
    : "";
  const nextSchedulerCheckMs = new Date(nextSchedulerCheckAt || 0).getTime();
  const schedulerCheckOverdue = schedulerEnabled
    && !telegramDueRun.running
    && Number.isFinite(nextSchedulerCheckMs)
    && nextSchedulerCheckMs > 0
    && Date.now() > nextSchedulerCheckMs + schedulerIntervalMs;
  const nextActions = approved.map(getNextPublicationAction);
  const overdue = nextActions.filter((action) => action.tone === "red").length;
  const today = nextActions.filter((action) => action.tone === "yellow").length;
  const historyItems = approved.flatMap((video) => {
    const history = video.publishingPackage?.publicationStatus?.history || [];
    return Array.isArray(history) ? history : [];
  });
  const latestHistory = [...historyItems].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))[0] || null;
  const telegramDelivery = approved.reduce(
    (acc, video) => {
      const telegram = video.publishingPackage?.publicationStatus?.channels?.telegram || {};
      if (!telegram.published) return acc;
      const method = telegram.deliveryMethod || "unknown";
      return { ...acc, [method]: (acc[method] || 0) + 1, total: acc.total + 1 };
    },
    { total: 0 }
  );
  return (
    <aside className="space-y-4">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-xs font-black uppercase tracking-wide text-slate-500">Inspector</div>
        <h3 className="mt-1 text-xl font-black text-slate-950">Publishing Manager</h3>
        <div className="mt-4 space-y-3 text-sm font-semibold text-slate-600">
          <div className="flex justify-between rounded-2xl bg-slate-50 p-4"><span>В очереди</span><b className="text-slate-950">{approved.length}</b></div>
          <div className="flex justify-between rounded-2xl bg-slate-50 p-4"><span>Не опубликовано</span><b className="text-slate-950">{waiting}</b></div>
          <div className="flex justify-between rounded-2xl bg-slate-50 p-4"><span>Частично</span><b className="text-slate-950">{partial}</b></div>
          <div className="flex justify-between rounded-2xl bg-slate-50 p-4"><span>Везде</span><b className="text-slate-950">{complete}</b></div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-rose-50 p-4"><div className="text-slate-400">Просрочено</div><b className="text-rose-700">{overdue}</b></div>
            <div className="rounded-2xl bg-amber-50 p-4"><div className="text-slate-400">Сегодня</div><b className="text-amber-700">{today}</b></div>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="flex justify-between"><span>История изменений</span><b className="text-slate-950">{historyItems.length}</b></div>
            {latestHistory ? (
              <div className="mt-2 rounded-xl bg-white px-3 py-2 text-xs">
                <b className="text-slate-900">{latestHistory.channelLabel || latestHistory.channel || "Канал"}</b>
                <span className="ml-1 text-slate-500">{latestHistory.label || latestHistory.field || "Изменение"}</span>
                {latestHistory.at ? <div className="mt-1 text-slate-400">{fmtDate(latestHistory.at)}</div> : null}
              </div>
            ) : null}
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="text-slate-400">Telegram delivery</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="flex justify-between rounded-xl bg-white px-3 py-2"><span>Видео URL</span><b className="text-emerald-700">{telegramDelivery.sendVideo || 0}</b></div>
              <div className="flex justify-between rounded-xl bg-white px-3 py-2"><span>Файлом</span><b className="text-blue-700">{telegramDelivery.sendVideoUpload || 0}</b></div>
              <div className="flex justify-between rounded-xl bg-white px-3 py-2"><span>Ссылкой</span><b className="text-amber-700">{telegramDelivery.sendMessage || 0}</b></div>
              <div className="flex justify-between rounded-xl bg-white px-3 py-2"><span>Всего</span><b className="text-slate-950">{telegramDelivery.total}</b></div>
            </div>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="text-slate-400">Telegram auto publish</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="flex justify-between rounded-xl bg-white px-3 py-2"><span>К запуску</span><b className={telegramDueCount ? "text-rose-700" : "text-slate-950"}>{telegramDueCount}</b></div>
              <div className="flex justify-between rounded-xl bg-white px-3 py-2"><span>В плане</span><b className="text-blue-700">{telegramPlannedCount}</b></div>
              <div className="flex justify-between rounded-xl bg-white px-3 py-2"><span>Scheduler</span><b className={schedulerEnabled ? "text-emerald-700" : "text-rose-700"}>{schedulerEnabled ? "on" : "off"}</b></div>
              <div className="flex justify-between rounded-xl bg-white px-3 py-2"><span>Готовность</span><b className={schedulerEnabled ? "text-emerald-700" : "text-amber-700"}>{schedulerReasonLabel}</b></div>
              <div className="flex justify-between rounded-xl bg-white px-3 py-2"><span>Состояние</span><b className={telegramDueRun.running ? "text-blue-700" : "text-slate-950"}>{telegramDueRun.running ? "running" : "idle"}</b></div>
              <div className="flex justify-between rounded-xl bg-white px-3 py-2"><span>Batch</span><b className={manualRunBatchCapped ? "text-amber-700" : "text-slate-950"}>{schedulerBatchLimit}{manualRunBatchCapped ? " · лимит" : ""}</b></div>
            </div>
            {nextTelegramPlan || nextTelegramPlanStatus ? (
              <div className="mt-2 rounded-xl bg-white px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <b className="text-slate-900">{nextTelegramPlan?.video?.code || nextTelegramPlanStatus?.code || "AI"}</b>
                  <span className={nextTelegramIsDue ? "font-bold text-rose-700" : "font-bold text-blue-700"}>{nextTelegramIsDue ? "к запуску" : "в плане"}</span>
                </div>
                <div className="mt-1 text-slate-500">{fmtDate(nextTelegramPlannedAt)}</div>
                {nextTelegramIsDue ? <div className="mt-1 font-bold text-rose-700">Ждёт {nextTelegramDueAgeMin} мин</div> : null}
              </div>
            ) : null}
            {lastDueRun ? (
              <div className="mt-2 rounded-xl bg-white px-3 py-2 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="font-bold text-slate-500">Последний запуск</span>
                  <b className={lastDueRun.success ? "text-emerald-700" : "text-rose-700"}>{lastDueRun.success ? "ok" : "error"}</b>
                </div>
                <div className="mt-1 text-slate-400">{fmtDate(lastDueRun.finishedAt || lastDueRun.startedAt)}</div>
                <div className="mt-2 grid grid-cols-3 gap-1 text-[11px]">
                  <span className="rounded-lg bg-slate-50 px-2 py-1">Проверено: <b>{lastDueRun.checked || 0}</b></span>
                  <span className="rounded-lg bg-emerald-50 px-2 py-1">ОК: <b>{lastDueRun.published || 0}</b></span>
                  <span className="rounded-lg bg-rose-50 px-2 py-1">Ошибки: <b>{lastDueRun.failed || 0}</b></span>
                </div>
                {Array.isArray(lastDueRun.resultsPreview) && lastDueRun.resultsPreview.length ? (
                  <div className="mt-2 space-y-1">
                    {lastDueRun.resultsPreview.map((item) => {
                      const message = String(item.message || "").trim();
                      return (
                        <div key={item.jobId || item.code} className="rounded-lg bg-slate-50 px-2 py-1 text-[11px]">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-bold text-slate-700">{item.code || "AI"}</span>
                            <span className={item.success ? "text-emerald-700" : "text-rose-700"}>{item.success ? (item.deliveryMethod || "ok") : "error"}</span>
                          </div>
                          {message ? <div className={item.success ? "mt-0.5 truncate text-slate-400" : "mt-0.5 truncate text-rose-600"}>{message}</div> : null}
                        </div>
                      );
                    })}
                    {lastDueRun.resultsOverflow ? <div className="text-[11px] text-slate-400">+{lastDueRun.resultsOverflow} ещё</div> : null}
                  </div>
                ) : null}
                <div className="mt-1 text-[11px] text-slate-400">{lastDueRun.actor || "system"} · {Math.round(Number(lastDueRun.durationMs || 0) / 1000)} сек.</div>
                {nextSchedulerCheckAt ? (
                  <div className={schedulerCheckOverdue ? "mt-1 text-[11px] font-bold text-amber-700" : "mt-1 text-[11px] font-bold text-blue-700"}>
                    Следующая проверка: {fmtDate(nextSchedulerCheckAt)}{schedulerCheckOverdue ? " · просрочена" : ""}
                  </div>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              onClick={onRunTelegramDue}
              disabled={schedulerLoading || telegramDueRun.running || !telegramDueCount}
              className="mt-3 w-full rounded-2xl bg-emerald-700 px-3 py-2 text-xs font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {schedulerLoading || telegramDueRun.running ? "Проверяю..." : "Запустить due Telegram"}
            </button>
            <div className={telegramDueCount && !telegramDueRun.running && !schedulerLoading ? "mt-1 text-[11px] font-bold text-emerald-700" : "mt-1 text-[11px] font-bold text-slate-400"}>{manualRunHint}</div>
            {telegramDueCount ? (
              <div className="mt-1 text-[11px] font-bold text-slate-500">
                При запуске: отправит {manualRunWillPublish}{manualRunRemaining ? `, останется ${manualRunRemaining}` : ", очередь закроется"}.
              </div>
            ) : null}
            <button
              type="button"
              onClick={onCopySchedulerReport}
              disabled={!lastDueRun && !telegramPlannedCount}
              className="mt-2 w-full rounded-2xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Скопировать отчёт scheduler
            </button>
            <div className="mt-1 text-[11px] font-bold text-slate-400">Авто: каждые {schedulerIntervalMin} мин. Ручной запуск: до {schedulerBatchLimit} публикаций.</div>
            {schedulerFeedback ? <div className="mt-2 rounded-xl bg-white px-3 py-2 text-xs text-slate-600">{schedulerFeedback}</div> : null}
          </div>
          <div className="rounded-2xl bg-slate-50 p-4"><div className="text-slate-400">Задача</div><b className="text-slate-950">Контроль ручных публикаций</b></div>
        </div>
      </div>
    </aside>
  );
}

function JobList({ jobs, activeJobId, onOpenJob }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between"><h3 className="text-lg font-black text-slate-950">Последние задачи</h3><Pill>{jobs.length}</Pill></div>
      <div className="mt-4 space-y-3">
        {jobs.length ? jobs.slice(0, 7).map((j) => {
          const statusMeta = getJobStatusMeta(j);
          return (
            <button
              key={j.id}
              type="button"
              onClick={() => onOpenJob?.(j)}
              className={cn(
                "w-full rounded-2xl p-4 text-left transition hover:bg-slate-100",
                activeJobId === j.id ? "bg-blue-50 ring-1 ring-blue-100" : "bg-slate-50"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-slate-950">{j.command || j.type}</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">{fmtDate(j.createdAt)}</div>
                </div>
                <Pill tone={statusMeta.tone}>{statusMeta.label}</Pill>
              </div>
            </button>
          );
        }) : <div className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-500">Пока задач нет.</div>}
      </div>
    </div>
  );
}

function PublishingSummary({ videos }) {
  const approvedVideos = videos.filter((video) => video.publishingPackage?.status === "approved");
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-black text-slate-950">Готово к публикации</h3>
        <Pill tone="green">{approvedVideos.length}</Pill>
      </div>
      <div className="mt-4 space-y-3">
        {approvedVideos.length ? approvedVideos.slice(0, 5).map((video) => (
          <div key={video.id} className="rounded-2xl bg-slate-50 p-4">
            <div className="text-sm font-black text-slate-950">{video.code || "AI"} · {video.title}</div>
            <div className="mt-1 text-xs font-bold text-slate-500">{getPublicationStatusLabel(video.publishingPackage?.publicationStatus)}</div>
          </div>
        )) : (
          <div className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-500">Пока нет утвержденных пакетов.</div>
        )}
      </div>
    </div>
  );
}

function getPublicationStatusLabel(publicationStatus = {}) {
  const status = publicationStatus?.status || "not_published";
  if (status === "published_all") return "Опубликовано везде";
  if (status === "published_partial") return "Опубликовано частично";
  return "Не опубликовано";
}

function getPublicationStatusTone(publicationStatus = {}) {
  const status = publicationStatus?.status || "not_published";
  if (status === "published_all") return "green";
  if (status === "published_partial") return "blue";
  return "yellow";
}

function getTelegramDeliveryMeta(method = "") {
  if (method === "sendVideo") return { label: "Видео URL", tone: "green" };
  if (method === "sendVideoUpload") return { label: "Видео файлом", tone: "blue" };
  if (method === "sendMessage") return { label: "Ссылка", tone: "yellow" };
  return null;
}

function hasTelegramPublicationEvidence(item = {}) {
  return Boolean(item.published || String(item.url || "").trim() || item.messageId);
}

function hasTelegramPublicationIssue(item = {}, feedback = null) {
  if (feedback?.tone === "red") return true;
  const log = Array.isArray(item.deliveryLog) ? item.deliveryLog : [];
  if (!log.length) return false;
  const hasSuccess = log.some((entry) => entry?.status === "success");
  const hasFailure = log.some((entry) => entry?.status === "failed");
  return hasFailure && !hasSuccess;
}

function getDeliveryLogMethodLabel(method = "") {
  return getTelegramDeliveryMeta(method)?.label || method || "Попытка";
}

function getDeliveryLogStatusTone(status = "") {
  if (status === "success") return "text-emerald-700";
  if (status === "failed") return "text-rose-700";
  return "text-amber-700";
}

const PUBLICATION_CHANNELS = [
  { id: "instagram", label: "Instagram" },
  { id: "telegram", label: "Telegram" },
  { id: "stories", label: "Stories" },
  { id: "reels", label: "Reels" },
];

const PUBLISHING_MANAGER_PREFS_KEY = "travella.aiOS.publishingManagerPrefs.v1";

function readPublishingManagerPrefs() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PUBLISHING_MANAGER_PREFS_KEY);
    return raw ? JSON.parse(raw) || {} : {};
  } catch {
    return {};
  }
}

function writePublishingManagerPrefs(prefs) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PUBLISHING_MANAGER_PREFS_KEY, JSON.stringify(prefs || {}));
  } catch {}
}

function getApprovedVideos(videos = []) {
  return videos.filter((video) => video.publishingPackage?.status === "approved");
}

function getPublicationScheduleTime(video = {}) {
  const channels = video.publishingPackage?.publicationStatus?.channels || {};
  const times = Object.values(channels)
    .map((item) => new Date(item?.plannedAt || 0).getTime())
    .filter((time) => Number.isFinite(time) && time > 0);
  if (!times.length) return 0;
  return Math.min(...times);
}

function getPublicationPublishedTime(video = {}) {
  const channels = video.publishingPackage?.publicationStatus?.channels || {};
  const times = Object.values(channels)
    .map((item) => new Date(item?.publishedAt || 0).getTime())
    .filter((time) => Number.isFinite(time) && time > 0);
  if (!times.length) return 0;
  return Math.max(...times);
}

function getNextPublicationAction(video = {}) {
  const channels = video.publishingPackage?.publicationStatus?.channels || {};
  const pending = PUBLICATION_CHANNELS.map((channel) => {
    const item = channels?.[channel.id] || {};
    const plannedTime = new Date(item.plannedAt || 0).getTime();
    return {
      channel,
      item,
      plannedTime: Number.isFinite(plannedTime) && plannedTime > 0 ? plannedTime : 0,
    };
  }).filter(({ item }) => !item.published);
  if (!pending.length) return { label: "Всё опубликовано", tone: "green", channel: null, plannedAt: "" };
  pending.sort((a, b) => {
    const aTime = a.plannedTime || Number.MAX_SAFE_INTEGER;
    const bTime = b.plannedTime || Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });
  const next = pending[0];
  const now = Date.now();
  if (next.plannedTime && next.plannedTime < now) return { label: `Просрочено: ${next.channel.label}`, tone: "red", channel: next.channel, plannedAt: next.item.plannedAt };
  if (next.item.plannedAt && isToday(next.item.plannedAt)) return { label: `Сегодня: ${next.channel.label}`, tone: "yellow", channel: next.channel, plannedAt: next.item.plannedAt };
  if (next.item.plannedAt) return { label: `Следующее: ${next.channel.label}`, tone: "blue", channel: next.channel, plannedAt: next.item.plannedAt };
  return { label: `Назначить план: ${next.channel.label}`, tone: "slate", channel: next.channel, plannedAt: "" };
}

function getPublicationHistoryItems(publicationStatus = {}) {
  return Array.isArray(publicationStatus.history) ? publicationStatus.history.slice(0, 3) : [];
}

function getPublishingTextForChannel(pkg = {}, channelId = "") {
  const items = Array.isArray(pkg.items) ? pkg.items : [];
  const aliases = {
    instagram: ["instagram"],
    telegram: ["telegram"],
    stories: ["stories", "story", "story_text"],
    reels: ["reels", "shorts", "shorts_title"],
  }[channelId] || [channelId];
  const item = items.find((candidate) => {
    const values = [candidate?.id, candidate?.channel, candidate?.label, candidate?.title].map((value) => String(value || "").toLowerCase());
    return aliases.some((alias) => values.some((value) => value === alias || value.includes(alias)));
  });
  return String(item?.text || "").trim();
}

function buildPublishingQueueReport(videos = []) {
  const lines = videos.map((video, index) => {
    const pkg = video.publishingPackage || {};
    const publicationStatus = video.publishingPackage?.publicationStatus || {};
    const channels = publicationStatus.channels || {};
    const channelLines = PUBLICATION_CHANNELS.flatMap((channel) => {
      const item = channels?.[channel.id] || {};
      const delivery = channel.id === "telegram" && item.deliveryMethod ? `, ${getDeliveryLogMethodLabel(item.deliveryMethod)}` : "";
      const planned = item.plannedAt ? `, план: ${fmtDate(item.plannedAt)}` : "";
      const url = item.url ? `, ${item.url}` : "";
      const text = getPublishingTextForChannel(pkg, channel.id);
      return [
        `  - ${channel.label}: ${item.published ? "опубликовано" : "ожидает"}${delivery}${planned}${url}`,
        text ? `    Текст: ${text}` : "",
      ].filter(Boolean);
    });
    return [
      `${index + 1}. ${video.code || "AI"} · ${video.title || "Без названия"} · ${getPublicationStatusLabel(publicationStatus)}`,
      ...channelLines,
    ].join("\n");
  });
  return [`Travella AI OS — очередь публикаций`, `Всего: ${videos.length}`, "", ...lines].join("\n");
}

function buildPublishingLinksReport(videos = []) {
  const lines = videos.flatMap((video) => {
    const channels = video.publishingPackage?.publicationStatus?.channels || {};
    const links = PUBLICATION_CHANNELS.map((channel) => {
      const url = String(channels?.[channel.id]?.url || "").trim();
      return url ? `- ${video.code || "AI"} · ${channel.label}: ${url}` : "";
    }).filter(Boolean);
    return links;
  });
  return [`Travella AI OS — ссылки публикаций`, `Всего ссылок: ${lines.length}`, "", ...lines].join("\n");
}

function getPublishedLinkItems(videos = []) {
  return videos.flatMap((video) => {
    const channels = video.publishingPackage?.publicationStatus?.channels || {};
    return PUBLICATION_CHANNELS.map((channel) => {
      const item = channels?.[channel.id] || {};
      const url = String(item.url || "").trim();
      if (!item.published || !url) return null;
      const publishedAt = item.publishedAt ? new Date(item.publishedAt) : null;
      return {
        video,
        channel,
        item,
        url,
        publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
      };
    }).filter(Boolean);
  }).sort((a, b) => (b.publishedAt?.getTime() || 0) - (a.publishedAt?.getTime() || 0));
}

function buildPublishedLinksReport(videos = []) {
  const items = getPublishedLinkItems(videos);
  const lines = items.map(({ video, channel, item, url }, index) => {
    const date = item.publishedAt ? `${fmtDate(item.publishedAt)} · ` : "";
    return `${index + 1}. ${date}${video.code || "AI"} · ${channel.label}: ${url}`;
  });
  return [`Travella AI OS — опубликованные ссылки`, `Всего: ${items.length}`, "", ...lines].join("\n");
}

function countPublishingLinks(videos = []) {
  return videos.reduce((sum, video) => {
    const channels = video.publishingPackage?.publicationStatus?.channels || {};
    return sum + PUBLICATION_CHANNELS.filter((channel) => String(channels?.[channel.id]?.url || "").trim()).length;
  }, 0);
}

function getPublishingScheduleItems(videos = []) {
  return videos.flatMap((video) => {
    const channels = video.publishingPackage?.publicationStatus?.channels || {};
    return PUBLICATION_CHANNELS.map((channel) => {
      const item = channels?.[channel.id] || {};
      const plannedAt = item.plannedAt ? new Date(item.plannedAt) : null;
      if (!plannedAt || Number.isNaN(plannedAt.getTime())) return null;
      return {
        video,
        channel,
        item,
        plannedAt,
      };
    }).filter(Boolean);
  }).sort((a, b) => a.plannedAt - b.plannedAt);
}

function buildPublishingScheduleReport(videos = []) {
  const items = getPublishingScheduleItems(videos);
  const lines = items.map(({ video, channel, item }, index) => {
    const status = item.published ? "опубликовано" : "ожидает";
    const url = item.url ? ` · ${item.url}` : "";
    return `${index + 1}. ${fmtDate(item.plannedAt)} · ${video.code || "AI"} · ${channel.label} · ${status}${url}`;
  });
  return [`Travella AI OS — план публикаций`, `Всего задач: ${items.length}`, "", ...lines].join("\n");
}

function buildPublishingTextsReport(videos = [], channelId = "telegram") {
  const channels = channelId === "all" ? PUBLICATION_CHANNELS : PUBLICATION_CHANNELS.filter((channel) => channel.id === channelId);
  const lines = videos.flatMap((video) => {
    const pkg = video.publishingPackage || {};
    return channels.map((channel) => {
      const text = getPublishingTextForChannel(pkg, channel.id);
      return text ? `${video.code || "AI"} · ${channel.label}\n${text}` : "";
    }).filter(Boolean);
  });
  return [`Travella AI OS — тексты публикаций`, `Всего текстов: ${lines.length}`, "", ...lines].join("\n\n");
}

function countPublishingTexts(videos = [], channelId = "telegram") {
  const channels = channelId === "all" ? PUBLICATION_CHANNELS : PUBLICATION_CHANNELS.filter((channel) => channel.id === channelId);
  return videos.reduce((sum, video) => {
    const pkg = video.publishingPackage || {};
    return sum + channels.filter((channel) => getPublishingTextForChannel(pkg, channel.id)).length;
  }, 0);
}

function getPublishingErrorVideos(videos = [], feedbackByJobId = {}) {
  return videos.filter((video) => {
    const telegram = video.publishingPackage?.publicationStatus?.channels?.telegram || {};
    return hasTelegramPublicationIssue(telegram, feedbackByJobId?.[video.jobId]);
  });
}

function buildPublishingErrorsReport(videos = [], feedbackByJobId = {}) {
  const problemVideos = getPublishingErrorVideos(videos, feedbackByJobId);
  const lines = problemVideos.map((video, index) => {
    const pkg = video.publishingPackage || {};
    const telegram = pkg.publicationStatus?.channels?.telegram || {};
    const feedback = feedbackByJobId?.[video.jobId];
    const log = Array.isArray(telegram.deliveryLog) ? telegram.deliveryLog : [];
    const logLines = log.length
      ? log.map((entry) => `  - ${getDeliveryLogMethodLabel(entry.method)}: ${entry.status || "unknown"}${entry.message ? ` · ${entry.message}` : ""}`)
      : ["  - Нет delivery log"];
    const text = getPublishingTextForChannel(pkg, "telegram");
    return [
      `${index + 1}. ${video.code || "AI"} · ${video.title || "Без названия"}`,
      feedback?.message ? `  Feedback: ${feedback.message}` : "",
      telegram.plannedAt ? `  План: ${fmtDate(telegram.plannedAt)}` : "",
      telegram.url ? `  URL: ${telegram.url}` : "",
      ...logLines,
      text ? `  Текст: ${text}` : "",
    ].filter(Boolean).join("\n");
  });
  return [`Travella AI OS — ошибки Telegram`, `Всего: ${problemVideos.length}`, "", ...lines].join("\n");
}

function csvCell(value) {
  const text = String(value ?? "").replace(/\r?\n/g, " ").trim();
  return `"${text.replace(/"/g, '""')}"`;
}

function buildPublishingCsvReport(videos = []) {
  const header = ["code", "title", "status", "channel", "published", "planned_at", "url", "delivery_method", "text"];
  const rows = videos.flatMap((video) => {
    const pkg = video.publishingPackage || {};
    const publicationStatus = pkg.publicationStatus || {};
    const channels = publicationStatus.channels || {};
    return PUBLICATION_CHANNELS.map((channel) => {
      const item = channels?.[channel.id] || {};
      return [
        video.code || "AI",
        video.title || "",
        getPublicationStatusLabel(publicationStatus),
        channel.label,
        item.published ? "yes" : "no",
        item.plannedAt ? fmtDate(item.plannedAt) : "",
        item.url || "",
        channel.id === "telegram" && item.deliveryMethod ? getDeliveryLogMethodLabel(item.deliveryMethod) : "",
        getPublishingTextForChannel(pkg, channel.id),
      ].map(csvCell).join(";");
    });
  });
  return [header.map(csvCell).join(";"), ...rows].join("\n");
}

function countPublishingCsvRows(videos = []) {
  return videos.length * PUBLICATION_CHANNELS.length;
}

function toDateTimeLocal(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildDateTimeLocalPreset(dayOffset = 0, hour = 10, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return toDateTimeLocal(d);
}

function fromDateTimeLocal(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function buildPublishingDrafts(video = {}) {
  const title = video.title || "горящий тур";
  const destination = video.destination || title;
  const price = video.price ? `${video.price} ${video.currency || "USD"}` : "";
  const code = video.code || "";
  const priceLine = price ? `Есть пакет за ${price}.` : "Есть пакет по специальной цене.";
  const codeLine = code ? `Код: ${code}` : "";
  const lines = (items) => items.filter((line) => line !== null && line !== undefined).join("\n");

  return [
    {
      id: "instagram",
      label: "Instagram",
      title: "Caption для Instagram",
      text: lines([
        "Горящий отказной тур от Travella",
        "",
        `${destination}.`,
        priceLine,
        "",
        "Предложение может уйти быстро. Если хочешь забрать этот тур, напиши нам сейчас.",
        codeLine,
        "",
        "#travella #отказнойтур #туры #путешествия",
      ]),
    },
    {
      id: "telegram",
      label: "Telegram",
      title: "Пост для Telegram",
      text: lines([
        "Горящее предложение от Travella",
        "",
        `Направление: ${destination}`,
        price ? `Цена: ${price}` : null,
        codeLine,
        "",
        "Отказной тур может уйти в любой момент. Чтобы забрать пакет, свяжитесь с Travella.",
      ]),
    },
    {
      id: "shorts",
      label: "Shorts",
      title: "Shorts title",
      text: `${code ? `${code}: ` : ""}${title} ${price ? `за ${price}` : "от Travella"}`.trim(),
    },
  ];
}

function buildLocalPublishingPackage(video = {}) {
  const drafts = buildPublishingDrafts(video);
  return {
    status: "ready_for_review",
    summary: "Пакет публикации готов к ручной проверке.",
    items: [
      ...drafts,
      {
        id: "story_text",
        label: "Stories",
        title: "Текст для Stories",
        text: `Сторис 1: Горящий отказной тур\nСторис 2: ${video.destination || video.title || "Travella"}${video.price ? ` за ${video.price} ${video.currency || "USD"}` : ""}\nСторис 3: Предложение может уйти быстро\nСторис 4: ${video.code ? `Напиши код ${video.code}` : "Напиши нам"}`,
      },
      {
        id: "first_comment",
        label: "1-й комментарий",
        title: "Первый комментарий",
        text: `${video.code ? `Код: ${video.code}. ` : ""}Для деталей и бронирования напишите Travella в сообщения.`,
      },
      {
        id: "manager_note",
        label: "Менеджеру",
        title: "Сообщение менеджеру",
        text: `Проверь актуальность отказного тура${video.code ? ` ${video.code}` : ""}.\nПеред подтверждением обязательно сверить наличие у поставщика.`,
      },
    ],
    review: {
      status: "ready_for_review",
      approvalGate: "Публикация выполняется только после ручной проверки текста",
      checks: [
        { id: "real_data", label: "Текст построен на данных Travella", passed: true },
        { id: "manual_publish", label: "Публикация только после ручной проверки", passed: true },
      ],
    },
  };
}

function PublishingPackage({ video, copiedKey, onCopy, onSavePackage, onApprovePackage, onSavePublicationStatus, packageLoading }) {
  const [activeId, setActiveId] = React.useState("");
  const pkg = video.publishingPackage?.items?.length ? video.publishingPackage : buildLocalPublishingPackage(video);
  const [editItems, setEditItems] = React.useState(pkg.items || []);
  const items = editItems || [];
  const activeItem = items.find((item) => item.id === (activeId || items[0]?.id)) || items[0] || null;
  const copyKey = activeItem ? `${video.id}:${activeItem.id}` : `${video.id}:publishing`;
  const allText = items.map((item) => `${item.title || item.label}\n${item.text}`).join("\n\n---\n\n");
  const loading = packageLoading === video.jobId;
  const approved = pkg.status === "approved";
  const publicationStatus = pkg.publicationStatus || {};
  const channels = publicationStatus.channels || {};

  React.useEffect(() => {
    setEditItems(pkg.items || []);
    setActiveId((current) => current || pkg.items?.[0]?.id || "");
  }, [video.id, pkg.updatedAt, pkg.approvedAt, pkg.generatedAt]);

  function updateActiveText(text) {
    if (!activeItem) return;
    setEditItems((prev) => prev.map((item) => (item.id === activeItem.id ? { ...item, text } : item)));
  }

  return (
    <div className={cn("mt-4 rounded-2xl border p-4", approved ? "border-emerald-100 bg-emerald-50/70" : "border-blue-100 bg-blue-50/70")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className={cn("text-xs font-black uppercase tracking-wide", approved ? "text-emerald-700" : "text-blue-700")}>Content Manager</div>
          <div className="mt-1 text-sm font-black text-slate-950">{activeItem?.title || "Пакет публикации"}</div>
          <div className="mt-1 text-xs font-bold text-slate-500">
            {approved ? "Утверждено. Можно публиковать вручную." : pkg.summary || "Готово к ручной проверке."}
          </div>
          {approved ? <div className="mt-2"><Pill tone={getPublicationStatusTone(publicationStatus)}>{getPublicationStatusLabel(publicationStatus)}</Pill></div> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onCopy(copyKey, activeItem?.text || "")}
            disabled={!activeItem}
            className="rounded-2xl bg-blue-700 px-4 py-2 text-xs font-black text-white hover:bg-blue-800 disabled:opacity-40"
          >
            {copiedKey === copyKey ? "Скопировано" : "Скопировать"}
          </button>
          <button
            type="button"
            onClick={() => onCopy(`${video.id}:all`, allText)}
            className="rounded-2xl bg-slate-950 px-4 py-2 text-xs font-black text-white hover:bg-slate-800"
          >
            {copiedKey === `${video.id}:all` ? "Скопировано" : "Скопировать всё"}
          </button>
          <button
            type="button"
            onClick={() => onSavePackage?.(video, items)}
            disabled={loading || !items.length}
            className="rounded-2xl bg-white px-4 py-2 text-xs font-black text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-40"
          >
            {loading ? "Сохраняю..." : "Сохранить правки"}
          </button>
          <button
            type="button"
            onClick={() => onApprovePackage?.(video, items)}
            disabled={loading || !items.length}
            className="rounded-2xl bg-emerald-700 px-4 py-2 text-xs font-black text-white hover:bg-emerald-800 disabled:opacity-40"
          >
            {approved ? "Утверждено" : "Утвердить"}
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveId(item.id)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-black ring-1",
              activeItem?.id === item.id
                ? "bg-blue-700 text-white ring-blue-700"
                : "bg-white text-slate-600 ring-blue-100 hover:bg-blue-50"
            )}
          >
            {item.label || item.channel || item.title}
          </button>
        ))}
      </div>

      {activeItem ? (
        <textarea
          value={activeItem.text || ""}
          onChange={(e) => updateActiveText(e.target.value)}
          className="mt-3 min-h-[180px] w-full resize-y rounded-2xl bg-white p-3 text-sm font-semibold leading-6 text-slate-700 outline-none ring-1 ring-blue-100 focus:ring-2 focus:ring-blue-300"
        />
      ) : null}

      {pkg.review?.checks?.length ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {pkg.review.checks.map((check) => (
            <div key={check.id || check.label} className="rounded-2xl bg-white px-3 py-2 text-xs font-bold text-slate-700 ring-1 ring-blue-100">
              <span className={check.passed ? "text-emerald-600" : "text-amber-600"}>{check.passed ? "✓" : "!"}</span>{" "}
              {check.label}
            </div>
          ))}
        </div>
      ) : null}

      {approved ? (
        <div className="mt-3 rounded-2xl bg-white p-3 ring-1 ring-emerald-100">
          <div className="text-xs font-black uppercase tracking-wide text-emerald-700">Очередь публикации</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {PUBLICATION_CHANNELS.map((channel) => {
              const checked = Boolean(channels?.[channel.id]?.published);
              return (
                <label key={channel.id} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-100">
                  <span>{channel.label}</span>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={loading}
                    onChange={(e) => {
                      const nextChannels = {
                        ...channels,
                        [channel.id]: {
                          ...(channels?.[channel.id] || {}),
                          published: e.target.checked,
                        },
                      };
                      onSavePublicationStatus?.(video, nextChannels);
                    }}
                    className="h-4 w-4 accent-emerald-700"
                  />
                </label>
              );
            })}
          </div>
          <div className="mt-2 text-xs font-bold text-slate-500">Отмечай канал после ручной публикации. Это не публикует автоматически.</div>
        </div>
      ) : null}
    </div>
  );
}

function VideoLibrary({ videos, jobs, onOpenJob, onSavePackage, onApprovePackage, onSavePublicationStatus, packageLoading, mode = "media" }) {
  const [copiedKey, setCopiedKey] = React.useState("");
  const publishingMode = mode === "publishing";
  const visibleVideos = publishingMode
    ? [...videos].sort((a, b) => {
        const aApproved = a.publishingPackage?.status === "approved" ? 1 : 0;
        const bApproved = b.publishingPackage?.status === "approved" ? 1 : 0;
        if (aApproved !== bApproved) return bApproved - aApproved;
        return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
      })
    : videos;

  async function copyText(key, text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((current) => (current === key ? "" : current)), 1800);
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-slate-500">{publishingMode ? "Content Manager" : "Travella Media"}</div>
            <h2 className="mt-1 text-2xl font-black text-slate-950">{publishingMode ? "Публикации" : "Видео"}</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              {publishingMode
                ? "Очередь публикаций: утверждённые пакеты, captions, stories, комментарии и отметки ручной публикации."
                : "Готовые AI-ролики Video Operator, сохранённые в Travella Media или доступные из HeyGen."}
            </p>
          </div>
          <Pill tone="green">{videos.length}</Pill>
        </div>
      </div>

      <div className="grid gap-4 bg-slate-50/60 p-4 md:grid-cols-2 2xl:grid-cols-3">
        {visibleVideos.length ? visibleVideos.map((video) => {
          const job = jobs.find((x) => x.id === video.jobId);
          const url = video.artifactUrl || video.mediaUrl;
          return (
            <article key={video.id} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-black uppercase tracking-wide text-slate-500">{video.code || "AI video"}</div>
                  <h3 className="mt-1 line-clamp-2 text-lg font-black text-slate-950">{video.title}</h3>
                </div>
                <Pill tone={video.artifactUrl ? "green" : "blue"}>{video.artifactUrl ? "MP4" : "HeyGen"}</Pill>
              </div>

              {url ? (
                <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-950">
                  <video
                    src={url}
                    controls
                    preload="metadata"
                    playsInline
                    className="mx-auto aspect-[9/16] max-h-[420px] w-full bg-slate-950 object-contain"
                  />
                </div>
              ) : (
                <div className="mt-4 flex aspect-[9/16] max-h-[420px] items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-sm font-black text-slate-400">
                  MP4 недоступен
                </div>
              )}

              <div className="mt-4 space-y-2 text-sm font-semibold text-slate-600">
                <div className="flex justify-between rounded-2xl bg-slate-50 p-3"><span>Создано</span><b className="text-slate-950">{fmtDate(video.createdAt)}</b></div>
                <div className="flex justify-between rounded-2xl bg-slate-50 p-3"><span>Статус</span><b className="text-slate-950">{getJobStatusMeta(job || video).label}</b></div>
                <div className="flex justify-between rounded-2xl bg-slate-50 p-3"><span>Цена</span><b className="text-slate-950">{video.price ? `${video.price} ${video.currency || "USD"}` : "—"}</b></div>
                {!publishingMode ? <div className="flex justify-between rounded-2xl bg-slate-50 p-3"><span>Хранилище</span><b className="text-slate-950">{video.storageProvider || (video.artifactUrl ? "Media" : "HeyGen")}</b></div> : null}
              </div>

              {publishingMode ? (
                <PublishingPackage
                  video={video}
                  copiedKey={copiedKey}
                  onCopy={copyText}
                  onSavePackage={onSavePackage}
                  onApprovePackage={onApprovePackage}
                  onSavePublicationStatus={onSavePublicationStatus}
                  packageLoading={packageLoading}
                />
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                {!publishingMode && Array.isArray(video.actionButtons) ? video.actionButtons.map((button) => (
                  button?.url ? (
                    <a key={`${video.id}:${button.label}`} href={button.url} target="_blank" rel="noreferrer" className="rounded-2xl bg-emerald-700 px-4 py-2 text-xs font-black text-white hover:bg-emerald-800">
                      {button.label}
                    </a>
                  ) : null
                )) : null}
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer" className="rounded-2xl bg-slate-950 px-4 py-2 text-xs font-black text-white hover:bg-slate-800">
                    Открыть MP4
                  </a>
                ) : null}
                {!publishingMode && video.heygenUrl && video.heygenUrl !== url ? (
                  <a href={video.heygenUrl} target="_blank" rel="noreferrer" className="rounded-2xl bg-emerald-700 px-4 py-2 text-xs font-black text-white hover:bg-emerald-800">
                    HeyGen
                  </a>
                ) : null}
                {!publishingMode && job ? (
                  <button type="button" onClick={() => onOpenJob?.(job)} className="rounded-2xl bg-slate-100 px-4 py-2 text-xs font-black text-slate-800 hover:bg-slate-200">
                    Открыть задачу
                  </button>
                ) : null}
              </div>
            </article>
          );
        }) : (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-500 md:col-span-2 2xl:col-span-3">
            {publishingMode ? "Пока нет готовых роликов для публикации." : "Пока готовых видео нет. После генерации HeyGen и сохранения MP4 ролики появятся здесь."}
          </div>
        )}
      </div>
    </div>
  );
}

function PublishingManagerBoard({ videos, onSavePublicationStatus, onPublishTelegram, packageLoading, publishLoading, publishFeedback, telegramReady }) {
  const approvedVideos = getApprovedVideos(videos);
  const initialPrefs = React.useMemo(readPublishingManagerPrefs, []);
  const [workMode, setWorkMode] = React.useState(initialPrefs.workMode === "selected" ? "all" : initialPrefs.workMode || "all");
  const [statusFilter, setStatusFilter] = React.useState(initialPrefs.statusFilter || "all");
  const [deliveryFilter, setDeliveryFilter] = React.useState(initialPrefs.deliveryFilter || "all");
  const [query, setQuery] = React.useState("");
  const [sortMode, setSortMode] = React.useState(initialPrefs.sortMode || "schedule");
  const [copiedReport, setCopiedReport] = React.useState(false);
  const [copiedLinks, setCopiedLinks] = React.useState(false);
  const [copiedPublishedLinks, setCopiedPublishedLinks] = React.useState(false);
  const [copiedSchedule, setCopiedSchedule] = React.useState(false);
  const [copiedCsv, setCopiedCsv] = React.useState(false);
  const [copiedErrors, setCopiedErrors] = React.useState(false);
  const [copiedBulkTexts, setCopiedBulkTexts] = React.useState(false);
  const [copiedUrlKey, setCopiedUrlKey] = React.useState("");
  const [copiedTextKey, setCopiedTextKey] = React.useState("");
  const [selectedIds, setSelectedIds] = React.useState([]);
  const [bulkChannel, setBulkChannel] = React.useState(initialPrefs.bulkChannel || "telegram");
  const [bulkDate, setBulkDate] = React.useState("");
  const [bulkLoading, setBulkLoading] = React.useState(false);
  const [bulkFeedback, setBulkFeedback] = React.useState("");
  const normalizedQuery = query.trim().toLowerCase();
  function matchesWorkModeAndQuery(video) {
    const publicationStatus = video.publishingPackage?.publicationStatus || {};
    const telegram = publicationStatus.channels?.telegram || {};
    const nextAction = getNextPublicationAction(video);
    const hasIssue = hasTelegramPublicationIssue(telegram, publishFeedback?.[video.jobId]);
    const haystack = [video.code, video.title, video.destination, video.hotelName, telegram.url].filter(Boolean).join(" ").toLowerCase();
    const modeOk =
      workMode === "all" ||
      (workMode === "today" && ["red", "yellow"].includes(nextAction.tone)) ||
      (workMode === "overdue" && nextAction.tone === "red") ||
      (workMode === "unscheduled" && nextAction.tone === "slate") ||
      (workMode === "selected" && selectedIds.includes(video.id)) ||
      (workMode === "errors" && hasIssue);
    const queryOk = !normalizedQuery || haystack.includes(normalizedQuery);
    return modeOk && queryOk;
  }
  const baseFilteredVideos = approvedVideos.filter(matchesWorkModeAndQuery);
  const statusFilterCounts = baseFilteredVideos.reduce(
    (acc, video) => {
      const status = video.publishingPackage?.publicationStatus?.status || "not_published";
      return {
        all: acc.all + 1,
        waiting: acc.waiting + (status === "not_published" ? 1 : 0),
        partial: acc.partial + (status === "published_partial" ? 1 : 0),
        complete: acc.complete + (status === "published_all" ? 1 : 0),
      };
    },
    { all: 0, waiting: 0, partial: 0, complete: 0 }
  );
  const deliveryFilterCounts = baseFilteredVideos.reduce(
    (acc, video) => {
      const method = video.publishingPackage?.publicationStatus?.channels?.telegram?.deliveryMethod || "";
      return {
        all: acc.all + 1,
        sendVideo: acc.sendVideo + (method === "sendVideo" ? 1 : 0),
        sendVideoUpload: acc.sendVideoUpload + (method === "sendVideoUpload" ? 1 : 0),
        sendMessage: acc.sendMessage + (method === "sendMessage" ? 1 : 0),
      };
    },
    { all: 0, sendVideo: 0, sendVideoUpload: 0, sendMessage: 0 }
  );
  const filteredVideos = baseFilteredVideos.filter((video) => {
    const publicationStatus = video.publishingPackage?.publicationStatus || {};
    const telegram = publicationStatus.channels?.telegram || {};
    const status = publicationStatus.status || "not_published";
    const statusOk =
      statusFilter === "all" ||
      (statusFilter === "waiting" && status === "not_published") ||
      (statusFilter === "partial" && status === "published_partial") ||
      (statusFilter === "complete" && status === "published_all");
    const deliveryOk = deliveryFilter === "all" || telegram.deliveryMethod === deliveryFilter;
    return statusOk && deliveryOk;
  }).sort((a, b) => {
    if (sortMode === "newest") return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
    if (sortMode === "status") {
      const rank = { not_published: 0, published_partial: 1, published_all: 2 };
      const aStatus = a.publishingPackage?.publicationStatus?.status || "not_published";
      const bStatus = b.publishingPackage?.publicationStatus?.status || "not_published";
      return (rank[aStatus] ?? 9) - (rank[bStatus] ?? 9);
    }
    if (sortMode === "published") return getPublicationPublishedTime(b) - getPublicationPublishedTime(a);
    const aSchedule = getPublicationScheduleTime(a) || Number.MAX_SAFE_INTEGER;
    const bSchedule = getPublicationScheduleTime(b) || Number.MAX_SAFE_INTEGER;
    return aSchedule - bSchedule || new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
  });
  const visibleIds = filteredVideos.map((video) => video.id);
  const overdueVisibleIds = filteredVideos
    .filter((video) => getNextPublicationAction(video).tone === "red")
    .map((video) => video.id);
  const todayVisibleIds = filteredVideos
    .filter((video) => ["red", "yellow"].includes(getNextPublicationAction(video).tone))
    .map((video) => video.id);
  const unscheduledVisibleIds = filteredVideos
    .filter((video) => getNextPublicationAction(video).tone === "slate")
    .map((video) => video.id);
  const pendingVisibleIds = filteredVideos
    .filter((video) => video.publishingPackage?.publicationStatus?.status !== "published_all")
    .map((video) => video.id);
  const telegramVisibleIds = filteredVideos
    .filter((video) => !hasTelegramPublicationEvidence(video.publishingPackage?.publicationStatus?.channels?.telegram))
    .map((video) => video.id);
  const errorVisibleIds = filteredVideos
    .filter((video) => hasTelegramPublicationIssue(video.publishingPackage?.publicationStatus?.channels?.telegram, publishFeedback?.[video.jobId]))
    .map((video) => video.id);
  const selectedVideos = filteredVideos.filter((video) => selectedIds.includes(video.id));
  const allVisibleSelected = Boolean(filteredVideos.length) && visibleIds.every((id) => selectedIds.includes(id));
  const reportSourceVideos = selectedVideos.length ? selectedVideos : filteredVideos;
  const reportLinksCount = countPublishingLinks(reportSourceVideos);
  const reportPublishedLinksCount = getPublishedLinkItems(reportSourceVideos).length;
  const reportScheduleCount = getPublishingScheduleItems(reportSourceVideos).length;
  const reportCsvRows = countPublishingCsvRows(reportSourceVideos);
  const reportErrorsCount = getPublishingErrorVideos(reportSourceVideos, publishFeedback).length;
  const bulkTextsCount = countPublishingTexts(reportSourceVideos, bulkChannel);
  const bulkTelegramTargets = selectedVideos.filter((video) => !hasTelegramPublicationEvidence(video.publishingPackage?.publicationStatus?.channels?.telegram));
  const retryTelegramTargets = reportSourceVideos.filter((video) => {
    const telegram = video.publishingPackage?.publicationStatus?.channels?.telegram || {};
    return hasTelegramPublicationIssue(telegram, publishFeedback?.[video.jobId]) && !hasTelegramPublicationEvidence(telegram);
  });
  const workModeCounts = approvedVideos.reduce(
    (acc, video) => {
      const action = getNextPublicationAction(video);
      return {
        all: acc.all + 1,
        today: acc.today + (["red", "yellow"].includes(action.tone) ? 1 : 0),
        overdue: acc.overdue + (action.tone === "red" ? 1 : 0),
        unscheduled: acc.unscheduled + (action.tone === "slate" ? 1 : 0),
        selected: acc.selected + (selectedIds.includes(video.id) ? 1 : 0),
        errors: acc.errors + (hasTelegramPublicationIssue(video.publishingPackage?.publicationStatus?.channels?.telegram, publishFeedback?.[video.jobId]) ? 1 : 0),
      };
    },
    { all: 0, today: 0, overdue: 0, unscheduled: 0, selected: 0, errors: 0 }
  );

  React.useEffect(() => {
    writePublishingManagerPrefs({ workMode: workMode === "selected" ? "all" : workMode, statusFilter, deliveryFilter, sortMode, bulkChannel });
  }, [workMode, statusFilter, deliveryFilter, sortMode, bulkChannel]);

  function updateChannel(video, channelId, patch) {
    const current = video.publishingPackage?.publicationStatus?.channels || {};
    const nextChannels = {
      ...current,
      [channelId]: {
        ...(current?.[channelId] || {}),
        ...patch,
      },
    };
    onSavePublicationStatus?.(video, nextChannels);
  }

  function toggleSelected(videoId) {
    setSelectedIds((current) => (current.includes(videoId) ? current.filter((id) => id !== videoId) : [...current, videoId]));
  }

  function toggleVisibleSelection() {
    setSelectedIds((current) => {
      if (allVisibleSelected) return current.filter((id) => !visibleIds.includes(id));
      return Array.from(new Set([...current, ...visibleIds]));
    });
  }

  function selectOverdueVisible() {
    if (!overdueVisibleIds.length) return;
    setSelectedIds((current) => Array.from(new Set([...current, ...overdueVisibleIds])));
  }

  function selectTodayVisible() {
    if (!todayVisibleIds.length) return;
    setSelectedIds((current) => Array.from(new Set([...current, ...todayVisibleIds])));
  }

  function selectUnscheduledVisible() {
    if (!unscheduledVisibleIds.length) return;
    setSelectedIds((current) => Array.from(new Set([...current, ...unscheduledVisibleIds])));
  }

  function selectPendingVisible() {
    if (!pendingVisibleIds.length) return;
    setSelectedIds((current) => Array.from(new Set([...current, ...pendingVisibleIds])));
  }

  function selectTelegramVisible() {
    if (!telegramVisibleIds.length) return;
    setSelectedIds((current) => Array.from(new Set([...current, ...telegramVisibleIds])));
  }

  function selectErrorVisible() {
    if (!errorVisibleIds.length) return;
    setSelectedIds((current) => Array.from(new Set([...current, ...errorVisibleIds])));
  }

  function resetQueuePrefs() {
    setWorkMode("all");
    setStatusFilter("all");
    setDeliveryFilter("all");
    setSortMode("schedule");
    setBulkChannel("telegram");
    setQuery("");
    setSelectedIds([]);
    setBulkFeedback("");
  }

  async function applyBulkPatch(patch) {
    if (!selectedVideos.length || bulkLoading) return;
    setBulkLoading(true);
    setBulkFeedback("");
    try {
      const targetChannels = bulkChannel === "all" ? PUBLICATION_CHANNELS.map((channel) => channel.id) : [bulkChannel];
      for (const video of selectedVideos) {
        const current = video.publishingPackage?.publicationStatus?.channels || {};
        const nextChannels = { ...current };
        targetChannels.forEach((channelId) => {
          nextChannels[channelId] = {
            ...(current?.[channelId] || {}),
            ...patch(current?.[channelId] || {}),
          };
        });
        await onSavePublicationStatus?.(video, nextChannels);
      }
      setBulkFeedback(`Обновлено: ${selectedVideos.length}`);
    } catch (e) {
      setBulkFeedback(e?.message || "Не удалось применить массовое действие");
    } finally {
      setBulkLoading(false);
    }
  }

  async function applyStaggeredPlan(stepMinutes = 30) {
    const startIso = fromDateTimeLocal(bulkDate);
    const startMs = startIso ? new Date(startIso).getTime() : 0;
    if (!selectedVideos.length || !startMs || bulkLoading) return;
    setBulkLoading(true);
    setBulkFeedback("");
    try {
      const targetChannels = bulkChannel === "all" ? PUBLICATION_CHANNELS.map((channel) => channel.id) : [bulkChannel];
      for (let index = 0; index < selectedVideos.length; index += 1) {
        const video = selectedVideos[index];
        const plannedAt = new Date(startMs + index * stepMinutes * 60 * 1000).toISOString();
        const current = video.publishingPackage?.publicationStatus?.channels || {};
        const nextChannels = { ...current };
        targetChannels.forEach((channelId) => {
          nextChannels[channelId] = {
            ...(current?.[channelId] || {}),
            plannedAt,
          };
        });
        await onSavePublicationStatus?.(video, nextChannels);
      }
      setBulkFeedback(`Разнесено: ${selectedVideos.length} · шаг ${stepMinutes} мин`);
    } catch (e) {
      setBulkFeedback(e?.message || "Не удалось разнести план");
    } finally {
      setBulkLoading(false);
    }
  }

  async function publishTelegramBatch(targets, doneLabel = "Обновлено Telegram") {
    if (!targets.length || bulkLoading || !telegramReady) return;
    setBulkLoading(true);
    setBulkFeedback("");
    let succeeded = 0;
    let failed = 0;
    try {
      for (const video of targets) {
        setBulkFeedback(`Telegram: ${succeeded + failed + 1}/${targets.length} · ${video.code || video.title || "AI"}`);
        const ok = await onPublishTelegram?.(video);
        if (ok === false) failed += 1;
        else succeeded += 1;
      }
      setBulkFeedback(failed ? `Telegram с ошибками: ${succeeded}/${targets.length}` : `${doneLabel}: ${succeeded}/${targets.length}`);
    } catch (e) {
      setBulkFeedback(e?.message || "Не удалось выполнить массовую публикацию Telegram");
    } finally {
      setBulkLoading(false);
    }
  }

  function publishSelectedTelegram() {
    publishTelegramBatch(bulkTelegramTargets);
  }

  function retryTelegramErrors() {
    publishTelegramBatch(retryTelegramTargets, "Ошибки повторены");
  }

  async function copyQueueReport() {
    const text = buildPublishingQueueReport(reportSourceVideos);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopiedReport(true);
    window.setTimeout(() => setCopiedReport(false), 1800);
  }

  async function copyLinksReport() {
    if (!reportLinksCount) return;
    const text = buildPublishingLinksReport(reportSourceVideos);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopiedLinks(true);
    window.setTimeout(() => setCopiedLinks(false), 1800);
  }

  async function copyPublishedLinksReport() {
    if (!reportPublishedLinksCount) return;
    const text = buildPublishedLinksReport(reportSourceVideos);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopiedPublishedLinks(true);
    window.setTimeout(() => setCopiedPublishedLinks(false), 1800);
  }

  async function copyScheduleReport() {
    if (!reportScheduleCount) return;
    const text = buildPublishingScheduleReport(reportSourceVideos);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopiedSchedule(true);
    window.setTimeout(() => setCopiedSchedule(false), 1800);
  }

  async function copyCsvReport() {
    if (!reportCsvRows) return;
    const text = buildPublishingCsvReport(reportSourceVideos);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopiedCsv(true);
    window.setTimeout(() => setCopiedCsv(false), 1800);
  }

  async function copyErrorsReport() {
    if (!reportErrorsCount) return;
    const text = buildPublishingErrorsReport(reportSourceVideos, publishFeedback);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopiedErrors(true);
    window.setTimeout(() => setCopiedErrors(false), 1800);
  }

  async function copyBulkTextsReport() {
    if (!bulkTextsCount) return;
    const text = buildPublishingTextsReport(reportSourceVideos, bulkChannel);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopiedBulkTexts(true);
    window.setTimeout(() => setCopiedBulkTexts(false), 1800);
  }

  async function copyChannelUrl(key, url) {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = url;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopiedUrlKey(key);
    window.setTimeout(() => setCopiedUrlKey((current) => (current === key ? "" : current)), 1800);
  }

  async function copyChannelText(key, text) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopiedTextKey(key);
    window.setTimeout(() => setCopiedTextKey((current) => (current === key ? "" : current)), 1800);
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-slate-500">Publishing Manager</div>
            <h2 className="mt-1 text-2xl font-black text-slate-950">Очередь публикаций</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">Утверждённые пакеты: план, канал, ссылка на опубликованный пост и ручной статус.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={copyQueueReport}
              disabled={!filteredVideos.length}
              className="rounded-2xl bg-slate-950 px-4 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {copiedReport ? "Отчёт скопирован" : selectedVideos.length ? "Скопировать выбранное" : "Скопировать отчёт"}
            </button>
            <button
              type="button"
              onClick={copyLinksReport}
              disabled={!reportLinksCount}
              className="rounded-2xl bg-white px-4 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {copiedLinks ? "Ссылки скопированы" : reportLinksCount ? `Скопировать ссылки (${reportLinksCount})` : "Ссылок нет"}
            </button>
            <button
              type="button"
              onClick={copyPublishedLinksReport}
              disabled={!reportPublishedLinksCount}
              className="rounded-2xl bg-white px-4 py-2 text-xs font-black text-emerald-700 ring-1 ring-emerald-100 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {copiedPublishedLinks ? "Опубликованное скопировано" : reportPublishedLinksCount ? `Скопировать опубликованное (${reportPublishedLinksCount})` : "Опубликованного нет"}
            </button>
            <button
              type="button"
              onClick={copyScheduleReport}
              disabled={!reportScheduleCount}
              className="rounded-2xl bg-white px-4 py-2 text-xs font-black text-blue-700 ring-1 ring-blue-100 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {copiedSchedule ? "План скопирован" : reportScheduleCount ? `Скопировать план (${reportScheduleCount})` : "Плана нет"}
            </button>
            <button
              type="button"
              onClick={copyCsvReport}
              disabled={!reportCsvRows}
              className="rounded-2xl bg-white px-4 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {copiedCsv ? "CSV скопирован" : reportCsvRows ? `CSV (${reportCsvRows})` : "CSV пуст"}
            </button>
            <button
              type="button"
              onClick={copyErrorsReport}
              disabled={!reportErrorsCount}
              className="rounded-2xl bg-white px-4 py-2 text-xs font-black text-rose-700 ring-1 ring-rose-100 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {copiedErrors ? "Ошибки скопированы" : reportErrorsCount ? `Скопировать ошибки (${reportErrorsCount})` : "Ошибок нет"}
            </button>
            <button
              type="button"
              onClick={resetQueuePrefs}
              className="rounded-2xl bg-white px-4 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
            >
              Сбросить вид
            </button>
            <Pill tone="green">{filteredVideos.length} / {approvedVideos.length}</Pill>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            ["all", "Вся очередь"],
            ["today", "Сегодня"],
            ["overdue", "Просрочено"],
            ["unscheduled", "Без плана"],
            ["selected", "Выбранные"],
            ["errors", "С ошибками"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setWorkMode(id)}
              className={cn("rounded-2xl px-3 py-2 text-xs font-black ring-1", workMode === id ? "bg-blue-700 text-white ring-blue-700" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50")}
            >
              <span>{label}</span>
              <span className={cn("ml-2 rounded-full px-2 py-0.5", workMode === id ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500")}>{workModeCounts[id] || 0}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-[1fr_220px]">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по коду, названию или ссылке"
            className="min-w-0 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-blue-300"
          />
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value)}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 outline-none focus:border-blue-300"
          >
            <option value="schedule">Сначала по плану</option>
            <option value="newest">Сначала новые</option>
            <option value="status">Сначала ожидают</option>
            <option value="published">Сначала опубликованные</option>
          </select>
        </div>
        <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {[
              ["all", "Все"],
              ["waiting", "Ожидают"],
              ["partial", "Частично"],
              ["complete", "Везде"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setStatusFilter(id)}
                className={cn("rounded-2xl px-3 py-2 text-xs font-black ring-1", statusFilter === id ? "bg-slate-950 text-white ring-slate-950" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50")}
              >
                <span>{label}</span>
                <span className={cn("ml-2 rounded-full px-2 py-0.5", statusFilter === id ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500")}>{statusFilterCounts[id] || 0}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              ["all", "Telegram: все"],
              ["sendVideo", "Видео URL"],
              ["sendVideoUpload", "Файлом"],
              ["sendMessage", "Ссылкой"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setDeliveryFilter(id)}
                className={cn("rounded-2xl px-3 py-2 text-xs font-black ring-1", deliveryFilter === id ? "bg-emerald-700 text-white ring-emerald-700" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50")}
              >
                <span>{label}</span>
                <span className={cn("ml-2 rounded-full px-2 py-0.5", deliveryFilter === id ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500")}>{deliveryFilterCounts[id] || 0}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 rounded-3xl bg-slate-50 p-3 ring-1 ring-slate-100">
          <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={toggleVisibleSelection}
                disabled={!filteredVideos.length || bulkLoading}
                className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-40"
              >
                {allVisibleSelected ? "Снять выбор" : "Выбрать экран"}
              </button>
              <button
                type="button"
                onClick={selectTodayVisible}
                disabled={!todayVisibleIds.length || bulkLoading}
                className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-amber-700 ring-1 ring-amber-100 hover:bg-amber-50 disabled:opacity-40"
              >
                Выбрать сегодня ({todayVisibleIds.length})
              </button>
              <button
                type="button"
                onClick={selectOverdueVisible}
                disabled={!overdueVisibleIds.length || bulkLoading}
                className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-rose-700 ring-1 ring-rose-100 hover:bg-rose-50 disabled:opacity-40"
              >
                Выбрать просрочено ({overdueVisibleIds.length})
              </button>
              <button
                type="button"
                onClick={selectUnscheduledVisible}
                disabled={!unscheduledVisibleIds.length || bulkLoading}
                className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-40"
              >
                Выбрать без плана ({unscheduledVisibleIds.length})
              </button>
              <button
                type="button"
                onClick={selectPendingVisible}
                disabled={!pendingVisibleIds.length || bulkLoading}
                className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-40"
              >
                Выбрать ожидающие ({pendingVisibleIds.length})
              </button>
              <button
                type="button"
                onClick={selectTelegramVisible}
                disabled={!telegramVisibleIds.length || bulkLoading}
                className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-emerald-700 ring-1 ring-emerald-100 hover:bg-emerald-50 disabled:opacity-40"
              >
                Выбрать Telegram ({telegramVisibleIds.length})
              </button>
              <button
                type="button"
                onClick={selectErrorVisible}
                disabled={!errorVisibleIds.length || bulkLoading}
                className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-rose-700 ring-1 ring-rose-100 hover:bg-rose-50 disabled:opacity-40"
              >
                Выбрать ошибки ({errorVisibleIds.length})
              </button>
              <Pill tone={selectedVideos.length ? "blue" : "slate"}>Выбрано: {selectedVideos.length}</Pill>
              {selectedVideos.length ? (
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  disabled={bulkLoading}
                  className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-40"
                >
                  Очистить выбор
                </button>
              ) : null}
              {bulkFeedback ? <Pill tone={bulkFeedback.startsWith("Обновлено") || bulkFeedback.startsWith("Ошибки повторены") || bulkFeedback.startsWith("Разнесено") ? "green" : bulkFeedback.startsWith("Telegram:") ? "blue" : "red"}>{bulkFeedback}</Pill> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={bulkChannel}
                onChange={(e) => setBulkChannel(e.target.value)}
                disabled={bulkLoading}
                className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 outline-none focus:border-blue-300"
              >
                <option value="telegram">Telegram</option>
                <option value="instagram">Instagram</option>
                <option value="stories">Stories</option>
                <option value="reels">Reels</option>
                <option value="all">Все каналы</option>
              </select>
              <button
                type="button"
                onClick={copyBulkTextsReport}
                disabled={!bulkTextsCount || bulkLoading}
                className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {copiedBulkTexts ? "Тексты скопированы" : bulkTextsCount ? `Копировать тексты (${bulkTextsCount})` : "Текстов нет"}
              </button>
              <button
                type="button"
                onClick={publishSelectedTelegram}
                disabled={!bulkTelegramTargets.length || !telegramReady || bulkLoading}
                className="rounded-2xl bg-emerald-700 px-3 py-2 text-xs font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
                title={!telegramReady ? "Нужно настроить AI_PUBLISH_TELEGRAM_CHAT_ID на backend" : ""}
              >
                {telegramReady ? `Опубликовать Telegram (${bulkTelegramTargets.length})` : "Telegram ENV нет"}
              </button>
              <button
                type="button"
                onClick={retryTelegramErrors}
                disabled={!retryTelegramTargets.length || !telegramReady || bulkLoading}
                className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-rose-700 ring-1 ring-rose-100 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                title={!telegramReady ? "Нужно настроить AI_PUBLISH_TELEGRAM_CHAT_ID на backend" : ""}
              >
                {telegramReady ? `Повторить ошибки (${retryTelegramTargets.length})` : "Telegram ENV нет"}
              </button>
              <input
                type="datetime-local"
                value={bulkDate}
                onChange={(e) => setBulkDate(e.target.value)}
                disabled={bulkLoading}
                className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-blue-300"
              />
              <button
                type="button"
                onClick={() => setBulkDate(buildDateTimeLocalPreset(0, 18, 0))}
                disabled={bulkLoading}
                className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-amber-700 ring-1 ring-amber-100 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Сегодня 18:00
              </button>
              <button
                type="button"
                onClick={() => setBulkDate(buildDateTimeLocalPreset(1, 10, 0))}
                disabled={bulkLoading}
                className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-blue-700 ring-1 ring-blue-100 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Завтра 10:00
              </button>
              <button
                type="button"
                onClick={() => applyBulkPatch(() => ({ plannedAt: fromDateTimeLocal(bulkDate) }))}
                disabled={!selectedVideos.length || !bulkDate || bulkLoading}
                className="rounded-2xl bg-blue-700 px-3 py-2 text-xs font-black text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Назначить план
              </button>
              <button
                type="button"
                onClick={() => applyStaggeredPlan(30)}
                disabled={!selectedVideos.length || !bulkDate || bulkLoading}
                className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-blue-700 ring-1 ring-blue-100 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Разнести 30 мин
              </button>
              <button
                type="button"
                onClick={() => applyStaggeredPlan(15)}
                disabled={!selectedVideos.length || !bulkDate || bulkLoading}
                className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-blue-700 ring-1 ring-blue-100 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                15 мин
              </button>
              <button
                type="button"
                onClick={() => applyStaggeredPlan(60)}
                disabled={!selectedVideos.length || !bulkDate || bulkLoading}
                className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-blue-700 ring-1 ring-blue-100 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                60 мин
              </button>
              <button
                type="button"
                onClick={() => applyBulkPatch(() => ({ plannedAt: "" }))}
                disabled={!selectedVideos.length || bulkLoading}
                className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-blue-700 ring-1 ring-blue-100 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Очистить план
              </button>
              <button
                type="button"
                onClick={() => applyBulkPatch((item) => ({ published: true, publishedAt: item.publishedAt || new Date().toISOString() }))}
                disabled={!selectedVideos.length || bulkLoading}
                className="rounded-2xl bg-emerald-700 px-3 py-2 text-xs font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Отметить опубликовано
              </button>
              <button
                type="button"
                onClick={() => applyBulkPatch(() => ({ published: false, publishedAt: null }))}
                disabled={!selectedVideos.length || bulkLoading}
                className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Сбросить
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4 bg-slate-50/60 p-4">
        {filteredVideos.length ? filteredVideos.map((video) => {
          const pkg = video.publishingPackage || {};
          const publicationStatus = pkg.publicationStatus || {};
          const channels = publicationStatus.channels || {};
          const loading = packageLoading === video.jobId;
          const mediaUrl = video.artifactUrl || video.mediaUrl || "";
          const nextAction = getNextPublicationAction(video);
          const historyItems = getPublicationHistoryItems(publicationStatus);
          return (
            <article key={video.id} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="grid gap-4 xl:grid-cols-[220px_1fr]">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <label className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-500">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(video.id)}
                          onChange={() => toggleSelected(video.id)}
                          disabled={bulkLoading}
                          className="h-4 w-4 accent-blue-700"
                        />
                        <span>{video.code || "AI"}</span>
                      </label>
                      <h3 className="mt-1 text-lg font-black text-slate-950">{video.title}</h3>
                    </div>
                    <div className="flex flex-col items-end gap-2 text-right">
                      <Pill tone={getPublicationStatusTone(publicationStatus)}>{getPublicationStatusLabel(publicationStatus)}</Pill>
                      <Pill tone={nextAction.tone}>{nextAction.label}</Pill>
                    </div>
                  </div>
                  {nextAction.plannedAt ? <div className="mt-2 text-xs font-bold text-slate-500">План: {fmtDate(nextAction.plannedAt)}</div> : null}
                  {mediaUrl ? (
                    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-950">
                      <video src={mediaUrl} controls preload="metadata" playsInline className="mx-auto aspect-[9/16] max-h-[300px] w-full bg-slate-950 object-contain" />
                    </div>
                  ) : null}
                </div>

                <div className="space-y-3">
                  {PUBLICATION_CHANNELS.map((channel) => {
                    const item = channels?.[channel.id] || {};
                    const checked = Boolean(item.published);
                    const feedback = channel.id === "telegram" ? publishFeedback?.[video.jobId] : null;
                    const telegramDelivery = channel.id === "telegram" ? getTelegramDeliveryMeta(item.deliveryMethod) : null;
                    const telegramPublishedEvidence = channel.id === "telegram" ? hasTelegramPublicationEvidence(item) : false;
                    const deliveryLog = channel.id === "telegram" && Array.isArray(item.deliveryLog) ? item.deliveryLog : [];
                    const channelText = getPublishingTextForChannel(pkg, channel.id);
                    return (
                      <div key={channel.id} className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
                        <div className="grid gap-3 lg:grid-cols-[130px_190px_1fr_320px] lg:items-center">
                          <label className="flex items-center gap-2 text-sm font-black text-slate-900">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={loading}
                              onChange={(e) => updateChannel(video, channel.id, { published: e.target.checked })}
                              className="h-4 w-4 accent-emerald-700"
                            />
                            <span>{channel.label}</span>
                          </label>
                          <input
                            type="datetime-local"
                            value={toDateTimeLocal(item.plannedAt)}
                            disabled={loading}
                            onChange={(e) => updateChannel(video, channel.id, { plannedAt: fromDateTimeLocal(e.target.value) })}
                            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-blue-300"
                          />
                          <input
                            type="url"
                            value={item.url || ""}
                            disabled={loading}
                            onChange={(e) => updateChannel(video, channel.id, { url: e.target.value })}
                            placeholder="Ссылка на пост"
                            className="min-w-0 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-blue-300"
                          />
                          <div className="flex flex-wrap items-center gap-2">
                            {channelText ? (
                              <button
                                type="button"
                                onClick={() => copyChannelText(`${video.id}:${channel.id}:text`, channelText)}
                                className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                              >
                                {copiedTextKey === `${video.id}:${channel.id}:text` ? "Текст скопирован" : "Текст"}
                              </button>
                            ) : null}
                            {item.url ? (
                              <>
                                <a
                                  href={item.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                                >
                                  Открыть
                                </a>
                                <button
                                  type="button"
                                  onClick={() => copyChannelUrl(`${video.id}:${channel.id}:url`, item.url)}
                                  className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                                >
                                  {copiedUrlKey === `${video.id}:${channel.id}:url` ? "Скопировано" : "Копия"}
                                </button>
                              </>
                            ) : null}
                            {channel.id === "telegram" ? (
                              <button
                                type="button"
                                onClick={() => onPublishTelegram?.(video)}
                                disabled={loading || !telegramReady || telegramPublishedEvidence || publishLoading === video.jobId}
                                className="rounded-2xl bg-emerald-700 px-3 py-2 text-xs font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
                                title={
                                  !telegramReady
                                    ? "Нужно настроить AI_PUBLISH_TELEGRAM_CHAT_ID на backend"
                                    : telegramPublishedEvidence
                                      ? "У карточки уже есть Telegram публикация"
                                      : ""
                                }
                              >
                                {telegramPublishedEvidence ? "Уже есть пост" : publishLoading === video.jobId ? "Публикую..." : telegramReady ? "Опубликовать" : "Telegram ENV нет"}
                              </button>
                            ) : null}
                            <Pill tone={checked ? "green" : item.plannedAt ? "blue" : "slate"}>{checked ? "Опубликовано" : item.plannedAt ? "Запланировано" : "Ожидает"}</Pill>
                            {telegramDelivery ? <Pill tone={telegramDelivery.tone}>{telegramDelivery.label}</Pill> : null}
                          </div>
                        </div>
                        {feedback ? (
                          <div
                            className={cn(
                              "mt-2 rounded-2xl px-3 py-2 text-xs font-bold ring-1",
                              feedback.tone === "red"
                                ? "bg-rose-50 text-rose-700 ring-rose-100"
                                : feedback.tone === "green"
                                  ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                                  : "bg-blue-50 text-blue-700 ring-blue-100"
                            )}
                          >
                            {feedback.message}
                          </div>
                        ) : null}
                        {deliveryLog.length ? (
                          <div className="mt-2 rounded-2xl bg-white px-3 py-2 text-xs font-bold text-slate-600 ring-1 ring-slate-100">
                            <div className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-400">Publication run log</div>
                            <div className="flex flex-wrap gap-2">
                              {deliveryLog.map((entry, index) => (
                                <span key={`${entry.method || "step"}_${index}`} className="rounded-full bg-slate-50 px-2.5 py-1 ring-1 ring-slate-100">
                                  <b className={getDeliveryLogStatusTone(entry.status)}>{getDeliveryLogMethodLabel(entry.method)}</b>
                                  {entry.message ? <span className="ml-1 text-slate-500">· {entry.message}</span> : null}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {historyItems.length ? (
                    <div className="rounded-2xl bg-white px-3 py-2 text-xs font-bold text-slate-600 ring-1 ring-slate-100">
                      <div className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-400">История изменений</div>
                      <div className="flex flex-wrap gap-2">
                        {historyItems.map((entry, index) => (
                          <span key={`${entry.at || "history"}_${index}`} className="rounded-full bg-slate-50 px-2.5 py-1 ring-1 ring-slate-100">
                            <b className="text-slate-900">{entry.channelLabel || entry.channel || "Канал"}</b>
                            <span className="ml-1 text-slate-500">{entry.label || entry.field || "Изменение"}</span>
                            {entry.at ? <span className="ml-1 text-slate-400">· {fmtDate(entry.at)}</span> : null}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </article>
          );
        }) : (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-500">
            {approvedVideos.length ? "Нет публикаций под выбранный режим и фильтры." : "Пока нет утверждённых пакетов. Сначала утверди текст у Content Manager."}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminAiPlatform() {
  const [selectedEmployee, setSelectedEmployee] = React.useState("video_operator");
  const [activeView, setActiveView] = React.useState("today");
  const [status, setStatus] = React.useState(null);
  const [jobs, setJobs] = React.useState([]);
  const [videos, setVideos] = React.useState([]);
  const [command, setCommand] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [heygenLoading, setHeygenLoading] = React.useState("");
  const [refreshLoading, setRefreshLoading] = React.useState("");
  const [packageLoading, setPackageLoading] = React.useState("");
  const [publishLoading, setPublishLoading] = React.useState("");
  const [schedulerLoading, setSchedulerLoading] = React.useState(false);
  const [videoToggleLoading, setVideoToggleLoading] = React.useState(false);
  const [videoProfileLoading, setVideoProfileLoading] = React.useState(false);
  const [schedulerFeedback, setSchedulerFeedback] = React.useState("");
  const [publishFeedback, setPublishFeedback] = React.useState({});
  const [error, setError] = React.useState("");
  const [currentTask, setCurrentTask] = React.useState(null);
  const [serviceSearchType, setServiceSearchType] = React.useState("all");
  const [serviceSearchQuery, setServiceSearchQuery] = React.useState("");
  const [serviceSearchResults, setServiceSearchResults] = React.useState([]);
  const [selectedService, setSelectedService] = React.useState(null);
  const [serviceSearchLoading, setServiceSearchLoading] = React.useState(false);
  const [videoProfileDraft, setVideoProfileDraft] = React.useState({ avatarId: "", voiceId: "" });
  const videoOperatorIntro = "Я Travella AI Runtime. Для Video Operator можно нажать быструю команду под чатом или написать задачу обычным языком: “Создай сценарий для R941”, “Создай видео для последнего отказного авиабилета”, “Сделай агрессивнее H502”, “Другой hook E77”.";
  const [messages, setMessages] = React.useState([{ id: "hello", role: "assistant", text: videoOperatorIntro }]);
  const endRef = React.useRef(null);

  async function load() {
    setError("");
    try {
      const [s, j, v] = await Promise.all([
        apiGet("/api/admin/ai-platform/status", "admin"),
        apiGet("/api/admin/ai-platform/video-operator/jobs?limit=30", "admin"),
        apiGet("/api/admin/ai-platform/video-operator/videos?limit=100", "admin"),
      ]);
      setStatus(s || null);
      setJobs(Array.isArray(j?.jobs) ? j.jobs : []);
      setVideos(Array.isArray(v?.videos) ? v.videos : []);
    } catch (e) {
      setError(e?.message || "Не удалось загрузить Travella AI OS");
    }
  }

  React.useEffect(() => { load(); }, []);
  React.useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);
  React.useEffect(() => {
    const profile = status?.video?.runtimeProfile || {};
    setVideoProfileDraft({
      avatarId: profile.avatarId || "",
      voiceId: profile.voiceId || "",
    });
  }, [status?.video?.runtimeProfile?.avatarId, status?.video?.runtimeProfile?.voiceId]);
  React.useEffect(() => {
    if (selectedEmployee !== "video_operator") return;
    let alive = true;
    const timer = setTimeout(async () => {
      setServiceSearchLoading(true);
      try {
        const params = new URLSearchParams({
          type: serviceSearchType,
          q: serviceSearchQuery,
          limit: "6",
        });
        const res = await apiGet(`/api/admin/ai-platform/video-operator/services/search?${params.toString()}`, "admin");
        if (alive) setServiceSearchResults(Array.isArray(res?.services) ? res.services : []);
      } catch {
        if (alive) setServiceSearchResults([]);
      } finally {
        if (alive) setServiceSearchLoading(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [selectedEmployee, serviceSearchType, serviceSearchQuery]);

  function addMessage(msg) { setMessages((prev) => [...prev, { id: `${Date.now()}_${Math.random()}`, ...msg }]); }

  function updateJobMessages(nextJob, nextOutput) {
    if (!nextJob?.id) return;
    setMessages((prev) => prev.map((msg) => {
      if (msg.job?.id !== nextJob.id) return msg;
      return {
        ...msg,
        job: nextJob,
        output: nextOutput || nextJob.output || msg.output,
        events: nextJob.events || msg.events,
        text: nextOutput?.nextStep || msg.text,
      };
    }));
  }

  function serviceFromJobOutput(output = {}) {
    const service = output?.service || {};
    const ctx = service.videoContext || service || {};
    const code = output?.route?.serviceCode || service.taskCode || service.displayCode || ctx.code || service.code || "";
    if (!code && !ctx.title) return null;
    return {
      id: service.id || ctx.serviceId || "",
      taskCode: code,
      displayCode: code,
      category: service.category || "",
      categoryLabel: service.categoryLabel || ctx.category || "Отказное предложение",
      title: ctx.title || service.title || "",
      destination: ctx.destination || "",
      dates: ctx.dates || "",
      price: ctx.price || "",
      currency: ctx.currency || "USD",
    };
  }

  function openJob(job) {
    if (!job) return;
    const output = job.output || null;
    setSelectedEmployee("video_operator");
    setActiveView("today");
    setCurrentTask(job);
    setSelectedService(serviceFromJobOutput(output));
    setMessages([
      { id: "hello", role: "assistant", text: videoOperatorIntro },
      { id: `job_user_${job.id}`, role: "user", text: job.command || job.type || "Открытая задача" },
      {
        id: `job_${job.id}`,
        role: "assistant",
        text: output?.nextStep || getJobStatusMeta(job).label,
        events: job.events || [],
        output,
        job,
      },
    ]);
  }

  async function runTaskText(rawText) {
    const text = String(rawText || "").trim();
    if (!text || loading) return;
    setCommand("");
    setLoading(true);
    setError("");
    addMessage({ role: "user", text });
    addMessage({ role: "assistant", text: "Принял. Запускаю Travella AI Runtime: определяю сотрудника, выбираю инструменты и начинаю выполнение." });

    try {
      const res = await apiPost("/api/admin/ai-platform/tasks", { command: text, employeeId: selectedEmployee }, "admin");
      const job = res?.job || null;
      const output = res?.output || job?.output || null;
      setCurrentTask(job);
      setSelectedService(serviceFromJobOutput(output));
      addMessage({ role: "assistant", text: output?.nextStep || "Задача выполнена.", events: job?.events || [], output, job });
      await load();
    } catch (e) {
      const msg = e?.message || "Не удалось выполнить задачу";
      setError(msg);
      addMessage({ role: "assistant", text: `Не смог выполнить задачу.\n\nПричина: ${msg}` });
      await load();
    } finally {
      setLoading(false);
    }
  }

  async function runTask() {
    await runTaskText(command);
  }

  async function startHeygen(job) {
    if (!job?.id || heygenLoading) return;
    setHeygenLoading(job.id);
    setError("");
    addMessage({ role: "assistant", text: `Получил ручное утверждение сценария. Отправляю в HeyGen задачу #${job.id}.` });
    try {
      const res = await apiPost(`/api/admin/ai-platform/video-operator/jobs/${job.id}/heygen/start`, {}, "admin");
      const nextJob = res?.job || null;
      const output = res?.output || nextJob?.output || null;
      setCurrentTask(nextJob);
      updateJobMessages(nextJob, output);
      addMessage({
        role: "assistant",
        text: output?.heygen?.videoId
          ? `HeyGen принял задачу. Video ID: ${output.heygen.videoId}`
          : "HeyGen принял задачу.",
        events: nextJob?.events || [],
        output,
        job: nextJob,
      });
      await load();
    } catch (e) {
      const msg = e?.message || "Не удалось запустить HeyGen";
      setError(msg);
      addMessage({ role: "assistant", text: `HeyGen не запустился.\n\nПричина: ${msg}` });
      await load();
    } finally {
      setHeygenLoading("");
    }
  }

  async function refreshHeygen(job) {
    if (!job?.id || refreshLoading) return;
    setRefreshLoading(job.id);
    setError("");
    try {
      const res = await apiPost(`/api/admin/ai-platform/video-operator/jobs/${job.id}/refresh`, {}, "admin");
      const nextJob = res?.job || null;
      const output = res?.output || nextJob?.output || null;
      setCurrentTask(nextJob);
      updateJobMessages(nextJob, output);
      addMessage({
        role: "assistant",
        text: output?.heygen?.videoUrl
          ? "Видео готово. Ссылка появилась в карточке HeyGen."
          : `Статус HeyGen обновлён: ${output?.heygen?.status || "неизвестно"}.`,
        events: nextJob?.events || [],
        output,
        job: nextJob,
      });
      await load();
    } catch (e) {
      const msg = e?.message || "Не удалось обновить статус HeyGen";
      setError(msg);
      addMessage({ role: "assistant", text: `Не смог обновить статус HeyGen.\n\nПричина: ${msg}` });
      await load();
    } finally {
      setRefreshLoading("");
    }
  }

  async function toggleAiVideo() {
    if (videoToggleLoading) return;
    const nextEnabled = !Boolean(status?.video?.enabled);
    setVideoToggleLoading(true);
    setError("");
    try {
      const res = await apiPatch("/api/admin/ai-platform/settings/video", { enabled: nextEnabled }, "admin");
      setStatus((prev) => ({
        ...(prev || {}),
        video: {
          ...(prev?.video || {}),
          ...(res?.video || {}),
        },
      }));
      await load();
    } catch (e) {
      setError(e?.message || "Не удалось переключить AI Video");
      await load();
    } finally {
      setVideoToggleLoading(false);
    }
  }

  async function saveVideoProfile() {
    if (videoProfileLoading) return;
    setVideoProfileLoading(true);
    setError("");
    try {
      const res = await apiPatch("/api/admin/ai-platform/settings/video-profile", videoProfileDraft, "admin");
      setStatus((prev) => ({
        ...(prev || {}),
        video: {
          ...(prev?.video || {}),
          ...(res?.video || {}),
        },
      }));
      await load();
    } catch (e) {
      setError(e?.message || "Не удалось сохранить Avatar ID / Voice ID");
      await load();
    } finally {
      setVideoProfileLoading(false);
    }
  }

  async function savePublishingPackage(video, items) {
    if (!video?.jobId || packageLoading) return;
    setPackageLoading(video.jobId);
    setError("");
    try {
      await apiPatch(`/api/admin/ai-platform/video-operator/jobs/${video.jobId}/publishing-package`, { items }, "admin");
      await load();
    } catch (e) {
      setError(e?.message || "Не удалось сохранить пакет публикации");
    } finally {
      setPackageLoading("");
    }
  }

  async function approvePublishingPackage(video, items) {
    if (!video?.jobId || packageLoading) return;
    setPackageLoading(video.jobId);
    setError("");
    try {
      await apiPost(`/api/admin/ai-platform/video-operator/jobs/${video.jobId}/publishing-package/approve`, { items }, "admin");
      await load();
    } catch (e) {
      setError(e?.message || "Не удалось утвердить пакет публикации");
    } finally {
      setPackageLoading("");
    }
  }

  async function savePublicationStatus(video, channels) {
    if (!video?.jobId || packageLoading) return;
    setPackageLoading(video.jobId);
    setError("");
    try {
      await apiPatch(`/api/admin/ai-platform/video-operator/jobs/${video.jobId}/publication-status`, { channels }, "admin");
      await load();
    } catch (e) {
      setError(e?.message || "Не удалось сохранить статус публикации");
    } finally {
      setPackageLoading("");
    }
  }

  async function publishTelegram(video) {
    if (!video?.jobId || publishLoading) return false;
    setPublishLoading(video.jobId);
    setError("");
    setPublishFeedback((prev) => ({
      ...prev,
      [video.jobId]: { tone: "blue", message: "Отправляю видео и текст в Telegram..." },
    }));
    try {
      const res = await apiPost(`/api/admin/ai-platform/video-operator/jobs/${video.jobId}/publish/telegram`, {}, "admin");
      const link = res?.telegram?.url ? ` Ссылка: ${res.telegram.url}` : "";
      const delivery = getTelegramDeliveryMeta(res?.telegram?.deliveryMethod);
      const deliveryText = delivery ? ` Способ: ${delivery.label}.` : "";
      setPublishFeedback((prev) => ({
        ...prev,
        [video.jobId]: { tone: "green", message: `Telegram опубликован.${deliveryText}${link}` },
      }));
      await load();
      return true;
    } catch (e) {
      const message = e?.message || "Не удалось опубликовать в Telegram";
      const alreadyRunning = message.toLowerCase().includes("already running");
      if (!alreadyRunning) setError(message);
      setPublishFeedback((prev) => ({
        ...prev,
        [video.jobId]: {
          tone: alreadyRunning ? "blue" : "red",
          message: alreadyRunning ? "Telegram публикация уже выполняется. Подожди завершения текущего запуска." : message,
        },
      }));
      await load();
      return false;
    } finally {
      setPublishLoading("");
    }
  }

  async function runTelegramDuePublishing() {
    if (schedulerLoading) return;
    setSchedulerLoading(true);
    setSchedulerFeedback("");
    setError("");
    const formatResultCodes = (codes) => {
      if (!codes.length) return "";
      const shown = codes.slice(0, 5).join(", ");
      const rest = codes.length > 5 ? ` +${codes.length - 5} ещё` : "";
      return `${shown}${rest}`;
    };
    try {
      const res = await apiPost("/api/admin/ai-platform/publishing/telegram/run-due", { limit: 5, scanLimit: 100 }, "admin");
      const results = Array.isArray(res?.results) ? res.results : [];
      const publishedCodes = results.filter((item) => item?.success).map((item) => item.code || item.jobId).filter(Boolean);
      const failedCodes = results.filter((item) => !item?.success).map((item) => item.code || item.jobId).filter(Boolean);
      const publishedText = publishedCodes.length ? ` Опубликовано: ${formatResultCodes(publishedCodes)}.` : "";
      const failedText = failedCodes.length ? ` Ошибки: ${formatResultCodes(failedCodes)}.` : "";
      setSchedulerFeedback(`Проверено: ${res?.checked || 0}. Опубликовано: ${res?.published || 0}. Ошибок: ${res?.failed || 0}.${publishedText}${failedText}`);
      await load();
    } catch (e) {
      const msg = e?.message || "Не удалось запустить due Telegram";
      setError(msg);
      setSchedulerFeedback(msg);
      await load();
    } finally {
      setSchedulerLoading(false);
    }
  }

  async function copySchedulerReport() {
    const publishing = status?.publishing || {};
    const queue = publishing.telegramQueue || {};
    const run = publishing.telegramDueRun?.lastRun || null;
    const lastRunFinishedMs = new Date(run?.finishedAt || run?.startedAt || 0).getTime();
    const reportIntervalMs = Math.max(60000, Number(publishing.schedulerIntervalMs || 60000));
    const nextSchedulerCheck = publishing.schedulerEnabled && Number.isFinite(lastRunFinishedMs) && lastRunFinishedMs > 0
      ? new Date(lastRunFinishedMs + reportIntervalMs).toISOString()
      : "";
    const nextSchedulerCheckMs = new Date(nextSchedulerCheck || 0).getTime();
    const nextSchedulerCheckOverdue = publishing.schedulerEnabled
      && !publishing.telegramDueRun?.running
      && Number.isFinite(nextSchedulerCheckMs)
      && nextSchedulerCheckMs > 0
      && Date.now() > nextSchedulerCheckMs + reportIntervalMs;
    const nextQueuePlannedMs = new Date(queue.next?.plannedAt || 0).getTime();
    const nextQueueState = Number.isFinite(nextQueuePlannedMs) && nextQueuePlannedMs > 0 && nextQueuePlannedMs <= Date.now() ? "due" : "planned";
    const nextQueueAge = nextQueueState === "due" ? ` · waiting ${Math.max(0, Math.round((Date.now() - nextQueuePlannedMs) / 60000))} min` : "";
    const reportDue = Number(queue.due || 0);
    const reportBatchLimit = Number(publishing.schedulerBatchLimit || 5);
    const reportWillPublish = Math.min(reportDue, reportBatchLimit);
    const reportRemaining = Math.max(0, reportDue - reportWillPublish);
    const manualRunState = publishing.telegramDueRun?.running
      ? "blocked: running"
      : reportDue > 0
        ? `ready: ${reportDue} · will publish ${reportWillPublish}${reportRemaining ? ` · remaining ${reportRemaining}` : ""}`
        : "blocked: no due";
    const rows = [
      "Travella AI OS · Publishing Manager · Telegram scheduler",
      `Scheduler: ${publishing.schedulerEnabled ? "on" : "off"} (${publishing.schedulerReadyReason || "unknown"})`,
      `Run state: ${publishing.telegramDueRun?.running ? "running" : "idle"}`,
      `Manual run: ${manualRunState}`,
      `Batch capped: ${reportDue > reportBatchLimit ? "yes" : "no"} (${reportBatchLimit})`,
      `Queue: due ${queue.due ?? 0}, planned ${queue.planned ?? 0}`,
      queue.next ? `Next: ${queue.next.code || queue.next.jobId || "AI"} · ${nextQueueState}${nextQueueAge} · ${fmtDate(queue.next.plannedAt)}` : "Next: none",
      nextSchedulerCheck ? `Next scheduler check: ${fmtDate(nextSchedulerCheck)}${nextSchedulerCheckOverdue ? " · overdue" : ""}` : "",
      "",
      run
        ? `Last run: ${run.success ? "ok" : "error"} · ${fmtDate(run.finishedAt || run.startedAt)} · checked ${run.checked || 0}, ok ${run.published || 0}, errors ${run.failed || 0}`
        : "Last run: none",
      run?.actor ? `Actor: ${run.actor}` : "",
      run?.durationMs ? `Duration: ${Math.round(Number(run.durationMs || 0) / 1000)} sec` : "",
      ...(Array.isArray(run?.resultsPreview) && run.resultsPreview.length
        ? ["", "Results:", ...run.resultsPreview.map((item) => {
            const state = item.success ? (item.deliveryMethod || "ok") : "error";
            const message = item.message ? ` · ${item.message}` : "";
            const link = item.url ? ` · ${item.url}` : "";
            return `- ${item.code || item.jobId || "AI"}: ${state}${message}${link}`;
          })]
        : []),
      run?.resultsOverflow ? `+${run.resultsOverflow} more` : "",
    ].filter(Boolean);
    const text = rows.join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setSchedulerFeedback("Отчёт scheduler скопирован.");
  }

  function selectEmployee(employeeId) {
    setSelectedEmployee(employeeId);
    if (employeeId === "content_manager") {
      setActiveView("publications");
      setCurrentTask(null);
      return;
    }
    if (employeeId === "publishing_manager") {
      setActiveView("publishing_queue");
      setCurrentTask(null);
      return;
    }
    if (activeView === "publications" || activeView === "publishing_queue") setActiveView("today");
  }

  const employeesCount = status?.employees?.length || 1;
  const activeTasks = jobs.filter((j) => ["created", "queued", "running", "processing"].includes(String(j.status || "").toLowerCase())).length;
  const videosToday = jobs.filter((j) => isToday(j.createdAt) && String(j.type || "").includes("video")).length;
  const readyVideos = videos.length;
  const heygenReady = Boolean(status?.video?.heygenReady);
  const aiEnabled = Boolean(status?.video?.enabled);
  const artifactStorageReady = Boolean(status?.video?.artifactStorage?.provider);
  const runtimeProfile = status?.video?.runtimeProfile || {};
  const selectedAvatarPreset = HEYGEN_AVATAR_PRESETS.find((avatar) => avatar.value === videoProfileDraft.avatarId);
  const selectedVoicePreset = HEYGEN_VOICE_PRESETS.find((voice) => voice.value === videoProfileDraft.voiceId);
  const profileDirty =
    String(videoProfileDraft.avatarId || "") !== String(runtimeProfile.avatarId || "") ||
    String(videoProfileDraft.voiceId || "") !== String(runtimeProfile.voiceId || "");
  const isContentManager = selectedEmployee === "content_manager";
  const isPublishingManager = selectedEmployee === "publishing_manager";
  const isPublishingWork = isContentManager || isPublishingManager;
  const approvedVideosCount = getApprovedVideos(videos).length;
  const currentVideoContext = currentTask?.output?.service?.videoContext || currentTask?.output?.service || currentTask?.input || {};
  const currentServiceCode = selectedService?.taskCode || selectedService?.displayCode || currentTask?.output?.route?.serviceCode || currentVideoContext?.code || "";
  const serviceSearchTypes = [
    { id: "all", label: "Все" },
    { id: "tour", label: "Туры" },
    { id: "flight", label: "Авиа" },
    { id: "hotel", label: "Отели" },
    { id: "event", label: "События" },
  ];
  const quickVideoCommands = [
    { label: "Сценарий последнего", command: serviceSearchType === "all" ? "Создай сценарий для последнего отказного предложения" : `Создай сценарий для последнего отказного ${serviceSearchType === "flight" ? "авиабилета" : serviceSearchType === "hotel" ? "отеля" : serviceSearchType === "event" ? "билета на мероприятие" : "тура"}` },
    { label: "Видео последнего", command: serviceSearchType === "all" ? "Создай видео для последнего отказного предложения" : `Создай видео для последнего отказного ${serviceSearchType === "flight" ? "авиабилета" : serviceSearchType === "hotel" ? "отеля" : serviceSearchType === "event" ? "билета на мероприятие" : "тура"}` },
    ...(currentServiceCode ? [
      { label: "Сценарий выбранного", command: `Создай сценарий для ${currentServiceCode}` },
      { label: "Видео выбранного", command: `Создай видео для ${currentServiceCode}` },
      { label: "Другой hook", command: `Переделай hook для ${currentServiceCode}` },
      { label: "Агрессивнее", command: `Сделай сценарий агрессивнее для ${currentServiceCode}` },
      { label: "Короче", command: `Сократи сценарий до 25 секунд для ${currentServiceCode}` },
    ] : []),
  ];

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <section className="rounded-[2rem] border border-slate-200 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 p-6 text-white shadow-sm md:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-white/80 ring-1 ring-white/15">Travella AI Operating System</div>
            <h1 className="mt-4 text-4xl font-black tracking-tight md:text-5xl">🤖 Travella AI OS</h1>
            <p className="mt-3 max-w-4xl text-sm font-semibold leading-7 text-slate-200 md:text-base">Единое рабочее место цифровых сотрудников: команда обычным языком → AI Runtime → tool calls → реальные данные Travella → результат.</p>
          </div>
          <button type="button" onClick={load} disabled={loading} className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 hover:bg-slate-100 disabled:opacity-60">Обновить</button>
        </div>
      </section>

      {error ? <div className="mt-4 rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div> : null}

      <section className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="Digital Employees" value={`${employeesCount} / 8`} helper="Video Operator live" />
        <Metric label="Active Tasks" value={activeTasks} helper="Задачи в работе" />
        <Metric label="Videos Today" value={videosToday} helper="Создано или запущено сегодня" />
        <Metric label="AI Health" value={aiEnabled && heygenReady ? "Online" : aiEnabled ? "Needs ENV" : "Disabled"} helper={artifactStorageReady ? `Media: ${status.video.artifactStorage.provider}` : heygenReady ? "HeyGen готов, Media ENV нет" : "Проверь Railway ENV"} />
      </section>

      <section className="mt-5"><EmployeeTabs selected={selectedEmployee} onSelect={selectEmployee} /></section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[280px_1fr_360px]">
        <aside className="space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-black uppercase tracking-wide text-slate-500">Workspace</div>
            <div className="mt-4 space-y-2 text-sm font-black text-slate-700">
              {!isPublishingWork ? (
                <button
                  type="button"
                  onClick={() => setActiveView("today")}
                  className={cn("w-full rounded-2xl px-4 py-3 text-left", activeView === "today" ? "bg-slate-950 text-white" : "hover:bg-slate-50")}
                >
                  Сегодня
                </button>
              ) : null}
              {!isPublishingManager ? <button className="w-full rounded-2xl px-4 py-3 text-left hover:bg-slate-50">Черновики</button> : null}
              <button
                type="button"
                onClick={() => setActiveView(isPublishingManager ? "publishing_queue" : isContentManager ? "publications" : "videos")}
                className={cn("flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left", (activeView === "videos" || activeView === "publications" || activeView === "publishing_queue") ? "bg-slate-950 text-white" : "hover:bg-slate-50")}
              >
                <span>{isPublishingManager ? "Очередь" : isContentManager ? "Публикации" : "Видео"}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-xs", (activeView === "videos" || activeView === "publications" || activeView === "publishing_queue") ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500")}>{isPublishingManager ? approvedVideosCount : readyVideos}</span>
              </button>
              <button className="w-full rounded-2xl px-4 py-3 text-left hover:bg-slate-50">Избранное</button>
            </div>
          </div>
          {isPublishingWork ? <PublishingSummary videos={videos} /> : <JobList jobs={jobs} activeJobId={currentTask?.id} onOpenJob={openJob} />}
        </aside>

        {activeView === "publishing_queue" ? (
          <PublishingManagerBoard
            videos={videos}
            onSavePublicationStatus={savePublicationStatus}
            onPublishTelegram={publishTelegram}
            packageLoading={packageLoading}
            publishLoading={publishLoading}
            publishFeedback={publishFeedback}
            telegramReady={Boolean(status?.publishing?.telegramReady)}
          />
        ) : activeView === "videos" || activeView === "publications" ? (
          <VideoLibrary
            videos={videos}
            jobs={jobs}
            onOpenJob={openJob}
            onSavePackage={savePublishingPackage}
            onApprovePackage={approvePublishingPackage}
            onSavePublicationStatus={savePublicationStatus}
            packageLoading={packageLoading}
            mode={isContentManager ? "publishing" : "media"}
          />
        ) : (
        <main className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-xs font-black uppercase tracking-wide text-slate-500">Marketing Department</div>
                <h2 className="mt-1 text-2xl font-black text-slate-950">🎬 Video Operator</h2>
                <p className="mt-1 text-sm font-semibold text-slate-500">Рабочий чат. Никаких форм: сотрудник сам определяет задачу, вызывает tools и показывает ход работы.</p>
              </div>
              <div className="flex max-w-full flex-wrap items-center justify-start gap-2 md:justify-end">
                <Pill tone="green">live</Pill>
                <Pill tone="black">AI Runtime</Pill>
                <Pill tone={aiEnabled ? "green" : "red"}>{aiEnabled ? "AI Video включено" : "AI Video выключено"}</Pill>
                <button
                  type="button"
                  role="switch"
                  aria-checked={aiEnabled}
                  onClick={toggleAiVideo}
                  disabled={videoToggleLoading}
                  className={cn(
                    "inline-flex min-h-[34px] items-center gap-2 rounded-full px-2 py-1 text-xs font-black ring-1 transition disabled:cursor-not-allowed disabled:opacity-50",
                    aiEnabled ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
                  )}
                  title={heygenReady ? "Включает или выключает отправку сценариев в HeyGen" : "HeyGen ENV ещё не настроен"}
                >
                  <span className={cn("relative h-6 w-11 rounded-full transition", aiEnabled ? "bg-emerald-600" : "bg-slate-300")}>
                    <span className={cn("absolute top-1 h-4 w-4 rounded-full bg-white shadow transition", aiEnabled ? "left-6" : "left-1")} />
                  </span>
                  <span>{videoToggleLoading ? "Сохраняю..." : aiEnabled ? "HeyGen on" : "HeyGen off"}</span>
                </button>
                <div className="flex max-w-full flex-wrap items-center gap-2 rounded-2xl bg-slate-50 px-2 py-2 ring-1 ring-slate-200">
                  <select
                    value={selectedAvatarPreset?.value || "__custom"}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value !== "__custom") setVideoProfileDraft((prev) => ({ ...prev, avatarId: value }));
                    }}
                    className="h-8 w-[116px] rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-950 outline-none focus:border-slate-300"
                  >
                    {HEYGEN_AVATAR_PRESETS.map((avatar) => (
                      <option key={avatar.value} value={avatar.value}>Avatar {avatar.label}</option>
                    ))}
                    <option value="__custom">Другой avatar</option>
                  </select>
                  {!selectedAvatarPreset ? (
                    <input
                      value={videoProfileDraft.avatarId}
                      onChange={(e) => setVideoProfileDraft((prev) => ({ ...prev, avatarId: e.target.value }))}
                      placeholder="Avatar ID"
                      className="h-8 w-[190px] rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-950 outline-none placeholder:text-slate-400 focus:border-slate-300"
                    />
                  ) : null}
                  <select
                    value={selectedVoicePreset?.value || "__custom"}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value !== "__custom") setVideoProfileDraft((prev) => ({ ...prev, voiceId: value }));
                    }}
                    className="h-8 w-[116px] rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-950 outline-none focus:border-slate-300"
                  >
                    {HEYGEN_VOICE_PRESETS.map((voice) => (
                      <option key={voice.value} value={voice.value}>{voice.label}</option>
                    ))}
                    <option value="__custom">Другой</option>
                  </select>
                  {!selectedVoicePreset ? (
                    <input
                      value={videoProfileDraft.voiceId}
                      onChange={(e) => setVideoProfileDraft((prev) => ({ ...prev, voiceId: e.target.value }))}
                      placeholder="Voice ID"
                      className="h-8 w-[190px] rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-950 outline-none placeholder:text-slate-400 focus:border-slate-300"
                    />
                  ) : null}
                  <button
                    type="button"
                    onClick={saveVideoProfile}
                    disabled={videoProfileLoading || !profileDirty}
                    className="h-8 rounded-xl bg-slate-950 px-3 text-xs font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                  >
                    {videoProfileLoading ? "..." : "Сохранить"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="h-[640px] space-y-4 overflow-y-auto bg-slate-50/60 p-4 md:p-6">
            {messages.map((m) => (
              <Message
                key={m.id}
                msg={m}
                onStartHeygen={startHeygen}
                onRefreshHeygen={refreshHeygen}
                canStartHeygen={aiEnabled && heygenReady}
                aiVideoEnabled={aiEnabled}
                heygenReady={heygenReady}
                heygenLoading={heygenLoading}
                refreshLoading={refreshLoading}
              />
            ))}
            {loading ? <Message msg={{ role: "assistant", text: "🧠 Думаю...\n⚙️ Вызываю нужные инструменты Travella AI Runtime..." }} /> : null}
            <div ref={endRef} />
          </div>

          <div className="border-t border-slate-100 p-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
              {selectedEmployee === "video_operator" ? (
                <div className="mb-3 space-y-3">
                  <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                      <div className="flex flex-wrap gap-1.5">
                        {serviceSearchTypes.map((type) => (
                          <button
                            key={type.id}
                            type="button"
                            onClick={() => setServiceSearchType(type.id)}
                            className={cn(
                              "rounded-full px-3 py-1.5 text-xs font-black ring-1",
                              serviceSearchType === type.id ? "bg-slate-950 text-white ring-slate-950" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-100"
                            )}
                          >
                            {type.label}
                          </button>
                        ))}
                      </div>
                      <input
                        value={serviceSearchQuery}
                        onChange={(e) => setServiceSearchQuery(e.target.value)}
                        placeholder="Найти отказ: Анталья, отель, авиабилет, H502..."
                        className="min-h-[38px] flex-1 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-950 outline-none placeholder:text-slate-400 focus:border-slate-300"
                      />
                    </div>
                    {selectedService ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-2xl bg-white px-3 py-2 text-xs font-bold text-slate-600 ring-1 ring-emerald-100">
                        <span className="rounded-full bg-emerald-50 px-2 py-1 font-black text-emerald-700">Выбрано</span>
                        <b className="text-slate-950">{selectedService.displayCode || selectedService.taskCode}</b>
                        <span>{selectedService.categoryLabel}</span>
                        <span className="text-slate-400">·</span>
                        <span className="max-w-[520px] truncate">{selectedService.title || selectedService.destination}</span>
                        <button type="button" onClick={() => setSelectedService(null)} className="ml-auto rounded-full px-2 py-1 text-slate-400 hover:bg-slate-50 hover:text-slate-700">Снять</button>
                      </div>
                    ) : null}
                    <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {serviceSearchResults.slice(0, 6).map((service) => {
                        const price = service.price ? `${service.price} ${service.currency || "USD"}` : "";
                        const active = selectedService?.id === service.id && selectedService?.taskCode === service.taskCode;
                        return (
                          <button
                            key={`${service.taskCode}_${service.id}`}
                            type="button"
                            onClick={() => setSelectedService(service)}
                            className={cn(
                              "min-h-[74px] rounded-2xl px-3 py-2 text-left ring-1 transition",
                              active ? "bg-emerald-50 ring-emerald-200" : "bg-white ring-slate-100 hover:bg-slate-50"
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="rounded-full bg-slate-950 px-2 py-0.5 text-[11px] font-black text-white">{service.displayCode || service.taskCode}</span>
                              <span className="truncate text-[11px] font-black text-slate-400">{service.categoryLabel}</span>
                            </div>
                            <div className="mt-1 truncate text-sm font-black text-slate-950">{service.title || service.destination || "Отказное предложение"}</div>
                            <div className="mt-1 truncate text-xs font-bold text-slate-500">{[service.dates, price, service.supplier].filter(Boolean).join(" · ")}</div>
                          </button>
                        );
                      })}
                    </div>
                    {!serviceSearchLoading && !serviceSearchResults.length ? (
                      <div className="mt-2 rounded-2xl bg-white px-3 py-2 text-xs font-bold text-slate-400 ring-1 ring-slate-100">Ничего не найдено. Попробуй другой тип или запрос.</div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {quickVideoCommands.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => runTaskText(item.command)}
                        disabled={loading}
                        className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-black text-slate-700 hover:border-slate-300 hover:bg-white disabled:opacity-40"
                        title={item.command}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <textarea
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runTask(); } }}
                placeholder={currentServiceCode ? `Напиши: Создай видео для ${currentServiceCode}, переделай hook, сделай агрессивнее...` : "Напиши: R857, H502, A1284, последний отказной авиабилет..."}
                className="min-h-[78px] w-full resize-none rounded-2xl border-0 px-3 py-2 text-sm font-semibold text-slate-950 outline-none placeholder:text-slate-400"
              />
              <div className="flex flex-col gap-3 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs font-bold text-slate-400">Enter — выполнить, Shift+Enter — новая строка. Можно писать: сценарий, видео, последний тур, авиабилет, отель или мероприятие.</div>
                <button type="button" onClick={runTask} disabled={loading || !command.trim()} className="rounded-2xl bg-slate-950 px-6 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-40">▶ Выполнить</button>
              </div>
            </div>
          </div>
        </main>
        )}

        {isPublishingManager ? (
          <PublishingInspector
            videos={videos}
            publishingStatus={status?.publishing}
            onRunTelegramDue={runTelegramDuePublishing}
            onCopySchedulerReport={copySchedulerReport}
            schedulerLoading={schedulerLoading}
            schedulerFeedback={schedulerFeedback}
          />
        ) : isContentManager ? <ContentInspector videos={videos} /> : <Inspector task={currentTask} />}
      </section>
    </div>
  );
}
