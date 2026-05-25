// backend/utils/serviceCategories.js

const REFUSED_CATEGORIES = Object.freeze([
  "refused_tour",
  "author_tour",
  "refused_hotel",
  "refused_flight",
  "refused_ticket",
  "refused_event_ticket",
]);

const PROOF_REQUIRED_CATEGORIES = Object.freeze([
  "refused_tour",
  "author_tour",
  "refused_hotel",
  "refused_flight",
  "refused_ticket",
  "refused_event_ticket",
]);

function normalizeCategory(category) {
  return String(category || "").trim().toLowerCase();
}

function isRefusedCategory(category) {
  return REFUSED_CATEGORIES.includes(normalizeCategory(category));
}

function isProofRequiredCategory(category) {
  return PROOF_REQUIRED_CATEGORIES.includes(normalizeCategory(category));
}

module.exports = {
  REFUSED_CATEGORIES,
  PROOF_REQUIRED_CATEGORIES,
  normalizeCategory,
  isRefusedCategory,
  isProofRequiredCategory,
};
