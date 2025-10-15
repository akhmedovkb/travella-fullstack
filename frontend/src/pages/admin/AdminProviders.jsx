//frontend/src/pages/admin/AdminProviders.jsx
  
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { apiGet } from "../../api";

/**
 * Храним "последний просмотр" в localStorage,
 * чтобы подсвечивать новых провайдеров (created_at > lastSeen).
 */
const LS_KEY = "admin.providers.lastSeenISO";

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

export default function AdminProviders() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [loading, setLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [lastSeen, setLastSeen] = useLastSeen();
  const pollTimer = useRef(null);

  const fetchList = useCallback(async (opts = {}) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (type) params.set("type", type);
      if (opts.limit) params.set("limit", String(opts.limit));
      if (opts.cursor && opts.cursor.cursor_created_at && opts.cursor.cursor_id) {
        params.set("cursor_created_at", opts.cursor.cursor_created_at);
        params.set("cursor_id", opts.cursor.cursor_id);
      }
      const res = await apiGet(`/api/admin/providers-table?${params.toString()}`, "provider");
      // apiGet обычно возвращает уже data; но на всякий случай поддержим оба формата
      const payload = (res && res.data && (res.data.items || res.data.nextCursor !== undefined))
        ? res.data
        : res;
      const newItems = payload?.items || [];
      if (opts.append) {
        setItems((prev) => [...prev, ...newItems]);
      } else {
        setItems(newItems);
      }
      setNextCursor(payload?.nextCursor || null);
    } catch (e) {
      console.error(e);
      toast.error("Не удалось загрузить список провайдеров");
    } finally {
      setLoading(false);
    }
  }, [q, type]);

  const checkNew = useCallback(async () => {
    try {
      const since = encodeURIComponent(lastSeen);
      const res = await apiGet(`/api/admin/providers-table/new-count?since=${since}`, "provider");
      const payload = (res && res.data && (typeof res.data.count !== "undefined")) ? res.data : res;
      const count = Number(payload?.count || 0);
      if (count > 0) {
        toast.info(`Новых провайдеров: ${count}`, { icon: "🆕" });
      }
    } catch (e) {
      // тихо
    }
  }, [lastSeen]);

  // первичная загрузка
  useEffect(() => { fetchList({ limit: 50 }); }, [fetchList]);

  // polling каждые 30 сек на счетчик новых
  useEffect(() => {
    pollTimer.current = setInterval(checkNew, 30000);
    return () => clearInterval(pollTimer.current);
  }, [checkNew]);

  const onSearch = (e) => {
    e?.preventDefault?.();
    fetchList({ limit: 50 });
  };

  const onClearNewMark = () => {
    const now = new Date().toISOString();
    setLastSeen(now);
    toast.success("Метка обновлена — «новые» сброшены");
  };

  const isNew = useCallback((created_at) => {
    if (!created_at) return false;
    try {
      return new Date(created_at).toISOString() > (lastSeen || "");
    } catch { return false; }
  }, [lastSeen]);

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Провайдеры</h1>
        <div className="flex gap-2">
          <button
            onClick={onClearNewMark}
            className="px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
            title="Отметить текущий момент как последнюю точку просмотра"
          >
            Сбросить «Новые»
          </button>
        </div>
      </div>

      <form onSubmit={onSearch} className="flex flex-wrap gap-2 mb-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск: имя / email / телефон"
          className="input input-bordered w-full md:w-80 px-3 py-2 rounded-lg border border-gray-300"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-300"
        >
          <option value="">Все типы</option>
          <option value="guide">Гид</option>
          <option value="transport">Транспорт</option>
          <option value="agent">Турагент</option>
          <option value="hotel">Отель</option>
        </select>
        <button
          type="submit"
          className="px-3 py-2 rounded-lg bg-gray-800 text-white hover:bg-black"
        >
          Найти
        </button>
      </form>

      <div className="overflow-auto border rounded-xl">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              <th className="text-left p-3">ID</th>
              <th className="text-left p-3">Имя</th>
              <th className="text-left p-3">Тип</th>
              <th className="text-left p-3">Email</th>
              <th className="text-left p-3">Телефон</th>
              <th className="text-left p-3">Локация</th>
              <th className="text-left p-3">Языки</th>
              <th className="text-left p-3">Соцсети</th>
              <th className="text-left p-3">Создан</th>
              <th className="text-left p-3">Обновлен</th>
              <th className="text-left p-3"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => {
              const newBadge = isNew(p.created_at);
              return (
                <tr key={p.id} className={`border-t ${newBadge ? "bg-green-50" : ""}`}>
                  <td className="p-3">{p.id}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      {newBadge && <span className="px-2 py-0.5 text-xs rounded-full bg-green-600 text-white">NEW</span>}
                      <span className="font-medium">{p.name || "—"}</span>
                    </div>
                  </td>
                  <td className="p-3">{p.type || "—"}</td>
                  <td className="p-3">{p.email || "—"}</td>
                  <td className="p-3">{p.phone || "—"}</td>
                  <td className="p-3">{p.location || "—"}</td>
                  <td className="p-3">
                    {Array.isArray(p.languages) ? p.languages.join(", ") : (p.languages || "—")}
                  </td>
                  <td className="p-3">
                    <SocialCell value={p.social} />
                  </td>
                  <td className="p-3">{p.created_at ? new Date(p.created_at).toLocaleString() : "—"}</td>
                  <td className="p-3">{p.updated_at ? new Date(p.updated_at).toLocaleString() : "—"}</td>
                  <td className="p-3">
                    {/* пример перехода в карточку провайдера, если есть такая страница */}
                    {/* <button className="px-2 py-1 text-blue-600" onClick={() => navigate(`/admin/providers/${p.id}`)}>Открыть</button> */}
                  </td>
                </tr>
              );
            })}
            {!items.length && !loading && (
              <tr><td className="p-6 text-center text-gray-500" colSpan={10}>Ничего не найдено</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-3">
        <div className="text-sm text-gray-500">
          Последний просмотр новых: {new Date(lastSeen).toLocaleString()}
        </div>
        <div>
          {nextCursor ? (
            <button
              onClick={() => fetchList({ append: true, cursor: nextCursor, limit: 50 })}
              className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300"
              disabled={loading}
            >
              {loading ? "Загрузка..." : "Загрузить ещё"}
            </button>
          ) : (
            <span className="text-sm text-gray-400">Достигнут конец списка</span>
          )}
        </div>
      </div>
    </div>
  );
}
@@
   );
 }

