// backend/utils/serviceDisplay.js
// Единый источник отображаемого названия/локации услуги для карточек, валидаторов и модерации.

const { normalizeCategory } = require("./serviceCategories");

const CATEGORY_FALLBACK_TITLE = {
  refused_tour: "Отказной тур",
  author_tour: "Авторский тур",
  refused_hotel: "Отказной отель",
  refused_flight: "Отказной авиабилет",
  refused_ticket: "Билет на мероприятие",
  refused_event_ticket: "Билет на мероприятие",
};

const GENERIC_TITLES = new Set([
  "услуга",
  "отказной тур",
  "отказной отель",
  "отказной авиабилет",
  "отказной билет",
  "билет на мероприятие",
  "отказной билет / мероприятие",
  "авторский тур",
]);

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

function firstFilled(...values) {
  for (const v of values) {
    if (hasFilled(v)) return typeof v === "string" ? v.trim() : String(v).trim();
  }
  return "";
}

function clean(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s*→\s*/g, " → ")
    .trim();
}

function normalizeTitleSoft(str) {
  const s = clean(str);
  if (!s) return "";
  if (/[a-zа-яё]/.test(s)) return s;
  return s.replace(/[A-Za-zА-ЯЁа-яё]+/g, (w) => {
    if (w.length <= 3) return w;
    if (w === w.toUpperCase()) return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    return w;
  });
}

function truncateText(value, max = 60) {
  const s = clean(value);
  const n = Number(max || 0);
  if (!s || !Number.isFinite(n) || n <= 0 || s.length <= n) return s;
  return `${s.slice(0, Math.max(1, n - 1)).trim()}…`;
}

function isGenericTitle(value) {
  const s = clean(value).toLowerCase();
  return !s || GENERIC_TITLES.has(s);
}

function routeTitle(d) {
  const from = firstFilled(d.directionFrom, d.fromCity, d.from);
  const to = firstFilled(d.directionTo, d.toCity, d.to, d.city, d.locationCity);
  if (from && to) return `${from} → ${to}`;
  return firstFilled(to, from);
}

function locationTitle(d) {
  const city = firstFilled(d.directionTo, d.toCity, d.city, d.locationCity, d.location);
  const country = firstFilled(d.directionCountry, d.country, d.locationCountry);
  return [city, country].filter(Boolean).join(", ");
}

function getServiceDisplayTitle(service = {}, options = {}) {
  const d = normalizeDetails(service.details);
  const category = normalizeCategory(service.category);
  const allowFallback = options.allowFallback !== false;
  const maxLength = options.maxLength || 60;

  const explicit = firstFilled(
    service.title,
    service.name,
    d.title,
    d.name,
    d.serviceTitle,
    d.offerTitle,
    d.marketingTitle,
    d.displayTitle
  );

  if (explicit && !isGenericTitle(explicit)) return truncateText(normalizeTitleSoft(explicit), maxLength);

  let derived = "";
  if (category === "refused_flight") {
    const airline = firstFilled(d.airline);
    const route = routeTitle(d);
    const country = firstFilled(d.directionCountry, d.country);
    derived = firstFilled(d.flightTitle, d.ticketTitle, d.routeTitle, [airline, route].filter(Boolean).join(" "), [route, country].filter(Boolean).join(" • "));
  } else if (category === "refused_hotel") {
    const hotel = firstFilled(d.hotel, d.hotelName);
    const loc = locationTitle(d);
    derived = firstFilled(d.hotelTitle, hotel && loc ? `${hotel} • ${loc}` : hotel || loc);
  } else if (category === "refused_ticket" || category === "refused_event_ticket") {
    const event = firstFilled(d.eventName, d.eventTitle, d.ticketTitle);
    const loc = locationTitle(d);
    derived = firstFilled(event && loc ? `${event} • ${loc}` : event || loc);
  } else if (category === "author_tour") {
    const route = routeTitle(d);
    const loc = locationTitle(d);
    derived = firstFilled(d.authorTourTitle, d.tourTitle, route, loc);
  } else {
    const hotel = firstFilled(d.hotel, d.hotelName);
    const route = routeTitle(d) || locationTitle(d);
    derived = firstFilled(d.tourTitle, route && hotel ? `${route} • ${hotel}` : route || hotel);
  }

  if (derived && !isGenericTitle(derived)) return truncateText(normalizeTitleSoft(derived), maxLength);
  if (!allowFallback) return "";
  return truncateText(CATEGORY_FALLBACK_TITLE[category] || "Услуга", maxLength);
}

function hasServiceDisplayTitle(service = {}) {
  return !!getServiceDisplayTitle(service, { allowFallback: false, maxLength: 120 });
}

function getServiceLocation(service = {}) {
  const d = normalizeDetails(service.details);
  const category = normalizeCategory(service.category);
  if (category === "refused_flight") return routeTitle(d) || locationTitle(d);
  return locationTitle(d) || routeTitle(d);
}

module.exports = {
  CATEGORY_FALLBACK_TITLE,
  normalizeDetails,
  getServiceDisplayTitle,
  hasServiceDisplayTitle,
  getServiceLocation,
  truncateText,
};
