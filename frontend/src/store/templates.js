// frontend/src/store/templates.js
const LS_KEYS = ["TB_TEMPLATES_V1", "TB_TEMPLATES", "TB_TPLS"]; // <- миграция со старых ключей
const LS_PRIMARY = LS_KEYS[0];

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

const fetchJSON = async (path, params = {}) => {
  const u = new URL(path, API_BASE || window.frontend?.API_BASE || "");
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, v);
  });
  const r = await fetch(u.toString(), {
    credentials: "include",
    headers: { Accept: "application/json" }
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
};

const fetchJSONLoose = async (path, params) => {
  try { return await fetchJSON(path, params); } catch { return null; }
};

export const newId = () =>
  Math.random().toString(36).slice(2) + Date.now().toString(36);

const safeParse = (s) => {
  try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v : []; }
  catch { return []; }
};

// читаем с миграцией (берём первый непустой из списка ключей)
const readLS = () => {
  for (const k of LS_KEYS) {
    const arr = safeParse(localStorage.getItem(k));
    if (arr.length) return arr;
  }
  return [];
};

const writeLS = (arr) => {
  try { localStorage.setItem(LS_PRIMARY, JSON.stringify(arr || [])); } catch {}
};

const norm = (t) => ({
  id: String(t?.id || newId()),
  title: String(t?.title || "").trim(),
  days: Array.isArray(t?.days)
    ? t.days
        .map((d) => ({ city: String(d?.city || "").trim() }))
        .filter((d) => d.city)
    : [],
});

export const listTemplates = () => readLS();

export const getTemplate = (id) =>
  readLS().find((t) => String(t.id) === String(id));

export const upsertTemplateLocal = (tpl) => {
  const next = norm(tpl);
  if (!next.title || next.days.length === 0) return;
  const arr = readLS();
  const i = arr.findIndex((t) => String(t.id) === String(next.id));
  if (i >= 0) arr[i] = next; else arr.push(next);
  writeLS(arr);
};

export const removeTemplateLocal = (id) => {
  writeLS(readLS().filter((t) => String(t.id) !== String(id)));
};

// ── серверные вызовы (best-effort) ─────────────────────────────────────────────
export const upsertTemplateServer = async (tpl) => {
  // best-effort: пробуем несколько путей, успешным считаем только res.ok
  const base = API_BASE || window.frontend?.API_BASE || "";
  const tries = [
    ["/api/templates", "POST"],
    ["/api/tour-templates", "POST"],
    // при желании можно добавить сюда PUT/UPSERT варианты
    // ["/api/templates/upsert", "POST"],
  ];
  for (const [url, method] of tries) {
    try {
      const res = await fetch(new URL(url, base), {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(tpl),
      });
      if (res && res.ok) return true;   // только ok считаем успехом
    } catch {
      // сетевые ошибки игнорируем и идём к следующему пути
    }
  }
  return false;
};

/**
 * Синхронизация: тянем публичный список с бэка и мержим с локальными.
 * ВАЖНО: если сервер вернул пусто/ошибку — НИЧЕГО не перетираем.
 */
export const syncTemplates = async () => {
  let remote = null;

  for (const [url, params] of [
    ["/api/templates/public", {}],
    ["/api/templates", {}],
    ["/api/tour-templates", {}],
    ["/api/templates/list", {}],
  ]) {
    const r = await fetchJSONLoose(url, params);
    const items = Array.isArray(r?.items) ? r.items : (Array.isArray(r) ? r : null);
    if (items != null) { remote = items; break; }
  }

  const local = readLS();
  // Если сервера нет ИЛИ пришёл пустой список — ничего не трогаем
  if (!Array.isArray(remote) || remote.length === 0) {
    return local;
  }
  // Сервер есть и вернул непустой список — мержим (сервер приоритетнее)
  const serverNorm = remote
    .map(norm)
    .filter(t => t.title && t.days.length);
  const byId = new Map();
  for (const t of local) byId.set(String(t.id), norm(t));
  for (const t of serverNorm) byId.set(String(t.id), norm(t));
  const merged = Array.from(byId.values())
    .sort((a,b) => a.title.localeCompare(b.title));
  writeLS(merged);
  return merged;
};