/* ---------- helpers: social ---------- */
function SocialCell({ value }) {
  const links = normalizeSocial(value);
  if (!links.length) return <span>—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {links.map((x, i) => (
        <a
          key={i}
          href={x.url}
          target="_blank"
          rel="noopener noreferrer"
          className="px-2 py-0.5 rounded-full bg-gray-100 hover:bg-gray-200 text-xs text-gray-800"
          title={x.url}
        >
          {x.label}
        </a>
      ))}
    </div>
  );
}

function normalizeSocial(raw) {
  if (!raw) return [];
  try {
    // если пришёл объект {telegram:"...", instagram:"..."}
    if (typeof raw === "object" && !Array.isArray(raw)) {
      return Object.entries(raw)
        .filter(([,v]) => typeof v === "string" && v.trim())
        .map(([k, v]) => ({ label: prettyPlatform(k, v), url: toUrl(v) }))
        .filter(x => !!x.url);
    }
    // если массив
    if (Array.isArray(raw)) {
      return raw
        .map(v => (typeof v === "string" ? v : (v?.url || "")))
        .filter(Boolean)
        .map(v => ({ label: prettyPlatform("", v), url: toUrl(v) }))
        .filter(x => !!x.url);
    }
    // строка: может быть JSON, либо просто "url1, url2"
    if (typeof raw === "string") {
      const s = raw.trim();
      if (!s) return [];
      try {
        const parsed = JSON.parse(s);
        return normalizeSocial(parsed);
      } catch {
        return s.split(/[,\s]+/).filter(Boolean).map(v => ({ label: prettyPlatform("", v), url: toUrl(v) })).filter(x => !!x.url);
      }
    }
  } catch { /* ignore */ }
  return [];
}

function toUrl(v) {
  let s = String(v).trim();
  if (!s) return "";
  // короткие формы telegram/whatsapp
  if (/^@[\w_]+$/.test(s)) s = "https://t.me/" + s.slice(1);
  if (/^(t\.me|telegram\.me)\//i.test(s)) s = "https://" + s.replace(/^https?:\/\//i, "");
  if (/^wa\.me\//i.test(s)) s = "https://" + s.replace(/^https?:\/\//i, "");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try { new URL(s); return s; } catch { return ""; }
}

function prettyPlatform(k, url) {
  const u = String(url).toLowerCase();
  const map = [
    { test: /t\.me|telegram/, label: "TG" },
    { test: /wa\.me|whatsapp/, label: "WA" },
    { test: /instagram\.com/, label: "IG" },
    { test: /facebook\.com/, label: "FB" },
    { test: /vk\.com/, label: "VK" },
    { test: /youtube\.com|youtu\.be/, label: "YT" },
    { test: /twitter\.com|x\.com/, label: "X" },
    { test: /linkedin\.com/, label: "IN" },
  ];
  const byHost = map.find(m => m.test.test(u));
  if (byHost) return byHost.label;
  if (k) return String(k).toUpperCase();
  return "LINK";
}
