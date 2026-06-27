// backend/utils/serviceWizardEngine.js
// Travella Wizard Engine v2: one category-aware step registry for service wizards.
// This file is intentionally dependency-light so it can be used by Telegram,
// web/API validation, draft progress and tests without pulling Telegraf/React.

const { normalizeCategory } = require("./serviceCategories");

const STEP = Object.freeze({
  TITLE: "svc_create_title",
  COUNTRY: "svc_create_tour_country",
  FROM: "svc_create_tour_from",
  TO: "svc_create_tour_to",
  TOUR_START: "svc_create_tour_start",
  TOUR_END: "svc_create_tour_end",
  FLIGHT_TYPE: "svc_create_flight_type",
  FLIGHT_DEPARTURE: "svc_create_flight_departure",
  FLIGHT_RETURN: "svc_create_flight_return",
  FLIGHT_AIRLINE: "svc_create_flight_airline",
  FLIGHT_DETAILS: "svc_create_flight_details",
  TOUR_HOTEL: "svc_create_tour_hotel",
  TOUR_ACCOMMODATION: "svc_create_tour_accommodation",
  TOUR_ROOM: "svc_create_tour_roomcat",
  TOUR_FOOD: "svc_create_tour_food",
  TOUR_TRANSFER: "svc_create_tour_transfer",
  TOUR_INSURANCE: "svc_create_tour_insurance",
  TOUR_VISA: "svc_create_tour_visa",
  TOUR_EARLY_CHECKIN: "svc_create_tour_early_checkin",
  TOUR_FAST_TRACK: "svc_create_tour_fast_track",
  HOTEL_COUNTRY: "svc_hotel_country",
  HOTEL_CITY: "svc_hotel_city",
  HOTEL_NAME: "svc_hotel_name",
  HOTEL_CHECKIN: "svc_hotel_checkin",
  HOTEL_CHECKOUT: "svc_hotel_checkout",
  HOTEL_ROOM: "svc_hotel_roomcat",
  HOTEL_ACCOMMODATION: "svc_hotel_accommodation",
  HOTEL_FOOD: "svc_hotel_food",
  HOTEL_HALAL: "svc_hotel_halal",
  HOTEL_TRANSFER: "svc_hotel_transfer",
  HOTEL_CHANGEABLE: "svc_hotel_changeable",
  HOTEL_PAX: "svc_hotel_pax",
  HOTEL_INSURANCE: "svc_hotel_insurance",
  HOTEL_EARLY_CHECKIN: "svc_hotel_early_checkin",
  HOTEL_FAST_TRACK: "svc_hotel_fast_track",
  TICKET_EVENT_DATE: "svc_ticket_event_date",
  PRICE: "svc_create_price",
  GROSS_PRICE: "svc_create_grossPrice",
  URGENCY: "svc_create_urgency",
  EXPIRATION: "svc_create_expiration",
  PHOTO: "svc_create_photo",
});

const COMMON_COMMERCIAL_STEPS = [
  STEP.PRICE,
  STEP.GROSS_PRICE,
  STEP.URGENCY,
  STEP.EXPIRATION,
  STEP.PHOTO,
];

