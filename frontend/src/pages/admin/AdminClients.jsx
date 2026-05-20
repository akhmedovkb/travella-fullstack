// frontend/src/pages/admin/AdminClients.jsx

import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "react-toastify";
import axios from "axios";
import { apiDelete, apiGet, apiPost, apiPut } from "../../api";
import ClientAccessModal from "../../components/admin/ClientAccessModal";
import { formatTiyinToSum } from "../../utils/money";

const LS_KEY = "admin.clients.lastSeenISO";
const TEXT_FIELDS = ["name", "email", "phone", "telegram", "tg_username", "avatar_url", "account_status", "source"];
const TELEGRAM_FIELDS = ["telegram_chat_id", "tg_chat_id"];
const LIST_FIELDS = ["languages", "location"];

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
function fmtDate(x) {
  if (!x) return "—";
  try {
    return new Date(x).toLocaleString("ru-RU");
  } catch {
    return String(x);
  }
}
function fmtCellDate(x) {
  if (!x) return "—";
  try {
    const d = new Date(x);
    return `${d.toLocaleDateString("ru-RU")}, ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
  } catch {
    return String(x);
  }
}
function getAuthHeader() {
  const token = localStorage.getItem("adminToken") || localStorage.getItem("providerToken") || localStorage.getItem("token") || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}
function toText(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") {
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }
  return String(value);
}
function listToArray(value) {
  if (Array.isArray(value)) return value.map(String).map((x) => x.trim()).filter(Boolean);
  return String(value || "").split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
}
function normalizeEdit(client) {
  const out = {};
  [...TEXT_FIELDS, ...TELEGRAM_FIELDS].forEach((key) => { out[key] = toText(client?.[key]); });
  LIST_FIELDS.forEach((key) => { out[key] = toText(client?.[key]); });
  return out;
}
function buildSavePayload(edit) {
  const payload = {};
  TEXT_FIELDS.forEach((key) => { payload[key] = edit[key] === "" ? null : edit[key]; });
  TELEGRAM_FIELDS.forEach((key) => { payload[key] = edit[key] === "" ? null : edit[key]; });
  LIST_FIELDS.forEach((key) => { payload[key] = listToArray(edit[key]); });
  return payload;
}
function StatCard({ label, value, sub, valueClass = "" }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-white p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-1 break-words text-lg font-semibold leading-tight xl:text-2xl ${valueClass}`}>{value}</div>
      <div className="mt-1 break-words text-sm text-gray-500">{sub}</div>
    </div>
  );
}
function CellText({ children, className = "", title }) {
  return <div className={`truncate whitespace-nowrap ${className}`} title={title ?? toText(children)}>{children || "—"}</div>;
}
function Field({ label, children }) {
  return <label className="block"><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>{children}</label>;
}
function TextInput({ value, onChange, placeholder, type = "text" }) {
  return <input type={type} value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100" />;
}
function TextArea({ value, onChange, placeholder, rows = 3 }) {
  return <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows} className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100" />;
}

