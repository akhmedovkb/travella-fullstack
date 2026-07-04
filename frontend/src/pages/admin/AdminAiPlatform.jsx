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

function fmtDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" });
  } catch {
    return String(value);
  }
}

function Field({ label, value, onChange, placeholder, textarea = false }) {
  const cls = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900";
  return (
    <label className="block space-y-1">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      {textarea ? (
        <textarea className={`${cls} min-h-[86px]`} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      ) : (
        <input className={cls} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      )}
    </label>
  );
}

function StatusPill({ children, tone = "slate" }) {
  const tones = {
    green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    red: "bg-rose-50 text-rose-700 ring-rose-100",
    yellow: "bg-amber-50 text-amber-700 ring-amber-100",
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
    black: "bg-slate-950 text-white ring-slate-950",
  };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ring-1 ${tones[tone] || tones.slate}`}>{children}</span>;
}

function EmployeeCard({ employee }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-slate-500">{employee.department}</div>
          <h2 className="mt-1 text-xl font-black text-slate-950">{employee.name}</h2>
          <p className="mt-2 text-sm text-slate-600">{employee.mission}</p>
        </div>
        <StatusPill tone={employee.ready ? "green" : employee.enabled ? "yellow" : "red"}>
          {employee.ready ? "Готов" : employee.enabled ? "Включён, но не готов" : "Выключен"}
        </StatusPill>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {(employee.capabilities || []).map((item) => (
          <span key={item} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{item}</span>
        ))}
      </div>
    </div>
  );
}

function JobCard({ job, onRefresh }) {
  const videoUrl = job?.output?.videoUrl || job?.output?.heygenStatus?.data?.video_url || "";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-sm font-black text-slate-950">{job.type} · {job.status}</div>
          <div className="mt-1 text-xs text-slate-500">{fmtDate(job.createdAt)}</div>
          {job?.output?.videoId ? <div className="mt-1 text-xs text-slate-500">HeyGen video_id: {job.output.videoId}</div> : null}
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
      setStatus(s);
      setJobs(Array.isArray(j.jobs) ? j.jobs : []);
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

  const employee = status?.employees?.find((x) => x.id === "video_operator");
  const video = status?.video || {};

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-950">🤖 Travella AI Platform</h1>
          <p className="mt-1 text-sm text-slate-600">Центр управления цифровыми сотрудниками Travella.</p>
        </div>
        <button type="button" onClick={load} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-50">
          Обновить
        </button>
      </div>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div> : null}

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">AI Video</div>
          <div className="mt-2"><StatusPill tone={video.enabled ? "green" : "red"}>{video.enabled ? "Включено" : "Выключено"}</StatusPill></div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">HeyGen</div>
          <div className="mt-2"><StatusPill tone={video.heygenReady ? "green" : "yellow"}>{video.heygenReady ? "Готов" : "Проверить ENV"}</StatusPill></div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Формат</div>
          <div className="mt-2 text-xl font-black text-slate-950">{video.defaultAspectRatio || "9:16"}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Разрешение</div>
          <div className="mt-2 text-xl font-black text-slate-950">{video.defaultResolution || "1080p"}</div>
        </div>
      </div>

      {employee ? <EmployeeCard employee={employee} /> : null}

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-slate-950">Travella Video Operator</h2>
              <p className="mt-1 text-sm text-slate-600">Заполни данные отказного тура. Сначала можно создать сценарий, затем отправить его в HeyGen.</p>
            </div>
            {loading ? <StatusPill tone="yellow">Работает...</StatusPill> : <StatusPill tone="black">Beta</StatusPill>}
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
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

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={generateScript} disabled={loading} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-800 hover:bg-slate-50 disabled:opacity-50">
              1. Создать сценарий
            </button>
            <button type="button" onClick={createHeygenVideo} disabled={loading || !video.heygenReady || !video.enabled} className="rounded-xl bg-black px-4 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-40">
              2. Запустить HeyGen видео
            </button>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">Сценарий</h2>
            {scriptResult ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-xs font-black uppercase tracking-wide text-slate-500">Хук</div>
                  <div className="mt-1 text-sm font-bold text-slate-900">{scriptResult.hook}</div>
                </div>
                <div className="rounded-2xl bg-slate-950 p-4 text-white">
                  <div className="text-xs font-black uppercase tracking-wide text-slate-300">Текст для AI-аватара</div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{scriptResult.script}</p>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">Сценарий появится после нажатия кнопки “Создать сценарий”.</p>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">Последние задачи</h2>
            <div className="mt-4 space-y-3">
              {jobs.length ? jobs.map((job) => <JobCard key={job.id} job={job} onRefresh={refreshJob} />) : <div className="text-sm text-slate-500">Пока задач нет.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
