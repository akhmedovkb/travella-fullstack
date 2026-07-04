// frontend/src/pages/admin/AdminAiPlatform.jsx

import React from "react";
import { apiGet, apiPost } from "../../api";

const EMPTY_TOUR = {
  code: "",
  title: "",
  fromCity: "Ташкент",
  destination: "",
  dates: "",
  hotel: "",
  room: "",
  meal: "",
  people: "2 взрослых",
  price: "",
  currency: "USD",
  flight: "",
  includes: "авиабилет, отель, трансфер, страховка",
  supplier: "",
  urgency: "предложение отказное, поэтому может уйти в любой момент",
};

const EMPLOYEE_MENU = [
  {
    id: "video_operator",
    icon: "🎬",
    title: "Video Operator",
    subtitle: "AI-видео для отказных туров",
    status: "active",
  },
  {
    id: "sales_manager",
    icon: "💼",
    title: "Sales Manager",
    subtitle: "Продажи и быстрые заявки",
    status: "planned",
  },
  {
    id: "content_manager",
    icon: "📝",
    title: "Content Manager",
    subtitle: "Посты, captions, сторис",
    status: "planned",
  },
  {
    id: "support_manager",
    icon: "🎧",
    title: "Support Manager",
    subtitle: "Ответы клиентам и поставщикам",
    status: "planned",
  },
  {
    id: "hotel_auditor",
    icon: "🏨",
    title: "Hotel Auditor",
    subtitle: "Проверка инспекций отелей",
    status: "planned",
  },
  {
    id: "finance_auditor",
    icon: "📊",
    title: "Finance Auditor",
    subtitle: "Баланс, платежи, сверки",
    status: "planned",
  },
  {
    id: "settings",
    icon: "⚙️",
    title: "Settings",
    subtitle: "Ключи, роли, правила AI",
    status: "planned",
  },
];

const WORKFLOW = [
  {
    title: "Источник данных",
    text: "Берём данные тура вручную или из базы Travella.",
  },
  {
    title: "AI-анализ",
    text: "Понимаем направление, цену, срочность и главный оффер.",
  },
  {
    title: "Сценарий",
    text: "Готовим хук, текст диктора и структуру вертикального видео.",
  },
  {
    title: "Выполнение",
    text: "Запускаем HeyGen с твоим аватаром и голосом.",
  },
  {
    title: "Результат",
    text: "Сохраняем задачу, статус и ссылку на видео.",
  },
];

function fmtDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" });
  } catch {
    return String(value);
  }
}

