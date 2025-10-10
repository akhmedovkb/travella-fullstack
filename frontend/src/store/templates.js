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
  // безопасный best-effort апсерт; если на бэке другой путь — добавь сюда
  for (const [url, method] of [
    ["/api/templates", "POST"],
    ["/api/tour-templates", "POST"],
  ]) {
    const res = await fetchJSONLoose(url, null)?.catch?.(() => null); // ping
    // если эндпоинт существует, шлём отдельным запросом
    try {
      await fetch(new URL(url, API_BASE || window.frontend?.API_BASE || ""), {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tpl),
      });
      break;
    } catch { /* ignore and try next */ }
  }
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

  // если удалённый список получен — он авторитетный
  if (Array.isArray(remote)) {
    const serverNorm = remote
      .map(norm)
      .filter(t => t.title && t.days.length)
      .sort((a, b) => a.title.localeCompare(b.title));
    writeLS(serverNorm);
    return serverNorm;
  }

  // фолбэк: ничего не трогаем, оставляем локальные
  return readLS();
};
