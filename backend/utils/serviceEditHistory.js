const { isDeepStrictEqual } = require("node:util");
const ROOT_FIELDS = ["title", "description", "category", "price", "vehicle_model", "currency", "net_price", "gross_price", "country", "city", "location", "expiration_at", "availability"];
function auditValue(value) {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.startsWith("data:") ? "[файл]" : text.slice(0, 2000);
}
function buildServiceEditChanges(before, after, providerBefore = {}, providerAfter = {}) {
  const changes = [];
  const add = (field, oldValue, newValue) => {
    if (!isDeepStrictEqual(oldValue ?? null, newValue ?? null)) changes.push({ field, before: auditValue(oldValue), after: auditValue(newValue) });
  };
  for (const field of ROOT_FIELDS) add(field, before[field], after[field]);
  const oldDetails = before.details || {}, newDetails = after.details || {};
  for (const key of new Set([...Object.keys(oldDetails), ...Object.keys(newDetails)])) {
    if (["proofReviewedAt", "proofReviewedBy"].includes(key)) continue;
    if (key === "proofImages") {
      if (!isDeepStrictEqual(oldDetails[key], newDetails[key])) changes.push({ field: "details.proofImages", before: `${(oldDetails[key] || []).length} файлов`, after: `${(newDetails[key] || []).length} файлов (состав изменён)` });
    } else add(`details.${key}`, oldDetails[key], newDetails[key]);
  }
  if (!isDeepStrictEqual(before.images, after.images)) changes.push({ field: "images", before: `${(before.images || []).length} файлов`, after: `${(after.images || []).length} файлов (состав изменён)` });
  for (const field of ["telegram_refused_chat_id", "telegram_web_chat_id", "telegram_chat_id"]) add(`provider.${field}`, providerBefore[field], providerAfter[field]);
  return changes;
}
async function writeServiceEditHistory(client, { before, after, providerBefore, providerAfter, actorId }) {
  const changes = buildServiceEditChanges(before, after, providerBefore, providerAfter);
  if (!changes.length) return;
  await client.query(`INSERT INTO service_moderation_events (service_id, actor_id, actor_role, action, meta) VALUES ($1, $2, 'admin', 'service_edited', $3::jsonb)`, [after.id, actorId || null, JSON.stringify({ changes })]);
}
module.exports = { buildServiceEditChanges, writeServiceEditHistory };
