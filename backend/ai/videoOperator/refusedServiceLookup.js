// backend/ai/videoOperator/refusedServiceLookup.js

const db = require("../../db");

function parseDetailsAny(details) {
  if (!details) return {};
  if (typeof details === "object") return details;
  if (typeof details === "string") {
    try {
      const parsed = JSON.parse(details);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function pick(obj, keys, fallback = "") {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return fallback;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function normalizeCode(input) {
  const m = String(input || "").match(/R\s*(\d{1,8})/i);
  if (!m) return null;
  return { code: `R${m[1]}`.toUpperCase(), id: Number(m[1]) };
}

function categoryLabel(category) {
  const map = {
    refused_tour: "Отказной тур",
    author_tour: "Авторский тур",
    refused_hotel: "Отказной отель",
    refused_flight: "Отказной авиабилет",
    refused_ticket: "Отказной билет",
    refused_event_ticket: "Отказной билет на мероприятие",
  };
  return map[String(category || "").toLowerCase()] || String(category || "Услуга");
}

function normalizeService(row) {
  const d = parseDetailsAny(row.details);
  const category = String(row.category || "").toLowerCase();

  const price = firstNonEmpty(row.price, d.price, d.netPrice, d.grossPrice, d.amount, d.totalPrice);
  const currency = firstNonEmpty(row.currency, d.currency, d.priceCurrency, process.env.PRICE_CURRENCY || "USD");

  const fromCity = pick(d, ["fromCity", "cityFrom", "departureCity", "departure_city", "city", "origin"], "Ташкент");
  const destination = firstNonEmpty(
    pick(d, ["destination", "direction", "country", "arrivalCity", "arrival_city", "toCity", "cityTo"]),
    row.title
  );

  const dateFrom = pick(d, ["startDate", "dateFrom", "date_from", "departureDate", "departure_date", "departureFlightDate", "checkinDate", "checkInDate", "eventDate", "date"]);
  const dateTo = pick(d, ["endDate", "dateTo", "date_to", "returnDate", "return_date", "returnFlightDate", "checkoutDate", "checkOutDate"]);
  const dates = dateFrom && dateTo ? `${dateFrom} — ${dateTo}` : firstNonEmpty(dateFrom, dateTo, pick(d, ["dates", "period"]));

  const hotel = pick(d, ["hotel", "hotelName", "hotel_name", "propertyName", "resort"]);
  const room = pick(d, ["room", "roomType", "room_type", "roomCategory", "room_category"]);
  const meal = pick(d, ["meal", "mealType", "meal_type", "food", "nutrition", "board"]);
  const people = pick(d, ["people", "accommodation", "placement", "pax", "guests", "travellers", "passengers"]);
  const flight = pick(d, ["flight", "flights", "flightDetails", "flight_details", "avia", "route"]);
  const includes = firstNonEmpty(
    Array.isArray(d.included) ? d.included.join(", ") : "",
    pick(d, ["includes", "includedText", "included_text", "whatIncluded", "included"])
  );
  const urgency = firstNonEmpty(
    pick(d, ["urgency", "actualityComment", "comment", "note"]),
    "предложение отказное, поэтому может уйти в любой момент"
  );

  return {
    id: row.id,
    code: `R${row.id}`,
    category,
    categoryLabel: categoryLabel(category),
    status: row.status || "",
    title: row.title || `${categoryLabel(category)} #R${row.id}`,
    provider: {
      id: row.provider_id || row.p_id || null,
      name: row.provider_name || row.p_name || "",
      phone: row.provider_phone || row.p_phone || "",
      telegramUsername: row.provider_social || row.p_social || "",
    },
    details: d,
    videoContext: {
      code: `R${row.id}`,
      title: row.title || `${categoryLabel(category)} #R${row.id}`,
      category: categoryLabel(category),
      fromCity,
      destination,
      dates,
      hotel,
      room,
      meal,
      people,
      price,
      currency,
      flight,
      includes,
      supplier: row.provider_name || row.p_name || "",
      urgency,
    },
  };
}

async function findRefusedServiceByCode(code) {
  const normalized = normalizeCode(code);
  if (!normalized?.id) {
    return { found: false, code: code || "", reason: "BAD_CODE" };
  }

  const q = await db.query(
    `
      SELECT
        s.id,
        s.category,
        s.status,
        s.title,
        s.provider_id,
        s.details,
        s.price,
        s.currency,
        s.created_at,
        s.updated_at,
        s.deleted_at,
        p.id AS p_id,
        p.name AS provider_name,
        p.phone AS provider_phone,
        p.social AS provider_social
      FROM services s
      LEFT JOIN providers p ON p.id = s.provider_id
      WHERE s.id = $1
        AND ((s.category LIKE 'refused_%') OR s.category = 'author_tour')
        AND s.deleted_at IS NULL
      LIMIT 1
    `,
    [normalized.id]
  );

  const row = q.rows?.[0];
  if (!row) return { found: false, code: normalized.code, id: normalized.id, reason: "NOT_FOUND" };
  return { found: true, service: normalizeService(row) };
}

module.exports = { findRefusedServiceByCode, normalizeService, normalizeCode };
