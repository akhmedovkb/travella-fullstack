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
  const c = String(category || "").trim().toLowerCase();
  const aliases = {
    refused_tickets: "refused_ticket",
    refused_event_tickets: "refused_event_ticket",
    event_ticket: "refused_event_ticket",
    event_tickets: "refused_event_ticket",
    ticket: "refused_event_ticket",
    tickets: "refused_event_ticket",
    flight: "refused_flight",
    flights: "refused_flight",
    avia: "refused_flight",
    airline_ticket: "refused_flight",
    air_ticket: "refused_flight",
    hotel: "refused_hotel",
    hotels: "refused_hotel",
    tour: "refused_tour",
    refused: "refused_tour",
  };
  return aliases[c] || c;
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
