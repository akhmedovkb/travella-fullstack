// backend/utils/serviceFieldMatrix.js
// Single category-aware field matrix for refused services.
// Used by draft progress, quality score and submit validation so the same fields
// are evaluated consistently across creation/edit/moderation/card flows.

const { normalizeCategory, isProofRequiredCategory } = require("./serviceCategories");
const { hasServiceDisplayTitle } = require("./serviceDisplay");

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
  return normalizeCategory(service.category || details.category || service.service_category || "");
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
  };
}

function commonCommercialFields(service, d) {
  const out = [
    field("title", "Название", hasServiceDisplayTitle(service), { code: "TITLE_REQUIRED", weight: 2 }),
    field("netPrice", "Цена нетто", priceNetOk(service, d), { code: "NET_PRICE_REQUIRED", weight: 3 }),
    field("grossPrice", "Цена для клиента", priceGrossOk(service, d), { code: "GROSS_PRICE_REQUIRED", weight: 3 }),
    field("grossPriceNotBelowNet", "Цена для клиента не ниже нетто", grossNotBelowNet(service, d), { code: "GROSS_PRICE_TOO_LOW", weight: 1 }),
  ];
  if (isProofRequiredCategory(getEffectiveCategory(service, d))) {
    out.push(field("proof", "Proof / подтверждение", proofOk(service, d), { code: "PROOF_IMAGES_REQUIRED", weight: 3 }));
  }
  return out;
}

