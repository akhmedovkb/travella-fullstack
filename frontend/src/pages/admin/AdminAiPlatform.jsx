// frontend/src/pages/admin/AdminAiPlatform.jsx

import React from "react";
import { apiGet, apiPost } from "../../api";

const EMPLOYEE_MENU = [
  { id: "video_operator", icon: "🎬", title: "Video Operator", subtitle: "AI-видео для отказных туров", status: "active" },
  { id: "sales_manager", icon: "💼", title: "Sales Manager", subtitle: "Продажи и быстрые заявки", status: "planned" },
  { id: "content_manager", icon: "📝", title: "Content Manager", subtitle: "Посты, captions, сторис", status: "planned" },
  { id: "support_manager", icon: "🎧", title: "Support Manager", subtitle: "Ответы клиентам и поставщикам", status: "planned" },
  { id: "hotel_auditor", icon: "🏨", title: "Hotel Auditor", subtitle: "Проверка инспекций отелей", status: "planned" },
  { id: "finance_auditor", icon: "📊", title: "Finance Auditor", subtitle: "Баланс, платежи, сверки", status: "planned" },
  { id: "settings", icon: "⚙️", title: "Settings", subtitle: "Ключи, роли, правила AI", status: "planned" },
];

const WORKFLOW = [
  { key: "source", label: "Источник данных", text: "Найти реальный тур в базе Travella по R-коду." },
  { key: "analysis", label: "AI-анализ", text: "Понять направление, цену, срочность и главный триггер." },
  { key: "plan", label: "План", text: "Собрать хук, сценарий и структуру результата." },
  { key: "execution", label: "Выполнение", text: "Подготовить запуск HeyGen / публикации / CRM." },
  { key: "result", label: "Результат", text: "Вернуть результат, историю и следующий шаг." },
];

function cn(...items) {
  return items.filter(Boolean).join(" ");
}

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
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
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
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-black ring-1", tones[tone] || tones.slate)}>{children}</span>;
}