const WIZARD_STEPS_BY_CATEGORY = Object.freeze({
  refused_tour: [
    STEP.TITLE,
    STEP.COUNTRY,
    STEP.FROM,
    STEP.TO,
    STEP.TOUR_START,
    STEP.TOUR_END,
    STEP.FLIGHT_DEPARTURE,
    STEP.FLIGHT_RETURN,
    STEP.FLIGHT_AIRLINE,
    STEP.FLIGHT_DETAILS,
    STEP.TOUR_HOTEL,
    STEP.TOUR_ACCOMMODATION,
    STEP.TOUR_ROOM,
    STEP.TOUR_FOOD,
    STEP.TOUR_TRANSFER,
    STEP.TOUR_INSURANCE,
    STEP.TOUR_VISA,
    STEP.TOUR_EARLY_CHECKIN,
    STEP.TOUR_FAST_TRACK,
    ...COMMON_COMMERCIAL_STEPS,
  ],
  refused_hotel: [
    STEP.HOTEL_COUNTRY,
    STEP.HOTEL_CITY,
    STEP.HOTEL_NAME,
    STEP.HOTEL_CHECKIN,
    STEP.HOTEL_CHECKOUT,
    STEP.HOTEL_ROOM,
    STEP.HOTEL_ACCOMMODATION,
    STEP.HOTEL_FOOD,
    STEP.HOTEL_HALAL,
    STEP.HOTEL_TRANSFER,
    STEP.HOTEL_CHANGEABLE,
    STEP.HOTEL_PAX,
    STEP.HOTEL_INSURANCE,
    STEP.HOTEL_EARLY_CHECKIN,
    STEP.HOTEL_FAST_TRACK,
    ...COMMON_COMMERCIAL_STEPS,
  ],
  refused_flight: [
    STEP.TITLE,
    STEP.FROM,
    STEP.TO,
    STEP.FLIGHT_TYPE,
    STEP.FLIGHT_DEPARTURE,
    STEP.FLIGHT_RETURN,
    STEP.FLIGHT_AIRLINE,
    STEP.FLIGHT_DETAILS,
    ...COMMON_COMMERCIAL_STEPS,
  ],
  refused_ticket: [
    STEP.TITLE,
    STEP.COUNTRY,
    STEP.TO,
    STEP.TICKET_EVENT_DATE,
    ...COMMON_COMMERCIAL_STEPS,
  ],
  refused_event_ticket: [
    STEP.TITLE,
    STEP.COUNTRY,
    STEP.TO,
    STEP.TICKET_EVENT_DATE,
    ...COMMON_COMMERCIAL_STEPS,
  ],
  // Author tour is not part of this refusal unification task, but keeping it here
  // prevents old hard-coded arrays from staying in bot.js.
  author_tour: [
    "svc_author_title",
    "svc_author_country",
    "svc_author_from",
    "svc_author_to",
    "svc_author_start",
    "svc_author_end",
    "svc_author_format",
    "svc_author_stays",
    "svc_author_program_days",
    "svc_author_included",
    "svc_author_not_included",
    "svc_author_pax",
    "svc_author_language",
    "svc_author_meeting",
    "svc_author_cancel",
    ...COMMON_COMMERCIAL_STEPS,
  ],
});



const STEP_CATEGORY_HINTS = Object.freeze({
  svc_hotel_: "refused_hotel",
  svc_author_: "author_tour",
  author_: "author_tour",
  svc_ticket_: "refused_event_ticket",
});

const OPTIONAL_STEPS = new Set([
  "svc_author_title",
  "svc_author_not_included",
  "svc_author_cancel",
  "author_day_date",
  "author_day_route",
  "author_day_title",
  STEP.FLIGHT_TYPE,
  STEP.FLIGHT_RETURN,
  STEP.FLIGHT_DETAILS,
  STEP.TOUR_ROOM,
  STEP.TOUR_FOOD,
  STEP.TOUR_TRANSFER,
  STEP.GROSS_PRICE,
  STEP.URGENCY,
  STEP.EXPIRATION,
  STEP.PHOTO,
]);

const EDIT_WIZARD_STEPS_BY_CATEGORY = Object.freeze({
  refused_tour: [
    "svc_edit_title", "svc_edit_tour_country", "svc_edit_tour_from", "svc_edit_tour_to",
    "svc_edit_tour_start", "svc_edit_tour_end", "svc_edit_flight_departure",
    "svc_edit_flight_return", "svc_edit_flight_airline", "svc_edit_flight_details",
    "svc_edit_tour_hotel", "svc_edit_tour_accommodation", "svc_edit_tour_roomcat",
    "svc_edit_tour_food", "svc_edit_tour_transfer", "svc_edit_tour_insurance", "svc_edit_tour_visa", "svc_edit_tour_early_checkin",
    "svc_edit_tour_fast_track", "svc_edit_price", "svc_edit_grossPrice",
    "svc_edit_expiration", "svc_edit_isActive", "svc_edit_images",
  ],
  refused_hotel: [
    "svc_edit_title", "svc_edit_hotel_country", "svc_edit_hotel_city", "svc_edit_hotel_name",
    "svc_edit_hotel_checkin", "svc_edit_hotel_checkout", "svc_edit_hotel_roomcat",
    "svc_edit_hotel_accommodation", "svc_edit_hotel_food", "svc_edit_hotel_halal",
    "svc_edit_hotel_transfer", "svc_edit_hotel_changeable", "svc_edit_hotel_pax",
    "svc_edit_hotel_insurance", "svc_edit_hotel_early_checkin", "svc_edit_hotel_fast_track",
    "svc_edit_price", "svc_edit_grossPrice", "svc_edit_expiration", "svc_edit_isActive", "svc_edit_images",
  ],
  refused_flight: [
    "svc_edit_title", "svc_edit_flight_from", "svc_edit_flight_to", "svc_edit_flight_type",
    "svc_edit_flight_departure", "svc_edit_flight_return", "svc_edit_flight_airline",
    "svc_edit_flight_details", "svc_edit_price", "svc_edit_grossPrice",
    "svc_edit_expiration", "svc_edit_isActive", "svc_edit_images",
  ],
  refused_ticket: [
    "svc_edit_title", "svc_edit_ticket_country", "svc_edit_ticket_city", "svc_edit_ticket_date",
    "svc_edit_price", "svc_edit_grossPrice", "svc_edit_expiration", "svc_edit_isActive", "svc_edit_images",
  ],
  refused_event_ticket: [
    "svc_edit_title", "svc_edit_ticket_country", "svc_edit_ticket_city", "svc_edit_ticket_date",
    "svc_edit_price", "svc_edit_grossPrice", "svc_edit_expiration", "svc_edit_isActive", "svc_edit_images",
  ],
});

