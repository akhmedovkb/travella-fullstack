// backend/utils/serviceFieldMatrix.js
// Field Matrix is now generated from serviceCategoryContract.
// Do not add category-specific field order here. Add/modify fields only in
// serviceCategoryContract.js so creation/edit/progress/quality/submit stay synced.

const { normalizeCategory, isProofRequiredCategory } = require("./serviceCategories");
const { hasServiceDisplayTitle } = require("./serviceDisplay");
const {
  getEffectiveCategoryFromInput,
  getServiceCategoryContract,
  shouldSkipField,
} = require("./serviceCategoryContract");

function normalizeDetails(details) {
  if (!details) return {};
  if (typeof details === "object" && !Array.isArray(details)) return details;
  if (typeof details === "string") {
    try {
      const parsed = JSON.parse(details);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function hasFilled(...values) {
  return values.some((v) => {
    if (v == null) return false;
    if (typeof v === "number") return Number.isFinite(v) && v > 0;
    if (typeof v === "boolean") return true;
    if (Array.isArray(v)) return v.filter(Boolean).length > 0;
    return String(v).trim() !== "";
  });
}

function parseMoney(value) {
  if (value == null || value === "") return null;
  const raw = String(value).replace(/\s+/g, "").replace(",", ".").replace(/[^0-9.\-]/g, "");
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function first(...values) {
  for (const v of values) {
    if (hasFilled(v)) return typeof v === "string" ? v.trim() : v;
  }
  return "";
}

function getProofImages(details) {
  const d = normalizeDetails(details);
  const proof = Array.isArray(d.proofImages) ? d.proofImages : Array.isArray(d.proof_images) ? d.proof_images : [];
  return proof.filter(Boolean);
}

function getImages(images) {
  if (Array.isArray(images)) return images.filter(Boolean);
  if (typeof images === "string") {
    try {
      const parsed = JSON.parse(images);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return images.trim() ? [images.trim()] : [];
    }
  }
  return [];
}

function isRoundTripFlight(details = {}) {
  const type = String(details.flightType || details.flight_type || "").trim().toLowerCase();
  return type === "round_trip" || details.oneWay === false || details.one_way === false;
}

function priceNetOk(service, d) {
  const net = parseMoney(first(d.netPrice, d.price, service.price));
  return Number.isFinite(net) && net > 0;
}

function priceGrossOk(service, d) {
  const gross = parseMoney(first(d.grossPrice, d.clientPrice, d.price, service.price));
  return Number.isFinite(gross) && gross > 0;
}

function grossNotBelowNet(service, d) {
  const net = parseMoney(first(d.netPrice, d.price, service.price));
  const gross = parseMoney(first(d.grossPrice, d.clientPrice, d.price, service.price));
  return !Number.isFinite(net) || !Number.isFinite(gross) || gross >= net;
}

function getEffectiveCategory(service = {}, details = {}) {
  return getEffectiveCategoryFromInput(service.category || service.service_category || "", details);
}

function proofOk(service, d) {
  const category = getEffectiveCategory(service, d);
  return !isProofRequiredCategory(category) || getProofImages(d).length > 0 || getImages(service.images).length > 0;
}

function field(key, label, ok, opts = {}) {
  return {
    key,
    code: opts.code || `${String(key || "FIELD").toUpperCase()}_REQUIRED`,
    label,
    ok: Boolean(ok),
    required: opts.required !== false,
    recommended: opts.recommended === true,
    weight: Number(opts.weight || (opts.required === false ? 1 : 2)),
    createStep: opts.createStep || null,
    editStep: opts.editStep || null,
  };
}

function okByContractKey(key, service, d) {
  switch (key) {
    case "title": return hasServiceDisplayTitle(service);
    case "country": return hasFilled(d.directionCountry, d.country, d.locationCountry);
    case "from": return hasFilled(d.directionFrom, d.fromCity, d.cityFrom, d.departureCity);
    case "to": return hasFilled(d.directionTo, d.toCity, d.city, d.cityTo, d.arrivalCity, d.location);
    case "eventCity": return hasFilled(d.directionTo, d.toCity, d.city, d.location, d.venue, d.eventPlace);
    case "startDate": return hasFilled(d.startDate, d.start_date, d.startFlightDate, d.departureFlightDate, d.dateFrom);
    case "endDate": return hasFilled(d.endDate, d.end_date, d.returnFlightDate, d.returnDate, d.endFlightDate, d.dateTo);
    case "departureDate": return hasFilled(d.startDate, d.startFlightDate, d.departureFlightDate, d.departureDate, d.flightDate);
    case "returnDate": return hasFilled(d.returnFlightDate, d.returnDate, d.endFlightDate, d.endDate);
    case "flightType": return hasFilled(d.flightType, d.flight_type, d.oneWay, d.one_way);
    case "airline": return hasFilled(d.airline, d.airCompany, d.carrier);
    case "flightDetails": return hasFilled(d.flightDetails, d.flightNumber, d.departureTime, d.arrivalTime);
    case "hotel": return hasFilled(d.hotel, d.hotelName);
    case "city": return hasFilled(d.directionTo, d.toCity, d.city, d.locationCity);
    case "checkin": return hasFilled(d.startDate, d.checkinDate, d.checkInDate, d.check_in, d.check_in_date);
    case "checkout": return hasFilled(d.endDate, d.checkoutDate, d.checkOutDate, d.check_out, d.check_out_date);
    case "room": return hasFilled(d.accommodationCategory, d.roomCategory, d.room, d.roomType);
    case "accommodation": return hasFilled(d.accommodation, d.accommodationCategory, d.roomCategory);
    case "meal": return hasFilled(d.meal, d.mealType, d.food);
    case "transfer": return hasFilled(d.transfer, d.transferType, d.transferIncluded, d.hasTransfer);
    case "insurance": return hasFilled(d.insurance, d.insuranceIncluded);
    case "visa": return hasFilled(d.visa, d.visaIncluded);
    case "earlyCheckIn": return hasFilled(d.earlyCheckIn, d.earlyCheckInIncluded);
    case "arrivalFastTrack": return hasFilled(d.arrivalFastTrack, d.fastTrack, d.fastTrackIncluded);
    case "halal": return hasFilled(d.halal);
    case "changeable": return hasFilled(d.changeable);
    case "pax": return hasFilled(d.adt, d.chd, d.inf, d.pax, d.persons, d.guests);
    case "eventDate": return hasFilled(d.startDate, d.eventDate, d.date);
    case "ticketDetails": return hasFilled(d.ticketDetails, d.eventCategory, d.sector, d.row, d.seat, d.ticketType, d.description, service.description);
    case "quantity": return hasFilled(d.quantity, d.seats, d.ticketCount, d.ticketsCount);
    case "format": return hasFilled(d.tourFormat, d.format);
    case "stays": return hasFilled(d.stays, d.staysText, d.accommodationPlan);
    case "program": return hasFilled(d.program, d.programDaysText) || (Array.isArray(d.programDays) && d.programDays.length > 0);
    case "included": return hasFilled(d.included, d.includedText);
    case "notIncluded": return hasFilled(d.notIncluded, d.notIncludedText, d.excluded);
    case "language": return hasFilled(d.language, d.languages, d.guideLanguage);
    case "meeting": return hasFilled(d.meetingPoint, d.startPoint, d.pickupPoint);
    case "cancel": return hasFilled(d.cancelPolicy, d.cancellationPolicy);
    case "netPrice": return priceNetOk(service, d);
    case "grossPrice": return priceGrossOk(service, d);
    case "grossPriceNotBelowNet": return grossNotBelowNet(service, d);
    case "urgency": return hasFilled(d.urgency);
    case "expiration": return hasFilled(d.expiration, d.expiration_at, service.expiration_at);
    case "photo": return getImages(service.images).length > 0 || hasFilled(d.telegramPhotoFileId);
    case "proof": return proofOk(service, d);
    default: return false;
  }
}

function getServiceFieldChecks(service = {}) {
  const d = normalizeDetails(service.details);
  const category = getEffectiveCategory(service, d);
  const contract = getServiceCategoryContract(category, d);

  return contract
    .filter((item) => !shouldSkipField(item, d))
    .filter((item) => item.key !== "proof" || isProofRequiredCategory(category))
    .map((item) => field(
      item.key,
      item.label,
      okByContractKey(item.key, service, d),
      {
        code: item.code,
        required: item.required,
        recommended: item.recommended,
        weight: item.weight,
        createStep: item.createStep,
        editStep: item.editStep,
      }
    ));
}

function getRequiredFieldChecks(service = {}) {
  return getServiceFieldChecks(service).filter((x) => x.required !== false);
}

function getRecommendedFieldChecks(service = {}) {
  return getServiceFieldChecks(service).filter((x) => x.required === false || x.recommended);
}

function getSubmitBlockers(service = {}) {
  return getRequiredFieldChecks(service)
    .filter((x) => !x.ok)
    .map((x) => ({ code: x.code, label: x.label, key: x.key }));
}

function getDraftProgress(service = {}) {
  // grossPriceNotBelowNet is a validation guard, not a user wizard step.
  const checks = getServiceFieldChecks(service).filter((x) => x.key !== "grossPriceNotBelowNet");
  const total = checks.length || 1;
  const filled = checks.filter((x) => x.ok).length;
  return { filled, total, checks };
}

module.exports = {
  normalizeDetails,
  hasFilled,
  parseMoney,
  first,
  getProofImages,
  getImages,
  isRoundTripFlight,
  getEffectiveCategory,
  getServiceFieldChecks,
  getRequiredFieldChecks,
  getRecommendedFieldChecks,
  getSubmitBlockers,
  getDraftProgress,
};
