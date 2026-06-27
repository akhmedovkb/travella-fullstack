// backend/utils/refusedQuality.js

const { normalizeCategory, isProofRequiredCategory } = require("./serviceCategories");
const {
  getCategoryChecks,
  getProofImages,
  getImages,
} = require("./serviceFieldMatrix");
const { normalizeDetails } = require("./serviceDisplay");
const { buildSubmitValidationBlockers } = require("./serviceSubmitValidation");

function addCheck(list, key, label, ok, weight = 1) {
  list.push({ key, label, ok: Boolean(ok), weight: Number(weight || 1) });
}

function buildRefusedQuality(service = {}) {
  const category = normalizeCategory(service.category);
  const d = normalizeDetails(service.details);

  // Один источник правды: quality использует ту же матрицу полей, что submit/moderation.
  const checks = getCategoryChecks(service).map((x) => ({
    key: x.key,
    label: x.label,
    ok: Boolean(x.ok),
    weight: Number(x.weight || 1),
  }));

  // Proof участвует в качестве и, для refused-категорий, в submit.
  addCheck(
    checks,
    "proof",
    "Proof / подтверждение",
    getProofImages(d).length > 0 || getImages(service.images).length > 0,
    isProofRequiredCategory(category) ? 3 : 1
  );

  const total = checks.reduce((sum, x) => sum + x.weight, 0) || 1;
  const done = checks.filter((x) => x.ok).reduce((sum, x) => sum + x.weight, 0);
  const score = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
  const level = score >= 90 ? "excellent" : score >= 70 ? "good" : "needs_work";
  const blockers = buildSubmitValidationBlockers(service);

  return {
    score,
    level,
    completed: checks.filter((x) => x.ok).map((x) => x.key),
    missing: checks.filter((x) => !x.ok).map((x) => ({ key: x.key, label: x.label })),
    checks,
    blockers,
    canSubmit: blockers.length === 0,
  };
}

function formatQualityText(service = {}) {
  const q = buildRefusedQuality(service);
  const icon = q.level === "excellent" ? "🟢" : q.level === "good" ? "🟡" : "🔴";
  const title = q.level === "excellent" ? "Отлично" : q.level === "good" ? "Хорошо" : "Нужно дополнить";
  const lines = [`${icon} <b>Качество карточки:</b> ${q.score}% · ${title}`];
  const importantMissing = q.missing.slice(0, 5);
  if (importantMissing.length) {
    lines.push("", "⚠️ <b>Что усилит карточку:</b>");
    importantMissing.forEach((m) => lines.push(`• ${m.label}`));
  }
  if (q.blockers.length) {
    lines.push("", "⛔ <b>Перед модерацией обязательно исправить:</b>");
    q.blockers.slice(0, 7).forEach((b) => lines.push(`• ${b.label}`));
  }
  return lines.join("\n");
}

module.exports = {
  buildRefusedQuality,
  formatQualityText,
};
