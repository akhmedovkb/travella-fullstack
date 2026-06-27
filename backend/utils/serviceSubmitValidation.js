// backend/utils/serviceSubmitValidation.js

const { normalizeCategory, isProofRequiredCategory } = require("./serviceCategories");
const {
  getSubmitChecks,
  getProofImages,
  getImages,
} = require("./serviceFieldMatrix");
const { normalizeDetails } = require("./serviceDisplay");

function buildSubmitValidationBlockers(service = {}) {
  const category = normalizeCategory(service.category);
  const d = normalizeDetails(service.details);
  const blockers = [];

  for (const check of getSubmitChecks(service)) {
    if (!check.ok) {
      blockers.push({
        code: check.code || String(check.key || "FIELD_REQUIRED").toUpperCase(),
        label: check.label || "Заполните поле",
      });
    }
  }

  if (isProofRequiredCategory(category) && getProofImages(d).length <= 0) {
    blockers.push({
      code: "PROOF_IMAGES_REQUIRED",
      label: "Добавьте proof: скрин/ваучер/билет/подтверждение",
    });
  }

  return blockers;
}

function assertServiceSubmittable(service) {
  const blockers = buildSubmitValidationBlockers(service);
  if (blockers.length) {
    const err = new Error("SERVICE_SUBMIT_BLOCKED");
    err.code = blockers.some((b) => b.code === "PROOF_IMAGES_REQUIRED") && blockers.length === 1
      ? "PROOF_IMAGES_REQUIRED"
      : "SERVICE_SUBMIT_BLOCKED";
    err.status = 400;
    err.blockers = blockers.map((b) => b.code);
    err.blockerDetails = blockers;
    throw err;
  }
}

module.exports = {
  buildSubmitValidationBlockers,
  assertServiceSubmittable,
  getProofImages,
  getImages,
};
