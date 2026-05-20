// frontend/src/pages/admin/AdminProviders.jsx

import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "react-toastify";
import { apiDelete, apiGet, apiPost, apiPut } from "../../api";

const LS_KEY = "admin.providers.lastSeenISO";

const PROVIDER_TYPES = [
  ["guide", "Гид"],
  ["transport", "Транспорт"],
  ["agent", "Турагент"],
  ["hotel", "Отель"],
];

const TEXT_FIELDS = [
  "name",
  "type",
  "email",
  "phone",
  "social",
  "address",
  "photo",
  "certificate",
  "car_fleet",
  "account_status",
  "hotel_id",
];

const LIST_FIELDS = ["location", "languages", "city_slugs"];

const TELEGRAM_FIELDS = [
  "telegram_chat_id",
  "tg_chat_id",
  "telegram_web_chat_id",
  "telegram_refused_chat_id",
];

function useLastSeen() {
  const [lastSeen, setLastSeen] = useState(() => {
    return localStorage.getItem(LS_KEY) || new Date(0).toISOString();
  });

  const save = (iso) => {
    localStorage.setItem(LS_KEY, iso);
    setLastSeen(iso);
  };

  return [lastSeen, save];
}

function fmtDate(x) {
  if (!x) return "—";
  try {
    return new Date(x).toLocaleString("ru-RU");
  } catch {
    return String(x);
  }
}

