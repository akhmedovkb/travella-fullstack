// backend/utils/refusedQuality.js

const { normalizeCategory } = require("./serviceCategories");
const { hasServiceDisplayTitle } = require("./serviceDisplay");
const {
  buildSubmitValidationBlockers,
  getProofImages,
  getImages,
} = require("./serviceSubmitValidation");

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

function addCheck(list, key, label, ok, weight = 1) {
  list.push({ key, label, ok: Boolean(ok), weight: Number(weight || 1) });
}

function buildRefusedQuality(service = {}) {
  const category = normalizeCategory(service.category);
  const d = normalizeDetails(service.details);
  const checks = [];

  addCheck(checks, "title", "Название", hasServiceDisplayTitle(service), 2);
  addCheck(checks, "price", "Цена нетто и цена клиенту", hasFilled(d.netPrice, d.price, service.price) && hasFilled(d.grossPrice, d.clientPrice, d.price, service.price), 3);
  addCheck(checks, "proof", "Proof / подтверждение", getProofImages(d).length > 0 || getImages(service.images).length > 0, 3);

  if (category === "refused_flight") {
    addCheck(checks, "route", "Маршрут", hasFilled(d.directionFrom, d.fromCity) && hasFilled(d.directionTo, d.toCity), 3);
    addCheck(checks, "departureDate", "Дата вылета", hasFilled(d.startDate, d.startFlightDate, d.departureFlightDate, d.flightDate), 3);
    const isRoundTrip = String(d.flightType || d.flight_type || "").toLowerCase() === "round_trip" || d.oneWay === false || d.one_way === false;
    addCheck(checks, "returnDate", isRoundTrip ? "Дата обратного рейса" : "Тип перелёта: в одну сторону", isRoundTrip ? hasFilled(d.returnFlightDate, d.returnDate, d.endFlightDate, d.endDate) : true, 2);
    addCheck(checks, "airline", "Авиакомпания", hasFilled(d.airline), 2);
    addCheck(checks, "flightNumber", "Номер/детали рейса", hasFilled(d.flightDetails, d.flightNumber), 1);
    addCheck(checks, "baggage", "Багаж", hasFilled(d.baggage, d.flightDetails), 1);
    addCheck(checks, "seats", "Количество мест", hasFilled(d.seats, d.quantity, d.pax), 1);
  } else if (category === "refused_ticket" || category === "refused_event_ticket") {
    addCheck(checks, "eventCity", "Город/площадка", hasFilled(d.directionTo, d.toCity, d.city, d.location), 3);
    addCheck(checks, "eventDate", "Дата мероприятия", hasFilled(d.startDate, d.eventDate, d.date), 3);
    addCheck(checks, "ticketDetails", "Сектор/ряд/место или тип билета", hasFilled(d.ticketDetails, d.eventCategory, d.sector, d.row, d.seat), 2);
    addCheck(checks, "quantity", "Количество билетов", hasFilled(d.quantity, d.seats, d.ticketCount), 1);
  } else if (category === "refused_hotel") {
    addCheck(checks, "location", "Страна и город", hasFilled(d.directionCountry, d.country) && hasFilled(d.directionTo, d.toCity, d.city), 3);
    addCheck(checks, "dates", "Заезд и выезд", hasFilled(d.startDate, d.checkinDate, d.checkInDate) && hasFilled(d.endDate, d.checkoutDate, d.checkOutDate), 3);
    addCheck(checks, "hotel", "Отель", hasFilled(d.hotel, d.hotelName), 3);
    addCheck(checks, "room", "Номер/размещение", hasFilled(d.accommodationCategory, d.accommodation, d.roomCategory), 2);
  } else {
    addCheck(checks, "route", "Маршрут/направление", hasFilled(d.directionFrom, d.fromCity) && hasFilled(d.directionTo, d.toCity, d.city), 3);
    addCheck(checks, "dates", "Даты", hasFilled(d.startDate, d.start_date) && (hasFilled(d.endDate, d.end_date) || category === "author_tour"), 3);
    addCheck(checks, "details", "Основные детали", hasFilled(d.hotel, d.hotelName, d.accommodation, d.program, d.description, service.description), 2);
  }

  const total = checks.reduce((sum, x) => sum + x.weight, 0) || 1;
  const done = checks.filter((x) => x.ok).reduce((sum, x) => sum + x.weight, 0);
  const score = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
  const level = score >= 90 ? "excellent" : score >= 70 ? "good" : "needs_work";
  const blockers = buildSubmitValidationBlockers(service);

  return {
    score,
    level,
    completed: checks.filter((x) => x.ok).map((x) => x.key),
    missing: checks.filter((x) => !x.ok).map((x) => ({ key: x.key, label: x.label })),
    checks,
    blockers,
    canSubmit: blockers.length === 0,
  };
}

function formatQualityText(service = {}) {
  const q = buildRefusedQuality(service);
  const icon = q.level === "excellent" ? "🟢" : q.level === "good" ? "🟡" : "🔴";
  const title = q.level === "excellent" ? "Отлично" : q.level === "good" ? "Хорошо" : "Нужно дополнить";
  const lines = [`${icon} <b>Качество карточки:</b> ${q.score}% · ${title}`];
  const importantMissing = q.missing.slice(0, 5);
  if (importantMissing.length) {
    lines.push("", "⚠️ <b>Что усилит карточку:</b>");
    importantMissing.forEach((m) => lines.push(`• ${m.label}`));
  }
  if (q.blockers.length) {
    lines.push("", "⛔ <b>Перед модерацией обязательно исправить:</b>");
    q.blockers.slice(0, 7).forEach((b) => lines.push(`• ${b.label}`));
  }
  return lines.join("\n");
}

module.exports = {
  buildRefusedQuality,
  formatQualityText,
};
