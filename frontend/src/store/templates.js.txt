// frontend/src/store/templates.js
const LS_KEY = "tour_templates_v1";

export function listTemplates() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; }
}
export function saveTemplates(arr) {
  localStorage.setItem(LS_KEY, JSON.stringify(arr));
}
export function upsertTemplate(tpl) {
  const all = listTemplates();
  const i = all.findIndex(x => String(x.id) === String(tpl.id));
  if (i >= 0) all[i] = tpl; else all.unshift(tpl);
  saveTemplates(all);
}
export function removeTemplate(id) {
  saveTemplates(listTemplates().filter(x => String(x.id) !== String(id)));
}
export function getTemplate(id) {
  return listTemplates().find(x => String(x.id) === String(id)) || null;
}

// утилита: генерим id
export function newId(prefix="tpl") {
  return `${prefix}_${Math.random().toString(36).slice(2,8)}_${Date.now()%1e6}`;
}
