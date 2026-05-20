// frontend/src/pages/admin/AdminProviders.jsx

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import { apiDelete, apiGet, apiPost, apiPut } from "../../api";

const LS_KEY = "admin.providers.lastSeenISO";

const PROVIDER_TYPES = [
  ["", "Все типы"],
  ["guide", "Гид"],
  ["transport", "Транспорт"],
  ["agent", "Турагент"],
  ["hotel", "Отель"],
  ["client", "Клиент"],
];

const EDIT_FIELDS = [
  { name: "name", label: "Имя", type: "text", section: "Основное" },
  { name: "type", label: "Тип", type: "select", options: PROVIDER_TYPES.slice(1), section: "Основное" },
  { name: "email", label: "Email", type: "text", section: "Основное" },
  { name: "phone", label: "Телефон", type: "text", section: "Основное" },
  { name: "social", label: "Соцсети / Telegram", type: "text", section: "Основное" },
  { name: "address", label: "Адрес", type: "textarea", section: "Основное" },
  { name: "location", label: "Локации", type: "array", section: "Основное" },
  { name: "languages", label: "Языки", type: "array", section: "Основное" },
  { name: "city_slugs", label: "City slugs", type: "array", section: "Бизнес" },
  { name: "hotel_id", label: "Hotel ID", type: "number", section: "Бизнес" },
  { name: "car_fleet", label: "Автопарк JSON", type: "json", section: "Бизнес" },
  { name: "certificate", label: "Сертификат", type: "textarea", section: "Бизнес" },
  { name: "photo", label: "Фото / URL", type: "textarea", section: "Бизнес" },
  { name: "account_status", label: "Статус аккаунта", type: "text", section: "Система" },
  { name: "telegram_chat_id", label: "telegram_chat_id", type: "number", section: "Telegram" },
  { name: "tg_chat_id", label: "tg_chat_id", type: "number", section: "Telegram" },
  { name: "telegram_web_chat_id", label: "telegram_web_chat_id", type: "number", section: "Telegram" },
  { name: "telegram_refused_chat_id", label: "telegram_refused_chat_id", type: "number", section: "Telegram" },
];