function getEditWizardSteps(category = "", step = "") {
  const c = getWizardCategory(category, step);
  return [...(EDIT_WIZARD_STEPS_BY_CATEGORY[c] || EDIT_WIZARD_STEPS_BY_CATEGORY.refused_tour)];
}

function getNextEditWizardStep(category = "", currentStep = "", draft = {}) {
  const steps = getEditWizardSteps(category, currentStep);
  const idx = steps.indexOf(String(currentStep || ""));
  if (idx < 0) return null;
  const rawType = String(draft?.flightType || draft?.flight_type || "").toLowerCase();
  const oneWay = rawType === "one_way" || draft?.oneWay === true || draft?.one_way === true;
  for (let i = idx + 1; i < steps.length; i += 1) {
    if (steps[i] === "svc_edit_flight_return" && oneWay) continue;
    return steps[i];
  }
  return null;
}

function inferCategoryFromStep(step = "") {
  const st = String(step || "");
  for (const [prefix, category] of Object.entries(STEP_CATEGORY_HINTS)) {
    if (st.startsWith(prefix)) return category;
  }
  if (st.startsWith("svc_create_flight_")) return "refused_flight";
  return "";
}

function getWizardCategory(category = "", step = "") {
  const normalized = normalizeCategory(category || "");
  if (normalized && WIZARD_STEPS_BY_CATEGORY[normalized]) return normalized;
  return inferCategoryFromStep(step) || "refused_tour";
}

function getServiceWizardSteps(category = "", step = "") {
  const c = getWizardCategory(category, step);
  return [...(WIZARD_STEPS_BY_CATEGORY[c] || WIZARD_STEPS_BY_CATEGORY.refused_tour)];
}

function getWizardStepIndex(category = "", step = "") {
  return getServiceWizardSteps(category, step).indexOf(String(step || ""));
}

function getNextWizardStep(category = "", currentStep = "", draft = {}) {
  const steps = getServiceWizardSteps(category, currentStep);
  const idx = steps.indexOf(String(currentStep || ""));
  if (idx < 0) return null;

  // One-way refused flight must not require a return-date step.
  const rawType = String(draft?.flightType || draft?.flight_type || "").toLowerCase();
  const oneWay = rawType === "one_way" || draft?.oneWay === true || draft?.one_way === true;
  for (let i = idx + 1; i < steps.length; i += 1) {
    if (steps[i] === STEP.FLIGHT_RETURN && oneWay) continue;
    return steps[i];
  }
  return null;
}

function getPreviousWizardStep(category = "", currentStep = "", draft = {}) {
  const steps = getServiceWizardSteps(category, currentStep);
  const idx = steps.indexOf(String(currentStep || ""));
  if (idx <= 0) return null;
  const rawType = String(draft?.flightType || draft?.flight_type || "").toLowerCase();
  const oneWay = rawType === "one_way" || draft?.oneWay === true || draft?.one_way === true;
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (steps[i] === STEP.FLIGHT_RETURN && oneWay) continue;
    return steps[i];
  }
  return null;
}

function isOptionalWizardStep(step = "") {
  return OPTIONAL_STEPS.has(String(step || ""));
}

function isWizardStep(step = "") {
  const st = String(step || "");
  if (!st) return false;
  return Object.values(WIZARD_STEPS_BY_CATEGORY).some((steps) => steps.includes(st)) ||
    st.startsWith("author_day_") ||
    st.startsWith("author_stay_") ||
    st.startsWith("author_included_") ||
    st.startsWith("author_excluded_") ||
    st.startsWith("author_language_");
}

module.exports = {
  STEP,
  WIZARD_STEPS_BY_CATEGORY,
  getWizardCategory,
  getServiceWizardSteps,
  getEditWizardSteps,
  getNextEditWizardStep,
  getWizardStepIndex,
  getNextWizardStep,
  getPreviousWizardStep,
  isOptionalWizardStep,
  isWizardStep,
};