function MetricCard({ label, value, helper, tone = "slate" }) {
  const accents = {
    green: "border-emerald-100 bg-emerald-50/50",
    yellow: "border-amber-100 bg-amber-50/50",
    blue: "border-blue-100 bg-blue-50/50",
    purple: "border-violet-100 bg-violet-50/50",
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

function WorkflowStep({ item, index, active }) {
  return (
    <div className={cn("rounded-2xl border p-4", active ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white")}>
      <div className="flex items-center gap-3">
        <div className={cn("flex h-8 w-8 items-center justify-center rounded-full text-sm font-black", active ? "bg-white text-slate-950" : "bg-slate-100 text-slate-700")}>{index + 1}</div>
        <div className="font-black">{item.label}</div>
      </div>
      <div className={cn("mt-2 text-xs font-semibold leading-5", active ? "text-slate-200" : "text-slate-500")}>{item.text}</div>
    </div>
  );
}

function ServiceCard({ service }) {
  if (!service) return null;
  const ctx = service.videoContext || {};
  return (
    <div className="mt-4 rounded-3xl border border-blue-100 bg-blue-50/60 p-4 text-slate-950">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-blue-700">Найдено в базе Travella</div>
          <div className="mt-1 text-lg font-black">{ctx.code} · {ctx.title}</div>
          <div className="mt-1 text-sm font-semibold text-slate-600">{ctx.category} · {service.status || "status unknown"}</div>
        </div>
        {ctx.price ? <StatusPill tone="blue">{ctx.price} {ctx.currency || "USD"}</StatusPill> : null}
      </div>
      <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
        <div><b>Направление:</b> {ctx.destination || "—"}</div>
        <div><b>Даты:</b> {ctx.dates || "—"}</div>
        <div><b>Отель:</b> {ctx.hotel || "—"}</div>
        <div><b>Размещение:</b> {ctx.people || "—"}</div>
        <div><b>Питание:</b> {ctx.meal || "—"}</div>
        <div><b>Поставщик:</b> {ctx.supplier || service.provider?.name || "—"}</div>
      </div>
    </div>
  );
}

function ChatMessage({ message }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[96%] rounded-3xl px-5 py-4 shadow-sm", isUser ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-900")}>
        <div className={cn("mb-1 text-xs font-black uppercase tracking-wide", isUser ? "text-slate-300" : "text-slate-500")}>{isUser ? "Ты" : "Travella Video Operator"}</div>
        <div className="whitespace-pre-wrap text-sm font-semibold leading-7">{message.text}</div>
        <ServiceCard service={message.output?.service} />
        {message.events?.length ? (
          <div className="mt-4 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
            <div className="text-xs font-black uppercase tracking-wide text-slate-500">Ход работы</div>
            <div className="mt-3 space-y-2">
              {message.events.map((ev, idx) => (
                <div key={`${ev.at}_${idx}`} className="flex gap-3 text-sm">
                  <span className={cn("mt-1 h-2 w-2 rounded-full", ev.level === "error" ? "bg-rose-500" : "bg-emerald-500")} />
                  <div><b>{ev.step}</b>: {ev.message}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {message.output?.hook ? (
          <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-slate-950 ring-1 ring-amber-100">
            <div className="text-xs font-black uppercase tracking-wide text-amber-700">Хук первых 3 секунд</div>
            <div className="mt-2 text-sm font-black leading-6">{message.output.hook}</div>
          </div>
        ) : null}
        {message.output?.script ? (
          <div className="mt-3 rounded-2xl bg-slate-950 p-4 text-white">
            <div className="text-xs font-black uppercase tracking-wide text-slate-300">Текст для AI-аватара</div>
            <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-7 text-slate-100">{message.output.script}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function JobCard({ job }) {
  const tone = job.status === "completed" ? "green" : job.status === "failed" ? "red" : "yellow";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-slate-950">{job.type || "AI task"}</div>
          <div className="mt-1 text-xs font-semibold text-slate-500">{fmtDate(job.createdAt)}</div>
        </div>
        <StatusPill tone={tone}>{job.status || "created"}</StatusPill>
      </div>
      {job.command ? <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs font-bold text-slate-600">{job.command}</div> : null}
      {job?.error?.message ? <div className="mt-3 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700">{job.error.message}</div> : null}
    </div>
  );
}

export default function AdminAiPlatform() {
  const [status, setStatus] = React.useState(null);
  const [jobs, setJobs] = React.useState([]);
  const [selectedEmployee, setSelectedEmployee] = React.useState("video_operator");
  const [command, setCommand] = React.useState("Создай видео для R857");
  const [messages, setMessages] = React.useState([
    {
      id: "welcome",
      role: "assistant",
      text:
        "Я Travella Video Operator. Теперь я работаю не с тестовой формой, а с реальными данными Travella. Напиши: “Создай видео для R857” — я найду этот отказной тур в базе, покажу ход работы и подготовлю сценарий.",
    },
  ]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [activeStep, setActiveStep] = React.useState(0);
  const [currentTask, setCurrentTask] = React.useState(null);
  const chatEndRef = React.useRef(null);

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
      setError(err?.message || "Не удалось загрузить Travella AI OS");
    }
  }

  React.useEffect(() => { load(); }, []);
  React.useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, loading]);

  function pushMessage(message) {
    setMessages((prev) => [...prev, { id: `${Date.now()}_${Math.random()}`, ...message }]);
  }

  async function runTask() {
    const text = command.trim();
    if (!text || loading) return;

    pushMessage({ role: "user", text });
    setCommand("");
    setLoading(true);
    setError("");
    setActiveStep(0);

    try {
      pushMessage({ role: "assistant", text: "Принял задачу. Передаю её в Task Router Travella AI OS и начинаю работу с реальной базой." });
      const res = await apiPost("/api/admin/ai-platform/tasks", { command: text }, "admin");
      const job = res?.job || null;
      const output = res?.output || job?.output || null;
      const events = Array.isArray(job?.events) ? job.events : [];
      setCurrentTask(job);
      setActiveStep(output?.service ? 4 : 1);

      pushMessage({
        role: "assistant",
        text: output?.nextStep || "Задача выполнена. Результат ниже.",
        output,
        events,
      });
      await load();
    } catch (err) {
      const message = err?.message || "Не удалось выполнить задачу";
      setError(message);
      setActiveStep(0);
      pushMessage({ role: "assistant", text: `Не смог выполнить задачу.\n\nПричина: ${message}\n\nПроверь, существует ли такой R-код в базе и опубликована ли услуга.` });
      await load();
    } finally {
      setLoading(false);
    }
  }

  const video = status?.video || {};
  const employees = Array.isArray(status?.employees) ? status.employees : [];
  const videoEmployee = employees.find((x) => x.id === "video_operator");
  const activeJobs = jobs.filter((job) => ["created", "queued", "processing", "running"].includes(String(job.status || "").toLowerCase())).length;
  const videosToday = jobs.filter((job) => isToday(job.createdAt) && String(job.type || "").includes("video")).length;
  const heygenReady = Boolean(video.heygenReady);
  const aiVideoEnabled = Boolean(video.enabled);
  const platformHealth = aiVideoEnabled && heygenReady ? "Online" : aiVideoEnabled ? "Needs ENV" : "Disabled";
  const currentService = currentTask?.output?.service || null;

  return (
    <div className="min-h-screen space-y-6 p-4 md:p-6">
      <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 p-6 text-white md:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-white/80 ring-1 ring-white/15">AI Operating System</div>
              <h1 className="mt-4 text-3xl font-black tracking-tight md:text-5xl">🤖 Travella AI OS</h1>
              <p className="mt-3 max-w-3xl text-sm font-semibold leading-7 text-slate-200 md:text-base">
                Рабочий стол цифровых сотрудников Travella: задача обычным языком → реальные данные Travella → анализ → результат.
              </p>
            </div>
            <button type="button" onClick={load} disabled={loading} className="rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-950 hover:bg-slate-100 disabled:opacity-60">Обновить</button>
          </div>
        </div>
      </section>

      {error ? <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Digital Employees" value={`${employees.length || 1} / 8`} helper="1 работает, остальные по roadmap" tone="blue" />
        <MetricCard label="Active Tasks" value={activeJobs} helper="Задачи в работе сейчас" tone="purple" />
        <MetricCard label="Videos Today" value={videosToday} helper="Создано или запущено сегодня" tone="green" />
        <MetricCard label="AI Health" value={platformHealth} helper={heygenReady ? "HeyGen ENV готов" : "Проверь Railway ENV"} tone={heygenReady ? "green" : "yellow"} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[340px_1fr]">
        <aside className="space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-black uppercase tracking-wide text-slate-500">Digital Employees</div>
            <div className="mt-4 space-y-3">{EMPLOYEE_MENU.map((item) => <EmployeeMenuItem key={item.id} item={item} selected={selectedEmployee === item.id} onClick={setSelectedEmployee} />)}</div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-black uppercase tracking-wide text-slate-500">AI Workflow</div>
            <div className="mt-4 space-y-3">{WORKFLOW.map((item, index) => <WorkflowStep key={item.key} item={item} index={index} active={index === activeStep} />)}</div>
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
                    <p className="mt-2 max-w-4xl text-sm font-semibold leading-6 text-slate-600">
                      Первый рабочий AI-сотрудник: получает команду, сам ищет отказной тур в базе Travella по R-коду и готовит сценарий на основе реальной карточки.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusPill tone={aiVideoEnabled ? "green" : "red"}>{aiVideoEnabled ? "AI Video включено" : "AI Video выключено"}</StatusPill>
                    <StatusPill tone={heygenReady ? "green" : "yellow"}>{heygenReady ? "HeyGen готов" : "Проверить ENV"}</StatusPill>
                    <StatusPill tone="black">Real data MVP</StatusPill>
                  </div>
                </div>
                {videoEmployee?.capabilities?.length ? <div className="mt-5 flex flex-wrap gap-2">{videoEmployee.capabilities.map((item) => <span key={item} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-700">{item}</span>)}</div> : null}
              </section>

              <section className="grid gap-6 2xl:grid-cols-[1fr_400px]">
                <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 p-5 md:p-6">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-xl font-black text-slate-950">AI Workspace</h3>
                        <p className="mt-1 text-sm font-semibold text-slate-500">Пиши задачу как реальному сотруднику: “Создай видео для R857”.</p>
                      </div>
                      {loading ? <StatusPill tone="yellow">Сотрудник работает...</StatusPill> : <StatusPill tone="green">Готов к задаче</StatusPill>}
                    </div>
                  </div>

                  <div className="max-h-[680px] min-h-[480px] space-y-4 overflow-y-auto bg-slate-50/60 p-4 md:p-6">
                    {messages.map((message) => <ChatMessage key={message.id} message={message} />)}
                    {loading ? <ChatMessage message={{ role: "assistant", text: "Ищу данные в Travella, анализирую и собираю результат..." }} /> : null}
                    <div ref={chatEndRef} />
                  </div>

                  <div className="border-t border-slate-100 p-4 md:p-5">
                    <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
                      <textarea
                        value={command}
                        onChange={(e) => setCommand(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            runTask();
                          }
                        }}
                        placeholder="Например: Создай видео для R857"
                        className="min-h-[76px] w-full resize-none rounded-2xl border-0 px-3 py-2 text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-400"
                      />
                      <div className="flex flex-col gap-3 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-xs font-bold text-slate-400">Enter — выполнить, Shift+Enter — новая строка</div>
                        <button type="button" onClick={runTask} disabled={loading || !command.trim()} className="rounded-2xl bg-slate-950 px-6 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-40">▶ Выполнить задачу</button>
                      </div>
                    </div>
                  </div>
                </div>

                <aside className="space-y-6">
                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
                    <h3 className="text-xl font-black text-slate-950">Контекст задачи</h3>
                    {currentService ? (
                      <div className="mt-4 space-y-3 text-sm font-semibold text-slate-600">
                        <div className="flex items-center justify-between rounded-2xl bg-slate-50 p-4"><span>Источник</span><b className="text-slate-950">Travella DB</b></div>
                        <div className="flex items-center justify-between rounded-2xl bg-slate-50 p-4"><span>Код</span><b className="text-slate-950">{currentService.videoContext?.code}</b></div>
                        <div className="rounded-2xl bg-slate-50 p-4"><div className="text-slate-400">Название</div><b className="text-slate-950">{currentService.videoContext?.title}</b></div>
                        <div className="rounded-2xl bg-slate-50 p-4"><div className="text-slate-400">Поставщик</div><b className="text-slate-950">{currentService.videoContext?.supplier || "—"}</b></div>
                        <div className="rounded-2xl bg-slate-50 p-4"><div className="text-slate-400">Следующий шаг</div><b className="text-slate-950">Утвердить сценарий → HeyGen</b></div>
                      </div>
                    ) : (
                      <div className="mt-4 rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">Пока нет активной задачи. Напиши команду с R-кодом.</div>
                    )}
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
                    <div className="flex items-center justify-between gap-3"><h3 className="text-xl font-black text-slate-950">Очередь задач</h3><StatusPill>{jobs.length}</StatusPill></div>
                    <div className="mt-4 space-y-3">{jobs.length ? jobs.slice(0, 8).map((job) => <JobCard key={job.id} job={job} />) : <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">Пока задач нет.</div>}</div>
                  </div>
                </aside>
              </section>
            </>
          ) : (
            <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm"><div className="text-5xl">🚧</div><h2 className="mt-4 text-2xl font-black text-slate-950">Этот AI-сотрудник в roadmap</h2><p className="mt-2 text-sm font-semibold text-slate-500">Сейчас строим фундамент на Video Operator, затем подключим остальных сотрудников.</p></div>
          )}
        </main>
      </section>
    </div>
  );
}