export default function AdminClients() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [lastSeen, setLastSeen] = useLastSeen();
  const pollTimer = useRef(null);

  const [selectedClient, setSelectedClient] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [edit, setEdit] = useState({});
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [tempPassword, setTempPassword] = useState("");
  const [showHash, setShowHash] = useState(false);

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
      const payload = res && res.data && (res.data.items || res.data.nextCursor !== undefined) ? res.data : res;
      const baseItems = payload?.items || [];

      let extraRows = [];
      try {
        const resExtra = await apiGet("/api/admin/clients?limit=200&offset=0", "admin");
        const payloadExtra = resExtra && resExtra.data && Array.isArray(resExtra.data.rows) ? resExtra.data : resExtra;
        extraRows = payloadExtra?.rows || [];
      } catch (e) { console.warn("[AdminClients] extra rows fetch failed:", e?.message || e); }

      const extraMap = new Map(extraRows.map((r) => [Number(r.id), { balance_current: r.balance_current ?? 0, unlock_count: r.unlock_count ?? 0 }]));
      const newItems = baseItems.map((item) => {
        const extra = extraMap.get(Number(item.id));
        return { ...item, balance_current: extra?.balance_current ?? item.balance_current ?? 0, unlock_count: extra?.unlock_count ?? item.unlock_count ?? 0 };
      });

      setItems((prev) => opts.append ? [...prev, ...newItems] : newItems);
      setNextCursor(payload?.nextCursor || null);
    } catch (e) {
      console.error(e);
      toast.error("Не удалось загрузить список клиентов");
    } finally { setLoading(false); }
  }, [q]);

  const checkNew = useCallback(async () => {
    try {
      const since = encodeURIComponent(lastSeen);
      const res = await apiGet(`/api/admin/clients-table/new-count?since=${since}`, "provider");
      const payload = res && res.data && typeof res.data.count !== "undefined" ? res.data : res;
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
      await loadUnlockSettings();
      await loadDashboard();
    } catch (e) { console.error(e); toast.error("Ошибка сохранения"); } finally { setSavingSettings(false); }
  };

  const openDrawer = (client) => {
    setSelectedClient(client);
    setEdit(normalizeEdit(client));
    setTempPassword("");
    setShowHash(false);
    setDrawerOpen(true);
  };
  const closeDrawer = () => {
    setDrawerOpen(false);
    setSelectedClient(null);
    setEdit({});
    setTempPassword("");
    setShowHash(false);
  };
  const setField = (key, value) => setEdit((prev) => ({ ...prev, [key]: value }));

  const saveClient = async () => {
    if (!selectedClient?.id) return;
    try {
      setSaving(true);
      const res = await apiPut(`/api/admin/clients-table/${selectedClient.id}`, buildSavePayload(edit), "provider");
      const updated = res?.item || res?.client || res;
      setItems((prev) => prev.map((x) => Number(x.id) === Number(selectedClient.id) ? { ...x, ...updated } : x));
      setSelectedClient((prev) => ({ ...prev, ...updated }));
      toast.success(`Клиент #${selectedClient.id} сохранён`);
      await loadDashboard();
    } catch (e) { console.error(e); toast.error(e?.message || "Не удалось сохранить клиента"); } finally { setSaving(false); }
  };

  const resetPassword = async () => {
    if (!selectedClient?.id) return;
    const ok = window.confirm(`Сбросить пароль клиента #${selectedClient.id}? Новый временный пароль будет показан один раз.`);
    if (!ok) return;
    try {
      setResetting(true);
      const res = await apiPost(`/api/admin/clients-table/${selectedClient.id}/reset-password`, {}, "provider");
      setTempPassword(res?.temporaryPassword || res?.password || "");
      if (res?.password_hash) setSelectedClient((prev) => ({ ...prev, password_hash: res.password_hash }));
      toast.success("Пароль сброшен");
    } catch (e) { console.error(e); toast.error(e?.message || "Не удалось сбросить пароль"); } finally { setResetting(false); }
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
      if (Number(selectedClient?.id) === id) closeDrawer();
      toast.success(`Клиент #${id} удалён`);
      await loadDashboard();
    } catch (e) { console.error(e); toast.error(e?.message || "Не удалось удалить клиента"); } finally { setDeletingId(null); }
  };

  const openAccess = (client) => { setSelectedClient(client); setModalOpen(true); };

  return (
    <div className="mx-auto max-w-7xl p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-950">Клиенты</h1>
          <p className="mt-1 text-sm text-slate-500">Компактный список без горизонтального скролла. Все поля редактируются в правой панели.</p>
        </div>
        <button onClick={onClearNewMark} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">Сбросить «Новые»</button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-4 rounded-2xl border bg-white p-4">
        <div className="text-sm font-semibold">Открытие контактов:</div>
        <label className="flex items-center gap-2 text-sm"><input type="radio" checked={unlockSettings.is_paid === true} onChange={() => setUnlockSettings((s) => ({ ...s, is_paid: true }))} />Платно</label>
        <label className="flex items-center gap-2 text-sm"><input type="radio" checked={unlockSettings.is_paid === false} onChange={() => setUnlockSettings((s) => ({ ...s, is_paid: false }))} />Бесплатно</label>
        <div className="flex items-center gap-2"><span className="text-sm">Цена:</span><input type="number" value={unlockSettings.price} onChange={(e) => setUnlockSettings((s) => ({ ...s, price: e.target.value }))} className="w-[120px] rounded-lg border px-2 py-1 text-sm" /><span className="text-sm">сум</span></div>
        <button onClick={saveUnlockSettings} disabled={savingSettings} className="rounded-lg bg-black px-3 py-1.5 text-sm text-white">{savingSettings ? "Сохранение..." : "Сохранить"}</button>
        <div className="ml-auto text-xs text-gray-500">Текущий режим: <b className={unlockSettings.is_paid ? "text-red-600" : "text-green-600"}>{unlockSettings.is_paid ? "ПЛАТНО" : "БЕСПЛАТНО"}</b></div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Режим unlock" value={dashboard.is_paid ? "ПЛАТНО" : "БЕСПЛАТНО"} sub={`Цена: ${money(fromTiyin(dashboard.price || 0))} сум`} valueClass={dashboard.is_paid ? "text-red-600" : "text-green-600"} />
        <StatCard label="Клиенты" value={money(dashboard.clients_total || 0)} sub={`Суммарный баланс: ${formatTiyinToSum(dashboard.balance_total || 0)} сум`} />
        <StatCard label="Unlocks" value={money(dashboard.unlocks_total || 0)} sub={`Сегодня: ${money(dashboard.unlocks_today || 0)}`} />
        <StatCard label="Выручка" value={`${formatTiyinToSum(dashboard.revenue_total || 0)} сум`} sub={`Сегодня: ${formatTiyinToSum(dashboard.revenue_today || 0)} сум`} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); fetchList({ limit: 50 }); }} className="mb-3 flex flex-wrap gap-2 rounded-2xl border bg-white p-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: имя / email / телефон / telegram / chat id" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 md:w-[420px]" />
        <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-black">Найти</button>
      </form>

      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <table className="w-full table-fixed text-xs">
          <colgroup><col className="w-[62px]" /><col className="w-[64px]" /><col /><col className="w-[130px]" /><col className="w-[120px]" /><col className="w-[95px]" /><col className="w-[78px]" /><col className="w-[160px]" /></colgroup>
          <thead className="bg-slate-50 text-slate-600"><tr><th className="px-3 py-3 text-left font-black">ID</th><th className="px-3 py-3 text-left font-black">NEW</th><th className="px-3 py-3 text-left font-black">Имя</th><th className="px-3 py-3 text-left font-black">Телефон</th><th className="px-3 py-3 text-left font-black">Telegram</th><th className="px-3 py-3 text-left font-black">Баланс</th><th className="px-3 py-3 text-left font-black">Unlocks</th><th className="px-3 py-3 text-left font-black">Действия</th></tr></thead>
          <tbody>
            {items.map((c) => {
              const newBadge = isNew(c.created_at);
              const isDeleting = deletingId === Number(c.id);
              return (
                <tr key={c.id} onClick={() => openDrawer(c)} className={`cursor-pointer border-t align-middle hover:bg-orange-50/40 ${newBadge ? "bg-blue-50/60" : ""}`}>
                  <td className="px-3 py-3 font-mono text-slate-700">#{c.id}</td>
                  <td className="px-3 py-3">{newBadge ? <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-black text-white">NEW</span> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-3"><CellText className="font-bold text-slate-950" title={c.name}>{c.name || "—"}</CellText><CellText className="mt-0.5 text-[11px] text-slate-500" title={c.email}>{c.email || "—"}</CellText></td>
                  <td className="px-3 py-3"><CellText title={c.phone}>{c.phone || "—"}</CellText></td>
                  <td className="px-3 py-3"><CellText title={c.telegram || c.telegram_chat_id || c.tg_chat_id}>{c.telegram || c.telegram_chat_id || c.tg_chat_id || "—"}</CellText></td>
                  <td className="px-3 py-3 font-semibold text-slate-900">{formatTiyinToSum(c.balance_current || 0)} сум</td>
                  <td className="px-3 py-3 font-semibold text-slate-900">{Number(c.unlock_count || 0)}</td>
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}><div className="flex flex-wrap gap-1"><button type="button" onClick={() => openDrawer(c)} className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-black">Править</button><button type="button" onClick={() => openAccess(c)} className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-blue-700">Доступы</button><button type="button" onClick={() => handleDelete(c)} disabled={isDeleting} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-white ${isDeleting ? "bg-slate-400" : "bg-red-600 hover:bg-red-700"}`}>{isDeleting ? "..." : "Удалить"}</button></div></td>
                </tr>
              );
            })}
            {!items.length && !loading && <tr><td className="px-3 py-8 text-center text-slate-500" colSpan={8}>Ничего не найдено</td></tr>}
            {loading && !items.length && <tr><td className="px-3 py-8 text-center text-slate-500" colSpan={8}>Загрузка...</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><div className="text-sm text-slate-500">Последний просмотр новых: {fmtDate(lastSeen)}</div>{nextCursor ? <button onClick={() => fetchList({ append: true, cursor: nextCursor, limit: 50 })} className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-bold hover:bg-slate-300" disabled={loading}>{loading ? "Загрузка..." : "Загрузить ещё"}</button> : <span className="text-sm text-slate-400">Достигнут конец списка</span>}</div>

      {drawerOpen && selectedClient && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/35" onMouseDown={closeDrawer}>
          <aside className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 border-b bg-white/95 p-4 backdrop-blur"><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-black uppercase tracking-widest text-orange-600">Client editor</div><h2 className="mt-1 text-xl font-black text-slate-950">#{selectedClient.id} · {selectedClient.name || "Клиент"}</h2><p className="mt-1 text-xs text-slate-500">ID, created_at и updated_at только для просмотра.</p></div><button onClick={closeDrawer} className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold hover:bg-slate-200">Закрыть</button></div></div>
            <div className="space-y-5 p-4">
              <section className="rounded-2xl border p-4"><h3 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-700">Read-only</h3><div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><Field label="ID"><div className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-mono">{selectedClient.id}</div></Field><Field label="created_at"><div className="rounded-xl bg-slate-50 px-3 py-2 text-sm">{fmtCellDate(selectedClient.created_at)}</div></Field><Field label="updated_at"><div className="rounded-xl bg-slate-50 px-3 py-2 text-sm">{fmtCellDate(selectedClient.updated_at)}</div></Field></div></section>
              <section className="rounded-2xl border p-4"><h3 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-700">Основное</h3><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="Имя"><TextInput value={edit.name} onChange={(v) => setField("name", v)} /></Field><Field label="Телефон"><TextInput value={edit.phone} onChange={(v) => setField("phone", v)} /></Field><Field label="Email"><TextInput value={edit.email} onChange={(v) => setField("email", v)} /></Field><Field label="Telegram"><TextInput value={edit.telegram} onChange={(v) => setField("telegram", v)} /></Field><Field label="tg_username"><TextInput value={edit.tg_username} onChange={(v) => setField("tg_username", v)} /></Field><Field label="account_status"><TextInput value={edit.account_status} onChange={(v) => setField("account_status", v)} /></Field><Field label="source"><TextInput value={edit.source} onChange={(v) => setField("source", v)} /></Field><Field label="avatar_url"><TextInput value={edit.avatar_url} onChange={(v) => setField("avatar_url", v)} /></Field></div><div className="mt-3 grid grid-cols-1 gap-3"><Field label="Languages"><TextArea value={edit.languages} onChange={(v) => setField("languages", v)} placeholder="ru, uz, en" /></Field><Field label="Location"><TextArea value={edit.location} onChange={(v) => setField("location", v)} placeholder="через запятую или с новой строки" /></Field></div></section>
              <section className="rounded-2xl border p-4"><h3 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-700">Telegram</h3><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{TELEGRAM_FIELDS.map((key) => <Field key={key} label={key}><TextInput value={edit[key]} onChange={(v) => setField(key, v)} /></Field>)}</div></section>
              <section className="rounded-2xl border p-4"><h3 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-700">Финансы</h3><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="Баланс"><div className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-bold">{formatTiyinToSum(selectedClient.balance_current || 0)} сум</div></Field><Field label="Unlocks"><div className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-bold">{Number(selectedClient.unlock_count || 0)}</div></Field></div></section>
              <section className="rounded-2xl border p-4"><h3 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-700">Безопасность</h3><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setShowHash((x) => !x)} className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold hover:bg-slate-200">👁 {showHash ? "Скрыть hash" : "View hash"}</button><button type="button" onClick={resetPassword} disabled={resetting} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:bg-slate-400">{resetting ? "Сброс..." : "🔁 Reset password"}</button></div>{showHash && <pre className="mt-3 max-h-36 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{selectedClient.password_hash || selectedClient.password || "hash не найден в ответе API"}</pre>}{tempPassword && <div className="mt-3 rounded-2xl border border-green-200 bg-green-50 p-3"><div className="text-xs font-bold uppercase text-green-700">Временный пароль показывается один раз</div><div className="mt-1 select-all font-mono text-lg font-black text-green-900">{tempPassword}</div></div>}</section>
              <div className="sticky bottom-0 -mx-4 border-t bg-white p-4"><button onClick={saveClient} disabled={saving} className="w-full rounded-2xl bg-orange-500 px-4 py-3 text-sm font-black text-white shadow-sm hover:bg-orange-600 disabled:bg-slate-400">{saving ? "Сохранение..." : "Сохранить изменения"}</button></div>
            </div>
          </aside>
        </div>
      )}

      <ClientAccessModal open={modalOpen} client={selectedClient} onClose={() => { setModalOpen(false); setSelectedClient(null); }} onChanged={async () => { await fetchList({ limit: 50 }); await loadDashboard(); }} />
    </div>
  );
}
