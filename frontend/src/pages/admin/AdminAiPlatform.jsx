// frontend/src/pages/admin/AdminAiPlatform.jsx

import React from "react";
import { apiGet, apiPost } from "../../api";

const EMPTY_TOUR = {
  code: "R857",
  title: "Отказной тур в Нячанг",
  fromCity: "Ташкент",
  destination: "Нячанг, Вьетнам",
  dates: "28.06–05.07.2026",
  hotel: "Vinpearl Resort & Spa",
  room: "Deluxe Room",
  meal: "BB / Завтраки",
  people: "2 взрослых",
  price: "3710",
  currency: "USD",
  flight: "04JUL TAS–IKU 04:30–06:50; 11JUL IKU–TAS 08:10–08:30",
  includes: "авиабилет, отель, трансфер, страховка",
  supplier: "Название поставщика",
  urgency: "предложение отказное, поэтому может уйти в любой момент",
};

const EMPLOYEE_MENU = [
  { id: "video_operator", icon: "🎬", title: "Video Operator", subtitle: "AI-видео для отказных туров", status: "active" },
  { id: "sales_manager", icon: "💼", title: "Sales Manager", subtitle: "Продажи и быстрые заявки", status: "planned" },
  { id: "content_manager", icon: "📝", title: "Content Manager", subtitle: "Посты, captions, сторис", status: "planned" },
  { id: "support_manager", icon: "🎧", title: "Support Manager", subtitle: "Ответы клиентам и поставщикам", status: "planned" },
  { id: "hotel_auditor", icon: "🏨", title: "Hotel Auditor", subtitle: "Проверка инспекций отелей", status: "planned" },
  { id: "finance_auditor", icon: "📊", title: "Finance Auditor", subtitle: "Баланс, платежи, сверки", status: "planned" },
  { id: "settings", icon: "⚙️", title: "Settings", subtitle: "Ключи, роли, правила AI", status: "planned" },
];

