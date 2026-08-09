// frontend/src/pages/admin/AdminAiPlatform.jsx

import React from "react";
import { apiGet, apiPatch, apiPost, apiPostForm } from "../../api";

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

const HEYGEN_ASPECT_RATIO_OPTIONS = [
  { value: "9:16", label: "9:16", helper: "Reels / Stories" },
  { value: "1:1", label: "1:1", helper: "квадрат" },
  { value: "16:9", label: "16:9", helper: "горизонталь" },
];

const HEYGEN_RESOLUTION_OPTIONS = [
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
  { value: "2k", label: "2K" },
  { value: "4k", label: "4K" },
];

const HEYGEN_DELIVERY_PRESETS = [
  {
    id: "reels",
    label: "Reels / Stories",
    helper: "вертикальный mobile",
    profile: { aspectRatio: "9:16", resolution: "1080p", engine: "avatar_iv", voiceSpeed: 1, expressiveness: "medium" },
  },
  {
    id: "telegram",
    label: "Telegram",
    helper: "канал и бот",
    profile: { aspectRatio: "9:16", resolution: "1080p", engine: "avatar_iv", voiceSpeed: 1, expressiveness: "medium" },
  },
  {
    id: "youtube",
    label: "YouTube",
    helper: "горизонтальный выпуск",
    profile: { aspectRatio: "16:9", resolution: "1080p", engine: "avatar_iv", voiceSpeed: 1, expressiveness: "medium" },
  },
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

function findPresetLabel(presets = [], value = "", prefix = "") {
  const preset = (Array.isArray(presets) ? presets : []).find((item) => item.value === value);
  if (!preset?.label) return value ? "Свой" : "—";
  return prefix ? `${prefix} ${preset.label}` : preset.label;
}

function formatHeygenExpressiveness(value = "") {
  return ({
    low: "Низкая",
    medium: "Средняя",
    high: "Высокая",
  }[String(value || "").toLowerCase()] || value || "—");
}

function formatTimelineMediaType(type = "") {
  return ({
    image: "картинка",
    audio: "аудио",
    video: "видео",
    file: "файл",
    media: "медиа",
  }[String(type || "").toLowerCase()] || type || "медиа");
}

function estimateHeygenDurationStats(script = "", speed = 1) {
  const words = String(script || "").trim().split(/\s+/).filter(Boolean).length;
  if (!words) return { words: 0, seconds: 0, label: "—" };
  const normalizedSpeed = Math.max(0.5, Math.min(1.5, Number(speed || 1)));
  const seconds = Math.max(5, Math.round(words / (2.5 * normalizedSpeed)));
  if (seconds < 60) return { words, seconds, label: `~${seconds} сек` };
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return { words, seconds, label: `~${minutes}:${String(rest).padStart(2, "0")}` };
}

function estimateHeygenDuration(script = "", speed = 1) {
  const stats = estimateHeygenDurationStats(script, speed);
  if (typeof stats === "string") return stats;
  return stats.label;
}

function getHeygenFormatGuard(profile = {}, script = "") {
  const ratio = profile.aspectRatio || "9:16";
  const stats = estimateHeygenDurationStats(script, profile.voiceSpeed || 1);
  if (!stats.seconds) return { tone: "slate", label: "Нет текста для оценки" };
  if (ratio === "9:16") {
    if (stats.seconds > 35) return { tone: "yellow", label: "Для Reels/Stories длинновато. Лучше 20-35 сек." };
    if (stats.seconds < 15) return { tone: "blue", label: "Очень короткий vertical pitch. Можно усилить оффер." };
    return { tone: "green", label: "Длина подходит для Reels/Stories." };
  }
  if (ratio === "16:9") {
    if (stats.seconds > 90) return { tone: "yellow", label: "Для 16:9 уже длинно. Проверь темп и удержание." };
    return { tone: "green", label: "Длина подходит для горизонтального выпуска." };
  }
  if (stats.seconds > 60) return { tone: "yellow", label: "Для 1:1 лучше держать ролик короче минуты." };
  return { tone: "green", label: "Длина подходит для квадратного формата." };
}

function HeygenGenerationPreview({ profile = {}, presets = {}, script = "", locked = false, dirty = false }) {
  const avatarLabel = findPresetLabel(presets.avatars, profile.avatarId, "Аватар");
  const voiceLabel = findPresetLabel(presets.voices, profile.voiceId, "Голос");
  const engineLabel = profile.engine === "avatar_v" ? "Avatar V" : "Avatar IV";
  const ratio = profile.aspectRatio || "9:16";
  const resolution = profile.resolution || "1080p";
  const duration = estimateHeygenDurationStats(script, profile.voiceSpeed || 1);
  const guard = getHeygenFormatGuard(profile, script);
  const guardClass = {
    green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    yellow: "bg-amber-50 text-amber-800 ring-amber-100",
    blue: "bg-blue-50 text-blue-700 ring-blue-100",
    slate: "bg-slate-50 text-slate-500 ring-slate-100",
  }[guard.tone] || "bg-slate-50 text-slate-500 ring-slate-100";
  return (
    <div className={cn("mt-3 rounded-2xl p-4 ring-1", dirty ? "bg-amber-50 ring-amber-100" : locked ? "bg-emerald-50 ring-emerald-100" : "bg-blue-50 ring-blue-100")}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className={cn("text-xs font-black uppercase tracking-wide", dirty ? "text-amber-700" : locked ? "text-emerald-700" : "text-blue-700")}>
            {locked ? "Профиль HeyGen в видео" : "Превью перед HeyGen"}
          </div>
          <div className="mt-1 text-sm font-black text-slate-950">{ratio} · {resolution} · {engineLabel}</div>
        </div>
        <div className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-700 ring-1 ring-slate-200">
          {duration.label}
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {[
          ["Аватар", avatarLabel],
          ["Голос", voiceLabel],
          ["Скорость", Number(profile.voiceSpeed || 1).toFixed(2)],
          ["Экспрессия", profile.engine === "avatar_v" ? "—" : formatHeygenExpressiveness(profile.expressiveness || "medium")],
          ["Формат", ratio],
          ["Разрешение", resolution],
          ["Слова", duration.words || "—"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-white px-3 py-2 ring-1 ring-slate-200">
            <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</div>
            <div className="mt-0.5 truncate text-xs font-black text-slate-950" title={String(value)}>{value}</div>
          </div>
        ))}
      </div>
      <div className={cn("mt-3 rounded-2xl px-3 py-2 text-xs font-black ring-1", guardClass)}>{guard.label}</div>
      {dirty ? <div className="mt-3 text-xs font-black text-amber-800">Настройки HeyGen изменены. Сначала сохрани профиль, чтобы именно эти значения ушли в генерацию.</div> : null}
    </div>
  );
}

function getHeygenVersions(output = {}) {
  const attempts = Array.isArray(output.heygenAttempts) ? output.heygenAttempts : [];
  const current = output.heygen ? [{ ...output.heygen, active: true }] : [];
  return attempts
    .map((item) => ({ ...item, active: false }))
    .concat(current)
    .map((item, index) => ({ ...item, version: Number(item.version || index + 1) }))
    .sort((a, b) => Number(a.version || 0) - Number(b.version || 0));
}

const SOUND_EFFECT_PRESETS = [
  { assetId: "soft_whoosh_01", label: "Soft whoosh", volume: 0.22, note: "Мягкий открывающий переход.", tone: { frequency: 720, duration: 0.18, type: "sine" } },
  { assetId: "urgency_whoosh_01", label: "Urgency whoosh", volume: 0.2, note: "Акцент срочности отказного предложения.", tone: { frequency: 520, duration: 0.28, type: "sawtooth" } },
  { assetId: "soft_price_impact_01", label: "Soft price impact", volume: 0.24, note: "Акцент цены без игрового звучания.", tone: { frequency: 150, duration: 0.28, type: "triangle" } },
  { assetId: "luxury_sparkle_01", label: "Luxury sparkle", volume: 0.18, note: "Премиальный акцент на отель/отдых.", tone: { frequency: 1320, duration: 0.38, type: "sine" } },
  { assetId: "notification_click_01", label: "Notification click", volume: 0.2, note: "Финальный CTA.", tone: { frequency: 980, duration: 0.1, type: "square" } },
  { assetId: "cash_tick_01", label: "Cash tick", volume: 0.2, note: "Короткий акцент оплаты или цены.", tone: { frequency: 1180, duration: 0.12, type: "triangle" } },
  { assetId: "deal_pop_01", label: "Deal pop", volume: 0.2, note: "Лёгкий акцент на выгоде.", tone: { frequency: 860, duration: 0.16, type: "square" } },
  { assetId: "countdown_riser_01", label: "Countdown riser", volume: 0.18, note: "Нарастание перед срочным CTA.", tone: { frequency: 410, duration: 0.42, type: "sawtooth" } },
];

function getSoundPreset(assetId = "") {
  return SOUND_EFFECT_PRESETS.find((item) => item.assetId === assetId) || SOUND_EFFECT_PRESETS[0];
}

function createSoundCue(index = 0, preset = SOUND_EFFECT_PRESETS[0]) {
  return {
    id: `manual_sfx_${Date.now()}_${index}`,
    assetId: preset.assetId,
    label: preset.label,
    time: 0,
    duration: preset.tone?.duration || 0.3,
    volume: preset.volume,
    enabled: true,
    note: preset.note,
  };
}

function getSfxTone(assetId = "") {
  const preset = getSoundPreset(assetId);
  if (preset?.tone) return preset.tone;
  const id = String(assetId || "").toLowerCase();
  if (id.includes("sparkle") || id.includes("chime")) return { frequency: 1320, duration: 0.34, type: "sine" };
  if (id.includes("impact") || id.includes("price")) return { frequency: 150, duration: 0.26, type: "triangle" };
  if (id.includes("click") || id.includes("tap")) return { frequency: 980, duration: 0.08, type: "square" };
  if (id.includes("urgency")) return { frequency: 520, duration: 0.24, type: "sawtooth" };
  return { frequency: 720, duration: 0.18, type: "sine" };
}

function playSfxPreview(effect = {}, delaySeconds = 0) {
  if (typeof window === "undefined") return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  const ctx = new AudioContextClass();
  const tone = getSfxTone(effect.assetId);
  const gain = ctx.createGain();
  const osc = ctx.createOscillator();
  const startAt = ctx.currentTime + Math.max(0, Number(delaySeconds) || 0);
  const volume = Math.max(0.01, Math.min(0.7, Number(effect.volume ?? 0.2) * 1.8));
  osc.type = tone.type;
  osc.frequency.setValueAtTime(tone.frequency, startAt);
  gain.gain.setValueAtTime(0.001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + tone.duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + tone.duration + 0.05);
  setTimeout(() => ctx.close().catch(() => {}), (delaySeconds + tone.duration + 0.4) * 1000);
}

function SoundPlanEditor({ job, soundPlan, onSave, onRender, onImportMedia, loading, renderLoading, mediaImportLoading }) {
  const [draft, setDraft] = React.useState(soundPlan || null);
  const [soloIndex, setSoloIndex] = React.useState(null);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [selectedClip, setSelectedClip] = React.useState({ type: "sfx", index: 0 });
  const [selectedClipKeys, setSelectedClipKeys] = React.useState(["sfx:0"]);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [isPreviewPlaying, setIsPreviewPlaying] = React.useState(false);
  const [editingTextIndex, setEditingTextIndex] = React.useState(null);
  const [historyTick, setHistoryTick] = React.useState(0);
  const [timelineZoom, setTimelineZoom] = React.useState(1);
  const [snapGuideTime, setSnapGuideTime] = React.useState(null);
  const [timelineClipboard, setTimelineClipboard] = React.useState([]);
  const [previewMediaKey, setPreviewMediaKey] = React.useState("");
  const [mediaDragActive, setMediaDragActive] = React.useState(false);
  const [draggedAssetType, setDraggedAssetType] = React.useState("");
  const [assetBinFilter, setAssetBinFilter] = React.useState("all");
  const [assetBinQuery, setAssetBinQuery] = React.useState("");
  const [assetBinSort, setAssetBinSort] = React.useState("recent");
  const [selectedMediaKey, setSelectedMediaKey] = React.useState("");
  const [mediaToolbarNotice, setMediaToolbarNotice] = React.useState("");
  const timelineRef = React.useRef(null);
  const previewFrameRef = React.useRef(null);
  const previewVideoRef = React.useRef(null);
  const playbackTimersRef = React.useRef([]);
  const playbackAudiosRef = React.useRef([]);
  const mediaInputRef = React.useRef(null);
  const historyRef = React.useRef({ past: [], future: [], last: "", skip: false });
  const clonePlan = (value) => JSON.parse(JSON.stringify(value || null));
  React.useEffect(() => {
    const nextDraft = soundPlan || null;
    historyRef.current = { past: [], future: [], last: JSON.stringify(nextDraft || null), skip: false };
    setDraft(nextDraft);
    setHistoryTick((tick) => tick + 1);
  }, [soundPlan, job?.id]);
  React.useEffect(() => {
    setMediaToolbarNotice("");
  }, [selectedMediaKey]);
  React.useEffect(() => {
    const serial = JSON.stringify(draft || null);
    const history = historyRef.current;
    if (history.skip) {
      history.last = serial;
      history.skip = false;
      setHistoryTick((tick) => tick + 1);
      return;
    }
    if (!history.last) {
      history.last = serial;
      return;
    }
    if (serial === history.last) return;
    history.past = [...history.past.slice(-39), JSON.parse(history.last)];
    history.future = [];
    history.last = serial;
    setHistoryTick((tick) => tick + 1);
  }, [draft]);
  const plan = draft || null;
  const busy = loading === job?.id;
  const rendering = renderLoading === job?.id || plan?.render?.status === "rendering";
  const renderedUrl = plan?.render?.artifact?.url || "";
  const previewUrl = renderedUrl || plan?.render?.sourceUrl || job?.output?.soundEnhancedVideo?.url || job?.output?.heygen?.artifact?.url || job?.output?.heygen?.videoUrl || "";
  const effects = Array.isArray(plan?.effects) ? plan.effects : [];
  const duration = Math.max(8, Number(plan?.durationEstimateSeconds || 35));
  const trim = plan?.edit?.trim || {};
  const enabledEffects = effects.filter((effect) => effect.enabled !== false);
  const textOverlays = Array.isArray(plan?.textOverlays) ? plan.textOverlays : [];
  const imageOverlays = Array.isArray(plan?.imageOverlays) ? plan.imageOverlays : [];
  const videoClips = Array.isArray(plan?.videoClips) ? plan.videoClips : [];
  const mediaLibrary = Array.isArray(plan?.mediaLibrary) ? plan.mediaLibrary : [];
  const getMediaIdentity = (media) => media?.id || media?.url || "";
  const assetBinSearch = assetBinQuery.trim().toLowerCase();
  const getMediaSortLabel = (media) => String(media?.label || media?.originalName || media?.url || "Медиа");
  const selectedMedia = mediaLibrary.find((media) => getMediaIdentity(media) === selectedMediaKey) || null;
  const getMediaTimelineUsage = (media) => {
    if (!media?.url) return [];
    const usage = [];
    if (videoClips.some((item) => item?.url === media.url)) usage.push("Видео");
    if (effects.some((item) => item?.url === media.url)) usage.push("SFX");
    if (imageOverlays.some((item) => item?.url === media.url)) usage.push("Картинки");
    if (plan?.music?.url === media.url) usage.push("Музыка");
    return usage;
  };
  const mediaLibraryUsedCount = mediaLibrary.filter((media) => getMediaTimelineUsage(media).length > 0).length;
  const getMediaDropTargetLabel = (media) => {
    if (media?.type === "image") return "Дорожка картинок";
    if (media?.type === "video") return "Дорожка видео";
    if (media?.type === "audio") return "SFX или музыка";
    return "Timeline";
  };
  const selectedMediaUsage = selectedMedia ? getMediaTimelineUsage(selectedMedia) : [];
  const selectedMediaDropTarget = selectedMedia ? getMediaDropTargetLabel(selectedMedia) : "";
  const showMediaToolbarNotice = (message) => {
    setMediaToolbarNotice(message);
    window.setTimeout(() => setMediaToolbarNotice(""), 1600);
  };
  const copySelectedMediaUrl = async () => {
    if (!selectedMedia?.url) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(selectedMedia.url);
      showMediaToolbarNotice("URL скопирован");
    } catch {
      showMediaToolbarNotice("Не удалось скопировать");
    }
  };
  const getMediaDefaultDuration = (media) => {
    if (media?.type === "video") return Math.min(12, Math.max(1, Number(media.durationSeconds || 5)));
    if (media?.type === "image") return 4;
    return Math.min(8, Math.max(0.3, Number(media?.durationSeconds || 2)));
  };
  const selectedMediaEndTime = selectedMedia ? Math.max(0, duration - getMediaDefaultDuration(selectedMedia)) : 0;
  const filteredMediaLibrary = mediaLibrary
    .map((media, index) => ({ media, index }))
    .filter(({ media }) => assetBinFilter === "all" || media.type === assetBinFilter)
    .filter(({ media }) => {
      if (!assetBinSearch) return true;
      return [media.label, media.originalName, media.mimeType, media.type].filter(Boolean).join(" ").toLowerCase().includes(assetBinSearch);
    })
    .sort((left, right) => {
      if (assetBinSort === "name") return getMediaSortLabel(left.media).localeCompare(getMediaSortLabel(right.media), "ru");
      if (assetBinSort === "type") {
        return String(left.media?.type || "").localeCompare(String(right.media?.type || ""), "ru")
          || getMediaSortLabel(left.media).localeCompare(getMediaSortLabel(right.media), "ru");
      }
      return right.index - left.index;
    })
    .map(({ media }) => media);
  const mediaImporting = mediaImportLoading === job?.id;
  const selectedEffect = effects[selectedIndex] || effects[0] || null;
  const selectedItem =
    selectedClip.type === "text"
      ? textOverlays[selectedClip.index]
      : selectedClip.type === "image"
        ? imageOverlays[selectedClip.index]
        : selectedClip.type === "video"
          ? videoClips[selectedClip.index]
          : effects[selectedClip.index] || selectedEffect;
  const playheadLeft = Math.max(0, Math.min(100, (currentTime / duration) * 100));
  const timelineMinWidth = Math.round(620 * timelineZoom);
  const setTimelineZoomPreset = (value) => setTimelineZoom(Math.max(1, Math.min(3, Number(value) || 1)));
  const selectedClipLabel = selectedClip.type === "sfx" ? "SFX" : selectedClip.type === "text" ? "Текст" : selectedClip.type === "image" ? "Картинка" : "Видео";
  const selectedClipFallbackDuration = selectedClip.type === "video" ? 5 : selectedClip.type === "image" ? 4 : selectedClip.type === "text" ? 3 : 0.3;
  const selectedClipDuration = Number(selectedItem?.duration || selectedClipFallbackDuration);
  const selectedClipStart = Number(selectedItem?.time || 0);
  const selectedClipEnd = Math.round((selectedClipStart + selectedClipDuration) * 10) / 10;
  const selectedClipAlreadyEndsAtTimelineEnd = selectedClipEnd >= Math.round(duration * 10) / 10;
  const selectedClipRemainingToTimelineEnd = Math.max(0, Math.round((duration - selectedClipEnd) * 10) / 10);
  const selectedClipName = selectedClipKeys.length > 1
    ? `${selectedClipKeys.length} клип.`
    : selectedItem?.label || selectedItem?.text || selectedItem?.assetId || selectedClipLabel;
  const selectedClipRangeLabel = `${Math.round(selectedClipStart * 10) / 10}s-${selectedClipEnd}s`;
  const roundTimelineTime = (value) => Math.round(Number(value || 0) * 10) / 10;
  const snapGuideLeft = snapGuideTime === null ? null : Math.max(0, Math.min(100, (snapGuideTime / duration) * 100));
  const clampTimelineTime = (value, min = 0, max = duration) => Math.max(min, Math.min(max, roundTimelineTime(value)));
  const getVideoSourceRemaining = (item) => {
    const sourceDuration = Number(item?.sourceDuration || 0);
    if (sourceDuration <= 0) return Infinity;
    return Math.max(0.1, roundTimelineTime(sourceDuration - Number(item?.sourceStart || 0)));
  };
  const clampClipDuration = (value, start = selectedClipStart, item = selectedItem) => {
    const timelineLimit = Math.max(0.1, duration - start);
    const sourceLimit = selectedClip.type === "video" ? getVideoSourceRemaining(item) : Infinity;
    return Math.max(0.1, Math.min(timelineLimit, sourceLimit, roundTimelineTime(value)));
  };
  const selectedClipMaxDuration = Math.max(0.1, Math.min(Math.max(0.1, duration - selectedClipStart), selectedClip.type === "video" ? getVideoSourceRemaining(selectedItem) : Infinity));
  const selectedClipMaxEnd = roundTimelineTime(selectedClipStart + selectedClipMaxDuration);
  const getClipKey = (type, index) => `${type}:${index}`;
  const isClipMultiSelected = (type, index) => selectedClipKeys.includes(getClipKey(type, index));
  const getClipDurationForType = (type, item) => Number(item?.duration || (type === "video" ? 5 : type === "image" ? 4 : type === "text" ? 3 : getSoundPreset(item?.assetId).tone?.duration || 0.3));
  const clampClipStartForType = (type, item, value) => {
    const clipDuration = Math.max(0.1, getClipDurationForType(type, item));
    return Math.max(0, Math.min(Math.max(0, duration - clipDuration), roundTimelineTime(value)));
  };
  const getTimelineSnapPoints = (excludeKeys = []) => {
    const exclude = new Set(excludeKeys);
    const points = [0, duration, currentTime];
    const collect = (items, type) => (Array.isArray(items) ? items : []).forEach((item, index) => {
      if (!item || exclude.has(getClipKey(type, index))) return;
      const start = Number(item.time || 0);
      const end = start + getClipDurationForType(type, item);
      points.push(roundTimelineTime(start), roundTimelineTime(end));
    });
    collect(effects, "sfx");
    collect(textOverlays, "text");
    collect(imageOverlays, "image");
    collect(videoClips, "video");
    return points;
  };
  const snapTimelineTime = (value, excludeKeys = [], threshold = 0.25, options = {}) => {
    const rounded = roundTimelineTime(value);
    const nearest = getTimelineSnapPoints(excludeKeys).reduce((best, point) => {
      const distance = Math.abs(point - rounded);
      return distance < best.distance ? { point, distance } : best;
    }, { point: rounded, distance: Infinity });
    const didSnap = nearest.distance <= threshold;
    const snapped = didSnap ? roundTimelineTime(nearest.point) : rounded;
    if (options.showGuide) setSnapGuideTime(didSnap ? snapped : null);
    return snapped;
  };
  const shiftClipTime = (type, item, amount = 0.7) => {
    const current = Number(item?.time || 0);
    return clampClipStartForType(type, item, current + amount);
  };
  const selectSingleClip = (type, index) => {
    setSelectedClip({ type, index });
    if (type === "sfx") setSelectedIndex(index);
    setSelectedClipKeys([getClipKey(type, index)]);
  };
  const toggleClipSelection = (type, index) => {
    const key = getClipKey(type, index);
    setSelectedClip({ type, index });
    if (type === "sfx") setSelectedIndex(index);
    setSelectedClipKeys((prev) => prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]);
  };
  const canUndo = historyTick >= 0 && historyRef.current.past.length > 0;
  const canRedo = historyTick >= 0 && historyRef.current.future.length > 0;
  const undoTimeline = () => {
    const history = historyRef.current;
    const previous = history.past.pop();
    if (previous === undefined) return;
    history.future = [clonePlan(draft), ...history.future].slice(0, 40);
    history.skip = true;
    setDraft(previous);
    setHistoryTick((tick) => tick + 1);
  };
  const redoTimeline = () => {
    const history = historyRef.current;
    const next = history.future.shift();
    if (next === undefined) return;
    history.past = [...history.past.slice(-39), clonePlan(draft)];
    history.skip = true;
    setDraft(next);
    setHistoryTick((tick) => tick + 1);
  };
  React.useEffect(() => {
    if (selectedIndex > Math.max(0, effects.length - 1)) setSelectedIndex(Math.max(0, effects.length - 1));
  }, [effects.length, selectedIndex]);
  const playEffect = (effect, index) => {
    setSoloIndex(index);
    if (effect?.url) {
      const audio = new Audio(effect.url);
      audio.volume = Math.max(0.01, Math.min(0.8, Number(effect.volume ?? 0.2)));
      audio.play().catch(() => playSfxPreview(effect));
    } else {
      playSfxPreview(effect);
    }
    window.setTimeout(() => setSoloIndex(null), 900);
  };
  const playPlan = () => {
    enabledEffects.slice(0, 8).forEach((effect) => {
      playSfxPreview(effect, Math.min(8, Math.max(0, Number(effect.time || 0))));
    });
  };
  const seekTimeline = (value, options = {}) => {
    const nextTime = Math.max(0, Math.min(duration, Number(value) || 0));
    setSnapGuideTime(null);
    setCurrentTime(nextTime);
    if (options.syncPreview !== false && previewVideoRef.current && Number.isFinite(previewVideoRef.current.duration)) {
      const videoTime = Math.max(0, Math.min(previewVideoRef.current.duration, nextTime));
      if (Math.abs(previewVideoRef.current.currentTime - videoTime) > 0.15) {
        previewVideoRef.current.currentTime = videoTime;
      }
      if (!previewVideoRef.current.paused) scheduleTimelineSfxFrom(nextTime);
    }
  };
  const syncTimelineFromPreview = (value) => {
    setSnapGuideTime(null);
    setCurrentTime(Math.max(0, Math.min(duration, Number(value) || 0)));
  };
  const clearTimelinePlaybackAudio = () => {
    playbackTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    playbackTimersRef.current = [];
    playbackAudiosRef.current.forEach((audio) => {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch (_) {
        // Ignore browser audio cleanup edge cases.
      }
    });
    playbackAudiosRef.current = [];
    setSoloIndex(null);
  };
  const playSfxClipNow = (effect, index) => {
    setSoloIndex(index);
    if (effect?.url) {
      const audio = new Audio(effect.url);
      audio.volume = Math.max(0.01, Math.min(0.8, Number(effect.volume ?? 0.2)));
      playbackAudiosRef.current = [...playbackAudiosRef.current, audio];
      audio.play().catch(() => playSfxPreview(effect));
    } else {
      playSfxPreview(effect);
    }
    window.setTimeout(() => setSoloIndex((value) => (value === index ? null : value)), 900);
  };
  const scheduleTimelineSfxFrom = (startTime = currentTime) => {
    clearTimelinePlaybackAudio();
    effects.forEach((effect, index) => {
      if (!effect || effect.enabled === false) return;
      const clipTime = Number(effect.time || 0);
      if (clipTime < startTime - 0.05 || clipTime > duration) return;
      const delayMs = Math.max(0, Math.round((clipTime - startTime) * 1000));
      const timerId = window.setTimeout(() => playSfxClipNow(effect, index), delayMs);
      playbackTimersRef.current = [...playbackTimersRef.current, timerId];
    });
  };
  const pausePreviewPlayback = () => {
    clearTimelinePlaybackAudio();
    previewVideoRef.current?.pause?.();
    setIsPreviewPlaying(false);
  };
  const playPreviewFrom = (value = currentTime) => {
    const player = previewVideoRef.current;
    if (!player) return;
    const maxTime = Number.isFinite(player.duration) ? player.duration : duration;
    const targetTime = Math.max(0, Math.min(maxTime, Number(value) || 0));
    seekTimeline(targetTime);
    if (Math.abs(player.currentTime - targetTime) > 0.15) player.currentTime = targetTime;
    scheduleTimelineSfxFrom(targetTime);
    player.play().then(() => setIsPreviewPlaying(true)).catch(() => {
      clearTimelinePlaybackAudio();
      setIsPreviewPlaying(false);
    });
  };
  const stopPreviewPlayback = () => {
    pausePreviewPlayback();
    seekTimeline(0);
  };
  const seekTimelineBy = (delta) => {
    seekTimeline(Math.round((currentTime + Number(delta || 0)) * 10) / 10);
  };
  const togglePreviewPlayback = () => {
    const player = previewVideoRef.current;
    if (!player) return;
    if (!player.paused) {
      pausePreviewPlayback();
      return;
    }
    playPreviewFrom(currentTime);
  };
  const startScrubTimeline = (event) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const moveTo = (clientX) => {
      const ratio = rect.width ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
      seekTimeline(Math.round(ratio * duration * 10) / 10);
    };
    moveTo(event.clientX);
    const handleMove = (moveEvent) => moveTo(moveEvent.clientX);
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  };
  const isOverlayVisibleAtTime = (item) => {
    const start = Number(item?.time || 0);
    const length = Number(item?.duration || 0);
    return currentTime >= start && currentTime <= start + Math.max(0.1, length);
  };
  const isClipActiveAtTime = (item, fallbackDuration = 0.3) => {
    if (!item || item.enabled === false) return false;
    const start = Number(item.time || 0);
    const length = Math.max(0.1, Number(item.duration || fallbackDuration));
    return currentTime >= start && currentTime <= start + length;
  };
  const updateEffect = (index, patch) => {
    setDraft((prev) => {
      const base = prev || { preset: "Urgent Deal", music: { assetId: "tropical_luxury_01", label: "Tropical luxury", volume: 0.12 }, effects: [] };
      const effects = Array.isArray(base.effects) ? [...base.effects] : [];
      effects[index] = { ...(effects[index] || {}), ...patch };
      return { ...base, effects };
    });
  };
  const getOverlayKey = (type) => type === "image" ? "imageOverlays" : type === "video" ? "videoClips" : "textOverlays";
  const getOverlayItems = (type) => type === "image" ? imageOverlays : type === "video" ? videoClips : textOverlays;
  const updateOverlay = (type, index, patch) => {
    const key = getOverlayKey(type);
    setDraft((prev) => {
      const base = prev || {};
      const items = Array.isArray(base[key]) ? [...base[key]] : [];
      items[index] = { ...(items[index] || {}), ...patch };
      return { ...base, [key]: items };
    });
  };
  const removeOverlay = (type, index) => {
    const key = getOverlayKey(type);
    setDraft((prev) => ({ ...(prev || {}), [key]: (Array.isArray(prev?.[key]) ? prev[key] : []).filter((_, i) => i !== index) }));
    selectSingleClip("sfx", Math.max(0, Math.min(selectedIndex, effects.length - 1)));
  };
  const duplicateOverlay = (type, index) => {
    const key = getOverlayKey(type);
    const source = getOverlayItems(type)[index];
    if (!source) return;
    setDraft((prev) => {
      const base = prev || {};
      const items = Array.isArray(base[key]) ? [...base[key]] : [];
      const clone = {
        ...source,
        id: `${type}_${Date.now()}_${index}`,
        time: shiftClipTime(type, source),
      };
      items.splice(index + 1, 0, clone);
      selectSingleClip(type, index + 1);
      return { ...base, [key]: items };
    });
  };
  const splitOverlay = (type, index) => {
    const key = getOverlayKey(type);
    const source = getOverlayItems(type)[index];
    if (!source) return false;
    const start = Number(source.time || 0);
    const length = Number(source.duration || (type === "video" ? 5 : type === "image" ? 4 : 3));
    const end = start + Math.max(0.1, length);
    const cut = Math.round(currentTime * 10) / 10;
    if (cut <= start + 0.1 || cut >= end - 0.1) return false;
    const leftDuration = Math.round((cut - start) * 10) / 10;
    const rightDuration = Math.round((end - cut) * 10) / 10;
    setDraft((prev) => {
      const base = prev || {};
      const items = Array.isArray(base[key]) ? [...base[key]] : [];
      const left = { ...source, duration: leftDuration };
      const right = {
        ...source,
        id: `${type}_split_${Date.now()}_${index}`,
        time: cut,
        duration: rightDuration,
      };
      if (type === "video") right.sourceStart = Math.round((Number(source.sourceStart || 0) + leftDuration) * 10) / 10;
      items.splice(index, 1, left, right);
      selectSingleClip(type, index + 1);
      return { ...base, [key]: items };
    });
    return true;
  };
  const removeEffect = (index) => {
    setDraft((prev) => ({ ...(prev || {}), effects: (Array.isArray(prev?.effects) ? prev.effects : []).filter((_, i) => i !== index) }));
    selectSingleClip("sfx", Math.max(0, index - 1));
  };
  const addEffect = (preset = SOUND_EFFECT_PRESETS[0]) => {
    setDraft((prev) => {
      const base = prev || { preset: "Urgent Deal", music: { assetId: "tropical_luxury_01", label: "Tropical luxury", volume: 0.12 }, effects: [] };
      const effects = Array.isArray(base.effects) ? [...base.effects] : [];
      selectSingleClip("sfx", effects.length);
      return { ...base, effects: [...effects, createSoundCue(effects.length, preset)] };
    });
  };
  const duplicateEffect = (index) => {
    const source = effects[index];
    if (!source) return;
    setDraft((prev) => {
      const base = prev || {};
      const nextEffects = Array.isArray(base.effects) ? [...base.effects] : [];
      const clone = {
        ...source,
        id: `copy_sfx_${Date.now()}_${index}`,
        time: shiftClipTime("sfx", source),
      };
      nextEffects.splice(index + 1, 0, clone);
      selectSingleClip("sfx", index + 1);
      return { ...base, effects: nextEffects };
    });
  };
  const splitEffect = (index) => {
    const source = effects[index];
    if (!source) return false;
    const start = Number(source.time || 0);
    const length = Number(source.duration || getSoundPreset(source.assetId).tone?.duration || 0.3);
    const end = start + Math.max(0.1, length);
    const cut = Math.round(currentTime * 10) / 10;
    if (cut <= start + 0.1 || cut >= end - 0.1) return false;
    const leftDuration = Math.round((cut - start) * 10) / 10;
    const rightDuration = Math.round((end - cut) * 10) / 10;
    setDraft((prev) => {
      const base = prev || {};
      const nextEffects = Array.isArray(base.effects) ? [...base.effects] : [];
      nextEffects.splice(index, 1, { ...source, duration: leftDuration }, {
        ...source,
        id: `split_sfx_${Date.now()}_${index}`,
        time: cut,
        duration: rightDuration,
      });
      selectSingleClip("sfx", index + 1);
      return { ...base, effects: nextEffects };
    });
    return true;
  };
  const applyPresetToEffect = (index, assetId) => {
    const preset = getSoundPreset(assetId);
    updateEffect(index, {
      assetId: preset.assetId,
      label: preset.label,
      note: preset.note,
      volume: preset.volume,
    });
  };
  const nudgeEffect = (index, amount) => {
    const current = Number(effects[index]?.time || 0);
    updateEffect(index, { time: Math.max(0, Math.min(duration, Math.round((current + amount) * 10) / 10)) });
  };
  const updateSelectedClip = (patch) => {
    if (selectedClip.type === "text" || selectedClip.type === "image" || selectedClip.type === "video") {
      updateOverlay(selectedClip.type, selectedClip.index, patch);
      return;
    }
    updateEffect(selectedClip.index, patch);
  };
  const moveSelectedOverlayPosition = (dx = 0, dy = 0) => {
    if (selectedClip.type !== "text" && selectedClip.type !== "image" && selectedClip.type !== "video") return;
    const nextX = Math.max(0, Math.min(100, Math.round((Number(selectedItem?.x ?? 50) + dx) * 10) / 10));
    const nextY = Math.max(0, Math.min(100, Math.round((Number(selectedItem?.y ?? (selectedClip.type === "video" ? 50 : 70)) + dy) * 10) / 10));
    updateSelectedClip({ x: nextX, y: nextY });
  };
  const centerSelectedOverlay = () => {
    if (selectedClip.type !== "text" && selectedClip.type !== "image" && selectedClip.type !== "video") return;
    updateSelectedClip({ x: 50, y: 50 });
  };
  const getOverlayLayer = (type, item, index) => {
    const base = type === "image" ? 20 : type === "video" ? 10 : 30;
    return Number(item?.zIndex ?? (base + index));
  };
  const updateSelectedOverlayLayer = (action) => {
    if (selectedClip.type !== "text" && selectedClip.type !== "image" && selectedClip.type !== "video") return;
    const overlays = [
      ...videoClips.map((item, index) => ({ type: "video", index, layer: getOverlayLayer("video", item, index) })),
      ...textOverlays.map((item, index) => ({ type: "text", index, layer: getOverlayLayer("text", item, index) })),
      ...imageOverlays.map((item, index) => ({ type: "image", index, layer: getOverlayLayer("image", item, index) })),
    ];
    const currentKey = getClipKey(selectedClip.type, selectedClip.index);
    const current = overlays.find((item) => getClipKey(item.type, item.index) === currentKey);
    if (!current) return;
    const layers = overlays.map((item) => item.layer);
    const minLayer = layers.length ? Math.min(...layers) : 0;
    const maxLayer = layers.length ? Math.max(...layers) : 0;
    const nextLayer =
      action === "front"
        ? maxLayer + 1
        : action === "back"
          ? minLayer - 1
          : action === "up"
            ? current.layer + 1
            : current.layer - 1;
    updateSelectedClip({ zIndex: nextLayer });
  };
  const removeSelectedClip = () => {
    if (selectedClipKeys.length > 1) {
      const selected = new Set(selectedClipKeys);
      setDraft((prev) => {
        const base = prev || {};
        return {
          ...base,
          effects: (Array.isArray(base.effects) ? base.effects : []).filter((_, index) => !selected.has(getClipKey("sfx", index))),
          textOverlays: (Array.isArray(base.textOverlays) ? base.textOverlays : []).filter((_, index) => !selected.has(getClipKey("text", index))),
          imageOverlays: (Array.isArray(base.imageOverlays) ? base.imageOverlays : []).filter((_, index) => !selected.has(getClipKey("image", index))),
          videoClips: (Array.isArray(base.videoClips) ? base.videoClips : []).filter((_, index) => !selected.has(getClipKey("video", index))),
        };
      });
      selectSingleClip("sfx", 0);
      return;
    }
    if (selectedClip.type === "text" || selectedClip.type === "image" || selectedClip.type === "video") {
      removeOverlay(selectedClip.type, selectedClip.index);
      return;
    }
    removeEffect(selectedClip.index);
  };
  const duplicateSelectedClip = () => {
    if (selectedClipKeys.length > 1) {
      const selected = new Set(selectedClipKeys);
      const copiedKeys = [];
      const copySelected = (items, type) => {
        const nextItems = Array.isArray(items) ? [...items] : [];
        (Array.isArray(items) ? items : []).forEach((item, index) => {
          if (!selected.has(getClipKey(type, index))) return;
          const cloneIndex = nextItems.length;
          copiedKeys.push(getClipKey(type, cloneIndex));
          nextItems.push({
            ...item,
            id: `${type}_copy_${Date.now()}_${index}_${cloneIndex}`,
            time: shiftClipTime(type, item),
          });
        });
        return nextItems;
      };
      setDraft((prev) => {
        const base = prev || {};
        return {
          ...base,
          effects: copySelected(base.effects, "sfx"),
          textOverlays: copySelected(base.textOverlays, "text"),
          imageOverlays: copySelected(base.imageOverlays, "image"),
          videoClips: copySelected(base.videoClips, "video"),
        };
      });
      if (copiedKeys.length) {
        setSelectedClipKeys(copiedKeys);
        const [type, index] = copiedKeys[copiedKeys.length - 1].split(":");
        setSelectedClip({ type, index: Number(index) || 0 });
        if (type === "sfx") setSelectedIndex(Number(index) || 0);
      }
      return;
    }
    if (selectedClip.type === "text" || selectedClip.type === "image" || selectedClip.type === "video") {
      duplicateOverlay(selectedClip.type, selectedClip.index);
      return;
    }
    duplicateEffect(selectedClip.index);
  };
  const splitSelectedClip = () => {
    if (selectedClipKeys.length > 1) {
      const selected = new Set(selectedClipKeys);
      const cut = Math.round(currentTime * 10) / 10;
      const splitItems = (items, type) => {
        const nextItems = [];
        (Array.isArray(items) ? items : []).forEach((item, index) => {
          const start = Number(item?.time || 0);
          const defaultDuration = type === "sfx" ? Number(getSoundPreset(item?.assetId).tone?.duration || 0.3) : type === "video" ? 5 : type === "image" ? 4 : 3;
          const length = Number(item?.duration || defaultDuration);
          const end = start + Math.max(0.1, length);
          if (!selected.has(getClipKey(type, index)) || cut <= start + 0.1 || cut >= end - 0.1) {
            nextItems.push(item);
            return;
          }
          const leftDuration = Math.round((cut - start) * 10) / 10;
          const rightDuration = Math.round((end - cut) * 10) / 10;
          const left = { ...item, duration: leftDuration };
          const right = {
            ...item,
            id: `${type}_split_${Date.now()}_${index}_${nextItems.length}`,
            time: cut,
            duration: rightDuration,
          };
          if (type === "video") right.sourceStart = Math.round((Number(item.sourceStart || 0) + leftDuration) * 10) / 10;
          nextItems.push(left, right);
        });
        return nextItems;
      };
      setDraft((prev) => {
        const base = prev || {};
        return {
          ...base,
          effects: splitItems(base.effects, "sfx"),
          textOverlays: splitItems(base.textOverlays, "text"),
          imageOverlays: splitItems(base.imageOverlays, "image"),
          videoClips: splitItems(base.videoClips, "video"),
        };
      });
      return true;
    }
    if (selectedClip.type === "text" || selectedClip.type === "image" || selectedClip.type === "video") {
      return splitOverlay(selectedClip.type, selectedClip.index);
    }
    return splitEffect(selectedClip.index);
  };
  const nudgeSelectedClip = (amount) => {
    if (selectedClipKeys.length > 1) {
      const selected = new Set(selectedClipKeys);
      const selectedRanges = selectedClipKeys
        .map((key) => {
          const [type, rawIndex] = key.split(":");
          const index = Number(rawIndex) || 0;
          const item = type === "sfx" ? effects[index] : type === "text" ? textOverlays[index] : type === "image" ? imageOverlays[index] : videoClips[index];
          if (!item) return null;
          const start = Number(item.time || 0);
          return { start, end: start + getClipDurationForType(type, item) };
        })
        .filter(Boolean);
      const groupStart = selectedRanges.length ? Math.min(...selectedRanges.map((item) => item.start)) : 0;
      const groupEnd = selectedRanges.length ? Math.max(...selectedRanges.map((item) => item.end)) : duration;
      const boundedAmount = Math.max(-groupStart, Math.min(duration - groupEnd, Math.round(Number(amount || 0) * 10) / 10));
      const shiftItem = (item) => {
        const current = Number(item?.time || 0);
        return { ...item, time: Math.max(0, Math.min(duration, Math.round((current + boundedAmount) * 10) / 10)) };
      };
      setDraft((prev) => {
        const base = prev || {};
        return {
          ...base,
          effects: (Array.isArray(base.effects) ? base.effects : []).map((item, index) => selected.has(getClipKey("sfx", index)) ? shiftItem(item) : item),
          textOverlays: (Array.isArray(base.textOverlays) ? base.textOverlays : []).map((item, index) => selected.has(getClipKey("text", index)) ? shiftItem(item) : item),
          imageOverlays: (Array.isArray(base.imageOverlays) ? base.imageOverlays : []).map((item, index) => selected.has(getClipKey("image", index)) ? shiftItem(item) : item),
          videoClips: (Array.isArray(base.videoClips) ? base.videoClips : []).map((item, index) => selected.has(getClipKey("video", index)) ? shiftItem(item) : item),
        };
      });
      return;
    }
    const current = Number(selectedItem?.time || 0);
    const maxStart = Math.max(0, duration - getClipDurationForType(selectedClip.type, selectedItem));
    updateSelectedClip({ time: Math.max(0, Math.min(maxStart, Math.round((current + amount) * 10) / 10)) });
  };
  const stretchSelectedClip = (amount) => {
    if (selectedClipKeys.length > 1 || !selectedItem) return;
    updateSelectedClip({ duration: clampClipDuration(selectedClipDuration + amount) });
  };
  const stretchSelectedClipToEnd = () => {
    if (selectedClipKeys.length > 1 || !selectedItem) return;
    updateSelectedClip({ duration: clampClipDuration(duration - selectedClipStart) });
  };
  const getSelectedGroupStart = () => {
    if (selectedClipKeys.length <= 1) return Number(selectedItem?.time || 0);
    const starts = selectedClipKeys
      .map((key) => {
        const [type, rawIndex] = key.split(":");
        const index = Number(rawIndex) || 0;
        const item = type === "sfx" ? effects[index] : type === "text" ? textOverlays[index] : type === "image" ? imageOverlays[index] : videoClips[index];
        return item ? Number(item.time || 0) : null;
      })
      .filter((value) => value !== null);
    return starts.length ? Math.min(...starts) : Number(selectedItem?.time || 0);
  };
  const getSelectedGroupEnd = () => {
    if (selectedClipKeys.length <= 1) {
      return Number(selectedItem?.time || 0) + getClipDurationForType(selectedClip.type, selectedItem);
    }
    const ends = selectedClipKeys
      .map((key) => {
        const [type, rawIndex] = key.split(":");
        const index = Number(rawIndex) || 0;
        const item = type === "sfx" ? effects[index] : type === "text" ? textOverlays[index] : type === "image" ? imageOverlays[index] : videoClips[index];
        return item ? Number(item.time || 0) + getClipDurationForType(type, item) : null;
      })
      .filter((value) => value !== null);
    return ends.length ? Math.max(...ends) : Number(selectedItem?.time || 0);
  };
  const moveSelectedClipToTime = (time) => {
    const target = Math.max(0, Math.min(duration, Math.round((Number(time) || 0) * 10) / 10));
    if (selectedClipKeys.length > 1) {
      const current = getSelectedGroupStart();
      nudgeSelectedClip(Math.round((target - current) * 10) / 10);
      return;
    }
    const maxStart = Math.max(0, duration - getClipDurationForType(selectedClip.type, selectedItem));
    updateSelectedClip({ time: Math.min(target, Math.round(maxStart * 10) / 10) });
  };
  const moveSelectedClipToEnd = () => {
    const groupStart = getSelectedGroupStart();
    const groupEnd = getSelectedGroupEnd();
    const span = Math.max(0.1, groupEnd - groupStart);
    moveSelectedClipToTime(Math.max(0, duration - span));
  };
  const getTimelineClipRanges = () => [
    ...videoClips.map((item, index) => ({ type: "video", index, item })),
    ...effects.map((item, index) => ({ type: "sfx", index, item })),
    ...textOverlays.map((item, index) => ({ type: "text", index, item })),
    ...imageOverlays.map((item, index) => ({ type: "image", index, item })),
  ]
    .filter(({ item }) => item)
    .map((clip) => {
      const start = Number(clip.item?.time || 0);
      const length = getClipDurationForType(clip.type, clip.item);
      return {
        ...clip,
        key: getClipKey(clip.type, clip.index),
        start,
        end: roundTimelineTime(start + length),
      };
    });
  const getNearestTimelineClip = (direction) => {
    const selected = new Set(selectedClipKeys);
    const groupStart = getSelectedGroupStart();
    const groupEnd = getSelectedGroupEnd();
    const candidates = getTimelineClipRanges().filter((clip) => !selected.has(clip.key));
    if (direction === "previous") {
      return candidates
        .filter((clip) => clip.end <= groupStart)
        .sort((left, right) => right.end - left.end)[0] || null;
    }
    return candidates
      .filter((clip) => clip.start >= groupEnd)
      .sort((left, right) => left.start - right.start)[0] || null;
  };
  const moveSelectedClipToNeighbor = (direction) => {
    const neighbor = getNearestTimelineClip(direction);
    if (!neighbor) return;
    const span = Math.max(0.1, getSelectedGroupEnd() - getSelectedGroupStart());
    const target = direction === "previous" ? neighbor.end : Math.max(0, neighbor.start - span);
    moveSelectedClipToTime(target);
  };
  const getClipSummaryLabel = (clip) => {
    if (!clip) return "";
    const name = clip.item?.label || clip.item?.text || clip.item?.assetId || (clip.type === "sfx" ? "SFX" : clip.type === "text" ? "Текст" : clip.type === "image" ? "Картинка" : "Видео");
    return `${name} · ${roundTimelineTime(clip.start)}-${roundTimelineTime(clip.end)}s`;
  };
  const getTrackBoundaryClip = (boundary) => {
    const selected = new Set(selectedClipKeys);
    const sameTrackClips = getTimelineClipRanges().filter((clip) => clip.type === selectedClip.type && !selected.has(clip.key));
    if (!sameTrackClips.length) return null;
    return boundary === "start"
      ? [...sameTrackClips].sort((left, right) => left.start - right.start)[0]
      : [...sameTrackClips].sort((left, right) => right.end - left.end)[0];
  };
  const moveSelectedClipToTrackBoundary = (boundary) => {
    const span = Math.max(0.1, getSelectedGroupEnd() - getSelectedGroupStart());
    const boundaryClip = getTrackBoundaryClip(boundary);
    const target = boundary === "start"
      ? Math.max(0, Number(boundaryClip?.start || 0) - span)
      : Number(boundaryClip?.end || 0);
    moveSelectedClipToTime(target);
  };
  const trimSelectedClipStartToPlayhead = () => {
    if (selectedClipKeys.length > 1 || !selectedItem) return;
    const start = Number(selectedItem.time || 0);
    const length = getClipDurationForType(selectedClip.type, selectedItem);
    const end = start + Math.max(0.1, length);
    const nextStart = clampTimelineTime(currentTime, 0, Math.max(0, end - 0.1));
    const delta = nextStart - start;
    const nextSourceStart = selectedClip.type === "video" ? Math.max(0, Math.round((Number(selectedItem.sourceStart || 0) + delta) * 10) / 10) : 0;
    const nextDuration = selectedClip.type === "video"
      ? clampClipDuration(end - nextStart, nextStart, { ...selectedItem, sourceStart: nextSourceStart })
      : Math.round((end - nextStart) * 10) / 10;
    updateSelectedClip({
      time: nextStart,
      duration: nextDuration,
      ...(selectedClip.type === "video" ? { sourceStart: nextSourceStart } : {}),
    });
  };
  const trimSelectedClipEndToPlayhead = () => {
    if (selectedClipKeys.length > 1 || !selectedItem) return;
    const start = Number(selectedItem.time || 0);
    const nextEnd = clampTimelineTime(currentTime, start + 0.1, selectedClipMaxEnd);
    updateSelectedClip({ duration: clampClipDuration(nextEnd - start) });
  };
  const getSelectedClipItems = () => selectedClipKeys
    .map((key) => {
      const [type, rawIndex] = key.split(":");
      const index = Number(rawIndex) || 0;
      const item = type === "sfx" ? effects[index] : type === "text" ? textOverlays[index] : type === "image" ? imageOverlays[index] : videoClips[index];
      return item ? { key, type, index, item } : null;
    })
    .filter(Boolean);
  const selectedClipItems = getSelectedClipItems();
  const selectedGroupEnabledCount = selectedClipItems.filter(({ item }) => item.enabled !== false).length;
  const selectedGroupHasDisabled = selectedClipItems.some(({ item }) => item.enabled === false);
  const copySelectedClips = () => {
    if (!selectedClipItems.length) return;
    const firstStart = Math.min(...selectedClipItems.map(({ item }) => Number(item.time || 0)));
    setTimelineClipboard(selectedClipItems.map(({ type, item }) => ({
      type,
      offset: Math.max(0, Math.round((Number(item.time || 0) - firstStart) * 10) / 10),
      item: clonePlan(item),
    })));
  };
  const cutSelectedClips = () => {
    if (!selectedClipItems.length) return;
    copySelectedClips();
    removeSelectedClip();
  };
  const pasteTimelineClipboard = () => {
    if (!timelineClipboard.length) return;
    const pastedKeys = [];
    const pasteItems = (items, type) => {
      const nextItems = Array.isArray(items) ? [...items] : [];
      timelineClipboard.filter((clip) => clip.type === type).forEach((clip, index) => {
        const cloneIndex = nextItems.length;
        pastedKeys.push(getClipKey(type, cloneIndex));
        nextItems.push({
          ...(clip.item || {}),
          id: `${type}_paste_${Date.now()}_${index}_${cloneIndex}`,
          time: clampClipStartForType(type, clip.item, currentTime + Number(clip.offset || 0)),
        });
      });
      return nextItems;
    };
    setDraft((prev) => {
      const base = prev || {};
      return {
        ...base,
        effects: pasteItems(base.effects, "sfx"),
        textOverlays: pasteItems(base.textOverlays, "text"),
        imageOverlays: pasteItems(base.imageOverlays, "image"),
        videoClips: pasteItems(base.videoClips, "video"),
      };
    });
    if (pastedKeys.length) {
      setSelectedClipKeys(pastedKeys);
      const [type, rawIndex] = pastedKeys[pastedKeys.length - 1].split(":");
      const index = Number(rawIndex) || 0;
      setSelectedClip({ type, index });
      if (type === "sfx") setSelectedIndex(index);
    }
  };
  const toggleSelectedClipEnabled = () => {
    if (selectedClipKeys.length > 1) {
      const selected = new Set(selectedClipKeys);
      const enabled = selectedGroupHasDisabled;
      const toggleItems = (items, type) => (Array.isArray(items) ? items : []).map((item, index) => (
        selected.has(getClipKey(type, index)) ? { ...item, enabled } : item
      ));
      setDraft((prev) => {
        const base = prev || {};
        return {
          ...base,
          effects: toggleItems(base.effects, "sfx"),
          textOverlays: toggleItems(base.textOverlays, "text"),
          imageOverlays: toggleItems(base.imageOverlays, "image"),
          videoClips: toggleItems(base.videoClips, "video"),
        };
      });
      return;
    }
    updateSelectedClip({ enabled: selectedItem.enabled === false ? true : false });
  };
  const selectClipsAtPlayhead = () => {
    const time = Math.round(currentTime * 10) / 10;
    const visibleKeys = [];
    const collectVisible = (items, type, defaultDuration) => {
      (Array.isArray(items) ? items : []).forEach((item, index) => {
        if (item?.enabled === false) return;
        const start = Number(item?.time || 0);
        const length = Number(item?.duration || defaultDuration(item));
        if (time >= start && time <= start + Math.max(0.1, length)) visibleKeys.push(getClipKey(type, index));
      });
    };
    collectVisible(videoClips, "video", () => 5);
    collectVisible(effects, "sfx", (item) => Number(getSoundPreset(item?.assetId).tone?.duration || 0.3));
    collectVisible(textOverlays, "text", () => 3);
    collectVisible(imageOverlays, "image", () => 4);
    if (!visibleKeys.length) return;
    setSelectedClipKeys(visibleKeys);
    const [type, rawIndex] = visibleKeys[visibleKeys.length - 1].split(":");
    const index = Number(rawIndex) || 0;
    setSelectedClip({ type, index });
    if (type === "sfx") setSelectedIndex(index);
  };
  const selectClipsByType = (type) => {
    const items = type === "sfx" ? effects : type === "text" ? textOverlays : type === "image" ? imageOverlays : videoClips;
    const keys = (Array.isArray(items) ? items : [])
      .map((item, index) => item?.enabled === false ? null : getClipKey(type, index))
      .filter(Boolean);
    if (!keys.length) return;
    setSelectedClipKeys(keys);
    const index = Number(keys[keys.length - 1].split(":")[1]) || 0;
    setSelectedClip({ type, index });
    if (type === "sfx") setSelectedIndex(index);
  };
  const selectAllTimelineClips = () => {
    const keys = [
      ...videoClips.map((item, index) => item?.enabled === false ? null : getClipKey("video", index)),
      ...effects.map((item, index) => item?.enabled === false ? null : getClipKey("sfx", index)),
      ...textOverlays.map((item, index) => item?.enabled === false ? null : getClipKey("text", index)),
      ...imageOverlays.map((item, index) => item?.enabled === false ? null : getClipKey("image", index)),
    ].filter(Boolean);
    if (!keys.length) return;
    setSelectedClipKeys(keys);
    const [type, rawIndex] = keys[keys.length - 1].split(":");
    const index = Number(rawIndex) || 0;
    setSelectedClip({ type, index });
    if (type === "sfx") setSelectedIndex(index);
  };
  React.useEffect(() => {
    if (!editorOpen) return undefined;
    const isTypingTarget = (target) => {
      const tagName = String(target?.tagName || "").toLowerCase();
      return tagName === "input" || tagName === "textarea" || tagName === "select" || target?.isContentEditable;
    };
    const handleKeyDown = (event) => {
      if (isTypingTarget(event.target)) return;
      if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redoTimeline();
        else undoTimeline();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === "y") {
        event.preventDefault();
        redoTimeline();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === "a") {
        event.preventDefault();
        selectAllTimelineClips();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === "c") {
        event.preventDefault();
        copySelectedClips();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === "x") {
        event.preventDefault();
        cutSelectedClips();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === "v") {
        event.preventDefault();
        pasteTimelineClipboard();
        return;
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.code === "Space") {
        event.preventDefault();
        togglePreviewPlayback();
        return;
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === "Enter") {
        event.preventDefault();
        playPreviewFrom(0);
        return;
      }
      if (event.key === "Escape" && selectedClipKeys.length > 1) {
        event.preventDefault();
        selectSingleClip(selectedClip.type, selectedClip.index);
        return;
      }
      if (!selectedItem && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        seekTimelineBy(direction * (event.shiftKey ? 5 : 1));
        return;
      }
      if (!selectedItem) return;
      if (!event.ctrlKey && !event.metaKey && !event.altKey && String(event.key).toLowerCase() === "s") {
        event.preventDefault();
        splitSelectedClip();
        return;
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === "Home") {
        event.preventDefault();
        moveSelectedClipToTime(0);
        return;
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === "End") {
        event.preventDefault();
        moveSelectedClipToEnd();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeSelectedClip();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelectedClip();
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        nudgeSelectedClip(direction * (event.shiftKey ? 1 : 0.1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editorOpen, selectedItem, selectedClip, selectedClipKeys, effects, textOverlays, imageOverlays, videoClips, duration, currentTime, timelineClipboard, canUndo, canRedo]);
  const updateTrim = (patch) => {
    setDraft((prev) => ({
      ...(prev || {}),
      edit: {
        ...(prev?.edit || {}),
        trim: {
          ...(prev?.edit?.trim || {}),
          ...patch,
        },
      },
    }));
  };
  const addTextOverlay = () => {
    setDraft((prev) => {
      const base = prev || {};
      const items = Array.isArray(base.textOverlays) ? [...base.textOverlays] : [];
      return {
        ...base,
        textOverlays: [
          ...items,
          { id: `text_${Date.now()}`, label: "CTA text", text: "Свяжитесь с поставщиком", time: Math.min(3, duration), duration: 3, enabled: true, x: 50, y: 78, fontSize: 22, scale: 1, opacity: 1, zIndex: 30 + items.length },
        ],
      };
    });
    selectSingleClip("text", textOverlays.length);
  };
  const addImageOverlay = () => {
    setDraft((prev) => {
      const base = prev || {};
      const items = Array.isArray(base.imageOverlays) ? [...base.imageOverlays] : [];
      return {
        ...base,
        imageOverlays: [
          ...items,
          { id: `image_${Date.now()}`, label: "Product card", time: Math.min(5, duration), duration: 4, enabled: true, x: 50, y: 72, scale: 1, opacity: 1, rotation: 0, width: 34, zIndex: 20 + items.length },
        ],
      };
    });
    selectSingleClip("image", imageOverlays.length);
  };
  const addImageMediaToTrack = (media, targetTime = currentTime) => {
    if (!media?.url) return;
    setDraft((prev) => {
      const base = prev || {};
      const items = Array.isArray(base.imageOverlays) ? [...base.imageOverlays] : [];
      selectSingleClip("image", items.length);
      return {
        ...base,
        imageOverlays: [
          ...items,
          {
            id: `image_${Date.now()}`,
            label: media.label || "Картинка",
            url: media.url,
            time: Math.round(Number(targetTime || 0) * 10) / 10,
            duration: 4,
            enabled: true,
            x: 50,
            y: 72,
            scale: 1,
            opacity: 1,
            rotation: 0,
            width: 34,
            zIndex: 20 + items.length,
          },
        ],
      };
    });
  };
  const addVideoMediaToTrack = (media, targetTime = currentTime) => {
    if (!media?.url) return;
    setDraft((prev) => {
      const base = prev || {};
      const items = Array.isArray(base.videoClips) ? [...base.videoClips] : [];
      const clipDuration = Math.min(12, Math.max(1, Number(media.durationSeconds || 5)));
      selectSingleClip("video", items.length);
      return {
        ...base,
        videoClips: [
          ...items,
          {
            id: `video_${Date.now()}`,
            label: media.label || "Видео-вставка",
            url: media.url,
            mimeType: media.mimeType || "",
            time: Math.round(Number(targetTime || 0) * 10) / 10,
            sourceStart: 0,
            sourceDuration: Number(media.durationSeconds || 0),
            duration: clipDuration,
            enabled: true,
            x: 50,
            y: 50,
            width: 72,
            scale: 1,
            opacity: 1,
            rotation: 0,
            zIndex: 15 + items.length,
            note: "Импортированный видео-клип. Вставляется поверх основного HeyGen video без собственного звука.",
          },
        ],
      };
    });
  };
  const addAudioMediaAsSfx = (media, targetTime = currentTime) => {
    if (!media?.url) return;
    setDraft((prev) => {
      const base = prev || { preset: "Urgent Deal", music: { assetId: "tropical_luxury_01", label: "Tropical luxury", volume: 0.12 }, effects: [] };
      const effects = Array.isArray(base.effects) ? [...base.effects] : [];
      selectSingleClip("sfx", effects.length);
      return {
        ...base,
        effects: [
          ...effects,
          {
            id: `audio_${Date.now()}`,
            assetId: "custom_audio",
            label: media.label || "Импортированный звук",
            url: media.url,
            mimeType: media.mimeType || "",
            time: Math.round(Number(targetTime || 0) * 10) / 10,
            duration: Math.min(8, Math.max(0.3, Number(media.durationSeconds || 2))),
            volume: 0.22,
            enabled: true,
            note: "Импортированный аудио-клип.",
          },
        ],
      };
    });
  };
  const useAudioMediaAsMusic = (media) => {
    if (!media?.url) return;
    setDraft((prev) => ({
      ...(prev || {}),
      music: {
        ...(prev?.music || {}),
        assetId: "custom_music",
        label: media.label || "Импортированная музыка",
        url: media.url,
        mimeType: media.mimeType || "",
        volume: Number(prev?.music?.volume ?? 0.12),
      },
    }));
  };
  const addMediaToTimeline = (media, targetTime = currentTime) => {
    if (media?.type === "image") addImageMediaToTrack(media, targetTime);
    if (media?.type === "audio") addAudioMediaAsSfx(media, targetTime);
    if (media?.type === "video") addVideoMediaToTrack(media, targetTime);
    if (media?.type === "image" || media?.type === "audio" || media?.type === "video") {
      showMediaToolbarNotice(`Добавлено на ${roundTimelineTime(targetTime)}s`);
    }
  };
  const addMediaToTimelineEnd = (media) => {
    addMediaToTimeline(media, Math.max(0, duration - getMediaDefaultDuration(media)));
  };
  const canReplaceSelectedClipWithMedia = (media = selectedMedia) => {
    if (!media?.url || !selectedItem || selectedClipKeys.length > 1) return false;
    if (media.type === "audio") return selectedClip.type === "sfx";
    return media.type === selectedClip.type;
  };
  const replaceSelectedClipWithMedia = (media = selectedMedia) => {
    if (!canReplaceSelectedClipWithMedia(media)) return;
    const label = media.label || media.originalName || selectedItem?.label || "Медиа";
    if (media.type === "audio") {
      updateSelectedClip({
        assetId: "custom_audio",
        label,
        url: media.url,
        mimeType: media.mimeType || "",
        note: selectedItem?.note || "Импортированный аудио-клип.",
      });
      showMediaToolbarNotice("Клип заменён");
      return;
    }
    if (media.type === "image") {
      updateSelectedClip({
        label,
        url: media.url,
      });
      showMediaToolbarNotice("Клип заменён");
      return;
    }
    if (media.type === "video") {
      const sourceDuration = Number(media.durationSeconds || selectedItem?.sourceDuration || 0);
      const currentDuration = Number(selectedItem?.duration || getMediaDefaultDuration(media));
      const currentStart = Number(selectedItem?.time || 0);
      const sourceStartLimit = sourceDuration > 0 ? Math.max(0, sourceDuration - 0.1) : Infinity;
      const sourceStart = Math.max(0, Math.min(sourceStartLimit, Number(selectedItem?.sourceStart || 0)));
      const sourceRemaining = sourceDuration > 0 ? Math.max(0.1, sourceDuration - sourceStart) : Infinity;
      const clipDuration = Math.round(Math.max(0.1, Math.min(currentDuration, Math.max(0.1, duration - currentStart), sourceRemaining)) * 10) / 10;
      updateSelectedClip({
        label,
        url: media.url,
        mimeType: media.mimeType || "",
        sourceStart: Math.round(sourceStart * 10) / 10,
        sourceDuration,
        duration: clipDuration,
      });
      showMediaToolbarNotice("Клип заменён");
    }
  };
  const removeMediaFromLibrary = (media) => {
    if (!media?.url && !media?.id) return;
    const targetId = media.id || "";
    const targetUrl = media.url || "";
    const targetKey = getMediaIdentity(media);
    setSelectedMediaKey((current) => (current === targetKey ? "" : current));
    setPreviewMediaKey((current) => (current === targetKey ? "" : current));
    setDraft((prev) => ({
      ...(prev || {}),
      mediaLibrary: (Array.isArray(prev?.mediaLibrary) ? prev.mediaLibrary : []).filter((item) => {
        if (targetId && item?.id === targetId) return false;
        if (targetUrl && item?.url === targetUrl) return false;
        return true;
      }),
    }));
  };
  const getMediaKey = getMediaIdentity;
  const toggleMediaPreview = (media) => {
    const key = getMediaKey(media);
    if (!key) return;
    setPreviewMediaKey((current) => (current === key ? "" : key));
  };
  const readLocalMediaDuration = (file) => new Promise((resolve) => {
    if (!file?.type?.startsWith("audio/") && !file?.type?.startsWith("video/")) return resolve(null);
    const element = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
    const url = URL.createObjectURL(file);
    const cleanup = () => {
      URL.revokeObjectURL(url);
      element.removeAttribute("src");
      element.load?.();
    };
    const done = (value) => {
      cleanup();
      resolve(Number.isFinite(value) && value > 0 ? Math.round(value * 10) / 10 : null);
    };
    element.preload = "metadata";
    element.onloadedmetadata = () => done(element.duration);
    element.onerror = () => done(null);
    window.setTimeout(() => done(null), 2500);
    element.src = url;
  });
  const hydrateImportedMediaDuration = (media, durationSeconds) => {
    if (!media?.id || !durationSeconds || Number(media.durationSeconds || 0) > 0) return;
    setDraft((prev) => {
      const base = prev || {};
      const mediaLibrary = Array.isArray(base.mediaLibrary) ? base.mediaLibrary : [];
      return {
        ...base,
        mediaLibrary: mediaLibrary.map((item) => item?.id === media.id ? { ...item, durationSeconds } : item),
      };
    });
  };
  const importMediaFile = async (file, targetTime = currentTime) => {
    if (!file || !onImportMedia) return;
    const localDuration = await readLocalMediaDuration(file);
    const result = await onImportMedia(job, file);
    const media = localDuration && result?.media && !Number(result.media.durationSeconds || 0)
      ? { ...result.media, durationSeconds: localDuration }
      : result?.media;
    if (!media) return;
    if (result?.output?.soundPlan) setDraft(result.output.soundPlan);
    hydrateImportedMediaDuration(media, localDuration);
    if (media.type === "image") addImageMediaToTrack(media, targetTime);
    if (media.type === "audio") addAudioMediaAsSfx(media, targetTime);
    if (media.type === "video") addVideoMediaToTrack(media, targetTime);
  };
  const getBatchImportTime = (baseTime, index) => {
    const nextTime = Number(baseTime || 0) + (Number(index) || 0) * 0.6;
    return Math.max(0, Math.min(duration, Math.round(nextTime * 10) / 10));
  };
  const handleMediaInput = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    for (const [index, file] of files.entries()) {
      await importMediaFile(file, getBatchImportTime(currentTime, index));
    }
  };
  const handleMediaDrop = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    setMediaDragActive(false);
    setDraggedAssetType("");
    const draggedMediaKey = event.dataTransfer?.getData("application/x-travella-media") || "";
    if (draggedMediaKey) {
      const media = mediaLibrary.find((item) => getMediaKey(item) === draggedMediaKey);
      if (!media) return;
      const targetTime = clientXToTimelineTime(event.clientX) ?? currentTime;
      seekTimeline(targetTime);
      setSelectedMediaKey(draggedMediaKey);
      addMediaToTimeline(media, targetTime);
      return;
    }
    const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.type?.startsWith("image/") || file.type?.startsWith("audio/") || file.type?.startsWith("video/"));
    const targetTime = clientXToTimelineTime(event.clientX) ?? currentTime;
    seekTimeline(targetTime);
    for (const [index, file] of files.entries()) {
      await importMediaFile(file, getBatchImportTime(targetTime, index));
    }
  };
  const handleAssetDropOnTrack = (event, targetType) => {
    event.preventDefault();
    event.stopPropagation();
    setMediaDragActive(false);
    setDraggedAssetType("");
    const draggedMediaKey = event.dataTransfer?.getData("application/x-travella-media") || "";
    const media = mediaLibrary.find((item) => getMediaKey(item) === draggedMediaKey);
    if (!media) return;
    const matchesTrack =
      (targetType === "sfx" && media.type === "audio")
      || (targetType === "music" && media.type === "audio")
      || (targetType === "image" && media.type === "image")
      || (targetType === "video" && media.type === "video");
    if (!matchesTrack) return;
    if (targetType === "music") {
      setSelectedMediaKey(draggedMediaKey);
      useAudioMediaAsMusic(media);
      return;
    }
    const targetTime = clientXToTimelineTime(event.clientX) ?? currentTime;
    seekTimeline(targetTime);
    setSelectedMediaKey(draggedMediaKey);
    addMediaToTimeline(media, targetTime);
  };
  const allowAssetDropOnTrack = (event) => {
    if (!event.dataTransfer?.types?.includes("application/x-travella-media")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const isTrackCompatibleWithDraggedAsset = (targetType) => {
    if (!draggedAssetType) return false;
    return (targetType === "sfx" && draggedAssetType === "audio")
      || (targetType === "music" && draggedAssetType === "audio")
      || (targetType === "image" && draggedAssetType === "image")
      || (targetType === "video" && draggedAssetType === "video");
  };
  const isTrackBlockedForDraggedAsset = (targetType) => Boolean(draggedAssetType) && !isTrackCompatibleWithDraggedAsset(targetType);
  const clientXToTimelineTime = (clientX) => {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect?.width) return null;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(ratio * duration * 10) / 10;
  };
  const seekTimelineFromTrackClick = (event) => {
    if (event.target?.closest?.("[data-timeline-clip='true']")) return;
    const targetTime = clientXToTimelineTime(event.clientX);
    if (targetTime === null) return;
    seekTimeline(targetTime);
  };
  const moveEffectToClientXWithOffset = (index, clientX, grabOffset = 0) => {
    const pointerTime = clientXToTimelineTime(clientX);
    const source = effects[index];
    if (pointerTime === null || !source) return;
    const clipDuration = Number(source.duration || getSoundPreset(source.assetId).tone?.duration || 0.3);
    const rawTarget = Math.max(0, Math.min(duration - Math.max(0.1, clipDuration), pointerTime - grabOffset));
    const snappedTarget = snapTimelineTime(rawTarget, [getClipKey("sfx", index)], 0.25, { showGuide: true });
    updateEffect(index, { time: clampClipStartForType("sfx", source, snappedTarget) });
  };
  const resizeEffectToClientX = (index, edge, clientX) => {
    const rect = timelineRef.current?.getBoundingClientRect();
    const source = effects[index];
    if (!rect?.width || !source) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const rawPointerTime = Math.round(ratio * duration * 10) / 10;
    const pointerTime = snapTimelineTime(rawPointerTime, [getClipKey("sfx", index)], 0.25, { showGuide: true });
    const start = Number(source.time || 0);
    const clipDuration = Number(source.duration || getSoundPreset(source.assetId).tone?.duration || 0.3);
    const end = start + Math.max(0.1, clipDuration);
    if (edge === "left") {
      const nextStart = Math.max(0, Math.min(end - 0.1, pointerTime));
      updateEffect(index, {
        time: Math.round(nextStart * 10) / 10,
        duration: Math.round((end - nextStart) * 10) / 10,
      });
      return;
    }
    const nextEnd = Math.max(start + 0.1, Math.min(duration, pointerTime));
    updateEffect(index, { duration: Math.round((nextEnd - start) * 10) / 10 });
  };
  const moveOverlayToClientXWithOffset = (type, index, clientX, grabOffset = 0) => {
    const pointerTime = clientXToTimelineTime(clientX);
    const source = getOverlayItems(type)[index];
    if (pointerTime === null || !source) return;
    const fallbackDuration = type === "video" ? 5 : type === "image" ? 4 : 3;
    const clipDuration = Number(source.duration || fallbackDuration);
    const rawTarget = Math.max(0, Math.min(duration - Math.max(0.1, clipDuration), pointerTime - grabOffset));
    const snappedTarget = snapTimelineTime(rawTarget, [getClipKey(type, index)], 0.25, { showGuide: true });
    updateOverlay(type, index, { time: clampClipStartForType(type, source, snappedTarget) });
  };
  const resizeOverlayToClientX = (type, index, edge, clientX) => {
    const rect = timelineRef.current?.getBoundingClientRect();
    const source = getOverlayItems(type)[index];
    if (!rect?.width || !source) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const rawPointerTime = Math.round(ratio * duration * 10) / 10;
    const pointerTime = snapTimelineTime(rawPointerTime, [getClipKey(type, index)], 0.25, { showGuide: true });
    const start = Number(source.time || 0);
    const clipDuration = Number(source.duration || (type === "video" ? 5 : type === "image" ? 4 : 3));
    const end = start + Math.max(0.1, clipDuration);
    if (edge === "left") {
      const nextStart = Math.max(0, Math.min(end - 0.2, pointerTime));
      const delta = nextStart - start;
      const nextSourceStart = type === "video" ? Math.max(0, Math.round((Number(source.sourceStart || 0) + delta) * 10) / 10) : 0;
      const sourceLimit = type === "video" ? getVideoSourceRemaining({ ...source, sourceStart: nextSourceStart }) : Infinity;
      const nextDuration = Math.min(Math.round((end - nextStart) * 10) / 10, sourceLimit);
      updateOverlay(type, index, {
        time: Math.round(nextStart * 10) / 10,
        duration: Math.max(0.1, nextDuration),
        ...(type === "video" ? { sourceStart: nextSourceStart } : {}),
      });
      return;
    }
    const sourceLimit = type === "video" ? getVideoSourceRemaining(source) : Infinity;
    const maxEnd = Math.min(duration, start + sourceLimit);
    const nextEnd = Math.max(start + 0.2, Math.min(maxEnd, pointerTime));
    updateOverlay(type, index, { duration: Math.round((nextEnd - start) * 10) / 10 });
  };
  const startDragSelectedGroup = (event, type, index) => {
    const clickedKey = getClipKey(type, index);
    if (selectedClipKeys.length <= 1 || !selectedClipKeys.includes(clickedKey)) return false;
    const pointerTime = clientXToTimelineTime(event.clientX);
    const dragItems = selectedClipItems.map((clip) => {
      const start = Number(clip.item.time || 0);
      return {
        ...clip,
        start,
        duration: getClipDurationForType(clip.type, clip.item),
      };
    });
    const clicked = dragItems.find((clip) => clip.key === clickedKey);
    if (pointerTime === null || !clicked) return false;
    event.stopPropagation();
    setSelectedClip({ type, index });
    if (type === "sfx") setSelectedIndex(index);
    const groupStart = Math.min(...dragItems.map((clip) => clip.start));
    const groupEnd = Math.max(...dragItems.map((clip) => clip.start + clip.duration));
    const grabOffset = Math.max(0, pointerTime - clicked.start);
    const initialByKey = new Map(dragItems.map((clip) => [clip.key, clip.start]));
    const moveGroup = (clientX) => {
      const nextPointerTime = clientXToTimelineTime(clientX);
      if (nextPointerTime === null) return;
      const requestedDelta = Math.round((nextPointerTime - grabOffset - clicked.start) * 10) / 10;
      const rawDelta = Math.max(-groupStart, Math.min(duration - groupEnd, requestedDelta));
      const snappedGroupStart = snapTimelineTime(groupStart + rawDelta, selectedClipKeys, 0.25, { showGuide: true });
      const boundedDelta = Math.max(-groupStart, Math.min(duration - groupEnd, roundTimelineTime(snappedGroupStart - groupStart)));
      const moveItems = (items, itemType) => (Array.isArray(items) ? items : []).map((item, itemIndex) => {
        const key = getClipKey(itemType, itemIndex);
        if (!initialByKey.has(key)) return item;
        return { ...item, time: Math.round((initialByKey.get(key) + boundedDelta) * 10) / 10 };
      });
      setDraft((prev) => {
        const base = prev || {};
        return {
          ...base,
          effects: moveItems(base.effects, "sfx"),
          textOverlays: moveItems(base.textOverlays, "text"),
          imageOverlays: moveItems(base.imageOverlays, "image"),
          videoClips: moveItems(base.videoClips, "video"),
        };
      });
    };
    const handleMove = (moveEvent) => moveGroup(moveEvent.clientX);
    const handleUp = () => {
      setSnapGuideTime(null);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
    return true;
  };
  const startDragEffect = (event, index) => {
    event.preventDefault();
    if (event.shiftKey) {
      event.stopPropagation();
      toggleClipSelection("sfx", index);
      return;
    }
    if (startDragSelectedGroup(event, "sfx", index)) return;
    selectSingleClip("sfx", index);
    const source = effects[index];
    const pointerTime = clientXToTimelineTime(event.clientX);
    const grabOffset = source && pointerTime !== null ? Math.max(0, pointerTime - Number(source.time || 0)) : 0;
    const handleMove = (moveEvent) => moveEffectToClientXWithOffset(index, moveEvent.clientX, grabOffset);
    const handleUp = () => {
      setSnapGuideTime(null);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  };
  const startResizeEffect = (event, index, edge) => {
    event.preventDefault();
    event.stopPropagation();
    selectSingleClip("sfx", index);
    resizeEffectToClientX(index, edge, event.clientX);
    const handleMove = (moveEvent) => resizeEffectToClientX(index, edge, moveEvent.clientX);
    const handleUp = () => {
      setSnapGuideTime(null);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  };
  const startDragOverlay = (event, type, index) => {
    event.preventDefault();
    if (event.shiftKey) {
      event.stopPropagation();
      toggleClipSelection(type, index);
      return;
    }
    if (startDragSelectedGroup(event, type, index)) return;
    selectSingleClip(type, index);
    const source = getOverlayItems(type)[index];
    const pointerTime = clientXToTimelineTime(event.clientX);
    const grabOffset = source && pointerTime !== null ? Math.max(0, pointerTime - Number(source.time || 0)) : 0;
    const handleMove = (moveEvent) => moveOverlayToClientXWithOffset(type, index, moveEvent.clientX, grabOffset);
    const handleUp = () => {
      setSnapGuideTime(null);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  };
  const startResizeOverlay = (event, type, index, edge) => {
    event.preventDefault();
    event.stopPropagation();
    selectSingleClip(type, index);
    resizeOverlayToClientX(type, index, edge, event.clientX);
    const handleMove = (moveEvent) => resizeOverlayToClientX(type, index, edge, moveEvent.clientX);
    const handleUp = () => {
      setSnapGuideTime(null);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  };
  const startDragPreviewGroup = (event, type, index) => {
    const clickedKey = getClipKey(type, index);
    const overlayItems = selectedClipItems
      .filter((clip) => clip.type === "text" || clip.type === "image" || clip.type === "video")
      .map((clip) => ({
        ...clip,
        x: Number(clip.item.x ?? 50),
        y: Number(clip.item.y ?? (clip.type === "text" ? 78 : clip.type === "video" ? 50 : 72)),
      }));
    if (overlayItems.length <= 1 || !selectedClipKeys.includes(clickedKey)) return false;
    const rect = previewFrameRef.current?.getBoundingClientRect();
    const clicked = overlayItems.find((clip) => clip.key === clickedKey);
    if (!rect?.width || !rect?.height || !clicked) return false;
    const pointerX = ((event.clientX - rect.left) / rect.width) * 100;
    const pointerY = ((event.clientY - rect.top) / rect.height) * 100;
    const grabOffsetX = pointerX - clicked.x;
    const grabOffsetY = pointerY - clicked.y;
    const minX = Math.min(...overlayItems.map((clip) => clip.x));
    const maxX = Math.max(...overlayItems.map((clip) => clip.x));
    const minY = Math.min(...overlayItems.map((clip) => clip.y));
    const maxY = Math.max(...overlayItems.map((clip) => clip.y));
    const initialByKey = new Map(overlayItems.map((clip) => [clip.key, { x: clip.x, y: clip.y }]));
    setSelectedClip({ type, index });
    const moveGroup = (clientX, clientY) => {
      const nextRect = previewFrameRef.current?.getBoundingClientRect();
      if (!nextRect?.width || !nextRect?.height) return;
      const nextX = ((clientX - nextRect.left) / nextRect.width) * 100;
      const nextY = ((clientY - nextRect.top) / nextRect.height) * 100;
      const requestedDx = nextX - grabOffsetX - clicked.x;
      const requestedDy = nextY - grabOffsetY - clicked.y;
      const boundedDx = Math.max(-minX, Math.min(100 - maxX, requestedDx));
      const boundedDy = Math.max(-minY, Math.min(100 - maxY, requestedDy));
      const moveItems = (items, itemType) => (Array.isArray(items) ? items : []).map((item, itemIndex) => {
        const key = getClipKey(itemType, itemIndex);
        const initial = initialByKey.get(key);
        if (!initial) return item;
        return {
          ...item,
          x: Math.round(initial.x + boundedDx),
          y: Math.round(initial.y + boundedDy),
        };
      });
      setDraft((prev) => {
        const base = prev || {};
        return {
          ...base,
          textOverlays: moveItems(base.textOverlays, "text"),
          imageOverlays: moveItems(base.imageOverlays, "image"),
          videoClips: moveItems(base.videoClips, "video"),
        };
      });
    };
    const handleMove = (moveEvent) => moveGroup(moveEvent.clientX, moveEvent.clientY);
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
    return true;
  };
  const startDragOverlayOnPreview = (event, type, index) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) {
      toggleClipSelection(type, index);
      return;
    }
    if (startDragPreviewGroup(event, type, index)) return;
    selectSingleClip(type, index);
    const moveTo = (clientX, clientY) => {
      const rect = previewFrameRef.current?.getBoundingClientRect();
      if (!rect?.width || !rect?.height) return;
      const x = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
      const y = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));
      updateOverlay(type, index, { x: Math.round(x), y: Math.round(y) });
    };
    moveTo(event.clientX, event.clientY);
    const handleMove = (moveEvent) => moveTo(moveEvent.clientX, moveEvent.clientY);
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  };
  const startScaleOverlayOnPreview = (event, type, index) => {
    event.preventDefault();
    event.stopPropagation();
    selectSingleClip(type, index);
    const rect = previewFrameRef.current?.getBoundingClientRect();
    const item = getOverlayItems(type)[index];
    if (!rect?.width || !rect?.height || !item) return;
    const centerX = rect.left + (Number(item.x ?? 50) / 100) * rect.width;
    const centerY = rect.top + (Number(item.y ?? 50) / 100) * rect.height;
    const startDistance = Math.max(12, Math.hypot(event.clientX - centerX, event.clientY - centerY));
    const baseScale = Number(item.scale || 1);
    const resizeTo = (clientX, clientY) => {
      const distance = Math.max(12, Math.hypot(clientX - centerX, clientY - centerY));
      const nextScale = Math.max(0.35, Math.min(3, baseScale * (distance / startDistance)));
      updateOverlay(type, index, { scale: Math.round(nextScale * 100) / 100 });
    };
    const handleMove = (moveEvent) => resizeTo(moveEvent.clientX, moveEvent.clientY);
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  };
  if (!job?.id) return null;
  return (
    <div className="mt-3 rounded-2xl bg-indigo-50 p-4 ring-1 ring-indigo-100">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-indigo-700">Sound Director</div>
          <div className="mt-1 text-sm font-black text-slate-950">Sound Studio перед финальной склейкой</div>
          <div className="mt-1 text-xs font-bold text-slate-500">Включай, убирай и слушай SFX-план до кнопки “Свести звук”.</div>
        </div>
        <button
          type="button"
          onClick={() => onSave?.(job, null)}
          disabled={busy}
          className="rounded-2xl bg-indigo-700 px-4 py-2 text-xs font-black text-white hover:bg-indigo-800 disabled:opacity-40"
        >
          {busy ? "Готовлю..." : plan ? "Пересобрать AI plan" : "Создать AI sound plan"}
        </button>
      </div>
      {plan ? (
        <>
        <div className="mt-4 rounded-2xl bg-white p-3 ring-1 ring-indigo-100">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="grid gap-2 text-xs font-black text-slate-700 sm:grid-cols-5">
              <div className="rounded-xl bg-slate-50 px-3 py-2"><span className="block text-[10px] uppercase text-slate-400">Видео</span>{videoClips.length ? `${videoClips.length} клип.` : previewUrl ? "есть" : "нет"}</div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><span className="block text-[10px] uppercase text-slate-400">Музыка</span>{plan.music?.label || "Музыка"}</div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><span className="block text-[10px] uppercase text-slate-400">SFX</span>{enabledEffects.length}</div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><span className="block text-[10px] uppercase text-slate-400">Текст</span>{textOverlays.length}</div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><span className="block text-[10px] uppercase text-slate-400">Картинки</span>{imageOverlays.length}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setEditorOpen(true)} className="rounded-2xl bg-slate-950 px-4 py-2 text-xs font-black text-white hover:bg-slate-800">Открыть редактор</button>
              {renderedUrl ? (
                <a href={renderedUrl} target="_blank" rel="noreferrer" className="rounded-2xl bg-emerald-700 px-4 py-2 text-xs font-black text-white hover:bg-emerald-800">MP4 со звуком</a>
              ) : null}
              <button type="button" onClick={() => onRender?.(job)} disabled={busy || rendering} className="rounded-2xl bg-indigo-700 px-4 py-2 text-xs font-black text-white hover:bg-indigo-800 disabled:opacity-40">
                {rendering ? "Свожу..." : renderedUrl ? "Пересвести" : "Свести"}
              </button>
            </div>
          </div>
        </div>
        {editorOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-950/70 p-3 backdrop-blur-sm md:p-6">
          <div
            className={cn("relative mx-auto flex h-full max-w-[96vw] flex-col overflow-hidden rounded-3xl bg-slate-50 shadow-2xl ring-1 ring-white/20", mediaDragActive && "ring-4 ring-emerald-400")}
            onDragEnter={(event) => {
              event.preventDefault();
              if (event.dataTransfer?.types?.includes("Files")) setMediaDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setMediaDragActive(false);
            }}
            onDrop={handleMediaDrop}
          >
            {mediaDragActive ? (
              <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-3xl border-2 border-dashed border-emerald-400 bg-emerald-500/10 backdrop-blur-[2px]">
                <div className="rounded-3xl bg-white px-6 py-4 text-center shadow-xl ring-1 ring-emerald-100">
                  <div className="text-sm font-black text-emerald-700">Отпусти файлы здесь</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">Картинки, видео и звук добавятся в медиатеку и на текущий курсор.</div>
                </div>
              </div>
            ) : null}
            <div className="flex flex-col gap-3 border-b border-slate-200 bg-white p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-xs font-black uppercase tracking-wide text-indigo-700">Travella Timeline Studio</div>
                <div className="mt-1 text-xl font-black text-slate-950">Редактор видео перед финальной склейкой</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={undoTimeline} disabled={!canUndo || busy || rendering} className="rounded-2xl bg-white px-4 py-2 text-xs font-black text-slate-950 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-40">Отменить</button>
                <button type="button" onClick={redoTimeline} disabled={!canRedo || busy || rendering} className="rounded-2xl bg-white px-4 py-2 text-xs font-black text-slate-950 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-40">Повторить</button>
                <button type="button" onClick={() => onSave?.(job, draft)} disabled={busy || rendering} className="rounded-2xl bg-white px-4 py-2 text-xs font-black text-slate-950 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-40">{busy ? "Сохраняю..." : "Сохранить"}</button>
                <button type="button" onClick={() => onRender?.(job)} disabled={busy || rendering} className="rounded-2xl bg-slate-950 px-4 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-40">{rendering ? "Свожу..." : renderedUrl ? "Пересвести звук" : "Свести звук"}</button>
                <button type="button" onClick={() => { pausePreviewPlayback(); setEditorOpen(false); }} className="rounded-2xl bg-rose-50 px-4 py-2 text-xs font-black text-rose-700 ring-1 ring-rose-100 hover:bg-rose-100">Закрыть</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 md:p-4">
              <div className="mb-2 grid gap-1.5 text-[11px] font-black text-slate-600 sm:grid-cols-3 lg:grid-cols-6">
                <div className="rounded-xl bg-white px-2.5 py-1.5 ring-1 ring-slate-200">Видео <span className="ml-1 text-slate-400">{videoClips.length ? `${videoClips.length} клип.` : previewUrl ? "готово" : "нет"}</span></div>
                <div className="rounded-xl bg-white px-2.5 py-1.5 ring-1 ring-slate-200">Длина <span className="ml-1 text-slate-400">{Math.round(duration)}s</span></div>
                <div className="rounded-xl bg-white px-2.5 py-1.5 ring-1 ring-slate-200">SFX <span className="ml-1 text-slate-400">{enabledEffects.length}</span></div>
                <div className="rounded-xl bg-white px-2.5 py-1.5 ring-1 ring-slate-200">Текст <span className="ml-1 text-slate-400">{textOverlays.length}</span></div>
                <div className="rounded-xl bg-white px-2.5 py-1.5 ring-1 ring-slate-200">Картинки <span className="ml-1 text-slate-400">{imageOverlays.length}</span></div>
                <div className="rounded-xl bg-amber-50 px-2.5 py-1.5 text-amber-800 ring-1 ring-amber-100">План обрезки</div>
              </div>
              <div className="mb-3 grid items-start gap-3 xl:grid-cols-[320px_minmax(360px,1fr)_320px]">
                <div className="rounded-2xl bg-slate-950 p-3 text-white xl:order-2">
                  <div className="text-xs font-black uppercase tracking-wide text-slate-400">Превью</div>
                  {previewUrl ? (
                    <div ref={previewFrameRef} className="relative mt-2 flex justify-center overflow-hidden rounded-xl bg-black">
                      <video
                        ref={previewVideoRef}
                        src={previewUrl}
                        controls
                        onLoadedMetadata={(event) => syncTimelineFromPreview(Math.min(currentTime, event.currentTarget.duration || currentTime))}
                        onTimeUpdate={(event) => syncTimelineFromPreview(event.currentTarget.currentTime)}
                        onSeeked={(event) => {
                          syncTimelineFromPreview(event.currentTarget.currentTime);
                          if (!event.currentTarget.paused) scheduleTimelineSfxFrom(event.currentTarget.currentTime);
                        }}
                        onPlay={(event) => {
                          if (!playbackTimersRef.current.length) scheduleTimelineSfxFrom(event.currentTarget.currentTime);
                          setIsPreviewPlaying(true);
                        }}
                        onPause={() => {
                          clearTimelinePlaybackAudio();
                          setIsPreviewPlaying(false);
                        }}
                        onEnded={() => {
                          clearTimelinePlaybackAudio();
                          setIsPreviewPlaying(false);
                        }}
                        className="aspect-[9/16] max-h-[520px] w-full bg-black object-contain"
                      />
                      {textOverlays.map((item, index) => {
                        if (item.enabled === false || !isOverlayVisibleAtTime(item)) return null;
                        const textStyle = {
                          left: `${Number(item.x ?? 50)}%`,
                          top: `${Number(item.y ?? 78)}%`,
                          fontSize: `${Number(item.fontSize || 22) * Number(item.scale || 1)}px`,
                          maxWidth: "80%",
                          opacity: Number(item.opacity ?? 1),
                          zIndex: getOverlayLayer("text", item, index),
                        };
                        if (editingTextIndex === index) {
                          return (
                            <textarea
                              key={`preview_text_edit_${item.id || index}`}
                              autoFocus
                              value={item.text || ""}
                              onChange={(event) => updateOverlay("text", index, { text: event.target.value })}
                              onBlur={() => setEditingTextIndex(null)}
                              onKeyDown={(event) => {
                                if (event.key === "Escape" || (event.key === "Enter" && (event.ctrlKey || event.metaKey))) {
                                  event.preventDefault();
                                  setEditingTextIndex(null);
                                }
                              }}
                              onPointerDown={(event) => event.stopPropagation()}
                              className="absolute min-h-16 w-[78%] -translate-x-1/2 -translate-y-1/2 resize-none rounded-xl bg-white/95 px-3 py-2 text-center font-black text-slate-950 shadow-2xl outline-none ring-2 ring-indigo-500"
                              style={textStyle}
                            />
                          );
                        }
                        return (
                          <div
                            key={`preview_text_${item.id || index}`}
                            role="button"
                            tabIndex={0}
                            onPointerDown={(event) => startDragOverlayOnPreview(event, "text", index)}
                            onDoubleClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              selectSingleClip("text", index);
                              setEditingTextIndex(index);
                            }}
                            className={cn("absolute -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-lg bg-black/70 px-2 py-1 text-center font-black text-white ring-2 ring-transparent active:cursor-grabbing", ((selectedClip.type === "text" && selectedClip.index === index) || isClipMultiSelected("text", index)) && "ring-white")}
                            style={textStyle}
                            title="Перетащи текст. Двойной клик — редактировать."
                          >
                            {item.text || item.label || "Текст"}
                            <span
                              onPointerDown={(event) => startScaleOverlayOnPreview(event, "text", index)}
                              className={cn(
                                "absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-full bg-white shadow ring-2 ring-slate-950/20",
                                selectedClip.type === "text" && selectedClip.index === index ? "block" : "hidden"
                              )}
                              title="Изменить размер текста"
                            />
                          </div>
                        );
                      })}
                      {imageOverlays.map((item, index) => item.enabled === false || !isOverlayVisibleAtTime(item) ? null : (
                        <button
                          key={`preview_image_${item.id || index}`}
                          type="button"
                          onPointerDown={(event) => startDragOverlayOnPreview(event, "image", index)}
                          className={cn("absolute -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-xl bg-fuchsia-500/90 px-3 py-2 text-xs font-black text-white ring-2 ring-transparent active:cursor-grabbing", ((selectedClip.type === "image" && selectedClip.index === index) || isClipMultiSelected("image", index)) && "ring-white")}
                          style={{
                            left: `${Number(item.x ?? 50)}%`,
                            top: `${Number(item.y ?? 72)}%`,
                            width: `${Number(item.width || 34) * Number(item.scale || 1)}%`,
                            opacity: Number(item.opacity ?? 1),
                            transform: `translate(-50%, -50%) rotate(${Number(item.rotation || 0)}deg)`,
                            zIndex: getOverlayLayer("image", item, index),
                          }}
                        >
                          {item.url ? <img src={item.url} alt={item.label || "Оверлей"} className="h-full w-full rounded-lg object-contain" /> : (item.label || "Стикер")}
                          <span
                            onPointerDown={(event) => startScaleOverlayOnPreview(event, "image", index)}
                            className={cn(
                              "absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-full bg-white shadow ring-2 ring-slate-950/20",
                              selectedClip.type === "image" && selectedClip.index === index ? "block" : "hidden"
                            )}
                            title="Изменить размер картинки"
                          />
                        </button>
                      ))}
                      {videoClips.map((item, index) => item.enabled === false || !isOverlayVisibleAtTime(item) ? null : (
                        <button
                          key={`preview_video_${item.id || index}`}
                          type="button"
                          onPointerDown={(event) => startDragOverlayOnPreview(event, "video", index)}
                          className={cn(
                            "absolute -translate-x-1/2 -translate-y-1/2 cursor-grab overflow-hidden rounded-xl bg-black/70 shadow-2xl ring-2 ring-transparent active:cursor-grabbing",
                            ((selectedClip.type === "video" && selectedClip.index === index) || isClipMultiSelected("video", index)) && "ring-white"
                          )}
                          style={{
                            left: `${Number(item.x ?? 50)}%`,
                            top: `${Number(item.y ?? 50)}%`,
                            width: `${Number(item.width || 72) * Number(item.scale || 1)}%`,
                            opacity: Number(item.opacity ?? 1),
                            transform: `translate(-50%, -50%) rotate(${Number(item.rotation || 0)}deg)`,
                            zIndex: getOverlayLayer("video", item, index),
                          }}
                          title="Перетащи видео-вставку. Потяни маркер — изменить размер."
                        >
                          <video src={`${item.url}#t=${Math.max(0, Number(item.sourceStart || 0))}`} muted autoPlay loop playsInline className="pointer-events-none h-full w-full object-cover" />
                          <span className="pointer-events-none absolute left-2 top-2 rounded-lg bg-black/70 px-2 py-1 text-[10px] font-black text-white">{item.label || "Видео-вставка"}</span>
                          <span
                            onPointerDown={(event) => startScaleOverlayOnPreview(event, "video", index)}
                            className={cn(
                              "absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-full bg-white shadow ring-2 ring-slate-950/20",
                              selectedClip.type === "video" && selectedClip.index === index ? "block" : "hidden"
                            )}
                            title="Изменить размер видео"
                          />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 flex aspect-[9/16] min-h-[420px] items-center justify-center rounded-xl bg-slate-900 text-xs font-black text-slate-500">Видео появится после HeyGen</div>
                  )}
                </div>
                <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200 xl:order-3">
                  <div className="text-xs font-black uppercase tracking-wide text-slate-400">Монтаж</div>
                  <div className="mt-2 grid gap-2 md:grid-cols-4">
                    <label className="rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-100">
                      <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Начало обрезки</span>
                      <input type="number" min="0" step="0.1" value={Number(trim.start || 0)} onChange={(e) => updateTrim({ start: Number(e.target.value) })} className="mt-1 w-full bg-transparent text-xs font-black text-slate-950 outline-none" />
                    </label>
                    <label className="rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-100">
                      <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Конец обрезки</span>
                      <input type="number" min="0" step="0.1" value={Number(trim.end || 0)} onChange={(e) => updateTrim({ end: Number(e.target.value) })} className="mt-1 w-full bg-transparent text-xs font-black text-slate-950 outline-none" />
                    </label>
                    <div className="rounded-xl bg-slate-50 p-2.5 text-xs font-black text-slate-950 ring-1 ring-slate-100"><span className="block text-[10px] uppercase tracking-wide text-slate-400">Длительность</span>{Math.max(0, Math.round((duration - Number(trim.start || 0) - Number(trim.end || 0)) * 10) / 10)} сек</div>
                    <div className="rounded-xl bg-amber-50 p-2.5 text-xs font-bold text-amber-800 ring-1 ring-amber-100">Обрезка сохранится в плане для FFmpeg-рендера.</div>
                  </div>
                </div>
                <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200 xl:order-1">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-black uppercase tracking-wide text-slate-400">Медиатека</div>
                      <div className="mt-1 text-xs font-bold text-slate-500">
                        Файлы задачи: {mediaLibrary.length} · на таймлайне {mediaLibraryUsedCount}
                      </div>
                    </div>
                    <button type="button" onClick={() => mediaInputRef.current?.click()} disabled={mediaImporting} className="rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-500 disabled:opacity-40">{mediaImporting ? "Импорт..." : "+ файл"}</button>
                  </div>
                  <button
                    type="button"
                    onClick={() => mediaInputRef.current?.click()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        mediaInputRef.current?.click();
                      }
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
                      setMediaDragActive(true);
                    }}
                    onDragLeave={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setMediaDragActive(false);
                    }}
                    onDrop={handleMediaDrop}
                    disabled={mediaImporting}
                    className={cn(
                      "mt-3 w-full rounded-2xl border border-dashed px-3 py-3 text-left transition disabled:opacity-50",
                      mediaDragActive
                        ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-100"
                        : "border-slate-200 bg-slate-50 hover:border-emerald-300 hover:bg-emerald-50/70"
                    )}
                  >
                    <div className="text-xs font-black text-slate-950">
                      {mediaImporting ? "Импортирую файл..." : "Перетащи файлы сюда или нажми для импорта"}
                    </div>
                    <div className="mt-1 text-[10px] font-bold text-slate-500">
                      Картинки, видео и звук попадут в медиатеку. Потом перетащи карточку на дорожку Video, SFX, Text или Images.
                    </div>
                  </button>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {[
                      ["all", "Все", mediaLibrary.length],
                      ["image", "Картинки", mediaLibrary.filter((media) => media.type === "image").length],
                      ["audio", "Аудио", mediaLibrary.filter((media) => media.type === "audio").length],
                      ["video", "Видео", mediaLibrary.filter((media) => media.type === "video").length],
                    ].map(([key, label, count]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setAssetBinFilter(key)}
                        className={cn(
                          "rounded-full px-2 py-1 text-[10px] font-black ring-1",
                          assetBinFilter === key
                            ? "bg-slate-950 text-white ring-slate-950"
                            : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
                        )}
                      >
                        {label} {count}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 grid gap-2 text-[10px] font-black text-slate-600 sm:grid-cols-2">
                    <div className="rounded-2xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                      Выбрано: {selectedMedia ? (selectedMedia.label || selectedMedia.originalName || "Медиа") : "нет"}
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                      Показано: {filteredMediaLibrary.length ? Math.min(filteredMediaLibrary.length, 10) : 0} / {filteredMediaLibrary.length}
                    </div>
                  </div>
                  <input
                    value={assetBinQuery}
                    onChange={(event) => setAssetBinQuery(event.target.value)}
                    placeholder="Найти файл..."
                    className="mt-3 w-full rounded-2xl bg-slate-50 px-3 py-2 text-xs font-black text-slate-950 outline-none ring-1 ring-slate-200 placeholder:text-slate-400 focus:ring-indigo-200"
                  />
                  <div className="mt-2 flex rounded-2xl bg-slate-50 p-1 ring-1 ring-slate-200">
                    {[
                      ["recent", "Новые"],
                      ["name", "Имя"],
                      ["type", "Тип"],
                    ].map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setAssetBinSort(key)}
                        className={cn(
                          "flex-1 rounded-xl px-2 py-1.5 text-[10px] font-black transition",
                          assetBinSort === key
                            ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200"
                            : "text-slate-500 hover:bg-white hover:text-slate-950"
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {filteredMediaLibrary.length > 10 ? (
                    <div className="mt-2 rounded-2xl bg-amber-50 px-3 py-2 text-[10px] font-black text-amber-700 ring-1 ring-amber-100">
                      Показаны первые 10 файлов. Используй поиск, фильтр или сортировку, чтобы быстро найти нужный asset.
                    </div>
                  ) : null}
                  <div className="mt-3 max-h-[260px] space-y-2 overflow-y-auto pr-1">
                    {filteredMediaLibrary.length ? filteredMediaLibrary.slice(0, 10).map((media) => {
                      const mediaKey = getMediaKey(media);
                      const previewOpen = previewMediaKey === mediaKey;
                      const mediaSelected = selectedMediaKey === mediaKey;
                      const usageLabels = getMediaTimelineUsage(media);
                      const mediaPlaced = usageLabels.length > 0;
                      const canReplaceWithThisMedia = canReplaceSelectedClipWithMedia(media);
                      return (
                        <div
                          key={`compact_${mediaKey}`}
                          role="button"
                          tabIndex={0}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData("application/x-travella-media", mediaKey);
                            event.dataTransfer.effectAllowed = "copy";
                            setSelectedMediaKey(mediaKey);
                            setDraggedAssetType(media.type || "");
                          }}
                          onDragEnd={() => setDraggedAssetType("")}
                          onClick={() => setSelectedMediaKey(mediaKey)}
                          className={cn(
                            "grid cursor-pointer grid-cols-[44px_1fr] gap-2 rounded-2xl bg-slate-50 p-2 ring-1 ring-slate-100 transition hover:bg-slate-100",
                            mediaSelected && "bg-emerald-50 ring-2 ring-emerald-300"
                          )}
                          title="Перетащи файл на нужную дорожку таймлайна."
                        >
                          {media.type === "image" ? (
                            <img src={media.thumbnailUrl || media.url} alt="" className="h-11 w-11 rounded-xl object-cover ring-1 ring-slate-200" />
                          ) : (
                            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-950 text-[10px] font-black uppercase text-white">{formatTimelineMediaType(media.type || "file")}</div>
                          )}
                          <div className="min-w-0">
                            <div className="truncate text-xs font-black text-slate-950">{media.label || media.originalName || "Медиа"}</div>
                            <div className="mt-0.5 truncate text-[10px] font-bold text-slate-500">{formatTimelineMediaType(media.type)} · {media.mimeType || "медиа"}</div>
                            <div className={cn("mt-0.5 truncate text-[10px] font-bold", mediaPlaced ? "text-emerald-700" : "text-slate-500")}>
                              {mediaPlaced ? `На дорожке: ${usageLabels.join(", ")}` : "Перетащи на таймлайн"}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              <button type="button" onClick={(event) => { event.stopPropagation(); addMediaToTimeline(media, 0); }} className="rounded-lg bg-white px-2 py-1 text-[9px] font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">В начало</button>
                              <button type="button" onClick={(event) => { event.stopPropagation(); addMediaToTimeline(media); }} className="rounded-lg bg-slate-950 px-2 py-1 text-[9px] font-black text-white hover:bg-slate-800">На курсор</button>
                              <button type="button" onClick={(event) => { event.stopPropagation(); addMediaToTimelineEnd(media); }} className="rounded-lg bg-white px-2 py-1 text-[9px] font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">В конец</button>
                              {media.type === "audio" ? (
                                <button type="button" onClick={(event) => { event.stopPropagation(); useAudioMediaAsMusic(media); }} className="rounded-lg bg-emerald-600 px-2 py-1 text-[9px] font-black text-white hover:bg-emerald-500">Музыка</button>
                              ) : null}
                              {canReplaceWithThisMedia ? (
                                <button type="button" onClick={(event) => { event.stopPropagation(); replaceSelectedClipWithMedia(media); }} className="rounded-lg bg-amber-400 px-2 py-1 text-[9px] font-black text-slate-950 hover:bg-amber-300">Заменить</button>
                              ) : null}
                              <button type="button" onClick={(event) => { event.stopPropagation(); toggleMediaPreview(media); }} className="rounded-lg bg-white px-2 py-1 text-[9px] font-black text-slate-950 ring-1 ring-slate-200 hover:bg-slate-50">{previewOpen ? "Скрыть" : "Превью"}</button>
                              <a href={media.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className="rounded-lg bg-white px-2 py-1 text-[9px] font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">Открыть</a>
                              <button type="button" onClick={(event) => { event.stopPropagation(); removeMediaFromLibrary(media); }} className="rounded-lg bg-rose-50 px-2 py-1 text-[9px] font-black text-rose-700 ring-1 ring-rose-100 hover:bg-rose-100">Убрать</button>
                            </div>
                          </div>
                          {previewOpen ? (
                            <div className="col-span-2 overflow-hidden rounded-xl bg-slate-950 p-1 ring-1 ring-slate-200">
                              {media.type === "image" ? <img src={media.url} alt={media.label || "Превью"} className="max-h-36 w-full rounded-lg object-contain" /> : null}
                              {media.type === "audio" ? <audio src={media.url} controls className="w-full" /> : null}
                              {media.type === "video" ? <video src={media.url} controls className="max-h-36 w-full rounded-lg bg-black object-contain" /> : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    }) : (
                      <div className="rounded-2xl bg-slate-50 px-4 py-6 text-center text-xs font-bold text-slate-500 ring-1 ring-slate-100">
                        Файлы появятся здесь после импорта.
                      </div>
                    )}
                  </div>
                  {selectedMedia ? (
                    <div className="mt-3 rounded-2xl bg-slate-950 p-3 text-white ring-1 ring-slate-900">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Выбранный файл</div>
                          <div className="mt-1 truncate text-xs font-black">{selectedMedia.label || selectedMedia.originalName || "Медиа"}</div>
                          <div className="mt-1 text-[10px] font-bold text-slate-400">{formatTimelineMediaType(selectedMedia.type || "media")} · попадёт: {selectedMediaDropTarget}</div>
                        </div>
                        <button type="button" onClick={() => setSelectedMediaKey("")} className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-black text-slate-300 hover:bg-white/15">Снять</button>
                      </div>
                      <div className="mt-2 overflow-hidden rounded-xl bg-black/60 p-1 ring-1 ring-white/10">
                        {selectedMedia.type === "image" ? <img src={selectedMedia.url} alt={selectedMedia.label || "Выбранный файл"} className="max-h-36 w-full rounded-lg object-contain" /> : null}
                        {selectedMedia.type === "audio" ? <audio src={selectedMedia.url} controls className="w-full" /> : null}
                        {selectedMedia.type === "video" ? <video src={selectedMedia.url} controls className="max-h-36 w-full rounded-lg bg-black object-contain" /> : null}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <button type="button" onClick={() => addMediaToTimeline(selectedMedia, 0)} className="rounded-lg bg-white/10 px-2 py-1 text-[9px] font-black text-white ring-1 ring-white/10 hover:bg-white/15">В начало</button>
                        <button type="button" onClick={() => addMediaToTimeline(selectedMedia)} className="rounded-lg bg-white px-2 py-1 text-[9px] font-black text-slate-950 hover:bg-slate-100">На курсор</button>
                        <button type="button" onClick={() => addMediaToTimelineEnd(selectedMedia)} className="rounded-lg bg-white/10 px-2 py-1 text-[9px] font-black text-white ring-1 ring-white/10 hover:bg-white/15">В конец</button>
                        {selectedMedia.type === "audio" ? (
                          <button type="button" onClick={() => useAudioMediaAsMusic(selectedMedia)} className="rounded-lg bg-emerald-500 px-2 py-1 text-[9px] font-black text-white hover:bg-emerald-400">Музыка</button>
                        ) : null}
                        {canReplaceSelectedClipWithMedia(selectedMedia) ? (
                          <button type="button" onClick={() => replaceSelectedClipWithMedia(selectedMedia)} className="rounded-lg bg-amber-400 px-2 py-1 text-[9px] font-black text-slate-950 hover:bg-amber-300">Заменить</button>
                        ) : null}
                        <a href={selectedMedia.url} target="_blank" rel="noreferrer" className="rounded-lg bg-white/10 px-2 py-1 text-[9px] font-black text-white ring-1 ring-white/10 hover:bg-white/15">Открыть</a>
                        <button type="button" onClick={() => removeMediaFromLibrary(selectedMedia)} className="rounded-lg bg-rose-500/15 px-2 py-1 text-[9px] font-black text-rose-100 ring-1 ring-rose-400/20 hover:bg-rose-500/25">Убрать</button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="rounded-xl bg-white p-2.5 ring-1 ring-indigo-100">
              <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Пресет</span>
              <input
                value={plan.preset || ""}
                onChange={(e) => setDraft((prev) => ({ ...(prev || {}), preset: e.target.value }))}
                className="mt-1 w-full bg-transparent text-xs font-black text-slate-950 outline-none"
              />
            </label>
            <label className="rounded-xl bg-white p-2.5 ring-1 ring-indigo-100">
              <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Музыка</span>
              <input
                value={plan.music?.label || plan.music?.assetId || ""}
                onChange={(e) => setDraft((prev) => ({ ...(prev || {}), music: { ...(prev?.music || {}), label: e.target.value } }))}
                className="mt-1 w-full bg-transparent text-xs font-black text-slate-950 outline-none"
              />
            </label>
            <label className="rounded-xl bg-white p-2.5 ring-1 ring-indigo-100">
              <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Громкость музыки</span>
              <input
                type="range"
                min="0"
                max="0.4"
                step="0.01"
                value={Number(plan.music?.volume ?? 0.12)}
                onChange={(e) => setDraft((prev) => ({ ...(prev || {}), music: { ...(prev?.music || {}), volume: Number(e.target.value) } }))}
                className="mt-2 w-full accent-indigo-600"
              />
              <span className="text-[10px] font-black text-slate-500">{Math.round(Number(plan.music?.volume ?? 0.12) * 100)}%</span>
            </label>
          </div>
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="overflow-hidden rounded-2xl bg-slate-950 text-white ring-1 ring-slate-900">
              <div className="sticky top-0 z-20 flex flex-col gap-2 border-b border-white/10 bg-slate-950/95 p-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Timeline Studio</div>
                  <div className="text-xs font-black">Видео · Голос · Музыка · SFX · Текст · Картинки · сейчас {Math.round(currentTime * 10) / 10}s / {Math.round(duration)}s{selectedClipKeys.length > 1 ? ` · выбрано ${selectedClipKeys.length}` : ""}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={togglePreviewPlayback}
                    disabled={!previewUrl}
                    className="rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-500 disabled:opacity-40"
                    title="Space — play/pause preview"
                  >
                    {isPreviewPlaying ? "Пауза" : "Play"}
                  </button>
                  <button type="button" onClick={() => playPreviewFrom(0)} disabled={!previewUrl} className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-slate-950 hover:bg-slate-100 disabled:opacity-40" title="Enter — play from start">С начала</button>
                  <button type="button" onClick={stopPreviewPlayback} disabled={!previewUrl} className="rounded-2xl bg-white/10 px-3 py-2 text-xs font-black text-white ring-1 ring-white/10 hover:bg-white/15 disabled:opacity-40">Стоп</button>
                  <button type="button" onClick={() => seekTimelineBy(-1)} className="rounded-2xl bg-white/10 px-3 py-2 text-xs font-black text-white ring-1 ring-white/10 hover:bg-white/15" title="ArrowLeft, Shift+ArrowLeft — 5 секунд">Назад 1s</button>
                  <button type="button" onClick={() => seekTimelineBy(1)} className="rounded-2xl bg-white/10 px-3 py-2 text-xs font-black text-white ring-1 ring-white/10 hover:bg-white/15" title="ArrowRight, Shift+ArrowRight — 5 секунд">Вперёд 1s</button>
                  <button type="button" onClick={playPlan} className="rounded-2xl bg-indigo-600 px-3 py-2 text-xs font-black text-white hover:bg-indigo-500">Прослушать</button>
                  <button type="button" onClick={selectAllTimelineClips} className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-slate-950 hover:bg-slate-100">Все клипы</button>
                  <button type="button" onClick={copySelectedClips} className="rounded-2xl bg-white/10 px-3 py-2 text-xs font-black text-white ring-1 ring-white/10 hover:bg-white/15">Копировать</button>
                  <button type="button" onClick={cutSelectedClips} className="rounded-2xl bg-white/10 px-3 py-2 text-xs font-black text-white ring-1 ring-white/10 hover:bg-white/15">Вырезать</button>
                  <button type="button" onClick={pasteTimelineClipboard} disabled={!timelineClipboard.length} className="rounded-2xl bg-white/10 px-3 py-2 text-xs font-black text-white ring-1 ring-white/10 hover:bg-white/15 disabled:opacity-40">Вставить{timelineClipboard.length ? ` ${timelineClipboard.length}` : ""}</button>
                  <button type="button" onClick={selectClipsAtPlayhead} className="rounded-2xl bg-white/10 px-3 py-2 text-xs font-black text-white ring-1 ring-white/10 hover:bg-white/15">Выбрать на курсоре</button>
                  <button type="button" onClick={() => selectClipsByType("sfx")} className="rounded-2xl bg-white/10 px-3 py-2 text-xs font-black text-white ring-1 ring-white/10 hover:bg-white/15">SFX</button>
                  <button type="button" onClick={() => selectClipsByType("text")} className="rounded-2xl bg-white/10 px-3 py-2 text-xs font-black text-white ring-1 ring-white/10 hover:bg-white/15">Текст</button>
                  <button type="button" onClick={() => selectClipsByType("image")} className="rounded-2xl bg-white/10 px-3 py-2 text-xs font-black text-white ring-1 ring-white/10 hover:bg-white/15">Картинки</button>
                  <button type="button" onClick={() => selectClipsByType("video")} className="rounded-2xl bg-white/10 px-3 py-2 text-xs font-black text-white ring-1 ring-white/10 hover:bg-white/15">Видео</button>
                  {selectedMedia ? (
                    <div className="flex flex-wrap items-center gap-1 rounded-2xl bg-emerald-500/10 p-1 ring-1 ring-emerald-300/20">
                      <div className="max-w-52 truncate px-2 text-[10px] font-black text-emerald-100" title={`${selectedMedia.label || selectedMedia.originalName || "Медиа"} · ${selectedMediaDropTarget}`}>
                        {formatTimelineMediaType(selectedMedia.type || "media")} · {selectedMedia.label || selectedMedia.originalName || "Медиа"}
                        <span className="ml-1 text-emerald-300/70">
                          {selectedMediaUsage.length ? `· ${selectedMediaUsage.join(", ")}` : `· ${selectedMediaDropTarget}`}
                        </span>
                      </div>
                      <span className="rounded-xl bg-slate-900/70 px-2 py-1.5 text-[10px] font-black text-slate-200 ring-1 ring-white/10">Курсор {roundTimelineTime(currentTime)}s</span>
                      <span className="rounded-xl bg-slate-900/70 px-2 py-1.5 text-[10px] font-black text-slate-200 ring-1 ring-white/10">Макс. {roundTimelineTime(selectedMediaEndTime)}s</span>
                      <button type="button" onClick={() => addMediaToTimeline(selectedMedia, 0)} className="rounded-xl bg-white/10 px-2 py-1.5 text-[10px] font-black text-white ring-1 ring-white/10 hover:bg-white/15">В начало</button>
                      <button type="button" onClick={() => addMediaToTimeline(selectedMedia)} className="rounded-xl bg-white px-2 py-1.5 text-[10px] font-black text-slate-950 hover:bg-slate-100">На курсор</button>
                      <button type="button" onClick={() => addMediaToTimeline(selectedMedia, selectedMediaEndTime)} className="rounded-xl bg-white/10 px-2 py-1.5 text-[10px] font-black text-white ring-1 ring-white/10 hover:bg-white/15">На макс.</button>
                      <button type="button" onClick={() => addMediaToTimelineEnd(selectedMedia)} className="rounded-xl bg-white/10 px-2 py-1.5 text-[10px] font-black text-white ring-1 ring-white/10 hover:bg-white/15">В конец</button>
                      {selectedMedia.type === "audio" ? (
                        <button type="button" onClick={() => useAudioMediaAsMusic(selectedMedia)} className="rounded-xl bg-emerald-500 px-2 py-1.5 text-[10px] font-black text-white hover:bg-emerald-400">В музыку</button>
                      ) : null}
                      {canReplaceSelectedClipWithMedia(selectedMedia) ? (
                        <button type="button" onClick={() => replaceSelectedClipWithMedia(selectedMedia)} className="rounded-xl bg-amber-300 px-2 py-1.5 text-[10px] font-black text-slate-950 hover:bg-amber-200">Заменить</button>
                      ) : null}
                      <button type="button" onClick={() => toggleMediaPreview(selectedMedia)} className="rounded-xl bg-white/10 px-2 py-1.5 text-[10px] font-black text-white ring-1 ring-white/10 hover:bg-white/15">
                        {previewMediaKey === getMediaKey(selectedMedia) ? "Скрыть" : "Превью"}
                      </button>
                      <a href={selectedMedia.url} target="_blank" rel="noreferrer" className="rounded-xl bg-white/10 px-2 py-1.5 text-[10px] font-black text-white ring-1 ring-white/10 hover:bg-white/15">Открыть</a>
                      <button type="button" onClick={copySelectedMediaUrl} className="rounded-xl bg-white/10 px-2 py-1.5 text-[10px] font-black text-white ring-1 ring-white/10 hover:bg-white/15">Копия URL</button>
                      {mediaToolbarNotice ? (
                        <span className="rounded-xl bg-emerald-400/15 px-2 py-1.5 text-[10px] font-black text-emerald-100 ring-1 ring-emerald-300/20">{mediaToolbarNotice}</span>
                      ) : null}
                      <button type="button" onClick={() => setSelectedMediaKey("")} className="rounded-xl bg-white/10 px-2 py-1.5 text-[10px] font-black text-slate-300 ring-1 ring-white/10 hover:bg-white/15">Снять</button>
                    </div>
                  ) : null}
                  <button type="button" onClick={() => mediaInputRef.current?.click()} disabled={mediaImporting} className="rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-500 disabled:opacity-40">{mediaImporting ? "Импорт..." : "Импорт"}</button>
                  <button type="button" onClick={() => addEffect()} className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-slate-950 hover:bg-slate-100">Добавить SFX</button>
                  <button type="button" onClick={addTextOverlay} className="rounded-2xl bg-white/10 px-3 py-2 text-xs font-black text-white ring-1 ring-white/10 hover:bg-white/15">Текст</button>
                  <button type="button" onClick={addImageOverlay} className="rounded-2xl bg-white/10 px-3 py-2 text-xs font-black text-white ring-1 ring-white/10 hover:bg-white/15">Картинка</button>
                  <div className="flex items-center gap-1 rounded-2xl bg-white/10 p-1 ring-1 ring-white/10">
                    <button type="button" onClick={() => setTimelineZoomPreset(1)} className={`rounded-xl px-2 py-1.5 text-[10px] font-black ${timelineZoom === 1 ? "bg-white text-slate-950" : "text-white hover:bg-white/10"}`}>Обзор</button>
                    <button type="button" onClick={() => setTimelineZoomPreset(1.75)} className={`rounded-xl px-2 py-1.5 text-[10px] font-black ${timelineZoom === 1.75 ? "bg-white text-slate-950" : "text-white hover:bg-white/10"}`}>1.75x</button>
                    <button type="button" onClick={() => setTimelineZoomPreset(3)} className={`rounded-xl px-2 py-1.5 text-[10px] font-black ${timelineZoom === 3 ? "bg-white text-slate-950" : "text-white hover:bg-white/10"}`}>Точно</button>
                  </div>
                  <label className="flex min-w-36 items-center gap-2 rounded-2xl bg-white/10 px-3 py-2 text-[10px] font-black text-white ring-1 ring-white/10">
                    <span>Масштаб {timelineZoom.toFixed(1)}x</span>
                    <input
                      type="range"
                      min="1"
                      max="3"
                      step="0.25"
                      value={timelineZoom}
                      onChange={(event) => setTimelineZoom(Number(event.target.value))}
                      className="w-20 accent-indigo-400"
                    />
                  </label>
                </div>
              </div>
              <input ref={mediaInputRef} type="file" accept="image/*,audio/*,video/*" multiple onChange={handleMediaInput} className="hidden" />
              {false && mediaLibrary.length ? (
                <div className="mt-3 rounded-2xl bg-slate-900 p-2 ring-1 ring-white/5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Медиатека</div>
                      <div className="text-[10px] font-bold text-slate-400">
                        Файлы этой задачи · на таймлайне {mediaLibraryUsedCount} · не добавлено {Math.max(0, mediaLibrary.length - mediaLibraryUsedCount)}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {[
                          ["all", "Все", mediaLibrary.length],
                          ["image", "Картинки", mediaLibrary.filter((media) => media.type === "image").length],
                          ["audio", "Аудио", mediaLibrary.filter((media) => media.type === "audio").length],
                          ["video", "Видео", mediaLibrary.filter((media) => media.type === "video").length],
                        ].map(([key, label, count]) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setAssetBinFilter(key)}
                            className={cn(
                              "rounded-full px-2 py-1 text-[9px] font-black ring-1",
                              assetBinFilter === key
                                ? "bg-white text-slate-950 ring-white"
                                : "bg-white/5 text-slate-300 ring-white/10 hover:bg-white/10"
                            )}
                          >
                            {label} {count}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2 sm:w-64">
                      <input
                        value={assetBinQuery}
                        onChange={(event) => setAssetBinQuery(event.target.value)}
                        placeholder="Найти файл..."
                        className="rounded-2xl bg-white/10 px-3 py-2 text-[10px] font-black text-white outline-none ring-1 ring-white/10 placeholder:text-slate-500 focus:ring-white/30"
                      />
                      <div className="flex rounded-2xl bg-white/5 p-1 ring-1 ring-white/10">
                        {[
                          ["recent", "Новые"],
                          ["name", "Имя"],
                          ["type", "Тип"],
                        ].map(([key, label]) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setAssetBinSort(key)}
                            className={cn(
                              "flex-1 rounded-xl px-2 py-1 text-[9px] font-black transition",
                              assetBinSort === key
                                ? "bg-white text-slate-950"
                                : "text-slate-400 hover:bg-white/10 hover:text-white"
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <button type="button" onClick={() => mediaInputRef.current?.click()} disabled={mediaImporting} className="rounded-2xl bg-emerald-600 px-3 py-1.5 text-[10px] font-black text-white hover:bg-emerald-500 disabled:opacity-40">{mediaImporting ? "Импорт..." : "+ файл"}</button>
                    </div>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {filteredMediaLibrary.length ? filteredMediaLibrary.slice(0, 14).map((media) => {
                      const mediaKey = getMediaKey(media);
                      const previewOpen = previewMediaKey === mediaKey;
                      const mediaSelected = selectedMediaKey === mediaKey;
                      const usageLabels = getMediaTimelineUsage(media);
                      const mediaPlaced = usageLabels.length > 0;
                      const canReplaceWithThisMedia = canReplaceSelectedClipWithMedia(media);
                      const dropTargetLabel = getMediaDropTargetLabel(media);
                      return (
                        <div
                          key={mediaKey}
                          role="button"
                          tabIndex={0}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData("application/x-travella-media", mediaKey);
                            event.dataTransfer.effectAllowed = "copy";
                            setSelectedMediaKey(mediaKey);
                            setDraggedAssetType(media.type || "");
                          }}
                          onDragEnd={() => setDraggedAssetType("")}
                          onClick={() => setSelectedMediaKey(mediaKey)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedMediaKey(mediaKey);
                            }
                          }}
                          className={cn(
                            "w-64 shrink-0 cursor-pointer rounded-2xl bg-slate-800 p-2 ring-1 ring-white/5 transition hover:bg-slate-700",
                            mediaSelected && "bg-slate-700 ring-2 ring-emerald-400/80"
                          )}
                        >
                          <div className="grid grid-cols-[44px_1fr] gap-2">
                            {media.type === "image" ? (
                              <img src={media.thumbnailUrl || media.url} alt="" className="h-11 w-11 rounded-xl object-cover ring-1 ring-white/10" />
                            ) : (
                              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-950 text-[10px] font-black uppercase text-white ring-1 ring-white/10">{formatTimelineMediaType(media.type || "file")}</div>
                            )}
                            <div className="min-w-0">
                              <div className="truncate text-[11px] font-black text-white">{media.label || media.originalName || "Медиа"}</div>
                              <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">{formatTimelineMediaType(media.type)} · {media.mimeType || "медиа"}</div>
                              <div className={cn("mt-0.5 truncate text-[9px] font-bold", mediaPlaced ? "text-emerald-300" : "text-slate-400")}>
                                {mediaPlaced ? `На таймлайне · ${usageLabels.join(", ")}` : "Перетащи на таймлайн"}
                              </div>
                              <div className="mt-0.5 truncate text-[9px] font-bold text-indigo-200">Куда попадёт: {dropTargetLabel}</div>
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {media.type === "image" ? (
                                  <button type="button" onClick={() => addMediaToTimeline(media)} className="rounded-lg bg-fuchsia-500 px-2 py-1 text-[9px] font-black text-white hover:bg-fuchsia-400">Картинка на курсор</button>
                                ) : null}
                                {media.type === "video" ? (
                                  <button type="button" onClick={() => addMediaToTimeline(media)} className="rounded-lg bg-sky-500 px-2 py-1 text-[9px] font-black text-white hover:bg-sky-400">Видео на курсор</button>
                                ) : null}
                                {media.type === "audio" ? (
                                  <>
                                    <button type="button" onClick={() => addMediaToTimeline(media)} className="rounded-lg bg-indigo-500 px-2 py-1 text-[9px] font-black text-white hover:bg-indigo-400">SFX на курсор</button>
                                    <button type="button" onClick={() => useAudioMediaAsMusic(media)} className="rounded-lg bg-emerald-500 px-2 py-1 text-[9px] font-black text-white hover:bg-emerald-400">Музыка</button>
                                  </>
                                ) : null}
                                {canReplaceWithThisMedia ? (
                                  <button type="button" onClick={() => replaceSelectedClipWithMedia(media)} className="rounded-lg bg-amber-400 px-2 py-1 text-[9px] font-black text-slate-950 hover:bg-amber-300">Заменить выбранный</button>
                                ) : null}
                                <button type="button" onClick={() => toggleMediaPreview(media)} className="rounded-lg bg-white px-2 py-1 text-[9px] font-black text-slate-950 hover:bg-slate-100">{previewOpen ? "Скрыть" : "Превью"}</button>
                                <a href={media.url} target="_blank" rel="noreferrer" className="rounded-lg bg-white/10 px-2 py-1 text-[9px] font-black text-white hover:bg-white/15">Открыть</a>
                                <button type="button" onClick={() => removeMediaFromLibrary(media)} className="rounded-lg bg-rose-500/15 px-2 py-1 text-[9px] font-black text-rose-200 ring-1 ring-rose-400/20 hover:bg-rose-500/25">Убрать</button>
                              </div>
                            </div>
                          </div>
                          {previewOpen ? (
                            <div className="mt-2 overflow-hidden rounded-xl bg-slate-950 p-1 ring-1 ring-white/10">
                              {media.type === "image" ? <img src={media.url} alt={media.label || "Превью"} className="max-h-36 w-full rounded-lg object-contain" /> : null}
                              {media.type === "audio" ? <audio src={media.url} controls className="w-full" /> : null}
                              {media.type === "video" ? <video src={media.url} controls className="max-h-36 w-full rounded-lg bg-black object-contain" /> : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    }) : (
                      <div className="flex min-h-24 min-w-64 items-center justify-center rounded-2xl bg-slate-800 px-4 text-center text-xs font-bold text-slate-400 ring-1 ring-white/5">
                        Ничего не найдено в медиатеке.
                      </div>
                    )}
                  </div>
                  {selectedMedia ? (
                    <div className="mt-3 grid gap-2 rounded-2xl bg-slate-950 p-2 ring-1 ring-white/10 lg:grid-cols-[minmax(0,1fr)_auto]">
                      <div className="grid min-w-0 gap-2 sm:grid-cols-[56px_minmax(0,1fr)]">
                        {selectedMedia.type === "image" ? (
                          <img src={selectedMedia.thumbnailUrl || selectedMedia.url} alt="" className="h-14 w-14 rounded-xl object-cover ring-1 ring-white/10" />
                        ) : (
                          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-800 text-[10px] font-black uppercase text-white ring-1 ring-white/10">{formatTimelineMediaType(selectedMedia.type || "file")}</div>
                        )}
                        <div className="min-w-0">
                          <div className="truncate text-xs font-black text-white">{selectedMedia.label || selectedMedia.originalName || "Выбранный файл"}</div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <span className="rounded-full bg-white/10 px-2 py-1 text-[9px] font-black uppercase text-slate-300">{formatTimelineMediaType(selectedMedia.type || "media")}</span>
                            <span className="rounded-full bg-indigo-500/15 px-2 py-1 text-[9px] font-black text-indigo-100 ring-1 ring-indigo-400/20">{selectedMediaDropTarget}</span>
                            <span className={cn("rounded-full px-2 py-1 text-[9px] font-black ring-1", selectedMediaUsage.length ? "bg-emerald-500/15 text-emerald-100 ring-emerald-400/20" : "bg-white/5 text-slate-400 ring-white/10")}>
                              {selectedMediaUsage.length ? `На таймлайне: ${selectedMediaUsage.join(", ")}` : "Ещё не добавлен"}
                            </span>
                            <span className="rounded-full bg-slate-800 px-2 py-1 text-[9px] font-black text-slate-300 ring-1 ring-white/10">Курсор {roundTimelineTime(currentTime)}s</span>
                            <span className="rounded-full bg-slate-800 px-2 py-1 text-[9px] font-black text-slate-300 ring-1 ring-white/10">Конец {roundTimelineTime(selectedMediaEndTime)}s</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1 lg:justify-end">
                        <button type="button" onClick={() => addMediaToTimeline(selectedMedia, 0)} className="rounded-xl bg-white/10 px-3 py-2 text-[10px] font-black text-white ring-1 ring-white/10 hover:bg-white/15">В начало</button>
                        <button type="button" onClick={() => addMediaToTimeline(selectedMedia)} className="rounded-xl bg-white px-3 py-2 text-[10px] font-black text-slate-950 hover:bg-slate-100">На курсор</button>
                        <button type="button" onClick={() => addMediaToTimelineEnd(selectedMedia)} className="rounded-xl bg-white/10 px-3 py-2 text-[10px] font-black text-white ring-1 ring-white/10 hover:bg-white/15">В конец</button>
                        {selectedMedia.type === "audio" ? (
                          <button type="button" onClick={() => useAudioMediaAsMusic(selectedMedia)} className="rounded-xl bg-emerald-500 px-3 py-2 text-[10px] font-black text-white hover:bg-emerald-400">Сделать музыкой</button>
                        ) : null}
                        {canReplaceSelectedClipWithMedia(selectedMedia) ? (
                          <button type="button" onClick={() => replaceSelectedClipWithMedia(selectedMedia)} className="rounded-xl bg-amber-400 px-3 py-2 text-[10px] font-black text-slate-950 hover:bg-amber-300">Заменить выбранный</button>
                        ) : null}
                        <button type="button" onClick={() => toggleMediaPreview(selectedMedia)} className="rounded-xl bg-white/10 px-3 py-2 text-[10px] font-black text-white ring-1 ring-white/10 hover:bg-white/15">Превью</button>
                        <a href={selectedMedia.url} target="_blank" rel="noreferrer" className="rounded-xl bg-white/10 px-3 py-2 text-[10px] font-black text-white ring-1 ring-white/10 hover:bg-white/15">Открыть</a>
                      </div>
                      {previewMediaKey === getMediaKey(selectedMedia) ? (
                        <div className="overflow-hidden rounded-2xl bg-slate-900 p-2 ring-1 ring-white/10 lg:col-span-2">
                          {selectedMedia.type === "image" ? <img src={selectedMedia.url} alt={selectedMedia.label || "Превью выбранного файла"} className="max-h-48 w-full rounded-xl object-contain" /> : null}
                          {selectedMedia.type === "audio" ? <audio src={selectedMedia.url} controls className="w-full" /> : null}
                          {selectedMedia.type === "video" ? <video src={selectedMedia.url} controls className="max-h-56 w-full rounded-xl bg-black object-contain" /> : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="mx-3 mt-3 flex gap-2 overflow-x-auto rounded-2xl bg-slate-900 p-2">
                {SOUND_EFFECT_PRESETS.map((preset) => (
                  <button
                    key={preset.assetId}
                    type="button"
                    onClick={() => addEffect(preset)}
                    className="shrink-0 rounded-xl bg-slate-800 px-3 py-2 text-left text-[10px] font-black text-white ring-1 ring-white/5 hover:bg-slate-700"
                    title={preset.note}
                  >
                    <span className="block">{preset.label}</span>
                    <span className="mt-0.5 block text-[10px] text-slate-500">+ clip</span>
                  </button>
                ))}
              </div>
              <div className="m-3 overflow-x-auto rounded-2xl bg-slate-900 p-3">
                <div style={{ minWidth: `${timelineMinWidth}px` }}>
                  <div className="mb-3 grid grid-cols-[74px_1fr] gap-3">
                    <div className="py-1 text-[10px] font-black uppercase tracking-wide text-slate-400">Playhead</div>
                    <div className="relative">
                      <button
                        type="button"
                        onPointerDown={startScrubTimeline}
                        className="relative h-5 w-full cursor-pointer rounded-full bg-white/90"
                        title="Перетащи, чтобы перейти на секунду ролика."
                      >
                        <span className="absolute inset-y-0 left-0 rounded-full bg-indigo-500" style={{ width: `${playheadLeft}%` }} />
                        <span className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-500 ring-2 ring-white shadow" style={{ left: `${playheadLeft}%` }} />
                      </button>
                      <div className="pointer-events-none absolute right-1 top-1/2 min-w-12 -translate-y-1/2 rounded-lg bg-slate-800 px-2 py-1 text-center text-[10px] font-black text-white ring-1 ring-white/10">{Math.round(currentTime * 10) / 10}s</div>
                      <div className="pointer-events-none absolute top-7 z-20 h-[330px] w-0.5 -translate-x-1/2 bg-rose-400 shadow-[0_0_0_1px_rgba(255,255,255,.7)]" style={{ left: `${playheadLeft}%` }} />
                      {snapGuideLeft !== null ? (
                        <>
                          <div className="pointer-events-none absolute top-7 z-30 h-[330px] w-0.5 -translate-x-1/2 bg-emerald-300 shadow-[0_0_0_1px_rgba(16,185,129,.35)]" style={{ left: `${snapGuideLeft}%` }} />
                          <span className="pointer-events-none absolute top-7 z-30 -translate-x-1/2 -translate-y-7 rounded-full bg-emerald-300 px-2 py-0.5 text-[9px] font-black text-slate-950 shadow" style={{ left: `${snapGuideLeft}%` }}>
                            snap {roundTimelineTime(snapGuideTime)}s
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="grid grid-cols-[74px_1fr] gap-3">
                    <div className="py-2 text-[10px] font-black uppercase tracking-wide text-slate-400">Time</div>
                    <div className="grid grid-cols-5 text-[10px] font-black text-slate-500">
                      {[0, 0.25, 0.5, 0.75, 1].map((point) => (
                        <div key={point}>{Math.round(duration * point)}s</div>
                      ))}
                    </div>
                    <div className="py-3 text-xs font-black text-slate-300">Video</div>
                    <div
                      className={cn(
                        "relative h-16 rounded-xl bg-slate-800 ring-1 ring-transparent transition",
                        isTrackCompatibleWithDraggedAsset("video") && "bg-sky-950/80 ring-sky-400",
                        isTrackBlockedForDraggedAsset("video") && "opacity-50 ring-rose-400/40"
                      )}
                      onDragOver={allowAssetDropOnTrack}
                      onDrop={(event) => handleAssetDropOnTrack(event, "video")}
                      onClick={seekTimelineFromTrackClick}
                    >
                      <div className="absolute inset-x-0 top-2 h-6 rounded-lg bg-gradient-to-r from-slate-200 to-slate-400 px-3 py-1 text-xs font-black text-slate-950">
                        HeyGen видео · {job.output?.heygen?.videoId ? "готово" : "ожидает"}
                      </div>
                      {!videoClips.length ? (
                        <div className="pointer-events-none absolute bottom-2 right-3 rounded-lg bg-slate-950/60 px-2 py-1 text-[10px] font-black text-slate-400">Перетащи видео сюда</div>
                      ) : null}
                      {isTrackBlockedForDraggedAsset("video") ? (
                        <div className="pointer-events-none absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-lg bg-rose-500/15 px-2 py-1 text-[10px] font-black text-rose-200 ring-1 ring-rose-400/20">Не тот тип</div>
                      ) : null}
                      {videoClips.map((item, index) => {
                        const left = Math.max(0, Math.min(92, (Number(item.time || 0) / duration) * 100));
                        const width = Math.max(8, Math.min(65, (Number(item.duration || 5) / duration) * 100));
                        const activeNow = isClipActiveAtTime(item, 5);
                        return (
                          <button
                            key={item.id || index}
                            type="button"
                            data-timeline-clip="true"
                            onPointerDown={(event) => startDragOverlay(event, "video", index)}
                            onClick={() => selectSingleClip("video", index)}
                            className={cn(
                              "absolute bottom-2 h-7 cursor-grab rounded-lg bg-sky-500 px-3 text-left text-[10px] font-black text-white shadow ring-2 ring-sky-300/40 active:cursor-grabbing",
                              item.enabled === false && "bg-slate-600 opacity-60 ring-slate-500",
                              activeNow && "shadow-[0_0_0_2px_rgba(250,204,21,.55),0_0_22px_rgba(250,204,21,.35)] ring-yellow-300",
                              ((selectedClip.type === "video" && selectedClip.index === index) || isClipMultiSelected("video", index)) && "bg-emerald-600 ring-white"
                            )}
                            style={{ left: `${left}%`, width: `${width}%`, minWidth: 112 }}
                            title="Видео-вставка. Перетащи по таймлайну."
                          >
                            <span
                              onPointerDown={(event) => startResizeOverlay(event, "video", index, "left")}
                              className="absolute inset-y-0 left-0 w-3 cursor-ew-resize rounded-l-lg bg-white/25 hover:bg-white/45"
                              title="Обрезать начало"
                            />
                            <span className="block truncate">{item.label || "Видео-вставка"}</span>
                            <span className="block text-[10px] text-white/70">{Number(item.time || 0).toFixed(1)}s · {Number(item.duration || 5).toFixed(1)}s</span>
                            <span
                              onPointerDown={(event) => startResizeOverlay(event, "video", index, "right")}
                              className="absolute inset-y-0 right-0 w-3 cursor-ew-resize rounded-r-lg bg-white/25 hover:bg-white/45"
                              title="Обрезать конец"
                            />
                          </button>
                        );
                      })}
                    </div>
                    <div className="py-3 text-xs font-black text-slate-300">Голос</div>
                    <div className="relative h-10 rounded-xl bg-slate-800">
                      <div className="absolute inset-y-2 left-0 right-0 rounded-lg bg-gradient-to-r from-sky-400 to-blue-500 px-3 py-1 text-xs font-black text-white">
                        Речь аватара · {String(job.output?.script || "").trim().split(/\s+/).filter(Boolean).length || 0} слов
                      </div>
                    </div>
                    <div className="py-3 text-xs font-black text-slate-300">Музыка</div>
                    <div
                      className={cn(
                        "relative h-10 rounded-xl bg-slate-800 ring-1 ring-transparent transition",
                        isTrackCompatibleWithDraggedAsset("music") && "bg-emerald-950/80 ring-emerald-400",
                        isTrackBlockedForDraggedAsset("music") && "opacity-50 ring-rose-400/40"
                      )}
                      onDragOver={allowAssetDropOnTrack}
                      onDrop={(event) => handleAssetDropOnTrack(event, "music")}
                      onClick={seekTimelineFromTrackClick}
                    >
                      <div className="absolute inset-y-2 left-0 right-0 rounded-lg bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 px-3 py-1 text-xs font-black text-slate-950">
                        {plan.music?.label || "Музыка"} · {Math.round(Number(plan.music?.volume ?? 0.12) * 100)}%
                      </div>
                      {isTrackCompatibleWithDraggedAsset("music") ? (
                        <div className="pointer-events-none absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-lg bg-emerald-500/20 px-2 py-1 text-[10px] font-black text-emerald-100 ring-1 ring-emerald-300/30">Заменит музыку</div>
                      ) : null}
                      {isTrackBlockedForDraggedAsset("music") ? (
                        <div className="pointer-events-none absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-lg bg-rose-500/15 px-2 py-1 text-[10px] font-black text-rose-200 ring-1 ring-rose-400/20">Только аудио</div>
                      ) : null}
                    </div>
                    <div className="py-3 text-xs font-black text-slate-300">SFX</div>
                    <div
                      ref={timelineRef}
                      className={cn(
                        "relative h-20 rounded-xl bg-slate-800 ring-1 ring-transparent transition",
                        isTrackCompatibleWithDraggedAsset("sfx") && "bg-indigo-950/80 ring-indigo-400",
                        isTrackBlockedForDraggedAsset("sfx") && "opacity-50 ring-rose-400/40"
                      )}
                      onDragOver={allowAssetDropOnTrack}
                      onDrop={(event) => handleAssetDropOnTrack(event, "sfx")}
                      onClick={seekTimelineFromTrackClick}
                    >
                      <div className="absolute inset-y-0 left-0 right-0 grid grid-cols-5">
                        {[0, 1, 2, 3, 4].map((line) => <div key={line} className="border-l border-white/5" />)}
                      </div>
                      {!effects.length ? (
                        <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-lg bg-slate-950/60 px-2 py-1 text-[10px] font-black text-slate-400">Перетащи аудио сюда</div>
                      ) : null}
                      {isTrackBlockedForDraggedAsset("sfx") ? (
                        <div className="pointer-events-none absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-lg bg-rose-500/15 px-2 py-1 text-[10px] font-black text-rose-200 ring-1 ring-rose-400/20">Не тот тип</div>
                      ) : null}
                      {effects.map((effect, index) => {
                        const left = Math.max(0, Math.min(92, (Number(effect.time || 0) / duration) * 100));
                        const clipDuration = Number(effect.duration || getSoundPreset(effect.assetId).tone?.duration || 0.3);
                        const width = Math.max(7, Math.min(28, (clipDuration / duration) * 100));
                        const activeNow = isClipActiveAtTime(effect, clipDuration);
                        return (
                          <button
                            key={`${effect.id || index}_clip`}
                            type="button"
                            data-timeline-clip="true"
                            onPointerDown={(event) => startDragEffect(event, index)}
                            onClick={() => selectSingleClip("sfx", index)}
                            onDoubleClick={() => playEffect(effect, index)}
                            className={cn(
                              "absolute top-3 h-12 w-28 cursor-grab rounded-xl px-3 text-left text-[10px] font-black text-white shadow-lg ring-2 transition active:cursor-grabbing",
                              effect.enabled === false ? "bg-slate-600 opacity-60 ring-slate-500" : "bg-indigo-600 ring-indigo-400/40",
                              activeNow && "shadow-[0_0_0_2px_rgba(250,204,21,.55),0_0_22px_rgba(250,204,21,.35)] ring-yellow-300",
                              ((selectedClip.type === "sfx" && selectedClip.index === index) || isClipMultiSelected("sfx", index)) && "bg-emerald-600 ring-white",
                              soloIndex === index && "scale-105"
                            )}
                            style={{ left: `${left}%`, width: `${width}%`, minWidth: 96 }}
                            title="Перетащи по таймлайну. Двойной клик — прослушать."
                          >
                            <span
                              onPointerDown={(event) => startResizeEffect(event, index, "left")}
                              className="absolute inset-y-0 left-0 w-3 cursor-ew-resize rounded-l-xl bg-white/20 hover:bg-white/40"
                              title="Обрезать начало SFX"
                            />
                            <span className="block truncate">{effect.label || `SFX ${index + 1}`}</span>
                            <span className="mt-1 block text-[10px] text-white/70">{Number(effect.time || 0).toFixed(1)}s · {Number(effect.duration || 0.3).toFixed(1)}s</span>
                            <span
                              onPointerDown={(event) => startResizeEffect(event, index, "right")}
                              className="absolute inset-y-0 right-0 w-3 cursor-ew-resize rounded-r-xl bg-white/20 hover:bg-white/40"
                              title="Обрезать конец SFX"
                            />
                          </button>
                        );
                      })}
                    </div>
                    <div className="py-3 text-xs font-black text-slate-300">Текст</div>
                    <div className="relative h-14 rounded-xl bg-slate-800" onClick={seekTimelineFromTrackClick}>
                      <div className="absolute inset-y-0 left-0 right-0 grid grid-cols-5">
                        {[0, 1, 2, 3, 4].map((line) => <div key={line} className="border-l border-white/5" />)}
                      </div>
                      {textOverlays.map((item, index) => {
                        const left = Math.max(0, Math.min(92, (Number(item.time || 0) / duration) * 100));
                        const width = Math.max(8, Math.min(40, (Number(item.duration || 3) / duration) * 100));
                        const activeNow = isClipActiveAtTime(item, 3);
                        return (
                          <button type="button" key={item.id || index} data-timeline-clip="true" onPointerDown={(event) => startDragOverlay(event, "text", index)} onClick={() => selectSingleClip("text", index)} className={cn("absolute top-2 h-10 cursor-grab rounded-xl bg-amber-400 px-3 py-1 text-left text-[10px] font-black text-slate-950 shadow ring-2 ring-transparent active:cursor-grabbing", activeNow && "shadow-[0_0_0_2px_rgba(250,204,21,.55),0_0_22px_rgba(250,204,21,.35)] ring-yellow-200", ((selectedClip.type === "text" && selectedClip.index === index) || isClipMultiSelected("text", index)) && "ring-white")} style={{ left: `${left}%`, width: `${width}%` }}>
                            <span
                              onPointerDown={(event) => startResizeOverlay(event, "text", index, "left")}
                              className="absolute inset-y-0 left-0 w-3 cursor-ew-resize rounded-l-xl bg-white/30 hover:bg-white/50"
                              title="Обрезать начало текста"
                            />
                            <span className="block truncate">{item.label || item.text || "Текст"}</span>
                            <span className="block text-[10px] opacity-70">{Number(item.time || 0).toFixed(1)}s · {Number(item.duration || 3).toFixed(1)}s</span>
                            <span
                              onPointerDown={(event) => startResizeOverlay(event, "text", index, "right")}
                              className="absolute inset-y-0 right-0 w-3 cursor-ew-resize rounded-r-xl bg-white/30 hover:bg-white/50"
                              title="Обрезать конец текста"
                            />
                          </button>
                        );
                      })}
                    </div>
                    <div className="py-3 text-xs font-black text-slate-300">Картинки</div>
                    <div
                      className={cn(
                        "relative h-14 rounded-xl bg-slate-800 ring-1 ring-transparent transition",
                        isTrackCompatibleWithDraggedAsset("image") && "bg-fuchsia-950/80 ring-fuchsia-400",
                        isTrackBlockedForDraggedAsset("image") && "opacity-50 ring-rose-400/40"
                      )}
                      onDragOver={allowAssetDropOnTrack}
                      onDrop={(event) => handleAssetDropOnTrack(event, "image")}
                      onClick={seekTimelineFromTrackClick}
                    >
                      <div className="absolute inset-y-0 left-0 right-0 grid grid-cols-5">
                        {[0, 1, 2, 3, 4].map((line) => <div key={line} className="border-l border-white/5" />)}
                      </div>
                      {!imageOverlays.length ? (
                        <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-lg bg-slate-950/60 px-2 py-1 text-[10px] font-black text-slate-400">Перетащи картинку сюда</div>
                      ) : null}
                      {isTrackBlockedForDraggedAsset("image") ? (
                        <div className="pointer-events-none absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-lg bg-rose-500/15 px-2 py-1 text-[10px] font-black text-rose-200 ring-1 ring-rose-400/20">Не тот тип</div>
                      ) : null}
                      {imageOverlays.map((item, index) => {
                        const left = Math.max(0, Math.min(92, (Number(item.time || 0) / duration) * 100));
                        const width = Math.max(8, Math.min(40, (Number(item.duration || 4) / duration) * 100));
                        const activeNow = isClipActiveAtTime(item, 4);
                        return (
                          <button type="button" key={item.id || index} data-timeline-clip="true" onPointerDown={(event) => startDragOverlay(event, "image", index)} onClick={() => selectSingleClip("image", index)} className={cn("absolute top-2 h-10 cursor-grab rounded-xl bg-fuchsia-500 px-3 py-1 text-left text-[10px] font-black text-white shadow ring-2 ring-transparent active:cursor-grabbing", activeNow && "shadow-[0_0_0_2px_rgba(250,204,21,.55),0_0_22px_rgba(250,204,21,.35)] ring-yellow-300", ((selectedClip.type === "image" && selectedClip.index === index) || isClipMultiSelected("image", index)) && "ring-white")} style={{ left: `${left}%`, width: `${width}%` }}>
                            <span
                              onPointerDown={(event) => startResizeOverlay(event, "image", index, "left")}
                              className="absolute inset-y-0 left-0 w-3 cursor-ew-resize rounded-l-xl bg-white/20 hover:bg-white/40"
                              title="Обрезать начало картинки"
                            />
                            <span className="block truncate">{item.label || "Картинка"}</span>
                            <span className="block text-[10px] text-white/70">{Number(item.time || 0).toFixed(1)}s · {Number(item.duration || 4).toFixed(1)}s</span>
                            <span
                              onPointerDown={(event) => startResizeOverlay(event, "image", index, "right")}
                              className="absolute inset-y-0 right-0 w-3 cursor-ew-resize rounded-r-xl bg-white/20 hover:bg-white/40"
                              title="Обрезать конец картинки"
                            />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="mt-3 text-[10px] font-bold text-slate-500">Кликни клип на дорожке, чтобы редактировать. Ctrl+A выбирает все клипы, Ctrl+C/Ctrl+X/Ctrl+V копирует, вырезает и вставляет выбранное, Shift+click выбирает несколько, Esc сбрасывает группу, стрелки двигают выбранное, Shift+стрелки быстрее. Home/End ставит выбранное в начало/к финалу. S режет по курсору, Ctrl+Z откат, Ctrl+Y повтор, Ctrl+D дублирует, Delete удаляет.</div>
                </div>
              </div>
            </div>
            <div className="max-h-[calc(100vh-220px)] overflow-y-auto rounded-2xl bg-white p-3 ring-1 ring-indigo-100 xl:sticky xl:top-3">
              <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Инспектор</div>
              {selectedMedia ? (
                <div className="mt-2 space-y-2 rounded-2xl bg-slate-950 p-2 text-white ring-1 ring-slate-900">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Медиатека</div>
                      <div className="truncate text-xs font-black">{selectedMedia.label || selectedMedia.originalName || "Медиа"}</div>
                      <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">{selectedMedia.type || "файл"} · {selectedMedia.mimeType || "медиа"}</div>
                      <div className="mt-1 text-[10px] font-black text-emerald-300">
                        {selectedMediaUsage.length ? `Уже на таймлайне: ${selectedMediaUsage.join(", ")}` : `Добавится: ${selectedMediaDropTarget}`}
                      </div>
                    </div>
                    <button type="button" onClick={() => setSelectedMediaKey("")} className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-black text-slate-300 hover:bg-white/15">Снять</button>
                  </div>
                  {previewMediaKey === getMediaKey(selectedMedia) ? (
                    <div className="overflow-hidden rounded-xl bg-black p-1 ring-1 ring-white/10">
                      {selectedMedia.type === "image" ? <img src={selectedMedia.url} alt={selectedMedia.label || "Превью"} className="max-h-36 w-full rounded-lg object-contain" /> : null}
                      {selectedMedia.type === "audio" ? <audio src={selectedMedia.url} controls className="w-full" /> : null}
                      {selectedMedia.type === "video" ? <video src={selectedMedia.url} controls className="max-h-36 w-full rounded-lg object-contain" /> : null}
                    </div>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => addMediaToTimeline(selectedMedia, 0)} className="rounded-xl bg-white/10 px-3 py-2 text-xs font-black text-white ring-1 ring-white/10 hover:bg-white/15">В начало</button>
                    <button type="button" onClick={() => addMediaToTimeline(selectedMedia)} className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-black text-white hover:bg-emerald-400">На курсор</button>
                    <button type="button" onClick={() => addMediaToTimeline(selectedMedia, selectedMediaEndTime)} className="rounded-xl bg-white/10 px-3 py-2 text-xs font-black text-white ring-1 ring-white/10 hover:bg-white/15">На макс.</button>
                    <button type="button" onClick={() => addMediaToTimelineEnd(selectedMedia)} className="rounded-xl bg-white/10 px-3 py-2 text-xs font-black text-white ring-1 ring-white/10 hover:bg-white/15">В конец</button>
                    {canReplaceSelectedClipWithMedia(selectedMedia) ? (
                      <button type="button" onClick={() => replaceSelectedClipWithMedia(selectedMedia)} className="rounded-xl bg-indigo-500 px-3 py-2 text-xs font-black text-white hover:bg-indigo-400">Заменить клип</button>
                    ) : null}
                    <button type="button" onClick={() => toggleMediaPreview(selectedMedia)} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-950 hover:bg-slate-100">{previewMediaKey === getMediaKey(selectedMedia) ? "Скрыть" : "Превью"}</button>
                    {selectedMedia.type === "audio" ? (
                      <button type="button" onClick={() => useAudioMediaAsMusic(selectedMedia)} className="rounded-xl bg-cyan-500 px-3 py-2 text-xs font-black text-white hover:bg-cyan-400">Как музыку</button>
                    ) : null}
                    <a href={selectedMedia.url} target="_blank" rel="noreferrer" className="rounded-xl bg-white/10 px-3 py-2 text-center text-xs font-black text-white ring-1 ring-white/10 hover:bg-white/15">Открыть</a>
                    <button type="button" onClick={copySelectedMediaUrl} className="rounded-xl bg-white/10 px-3 py-2 text-xs font-black text-white ring-1 ring-white/10 hover:bg-white/15">Копия URL</button>
                    <button type="button" onClick={() => removeMediaFromLibrary(selectedMedia)} className="rounded-xl bg-rose-500/15 px-3 py-2 text-xs font-black text-rose-100 ring-1 ring-rose-400/20 hover:bg-rose-500/25">Убрать</button>
                  </div>
                  {mediaToolbarNotice ? (
                    <div className="rounded-xl bg-emerald-400/15 px-3 py-2 text-xs font-black text-emerald-100 ring-1 ring-emerald-300/20">{mediaToolbarNotice}</div>
                  ) : null}
                </div>
              ) : null}
              {selectedItem ? (
                <div className={cn("mt-2 space-y-2", selectedClipKeys.length <= 1 && selectedItem.enabled === false && "opacity-60")}>
                  <div className="rounded-2xl bg-slate-950 p-3 text-white ring-1 ring-slate-900">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Выбранный клип</div>
                        <div className="mt-1 truncate text-sm font-black">{selectedClipName}</div>
                      </div>
                      <span className="shrink-0 rounded-full bg-white/10 px-2 py-1 text-[10px] font-black uppercase text-slate-200 ring-1 ring-white/10">{selectedClipLabel}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] font-black">
                      <div className="rounded-xl bg-white/10 px-2 py-2 ring-1 ring-white/10"><span className="block uppercase text-slate-500">Старт</span>{roundTimelineTime(selectedClipStart)}s</div>
                      <div className="rounded-xl bg-white/10 px-2 py-2 ring-1 ring-white/10"><span className="block uppercase text-slate-500">Конец</span>{roundTimelineTime(selectedClipEnd)}s</div>
                      <div className="rounded-xl bg-white/10 px-2 py-2 ring-1 ring-white/10"><span className="block uppercase text-slate-500">Длина</span>{roundTimelineTime(selectedClipDuration)}s</div>
                      <div className="rounded-xl bg-white/10 px-2 py-2 ring-1 ring-white/10"><span className="block uppercase text-slate-500">Курсор</span>{roundTimelineTime(currentTime)}s</div>
                      <div className="rounded-xl bg-white/10 px-2 py-2 ring-1 ring-white/10"><span className="block uppercase text-slate-500">До конца</span>{selectedClipRemainingToTimelineEnd}s</div>
                    </div>
                    <div className="mt-2 grid gap-1 text-[10px] font-bold text-slate-300">
                      {[
                        ["previous", "Слева", "end"],
                        ["next", "Справа", "start"],
                      ].map(([direction, label, seekPoint]) => {
                        const neighbor = getNearestTimelineClip(direction);
                        return (
                          <div key={direction} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl bg-white/5 px-2 py-1.5 ring-1 ring-white/10">
                            <span className="truncate">{label}: {getClipSummaryLabel(neighbor) || "нет клипа"}</span>
                            <button type="button" onClick={() => seekTimeline(seekPoint === "end" ? neighbor.end : neighbor.start)} disabled={!neighbor} className="rounded-lg bg-white/10 px-2 py-1 text-[9px] font-black text-white hover:bg-white/15 disabled:opacity-30">Курсор</button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {selectedClipKeys.length > 1 ? (
                    <div className="rounded-xl bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-800 ring-1 ring-indigo-100">
                      Группа: {selectedClipKeys.length} клипов · включено {selectedGroupEnabledCount}/{selectedClipItems.length}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={toggleSelectedClipEnabled}
                    className={cn(
                      "w-full rounded-xl px-3 py-2 text-xs font-black ring-1",
                      (selectedClipKeys.length > 1 ? selectedGroupEnabledCount === 0 : selectedItem.enabled === false) ? "bg-white text-slate-500 ring-slate-200" : "bg-emerald-50 text-emerald-800 ring-emerald-100"
                    )}
                  >
                    {selectedClipKeys.length > 1
                      ? selectedGroupHasDisabled ? "Включить выбранные" : "Выбранные включены"
                      : selectedItem.enabled === false ? "Включить клип" : `${selectedClipLabel} включен`}
                  </button>
                  {selectedClip.type === "sfx" ? (
                    <label className="block rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                      <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Тип звука</span>
                      <select
                        value={selectedItem.assetId || ""}
                        onChange={(e) => applyPresetToEffect(selectedClip.index, e.target.value)}
                        className="mt-1 w-full bg-transparent text-xs font-black text-slate-950 outline-none"
                      >
                        {selectedItem.url ? <option value="custom_audio">Импортированный звук</option> : null}
                        {SOUND_EFFECT_PRESETS.map((preset) => (
                          <option key={preset.assetId} value={preset.assetId}>{preset.label}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label className="block rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                    <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Название</span>
                    <input value={selectedItem.label || ""} onChange={(e) => updateSelectedClip({ label: e.target.value })} className="mt-1 w-full bg-transparent text-xs font-black text-slate-950 outline-none" />
                  </label>
                  {selectedClip.type === "text" ? (
                    <label className="block rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                      <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Текст на видео</span>
                      <textarea value={selectedItem.text || ""} onChange={(e) => updateSelectedClip({ text: e.target.value })} rows={3} className="mt-1 w-full resize-none bg-transparent text-xs font-bold text-slate-700 outline-none" />
                    </label>
                  ) : null}
                  {selectedClip.type === "image" ? (
                    <label className="block rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                      <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Ссылка на картинку</span>
                      <input value={selectedItem.url || ""} onChange={(e) => updateSelectedClip({ url: e.target.value })} placeholder="https://..." className="mt-1 w-full bg-transparent text-xs font-black text-slate-950 outline-none" />
                    </label>
                  ) : null}
                  {selectedClip.type === "video" ? (
                    <>
                      <label className="block rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                        <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Ссылка на видео</span>
                        <input value={selectedItem.url || ""} onChange={(e) => updateSelectedClip({ url: e.target.value })} placeholder="https://..." className="mt-1 w-full bg-transparent text-xs font-black text-slate-950 outline-none" />
                      </label>
                      <label className="block rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                        <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Старт исходника</span>
                        <input
                          type="number"
                          min="0"
                          max={Number(selectedItem.sourceDuration || 0) > 0 ? Math.max(0, Number(selectedItem.sourceDuration || 0) - Number(selectedItem.duration || 0.1)) : undefined}
                          step="0.1"
                          value={Number(selectedItem.sourceStart || 0)}
                          onChange={(e) => {
                            const sourceLimit = Number(selectedItem.sourceDuration || 0) > 0 ? Math.max(0, Number(selectedItem.sourceDuration || 0) - Number(selectedItem.duration || 0.1)) : 9999;
                            updateSelectedClip({ sourceStart: Math.max(0, Math.min(sourceLimit, Number(e.target.value))) });
                          }}
                          className="mt-1 w-full bg-transparent text-xs font-black text-slate-950 outline-none"
                        />
                      </label>
                      <div className="rounded-xl bg-sky-50 p-2 text-xs font-black text-sky-900 ring-1 ring-sky-100">
                        <div className="grid grid-cols-3 gap-2">
                          <div className="rounded-lg bg-white px-2 py-1.5 ring-1 ring-sky-100">
                            <span className="block text-[9px] uppercase tracking-wide text-sky-400">Берём с</span>
                            {Math.max(0, Number(selectedItem.sourceStart || 0)).toFixed(1)}s
                          </div>
                          <div className="rounded-lg bg-white px-2 py-1.5 ring-1 ring-sky-100">
                            <span className="block text-[9px] uppercase tracking-wide text-sky-400">До</span>
                            {(Math.max(0, Number(selectedItem.sourceStart || 0)) + Number(selectedItem.duration || 0)).toFixed(1)}s
                          </div>
                          <div className="rounded-lg bg-white px-2 py-1.5 ring-1 ring-sky-100">
                            <span className="block text-[9px] uppercase tracking-wide text-sky-400">Исходник</span>
                            {Number(selectedItem.sourceDuration || 0) > 0 ? `${Number(selectedItem.sourceDuration || 0).toFixed(1)}s` : "неизв."}
                          </div>
                        </div>
                        <div className="mt-2 rounded-lg bg-white px-2 py-1.5 text-[10px] font-black text-sky-700 ring-1 ring-sky-100">
                          Доступно после старта: {Number.isFinite(selectedClipMaxDuration) ? `${selectedClipMaxDuration.toFixed(1)}s` : "неизв."}
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          <button type="button" onClick={() => updateSelectedClip({ sourceStart: Math.max(0, Number(selectedItem.sourceStart || 0) - 0.5) })} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-sky-800 ring-1 ring-sky-100 hover:bg-sky-100">-0.5s</button>
                          <button type="button" onClick={() => updateSelectedClip({ sourceStart: 0 })} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white hover:bg-slate-800">С начала</button>
                          <button type="button" onClick={() => {
                            const sourceLimit = Number(selectedItem.sourceDuration || 0) > 0 ? Math.max(0, Number(selectedItem.sourceDuration || 0) - Number(selectedItem.duration || 0.1)) : 9999;
                            updateSelectedClip({ sourceStart: Math.max(0, Math.min(sourceLimit, Number(selectedItem.sourceStart || 0) + 0.5)) });
                          }} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-sky-800 ring-1 ring-sky-100 hover:bg-sky-100">+0.5s</button>
                        </div>
                      </div>
                    </>
                  ) : null}
                  <div className="grid grid-cols-3 gap-2">
                    <label className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                      <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Старт</span>
                      <input type="number" min="0" max={Math.max(0, duration - 0.1)} step="0.1" value={selectedClipStart} onChange={(e) => {
                        const nextStart = clampTimelineTime(e.target.value, 0, Math.max(0, duration - 0.1));
                        updateSelectedClip({
                          time: nextStart,
                          duration: clampClipDuration(selectedClipDuration, nextStart),
                        });
                      }} className="mt-1 w-full bg-transparent text-xs font-black text-slate-950 outline-none" />
                    </label>
                    <label className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                      <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Длительность</span>
                      <input type="number" min="0.1" max={selectedClipMaxDuration} step="0.1" value={selectedClipDuration} onChange={(e) => updateSelectedClip({ duration: clampClipDuration(e.target.value) })} className="mt-1 w-full bg-transparent text-xs font-black text-slate-950 outline-none" />
                    </label>
                    <label className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                      <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Конец</span>
                      <input type="number" min={Math.round((selectedClipStart + 0.1) * 10) / 10} max={selectedClipMaxEnd} step="0.1" value={selectedClipEnd} onChange={(e) => {
                        const nextEnd = clampTimelineTime(e.target.value, selectedClipStart + 0.1, selectedClipMaxEnd);
                        updateSelectedClip({ duration: Math.round((nextEnd - selectedClipStart) * 10) / 10 });
                      }} className="mt-1 w-full bg-transparent text-xs font-black text-slate-950 outline-none" />
                    </label>
                  </div>
                  {(selectedClip.type === "text" || selectedClip.type === "image" || selectedClip.type === "video") ? (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                          <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">X</span>
                          <input type="number" min="0" max="100" step="1" value={Number(selectedItem.x ?? 50)} onChange={(e) => updateSelectedClip({ x: Number(e.target.value) })} className="mt-1 w-full bg-transparent text-xs font-black text-slate-950 outline-none" />
                        </label>
                        <label className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                          <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Y</span>
                          <input type="number" min="0" max="100" step="1" value={Number(selectedItem.y ?? (selectedClip.type === "video" ? 50 : 70))} onChange={(e) => updateSelectedClip({ y: Number(e.target.value) })} className="mt-1 w-full bg-transparent text-xs font-black text-slate-950 outline-none" />
                        </label>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-2 ring-1 ring-slate-100">
                        <div className="mb-2 px-1 text-[10px] font-black uppercase tracking-wide text-slate-400">Позиция</div>
                        <div className="grid grid-cols-3 gap-2">
                          <button type="button" onClick={() => moveSelectedOverlayPosition(-2, 0)} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">Влево</button>
                          <button type="button" onClick={() => moveSelectedOverlayPosition(0, -2)} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">Вверх</button>
                          <button type="button" onClick={() => moveSelectedOverlayPosition(2, 0)} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">Вправо</button>
                          <button type="button" onClick={() => moveSelectedOverlayPosition(-0.5, 0)} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">-0.5X</button>
                          <button type="button" onClick={centerSelectedOverlay} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white hover:bg-slate-800">Центр</button>
                          <button type="button" onClick={() => moveSelectedOverlayPosition(0.5, 0)} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">+0.5X</button>
                          <button type="button" onClick={() => moveSelectedOverlayPosition(0, 2)} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">Вниз</button>
                          <button type="button" onClick={() => moveSelectedOverlayPosition(0, -0.5)} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">-0.5Y</button>
                          <button type="button" onClick={() => moveSelectedOverlayPosition(0, 0.5)} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">+0.5Y</button>
                        </div>
                      </div>
                      <label className="block rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                        <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Размер · {Math.round(Number(selectedItem.scale || 1) * 100)}%</span>
                        <input type="range" min="0.4" max="2.5" step="0.05" value={Number(selectedItem.scale || 1)} onChange={(e) => updateSelectedClip({ scale: Number(e.target.value) })} className="mt-2 w-full accent-amber-500" />
                      </label>
                      <label className="block rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                        <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Прозрачность · {Math.round(Number(selectedItem.opacity ?? 1) * 100)}%</span>
                        <input type="range" min="0.1" max="1" step="0.05" value={Number(selectedItem.opacity ?? 1)} onChange={(e) => updateSelectedClip({ opacity: Number(e.target.value) })} className="mt-2 w-full accent-slate-600" />
                      </label>
                      {(selectedClip.type === "image" || selectedClip.type === "video") ? (
                        <div className="rounded-xl bg-slate-50 p-2 ring-1 ring-slate-100">
                          <label className="block px-1">
                            <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Поворот · {Math.round(Number(selectedItem.rotation || 0))}°</span>
                            <input type="range" min="-180" max="180" step="1" value={Number(selectedItem.rotation || 0)} onChange={(e) => updateSelectedClip({ rotation: Number(e.target.value) })} className="mt-2 w-full accent-sky-600" />
                          </label>
                          <div className="mt-2 grid grid-cols-3 gap-2">
                            <button type="button" onClick={() => updateSelectedClip({ rotation: Math.max(-180, Number(selectedItem.rotation || 0) - 15) })} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">-15°</button>
                            <button type="button" onClick={() => updateSelectedClip({ rotation: 0 })} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white hover:bg-slate-800">0°</button>
                            <button type="button" onClick={() => updateSelectedClip({ rotation: Math.min(180, Number(selectedItem.rotation || 0) + 15) })} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">+15°</button>
                          </div>
                        </div>
                      ) : null}
                      <div className="rounded-xl bg-slate-50 p-2 ring-1 ring-slate-100">
                        <div className="mb-2 flex items-center justify-between gap-2 px-1">
                          <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Слой</span>
                          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-600 ring-1 ring-slate-200">{getOverlayLayer(selectedClip.type, selectedItem, selectedClip.index)}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => updateSelectedOverlayLayer("front")} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">На передний</button>
                          <button type="button" onClick={() => updateSelectedOverlayLayer("back")} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">На задний</button>
                          <button type="button" onClick={() => updateSelectedOverlayLayer("up")} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">Выше</button>
                          <button type="button" onClick={() => updateSelectedOverlayLayer("down")} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">Ниже</button>
                        </div>
                      </div>
                      {selectedClip.type === "text" ? (
                        <label className="block rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                          <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Размер текста · {Number(selectedItem.fontSize || 22)}px</span>
                          <input type="range" min="12" max="56" step="1" value={Number(selectedItem.fontSize || 22)} onChange={(e) => updateSelectedClip({ fontSize: Number(e.target.value) })} className="mt-2 w-full accent-amber-500" />
                        </label>
                      ) : (
                        <label className="block rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                          <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Ширина · {Number(selectedItem.width || (selectedClip.type === "video" ? 72 : 34))}%</span>
                          <input type="range" min="10" max={selectedClip.type === "video" ? "120" : "90"} step="1" value={Number(selectedItem.width || (selectedClip.type === "video" ? 72 : 34))} onChange={(e) => updateSelectedClip({ width: Number(e.target.value) })} className={cn("mt-2 w-full", selectedClip.type === "video" ? "accent-sky-500" : "accent-fuchsia-500")} />
                        </label>
                      )}
                    </>
                  ) : null}
                  {selectedClip.type === "sfx" ? (
                    <label className="block rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                      <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Громкость · {Math.round(Number(selectedItem.volume ?? 0.2) * 100)}%</span>
                      <input type="range" min="0" max="0.8" step="0.01" value={Number(selectedItem.volume ?? 0.2)} onChange={(e) => updateSelectedClip({ volume: Number(e.target.value) })} className="mt-2 w-full accent-indigo-600" />
                    </label>
                  ) : null}
                  <label className="block rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                    <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Комментарий</span>
                    <textarea value={selectedItem.note || ""} onChange={(e) => updateSelectedClip({ note: e.target.value })} rows={3} className="mt-1 w-full resize-none bg-transparent text-xs font-bold text-slate-600 outline-none" />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => selectedClip.type === "sfx" ? playEffect(selectedItem, selectedClip.index) : selectedClip.type === "video" && selectedItem?.url ? window.open(selectedItem.url, "_blank", "noopener,noreferrer") : null} disabled={selectedClip.type !== "sfx" && selectedClip.type !== "video"} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-40">{selectedClip.type === "sfx" ? "Слушать" : selectedClip.type === "video" ? "Открыть видео" : "Превью позже"}</button>
                    <button type="button" onClick={removeSelectedClip} className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 ring-1 ring-rose-100 hover:bg-rose-100">Удалить</button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <button type="button" onClick={() => nudgeSelectedClip(-0.5)} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">-0.5s</button>
                    <button type="button" onClick={splitSelectedClip} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">Разрезать</button>
                    <button type="button" onClick={() => nudgeSelectedClip(0.5)} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">+0.5s</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => nudgeSelectedClip(-0.1)} className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-white">Точно -0.1s</button>
                    <button type="button" onClick={() => nudgeSelectedClip(0.1)} className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-white">Точно +0.1s</button>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <button type="button" onClick={() => stretchSelectedClip(-0.5)} disabled={selectedClipKeys.length > 1} className="rounded-xl bg-indigo-50 px-2 py-2 text-xs font-black text-indigo-800 ring-1 ring-indigo-100 hover:bg-white disabled:opacity-40">Дл. -0.5</button>
                    <button type="button" onClick={() => stretchSelectedClip(-0.1)} disabled={selectedClipKeys.length > 1} className="rounded-xl bg-indigo-50 px-2 py-2 text-xs font-black text-indigo-800 ring-1 ring-indigo-100 hover:bg-white disabled:opacity-40">-0.1</button>
                    <button type="button" onClick={() => stretchSelectedClip(0.1)} disabled={selectedClipKeys.length > 1} className="rounded-xl bg-indigo-50 px-2 py-2 text-xs font-black text-indigo-800 ring-1 ring-indigo-100 hover:bg-white disabled:opacity-40">+0.1</button>
                    <button type="button" onClick={() => stretchSelectedClip(0.5)} disabled={selectedClipKeys.length > 1} className="rounded-xl bg-indigo-50 px-2 py-2 text-xs font-black text-indigo-800 ring-1 ring-indigo-100 hover:bg-white disabled:opacity-40">Дл. +0.5</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={trimSelectedClipStartToPlayhead} disabled={selectedClipKeys.length > 1} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-40">Начало к курсору</button>
                    <button type="button" onClick={trimSelectedClipEndToPlayhead} disabled={selectedClipKeys.length > 1} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-40">Конец к курсору</button>
                  </div>
                  <button type="button" onClick={stretchSelectedClipToEnd} disabled={selectedClipKeys.length > 1 || selectedClipAlreadyEndsAtTimelineEnd} className="w-full rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white hover:bg-indigo-500 disabled:opacity-40">Растянуть до конца</button>
                  <div className="grid grid-cols-3 gap-2">
                    <button type="button" onClick={duplicateSelectedClip} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">Дубль</button>
                    <button type="button" onClick={() => moveSelectedClipToTime(0)} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">В начало</button>
                    <button type="button" onClick={() => moveSelectedClipToTime(currentTime)} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">На курсор</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => moveSelectedClipToNeighbor("previous")} disabled={!getNearestTimelineClip("previous")} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-40">После левого</button>
                    <button type="button" onClick={() => moveSelectedClipToNeighbor("next")} disabled={!getNearestTimelineClip("next")} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-40">Перед правым</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => moveSelectedClipToTrackBoundary("start")} className="rounded-xl bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-800 ring-1 ring-indigo-100 hover:bg-white">В начало дорожки</button>
                    <button type="button" onClick={() => moveSelectedClipToTrackBoundary("end")} className="rounded-xl bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-800 ring-1 ring-indigo-100 hover:bg-white">В конец дорожки</button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <button type="button" onClick={copySelectedClips} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">Копировать</button>
                    <button type="button" onClick={cutSelectedClips} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">Вырезать</button>
                    <button type="button" onClick={pasteTimelineClipboard} disabled={!timelineClipboard.length} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-40">Вставить{timelineClipboard.length ? ` ${timelineClipboard.length}` : ""}</button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <button type="button" onClick={() => seekTimeline(getSelectedGroupStart())} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">Курсор к началу</button>
                    <button type="button" onClick={() => seekTimeline(getSelectedGroupEnd())} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">Курсор к концу</button>
                    <button type="button" onClick={moveSelectedClipToEnd} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">К финалу</button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 rounded-xl bg-slate-50 p-3 text-xs font-bold text-slate-500">Выбери клип или добавь SFX, текст, картинку или видео.</div>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs font-bold text-slate-500">
              Статус render: {plan.render?.status || "not_rendered"}
              {plan.render?.error ? <span className="ml-2 text-rose-600">{plan.render.error}</span> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {renderedUrl ? (
                <a href={renderedUrl} target="_blank" rel="noreferrer" className="rounded-2xl bg-emerald-700 px-4 py-2 text-xs font-black text-white hover:bg-emerald-800">
                  Открыть sound MP4
                </a>
              ) : null}
              <button
                type="button"
                onClick={() => onSave?.(job, draft)}
                disabled={busy || rendering}
                className="rounded-2xl bg-white px-4 py-2 text-xs font-black text-slate-950 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-40"
              >
                {busy ? "Сохраняю..." : "Сохранить sound plan"}
              </button>
              <button
                type="button"
                onClick={() => onRender?.(job)}
                disabled={busy || rendering}
                className="rounded-2xl bg-slate-950 px-4 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-40"
              >
                {rendering ? "Свожу..." : renderedUrl ? "Пересвести звук" : "Свести звук"}
              </button>
            </div>
          </div>
        </div>
            </div>
          </div>
        </div>
        ) : null}
        </>
      ) : null}
    </div>
  );
}

function Message({ msg, onStartHeygen, onRefreshHeygen, onSaveScript, onSaveSoundPlan, onRenderSoundPlan, onImportMedia, onSelectHeygenVersion, canStartHeygen, aiVideoEnabled, heygenReady, heygenLoading, refreshLoading, scriptSaving, soundPlanSaving, soundRenderLoading, mediaImportLoading, versionLoading, runtimeProfile, runtimePresets, heygenProfileDirty }) {
  const user = msg.role === "user";
  const inferredVideoId = findHeygenVideoIdFromEvents(msg.events || []);
  const heygen = msg.output?.heygen || (inferredVideoId ? { provider: "heygen", status: "submitted", videoId: inferredVideoId } : null);
  const artifact = heygen?.artifact || null;
  const heygenVersions = getHeygenVersions(msg.output || {});
  const heygenAttempts = heygenVersions.filter((item) => !item.active);
  const jobStatus = String(msg.job?.status || "").toLowerCase();
  const [scriptEditing, setScriptEditing] = React.useState(false);
  const [scriptDraft, setScriptDraft] = React.useState(msg.output?.script || "");
  const [motionDraft, setMotionDraft] = React.useState(msg.output?.motionPrompt || "");
  const [scriptError, setScriptError] = React.useState("");
  React.useEffect(() => {
    setScriptDraft(msg.output?.script || "");
    setMotionDraft(msg.output?.motionPrompt || "");
    setScriptEditing(false);
    setScriptError("");
  }, [msg.output?.script, msg.output?.motionPrompt, msg.job?.id]);
  const canShowHeygenAction = !user && msg.job?.id && msg.output?.script && !heygen?.videoId && !["video_submitted", "video_ready", "video_failed"].includes(jobStatus);
  const canShowRefreshAction = !user && msg.job?.id && heygen?.videoId && !heygen?.videoUrl;
  const canShowRegenerateAction = !user && msg.job?.id && msg.output?.script && Boolean(heygen?.videoId || heygen?.status);
  const canEditScript = !user && msg.job?.id && msg.output?.script && !heygenLoading && !scriptSaving;
  const scriptDirty = String(scriptDraft || "") !== String(msg.output?.script || "");
  const motionDirty = String(motionDraft || "") !== String(msg.output?.motionPrompt || "");
  const promptDirty = scriptDirty || motionDirty;
  const previewProfile = heygen?.profile || runtimeProfile || {};
  const heygenActionLabel = canStartHeygen
    ? heygenLoading === msg.job?.id ? "Отправляю..." : "Утвердить и отправить в HeyGen"
    : !heygenReady ? "HeyGen не настроен" : !aiVideoEnabled ? "Включи HeyGen" : "HeyGen недоступен";
  async function saveScriptDraft() {
    const nextScript = String(scriptDraft || "").trim();
    if (nextScript.length < 20) {
      setScriptError("Сценарий слишком короткий.");
      return;
    }
    setScriptError("");
    await onSaveScript?.(msg.job, nextScript, String(motionDraft || "").trim());
    setScriptEditing(false);
  }
  return (
    <div className={cn("flex", user ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[92%] rounded-[1.6rem] px-5 py-4 shadow-sm", user ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-900")}>
        <div className={cn("mb-2 text-xs font-black uppercase tracking-wide", user ? "text-slate-300" : "text-slate-500")}>{user ? "Ты" : "Travella AI Runtime"}</div>
        <div className="whitespace-pre-wrap text-sm font-semibold leading-7">{msg.text}</div>
        <ServicePreview service={msg.output?.service} />
        {msg.events?.length ? <div className="mt-4 space-y-2">{msg.events.map((ev, i) => <ToolEvent key={`${ev.at || i}_${i}`} ev={ev} />)}</div> : null}
        {msg.output?.hook ? <div className="mt-4 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-100"><div className="text-xs font-black uppercase tracking-wide text-amber-700">Хук</div><div className="mt-2 text-sm font-black leading-6 text-slate-950">{msg.output.hook}</div></div> : null}
        {msg.output?.script ? (
          <div className="mt-3 rounded-2xl bg-slate-950 p-4 text-white">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-black uppercase tracking-wide text-slate-300">Речь для HeyGen</div>
                {msg.output?.scriptEditedAt ? <div className="mt-1 text-xs font-bold text-emerald-300">Отредактирован вручную</div> : null}
              </div>
              {canEditScript && !scriptEditing ? (
                <button
                  type="button"
                  onClick={() => {
                    setScriptEditing(true);
                    setScriptError("");
                  }}
                  className="rounded-2xl bg-white/10 px-3 py-1.5 text-xs font-black text-white ring-1 ring-white/15 hover:bg-white/15"
                >
                  Редактировать
                </button>
              ) : null}
            </div>
            {scriptEditing ? (
              <div className="mt-3">
                <textarea
                  value={scriptDraft}
                  onChange={(e) => {
                    setScriptDraft(e.target.value);
                    setScriptError("");
                  }}
                  className="min-h-[320px] w-full resize-y rounded-2xl border border-white/10 bg-white px-4 py-3 text-sm font-semibold leading-7 text-slate-950 outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-500/15"
                />
                <div className="mt-4">
                  <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-300">Custom Motion для HeyGen</div>
                  <textarea
                    value={motionDraft}
                    onChange={(e) => {
                      setMotionDraft(e.target.value);
                      setScriptError("");
                    }}
                    placeholder="Опиши жесты, мимику, взгляд, темп, паузы и акценты для аватара."
                    className="min-h-[220px] w-full resize-y rounded-2xl border border-white/10 bg-white px-4 py-3 text-sm font-semibold leading-7 text-slate-950 outline-none placeholder:text-slate-400 focus:border-emerald-300 focus:ring-4 focus:ring-emerald-500/15"
                  />
                </div>
                {scriptError ? <div className="mt-2 rounded-2xl bg-amber-100 px-3 py-2 text-xs font-black text-amber-800">{scriptError}</div> : null}
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setScriptDraft(msg.output?.script || "");
                      setMotionDraft(msg.output?.motionPrompt || "");
                      setScriptEditing(false);
                      setScriptError("");
                    }}
                    disabled={scriptSaving === msg.job?.id}
                    className="rounded-2xl bg-white/10 px-4 py-2 text-xs font-black text-white ring-1 ring-white/15 hover:bg-white/15 disabled:opacity-40"
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    onClick={saveScriptDraft}
                    disabled={!promptDirty || scriptSaving === msg.job?.id}
                    className="rounded-2xl bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-slate-400"
                  >
                    {scriptSaving === msg.job?.id ? "Сохраняю..." : "Сохранить промпт"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-7 text-slate-100">{msg.output.script}</div>
            )}
          </div>
        ) : null}
        {msg.output?.motionPrompt && !scriptEditing ? (
          <div className="mt-3 rounded-2xl bg-slate-900 p-4 text-white ring-1 ring-slate-800">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-black uppercase tracking-wide text-slate-300">Custom Motion для HeyGen</div>
                {msg.output?.motionPromptEditedAt ? <div className="mt-1 text-xs font-bold text-emerald-300">Отредактирован вручную</div> : null}
              </div>
              {canEditScript ? (
                <button
                  type="button"
                  onClick={() => {
                    setScriptEditing(true);
                    setScriptError("");
                  }}
                  className="rounded-2xl bg-white/10 px-3 py-1.5 text-xs font-black text-white ring-1 ring-white/15 hover:bg-white/15"
                >
                  Редактировать
                </button>
              ) : null}
            </div>
            <div className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-7 text-slate-100">{msg.output.motionPrompt}</div>
          </div>
        ) : null}
        <ScriptReview review={msg.output?.scriptReview} />
        {msg.output?.script && !user ? (
          <HeygenGenerationPreview
            profile={previewProfile}
            presets={runtimePresets}
            script={msg.output.script}
            locked={Boolean(heygen?.profile)}
            dirty={Boolean(canShowHeygenAction && heygenProfileDirty)}
          />
        ) : null}
        {heygen ? (
          <div className="mt-3 rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-100">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-xs font-black uppercase tracking-wide text-emerald-700">HeyGen</div>
                <div className="mt-2 text-sm font-black leading-6 text-slate-950">Статус: {heygen.status || "submitted"}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-700 ring-1 ring-emerald-100">v{heygen.version || heygenAttempts.length + 1}</span>
                {heygenAttempts.length ? <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-500 ring-1 ring-emerald-100">ещё {heygenAttempts.length}</span> : null}
              </div>
            </div>
            {heygen.videoId ? <div className="mt-1 text-xs font-bold text-slate-500">Video ID: {heygen.videoId}</div> : null}
            {heygenVersions.length > 1 ? (
              <div className="mt-3 rounded-2xl bg-white p-3 ring-1 ring-emerald-100">
                <div className="text-xs font-black uppercase tracking-wide text-slate-400">Версии HeyGen</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {heygenVersions.map((item) => {
                    const active = Boolean(item.active);
                    const ready = Boolean(item.videoUrl || item.artifact?.url);
                    return (
                      <button
                        key={`${item.version}_${item.videoId || item.status || "video"}`}
                        type="button"
                        onClick={() => !active && onSelectHeygenVersion?.(msg.job, item.version)}
                        disabled={active || versionLoading === msg.job?.id}
                        className={cn(
                          "rounded-2xl px-3 py-2 text-left text-xs font-black ring-1 transition disabled:cursor-default",
                          active
                            ? "bg-emerald-600 text-white ring-emerald-600"
                            : "bg-slate-50 text-slate-700 ring-slate-200 hover:bg-slate-100 disabled:opacity-50"
                        )}
                        title={active ? "Активная версия" : "Сделать активной"}
                      >
                        <span className="block">v{item.version}{active ? " · активная" : ""}</span>
                        <span className={cn("mt-0.5 block text-[10px]", active ? "text-white/70" : ready ? "text-emerald-700" : "text-slate-400")}>
                          {active ? "публикуется она" : versionLoading === msg.job?.id ? "переключаю..." : ready ? "готово" : item.status || "submitted"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
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
            {canShowRegenerateAction ? (
              <div className="mt-3 flex flex-col gap-2 rounded-2xl bg-white p-3 ring-1 ring-emerald-100 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs font-bold text-slate-500">Новая версия сохранит старое видео в истории и отправит текущий сценарий в HeyGen заново.</div>
                <button
                  type="button"
                  onClick={() => onStartHeygen?.(msg.job, { regenerate: true })}
                  disabled={!canStartHeygen || heygenLoading === msg.job.id || promptDirty || heygenProfileDirty}
                  className="rounded-2xl bg-slate-950 px-4 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {promptDirty ? "Сначала сохрани промпт" : heygenProfileDirty ? "Сначала сохрани настройки" : heygenLoading === msg.job.id ? "Запускаю..." : "Сделать новую версию"}
                </button>
              </div>
            ) : null}
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
        {!user && msg.job?.id && msg.output?.script ? (
          <SoundPlanEditor
            job={msg.job}
            soundPlan={msg.output?.soundPlan}
            onSave={onSaveSoundPlan}
            onRender={onRenderSoundPlan}
            onImportMedia={onImportMedia}
            loading={soundPlanSaving}
            renderLoading={soundRenderLoading}
            mediaImportLoading={mediaImportLoading}
          />
        ) : null}
        {canShowHeygenAction ? (
          <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs font-bold text-slate-500">Проверь сценарий выше. Только эта кнопка отправляет текст в HeyGen.</div>
            <button
              type="button"
              onClick={() => onStartHeygen?.(msg.job)}
              disabled={!canStartHeygen || heygenLoading === msg.job.id || promptDirty || heygenProfileDirty}
              className="rounded-2xl bg-slate-950 px-4 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {promptDirty ? "Сначала сохрани промпт" : heygenProfileDirty ? "Сначала сохрани настройки HeyGen" : heygenActionLabel}
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
  const telegramChat = publishingStatus?.telegramChat || {};
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
    telegram_token_missing: "нет bot token",
    telegram_chat_missing: "нет chat id",
    chat_not_found: "чат не найден",
    forbidden: "бот без доступа",
    telegram_unreachable: "Telegram недоступен",
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
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">Telegram chat</span>
              <b className={telegramChat.ok ? "text-emerald-700" : "text-rose-700"}>{telegramChat.ok ? "ready" : "problem"}</b>
            </div>
            <div className="mt-2 space-y-1 text-xs">
              {telegramChat.chatIdMasked ? (
                <div className="flex justify-between rounded-xl bg-white px-3 py-2"><span>Target</span><b className="text-slate-950">{telegramChat.chatIdMasked}</b></div>
              ) : null}
              <div className="rounded-xl bg-white px-3 py-2 font-bold text-slate-600">
                {telegramChat.message || (telegramChat.ok ? "Telegram готов к публикации." : "Проверь Telegram-настройки.")}
              </div>
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

function clearTelegramPublicationEvidence(patch = {}) {
  return {
    ...patch,
    published: false,
    publishedAt: null,
    url: "",
    messageId: null,
    chatId: null,
    deliveryMethod: "",
    deliveryLog: [],
  };
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

function PublishingManagerBoard({ videos, onSavePublicationStatus, onPublishTelegram, packageLoading, publishLoading, publishFeedback, telegramReady, telegramChat }) {
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
  const telegramBlockedMessage = telegramChat?.message || "Telegram публикация недоступна. Проверь настройки backend.";
  const telegramDisabledLabel = telegramChat?.reason === "chat_not_found"
    ? "Чат не найден"
    : telegramChat?.reason === "forbidden"
      ? "Бот без доступа"
      : telegramChat?.reason === "telegram_token_missing"
        ? "Bot token нет"
        : telegramChat?.reason === "telegram_chat_missing"
          ? "Chat ID нет"
          : "Telegram не готов";
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
            ...patch(current?.[channelId] || {}, channelId),
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
                title={!telegramReady ? telegramBlockedMessage : ""}
              >
                {telegramReady ? `Опубликовать Telegram (${bulkTelegramTargets.length})` : telegramDisabledLabel}
              </button>
              <button
                type="button"
                onClick={retryTelegramErrors}
                disabled={!retryTelegramTargets.length || !telegramReady || bulkLoading}
                className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-rose-700 ring-1 ring-rose-100 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                title={!telegramReady ? telegramBlockedMessage : ""}
              >
                {telegramReady ? `Повторить ошибки (${retryTelegramTargets.length})` : telegramDisabledLabel}
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
                onClick={() => applyBulkPatch((item, channelId) => (
                  channelId === "telegram"
                    ? clearTelegramPublicationEvidence()
                    : { published: false, publishedAt: null }
                ))}
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
                              onChange={(e) => updateChannel(
                                video,
                                channel.id,
                                channel.id === "telegram" && !e.target.checked
                                  ? clearTelegramPublicationEvidence()
                                  : { published: e.target.checked }
                              )}
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
                                    ? telegramBlockedMessage
                                    : telegramPublishedEvidence
                                      ? "У карточки уже есть Telegram публикация"
                                      : ""
                                }
                              >
                                {telegramPublishedEvidence ? "Уже есть пост" : publishLoading === video.jobId ? "Публикую..." : telegramReady ? "Опубликовать" : telegramDisabledLabel}
                              </button>
                            ) : null}
                            {channel.id === "telegram" && telegramPublishedEvidence ? (
                              <button
                                type="button"
                                onClick={() => updateChannel(video, "telegram", clearTelegramPublicationEvidence())}
                                disabled={loading || publishLoading === video.jobId}
                                className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-rose-700 ring-1 ring-rose-100 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                                title="Очистить ссылку, messageId и delivery log старого Telegram-поста"
                              >
                                Сбросить пост
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
  const [scriptSaving, setScriptSaving] = React.useState("");
  const [soundPlanSaving, setSoundPlanSaving] = React.useState("");
  const [soundRenderLoading, setSoundRenderLoading] = React.useState("");
  const [mediaImportLoading, setMediaImportLoading] = React.useState("");
  const [versionLoading, setVersionLoading] = React.useState("");
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
  const [videoProfileDraft, setVideoProfileDraft] = React.useState({ avatarId: "", voiceId: "", engine: "avatar_iv", voiceSpeed: 1, expressiveness: "medium", aspectRatio: "9:16", resolution: "1080p" });
  const [videoPresetsDraft, setVideoPresetsDraft] = React.useState({
    avatars: HEYGEN_AVATAR_PRESETS,
    voices: HEYGEN_VOICE_PRESETS,
  });
  const [videoPresetModal, setVideoPresetModal] = React.useState(null);
  const [heygenSettingsOpen, setHeygenSettingsOpen] = React.useState(false);
  const [heygenConfirm, setHeygenConfirm] = React.useState(null);
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
      engine: profile.engine || "avatar_iv",
      voiceSpeed: Number(profile.voiceSpeed || 1),
      expressiveness: profile.expressiveness || "medium",
      aspectRatio: profile.aspectRatio || profile.format || "9:16",
      resolution: profile.resolution || "1080p",
    });
  }, [
    status?.video?.runtimeProfile?.avatarId,
    status?.video?.runtimeProfile?.voiceId,
    status?.video?.runtimeProfile?.engine,
    status?.video?.runtimeProfile?.voiceSpeed,
    status?.video?.runtimeProfile?.expressiveness,
    status?.video?.runtimeProfile?.aspectRatio,
    status?.video?.runtimeProfile?.resolution,
  ]);
  React.useEffect(() => {
    const presets = status?.video?.runtimePresets || {};
    setVideoPresetsDraft({
      avatars: Array.isArray(presets.avatars) && presets.avatars.length ? presets.avatars : HEYGEN_AVATAR_PRESETS,
      voices: Array.isArray(presets.voices) && presets.voices.length ? presets.voices : HEYGEN_VOICE_PRESETS,
    });
  }, [status?.video?.runtimePresets?.updatedAt, status?.video?.runtimePresets?.avatars, status?.video?.runtimePresets?.voices]);
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

  function requestHeygenStart(job, options = {}) {
    if (!job?.id || heygenLoading) return;
    setHeygenConfirm({ job, regenerate: Boolean(options.regenerate) });
  }

  async function startHeygen(job, options = {}) {
    if (!job?.id || heygenLoading) return;
    const regenerate = Boolean(options.regenerate);
    setHeygenLoading(job.id);
    setHeygenConfirm(null);
    setError("");
    addMessage({ role: "assistant", text: regenerate ? `Запускаю новую версию HeyGen для задачи #${job.id}.` : `Получил ручное утверждение сценария. Отправляю в HeyGen задачу #${job.id}.` });
    try {
      const res = await apiPost(`/api/admin/ai-platform/video-operator/jobs/${job.id}/heygen/start`, { regenerate }, "admin");
      const nextJob = res?.job || null;
      const output = res?.output || nextJob?.output || null;
      setCurrentTask(nextJob);
      updateJobMessages(nextJob, output);
      addMessage({
        role: "assistant",
        text: output?.heygen?.videoId
          ? `HeyGen принял версию v${output.heygen.version || 1}. Video ID: ${output.heygen.videoId}`
          : `HeyGen принял версию v${output?.heygen?.version || 1}.`,
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

  async function selectHeygenVersion(job, version) {
    if (!job?.id || versionLoading) return;
    setVersionLoading(job.id);
    setError("");
    try {
      const res = await apiPatch(`/api/admin/ai-platform/video-operator/jobs/${job.id}/heygen/active`, { version }, "admin");
      const nextJob = res?.job || null;
      const output = res?.output || nextJob?.output || null;
      setCurrentTask(nextJob);
      updateJobMessages(nextJob, output);
      addMessage({
        role: "assistant",
        text: `Активная версия HeyGen: v${output?.heygen?.version || version}. Content Manager и Publishing Manager будут брать её.`,
        events: nextJob?.events || [],
        output,
        job: nextJob,
      });
      await load();
    } catch (e) {
      const msg = e?.message || "Не удалось выбрать активную версию HeyGen";
      setError(msg);
      addMessage({ role: "assistant", text: `Не смог переключить версию HeyGen.\n\nПричина: ${msg}` });
      await load();
    } finally {
      setVersionLoading("");
    }
  }

  async function saveJobScript(job, script, motionPrompt = "") {
    if (!job?.id || scriptSaving) return;
    setScriptSaving(job.id);
    setError("");
    try {
      const res = await apiPatch(`/api/admin/ai-platform/video-operator/jobs/${job.id}/script`, { script, motionPrompt }, "admin");
      const nextJob = res?.job || null;
      const output = res?.output || nextJob?.output || null;
      setCurrentTask(nextJob);
      updateJobMessages(nextJob, output);
      addMessage({
        role: "assistant",
        text: "Сценарий сохранён. Теперь можно отправлять в HeyGen.",
        events: nextJob?.events || [],
        output,
        job: nextJob,
      });
      await load();
    } catch (e) {
      const msg = e?.message || "Не удалось сохранить сценарий";
      setError(msg);
      addMessage({ role: "assistant", text: `Не смог сохранить сценарий.\n\nПричина: ${msg}` });
      await load();
    } finally {
      setScriptSaving("");
    }
  }

  async function saveSoundPlan(job, soundPlan = null) {
    if (!job?.id || soundPlanSaving) return;
    setSoundPlanSaving(job.id);
    setError("");
    try {
      const res = await apiPatch(`/api/admin/ai-platform/video-operator/jobs/${job.id}/sound-plan`, { soundPlan }, "admin");
      const nextJob = res?.job || null;
      const output = res?.output || nextJob?.output || null;
      setCurrentTask(nextJob);
      updateJobMessages(nextJob, output);
      addMessage({
        role: "assistant",
        text: `Sound Director готов: ${output?.soundPlan?.effects?.length || 0} SFX + музыка ${output?.soundPlan?.music?.label || output?.soundPlan?.music?.assetId || ""}.`,
        events: nextJob?.events || [],
        output,
        job: nextJob,
      });
      await load();
    } catch (e) {
      const msg = e?.message || "Не удалось сохранить sound plan";
      setError(msg);
      addMessage({ role: "assistant", text: `Sound Director не сохранился.\n\nПричина: ${msg}` });
      await load();
    } finally {
      setSoundPlanSaving("");
    }
  }

  async function renderSoundPlan(job) {
    if (!job?.id || soundRenderLoading) return;
    setSoundRenderLoading(job.id);
    setError("");
    addMessage({ role: "assistant", text: `Sound Studio: свожу музыку и SFX для задачи #${job.id}.` });
    try {
      const res = await apiPost(`/api/admin/ai-platform/video-operator/jobs/${job.id}/sound-plan/render`, {}, "admin");
      const nextJob = res?.job || null;
      const output = res?.output || nextJob?.output || null;
      setCurrentTask(nextJob);
      updateJobMessages(nextJob, output);
      addMessage({
        role: "assistant",
        text: output?.soundPlan?.render?.artifact?.url
          ? "MP4 со звуком готов и сохранён в Travella Media."
          : "Sound Studio завершил сведение звука.",
        events: nextJob?.events || [],
        output,
        job: nextJob,
      });
      await load();
    } catch (e) {
      const msg = e?.message || "Не удалось свести звук";
      setError(msg);
      addMessage({ role: "assistant", text: `Sound Studio не смог свести звук.\n\nПричина: ${msg}` });
      await load();
    } finally {
      setSoundRenderLoading("");
    }
  }

  async function importTimelineMedia(job, file) {
    if (!job?.id || !file || mediaImportLoading) return null;
    setMediaImportLoading(job.id);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiPostForm(`/api/admin/ai-platform/video-operator/jobs/${job.id}/media`, form, "admin");
      const nextJob = res?.job || null;
      const output = res?.output || nextJob?.output || null;
      setCurrentTask(nextJob);
      updateJobMessages(nextJob, output);
      addMessage({
        role: "assistant",
        text: `Медиатека: файл "${res?.media?.label || file.name}" добавлен в Timeline Studio.`,
        events: nextJob?.events || [],
        output,
        job: nextJob,
      });
      await load();
      return res;
    } catch (e) {
      const msg = e?.message || "Не удалось импортировать медиа";
      setError(msg);
      addMessage({ role: "assistant", text: `Медиатека не смогла импортировать файл.\n\nПричина: ${msg}` });
      await load();
      return null;
    } finally {
      setMediaImportLoading("");
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

  async function saveVideoPresets(nextPresets) {
    setVideoProfileLoading(true);
    setError("");
    try {
      const res = await apiPatch("/api/admin/ai-platform/settings/video-presets", nextPresets, "admin");
      setVideoPresetsDraft({
        avatars: res?.video?.runtimePresets?.avatars || nextPresets.avatars || [],
        voices: res?.video?.runtimePresets?.voices || nextPresets.voices || [],
      });
      setStatus((prev) => ({
        ...(prev || {}),
        video: {
          ...(prev?.video || {}),
          ...(res?.video || {}),
        },
      }));
      await load();
    } catch (e) {
      setError(e?.message || "Не удалось сохранить список Avatar / Voice");
      await load();
    } finally {
      setVideoProfileLoading(false);
    }
  }

  function videoPresetKindMeta(kind) {
    return kind === "avatars"
      ? { title: "аватар", titleGenitive: "аватара", idLabel: "Avatar ID", field: "avatarId" }
      : { title: "голос", titleGenitive: "голоса", idLabel: "Voice ID", field: "voiceId" };
  }

  function addVideoPreset(kind) {
    if (videoProfileLoading) return;
    const meta = videoPresetKindMeta(kind);
    const currentValue = videoProfileDraft[meta.field] || "";
    setVideoPresetModal({
      mode: "add",
      kind,
      label: `MY${(videoPresetsDraft[kind] || []).length + 1}`,
      value: currentValue,
      error: "",
    });
  }

  function deleteVideoPreset(kind) {
    if (videoProfileLoading) return;
    const selectedValue = kind === "avatars" ? videoProfileDraft.avatarId : videoProfileDraft.voiceId;
    const selected = (videoPresetsDraft[kind] || []).find((item) => item.value === selectedValue);
    if (!selected) return;
    setVideoPresetModal({ mode: "delete", kind, item: selected, error: "" });
  }

  function closeVideoPresetModal() {
    if (!videoProfileLoading) setVideoPresetModal(null);
  }

  function updateVideoPresetModal(patch) {
    setVideoPresetModal((prev) => (prev ? { ...prev, ...patch, error: "" } : prev));
  }

  async function confirmVideoPresetModal() {
    if (!videoPresetModal || videoProfileLoading) return;
    const kind = videoPresetModal.kind;
    const meta = videoPresetKindMeta(kind);
    if (videoPresetModal.mode === "add") {
      const label = String(videoPresetModal.label || "").trim();
      const value = String(videoPresetModal.value || "").trim();
      if (!label || !value) {
        setVideoPresetModal((prev) => (prev ? { ...prev, error: "Заполни название и ID preset’а." } : prev));
        return;
      }
      const nextItem = { label, value };
      const nextPresets = {
        avatars: videoPresetsDraft.avatars || [],
        voices: videoPresetsDraft.voices || [],
        [kind]: [...(videoPresetsDraft[kind] || []).filter((item) => item.value !== nextItem.value), nextItem],
      };
      setVideoProfileDraft((prev) => ({ ...prev, [meta.field]: nextItem.value }));
      setVideoPresetModal(null);
      await saveVideoPresets(nextPresets);
      return;
    }
    if (videoPresetModal.mode === "delete") {
      const value = videoPresetModal.item?.value;
      if (!value) return;
      const nextPresets = {
        avatars: videoPresetsDraft.avatars || [],
        voices: videoPresetsDraft.voices || [],
        [kind]: (videoPresetsDraft[kind] || []).filter((item) => item.value !== value),
      };
      setVideoPresetModal(null);
      await saveVideoPresets(nextPresets);
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
    const nextQueueState = Number.isFinite(nextQueuePlannedMs) && nextQueuePlannedMs > 0 && nextQueuePlannedMs <= Date.now() ? "к запуску" : "в плане";
    const nextQueueAge = nextQueueState === "к запуску" ? ` · ждёт ${Math.max(0, Math.round((Date.now() - nextQueuePlannedMs) / 60000))} мин` : "";
    const reportDue = Number(queue.due || 0);
    const reportBatchLimit = Number(publishing.schedulerBatchLimit || 5);
    const reportWillPublish = Math.min(reportDue, reportBatchLimit);
    const reportRemaining = Math.max(0, reportDue - reportWillPublish);
    const manualRunState = publishing.telegramDueRun?.running
      ? "недоступно: уже выполняется"
      : reportDue > 0
        ? `готово: ${reportDue} · будет опубликовано ${reportWillPublish}${reportRemaining ? ` · останется ${reportRemaining}` : ""}`
        : "недоступно: нет задач к запуску";
    const rows = [
      "Travella AI OS · Publishing Manager · Telegram scheduler",
      `Scheduler: ${publishing.schedulerEnabled ? "включён" : "выключен"} (${publishing.schedulerReadyReason || "неизвестно"})`,
      `Состояние: ${publishing.telegramDueRun?.running ? "выполняется" : "ожидает"}`,
      `Ручной запуск: ${manualRunState}`,
      `Лимит batch: ${reportDue > reportBatchLimit ? "сработает" : "не сработает"} (${reportBatchLimit})`,
      `Очередь: к запуску ${queue.due ?? 0}, в плане ${queue.planned ?? 0}`,
      queue.next ? `Следующая: ${queue.next.code || queue.next.jobId || "AI"} · ${nextQueueState}${nextQueueAge} · ${fmtDate(queue.next.plannedAt)}` : "Следующая: нет",
      nextSchedulerCheck ? `Следующая проверка scheduler: ${fmtDate(nextSchedulerCheck)}${nextSchedulerCheckOverdue ? " · просрочена" : ""}` : "",
      "",
      run
        ? `Последний запуск: ${run.success ? "ok" : "ошибка"} · ${fmtDate(run.finishedAt || run.startedAt)} · проверено ${run.checked || 0}, опубликовано ${run.published || 0}, ошибок ${run.failed || 0}`
        : "Последний запуск: нет",
      run?.actor ? `Кто запустил: ${run.actor}` : "",
      run?.durationMs ? `Длительность: ${Math.round(Number(run.durationMs || 0) / 1000)} сек` : "",
      ...(Array.isArray(run?.resultsPreview) && run.resultsPreview.length
        ? ["", "Результаты:", ...run.resultsPreview.map((item) => {
            const state = item.success ? (item.deliveryMethod || "ok") : "ошибка";
            const message = item.message ? ` · ${item.message}` : "";
            const link = item.url ? ` · ${item.url}` : "";
            return `- ${item.code || item.jobId || "AI"}: ${state}${message}${link}`;
          })]
        : []),
      run?.resultsOverflow ? `+${run.resultsOverflow} ещё` : "",
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

  function hydrateMessageFromJobs(msg = {}) {
    const jobId = msg.job?.id;
    if (!jobId) return msg;
    const freshJob =
      jobs.find((job) => String(job.id) === String(jobId)) ||
      (String(currentTask?.id || "") === String(jobId) ? currentTask : null);
    if (!freshJob) return msg;
    return {
      ...msg,
      job: freshJob,
      output: freshJob.output || msg.output,
      events: Array.isArray(freshJob.events) && freshJob.events.length ? freshJob.events : msg.events,
      text: freshJob.output?.nextStep || msg.text,
    };
  }

  const employeesCount = status?.employees?.length || 1;
  const activeTasks = jobs.filter((j) => ["created", "queued", "running", "processing"].includes(String(j.status || "").toLowerCase())).length;
  const videosToday = jobs.filter((j) => isToday(j.createdAt) && String(j.type || "").includes("video")).length;
  const readyVideos = videos.length;
  const heygenReady = Boolean(status?.video?.heygenReady);
  const aiEnabled = Boolean(status?.video?.enabled);
  const artifactStorageReady = Boolean(status?.video?.artifactStorage?.provider);
  const runtimeProfile = status?.video?.runtimeProfile || {};
  const avatarPresets = Array.isArray(videoPresetsDraft.avatars) ? videoPresetsDraft.avatars : [];
  const voicePresets = Array.isArray(videoPresetsDraft.voices) ? videoPresetsDraft.voices : [];
  const selectedAvatarPreset = avatarPresets.find((avatar) => avatar.value === videoProfileDraft.avatarId);
  const selectedVoicePreset = voicePresets.find((voice) => voice.value === videoProfileDraft.voiceId);
  const profileDirty =
    String(videoProfileDraft.avatarId || "") !== String(runtimeProfile.avatarId || "") ||
    String(videoProfileDraft.voiceId || "") !== String(runtimeProfile.voiceId || "") ||
    String(videoProfileDraft.engine || "avatar_iv") !== String(runtimeProfile.engine || "avatar_iv") ||
    Number(videoProfileDraft.voiceSpeed || 1) !== Number(runtimeProfile.voiceSpeed || 1) ||
    String(videoProfileDraft.expressiveness || "medium") !== String(runtimeProfile.expressiveness || "medium") ||
    String(videoProfileDraft.aspectRatio || "9:16") !== String(runtimeProfile.aspectRatio || "9:16") ||
    String(videoProfileDraft.resolution || "1080p") !== String(runtimeProfile.resolution || "1080p");
  const videoPresetModalMeta = videoPresetModal ? videoPresetKindMeta(videoPresetModal.kind) : null;
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
  const heygenConfirmJob = heygenConfirm?.job || null;
  const heygenConfirmOutput = heygenConfirmJob?.output || {};
  const heygenConfirmVersions = getHeygenVersions(heygenConfirmOutput);
  const heygenConfirmNextVersion = heygenConfirm?.regenerate
    ? Math.max(0, ...heygenConfirmVersions.map((item) => Number(item.version || 0))) + 1
    : Number(heygenConfirmOutput.heygen?.version || 1);
  const heygenConfirmProfile = profileDirty ? videoProfileDraft : runtimeProfile;
  const heygenConfirmDuration = estimateHeygenDurationStats(heygenConfirmOutput.script || "", heygenConfirmProfile.voiceSpeed || 1);
  const heygenConfirmGuard = getHeygenFormatGuard(heygenConfirmProfile, heygenConfirmOutput.script || "");

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
            telegramChat={status?.publishing?.telegramChat}
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
                    value={selectedAvatarPreset?.value || ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value) setVideoProfileDraft((prev) => ({ ...prev, avatarId: value }));
                    }}
                    className="h-8 w-[116px] rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-950 outline-none focus:border-slate-300"
                  >
                    {!selectedAvatarPreset ? <option value="">Аватар</option> : null}
                    {avatarPresets.map((avatar) => (
                      <option key={avatar.value} value={avatar.value}>Аватар {avatar.label}</option>
                    ))}
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
                    value={selectedVoicePreset?.value || ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value) setVideoProfileDraft((prev) => ({ ...prev, voiceId: value }));
                    }}
                    className="h-8 w-[116px] rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-950 outline-none focus:border-slate-300"
                  >
                    {!selectedVoicePreset ? <option value="">Голос</option> : null}
                    {voicePresets.map((voice) => (
                      <option key={voice.value} value={voice.value}>{voice.label}</option>
                    ))}
                  </select>
                  {!selectedVoicePreset ? (
                    <input
                      value={videoProfileDraft.voiceId}
                      onChange={(e) => setVideoProfileDraft((prev) => ({ ...prev, voiceId: e.target.value }))}
                      placeholder="Voice ID"
                      className="h-8 w-[190px] rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-950 outline-none placeholder:text-slate-400 focus:border-slate-300"
                    />
                  ) : null}
                  <span className="inline-flex h-8 items-center rounded-xl bg-white px-3 text-xs font-black text-slate-600 ring-1 ring-slate-200">
                    {videoProfileDraft.aspectRatio || "9:16"} · {videoProfileDraft.resolution || "1080p"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setHeygenSettingsOpen(true)}
                    disabled={videoProfileLoading}
                    className={cn(
                      "h-8 rounded-xl px-3 text-xs font-black ring-1 transition disabled:opacity-40",
                      profileDirty ? "bg-amber-50 text-amber-800 ring-amber-200 hover:bg-amber-100" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-100"
                    )}
                  >
                    Настройки HeyGen{profileDirty ? " *" : ""}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="h-[640px] space-y-4 overflow-y-auto bg-slate-50/60 p-4 md:p-6">
            {messages.map((m) => {
              const hydratedMessage = hydrateMessageFromJobs(m);
              return (
                <Message
                  key={m.id}
                  msg={hydratedMessage}
                  onStartHeygen={requestHeygenStart}
                  onRefreshHeygen={refreshHeygen}
                  onSaveScript={saveJobScript}
                  onSaveSoundPlan={saveSoundPlan}
                  onRenderSoundPlan={renderSoundPlan}
                  onImportMedia={importTimelineMedia}
                  onSelectHeygenVersion={selectHeygenVersion}
                  canStartHeygen={aiEnabled && heygenReady}
                  aiVideoEnabled={aiEnabled}
                  heygenReady={heygenReady}
                  heygenLoading={heygenLoading}
                  refreshLoading={refreshLoading}
                  scriptSaving={scriptSaving}
                  soundPlanSaving={soundPlanSaving}
                  soundRenderLoading={soundRenderLoading}
                  mediaImportLoading={mediaImportLoading}
                  versionLoading={versionLoading}
                  runtimeProfile={runtimeProfile}
                  runtimePresets={videoPresetsDraft}
                  heygenProfileDirty={profileDirty}
                />
              );
            })}
            {loading ? <Message msg={{ role: "assistant", text: "🧠 Думаю...\n⚙️ Вызываю нужные инструменты Travella AI Runtime..." }} /> : null}
            <div ref={endRef} />
          </div>

          <div className="border-t border-slate-100 p-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
              {selectedEmployee === "video_operator" ? (
                <div className="group mb-3 overflow-hidden rounded-2xl bg-slate-50 p-2 ring-1 ring-slate-100 transition-all duration-300 hover:bg-white focus-within:bg-white">
                  <div className="flex flex-col gap-2 px-2 py-1.5 text-xs font-bold text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="rounded-full bg-slate-950 px-2.5 py-1 font-black text-white">Быстрые задачи</span>
                      <span className="truncate">
                        {selectedService
                          ? `${selectedService.displayCode || selectedService.taskCode} · ${selectedService.title || selectedService.destination || "выбранное предложение"}`
                          : "выбери отказ или напиши задачу обычным языком"}
                      </span>
                    </div>
                    <span className="font-black text-slate-400">Наведи, чтобы открыть marketplace</span>
                  </div>
                  <div className="max-h-0 space-y-3 overflow-hidden opacity-0 transition-all duration-300 group-hover:max-h-[560px] group-hover:opacity-100 group-focus-within:max-h-[560px] group-focus-within:opacity-100">
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
                    <div className="flex flex-wrap gap-2 px-1 pb-1">
                      {quickVideoCommands.map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => runTaskText(item.command)}
                          disabled={loading}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-40"
                          title={item.command}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
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
      {heygenConfirm ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !heygenLoading) setHeygenConfirm(null);
          }}
        >
          <div className="w-full max-w-[620px] rounded-[28px] border border-slate-200 bg-white p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="heygen-confirm-title">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-black uppercase tracking-wide text-amber-600">HeyGen cost guard</div>
                <h3 id="heygen-confirm-title" className="mt-1 text-xl font-black text-slate-950">
                  {heygenConfirm.regenerate ? `Создать новую версию v${heygenConfirmNextVersion}` : "Отправить сценарий в HeyGen"}
                </h3>
                <p className="mt-1 text-xs font-bold text-slate-500">Это создаст новый HeyGen video. Проверь настройки перед запуском.</p>
              </div>
              <button
                type="button"
                onClick={() => setHeygenConfirm(null)}
                disabled={Boolean(heygenLoading)}
                className="h-9 w-9 rounded-full bg-slate-50 text-lg font-black text-slate-400 ring-1 ring-slate-200 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                aria-label="Закрыть"
              >
                ×
              </button>
            </div>
            <HeygenGenerationPreview
              profile={heygenConfirmProfile}
              presets={videoPresetsDraft}
              script={heygenConfirmOutput.script || ""}
              dirty={profileDirty}
            />
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <div className="rounded-2xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Версия</div>
                <div className="mt-0.5 text-sm font-black text-slate-950">v{heygenConfirmNextVersion}</div>
              </div>
              <div className="rounded-2xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Оценка длительности</div>
                <div className="mt-0.5 text-sm font-black text-slate-950">{heygenConfirmDuration.label}</div>
              </div>
              <div className="rounded-2xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Слова</div>
                <div className="mt-0.5 text-sm font-black text-slate-950">{heygenConfirmDuration.words || "—"}</div>
              </div>
            </div>
            {profileDirty ? (
              <div className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-black text-amber-800 ring-1 ring-amber-100">
                Настройки HeyGen изменены, но ещё не сохранены. Сначала сохрани профиль, чтобы эти значения ушли в API.
              </div>
            ) : null}
            {heygenConfirmGuard.tone === "yellow" ? (
              <div className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-black text-amber-800 ring-1 ring-amber-100">
                Форматный guard: {heygenConfirmGuard.label}
              </div>
            ) : null}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setHeygenConfirm(null)}
                disabled={Boolean(heygenLoading)}
                className="h-11 rounded-2xl bg-slate-50 px-5 text-sm font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100 disabled:opacity-40"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => startHeygen(heygenConfirmJob, { regenerate: heygenConfirm.regenerate })}
                disabled={!heygenConfirmJob?.id || Boolean(heygenLoading) || profileDirty}
                className="h-11 rounded-2xl bg-slate-950 px-5 text-sm font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                {heygenLoading ? "Запускаю..." : heygenConfirm.regenerate ? "Создать новую версию" : "Создать видео HeyGen"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {heygenSettingsOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !videoProfileLoading) setHeygenSettingsOpen(false);
          }}
        >
          <div
            className="max-h-[92vh] w-full max-w-[560px] overflow-y-auto rounded-[28px] border border-slate-200 bg-white p-5 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="heygen-settings-title"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !videoProfileLoading) setHeygenSettingsOpen(false);
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-black uppercase tracking-wide text-slate-400">Профиль генерации HeyGen</div>
                <h3 id="heygen-settings-title" className="mt-1 text-xl font-black text-slate-950">Настройки HeyGen</h3>
              </div>
              <button
                type="button"
                onClick={() => setHeygenSettingsOpen(false)}
                disabled={videoProfileLoading}
                className="h-9 w-9 rounded-full bg-slate-50 text-lg font-black text-slate-400 ring-1 ring-slate-200 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                aria-label="Закрыть"
              >
                ×
              </button>
            </div>

            <div className="mt-5 rounded-3xl bg-blue-50 p-4 ring-1 ring-blue-100">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-wide text-blue-700">Быстрый профиль</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">Выставляет формат, качество и базовую подачу для канала.</div>
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {HEYGEN_DELIVERY_PRESETS.map((preset) => {
                  const active =
                    String(videoProfileDraft.aspectRatio || "9:16") === preset.profile.aspectRatio &&
                    String(videoProfileDraft.resolution || "1080p") === preset.profile.resolution &&
                    String(videoProfileDraft.engine || "avatar_iv") === preset.profile.engine &&
                    Number(videoProfileDraft.voiceSpeed || 1) === Number(preset.profile.voiceSpeed) &&
                    String(videoProfileDraft.expressiveness || "medium") === preset.profile.expressiveness;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setVideoProfileDraft((prev) => ({ ...prev, ...preset.profile }))}
                      disabled={videoProfileLoading}
                      className={cn(
                        "min-h-[64px] rounded-2xl px-3 py-2 text-left ring-1 transition disabled:cursor-not-allowed disabled:opacity-40",
                        active ? "bg-blue-700 text-white ring-blue-700" : "bg-white text-slate-800 ring-blue-100 hover:bg-blue-100"
                      )}
                    >
                      <span className="block text-xs font-black">{preset.label}</span>
                      <span className={cn("mt-1 block text-[11px] font-bold", active ? "text-white/75" : "text-slate-400")}>{preset.helper}</span>
                      <span className={cn("mt-1 block text-[10px] font-black", active ? "text-white/80" : "text-blue-700")}>{preset.profile.aspectRatio} · {preset.profile.resolution}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-black uppercase tracking-wide text-slate-500">Аватар</span>
                <div className="mt-2 flex gap-2">
                  <select
                    value={selectedAvatarPreset?.value || ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value) setVideoProfileDraft((prev) => ({ ...prev, avatarId: value }));
                    }}
                    className="h-11 min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-950 outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-50"
                  >
                    {!selectedAvatarPreset ? <option value="">Аватар</option> : null}
                    {avatarPresets.map((avatar) => (
                      <option key={avatar.value} value={avatar.value}>Аватар {avatar.label}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => { setHeygenSettingsOpen(false); addVideoPreset("avatars"); }} disabled={videoProfileLoading} className="h-11 w-11 rounded-2xl bg-slate-50 text-sm font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100 disabled:opacity-40">+</button>
                  <button type="button" onClick={() => { setHeygenSettingsOpen(false); deleteVideoPreset("avatars"); }} disabled={videoProfileLoading || !selectedAvatarPreset} className="h-11 rounded-2xl bg-rose-50 px-3 text-xs font-black text-rose-600 ring-1 ring-rose-100 hover:bg-rose-100 disabled:bg-slate-50 disabled:text-slate-300">Удалить</button>
                </div>
              </label>

              <label className="block">
                <span className="text-xs font-black uppercase tracking-wide text-slate-500">Голос</span>
                <div className="mt-2 flex gap-2">
                  <select
                    value={selectedVoicePreset?.value || ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value) setVideoProfileDraft((prev) => ({ ...prev, voiceId: value }));
                    }}
                    className="h-11 min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-950 outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-50"
                  >
                    {!selectedVoicePreset ? <option value="">Голос</option> : null}
                    {voicePresets.map((voice) => (
                      <option key={voice.value} value={voice.value}>{voice.label}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => { setHeygenSettingsOpen(false); addVideoPreset("voices"); }} disabled={videoProfileLoading} className="h-11 w-11 rounded-2xl bg-slate-50 text-sm font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100 disabled:opacity-40">+</button>
                  <button type="button" onClick={() => { setHeygenSettingsOpen(false); deleteVideoPreset("voices"); }} disabled={videoProfileLoading || !selectedVoicePreset} className="h-11 rounded-2xl bg-rose-50 px-3 text-xs font-black text-rose-600 ring-1 ring-rose-100 hover:bg-rose-100 disabled:bg-slate-50 disabled:text-slate-300">Удалить</button>
                </div>
              </label>
            </div>

            <div className="mt-5 space-y-4 rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-100">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-black uppercase tracking-wide text-slate-500">Формат</span>
                  <span className="text-xs font-bold text-slate-400">кадр видео</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {HEYGEN_ASPECT_RATIO_OPTIONS.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setVideoProfileDraft((prev) => ({ ...prev, aspectRatio: item.value }))}
                      className={cn(
                        "min-h-[54px] rounded-2xl px-2 text-center ring-1 transition",
                        videoProfileDraft.aspectRatio === item.value ? "bg-slate-950 text-white ring-slate-950" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-100"
                      )}
                    >
                      <span className="block text-sm font-black">{item.label}</span>
                      <span className={cn("mt-0.5 block text-[10px] font-bold", videoProfileDraft.aspectRatio === item.value ? "text-white/65" : "text-slate-400")}>{item.helper}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-black uppercase tracking-wide text-slate-500">Разрешение</span>
                  <span className="text-xs font-bold text-slate-400">качество вывода</span>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {HEYGEN_RESOLUTION_OPTIONS.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setVideoProfileDraft((prev) => ({ ...prev, resolution: item.value }))}
                      className={cn(
                        "h-10 rounded-2xl text-xs font-black ring-1 transition",
                        videoProfileDraft.resolution === item.value ? "bg-emerald-600 text-white ring-emerald-600" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-100"
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-black uppercase tracking-wide text-slate-500">Движок</div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {[
                    { value: "avatar_iv", label: "Avatar IV" },
                    { value: "avatar_v", label: "Avatar V" },
                  ].map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setVideoProfileDraft((prev) => ({ ...prev, engine: item.value }))}
                      className={cn(
                        "h-11 rounded-2xl text-sm font-black ring-1 transition",
                        videoProfileDraft.engine === item.value ? "bg-slate-950 text-white ring-slate-950" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-100"
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="block">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-black uppercase tracking-wide text-slate-500">Скорость голоса</span>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-950 ring-1 ring-slate-200">{Number(videoProfileDraft.voiceSpeed || 1).toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="1.5"
                  step="0.05"
                  value={videoProfileDraft.voiceSpeed}
                  onChange={(e) => setVideoProfileDraft((prev) => ({ ...prev, voiceSpeed: Number(e.target.value || 1) }))}
                  className="mt-3 w-full accent-emerald-600"
                />
                <div className="mt-1 flex justify-between text-[11px] font-bold text-slate-400">
                  <span>медленнее</span>
                  <span>быстрее</span>
                </div>
              </label>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-black uppercase tracking-wide text-slate-500">Экспрессия</span>
                  {videoProfileDraft.engine === "avatar_v" ? <span className="text-xs font-bold text-slate-400">только Avatar IV</span> : null}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {[
                    { value: "low", label: "Низкая" },
                    { value: "medium", label: "Средняя" },
                    { value: "high", label: "Высокая" },
                  ].map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      disabled={videoProfileDraft.engine === "avatar_v"}
                      onClick={() => setVideoProfileDraft((prev) => ({ ...prev, expressiveness: item.value }))}
                      className={cn(
                        "h-10 rounded-2xl text-xs font-black ring-1 transition disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400",
                        videoProfileDraft.expressiveness === item.value && videoProfileDraft.engine !== "avatar_v"
                          ? "bg-emerald-600 text-white ring-emerald-600"
                          : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-100"
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setHeygenSettingsOpen(false)}
                disabled={videoProfileLoading}
                className="h-11 rounded-2xl bg-slate-50 px-5 text-sm font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100 disabled:opacity-40"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (profileDirty) await saveVideoProfile();
                  setHeygenSettingsOpen(false);
                }}
                disabled={videoProfileLoading}
                className="h-11 rounded-2xl bg-slate-950 px-5 text-sm font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                {videoProfileLoading ? "Сохраняю..." : profileDirty ? "Сохранить" : "Готово"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {videoPresetModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeVideoPresetModal();
          }}
        >
          <div
            className="w-full max-w-[460px] rounded-[28px] border border-slate-200 bg-white p-5 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="video-preset-modal-title"
            onKeyDown={(e) => {
              if (e.key === "Escape") closeVideoPresetModal();
              if (e.key === "Enter" && videoPresetModal.mode === "add") confirmVideoPresetModal();
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-black uppercase tracking-wide text-slate-400">HeyGen preset</div>
                <h3 id="video-preset-modal-title" className="mt-1 text-xl font-black text-slate-950">
                  {videoPresetModal.mode === "add" ? `Добавить ${videoPresetModalMeta?.title}` : `Удалить ${videoPresetModalMeta?.title}`}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeVideoPresetModal}
                disabled={videoProfileLoading}
                className="h-9 w-9 rounded-full bg-slate-50 text-lg font-black text-slate-400 ring-1 ring-slate-200 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                aria-label="Закрыть"
              >
                ×
              </button>
            </div>

            {videoPresetModal.mode === "add" ? (
              <div className="mt-5 space-y-3">
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-wide text-slate-500">Название {videoPresetModalMeta?.titleGenitive}</span>
                  <input
                    autoFocus
                    value={videoPresetModal.label || ""}
                    onChange={(e) => updateVideoPresetModal({ label: e.target.value })}
                    placeholder="Например: MY3"
                    className="mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-950 outline-none placeholder:text-slate-400 focus:border-emerald-300 focus:ring-4 focus:ring-emerald-50"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-wide text-slate-500">{videoPresetModalMeta?.idLabel}</span>
                  <input
                    value={videoPresetModal.value || ""}
                    onChange={(e) => updateVideoPresetModal({ value: e.target.value })}
                    placeholder={videoPresetModalMeta?.idLabel}
                    className="mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-950 outline-none placeholder:text-slate-400 focus:border-emerald-300 focus:ring-4 focus:ring-emerald-50"
                  />
                </label>
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500">
                  Новый preset сразу попадёт в выпадающий список и станет выбранным для следующих видео.
                </div>
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 ring-1 ring-rose-100">
                  Удалить preset <b>{videoPresetModal.item?.label}</b> из списка HeyGen?
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500 break-all">
                  {videoPresetModal.item?.value}
                </div>
              </div>
            )}

            {videoPresetModal.error ? (
              <div className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-black text-amber-700 ring-1 ring-amber-100">
                {videoPresetModal.error}
              </div>
            ) : null}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeVideoPresetModal}
                disabled={videoProfileLoading}
                className="h-11 rounded-2xl bg-slate-50 px-5 text-sm font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100 disabled:opacity-40"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={confirmVideoPresetModal}
                disabled={videoProfileLoading}
                className={cn(
                  "h-11 rounded-2xl px-5 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400",
                  videoPresetModal.mode === "delete" ? "bg-rose-600 hover:bg-rose-700" : "bg-slate-950 hover:bg-slate-800"
                )}
              >
                {videoProfileLoading ? "Сохраняю..." : videoPresetModal.mode === "delete" ? "Удалить" : "Добавить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
