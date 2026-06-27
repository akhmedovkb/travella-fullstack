// backend/utils/serviceSubmitValidation.js

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

function first(...values) {
  for (const v of values) {
    if (hasFilled(v)) return typeof v === "string" ? v.trim() : v;
  }
  return "";
}

function isRoundTripFlight(details) {
  const type = String(details.flightType || details.flight_type || "").trim().toLowerCase();
  return type === "round_trip" || details.oneWay === false || details.one_way === false;
}

function buildSubmitValidationBlockers(service = {}) {
  const category = normalizeCategory(service.category);
  const d = normalizeDetails(service.details);
  const blockers = [];
  const add = (code, label, ok) => {
    if (!ok) blockers.push({ code, label });
  };

  add("TITLE_REQUIRED", "Укажите название услуги", hasServiceDisplayTitle(service));

  if (category === "refused_tour") {
    add("COUNTRY_REQUIRED", "Укажите страну направления", hasFilled(d.directionCountry, d.country));
    add("FROM_REQUIRED", "Укажите город вылета", hasFilled(d.directionFrom, d.fromCity));
    add("TO_REQUIRED", "Укажите город прибытия", hasFilled(d.directionTo, d.toCity, d.city));
    add("START_DATE_REQUIRED", "Укажите дату начала тура", hasFilled(d.startDate, d.start_date));
    add("END_DATE_REQUIRED", "Укажите дату окончания тура", hasFilled(d.endDate, d.end_date));
    add("HOTEL_REQUIRED", "Укажите отель", hasFilled(d.hotel, d.hotelName));
    add("ACCOMMODATION_REQUIRED", "Укажите размещение / категорию номера", hasFilled(d.accommodation, d.accommodationCategory, d.roomCategory));
  }

  if (category === "author_tour") {
    add("COUNTRY_REQUIRED", "Укажите страну / направление", hasFilled(d.directionCountry, d.country));
    add("ROUTE_REQUIRED", "Укажите маршрут авторского тура", hasFilled(d.directionFrom, d.fromCity) && hasFilled(d.directionTo, d.toCity));
    add("DATES_REQUIRED", "Укажите даты или включите даты по запросу", d.flexibleDates || (hasFilled(d.startDate) && hasFilled(d.endDate)));
    add("PROGRAM_REQUIRED", "Добавьте программу авторского тура", hasFilled(d.program, d.programDaysText) || (Array.isArray(d.programDays) && d.programDays.length > 0));
    add("INCLUDED_REQUIRED", "Укажите, что включено", hasFilled(d.included));
  }

  if (category === "refused_hotel") {
    add("COUNTRY_REQUIRED", "Укажите страну", hasFilled(d.directionCountry, d.country));
    add("CITY_REQUIRED", "Укажите город / курорт", hasFilled(d.directionTo, d.toCity, d.city));
    add("HOTEL_REQUIRED", "Укажите отель", hasFilled(d.hotel, d.hotelName));
    add("CHECKIN_REQUIRED", "Укажите дату заезда", hasFilled(d.startDate, d.checkinDate, d.checkInDate));
    add("CHECKOUT_REQUIRED", "Укажите дату выезда", hasFilled(d.endDate, d.checkoutDate, d.checkOutDate));
    add("ROOM_REQUIRED", "Укажите номер или размещение", hasFilled(d.accommodationCategory, d.accommodation, d.roomCategory));
  }

  if (category === "refused_flight") {
    add("FROM_REQUIRED", "Укажите город вылета", hasFilled(d.directionFrom, d.fromCity));
    add("TO_REQUIRED", "Укажите город прибытия", hasFilled(d.directionTo, d.toCity));
    add("DEPARTURE_DATE_REQUIRED", "Укажите дату вылета", hasFilled(d.startDate, d.startFlightDate, d.departureFlightDate, d.flightDate));
    if (isRoundTripFlight(d)) {
      add("RETURN_DATE_REQUIRED", "Для перелёта туда-обратно укажите дату обратного рейса", hasFilled(d.returnFlightDate, d.returnDate, d.endFlightDate, d.endDate));
    }
    add("AIRLINE_REQUIRED", "Укажите авиакомпанию", hasFilled(d.airline));
    add("FLIGHT_DETAILS_REQUIRED", "Укажите детали рейса: номер/время/багаж", hasFilled(d.flightDetails, d.flightNumber, d.baggage));
  }

  if (category === "refused_ticket" || category === "refused_event_ticket") {
    add("EVENT_NAME_REQUIRED", "Укажите название мероприятия", hasFilled(d.eventName, service.title));
    add("EVENT_CITY_REQUIRED", "Укажите город мероприятия", hasFilled(d.directionTo, d.toCity, d.city, d.location));
    add("EVENT_DATE_REQUIRED", "Укажите дату мероприятия", hasFilled(d.startDate, d.eventDate, d.date));
    add("TICKET_DETAILS_REQUIRED", "Укажите детали билета: сектор/ряд/место или тип билета", hasFilled(d.ticketDetails, d.eventCategory, d.sector, d.row, d.seat));
  }

  const net = parseMoney(first(d.netPrice, d.price, service.price));
  const gross = parseMoney(first(d.grossPrice, d.clientPrice, d.price, service.price));
  add("NET_PRICE_REQUIRED", "Укажите корректную цену нетто", Number.isFinite(net) && net > 0);
  add("GROSS_PRICE_REQUIRED", "Укажите корректную цену для клиента", Number.isFinite(gross) && gross > 0);
  add("GROSS_PRICE_TOO_LOW", "Цена для клиента не может быть меньше нетто", !Number.isFinite(net) || !Number.isFinite(gross) || gross >= net);

  if (isProofRequiredCategory(category)) {
    add("PROOF_IMAGES_REQUIRED", "Добавьте proof: скрин/ваучер/билет/подтверждение", getProofImages(d).length > 0);
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