function getServiceFieldChecks(service = {}) {
  const d = normalizeDetails(service.details);
  const category = getEffectiveCategory(service, d);
  const checks = [];
  const add = (...args) => checks.push(field(...args));

  if (category === "refused_tour") {
    add("country", "Страна направления", hasFilled(d.directionCountry, d.country), { code: "COUNTRY_REQUIRED", weight: 2 });
    add("from", "Город вылета", hasFilled(d.directionFrom, d.fromCity), { code: "FROM_REQUIRED", weight: 2 });
    add("to", "Город прибытия / курорт", hasFilled(d.directionTo, d.toCity, d.city), { code: "TO_REQUIRED", weight: 2 });
    add("startDate", "Дата начала тура", hasFilled(d.startDate, d.start_date), { code: "START_DATE_REQUIRED", weight: 2 });
    add("endDate", "Дата окончания тура", hasFilled(d.endDate, d.end_date), { code: "END_DATE_REQUIRED", weight: 2 });
    add("hotel", "Отель", hasFilled(d.hotel, d.hotelName), { code: "HOTEL_REQUIRED", weight: 3 });
    add("accommodation", "Размещение / категория номера", hasFilled(d.accommodation, d.accommodationCategory, d.roomCategory), { code: "ACCOMMODATION_REQUIRED", weight: 2 });
    checks.push(field("meal", "Питание", hasFilled(d.meal, d.mealType, d.food), { required: false, recommended: true, weight: 1 }));
    checks.push(field("transfer", "Трансфер", hasFilled(d.transfer, d.transferType, d.transferIncluded), { required: false, recommended: true, weight: 1 }));
    checks.push(field("insurance", "Страховка", hasFilled(d.insurance, d.insuranceIncluded), { required: false, recommended: true, weight: 1 }));
    checks.push(field("visa", "Виза", hasFilled(d.visa, d.visaIncluded), { required: false, recommended: true, weight: 1 }));
    checks.push(field("earlyCheckIn", "Раннее заселение", hasFilled(d.earlyCheckIn, d.earlyCheckInIncluded), { required: false, recommended: true, weight: 1 }));
    checks.push(field("arrivalFastTrack", "Fast Track", hasFilled(d.arrivalFastTrack, d.fastTrack, d.fastTrackIncluded), { required: false, recommended: true, weight: 1 }));
  } else if (category === "refused_hotel") {
    add("country", "Страна", hasFilled(d.directionCountry, d.country), { code: "COUNTRY_REQUIRED", weight: 2 });
    add("city", "Город / курорт", hasFilled(d.directionTo, d.toCity, d.city), { code: "CITY_REQUIRED", weight: 2 });
    add("hotel", "Отель", hasFilled(d.hotel, d.hotelName), { code: "HOTEL_REQUIRED", weight: 3 });
    add("checkin", "Дата заезда", hasFilled(d.startDate, d.checkinDate, d.checkInDate), { code: "CHECKIN_REQUIRED", weight: 2 });
    add("checkout", "Дата выезда", hasFilled(d.endDate, d.checkoutDate, d.checkOutDate), { code: "CHECKOUT_REQUIRED", weight: 2 });
    add("room", "Номер / размещение", hasFilled(d.accommodationCategory, d.accommodation, d.roomCategory), { code: "ROOM_REQUIRED", weight: 2 });
    checks.push(field("meal", "Питание", hasFilled(d.meal, d.mealType, d.food), { required: false, recommended: true, weight: 1 }));
    checks.push(field("transfer", "Трансфер", hasFilled(d.transfer, d.transferType, d.transferIncluded), { required: false, recommended: true, weight: 1 }));
    checks.push(field("insurance", "Страховка", hasFilled(d.insurance, d.insuranceIncluded), { required: false, recommended: true, weight: 1 }));
  } else if (category === "refused_flight") {
    add("from", "Город вылета", hasFilled(d.directionFrom, d.fromCity), { code: "FROM_REQUIRED", weight: 2 });
    add("to", "Город прибытия", hasFilled(d.directionTo, d.toCity), { code: "TO_REQUIRED", weight: 2 });
    add("departureDate", "Дата вылета", hasFilled(d.startDate, d.startFlightDate, d.departureFlightDate, d.flightDate), { code: "DEPARTURE_DATE_REQUIRED", weight: 3 });
    if (isRoundTripFlight(d)) {
      add("returnDate", "Дата обратного рейса", hasFilled(d.returnFlightDate, d.returnDate, d.endFlightDate, d.endDate), { code: "RETURN_DATE_REQUIRED", weight: 2 });
    } else {
      checks.push(field("flightType", "Тип перелёта", true, { required: false, recommended: true, weight: 1 }));
    }
    add("airline", "Авиакомпания", hasFilled(d.airline, d.airCompany, d.carrier), { code: "AIRLINE_REQUIRED", weight: 2 });
    add("flightDetails", "Номер/время рейса", hasFilled(d.flightDetails, d.flightNumber, d.departureTime, d.arrivalTime), { code: "FLIGHT_DETAILS_REQUIRED", weight: 2 });
    checks.push(field("baggage", "Багаж", hasFilled(d.baggage, d.handLuggage, d.cabinBaggage, d.checkedBaggage), { required: false, recommended: true, weight: 1 }));
    checks.push(field("seats", "Количество мест", hasFilled(d.seats, d.quantity, d.pax), { required: false, recommended: true, weight: 1 }));
  } else if (category === "refused_ticket" || category === "refused_event_ticket") {
    add("eventName", "Название мероприятия", hasFilled(d.eventName, d.eventTitle, d.ticketTitle, service.title), { code: "EVENT_NAME_REQUIRED", weight: 3 });
    add("eventCity", "Город / площадка", hasFilled(d.directionTo, d.toCity, d.city, d.location, d.venue), { code: "EVENT_CITY_REQUIRED", weight: 2 });
    add("eventDate", "Дата мероприятия", hasFilled(d.startDate, d.eventDate, d.date), { code: "EVENT_DATE_REQUIRED", weight: 3 });
    checks.push(field("ticketDetails", "Сектор/ряд/место или тип билета", hasFilled(d.ticketDetails, d.eventCategory, d.sector, d.row, d.seat, d.ticketType, d.description, service.description), { required: false, recommended: true, code: "TICKET_DETAILS_RECOMMENDED", weight: 1 }));
    checks.push(field("quantity", "Количество билетов", hasFilled(d.quantity, d.seats, d.ticketCount), { required: false, recommended: true, weight: 1 }));
  } else if (category === "author_tour") {
    add("country", "Страна / направление", hasFilled(d.directionCountry, d.country), { code: "COUNTRY_REQUIRED", weight: 2 });
    add("route", "Маршрут авторского тура", hasFilled(d.directionFrom, d.fromCity) && hasFilled(d.directionTo, d.toCity), { code: "ROUTE_REQUIRED", weight: 3 });
    add("dates", "Даты или даты по запросу", d.flexibleDates || (hasFilled(d.startDate) && hasFilled(d.endDate)), { code: "DATES_REQUIRED", weight: 2 });
    add("program", "Программа авторского тура", hasFilled(d.program, d.programDaysText) || (Array.isArray(d.programDays) && d.programDays.length > 0), { code: "PROGRAM_REQUIRED", weight: 3 });
    add("included", "Что включено", hasFilled(d.included), { code: "INCLUDED_REQUIRED", weight: 2 });
    checks.push(field("language", "Язык тура", hasFilled(d.language, d.languages), { required: false, recommended: true, weight: 1 }));
    checks.push(field("groupSize", "Размер группы", hasFilled(d.minPax, d.maxPax), { required: false, recommended: true, weight: 1 }));
  } else {
    add("route", "Маршрут/направление", hasFilled(d.directionFrom, d.fromCity) && hasFilled(d.directionTo, d.toCity, d.city), { code: "ROUTE_REQUIRED", weight: 2 });
    add("dates", "Даты", hasFilled(d.startDate, d.start_date), { code: "DATES_REQUIRED", weight: 2 });
    add("details", "Основные детали", hasFilled(d.hotel, d.hotelName, d.accommodation, d.program, d.description, service.description), { code: "DETAILS_REQUIRED", weight: 2 });
  }

  return [...checks, ...commonCommercialFields(service, d)];
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
