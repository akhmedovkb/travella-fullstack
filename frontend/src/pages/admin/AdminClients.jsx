// frontend/src/pages/admin/AdminClients.jsx

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import axios from "axios";
import { apiDelete, apiGet, apiPost, apiPut } from "../../api";
import ClientAccessModal from "../../components/admin/ClientAccessModal";
import { formatTiyinToSum } from "../../utils/money";

const LS_KEY = "admin.clients.lastSeenISO";

const EDIT_FIELDS = [
  { name: "name", label: "Имя", type: "text", section: "Основное" },
  { name: "email", label: "Email", type: "text", section: "Основное" },
  { name: "phone", label: "Телефон", type: "text", section: "Основное" },
  { name: "telegram", label: "Telegram", type: "text", section: "Основное" },
  { name: "tg_username", label: "TG username", type: "text", section: "Основное" },
  { name: "telegram_chat_id", label: "telegram_chat_id", type: "number", section: "Telegram" },
  { name: "tg_chat_id", label: "tg_chat_id", type: "number", section: "Telegram" },
  { name: "languages", label: "Языки", type: "array", section: "Профиль" },
  { name: "location", label: "Локация JSON / текст", type: "json", section: "Профиль" },
  { name: "avatar_url", label: "Avatar URL", type: "textarea", section: "Профиль" },
  { name: "account_status", label: "Статус аккаунта", type: "text", section: "Система" },
  { name: "source", label: "Источник", type: "text", section: "Система" },
];

function useLastSeen() {
  const [lastSeen, setLastSeen] = useState(() => localStorage.getItem(LS_KEY) || new Date(0).toISOString());
  const save = (iso) => {
    localStorage.setItem(LS_KEY, iso);
    setLastSeen(iso);
  };
  return [lastSeen, save];
}

