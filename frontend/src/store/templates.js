// frontend/src/store/templates.js
const LS_KEY = "TB_TEMPLATES_V1";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

const fetchJSON = async (path, params = {}) => {
  const u = new URL(path, API_BASE || window.frontend?.API_BASE || "");
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, v);
  });
  const r = await fetch(u.toString(), { credentials: "include" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
};

const fetchJSONLoose = async (path, params) => {
  try { return await fetchJSON(path, params); } catch { return null; }
};

export const newId = () =>
  Math.random().toString(36).slice(2) + Date.now().toString(36);

const readLS = () => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
};

const writeLS = (arr) => {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(arr || []));
  } catch {}
};

const norm = (t) => ({
  id: String(t.id || newId()),
  title: String(t.title || "").trim(),
  days: Array.isArray(t.days) ? t.days
    .map(d => ({ city: String(d?.city || "").trim() }))
    .filter(d => d.city) : [],
});

/** Публичный список — НИЧЕГО не трогаем в хранилище */
export const listTemplates = () => readLS();

/** Получить один шаблон по id */
export const getTemplate = (id) => readLS().find(t => String(t.id) === String(id));

/** Создать/обновить локально. (Админская страница уже сама дергает бэкенд при желании.) */
export const upsertTemplate = (tpl) => {
  const next = norm(tpl);
  if (!next.title || next.days.length === 0) return;
  const arr = readLS();
  const i = arr.findIndex(t => String(t.id) === String(next.id));
  if (i >= 0) arr[i] = next; else arr.push(next);
  writeLS(arr);
};

/** Удалить локально */
export const removeTemplate = (id) => {
  const arr = readLS().filter(t => String(t.id) !== String(id));
  writeLS(arr);
};

/**
 * Подтянуть серверные шаблоны (если есть API) и слить с локальными.
 * Политика мерджа:
 *  - одинаковый id → серверная версия заменяет локальную
 *  - уникальные id сохраняем все
 * Возвращаем актуальный массив (и кладём его в LS).
 */
export const syncTemplates = async () => {
  // пробуем несколько общепринятых эндпоинтов
  let remote = null;
  for (const q of [
    ["/api/templates", {}],
    ["/api/tour-templates", {}],
    ["/api/templates/public", {}],
  ]) {
    const r = await fetchJSONLoose(q[0], q[1]);
    const items = Array.isArray(r?.items) ? r.items : (Array.isArray(r) ? r : null);
    if (items) { remote = items; break; }
  }

  const local = readLS();
  if (!remote) {
    // нет сервера — оставляем локальные как есть
    return local;
  }

  const serverNorm = remote
    .map(norm)
    // фильтр на пустые
    .filter(t => t.title && t.days.length);

  // мердж по id
  const byId = new Map();
  for (const t of local) byId.set(String(t.id), norm(t));
  for (const t of serverNorm) byId.set(String(t.id), norm(t)); // сервер приоритетнее

  const merged = Array.from(byId.values())
    .sort((a,b) => a.title.localeCompare(b.title));

  writeLS(merged);
  return merged;
};
