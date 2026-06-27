// backend/utils/serviceSubmitValidation.js

const {
  normalizeDetails,
  getProofImages,
  getImages,
  getSubmitBlockers,
} = require("./serviceFieldMatrix");

function buildSubmitValidationBlockers(service = {}) {
  return getSubmitBlockers(service);
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
  normalizeDetails,
};