function useLastSeen() {
  const [lastSeen, setLastSeen] = useState(() => localStorage.getItem(LS_KEY) || new Date(0).toISOString());
  const save = (iso) => {
    localStorage.setItem(LS_KEY, iso);
    setLastSeen(iso);
  };
  return [lastSeen, save];
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

function arrayToText(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return JSON.stringify(value, null, 2);
  return value || "";
}

function jsonToText(value) {
  if (value === null || typeof value === "undefined" || value === "") return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildForm(row) {
  const out = {};
  for (const f of EDIT_FIELDS) {
    out[f.name] = f.type === "json" ? jsonToText(row?.[f.name]) : arrayToText(row?.[f.name]);
  }
  return out;
}

function buildPayload(form) {
  const payload = {};
  for (const f of EDIT_FIELDS) {
    const raw = form[f.name];
    if (f.type === "json") {
      if (!String(raw || "").trim()) payload[f.name] = null;
      else {
        try {
          payload[f.name] = JSON.parse(raw);
        } catch {
          payload[f.name] = raw;
        }
      }
    } else if (f.type === "array") {
      payload[f.name] = String(raw || "")
        .split(/[\n,]/)
        .map((x) => x.trim())
        .filter(Boolean);
    } else if (f.type === "number") {
      payload[f.name] = String(raw || "").trim() ? Number(raw) : null;
    } else {
      payload[f.name] = raw;
    }
  }
  return payload;
}

export default function AdminProviders() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [lastSeen, setLastSeen] = useLastSeen();
  const [selected, setSelected] = useState(null);
  const pollTimer = useRef(null);

  const fetchList = useCallback(
    async (opts = {}) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (q) params.set("q", q);
        if (type) params.set("type", type);
        if (opts.limit) params.set("limit", String(opts.limit));
        if (opts.cursor?.cursor_created_at && opts.cursor?.cursor_id) {
          params.set("cursor_created_at", opts.cursor.cursor_created_at);
          params.set("cursor_id", opts.cursor.cursor_id);
        }

        const res = await apiGet(`/api/admin/providers-table?${params.toString()}`, "provider");
        const payload = res?.data && (res.data.items || res.data.nextCursor !== undefined) ? res.data : res;
        const newItems = payload?.items || [];
        setItems((prev) => (opts.append ? [...prev, ...newItems] : newItems));
        setNextCursor(payload?.nextCursor || null);
      } catch (e) {
        console.error(e);
        toast.error("Не удалось загрузить список провайдеров");
      } finally {
        setLoading(false);
      }
    },
    [q, type]
  );

  const checkNew = useCallback(async () => {
    try {
      const since = encodeURIComponent(lastSeen);
      const res = await apiGet(`/api/admin/providers-table/new-count?since=${since}`, "provider");
      const payload = res?.data && typeof res.data.count !== "undefined" ? res.data : res;
      const count = Number(payload?.count || 0);
      if (count > 0) toast.info(`Новых провайдеров: ${count}`, { icon: "🆕" });
    } catch {}
  }, [lastSeen]);

  useEffect(() => {
    fetchList({ limit: 50 });
  }, [fetchList]);

  useEffect(() => {
    pollTimer.current = setInterval(checkNew, 30000);
    return () => clearInterval(pollTimer.current);
  }, [checkNew]);

  const isNew = useCallback(
    (created_at) => {
      if (!created_at) return false;
      try {
        return new Date(created_at).toISOString() > (lastSeen || "");
      } catch {
        return false;
      }
    },
    [lastSeen]
  );

  const handleDelete = async (provider) => {
    const id = Number(provider?.id || 0);
    if (!id) return;
    const ok = window.confirm(`Удалить провайдера #${id}${provider?.name ? ` (${provider.name})` : ""}?\n\nЭто действие необратимо.`);
    if (!ok) return;
    try {
      setDeletingId(id);
      await apiDelete(`/api/admin/providers-table/${id}`, "provider");
      setItems((prev) => prev.filter((x) => Number(x.id) !== id));
      if (Number(selected?.id) === id) setSelected(null);
      toast.success(`Провайдер #${id} удалён`);
    } catch (e) {
      console.error(e);
      toast.error(e?.message || "Не удалось удалить провайдера");
    } finally {
      setDeletingId(null);
    }
  };

  const handleSaved = (row) => {
    setItems((prev) => prev.map((x) => (Number(x.id) === Number(row.id) ? { ...x, ...row } : x)));
    setSelected((prev) => (prev && Number(prev.id) === Number(row.id) ? { ...prev, ...row } : prev));
  };

  const onClearNewMark = () => {
    const now = new Date().toISOString();
    setLastSeen(now);
    toast.success("Метка обновлена — «новые» сброшены");
  };

  return (
    <div className="mx-auto max-w-7xl p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Провайдеры</h1>
          <p className="text-sm text-gray-500">Компактная таблица + полное редактирование в панели справа.</p>
        </div>
        <button onClick={onClearNewMark} className="rounded-lg bg-blue-600 px-3 py-2 text-white hover:bg-blue-700">
          Сбросить «Новые»
        </button>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); fetchList({ limit: 50 }); }} className="mb-3 flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: имя / email / телефон / telegram" className="w-full rounded-lg border border-gray-300 px-3 py-2 md:w-96" />
        <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2">
          {PROVIDER_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button type="submit" className="rounded-lg bg-gray-900 px-4 py-2 text-white hover:bg-black">Найти</button>
      </form>

      <div className="rounded-2xl border bg-white shadow-sm">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[70px]" /><col className="w-[260px]" /><col className="w-[105px]" /><col className="w-[150px]" /><col className="w-[160px]" /><col className="w-[140px]" /><col className="w-[125px]" /><col className="w-[150px]" />
          </colgroup>
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="p-3 text-left">ID</th><th className="p-3 text-left">Имя</th><th className="p-3 text-left">Тип</th><th className="p-3 text-left">Телефон</th><th className="p-3 text-left">Telegram</th><th className="p-3 text-left">Статус</th><th className="p-3 text-left">Создан</th><th className="p-3 text-left">Действия</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => {
              const newBadge = isNew(p.created_at);
              const isDeleting = deletingId === Number(p.id);
              return (
                <tr key={p.id} onClick={() => setSelected(p)} className={`cursor-pointer border-t transition hover:bg-orange-50/60 ${newBadge ? "bg-green-50" : ""} ${selected?.id === p.id ? "bg-orange-50" : ""}`}>
                  <td className="p-3 font-mono text-xs text-gray-600">#{p.id}</td>
                  <td className="p-3"><div className="flex min-w-0 items-center gap-2">{newBadge && <span className="shrink-0 rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-bold text-white">NEW</span>}<span className="truncate font-semibold" title={p.name || ""}>{p.name || "—"}</span></div><div className="truncate text-xs text-gray-500" title={p.email || ""}>{p.email || "—"}</div></td>
                  <td className="p-3"><span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold">{p.type || "—"}</span></td>
                  <td className="p-3"><div className="truncate" title={p.phone || ""}>{p.phone || "—"}</div></td>
                  <td className="p-3"><SocialCell value={p.social || p.telegram_chat_id || p.tg_chat_id} /></td>
                  <td className="p-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{p.account_status || "active"}</span></td>
                  <td className="p-3 text-xs text-gray-600">{toDisplayDate(p.created_at)}</td>
                  <td className="p-3"><div className="flex gap-2"><button type="button" onClick={(e) => { e.stopPropagation(); setSelected(p); }} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">Править</button><button type="button" onClick={(e) => { e.stopPropagation(); handleDelete(p); }} disabled={isDeleting} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:bg-gray-400">{isDeleting ? "..." : "Удалить"}</button></div></td>
                </tr>
              );
            })}
            {!items.length && !loading && <tr><td colSpan={8} className="p-8 text-center text-gray-500">Ничего не найдено</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-500">
        <div>Последний просмотр новых: {toDisplayDate(lastSeen)}</div>
        {nextCursor ? <button onClick={() => fetchList({ append: true, cursor: nextCursor, limit: 50 })} className="rounded-lg bg-gray-200 px-4 py-2 hover:bg-gray-300" disabled={loading}>{loading ? "Загрузка..." : "Загрузить ещё"}</button> : <span className="text-gray-400">Достигнут конец списка</span>}
      </div>

      <ProviderDrawer row={selected} onClose={() => setSelected(null)} onSaved={handleSaved} />
    </div>
  );
}

