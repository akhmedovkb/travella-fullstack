import React from "react";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";
import { CalendarClock, CheckCircle2, Clock3, Loader2, Megaphone, Pause, Play, RefreshCw, Send, Users } from "lucide-react";
import { apiGet, apiPost } from "../../api";
import { sanitizeTelegramHtml } from "../../utils/telegramHtmlSanitize";

const KINDS = [
  ["education", "Обучение"],
  ["qualification", "Повышение квалификации"],
  ["news", "Новости"],
  ["service", "Сервисное сообщение"],
];
const STATUS = { draft: "Черновик", scheduled: "Запланирована", running: "Отправляется", paused: "На паузе", done: "Завершена", failed: "Ошибка" };
const STATUS_CLASS = { draft: "bg-slate-100 text-slate-700", scheduled: "bg-amber-50 text-amber-700", running: "bg-blue-50 text-blue-700", paused: "bg-orange-50 text-orange-700", done: "bg-emerald-50 text-emerald-700", failed: "bg-red-50 text-red-700" };
const PROVIDERS = { agent: "турагенты", guide: "гиды", transport: "транспорт", hotel: "отели" };

const formatDate = (value) => value ? new Date(value).toLocaleString() : "—";
function audienceLabel(item) {
  if (item.audience === "clients") return "Клиенты";
  if (item.audience === "providers") return item.segment?.providerType ? `Поставщики: ${PROVIDERS[item.segment.providerType] || item.segment.providerType}` : "Все поставщики";
  return "Клиенты и поставщики";
}

