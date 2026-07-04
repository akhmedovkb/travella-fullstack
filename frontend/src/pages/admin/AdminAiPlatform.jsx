// frontend/src/pages/admin/AdminAiPlatform.jsx

import React from "react";
import { apiGet, apiPost } from "../../api";

const EMPLOYEES = [
  { id: "video_operator", icon: "🎬", name: "Video Operator", subtitle: "AI-видео для отказных туров", live: true },
  { id: "sales_manager", icon: "💼", name: "Sales Manager", subtitle: "Продажи и быстрые заявки", live: false },
  { id: "content_manager", icon: "📝", name: "Content Manager", subtitle: "Посты, captions, сторис", live: false },
  { id: "support_manager", icon: "🎧", name: "Support Manager", subtitle: "Ответы клиентам и поставщикам", live: false },
  { id: "hotel_auditor", icon: "🏨", name: "Hotel Auditor", subtitle: "Инспекции отелей", live: false },
  { id: "finance_auditor", icon: "📊", name: "Finance Auditor", subtitle: "Балансы и сверки", live: false },
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

function Message({ msg }) {
  const user = msg.role === "user";
  return (
    <div className={cn("flex", user ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[92%] rounded-[1.6rem] px-5 py-4 shadow-sm", user ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-900")}>
        <div className={cn("mb-2 text-xs font-black uppercase tracking-wide", user ? "text-slate-300" : "text-slate-500")}>{user ? "Ты" : "Travella AI Runtime"}</div>
        <div className="whitespace-pre-wrap text-sm font-semibold leading-7">{msg.text}</div>
        <ServicePreview service={msg.output?.service} />
        {msg.events?.length ? <div className="mt-4 space-y-2">{msg.events.map((ev, i) => <ToolEvent key={`${ev.at || i}_${i}`} ev={ev} />)}</div> : null}
        {msg.output?.hook ? <div className="mt-4 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-100"><div className="text-xs font-black uppercase tracking-wide text-amber-700">Хук</div><div className="mt-2 text-sm font-black leading-6 text-slate-950">{msg.output.hook}</div></div> : null}
        {msg.output?.script ? <div className="mt-3 rounded-2xl bg-slate-950 p-4 text-white"><div className="text-xs font-black uppercase tracking-wide text-slate-300">Сценарий для AI-аватара</div><div className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-7 text-slate-100">{msg.output.script}</div></div> : null}
      </div>
    </div>
  );
}

function Inspector({ task }) {
  const service = task?.output?.service || null;
  const ctx = service?.videoContext || {};
  return (
    <aside className="space-y-4">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-xs font-black uppercase tracking-wide text-slate-500">Inspector</div>
        <h3 className="mt-1 text-xl font-black text-slate-950">Контекст текущей задачи</h3>
        {!task ? <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-500">Пока нет активной задачи. Напиши R857, “Создай видео R857” или “R857 Instagram”.</div> : null}
        {task ? <div className="mt-4 space-y-3 text-sm font-semibold text-slate-600">
          <div className="rounded-2xl bg-slate-50 p-4"><div className="text-slate-400">Задача</div><b className="text-slate-950">{task.command}</b></div>
          <div className="flex justify-between rounded-2xl bg-slate-50 p-4"><span>Статус</span><b className="text-slate-950">{task.status}</b></div>
          <div className="flex justify-between rounded-2xl bg-slate-50 p-4"><span>Источник</span><b className="text-slate-950">{service ? "Travella DB" : "—"}</b></div>
          <div className="flex justify-between rounded-2xl bg-slate-50 p-4"><span>Код</span><b className="text-slate-950">{ctx.code || "—"}</b></div>
          <div className="rounded-2xl bg-slate-50 p-4"><div className="text-slate-400">Объект</div><b className="text-slate-950">{ctx.title || "—"}</b></div>
          <div className="rounded-2xl bg-slate-50 p-4"><div className="text-slate-400">Следующий этап</div><b className="text-slate-950">Утверждение сценария → HeyGen</b></div>
        </div> : null}
      </div>
    </aside>
  );
}

function JobList({ jobs }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between"><h3 className="text-lg font-black text-slate-950">Последние задачи</h3><Pill>{jobs.length}</Pill></div>
      <div className="mt-4 space-y-3">
        {jobs.length ? jobs.slice(0, 7).map((j) => <div key={j.id} className="rounded-2xl bg-slate-50 p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-black text-slate-950">{j.command || j.type}</div><div className="mt-1 text-xs font-bold text-slate-500">{fmtDate(j.createdAt)}</div></div><Pill tone={j.status === "completed" ? "green" : j.status === "failed" ? "red" : "yellow"}>{j.status}</Pill></div></div>) : <div className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-500">Пока задач нет.</div>}
      </div>
    </div>
  );
}

export default function AdminAiPlatform() {
  const [selectedEmployee, setSelectedEmployee] = React.useState("video_operator");
  const [status, setStatus] = React.useState(null);
  const [jobs, setJobs] = React.useState([]);
  const [command, setCommand] = React.useState("Создай видео для R857");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [currentTask, setCurrentTask] = React.useState(null);
  const [messages, setMessages] = React.useState([{ id: "hello", role: "assistant", text: "Я Travella AI Runtime. Выбери сотрудника сверху и напиши задачу обычным языком. Для Video Operator можно написать просто: R857, Создай видео R857 или R857 Instagram." }]);
  const endRef = React.useRef(null);

  async function load() {
    setError("");
    try {
      const [s, j] = await Promise.all([
        apiGet("/api/admin/ai-platform/status", "admin"),
        apiGet("/api/admin/ai-platform/video-operator/jobs?limit=30", "admin"),
      ]);
      setStatus(s || null);
      setJobs(Array.isArray(j?.jobs) ? j.jobs : []);
    } catch (e) {
      setError(e?.message || "Не удалось загрузить Travella AI OS");
    }
  }

  React.useEffect(() => { load(); }, []);
  React.useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  function addMessage(msg) { setMessages((prev) => [...prev, { id: `${Date.now()}_${Math.random()}`, ...msg }]); }

  async function runTask() {
    const text = command.trim();
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
      addMessage({ role: "assistant", text: output?.nextStep || "Задача выполнена.", events: job?.events || [], output });
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

  const employeesCount = status?.employees?.length || 1;
  const activeTasks = jobs.filter((j) => ["created", "queued", "running", "processing"].includes(String(j.status || "").toLowerCase())).length;
  const videosToday = jobs.filter((j) => isToday(j.createdAt) && String(j.type || "").includes("video")).length;
  const heygenReady = Boolean(status?.video?.heygenReady);
  const aiEnabled = Boolean(status?.video?.enabled);

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
        <Metric label="AI Health" value={aiEnabled && heygenReady ? "Online" : aiEnabled ? "Needs ENV" : "Disabled"} helper={heygenReady ? "HeyGen ENV готов" : "Проверь Railway ENV"} />
      </section>

      <section className="mt-5"><EmployeeTabs selected={selectedEmployee} onSelect={setSelectedEmployee} /></section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[280px_1fr_360px]">
        <aside className="space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-black uppercase tracking-wide text-slate-500">Workspace</div>
            <div className="mt-4 space-y-2 text-sm font-black text-slate-700">
              <button className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-left text-white">Сегодня</button>
              <button className="w-full rounded-2xl px-4 py-3 text-left hover:bg-slate-50">Последние задачи</button>
              <button className="w-full rounded-2xl px-4 py-3 text-left hover:bg-slate-50">Черновики</button>
              <button className="w-full rounded-2xl px-4 py-3 text-left hover:bg-slate-50">Видео</button>
              <button className="w-full rounded-2xl px-4 py-3 text-left hover:bg-slate-50">Избранное</button>
            </div>
          </div>
          <JobList jobs={jobs} />
        </aside>

        <main className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-xs font-black uppercase tracking-wide text-slate-500">Marketing Department</div>
                <h2 className="mt-1 text-2xl font-black text-slate-950">🎬 Video Operator</h2>
                <p className="mt-1 text-sm font-semibold text-slate-500">Рабочий чат. Никаких форм: сотрудник сам определяет задачу, вызывает tools и показывает ход работы.</p>
              </div>
              <div className="flex flex-wrap gap-2"><Pill tone="green">live</Pill><Pill tone="black">AI Runtime</Pill><Pill tone={aiEnabled ? "green" : "red"}>{aiEnabled ? "AI Video включено" : "AI Video выключено"}</Pill></div>
            </div>
          </div>

          <div className="h-[640px] space-y-4 overflow-y-auto bg-slate-50/60 p-4 md:p-6">
            {messages.map((m) => <Message key={m.id} msg={m} />)}
            {loading ? <Message msg={{ role: "assistant", text: "🧠 Думаю...\n⚙️ Вызываю нужные инструменты Travella AI Runtime..." }} /> : null}
            <div ref={endRef} />
          </div>

          <div className="border-t border-slate-100 p-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
              <textarea
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runTask(); } }}
                placeholder="Напиши: R857, Создай видео R857, R857 Instagram..."
                className="min-h-[78px] w-full resize-none rounded-2xl border-0 px-3 py-2 text-sm font-semibold text-slate-950 outline-none placeholder:text-slate-400"
              />
              <div className="flex flex-col gap-3 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs font-bold text-slate-400">Enter — выполнить, Shift+Enter — новая строка</div>
                <button type="button" onClick={runTask} disabled={loading || !command.trim()} className="rounded-2xl bg-slate-950 px-6 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-40">▶ Выполнить</button>
              </div>
            </div>
          </div>
        </main>

        <Inspector task={currentTask} />
      </section>
    </div>
  );
}
