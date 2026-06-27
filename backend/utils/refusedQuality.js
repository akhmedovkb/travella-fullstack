// backend/utils/refusedQuality.js

const {
  getServiceFieldChecks,
  getSubmitBlockers,
} = require("./serviceFieldMatrix");

function buildRefusedQuality(service = {}) {
  const checks = getServiceFieldChecks(service).filter((x) => x.key !== "grossPriceNotBelowNet");
  const total = checks.reduce((sum, x) => sum + Number(x.weight || 1), 0) || 1;
  const done = checks.filter((x) => x.ok).reduce((sum, x) => sum + Number(x.weight || 1), 0);
  const score = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
  const level = score >= 90 ? "excellent" : score >= 70 ? "good" : "needs_work";
  const blockers = getSubmitBlockers(service);

  return {
    score,
    level,
    completed: checks.filter((x) => x.ok).map((x) => x.key),
    missing: checks.filter((x) => !x.ok).map((x) => ({ key: x.key, label: x.label, required: x.required !== false })),
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

  const importantMissing = q.missing.filter((m) => !q.blockers.some((b) => b.key === m.key)).slice(0, 5);
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