export default function AdminBroadcast() {
  const [title, setTitle] = React.useState("");
  const [kind, setKind] = React.useState("education");
  const [audience, setAudience] = React.useState("providers");
  const [providerType, setProviderType] = React.useState("");
  const [html, setHtml] = React.useState("");
  const [previewHtml, setPreviewHtml] = React.useState("");
  const [showPreview, setShowPreview] = React.useState(false);
  const [scheduleAt, setScheduleAt] = React.useState("");
  const [broadcastId, setBroadcastId] = React.useState("");
  const [status, setStatus] = React.useState(null);
  const [items, setItems] = React.useState([]);
  const [busy, setBusy] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");

  const loadList = React.useCallback(async () => {
    const data = await apiGet("/api/admin/broadcast/list?limit=30");
    setItems(Array.isArray(data?.items) ? data.items : []);
  }, []);
  const loadStatus = React.useCallback(async (id) => {
    if (!id) return;
    setStatus(await apiGet(`/api/admin/broadcast/${id}/status`));
    setBroadcastId(String(id));
  }, []);

  React.useEffect(() => { loadList().catch((e) => setError(String(e?.message || e))); }, [loadList]);
  React.useEffect(() => {
    if (!broadcastId || !["running", "scheduled"].includes(status?.broadcast?.status)) return undefined;
    const timer = window.setInterval(() => Promise.all([loadStatus(broadcastId), loadList()]).catch(() => {}), 4000);
    return () => window.clearInterval(timer);
  }, [broadcastId, status?.broadcast?.status, loadList, loadStatus]);

  const clearNotice = () => { setMessage(""); setError(""); };
  const ensureText = () => {
    const text = sanitizeTelegramHtml(html);
    if (!text) setError("Введите текст сообщения");
    return text;
  };
  const createDraft = async () => {
    clearNotice();
    const text = ensureText();
    if (!text) return null;
    setBusy("create");
    try {
      const result = await apiPost("/api/admin/broadcast/create", { title: title.trim(), kind, audience, segment: { providerType: audience === "providers" ? providerType : "" }, text });
      setBroadcastId(String(result.broadcastId));
      await Promise.all([loadStatus(result.broadcastId), loadList()]);
      setMessage(`Рассылка подготовлена. Получателей: ${result.total || 0}`);
      return result.broadcastId;
    } catch (e) { setError(String(e?.message || e)); return null; }
    finally { setBusy(""); }
  };
  const testSend = async () => {
    clearNotice(); const text = ensureText(); if (!text) return;
    setBusy("test");
    try { await apiPost("/api/admin/broadcast/test", { text }); setMessage("Тестовое сообщение отправлено администратору"); }
    catch (e) { setError(String(e?.message || e)); }
    finally { setBusy(""); }
  };
  const runAction = async (action, id = broadcastId) => {
    if (!id) return; clearNotice(); setBusy(action);
    try { await apiPost(`/api/admin/broadcast/${id}/${action}`, {}); await Promise.all([loadStatus(id), loadList()]); setMessage(action === "start" ? "Рассылка запущена" : "Рассылка приостановлена"); }
    catch (e) { setError(String(e?.message || e)); }
    finally { setBusy(""); }
  };
  const schedule = async () => {
    clearNotice();
    if (!scheduleAt) return setError("Выберите дату и время отправки");
    let id = broadcastId;
    if (!id || status?.broadcast?.status !== "draft") id = await createDraft();
    if (!id) return;
    setBusy("schedule");
    try { await apiPost(`/api/admin/broadcast/${id}/schedule`, { scheduledAt: new Date(scheduleAt).toISOString() }); await Promise.all([loadStatus(id), loadList()]); setMessage("Рассылка запланирована"); }
    catch (e) { setError(String(e?.message || e)); }
    finally { setBusy(""); }
  };

  const modules = React.useMemo(() => ({ toolbar: [["bold", "italic", "underline", "strike"], ["link"], ["code-block"], ["clean"]], clipboard: { matchVisual: false } }), []);
  const formats = React.useMemo(() => ["bold", "italic", "underline", "strike", "link", "code-block"], []);
  const current = status?.broadcast;
  const total = Number(status?.total || 0), sent = Number(status?.sent || 0), failed = Number(status?.failed || 0);
  const progress = total ? Math.round(((sent + failed) / total) * 100) : 0;

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div><div className="text-xs font-bold uppercase text-orange-600">Telegram</div><h1 className="mt-1 text-2xl font-bold text-slate-950">Обучение и рассылки</h1><p className="mt-1 text-sm text-slate-600">Создавайте полезные сообщения, проверяйте аудиторию и контролируйте доставку.</p></div>
        <button onClick={loadList} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold hover:bg-slate-50"><RefreshCw size={16} /> Обновить</button>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,.75fr)]">
        <section className="border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-bold text-slate-950">Новое сообщение</h2><p className="mt-1 text-sm text-slate-500">Одна тема, одна польза и одно основное действие.</p></div>
          <div className="space-y-5 p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm font-semibold text-slate-700">Название рассылки<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Как оформить карточку" className="mt-1 h-11 w-full rounded-md border border-slate-300 px-3 font-normal outline-none focus:border-orange-500" /></label>
              <label className="text-sm font-semibold text-slate-700">Тип сообщения<select value={kind} onChange={(e) => setKind(e.target.value)} className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 font-normal">{KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            </div>
            <div><div className="mb-1 text-sm font-semibold text-slate-700">Текст сообщения</div><div className="overflow-hidden rounded-md border border-slate-300"><ReactQuill theme="snow" value={html} onChange={setHtml} modules={modules} formats={formats} placeholder="Объясните пользу и предложите следующее действие" /></div><div className="mt-2 text-xs text-slate-500">Поддерживаются жирный текст, курсив, ссылки и моноширинный текст Telegram.</div></div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => { clearNotice(); setPreviewHtml(sanitizeTelegramHtml(html)); setShowPreview(true); }} className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold hover:bg-slate-50">Предпросмотр</button>
              <button disabled={Boolean(busy)} onClick={testSend} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold disabled:opacity-50">{busy === "test" ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Тест администратору</button>
            </div>
            {showPreview && <div className="border border-slate-200 bg-slate-50 p-4"><div className="mb-3 flex justify-between"><b className="text-sm">Так сообщение выглядит в Telegram</b><button onClick={() => setShowPreview(false)} className="text-sm text-slate-500">Закрыть</button></div><div className="max-w-xl rounded-md bg-white p-4 text-sm leading-6 shadow-sm" dangerouslySetInnerHTML={{ __html: previewHtml || "<i>Сообщение пустое</i>" }} /></div>}
          </div>
        </section>

        <aside className="space-y-5">
          <section className="border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2 font-bold"><Users size={18} /> Получатели</div>
            <div className="mt-4 grid grid-cols-3 gap-2">{[["clients","Клиенты"],["providers","Поставщики"],["all","Все"]].map(([value,label]) => <button key={value} onClick={() => setAudience(value)} className={`h-10 rounded-md border text-sm font-semibold ${audience === value ? "border-slate-950 bg-slate-950 text-white" : "border-slate-300 bg-white text-slate-700"}`}>{label}</button>)}</div>
            {audience === "providers" && <label className="mt-4 block text-sm font-semibold text-slate-700">Тип поставщика<select value={providerType} onChange={(e) => setProviderType(e.target.value)} className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 font-normal"><option value="">Все поставщики</option><option value="agent">Турагенты</option><option value="guide">Гиды</option><option value="transport">Транспорт</option><option value="hotel">Отели</option></select></label>}
          </section>
          <section className="border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2 font-bold"><CalendarClock size={18} /> Отправка</div>
            <button disabled={Boolean(busy)} onClick={createDraft} className="mt-4 h-11 w-full rounded-md border border-slate-300 bg-white font-semibold disabled:opacity-50">Сохранить и посчитать аудиторию</button>
            <button disabled={Boolean(busy) || !broadcastId} onClick={() => runAction("start")} className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-orange-600 font-semibold text-white disabled:opacity-40"><Send size={17} /> Отправить сейчас</button>
            <div className="my-4 flex items-center gap-3 text-xs uppercase text-slate-400"><span className="h-px flex-1 bg-slate-200" />или позже<span className="h-px flex-1 bg-slate-200" /></div>
            <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} className="h-11 w-full rounded-md border border-slate-300 px-3" />
            <button disabled={Boolean(busy)} onClick={schedule} className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-slate-950 font-semibold text-white disabled:opacity-50"><Clock3 size={17} /> Запланировать</button>
          </section>
          {(message || error) && <div className={`border px-4 py-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{error || message}</div>}
        </aside>
      </div>

      {current && <section className="border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2"><b>{current.title || `Рассылка #${current.id}`}</b><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_CLASS[current.status] || STATUS_CLASS.draft}`}>{STATUS[current.status] || current.status}</span></div><div className="mt-1 text-sm text-slate-500">{current.scheduled_at ? `Запланирована: ${formatDate(current.scheduled_at)}` : audienceLabel(current)}</div></div>{current.status === "running" && <button onClick={() => runAction("pause")} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold"><Pause size={15} /> Пауза</button>}{["paused","draft","failed"].includes(current.status) && <button onClick={() => runAction("start")} className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white"><Play size={15} /> Запустить</button>}</div><div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-emerald-500" style={{ width: `${progress}%` }} /></div><div className="mt-2 flex justify-between text-sm text-slate-600"><span>{progress}% выполнено</span><span>Получателей: {total} · Отправлено: {sent} · Ошибки: {failed}</span></div></section>}

      <section className="border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="font-bold">История рассылок</h2><p className="mt-1 text-sm text-slate-500">Последние 30 кампаний и состояние доставки.</p></div><Megaphone size={20} className="text-orange-600" /></div>
        <div className="divide-y">{items.map((item) => { const pct = Number(item.total) ? Math.round(((Number(item.sent) + Number(item.failed)) / Number(item.total)) * 100) : 0; return <button key={item.id} onClick={() => loadStatus(item.id)} className="grid w-full gap-3 px-5 py-4 text-left hover:bg-slate-50 md:grid-cols-[minmax(0,1fr)_180px_150px_110px] md:items-center"><div className="min-w-0"><div className="truncate font-semibold">{item.title || `Рассылка #${item.id}`}</div><div className="mt-1 text-sm text-slate-500">{audienceLabel(item)} · {formatDate(item.created_at)}</div></div><div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_CLASS[item.status] || STATUS_CLASS.draft}`}>{STATUS[item.status] || item.status}</span></div><div className="text-sm text-slate-600">{item.sent || 0} из {item.total || 0}</div><div className="flex items-center gap-2 text-sm font-semibold">{item.status === "done" && <CheckCircle2 size={16} className="text-emerald-600" />}{pct}%</div></button>; })}{!items.length && <div className="px-5 py-10 text-center text-sm text-slate-500">Рассылок пока нет</div>}</div>
      </section>
    </div>
  );
}