function money(n) {
  return Math.round(Number(n || 0)).toLocaleString("ru-RU");
}
function fromTiyin(tiyinValue) {
  return Math.round(Number(tiyinValue || 0) / 100);
}
function toDisplayDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("ru-RU");
  } catch {
    return String(value);
  }
}
function truncate(value, max = 24) {
  const s = String(value || "").trim();
  if (!s) return "—";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
function getAuthHeader() {
  const token = localStorage.getItem("adminToken") || localStorage.getItem("providerToken") || localStorage.getItem("token") || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}
function arrayToText(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return JSON.stringify(value, null, 2);
  return value || "";
}
function jsonToText(value) {
  if (value === null || typeof value === "undefined" || value === "") return "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}
function buildForm(row) {
  const out = {};
  for (const f of EDIT_FIELDS) out[f.name] = f.type === "json" ? jsonToText(row?.[f.name]) : arrayToText(row?.[f.name]);
  return out;
}
function buildPayload(form) {
  const payload = {};
  for (const f of EDIT_FIELDS) {
    const raw = form[f.name];
    if (f.type === "json") {
      if (!String(raw || "").trim()) payload[f.name] = null;
      else { try { payload[f.name] = JSON.parse(raw); } catch { payload[f.name] = raw; } }
    } else if (f.type === "array") {
      payload[f.name] = String(raw || "").split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
    } else if (f.type === "number") {
      payload[f.name] = String(raw || "").trim() ? Number(raw) : null;
    } else {
      payload[f.name] = raw;
    }
  }
  return payload;
}

function StatCard({ label, value, sub, valueClass = "" }) {
  return <div className="min-w-0 rounded-2xl border bg-white p-4"><div className="text-xs text-gray-500">{label}</div><div className={`mt-1 break-words text-lg font-semibold leading-tight xl:text-2xl ${valueClass}`}>{value}</div><div className="mt-1 break-words text-sm text-gray-500">{sub}</div></div>;
}

export default function AdminClients() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [lastSeen, setLastSeen] = useLastSeen();
  const pollTimer = useRef(null);
  const [selected, setSelected] = useState(null);
  const [accessClient, setAccessClient] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [unlockSettings, setUnlockSettings] = useState({ is_paid: true, price: 10000 });
  const [savingSettings, setSavingSettings] = useState(false);
  const [dashboard, setDashboard] = useState({ mode: "paid", is_paid: true, price: 0, clients_total: 0, balance_total: 0, unlocks_total: 0, unlocks_today: 0, revenue_total: 0, revenue_today: 0 });

  const loadUnlockSettings = useCallback(async () => {
    try {
      const res = await apiGet("/api/admin/billing/contact-unlock-settings", "admin");
      const data = res?.data || res;
      if (data?.settings) setUnlockSettings({ is_paid: data.settings.is_paid, price: fromTiyin(data.settings.price) });
      else if (typeof data?.is_paid !== "undefined") setUnlockSettings({ is_paid: data.is_paid, price: fromTiyin(data.price) });
    } catch (e) { console.warn("[unlock settings] load failed", e?.message || e); }
  }, []);

  const loadDashboard = useCallback(async () => {
    try {
      const res = await apiGet("/api/admin/clients/dashboard", "admin");
      const data = res?.data || res;
      if (data?.dashboard) setDashboard(data.dashboard);
    } catch (e) { console.warn("[AdminClients] dashboard load failed:", e?.message || e); }
  }, []);

  const fetchList = useCallback(async (opts = {}) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (opts.limit) params.set("limit", String(opts.limit));
      if (opts.cursor?.cursor_created_at && opts.cursor?.cursor_id) {
        params.set("cursor_created_at", opts.cursor.cursor_created_at);
        params.set("cursor_id", opts.cursor.cursor_id);
      }
      const res = await apiGet(`/api/admin/clients-table?${params.toString()}`, "provider");
      const payload = res?.data && (res.data.items || res.data.nextCursor !== undefined) ? res.data : res;
      const baseItems = payload?.items || [];
      let extraRows = [];
      try {
        const resExtra = await apiGet("/api/admin/clients?limit=200&offset=0", "admin");
        const payloadExtra = resExtra?.data && Array.isArray(resExtra.data.rows) ? resExtra.data : resExtra;
        extraRows = payloadExtra?.rows || [];
      } catch (e) { console.warn("[AdminClients] extra rows fetch failed:", e?.message || e); }
      const extraMap = new Map(extraRows.map((r) => [Number(r.id), { balance_current: r.balance_current ?? 0, unlock_count: r.unlock_count ?? 0 }]));
      const newItems = baseItems.map((item) => ({ ...item, balance_current: extraMap.get(Number(item.id))?.balance_current ?? item.balance_current ?? 0, unlock_count: extraMap.get(Number(item.id))?.unlock_count ?? item.unlock_count ?? 0 }));
      setItems((prev) => (opts.append ? [...prev, ...newItems] : newItems));
      setNextCursor(payload?.nextCursor || null);
    } catch (e) { console.error(e); toast.error("Не удалось загрузить список клиентов"); }
    finally { setLoading(false); }
  }, [q]);

  const checkNew = useCallback(async () => {
    try {
      const since = encodeURIComponent(lastSeen);
      const res = await apiGet(`/api/admin/clients-table/new-count?since=${since}`, "provider");
      const payload = res?.data && typeof res.data.count !== "undefined" ? res.data : res;
      const count = Number(payload?.count || 0);
      if (count > 0) toast.info(`Новых клиентов: ${count}`, { icon: "🆕" });
    } catch {}
  }, [lastSeen]);

  useEffect(() => { fetchList({ limit: 50 }); loadUnlockSettings(); loadDashboard(); }, [fetchList, loadUnlockSettings, loadDashboard]);
  useEffect(() => { pollTimer.current = setInterval(checkNew, 30000); return () => clearInterval(pollTimer.current); }, [checkNew]);

  const isNew = useCallback((created_at) => {
    if (!created_at) return false;
    try { return new Date(created_at).toISOString() > (lastSeen || ""); } catch { return false; }
  }, [lastSeen]);

  const onClearNewMark = async () => {
    const now = new Date().toISOString();
    setLastSeen(now);
    try { await apiPost("/api/admin/clients/reset-new", {}, "admin"); } catch (e) { console.warn("[AdminClients] reset-new failed:", e?.message || e); }
    toast.success("Метка обновлена — «новые» сброшены");
    fetchList({ limit: 50 });
  };

  const saveUnlockSettings = async () => {
    try {
      setSavingSettings(true);
      await axios.put("/api/admin/billing/contact-unlock-settings", { is_paid: unlockSettings.is_paid, price: Math.round(Number(unlockSettings.price || 0) * 100) }, { headers: { ...getAuthHeader() } });
      toast.success("Настройки сохранены");
      await loadUnlockSettings(); await loadDashboard();
    } catch (e) { console.error(e); toast.error("Ошибка сохранения"); }
    finally { setSavingSettings(false); }
  };

  const handleDelete = async (client) => {
    const id = Number(client?.id || 0);
    if (!id) return;
    const ok = window.confirm(`Удалить клиента #${id}${client?.name ? ` (${client.name})` : ""}?\n\nЭто действие необратимо.`);
    if (!ok) return;
    try {
      setDeletingId(id);
      await apiDelete(`/api/admin/clients-table/${id}`, "provider");
      setItems((prev) => prev.filter((x) => Number(x.id) !== id));
      if (Number(selected?.id) === id) setSelected(null);
      toast.success(`Клиент #${id} удалён`);
      await loadDashboard();
    } catch (e) { console.error(e); toast.error(e?.message || "Не удалось удалить клиента"); }
    finally { setDeletingId(null); }
  };

  const handleSaved = (row) => {
    setItems((prev) => prev.map((x) => (Number(x.id) === Number(row.id) ? { ...x, ...row } : x)));
    setSelected((prev) => (prev && Number(prev.id) === Number(row.id) ? { ...prev, ...row } : prev));
  };

  const openAccess = (client) => { setAccessClient(client); setModalOpen(true); };

  return <div className="mx-auto max-w-7xl p-4">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Клиенты</h1><p className="text-sm text-gray-500">Компактная таблица + полное редактирование в панели справа.</p></div><button onClick={onClearNewMark} className="rounded-lg bg-blue-600 px-3 py-2 text-white hover:bg-blue-700">Сбросить «Новые»</button></div>
    <div className="mb-4 flex flex-wrap items-center gap-4 rounded-2xl border bg-white p-4"><div className="text-sm font-semibold">Открытие контактов:</div><label className="flex items-center gap-2 text-sm"><input type="radio" checked={unlockSettings.is_paid === true} onChange={() => setUnlockSettings((s) => ({ ...s, is_paid: true }))} />Платно</label><label className="flex items-center gap-2 text-sm"><input type="radio" checked={unlockSettings.is_paid === false} onChange={() => setUnlockSettings((s) => ({ ...s, is_paid: false }))} />Бесплатно</label><span className="text-sm">Цена:</span><input type="number" value={unlockSettings.price} onChange={(e) => setUnlockSettings((s) => ({ ...s, price: e.target.value }))} className="w-[120px] rounded-lg border px-2 py-1 text-sm" /><span className="text-sm">сум</span><button onClick={saveUnlockSettings} disabled={savingSettings} className="rounded-lg bg-black px-3 py-1.5 text-sm text-white">{savingSettings ? "Сохранение..." : "Сохранить"}</button><div className="ml-auto text-xs text-gray-500">Текущий режим: <b className={unlockSettings.is_paid ? "text-red-600" : "text-green-600"}>{unlockSettings.is_paid ? "ПЛАТНО" : "БЕСПЛАТНО"}</b></div></div>
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Режим unlock" value={dashboard.is_paid ? "ПЛАТНО" : "БЕСПЛАТНО"} sub={`Цена: ${money(fromTiyin(dashboard.price || 0))} сум`} valueClass={dashboard.is_paid ? "text-red-600" : "text-green-600"} /><StatCard label="Клиенты" value={money(dashboard.clients_total || 0)} sub={`Суммарный баланс: ${formatTiyinToSum(dashboard.balance_total || 0)} сум`} /><StatCard label="Unlocks" value={money(dashboard.unlocks_total || 0)} sub={`Сегодня: ${money(dashboard.unlocks_today || 0)}`} /><StatCard label="Выручка" value={`${formatTiyinToSum(dashboard.revenue_total || 0)} сум`} sub={`Сегодня: ${formatTiyinToSum(dashboard.revenue_today || 0)} сум`} /></div>
    <form onSubmit={(e) => { e.preventDefault(); fetchList({ limit: 50 }); }} className="mb-3 flex flex-wrap gap-2"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: имя / email / телефон / telegram / chat id" className="w-full rounded-lg border border-gray-300 px-3 py-2 md:w-[520px]" /><button type="submit" className="rounded-lg bg-gray-900 px-4 py-2 text-white hover:bg-black">Найти</button></form>
    <div className="rounded-2xl border bg-white shadow-sm"><table className="w-full table-fixed text-sm"><colgroup><col className="w-[70px]" /><col className="w-[260px]" /><col className="w-[145px]" /><col className="w-[150px]" /><col className="w-[120px]" /><col className="w-[90px]" /><col className="w-[125px]" /><col className="w-[200px]" /></colgroup><thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr><th className="p-3 text-left">ID</th><th className="p-3 text-left">Имя</th><th className="p-3 text-left">Телефон</th><th className="p-3 text-left">Telegram</th><th className="p-3 text-left">Баланс</th><th className="p-3 text-left">Unlocks</th><th className="p-3 text-left">Создан</th><th className="p-3 text-left">Действия</th></tr></thead><tbody>{items.map((c) => { const newBadge = isNew(c.created_at); const isDeleting = deletingId === Number(c.id); return <tr key={c.id} onClick={() => setSelected(c)} className={`cursor-pointer border-t transition hover:bg-orange-50/60 ${newBadge ? "bg-blue-50" : ""} ${selected?.id === c.id ? "bg-orange-50" : ""}`}><td className="p-3 font-mono text-xs text-gray-600">#{c.id}</td><td className="p-3"><div className="flex min-w-0 items-center gap-2">{newBadge && <span className="shrink-0 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white">NEW</span>}<span className="truncate font-semibold" title={c.name || ""}>{c.name || "—"}</span></div><div className="truncate text-xs text-gray-500" title={c.email || ""}>{c.email || "—"}</div></td><td className="p-3"><div className="truncate" title={c.phone || ""}>{c.phone || "—"}</div></td><td className="p-3"><div className="truncate" title={c.telegram || c.telegram_chat_id || ""}>{c.telegram || c.telegram_chat_id || "—"}</div></td><td className="p-3 text-xs font-semibold">{formatTiyinToSum(c.balance_current || 0)} сум</td><td className="p-3 text-xs font-semibold">{c.unlock_count || 0}</td><td className="p-3 text-xs text-gray-600">{toDisplayDate(c.created_at)}</td><td className="p-3"><div className="flex flex-wrap gap-2"><button type="button" onClick={(e) => { e.stopPropagation(); setSelected(c); }} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">Править</button><button type="button" onClick={(e) => { e.stopPropagation(); openAccess(c); }} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700">Доступы</button><button type="button" onClick={(e) => { e.stopPropagation(); handleDelete(c); }} disabled={isDeleting} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:bg-gray-400">{isDeleting ? "..." : "Удалить"}</button></div></td></tr>; })}{!items.length && !loading && <tr><td colSpan={8} className="p-8 text-center text-gray-500">Ничего не найдено</td></tr>}</tbody></table></div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-500"><div>Последний просмотр новых: {toDisplayDate(lastSeen)}</div>{nextCursor ? <button onClick={() => fetchList({ append: true, cursor: nextCursor, limit: 50 })} className="rounded-lg bg-gray-200 px-4 py-2 hover:bg-gray-300" disabled={loading}>{loading ? "Загрузка..." : "Загрузить ещё"}</button> : <span className="text-gray-400">Достигнут конец списка</span>}</div>
    <ClientDrawer row={selected} onClose={() => setSelected(null)} onSaved={handleSaved} />
    <ClientAccessModal open={modalOpen} client={accessClient} onClose={() => setModalOpen(false)} />
  </div>;
}

function ClientDrawer({ row, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [tempPassword, setTempPassword] = useState("");
  const [showHash, setShowHash] = useState(false);
  useEffect(() => { setForm(buildForm(row || {})); setTempPassword(""); setShowHash(false); }, [row]);
  const sections = useMemo(() => { const out = new Map(); for (const field of EDIT_FIELDS) { if (!out.has(field.section)) out.set(field.section, []); out.get(field.section).push(field); } return Array.from(out.entries()); }, []);
  if (!row) return null;
  const save = async () => { try { setSaving(true); const res = await apiPut(`/api/admin/clients-table/${row.id}`, buildPayload(form), "admin"); const saved = res?.row || res?.data?.row; if (saved) onSaved(saved); toast.success(`Клиент #${row.id} сохранён`); } catch (e) { console.error(e); toast.error(e?.message || "Не удалось сохранить клиента"); } finally { setSaving(false); } };
  const resetPassword = async () => { const ok = window.confirm(`Сбросить пароль клиента #${row.id}? Временный пароль будет показан один раз.`); if (!ok) return; try { setResetting(true); const res = await apiPost(`/api/admin/clients-table/${row.id}/reset-password`, {}, "admin"); setTempPassword(res?.temporary_password || res?.data?.temporary_password || ""); toast.success("Временный пароль создан"); } catch (e) { console.error(e); toast.error(e?.message || "Не удалось сбросить пароль"); } finally { setResetting(false); } };
  return <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><aside className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl"><div className="sticky top-0 z-10 border-b bg-white/95 p-5 backdrop-blur"><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-bold uppercase tracking-wider text-orange-600">Client editor</div><h2 className="mt-1 text-xl font-black">#{row.id} · {row.name || "Без имени"}</h2><p className="text-sm text-gray-500">ID, created_at и updated_at только для просмотра.</p></div><button onClick={onClose} className="rounded-full bg-gray-100 px-3 py-1.5 text-lg hover:bg-gray-200">×</button></div><div className="mt-4 flex gap-2"><button onClick={save} disabled={saving} className="rounded-xl bg-black px-4 py-2 text-sm font-bold text-white disabled:bg-gray-400">{saving ? "Сохранение..." : "Сохранить"}</button><button onClick={resetPassword} disabled={resetting} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:bg-gray-400">{resetting ? "Сброс..." : "🔁 Reset password"}</button></div>{tempPassword && <div className="mt-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm"><div className="font-bold text-green-800">Временный пароль:</div><code className="mt-1 block select-all rounded bg-white p-2 text-green-900">{tempPassword}</code></div>}</div><div className="space-y-5 p-5"><div className="grid grid-cols-1 gap-3 rounded-2xl border bg-gray-50 p-4 text-sm md:grid-cols-3"><Info label="ID" value={row.id} /><Info label="Created" value={toDisplayDate(row.created_at)} /><Info label="Updated" value={toDisplayDate(row.updated_at)} /><Info label="Баланс" value={`${formatTiyinToSum(row.balance_current || 0)} сум`} /><Info label="Unlocks" value={row.unlock_count || 0} /></div><div className="rounded-2xl border p-4"><div className="mb-2 flex items-center justify-between"><h3 className="font-bold">Безопасность</h3><button onClick={() => setShowHash((v) => !v)} className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-bold hover:bg-gray-200">{showHash ? "Скрыть hash" : "👁 View hash"}</button></div>{showHash ? <code className="block break-all rounded bg-gray-50 p-3 text-xs">{row.password_hash || row.password || "Hash не найден"}</code> : <div className="text-sm text-gray-500">Пароль не показывается. Используйте reset для выдачи временного пароля.</div>}</div>{sections.map(([title, fields]) => <section key={title} className="rounded-2xl border p-4"><h3 className="mb-3 font-bold">{title}</h3><div className="grid grid-cols-1 gap-3 md:grid-cols-2">{fields.map((f) => <EditField key={f.name} field={f} value={form[f.name]} onChange={(v) => setForm((old) => ({ ...old, [f.name]: v }))} />)}</div></section>)}</div></aside></div>;
}

function Info({ label, value }) { return <div><div className="text-xs font-bold uppercase tracking-wide text-gray-500">{label}</div><div className="mt-1 break-words font-semibold">{value || "—"}</div></div>; }
function EditField({ field, value, onChange }) { const base = "mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100"; return <label className={field.type === "textarea" || field.type === "json" ? "md:col-span-2" : ""}><span className="text-xs font-bold uppercase tracking-wide text-gray-500">{field.label}</span>{field.type === "textarea" || field.type === "json" ? <textarea rows={field.type === "json" ? 6 : 3} value={value || ""} onChange={(e) => onChange(e.target.value)} className={`${base} font-mono`} /> : <input type={field.type === "number" ? "number" : "text"} value={value || ""} onChange={(e) => onChange(e.target.value)} className={base} />}</label>; }