function isToday(value) {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function cn(...items) {
  return items.filter(Boolean).join(" ");
}

function StatusPill({ children, tone = "slate" }) {
  const tones = {
    green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    red: "bg-rose-50 text-rose-700 ring-rose-100",
    yellow: "bg-amber-50 text-amber-700 ring-amber-100",
    blue: "bg-blue-50 text-blue-700 ring-blue-100",
    purple: "bg-violet-50 text-violet-700 ring-violet-100",
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
    black: "bg-slate-950 text-white ring-slate-950",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-black ring-1", tones[tone] || tones.slate)}>
      {children}
    </span>
  );
}

function MetricCard({ label, value, helper, tone = "slate" }) {
  const accents = {
    green: "border-emerald-100 bg-emerald-50/40",
    yellow: "border-amber-100 bg-amber-50/40",
    blue: "border-blue-100 bg-blue-50/40",
    purple: "border-violet-100 bg-violet-50/40",
    slate: "border-slate-200 bg-white",
  };
  return (
    <div className={cn("rounded-3xl border p-5 shadow-sm", accents[tone] || accents.slate)}>
      <div className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-3 text-3xl font-black tracking-tight text-slate-950">{value}</div>
      {helper ? <div className="mt-2 text-xs font-bold text-slate-500">{helper}</div> : null}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, textarea = false }) {
  const cls = "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-100";
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-black uppercase tracking-wide text-slate-500">{label}</span>
      {textarea ? (
        <textarea
          className={cn(cls, "min-h-[92px] resize-y")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <input
          className={cls}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </label>
  );
}

function SourceOption({ title, description, active, disabled, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "w-full rounded-2xl border p-4 text-left transition",
        active ? "border-slate-950 bg-slate-950 text-white shadow-sm" : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
        disabled ? "cursor-not-allowed opacity-50" : ""
      )}
    >
      <div className="text-sm font-black">{title}</div>
      <div className={cn("mt-1 text-xs font-semibold", active ? "text-slate-200" : "text-slate-500")}>{description}</div>
    </button>
  );
}

function EmployeeMenuItem({ item, selected, onClick }) {
  const planned = item.status !== "active";
  return (
    <button
      type="button"
      onClick={() => !planned && onClick(item.id)}
      disabled={planned}
      className={cn(
        "w-full rounded-2xl border p-4 text-left transition",
        selected ? "border-slate-950 bg-slate-950 text-white shadow-sm" : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
        planned ? "cursor-not-allowed opacity-55" : ""
      )}
    >
      <div className="flex items-start gap-3">
        <div className="text-2xl">{item.icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="truncate text-sm font-black">{item.title}</div>
            {planned ? <StatusPill>soon</StatusPill> : <StatusPill tone="green">live</StatusPill>}
          </div>
          <div className={cn("mt-1 text-xs font-semibold", selected ? "text-slate-200" : "text-slate-500")}>{item.subtitle}</div>
        </div>
      </div>
    </button>
  );
}

function WorkflowStep({ step, index, active }) {
  return (
    <div className={cn("rounded-2xl border p-4", active ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white")}> 
      <div className="flex items-center gap-3">
        <div className={cn("flex h-8 w-8 items-center justify-center rounded-full text-sm font-black", active ? "bg-white text-slate-950" : "bg-slate-100 text-slate-700")}>{index + 1}</div>
        <div className="font-black">{step.title}</div>
      </div>
      <div className={cn("mt-2 text-xs font-semibold leading-5", active ? "text-slate-200" : "text-slate-500")}>{step.text}</div>
    </div>
  );
}

function JobCard({ job, onRefresh }) {
  const videoUrl = job?.output?.videoUrl || job?.output?.heygenStatus?.data?.video_url || "";
  const tone = job.status === "completed" ? "green" : job.status === "failed" ? "red" : "yellow";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-black text-slate-950">{job.type || "AI job"}</div>
            <StatusPill tone={tone}>{job.status || "created"}</StatusPill>
          </div>
          <div className="mt-1 text-xs font-semibold text-slate-500">{fmtDate(job.createdAt)}</div>
          {job?.output?.videoId ? <div className="mt-1 text-xs font-semibold text-slate-500">HeyGen video_id: {job.output.videoId}</div> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {job?.output?.videoId ? (
            <button type="button" onClick={() => onRefresh(job.id)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black hover:bg-slate-50">
              Проверить статус
            </button>
          ) : null}
          {videoUrl ? (
            <a href={videoUrl} target="_blank" rel="noreferrer" className="rounded-xl bg-black px-3 py-2 text-xs font-black text-white">
              Открыть видео
            </a>
          ) : null}
        </div>
      </div>
      {job?.error?.message ? <div className="mt-3 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700">{job.error.message}</div> : null}
    </div>
  );
}

export default function AdminAiPlatform() {
  const [status, setStatus] = React.useState(null);
  const [jobs, setJobs] = React.useState([]);
  const [selectedEmployee, setSelectedEmployee] = React.useState("video_operator");
  const [sourceMode, setSourceMode] = React.useState("manual");
  const [tour, setTour] = React.useState(EMPTY_TOUR);
  const [scriptResult, setScriptResult] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  function setField(name, value) {
    setTour((prev) => ({ ...prev, [name]: value }));
  }

  async function load() {
    setError("");
    try {
      const [s, j] = await Promise.all([
        apiGet("/api/admin/ai-platform/status", "admin"),
        apiGet("/api/admin/ai-platform/video-operator/jobs?limit=20", "admin"),
      ]);
      setStatus(s || null);
      setJobs(Array.isArray(j?.jobs) ? j.jobs : []);
    } catch (err) {
      setError(err?.message || "Не удалось загрузить Travella AI Platform");
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  async function generateScript() {
    setLoading(true);
    setError("");
    try {
      const res = await apiPost("/api/admin/ai-platform/video-operator/script", tour, "admin");
      setScriptResult(res.output || null);
      await load();
    } catch (err) {
      setError(err?.message || "Не удалось создать сценарий");
    } finally {
      setLoading(false);
    }
  }

  async function createHeygenVideo() {
    setLoading(true);
    setError("");
    try {
      const res = await apiPost("/api/admin/ai-platform/video-operator/heygen-video", tour, "admin");
      setScriptResult(res.output || null);
      await load();
    } catch (err) {
      setError(err?.message || "Не удалось запустить HeyGen");
    } finally {
      setLoading(false);
    }
  }

  async function refreshJob(jobId) {
    setLoading(true);
    setError("");
    try {
      await apiPost(`/api/admin/ai-platform/video-operator/jobs/${jobId}/refresh`, {}, "admin");
      await load();
    } catch (err) {
      setError(err?.message || "Не удалось обновить статус");
    } finally {
      setLoading(false);
    }
  }

  const video = status?.video || {};
  const employees = Array.isArray(status?.employees) ? status.employees : [];
  const videoEmployee = employees.find((x) => x.id === "video_operator");
  const activeJobs = jobs.filter((job) => ["created", "queued", "processing", "running"].includes(String(job.status || "").toLowerCase())).length;
  const videosToday = jobs.filter((job) => isToday(job.createdAt) && (job?.output?.videoId || job?.output?.videoUrl)).length;
  const heygenReady = Boolean(video.heygenReady);
  const aiVideoEnabled = Boolean(video.enabled);
  const platformHealth = aiVideoEnabled && heygenReady ? "Online" : aiVideoEnabled ? "Needs ENV" : "Disabled";

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 p-6 text-white md:p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-white/80 ring-1 ring-white/15">
                Digital Employees Control Center
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight md:text-4xl">🤖 Travella AI Platform</h1>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-200">
                Центр управления цифровыми сотрудниками Travella: от источника данных до AI-выполнения, результата, истории и метрик.
              </p>
            </div>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-950 hover:bg-slate-100 disabled:opacity-60"
            >
              Обновить
            </button>
          </div>
        </div>
      </div>

      {error ? <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="AI Employees" value={`${employees.length || 1} / 8`} helper="1 активный, остальные по roadmap" tone="blue" />
        <MetricCard label="Active Jobs" value={activeJobs} helper="Задачи в работе сейчас" tone="purple" />
        <MetricCard label="Videos Today" value={videosToday} helper="Создано или запущено сегодня" tone="green" />
        <MetricCard label="AI Health" value={platformHealth} helper={heygenReady ? "HeyGen ENV готов" : "Проверь Railway ENV"} tone={heygenReady ? "green" : "yellow"} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <aside className="space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-black uppercase tracking-wide text-slate-500">Digital Employees</div>
            <div className="mt-4 space-y-3">
              {EMPLOYEE_MENU.map((item) => (
                <EmployeeMenuItem key={item.id} item={item} selected={selectedEmployee === item.id} onClick={setSelectedEmployee} />
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-black uppercase tracking-wide text-slate-500">Platform Standard</div>
            <div className="mt-4 space-y-3">
              {WORKFLOW.map((step, index) => (
                <WorkflowStep key={step.title} step={step} index={index} active={index === 0} />
              ))}
            </div>
          </div>
        </aside>

        <main className="space-y-6">
          {selectedEmployee === "video_operator" ? (
            <>
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-xs font-black uppercase tracking-wide text-slate-500">Marketing Department</div>
                    <h2 className="mt-1 text-2xl font-black text-slate-950">🎬 Travella Video Operator</h2>
                    <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
                      Первый цифровой сотрудник: получает данные отказного тура, готовит хук и сценарий, затем запускает HeyGen с твоим AI-аватаром и голосом.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusPill tone={aiVideoEnabled ? "green" : "red"}>{aiVideoEnabled ? "AI Video включено" : "AI Video выключено"}</StatusPill>
                    <StatusPill tone={heygenReady ? "green" : "yellow"}>{heygenReady ? "HeyGen готов" : "Проверить ENV"}</StatusPill>
                    <StatusPill tone="black">Beta</StatusPill>
                  </div>
                </div>

                {videoEmployee?.capabilities?.length ? (
                  <div className="mt-5 flex flex-wrap gap-2">
                    {videoEmployee.capabilities.map((item) => (
                      <span key={item} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-700">{item}</span>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="grid gap-6 2xl:grid-cols-[1fr_420px]">
                <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h3 className="text-xl font-black text-slate-950">1. Источник данных</h3>
                      <p className="mt-1 text-sm font-semibold text-slate-500">
                        Сейчас активен ручной ввод. Следующим этапом подключим выбор существующего отказного тура из базы.
                      </p>
                    </div>
                    {loading ? <StatusPill tone="yellow">Работает...</StatusPill> : null}
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-3">
                    <SourceOption
                      title="Ввести вручную"
                      description="Рабочий режим сейчас"
                      active={sourceMode === "manual"}
                      onClick={() => setSourceMode("manual")}
                    />
                    <SourceOption
                      title="Выбрать отказной тур"
                      description="Следующий этап"
                      disabled
                    />
                    <SourceOption
                      title="Выбрать авиабилет"
                      description="Roadmap"
                      disabled
                    />
                  </div>

                  <div className="mt-6 grid gap-4 md:grid-cols-2">
                    <Field label="Код" value={tour.code} onChange={(v) => setField("code", v)} placeholder="R857" />
                    <Field label="Название" value={tour.title} onChange={(v) => setField("title", v)} placeholder="Отказной тур в Нячанг" />
                    <Field label="Город вылета" value={tour.fromCity} onChange={(v) => setField("fromCity", v)} placeholder="Ташкент" />
                    <Field label="Направление" value={tour.destination} onChange={(v) => setField("destination", v)} placeholder="Нячанг, Вьетнам" />
                    <Field label="Даты" value={tour.dates} onChange={(v) => setField("dates", v)} placeholder="28.06–05.07.2026" />
                    <Field label="Цена" value={tour.price} onChange={(v) => setField("price", v)} placeholder="3710" />
                    <Field label="Валюта" value={tour.currency} onChange={(v) => setField("currency", v)} placeholder="USD" />
                    <Field label="Размещение" value={tour.people} onChange={(v) => setField("people", v)} placeholder="2ADL+2CHD" />
                    <Field label="Отель" value={tour.hotel} onChange={(v) => setField("hotel", v)} placeholder="Vinpearl Resort & Spa" />
                    <Field label="Номер" value={tour.room} onChange={(v) => setField("room", v)} placeholder="Deluxe Room" />
                    <Field label="Питание" value={tour.meal} onChange={(v) => setField("meal", v)} placeholder="BB / Завтраки" />
                    <Field label="Поставщик" value={tour.supplier} onChange={(v) => setField("supplier", v)} placeholder="Название поставщика" />
                    <div className="md:col-span-2"><Field textarea label="Перелёт" value={tour.flight} onChange={(v) => setField("flight", v)} placeholder="04JUL TAS–IKU 04:30–06:50; 11JUL IKU–TAS 08:10–08:30" /></div>
                    <div className="md:col-span-2"><Field textarea label="Что входит" value={tour.includes} onChange={(v) => setField("includes", v)} placeholder="авиабилет, отель, трансфер, страховка" /></div>
                    <div className="md:col-span-2"><Field textarea label="Срочность" value={tour.urgency} onChange={(v) => setField("urgency", v)} placeholder="предложение отказное, может уйти в любой момент" /></div>
                  </div>

                  <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      onClick={generateScript}
                      disabled={loading}
                      className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                    >
                      2. Создать сценарий
                    </button>
                    <button
                      type="button"
                      onClick={createHeygenVideo}
                      disabled={loading || !heygenReady || !aiVideoEnabled}
                      className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-40"
                    >
                      3. Запустить HeyGen видео
                    </button>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
                    <h3 className="text-xl font-black text-slate-950">AI Preview</h3>
                    {scriptResult ? (
                      <div className="mt-4 space-y-4">
                        <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-100">
                          <div className="text-xs font-black uppercase tracking-wide text-amber-700">Хук первых 3 секунд</div>
                          <div className="mt-2 text-sm font-black leading-6 text-slate-950">{scriptResult.hook}</div>
                        </div>
                        <div className="rounded-2xl bg-slate-950 p-4 text-white">
                          <div className="text-xs font-black uppercase tracking-wide text-slate-300">Текст для AI-аватара</div>
                          <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-7 text-slate-100">{scriptResult.script}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm font-semibold leading-6 text-slate-500">
                        Здесь появится хук и текст для AI-аватара после нажатия “Создать сценарий”.
                      </div>
                    )}
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-xl font-black text-slate-950">Последние задачи</h3>
                      <StatusPill>{jobs.length}</StatusPill>
                    </div>
                    <div className="mt-4 space-y-3">
                      {jobs.length ? jobs.map((job) => <JobCard key={job.id} job={job} onRefresh={refreshJob} />) : <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">Пока задач нет.</div>}
                    </div>
                  </div>
                </div>
              </section>
            </>
          ) : (
            <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              <div className="text-5xl">🚧</div>
              <h2 className="mt-4 text-2xl font-black text-slate-950">Этот AI-сотрудник в roadmap</h2>
              <p className="mt-2 text-sm font-semibold text-slate-500">Сейчас строим фундамент на Video Operator, затем подключим остальных сотрудников.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