const OPERATING_STANDARD = [
  { label: "Источник данных", text: "Получить данные из Travella или из ручного контекста." },
  { label: "AI-анализ", text: "Понять оффер, срочность, цену, аудиторию и главный триггер." },
  { label: "План", text: "Собрать хук, сценарий и структуру результата." },
  { label: "Выполнение", text: "Запустить нужные сервисы: HeyGen, публикацию, CRM или отчёт." },
  { label: "Результат", text: "Вернуть ссылку, статус, историю и следующий шаг." },
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

function getTourCodeFromText(text) {
  const match = String(text || "").match(/\bR\s*\d{2,6}\b/i);
  return match ? match[0].replace(/\s+/g, "").toUpperCase() : "";
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

function StandardStep({ item, index, active }) {
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

function Field({ label, value, onChange, placeholder, textarea = false }) {
  const cls = "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-100";
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-black uppercase tracking-wide text-slate-500">{label}</span>
      {textarea ? (
        <textarea className={cn(cls, "min-h-[82px] resize-y")} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      ) : (
        <input className={cls} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      )}
    </label>
  );
}

function ChatMessage({ message }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[92%] rounded-3xl px-5 py-4 shadow-sm", isUser ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-900")}> 
        <div className={cn("mb-1 text-xs font-black uppercase tracking-wide", isUser ? "text-slate-300" : "text-slate-500")}>{isUser ? "Ты" : "Travella Video Operator"}</div>
        <div className="whitespace-pre-wrap text-sm font-semibold leading-7">{message.text}</div>
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
  const [tour, setTour] = React.useState(EMPTY_TOUR);
  const [command, setCommand] = React.useState("Создай сценарий для R857");
  const [messages, setMessages] = React.useState([
    {
      id: "welcome",
      role: "assistant",
      text:
        "Я Travella Video Operator. Напиши задачу обычным языком — например: “Создай сценарий для R857” или “Подготовь видео для отказного тура”. Сейчас я работаю через ручной контекст, следующим этапом подключим поиск тура прямо из базы Travella.",
    },
  ]);
  const [showContext, setShowContext] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const chatEndRef = React.useRef(null);

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
      setError(err?.message || "Не удалось загрузить Travella AI Operating System");
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  function pushMessage(message) {
    setMessages((prev) => [...prev, { id: `${Date.now()}_${Math.random()}`, ...message }]);
  }

  async function runVideoOperator({ runHeygen = false } = {}) {
    const text = command.trim();
    if (!text) return;

    const requestedCode = getTourCodeFromText(text);
    const normalizedTour = requestedCode ? { ...tour, code: requestedCode } : tour;
    if (requestedCode && requestedCode !== tour.code) setTour(normalizedTour);

    pushMessage({ role: "user", text });
    setCommand("");
    setLoading(true);
    setError("");

    try {
      pushMessage({
        role: "assistant",
        text:
          `Принял задачу.${requestedCode ? `\n\nКод тура: ${requestedCode}.` : ""}\n\nШаг 1/5: проверяю источник данных. Сейчас активен ручной контекст. Следующим этапом я буду сам находить тур в базе Travella по коду.`,
      });

      pushMessage({ role: "assistant", text: "Шаг 2/5: анализирую направление, цену, срочность и главный оффер." });
      pushMessage({ role: "assistant", text: "Шаг 3/5: готовлю хук и сценарий для вертикального видео 9:16." });

      const endpoint = runHeygen
        ? "/api/admin/ai-platform/video-operator/heygen-video"
        : "/api/admin/ai-platform/video-operator/script";
      const res = await apiPost(endpoint, normalizedTour, "admin");
      const output = res?.output || null;

      pushMessage({
        role: "assistant",
        text: runHeygen
          ? "Шаг 4/5: сценарий готов, задача отправлена в HeyGen. Проверь статус в блоке последних задач."
          : "Шаг 4/5: сценарий готов. Я вывел хук и текст ниже. Следующий шаг — запуск HeyGen после утверждения.",
        output,
      });

      pushMessage({ role: "assistant", text: "Шаг 5/5: сохраняю результат в истории задач Travella AI Operating System." });
      await load();
    } catch (err) {
      const message = err?.message || "Не удалось выполнить задачу Video Operator";
      setError(message);
      pushMessage({ role: "assistant", text: `Не смог выполнить задачу.\n\nПричина: ${message}` });
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
    <div className="min-h-screen space-y-6 p-4 md:p-6">
      <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 p-6 text-white md:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-white/80 ring-1 ring-white/15">
                AI Operating System
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight md:text-5xl">🤖 Travella AI OS</h1>
              <p className="mt-3 max-w-3xl text-sm font-semibold leading-7 text-slate-200 md:text-base">
                Рабочий стол цифровых сотрудников Travella: сотрудник получает задачу обычным языком, берёт данные, анализирует, выполняет и возвращает результат.
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
      </section>

      {error ? <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Digital Employees" value={`${employees.length || 1} / 8`} helper="1 работает, остальные по roadmap" tone="blue" />
        <MetricCard label="Active Tasks" value={activeJobs} helper="Задачи в работе сейчас" tone="purple" />
        <MetricCard label="Videos Today" value={videosToday} helper="Создано или запущено сегодня" tone="green" />
        <MetricCard label="AI Health" value={platformHealth} helper={heygenReady ? "HeyGen ENV готов" : "Проверь Railway ENV"} tone={heygenReady ? "green" : "yellow"} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[360px_1fr]">
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
            <div className="text-xs font-black uppercase tracking-wide text-slate-500">Operating Standard</div>
            <div className="mt-4 space-y-3">
              {OPERATING_STANDARD.map((item, index) => (
                <StandardStep key={item.label} item={item} index={index} active={index === 0} />
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
                    <p className="mt-2 max-w-4xl text-sm font-semibold leading-6 text-slate-600">
                      Первый цифровой сотрудник. Теперь основное рабочее место — не форма, а диалог: ты ставишь задачу, сотрудник показывает ход работы и возвращает результат.
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
                <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 p-5 md:p-6">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-xl font-black text-slate-950">Рабочий чат сотрудника</h3>
                        <p className="mt-1 text-sm font-semibold text-slate-500">Пиши задачу так, как написал бы реальному оператору.</p>
                      </div>
                      {loading ? <StatusPill tone="yellow">Сотрудник работает...</StatusPill> : <StatusPill tone="green">Готов к задаче</StatusPill>}
                    </div>
                  </div>

                  <div className="max-h-[620px] min-h-[420px] space-y-4 overflow-y-auto bg-slate-50/60 p-4 md:p-6">
                    {messages.map((message) => (
                      <ChatMessage key={message.id} message={message} />
                    ))}
                    {loading ? <ChatMessage message={{ role: "assistant", text: "Выполняю задачу..." }} /> : null}
                    <div ref={chatEndRef} />
                  </div>

                  <div className="border-t border-slate-100 p-4 md:p-5">
                    <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
                      <textarea
                        value={command}
                        onChange={(e) => setCommand(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) runVideoOperator({ runHeygen: false });
                        }}
                        placeholder="Например: Создай сценарий для R857"
                        className="min-h-[84px] w-full resize-none rounded-2xl border-0 px-3 py-2 text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-400"
                      />
                      <div className="flex flex-col gap-3 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
                        <button type="button" onClick={() => setShowContext((v) => !v)} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-50">
                          {showContext ? "Скрыть контекст тура" : "Контекст тура"}
                        </button>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <button
                            type="button"
                            onClick={() => runVideoOperator({ runHeygen: false })}
                            disabled={loading || !command.trim()}
                            className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-40"
                          >
                            Создать сценарий
                          </button>
                          <button
                            type="button"
                            onClick={() => runVideoOperator({ runHeygen: true })}
                            disabled={loading || !command.trim() || !heygenReady || !aiVideoEnabled}
                            className="rounded-2xl bg-orange-600 px-5 py-3 text-sm font-black text-white hover:bg-orange-700 disabled:opacity-40"
                          >
                            Создать видео
                          </button>
                        </div>
                      </div>
                    </div>

                    {showContext ? (
                      <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4">
                        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                          <div>
                            <h4 className="text-base font-black text-slate-950">Ручной контекст тура</h4>
                            <p className="mt-1 text-xs font-semibold text-slate-500">Временный режим. Следующий backend-этап — автоматический поиск отказного тура из базы по коду R857.</p>
                          </div>
                          <StatusPill tone="yellow">Debug mode</StatusPill>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <Field label="Код" value={tour.code} onChange={(v) => setField("code", v)} placeholder="R857" />
                          <Field label="Название" value={tour.title} onChange={(v) => setField("title", v)} placeholder="Отказной тур в Нячанг" />
                          <Field label="Город вылета" value={tour.fromCity} onChange={(v) => setField("fromCity", v)} placeholder="Ташкент" />
                          <Field label="Направление" value={tour.destination} onChange={(v) => setField("destination", v)} placeholder="Нячанг, Вьетнам" />
                          <Field label="Даты" value={tour.dates} onChange={(v) => setField("dates", v)} placeholder="28.06–05.07.2026" />
                          <Field label="Цена" value={tour.price} onChange={(v) => setField("price", v)} placeholder="3710" />
                          <Field label="Валюта" value={tour.currency} onChange={(v) => setField("currency", v)} placeholder="USD" />
                          <Field label="Размещение" value={tour.people} onChange={(v) => setField("people", v)} placeholder="2 взрослых" />
                          <Field label="Отель" value={tour.hotel} onChange={(v) => setField("hotel", v)} placeholder="Vinpearl Resort & Spa" />
                          <Field label="Номер" value={tour.room} onChange={(v) => setField("room", v)} placeholder="Deluxe Room" />
                          <Field label="Питание" value={tour.meal} onChange={(v) => setField("meal", v)} placeholder="BB / Завтраки" />
                          <Field label="Поставщик" value={tour.supplier} onChange={(v) => setField("supplier", v)} placeholder="Название поставщика" />
                          <div className="md:col-span-2"><Field textarea label="Перелёт" value={tour.flight} onChange={(v) => setField("flight", v)} placeholder="04JUL TAS–IKU 04:30–06:50" /></div>
                          <div className="md:col-span-2"><Field textarea label="Что входит" value={tour.includes} onChange={(v) => setField("includes", v)} placeholder="авиабилет, отель, трансфер, страховка" /></div>
                          <div className="md:col-span-2"><Field textarea label="Срочность" value={tour.urgency} onChange={(v) => setField("urgency", v)} placeholder="предложение отказное, может уйти в любой момент" /></div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <aside className="space-y-6">
                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
                    <h3 className="text-xl font-black text-slate-950">Сегодня</h3>
                    <div className="mt-4 space-y-3 text-sm font-semibold text-slate-600">
                      <div className="flex items-center justify-between rounded-2xl bg-slate-50 p-4"><span>Сценарии</span><b className="text-slate-950">{jobs.length}</b></div>
                      <div className="flex items-center justify-between rounded-2xl bg-slate-50 p-4"><span>Видео</span><b className="text-slate-950">{videosToday}</b></div>
                      <div className="flex items-center justify-between rounded-2xl bg-slate-50 p-4"><span>В работе</span><b className="text-slate-950">{activeJobs}</b></div>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-xl font-black text-slate-950">Очередь задач</h3>
                      <StatusPill>{jobs.length}</StatusPill>
                    </div>
                    <div className="mt-4 space-y-3">
                      {jobs.length ? jobs.slice(0, 8).map((job) => <JobCard key={job.id} job={job} onRefresh={refreshJob} />) : <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">Пока задач нет.</div>}
                    </div>
                  </div>
                </aside>
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
      </section>
    </div>
  );
}
