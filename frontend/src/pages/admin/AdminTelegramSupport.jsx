import React from "react";
import { AlertTriangle, BarChart3, CheckCircle2, Clock3, Inbox, MessageSquare, Paperclip, RefreshCw, Send, UserCheck } from "lucide-react";
import { apiGet, apiPost, buildUrl } from "../../api";

const CATEGORY = { general: "Общий вопрос", booking: "Бронирование", payment: "Оплата / возврат", review: "Отзыв", technical: "Техническая проблема" };
const STATUS = { open: "Открыто", in_progress: "В работе", resolved: "Решено", closed: "Закрыто" };
const fmt = (value) => value ? new Date(value).toLocaleString("ru-RU") : "—";
const size = (value) => value ? `${Math.ceil(Number(value) / 1024)} КБ` : "";

export default function AdminTelegramSupport() {
  const [tab, setTab] = React.useState("queue");
  const [filter, setFilter] = React.useState({ status: "active", category: "" });
  const [items, setItems] = React.useState([]);
  const [selected, setSelected] = React.useState(null);
  const [summary, setSummary] = React.useState({});
  const [analytics, setAnalytics] = React.useState(null);
  const [reply, setReply] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    setError("");
    const query = new URLSearchParams(filter).toString();
    const [list, totals] = await Promise.all([apiGet(`/api/admin/telegram-support?${query}`, "admin"), apiGet("/api/admin/telegram-support/summary", "admin")]);
    setItems(list.items || []); setSummary(totals || {});
  }, [filter]);
  const open = React.useCallback(async (id) => setSelected(await apiGet(`/api/admin/telegram-support/${id}`, "admin")), []);
  const loadAnalytics = React.useCallback(async () => setAnalytics(await apiGet("/api/admin/telegram-support/learning-analytics", "admin")), []);
  React.useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);
  React.useEffect(() => { if (tab === "analytics" && !analytics) loadAnalytics().catch((e) => setError(e.message)); }, [tab, analytics, loadAnalytics]);

  const mutate = async (path, body = {}) => {
    setBusy(true); setError("");
    try { await apiPost(path, body, "admin"); await load(); if (selected) await open(selected.id); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const send = async () => { if (!reply.trim()) return; await mutate(`/api/admin/telegram-support/${selected.id}/messages`, { message: reply.trim() }); setReply(""); };
  const openAttachment = async (messageId, index, name) => {
    const token = localStorage.getItem("token") || localStorage.getItem("providerToken") || localStorage.getItem("adminToken");
    const response = await fetch(buildUrl(`/api/admin/telegram-support/${selected.id}/messages/${messageId}/attachments/${index}`), { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error("Не удалось открыть вложение");
    const url = URL.createObjectURL(await response.blob());
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) { const link = document.createElement("a"); link.href = url; link.download = name || "attachment"; link.click(); }
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  return <div className="mx-auto max-w-[1500px] px-4 py-6">
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
      <div><div className="text-xs font-bold uppercase text-orange-600">Telegram operations</div><h1 className="mt-1 text-2xl font-bold">Поддержка и обучение</h1><p className="mt-1 text-sm text-slate-500">Очередь обращений, SLA, переписка и качество обучения.</p></div>
      <button onClick={() => { load(); if (tab === "analytics") loadAnalytics(); }} className="inline-flex h-10 items-center gap-2 rounded-md border bg-white px-4 text-sm font-semibold"><RefreshCw size={16}/>Обновить</button>
    </header>
    <div className="mt-5 grid gap-3 sm:grid-cols-4">
      {[["Открыто",summary.open_tickets,Inbox,"text-blue-700"],["Срочные",summary.urgent_tickets,AlertTriangle,"text-red-600"],["За 24 часа",summary.tickets_24h,Clock3,"text-orange-600"],["Активное обучение",summary.active_learners,BarChart3,"text-emerald-700"]].map(([label,value,Icon,tone])=><div key={label} className="border bg-white p-4"><Icon size={19} className={tone}/><div className="mt-3 text-2xl font-bold">{value ?? "—"}</div><div className="text-sm text-slate-500">{label}</div></div>)}
    </div>
    <div className="mt-5 flex border-b">{[["queue","Очередь"],["analytics","Аналитика обучения"]].map(([value,label])=><button key={value} onClick={()=>setTab(value)} className={`h-11 border-b-2 px-5 text-sm font-semibold ${tab===value?"border-orange-600 text-slate-950":"border-transparent text-slate-500"}`}>{label}</button>)}</div>
    {error && <div className="mt-4 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    {tab === "queue" && <div className="mt-5 grid min-h-[600px] gap-5 lg:grid-cols-[420px_minmax(0,1fr)]">
      <section className="border bg-white">
        <div className="grid grid-cols-2 gap-2 border-b p-3"><select value={filter.status} onChange={e=>setFilter(v=>({...v,status:e.target.value}))} className="h-10 rounded-md border px-2 text-sm"><option value="active">Активные</option><option value="open">Открытые</option><option value="in_progress">В работе</option><option value="resolved">Решённые</option><option value="all">Все</option></select><select value={filter.category} onChange={e=>setFilter(v=>({...v,category:e.target.value}))} className="h-10 rounded-md border px-2 text-sm"><option value="">Все темы</option>{Object.entries(CATEGORY).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
        <div className="divide-y">{items.map(item=><button key={item.id} onClick={()=>open(item.id)} className={`w-full px-4 py-4 text-left hover:bg-slate-50 ${selected?.id===item.id?"bg-orange-50":""}`}><div className="flex items-center justify-between gap-2"><b>#{item.id} · {item.actor_name}</b>{item.overdue&&<span className="rounded-full bg-red-50 px-2 py-1 text-xs font-bold text-red-700">SLA</span>}</div><div className="mt-1 text-sm text-slate-600">{CATEGORY[item.category]} · {STATUS[item.status]}</div><div className="mt-2 line-clamp-2 text-sm text-slate-500">{item.message}</div><div className="mt-2 text-xs text-slate-400">{fmt(item.created_at)} · {item.message_count} сообщ.</div></button>)}{!items.length&&<div className="p-10 text-center text-sm text-slate-500">Очередь пуста</div>}</div>
      </section>
      <section className="border bg-white">{selected ? <>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b p-5"><div><h2 className="text-xl font-bold">Обращение #{selected.id}</h2><p className="mt-1 text-sm text-slate-500">{selected.actor_name} · {selected.actor_role} · {CATEGORY[selected.category]}</p><p className={`mt-2 text-xs font-semibold ${new Date(selected.due_at)<new Date()&&!['resolved','closed'].includes(selected.status)?"text-red-600":"text-slate-500"}`}>SLA до {fmt(selected.due_at)}</p></div><div className="flex gap-2"><button disabled={busy} onClick={()=>mutate(`/api/admin/telegram-support/${selected.id}/assign`)} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold"><UserCheck size={15}/>Назначить себе</button><button disabled={busy||selected.status==='resolved'} onClick={()=>mutate(`/api/admin/telegram-support/${selected.id}/status`,{status:'resolved'})} className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white disabled:opacity-40"><CheckCircle2 size={15}/>Решено</button></div></div>
        <div className="max-h-[470px] space-y-4 overflow-y-auto bg-slate-50 p-5">{(selected.messages||[]).map(msg=><div key={msg.id} className={`max-w-[85%] rounded-md border p-4 ${msg.sender_role==='admin'?"ml-auto border-orange-200 bg-orange-50":"bg-white"}`}><div className="text-xs font-bold uppercase text-slate-500">{msg.sender_role==='admin'?"Поддержка":selected.actor_name} · {fmt(msg.created_at)}</div>{msg.message&&<div className="mt-2 whitespace-pre-wrap text-sm">{msg.message}</div>}{(msg.attachments||[]).map((file,index)=><button type="button" onClick={()=>openAttachment(msg.id,index,file.name).catch(e=>setError(e.message))} key={index} className="mt-2 flex w-full items-center gap-2 rounded-md border bg-white px-3 py-2 text-left text-sm hover:border-orange-300"><Paperclip size={15}/><span>{file.name||file.type||"Вложение"}</span><span className="text-xs text-slate-400">{size(file.size)}</span></button>)}</div>)}</div>
        <div className="border-t p-4"><label className="text-sm font-semibold">Ответ пользователю</label><div className="mt-2 flex gap-2"><textarea value={reply} onChange={e=>setReply(e.target.value)} rows="3" className="min-h-[76px] flex-1 rounded-md border px-3 py-2 text-sm" placeholder="Напишите решение или уточняющий вопрос"/><button disabled={busy||!reply.trim()} onClick={send} className="inline-flex w-32 items-center justify-center gap-2 rounded-md bg-slate-950 font-semibold text-white disabled:opacity-40"><Send size={16}/>Отправить</button></div></div>
      </> : <div className="flex h-full min-h-[500px] items-center justify-center text-sm text-slate-500"><MessageSquare className="mr-2" size={18}/>Выберите обращение</div>}</section>
    </div>}
    {tab === "analytics" && <div className="mt-5 grid gap-5 lg:grid-cols-2"><section className="border bg-white"><div className="border-b p-4 font-bold">Прохождение курсов</div><div className="divide-y">{(analytics?.enrollments||[]).map((row,i)=><div key={i} className="grid grid-cols-4 gap-2 p-4 text-sm"><b>{row.user_role}</b><span>{row.status}</span><span>{row.count} чел.</span><span>{row.avg_progress}%</span></div>)}</div></section><section className="border bg-white"><div className="border-b p-4 font-bold">Поиск помощи за 30 дней</div><div className="divide-y">{(analytics?.searches||[]).map((row,i)=><div key={i} className="grid grid-cols-[1fr_90px_110px] gap-2 p-4 text-sm"><span>{row.query}</span><span>{row.searches} поисков</span><span className={Number(row.no_result)?"text-red-600":"text-emerald-700"}>{row.no_result} без ответа</span></div>)}{!(analytics?.searches||[]).length&&<div className="p-8 text-center text-sm text-slate-500">Данных пока нет</div>}</div></section></div>}
  </div>;
}
