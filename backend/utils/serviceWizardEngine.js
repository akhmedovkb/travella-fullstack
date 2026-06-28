// backend/utils/serviceWizardEngine.js
// Travella Wizard Engine v2.
// Thin runtime wrapper over serviceCategoryContract: no category-specific order
// should be kept here. Creation, editing and progress share the same contract.

const { normalizeCategory } = require("./serviceCategories");
const {
  STEP,
  CONTRACTS,
  getCreateWizardSteps,
  getEditWizardStepsFromContract,
  getEffectiveCategoryFromInput,
  getServiceCategoryContract,
  shouldSkipField,
} = require("./serviceCategoryContract");

const STEP_CATEGORY_HINTS = Object.freeze({
  svc_hotel_: "refused_hotel",
  svc_author_: "author_tour",
  author_: "author_tour",
  svc_ticket_: "refused_event_ticket",
});

function inferCategoryFromStep(step = "") {
  const st = String(step || "");
  for (const [prefix, category] of Object.entries(STEP_CATEGORY_HINTS)) {
    if (st.startsWith(prefix)) return category;
  }
  if (st.startsWith("svc_create_flight_") || st.startsWith("svc_edit_flight_")) return "refused_flight";
  if (st.startsWith("svc_edit_hotel_")) return "refused_hotel";
  if (st.startsWith("svc_edit_ticket_")) return "refused_event_ticket";
  if (st.startsWith("svc_edit_tour_")) return "refused_tour";
  return "";
}

function getWizardCategory(category = "", step = "") {
  const normalized = normalizeCategory(category || "");
  if (normalized && CONTRACTS[normalized]) return normalized;
  return inferCategoryFromStep(step) || "refused_tour";
}

function getServiceWizardSteps(category = "", step = "", draft = {}) {
  const c = getWizardCategory(category, step);
  return getCreateWizardSteps(c, draft);
}

function getEditWizardSteps(category = "", step = "", draft = {}) {
  const c = getWizardCategory(category, step);
  return getEditWizardStepsFromContract(c, draft);
}

const WIZARD_STEPS_BY_CATEGORY = Object.freeze(
  Object.fromEntries(Object.keys(CONTRACTS).map((cat) => [cat, getCreateWizardSteps(cat)]))
);
const EDIT_WIZARD_STEPS_BY_CATEGORY = Object.freeze(
  Object.fromEntries(Object.keys(CONTRACTS).map((cat) => [cat, getEditWizardStepsFromContract(cat)]))
);

function getWizardStepIndex(category = "", step = "", draft = {}) {
  return getServiceWizardSteps(category, step, draft).indexOf(String(step || ""));
}

function getNextWizardStep(category = "", currentStep = "", draft = {}) {
  const steps = getServiceWizardSteps(category, currentStep, draft);
  const idx = steps.indexOf(String(currentStep || ""));
  if (idx < 0) return null;
  return steps[idx + 1] || null;
}

function getPreviousWizardStep(category = "", currentStep = "", draft = {}) {
  const steps = getServiceWizardSteps(category, currentStep, draft);
  const idx = steps.indexOf(String(currentStep || ""));
  if (idx <= 0) return null;
  return steps[idx - 1] || null;
}

function getNextEditWizardStep(category = "", currentStep = "", draft = {}) {
  const steps = getEditWizardSteps(category, currentStep, draft);
  const idx = steps.indexOf(String(currentStep || ""));
  if (idx < 0) return null;
  return steps[idx + 1] || null;
}

function isOptionalWizardStep(step = "") {
  const st = String(step || "");
  if (!st) return false;
  for (const category of Object.keys(CONTRACTS)) {
    const field = getServiceCategoryContract(category).find((x) => x.createStep === st || x.editStep === st);
    if (field) return field.required === false;
  }
  return st.startsWith("author_day_") || st.startsWith("author_stay_") || st.startsWith("author_language_");
}

function isWizardStep(step = "") {
  const st = String(step || "");
  if (!st) return false;
  return Object.values(WIZARD_STEPS_BY_CATEGORY).some((steps) => steps.includes(st)) ||
    Object.values(EDIT_WIZARD_STEPS_BY_CATEGORY).some((steps) => steps.includes(st)) ||
    st.startsWith("author_day_") ||
    st.startsWith("author_stay_") ||
    st.startsWith("author_included_") ||
    st.startsWith("author_excluded_") ||
    st.startsWith("author_language_");
}

module.exports = {
  STEP,
  WIZARD_STEPS_BY_CATEGORY,
  EDIT_WIZARD_STEPS_BY_CATEGORY,
  getWizardCategory,
  getServiceWizardSteps,
  getEditWizardSteps,
  getNextEditWizardStep,
  getWizardStepIndex,
  getNextWizardStep,
  getPreviousWizardStep,
  isOptionalWizardStep,
  isWizardStep,
  // exported for tests and future web wizard integration
  getEffectiveCategoryFromInput,
  shouldSkipField,
};
