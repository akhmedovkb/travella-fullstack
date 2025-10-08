// frontend/src/store/templates.js
// Самодостаточный модуль шаблонов: локальный кеш (localStorage) + мягкая синхронизация с бэкендом.
// Не ломает текущие вызовы (listTemplates / upsertTemplate / removeTemplate / getTemplate / newId),
// но при наличии API сохранит/подтянет шаблоны с сервера и обновит локальный кеш.

const LS_KEY = "tour_templates_v1";
const API_BASE = import.meta?.env?.VITE_API_BASE_URL || "";

// ---- helpers ---------------------------------------------------------------
const safeJSON = (s, fallback) => {
  try { return JSON.parse(s); } catch { return fallback; }
};
const saveCache = (arr) => localStorage.setItem(LS_KEY, JSON.stringify(arr || []));
const readCache = () => safeJSON(localStorage.getItem(LS_KEY) || "[]", []);

const urlJoin = (path) => new URL(path, API_BASE || window.frontend?.API_BASE || "").toString();
const fetchJSON = async (path, opts = {}) => {
  const r = await fetch(urlJoin(path), {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.status === 204 ? null : await r.json();
};

const normalizeTpl = (t) => ({
  id: t.id ?? t._id ?? t.uuid ?? t.slug ?? newId(),
  title: String(t.title || "").trim(),
  days: Array.isArray(t.days) ? t.days.map(d => ({ city: String(d.city || "").trim() })) : [],
});

// ---- публичный API (совместимый с вашим текущим кодом) --------------------

// Вернёт локальный кеш (который может быть обновлён syncTemplates()).
export function listTemplates() {
  return readCache();
}

export function saveTemplates(arr) {
  saveCache(arr);
}

// create/update: попробуем отправить на сервер, при ошибке — пишем в localStorage
export async function upsertTemplate(tpl) {
  const clean = normalizeTpl(tpl || {});
  // 1) Попробуем бэкенд
  try {
    const isNew = !tpl?.id;
    const path = isNew ? "/api/templates" : `/api/templates/${encodeURIComponent(clean.id)}`;
    await fetchJSON(path, { method: isNew ? "POST" : "PUT", body: JSON.stringify(clean) });
    // После успешной операции — подтянуть список с сервера и обновить кеш
    await syncTemplates();
    return;
  } catch (_) {
    // 2) Фоллбек: работаем локально
    const all = readCache();
    const i = all.findIndex(x => String(x.id) === String(clean.id));
    if (i >= 0) all[i] = clean; else all.unshift(clean);
    saveCache(all);
  }
}

export async function removeTemplate(id) {
  // 1) Попробуем удалить на сервере
  try {
    await fetchJSON(`/api/templates/${encodeURIComponent(id)}`, { method: "DELETE" });
    await syncTemplates();
    return;
  } catch (_) {
    // 2) Локальный фоллбек
    saveCache(readCache().filter(x => String(x.id) !== String(id)));
  }
}

export function getTemplate(id) {
  return readCache().find(x => String(x.id) === String(id)) || null;
}

// утилита: генерим id
export function newId(prefix = "tpl") {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now() % 1e6}`;
}

// ---- доп. API (по желанию используйте в компонентах) ----------------------
// Подтянуть шаблоны с бэка (если доступен) и положить в localStorage.
// Возвращает актуальный список (уже из кеша).
export async function syncTemplates() {
  try {
    const data = await fetchJSON("/api/templates"); // допускаем как массив, так и {items:[]}
    const arr = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
    const normalized = arr.map(normalizeTpl);
    saveCache(normalized);
  } catch (_) {
    // тихий фоллбек — остаёмся на локальном кеше
  }
  return readCache();
}
