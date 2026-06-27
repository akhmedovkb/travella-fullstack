// backend/utils/serviceFieldMatrix.js
// Единая матрица полей услуг: creation/edit/quality/submit/card должны ссылаться на один смысл поля.
// Важно: это не заменяет wizard полностью за один шаг, но фиксирует канонические поля,
// чтобы валидаторы и качество не требовали то, что мастер не собирает.

const { normalizeCategory } = require("./serviceCategories");
const { normalizeDetails, hasServiceDisplayTitle } = require("./serviceDisplay");

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

function isRoundTripFlight(details = {}) {
  const type = String(details.flightType || details.flight_type || "").trim().toLowerCase();
  return type === "round_trip" || details.oneWay === false || details.one_way === false;
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

function baseChecks(service = {}) {
  const d = normalizeDetails(service.details);
  const net = parseMoney(first(d.netPrice, d.price, service.price));
  const gross = parseMoney(first(d.grossPrice, d.clientPrice, d.price, service.price));
  return [
    { key: "title", code: "TITLE_REQUIRED", label: "Название услуги", weight: 2, ok: hasServiceDisplayTitle(service), submit: true },
    { key: "netPrice", code: "NET_PRICE_REQUIRED", label: "Корректная цена нетто", weight: 2, ok: Number.isFinite(net) && net > 0, submit: true },
    { key: "grossPrice", code: "GROSS_PRICE_REQUIRED", label: "Корректная цена для клиента", weight: 2, ok: Number.isFinite(gross) && gross > 0, submit: true },
    { key: "grossNotLower", code: "GROSS_PRICE_TOO_LOW", label: "Цена для клиента не ниже нетто", weight: 1, ok: !Number.isFinite(net) || !Number.isFinite(gross) || gross >= net, submit: true },
  ];
}

function getCategoryChecks(service = {}) {
  const category = normalizeCategory(service.category);
  const d = normalizeDetails(service.details);
  const checks = [...baseChecks(service)];

  if (category === "refused_flight") {
    const roundTrip = isRoundTripFlight(d);
    checks.push(
      { key: "route", code: "ROUTE_REQUIRED", label: "Маршрут", weight: 3, ok: hasFilled(d.directionFrom, d.fromCity) && hasFilled(d.directionTo, d.toCity), submit: true },
      { key: "departureDate", code: "DEPARTURE_DATE_REQUIRED", label: "Дата вылета", weight: 3, ok: hasFilled(d.startDate, d.startFlightDate, d.departureFlightDate, d.flightDate), submit: true },
      { key: "returnDate", code: "RETURN_DATE_REQUIRED", label: roundTrip ? "Дата обратного рейса" : "Тип перелёта: в одну сторону", weight: 2, ok: roundTrip ? hasFilled(d.returnFlightDate, d.returnDate, d.endFlightDate, d.endDate) : true, submit: roundTrip },
      // airline собирается мастером создания и редактирования, поэтому может быть submit-блокером.
      { key: "airline", code: "AIRLINE_REQUIRED", label: "Авиакомпания", weight: 2, ok: hasFilled(d.airline), submit: true },
      { key: "flightDetails", code: "FLIGHT_DETAILS_REQUIRED", label: "Детали рейса: номер/время/багаж", weight: 1, ok: hasFilled(d.flightDetails, d.flightNumber, d.baggage), submit: true },
      { key: "seats", code: "SEATS_RECOMMENDED", label: "Количество мест", weight: 1, ok: hasFilled(d.seats, d.quantity, d.pax), submit: false }
    );
  } else if (category === "refused_ticket" || category === "refused_event_ticket") {
    checks.push(
      { key: "eventName", code: "EVENT_NAME_REQUIRED", label: "Название мероприятия", weight: 2, ok: hasFilled(d.eventName, service.title), submit: true },
      { key: "eventCity", code: "EVENT_CITY_REQUIRED", label: "Город/площадка", weight: 3, ok: hasFilled(d.directionTo, d.toCity, d.city, d.location), submit: true },
      { key: "eventDate", code: "EVENT_DATE_REQUIRED", label: "Дата мероприятия", weight: 3, ok: hasFilled(d.startDate, d.eventDate, d.date), submit: true },
      { key: "ticketDetails", code: "TICKET_DETAILS_REQUIRED", label: "Сектор/ряд/место или тип билета", weight: 2, ok: hasFilled(d.ticketDetails, d.eventCategory, d.sector, d.row, d.seat), submit: true },
      { key: "quantity", code: "TICKET_QUANTITY_RECOMMENDED", label: "Количество билетов", weight: 1, ok: hasFilled(d.quantity, d.seats, d.ticketCount), submit: false }
    );
  } else if (category === "refused_hotel") {
    checks.push(
      { key: "location", code: "LOCATION_REQUIRED", label: "Страна и город", weight: 3, ok: hasFilled(d.directionCountry, d.country) && hasFilled(d.directionTo, d.toCity, d.city), submit: true },
      { key: "hotel", code: "HOTEL_REQUIRED", label: "Отель", weight: 3, ok: hasFilled(d.hotel, d.hotelName), submit: true },
      { key: "dates", code: "HOTEL_DATES_REQUIRED", label: "Заезд и выезд", weight: 3, ok: hasFilled(d.startDate, d.checkinDate, d.checkInDate) && hasFilled(d.endDate, d.checkoutDate, d.checkOutDate), submit: true },
      { key: "room", code: "ROOM_REQUIRED", label: "Номер/размещение", weight: 2, ok: hasFilled(d.accommodationCategory, d.accommodation, d.roomCategory), submit: true },
      { key: "meal", code: "MEAL_RECOMMENDED", label: "Питание", weight: 1, ok: hasFilled(d.food, d.meal), submit: false },
      { key: "transfer", code: "TRANSFER_RECOMMENDED", label: "Трансфер", weight: 1, ok: hasFilled(d.transfer), submit: false }
    );
  } else if (category === "refused_tour") {
    checks.push(
      { key: "country", code: "COUNTRY_REQUIRED", label: "Страна направления", weight: 2, ok: hasFilled(d.directionCountry, d.country), submit: true },
      { key: "route", code: "ROUTE_REQUIRED", label: "Город вылета и прибытия", weight: 3, ok: hasFilled(d.directionFrom, d.fromCity) && hasFilled(d.directionTo, d.toCity, d.city), submit: true },
      { key: "dates", code: "TOUR_DATES_REQUIRED", label: "Даты тура", weight: 3, ok: hasFilled(d.startDate, d.start_date) && hasFilled(d.endDate, d.end_date), submit: true },
      { key: "hotel", code: "HOTEL_REQUIRED", label: "Отель", weight: 3, ok: hasFilled(d.hotel, d.hotelName), submit: true },
      { key: "room", code: "ROOM_REQUIRED", label: "Номер/размещение", weight: 2, ok: hasFilled(d.accommodation, d.accommodationCategory, d.roomCategory), submit: true },
      { key: "meal", code: "MEAL_RECOMMENDED", label: "Питание", weight: 1, ok: hasFilled(d.food, d.meal), submit: false },
      { key: "transfer", code: "TRANSFER_RECOMMENDED", label: "Трансфер", weight: 1, ok: hasFilled(d.transfer), submit: false }
    );
  } else if (category === "author_tour") {
    checks.push(
      { key: "country", code: "COUNTRY_REQUIRED", label: "Страна / направление", weight: 2, ok: hasFilled(d.directionCountry, d.country), submit: true },
      { key: "route", code: "ROUTE_REQUIRED", label: "Маршрут авторского тура", weight: 3, ok: hasFilled(d.directionFrom, d.fromCity) && hasFilled(d.directionTo, d.toCity), submit: true },
      { key: "dates", code: "DATES_REQUIRED", label: "Даты или даты по запросу", weight: 2, ok: d.flexibleDates || (hasFilled(d.startDate) && hasFilled(d.endDate)), submit: true },
      { key: "program", code: "PROGRAM_REQUIRED", label: "Программа авторского тура", weight: 3, ok: hasFilled(d.program, d.programDaysText) || (Array.isArray(d.programDays) && d.programDays.length > 0), submit: true },
      { key: "included", code: "INCLUDED_REQUIRED", label: "Что включено", weight: 2, ok: hasFilled(d.included), submit: true }
    );
  }

  return checks;
}

function getSubmitChecks(service = {}) {
  return getCategoryChecks(service).filter((x) => x.submit !== false);
}

module.exports = {
  hasFilled,
  parseMoney,
  first,
  isRoundTripFlight,
  getProofImages,
  getImages,
  getCategoryChecks,
  getSubmitChecks,
};