function ProviderDrawer({ row, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [tempPassword, setTempPassword] = useState("");
  const [showHash, setShowHash] = useState(false);

  useEffect(() => {
    setForm(buildForm(row || {}));
    setTempPassword("");
    setShowHash(false);
  }, [row]);

  const sections = useMemo(() => {
    const out = new Map();
    for (const field of EDIT_FIELDS) {
      if (!out.has(field.section)) out.set(field.section, []);
      out.get(field.section).push(field);
    }
    return Array.from(out.entries());
  }, []);

  if (!row) return null;

  const save = async () => {
    try {
      setSaving(true);
      const res = await apiPut(`/api/admin/providers-table/${row.id}`, buildPayload(form), "admin");
      const saved = res?.row || res?.data?.row;
      if (saved) onSaved(saved);
      toast.success(`Провайдер #${row.id} сохранён`);
    } catch (e) {
      console.error(e);
      toast.error(e?.message || "Не удалось сохранить провайдера");
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async () => {
    const ok = window.confirm(`Сбросить пароль провайдера #${row.id}? Временный пароль будет показан один раз.`);
    if (!ok) return;
    try {
      setResetting(true);
      const res = await apiPost(`/api/admin/providers-table/${row.id}/reset-password`, {}, "admin");
      setTempPassword(res?.temporary_password || res?.data?.temporary_password || "");
      toast.success("Временный пароль создан");
    } catch (e) {
      console.error(e);
      toast.error(e?.message || "Не удалось сбросить пароль");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 border-b bg-white/95 p-5 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div><div className="text-xs font-bold uppercase tracking-wider text-orange-600">Provider editor</div><h2 className="mt-1 text-xl font-black">#{row.id} · {row.name || "Без имени"}</h2><p className="text-sm text-gray-500">ID, created_at и updated_at только для просмотра.</p></div>
            <button onClick={onClose} className="rounded-full bg-gray-100 px-3 py-1.5 text-lg hover:bg-gray-200">×</button>
          </div>
          <div className="mt-4 flex gap-2"><button onClick={save} disabled={saving} className="rounded-xl bg-black px-4 py-2 text-sm font-bold text-white disabled:bg-gray-400">{saving ? "Сохранение..." : "Сохранить"}</button><button onClick={resetPassword} disabled={resetting} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:bg-gray-400">{resetting ? "Сброс..." : "🔁 Reset password"}</button></div>
          {tempPassword && <div className="mt-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm"><div className="font-bold text-green-800">Временный пароль:</div><code className="mt-1 block select-all rounded bg-white p-2 text-green-900">{tempPassword}</code></div>}
        </div>

        <div className="space-y-5 p-5">
          <ReadOnlyGrid row={row} />
          <div className="rounded-2xl border p-4"><div className="mb-2 flex items-center justify-between"><h3 className="font-bold">Безопасность</h3><button onClick={() => setShowHash((v) => !v)} className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-bold hover:bg-gray-200">{showHash ? "Скрыть hash" : "👁 View hash"}</button></div>{showHash ? <code className="block break-all rounded bg-gray-50 p-3 text-xs">{row.password_hash || row.password || "Hash не найден"}</code> : <div className="text-sm text-gray-500">Пароль не показывается. Используйте reset для выдачи временного пароля.</div>}</div>
          {sections.map(([title, fields]) => <section key={title} className="rounded-2xl border p-4"><h3 className="mb-3 font-bold">{title}</h3><div className="grid grid-cols-1 gap-3 md:grid-cols-2">{fields.map((f) => <EditField key={f.name} field={f} value={form[f.name]} onChange={(v) => setForm((old) => ({ ...old, [f.name]: v }))} />)}</div></section>)}
        </div>
      </aside>
    </div>
  );
}

function ReadOnlyGrid({ row }) {
  return <div className="grid grid-cols-1 gap-3 rounded-2xl border bg-gray-50 p-4 text-sm md:grid-cols-3"><Info label="ID" value={row.id} /><Info label="Created" value={toDisplayDate(row.created_at)} /><Info label="Updated" value={toDisplayDate(row.updated_at)} /></div>;
}

function Info({ label, value }) { return <div><div className="text-xs font-bold uppercase tracking-wide text-gray-500">{label}</div><div className="mt-1 break-words font-semibold">{value || "—"}</div></div>; }

function EditField({ field, value, onChange }) {
  const base = "mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100";
  return <label className={field.type === "textarea" || field.type === "json" ? "md:col-span-2" : ""}><span className="text-xs font-bold uppercase tracking-wide text-gray-500">{field.label}</span>{field.type === "select" ? <select value={value || ""} onChange={(e) => onChange(e.target.value)} className={base}>{field.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select> : field.type === "textarea" || field.type === "json" ? <textarea rows={field.type === "json" ? 6 : 3} value={value || ""} onChange={(e) => onChange(e.target.value)} className={`${base} font-mono`} /> : <input type={field.type === "number" ? "number" : "text"} value={value || ""} onChange={(e) => onChange(e.target.value)} className={base} />}</label>;
}

function SocialCell({ value }) {
  const links = normalizeSocial(value);
  if (!links.length) return <span className="text-gray-400">—</span>;
  return <div className="flex min-w-0 flex-wrap gap-1">{links.slice(0, 2).map((x, i) => <a key={i} href={x.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="max-w-[130px] truncate rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-800 hover:bg-gray-200" title={x.url}>{x.label}</a>)}</div>;
}

function normalizeSocial(raw) {
  if (!raw) return [];
  const value = String(raw).trim();
  if (!value) return [];
  const parts = value.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  return parts.map((part) => {
    let url = part;
    let label = part;
    if (part.startsWith("@")) { url = `https://t.me/${part.slice(1)}`; label = part; }
    else if (/^[A-Za-z0-9_]{4,}$/.test(part) && !part.includes(".")) { url = `https://t.me/${part}`; label = `@${part}`; }
    else if (!/^https?:\/\//i.test(part)) { url = `https://${part}`; }
    label = truncate(label.replace(/^https?:\/\//i, ""), 22);
    return { url, label };
  });
}