function toText(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function listToArray(value) {
  if (Array.isArray(value)) return value.map(String).map((x) => x.trim()).filter(Boolean);
  return String(value || "")
    .split(/[\n,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeEdit(provider) {
  const out = {};
  [...TEXT_FIELDS, ...TELEGRAM_FIELDS].forEach((key) => {
    out[key] = toText(provider?.[key]);
  });
  LIST_FIELDS.forEach((key) => {
    out[key] = toText(provider?.[key]);
  });
  return out;
}

function CellText({ children, title, className = "" }) {
  return (
    <div className={`truncate whitespace-nowrap ${className}`} title={title ?? toText(children)}>
      {children || "—"}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      {children}
    </label>
  );
}

function TextInput({ value, onChange, placeholder, type = "text" }) {
  return (
    <input
      type={type}
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
    />
  );
}

function TextArea({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
    />
  );
}

export default function AdminProviders() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [lastSeen, setLastSeen] = useLastSeen();
  const pollTimer = useRef(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [edit, setEdit] = useState({});
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [tempPassword, setTempPassword] = useState("");
  const [showHash, setShowHash] = useState(false);

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
        const payload = res && res.data && (res.data.items || res.data.nextCursor !== undefined) ? res.data : res;
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
      const payload = res && res.data && typeof res.data.count !== "undefined" ? res.data : res;
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

  const openDrawer = (provider) => {
    setSelected(provider);
    setEdit(normalizeEdit(provider));
    setTempPassword("");
    setShowHash(false);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setSelected(null);
    setEdit({});
    setTempPassword("");
    setShowHash(false);
  };

  const setField = (key, value) => setEdit((prev) => ({ ...prev, [key]: value }));

  const buildSavePayload = () => {
    const payload = {};
    TEXT_FIELDS.forEach((key) => {
      payload[key] = edit[key] === "" ? null : edit[key];
    });
    TELEGRAM_FIELDS.forEach((key) => {
      payload[key] = edit[key] === "" ? null : edit[key];
    });
    LIST_FIELDS.forEach((key) => {
      payload[key] = listToArray(edit[key]);
    });
    return payload;
  };

  const saveProvider = async () => {
    if (!selected?.id) return;
    try {
      setSaving(true);
      const res = await apiPut(`/api/admin/providers-table/${selected.id}`, buildSavePayload(), "provider");
      const updated = res?.item || res?.provider || res;
      setItems((prev) => prev.map((x) => (Number(x.id) === Number(selected.id) ? { ...x, ...updated } : x)));
      setSelected((prev) => ({ ...prev, ...updated }));
      toast.success(`Провайдер #${selected.id} сохранён`);
    } catch (e) {
      console.error(e);
      toast.error(e?.message || "Не удалось сохранить провайдера");
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async () => {
    if (!selected?.id) return;
    const ok = window.confirm(`Сбросить пароль провайдера #${selected.id}? Новый временный пароль будет показан один раз.`);
    if (!ok) return;
    try {
      setResetting(true);
      const res = await apiPost(`/api/admin/providers-table/${selected.id}/reset-password`, {}, "provider");
      setTempPassword(res?.temporaryPassword || res?.password || "");
      if (res?.password_hash || res?.password) {
        setSelected((prev) => ({ ...prev, password: res.password_hash || prev?.password }));
      }
      toast.success("Пароль сброшен");
    } catch (e) {
      console.error(e);
      toast.error(e?.message || "Не удалось сбросить пароль");
    } finally {
      setResetting(false);
    }
  };

  const handleDelete = async (provider) => {
    const id = Number(provider?.id || 0);
    if (!id) return;
    const ok = window.confirm(`Удалить провайдера #${id}${provider?.name ? ` (${provider.name})` : ""}?\n\nЭто действие необратимо.`);
    if (!ok) return;
    try {
      setDeletingId(id);
      await apiDelete(`/api/admin/providers-table/${id}`, "provider");
      setItems((prev) => prev.filter((x) => Number(x.id) !== id));
      if (Number(selected?.id) === id) closeDrawer();
      toast.success(`Провайдер #${id} удалён`);
    } catch (e) {
      console.error(e);
      toast.error(e?.message || "Не удалось удалить провайдера");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-950">Провайдеры</h1>
          <p className="mt-1 text-sm text-slate-500">Компактный список без горизонтального скролла. Все поля редактируются в правой панели.</p>
        </div>
        <button
          onClick={() => {
            const now = new Date().toISOString();
            setLastSeen(now);
            toast.success("Метка обновлена — «новые» сброшены");
          }}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
        >
          Сбросить «Новые»
        </button>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); fetchList({ limit: 50 }); }} className="mb-3 flex flex-wrap gap-2 rounded-2xl border bg-white p-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск: имя / email / телефон / telegram / id"
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 md:w-96"
        />
        <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400">
          <option value="">Все типы</option>
          {PROVIDER_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-black">Найти</button>
      </form>

      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <table className="w-full table-fixed text-xs">
          <colgroup>
            <col className="w-[62px]" />
            <col className="w-[64px]" />
            <col />
            <col className="w-[96px]" />
            <col className="w-[130px]" />
            <col className="w-[120px]" />
            <col className="w-[98px]" />
            <col className="w-[150px]" />
          </colgroup>
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-3 text-left font-black">ID</th>
              <th className="px-3 py-3 text-left font-black">NEW</th>
              <th className="px-3 py-3 text-left font-black">Имя</th>
              <th className="px-3 py-3 text-left font-black">Тип</th>
              <th className="px-3 py-3 text-left font-black">Телефон</th>
              <th className="px-3 py-3 text-left font-black">Telegram</th>
              <th className="px-3 py-3 text-left font-black">Статус</th>
              <th className="px-3 py-3 text-left font-black">Действия</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => {
              const newBadge = isNew(p.created_at);
              const isDeleting = deletingId === Number(p.id);
              return (
                <tr key={p.id} onClick={() => openDrawer(p)} className={`cursor-pointer border-t align-middle hover:bg-orange-50/40 ${newBadge ? "bg-green-50" : ""}`}>
                  <td className="px-3 py-3 font-mono text-slate-700">#{p.id}</td>
                  <td className="px-3 py-3">{newBadge ? <span className="rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-black text-white">NEW</span> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-3"><CellText className="font-bold text-slate-950" title={p.name}>{p.name || "—"}</CellText><CellText className="mt-0.5 text-[11px] text-slate-500" title={p.email}>{p.email || "—"}</CellText></td>
                  <td className="px-3 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">{p.type || "—"}</span></td>
                  <td className="px-3 py-3"><CellText title={p.phone}>{p.phone || "—"}</CellText></td>
                  <td className="px-3 py-3"><CellText title={p.telegram_chat_id || p.tg_chat_id || p.telegram_refused_chat_id}>{p.telegram_chat_id || p.tg_chat_id || p.telegram_refused_chat_id || "—"}</CellText></td>
                  <td className="px-3 py-3"><CellText title={p.account_status}>{p.account_status || "active"}</CellText></td>
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <button type="button" onClick={() => openDrawer(p)} className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-black">Править</button>
                      <button type="button" onClick={() => handleDelete(p)} disabled={isDeleting} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-white ${isDeleting ? "bg-slate-400" : "bg-red-600 hover:bg-red-700"}`}>{isDeleting ? "..." : "Удалить"}</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!items.length && !loading && <tr><td className="px-3 py-8 text-center text-slate-500" colSpan={8}>Ничего не найдено</td></tr>}
            {loading && !items.length && <tr><td className="px-3 py-8 text-center text-slate-500" colSpan={8}>Загрузка...</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-500">Последний просмотр новых: {fmtDate(lastSeen)}</div>
        {nextCursor ? (
          <button onClick={() => fetchList({ append: true, cursor: nextCursor, limit: 50 })} className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-bold hover:bg-slate-300" disabled={loading}>{loading ? "Загрузка..." : "Загрузить ещё"}</button>
        ) : <span className="text-sm text-slate-400">Достигнут конец списка</span>}
      </div>

      {drawerOpen && selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/35" onMouseDown={closeDrawer}>
          <aside className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 border-b bg-white/95 p-4 backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-widest text-orange-600">Provider editor</div>
                  <h2 className="mt-1 text-xl font-black text-slate-950">#{selected.id} · {selected.name || "Провайдер"}</h2>
                  <p className="mt-1 text-xs text-slate-500">ID, created_at и updated_at только для просмотра.</p>
                </div>
                <button onClick={closeDrawer} className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold hover:bg-slate-200">Закрыть</button>
              </div>
            </div>

            <div className="space-y-5 p-4">
              <section className="rounded-2xl border p-4">
                <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-700">Read-only</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="ID"><div className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-mono">{selected.id}</div></Field>
                  <Field label="created_at"><div className="rounded-xl bg-slate-50 px-3 py-2 text-sm">{fmtDate(selected.created_at)}</div></Field>
                  <Field label="updated_at"><div className="rounded-xl bg-slate-50 px-3 py-2 text-sm">{fmtDate(selected.updated_at)}</div></Field>
                </div>
              </section>

              <section className="rounded-2xl border p-4">
                <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-700">Основное</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Имя"><TextInput value={edit.name} onChange={(v) => setField("name", v)} /></Field>
                  <Field label="Тип"><select value={edit.type || ""} onChange={(e) => setField("type", e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="">—</option>{PROVIDER_TYPES.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
                  <Field label="Телефон"><TextInput value={edit.phone} onChange={(v) => setField("phone", v)} /></Field>
                  <Field label="Email"><TextInput value={edit.email} onChange={(v) => setField("email", v)} /></Field>
                  <Field label="Статус аккаунта"><TextInput value={edit.account_status} onChange={(v) => setField("account_status", v)} placeholder="active / blocked / pending" /></Field>
                  <Field label="hotel_id"><TextInput value={edit.hotel_id} onChange={(v) => setField("hotel_id", v)} /></Field>
                  <Field label="Address"><TextInput value={edit.address} onChange={(v) => setField("address", v)} /></Field>
                  <Field label="Photo URL"><TextInput value={edit.photo} onChange={(v) => setField("photo", v)} /></Field>
                  <Field label="Certificate"><TextInput value={edit.certificate} onChange={(v) => setField("certificate", v)} /></Field>
                  <Field label="Car fleet"><TextInput value={edit.car_fleet} onChange={(v) => setField("car_fleet", v)} /></Field>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3">
                  <Field label="Location / локации"><TextArea value={edit.location} onChange={(v) => setField("location", v)} placeholder="через запятую или с новой строки" /></Field>
                  <Field label="Languages / языки"><TextArea value={edit.languages} onChange={(v) => setField("languages", v)} placeholder="ru, uz, en" /></Field>
                  <Field label="City slugs"><TextArea value={edit.city_slugs} onChange={(v) => setField("city_slugs", v)} placeholder="tashkent, samarkand" /></Field>
                  <Field label="Social"><TextArea value={edit.social} onChange={(v) => setField("social", v)} rows={4} placeholder="@telegram / instagram / JSON" /></Field>
                </div>
              </section>

              <section className="rounded-2xl border p-4">
                <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-700">Telegram</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {TELEGRAM_FIELDS.map((key) => <Field key={key} label={key}><TextInput value={edit[key]} onChange={(v) => setField(key, v)} /></Field>)}
                </div>
              </section>

              <section className="rounded-2xl border p-4">
                <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-700">Безопасность</h3>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setShowHash((x) => !x)} className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold hover:bg-slate-200">👁 {showHash ? "Скрыть hash" : "View hash"}</button>
                  <button type="button" onClick={resetPassword} disabled={resetting} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:bg-slate-400">{resetting ? "Сброс..." : "🔁 Reset password"}</button>
                </div>
                {showHash && <pre className="mt-3 max-h-36 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{selected.password || selected.password_hash || "hash не найден в ответе API"}</pre>}
                {tempPassword && <div className="mt-3 rounded-2xl border border-green-200 bg-green-50 p-3"><div className="text-xs font-bold uppercase text-green-700">Временный пароль показывается один раз</div><div className="mt-1 select-all font-mono text-lg font-black text-green-900">{tempPassword}</div></div>}
              </section>

              <div className="sticky bottom-0 -mx-4 border-t bg-white p-4">
                <button onClick={saveProvider} disabled={saving} className="w-full rounded-2xl bg-orange-500 px-4 py-3 text-sm font-black text-white shadow-sm hover:bg-orange-600 disabled:bg-slate-400">{saving ? "Сохранение..." : "Сохранить изменения"}</button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
