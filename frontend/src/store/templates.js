// frontend/src/store/templates.js
const LS_KEY = "tb_templates_v1";

export const newId = () =>
  Math.random().toString(36).slice(2) + Date.now().toString(36);

const readLS = () => {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); }
  catch { return []; }
};
const writeLS = (arr) => {
  try { localStorage.setItem(LS_KEY, JSON.stringify(arr || [])); } catch {}
};

export const listTemplates = () => {
  // Всегда возвращаем локальные — страница работает офлайн/без API.
  return readLS();
};

export const getTemplate = (id) =>
  readLS().find((t) => String(t.id) === String(id));

export const upsertTemplate = (tpl) => {
  const items = readLS();
  const i = items.findIndex((x) => String(x.id) === String(tpl.id));
  if (i >= 0) items[i] = { ...items[i], ...tpl };
  else items.push({ ...tpl, id: tpl.id || newId() });
  writeLS(items);
  return items;
};

export const removeTemplate = (id) => {
  const next = readLS().filter((x) => String(x.id) !== String(id));
  writeLS(next);
  return next;
};

/** универсальный fetch JSON с credentials */
async function fetchJSON(url) {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw Object.assign(new Error("HTTP " + r.status), { status: r.status });
  return r.json();
}

/**
 * Синхронизация с сервером:
 * 1) /api/templates (для админов/авторов)
 * 2) если нет доступа/пусто — /api/templates/public (для всех)
 * 3) локальное не затираем пустотой; мердж по id + title/days
 */
export async function syncTemplates() {
  const current = readLS();

  // helper: приводит к унифицированной форме
  const norm = (row) => ({
    id: row.id || row._id || row.slug || newId(),
    title: row.title || row.name || "Template",
    days: Array.isArray(row.days)
      ? row.days.map((d) => ({ city: (d.city || d.name || "").trim() }))
      : [],
  });

  let serverItems = [];
  const tryPush = (arrLike) => {
    const arr = Array.isArray(arrLike?.items) ? arrLike.items
              : Array.isArray(arrLike) ? arrLike : [];
    serverItems = arr.map(norm).filter((t) => t.title && t.days.length);
  };

  // 1) основная попытка
  try {
    const j = await fetchJSON("/api/templates");
    tryPush(j);
  } catch (e) {
    // игнорируем — попробуем public
    // console.debug("templates: private fetch failed", e);
  }

  // 2) public, если надо
  if (!serverItems.length) {
    try {
      const j2 = await fetchJSON("/api/templates/public");
      tryPush(j2);
    } catch (e) {
      // оба запроса не удались — выходим, не трогая localStorage
      return current;
    }
  }

  // 3) мердж по id
  const map = new Map(current.map((t) => [String(t.id), t]));
  for (const t of serverItems) map.set(String(t.id), { ...(map.get(String(t.id))||{}), ...t });
  const merged = Array.from(map.values())
    .filter((t) => t.title && Array.isArray(t.days))
    .sort((a, b) => a.title.localeCompare(b.title));

  if (merged.length) writeLS(merged); // не пишем пустоту
  return merged.length ? merged : current;
}
