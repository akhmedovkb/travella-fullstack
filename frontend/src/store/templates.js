// frontend/src/store/templates.js
const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

const STORAGE_KEY = "tb.templates.v1";

const readLocal = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
};
const writeLocal = (arr) => localStorage.setItem(STORAGE_KEY, JSON.stringify(arr || []));

export const listTemplates = () => {
  const arr = readLocal();
  // страховка формата
  return (Array.isArray(arr) ? arr : []).map(x => ({
    id: String(x?.id || ""),
    title: String(x?.title || ""),
    days: Array.isArray(x?.days) ? x.days.map(d => ({ city: String(d?.city || "").trim() })).filter(d => d.city) : []
  }));
};

export const getTemplate = (id) => listTemplates().find(t => String(t.id) === String(id));

export const newId = () => crypto?.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2));

export const upsertTemplateLocal = (tpl) => {
  const clean = {
    id: tpl.id || newId(),
    title: String(tpl.title || "").trim(),
    days: Array.isArray(tpl.days) ? tpl.days.map(d => ({ city: String(d?.city || "").trim() })).filter(d => d.city) : []
  };
  const list = listTemplates();
  const idx = list.findIndex(t => String(t.id) === String(clean.id));
  if (idx >= 0) list[idx] = clean; else list.push(clean);
  writeLocal(list);
  return clean;
};

export const removeTemplateLocal = (id) => {
  writeLocal(listTemplates().filter(t => String(t.id) !== String(id)));
};

// --- server helpers
const getToken = () => localStorage.getItem("token") || localStorage.getItem("providerToken") || "";
const authHeaders = () => {
  const tok = getToken();
  return tok ? { Authorization: `Bearer ${tok}` } : {};
};
const fetchJSON = async (url, options = {}) => {
  const r = await fetch(new URL(url, API_BASE), {
    method: "GET",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(options.headers || {}) },
    ...options,
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const ct = r.headers.get("content-type") || "";
  return ct.includes("application/json") ? r.json() : null;
};

// --- server API bound to the table tour_templates
export const upsertTemplateServer = async (tpl) => {
  // если редактируем существующий — отправляем id; если новый — можно без id
  const payload = {
    id: tpl.id || undefined,
    title: String(tpl.title || "").trim(),
    days: Array.isArray(tpl.days) ? tpl.days.map(d => ({ city: String(d?.city || "").trim() })).filter(d => d.city) : [],
    is_public: tpl.is_public !== false, // по умолчанию публичный
  };
  return await fetchJSON("/api/tour-templates", {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

export const removeTemplateServer = async (id) => {
  if (!id) return;
  try {
    await fetchJSON(`/api/tour-templates/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    // best-effort: игнорим сетевые/403/404 ошибки, локаль уже удалили
  }
};

/**
 * syncTemplates:
 *   1) тянем публичные с бэка (SELECT из tour_templates)
 *   2) кладём их в localStorage (перезаписываем по id)
 *   3) сохраняем локальные непротолкнутые (если id не конфликтует)
 */
export const syncTemplates = async () => {
  let server = [];
  try {
    const j = await fetchJSON("/api/templates/public", { method: "GET" });
    server = Array.isArray(j) ? j : [];
  } catch {
    server = [];
  }

  const local = listTemplates();
  const map = new Map();

  // приоритет серверу
  for (const s of server) {
    const clean = {
      id: String(s.id || ""),
      title: String(s.title || ""),
      days: Array.isArray(s.days) ? s.days.map(d => ({ city: String(d?.city || "").trim() })).filter(d => d.city) : []
    };
    if (clean.id) map.set(clean.id, clean);
  }
  // добавляем локальные, если их нет на сервере
  for (const l of local) {
    if (!map.has(String(l.id || "")) && l.title && Array.isArray(l.days) && l.days.length) {
      map.set(String(l.id), l);
    }
  }
  const merged = Array.from(map.values());
  writeLocal(merged);
  return merged;
};
