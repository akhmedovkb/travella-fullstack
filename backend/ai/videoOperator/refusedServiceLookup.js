// backend/ai/videoOperator/refusedServiceLookup.js

const db = require("../../db");
const { isServiceActual } = require("../../telegram/helpers/serviceActual");

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

function pickGrossPrice(details = {}, row = {}) {
  return firstNonEmpty(
    details.grossPrice,
    details.gross_price,
    details.priceGross,
    details.price_gross,
    details.bruttoPrice,
    details.brutto_price,
    details.priceBrut,
    details.price_brut,
    details.clientPrice,
    details.client_price,
    details.publicPrice,
    details.public_price,
    row.price,
    details.price,
    details.amount,
    details.totalPrice,
    details.total_price
  );
}

function normalizeOfferText(value) {
  const cleaned = String(value || "")
    .replace(/через\s+@\S+/gi, "")
    .replace(/отказн[а-яё]*\s+тур[а-яё]*/gi, "")
    .replace(/горящ[а-яё]*/gi, "")
    .replace(/[🔥🌍🏨📅]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([).,])/g, "$1")
    .replace(/^[\s:;,.()\-]+|[\s:;,.()\-]+$/g, "")
    .replace(/^(в|на|во)\s+/i, "")
    .trim();
  return normalizeDisplayCase(cleaned);
}

function titleCaseFallback(value) {
  const text = normalizeOfferText(value);
  return text || String(value || "").trim();
}

function normalizeDestinationName(value) {
  const text = titleCaseFallback(value);
  const lower = text.toLowerCase();
  const known = {
    "анталью": "Анталья",
    "аланию": "Алания",
    "турцию": "Турция",
  };
  return known[lower] || text;
}

function parseRouteFromText(value) {
  const text = titleCaseFallback(value);
  const match = text.match(/^(.+?)\s+из\s+(.+)$/i);
  if (!match) return { destination: normalizeDestinationName(text), fromCity: "" };
  return {
    destination: normalizeDestinationName(match[1]),
    fromCity: titleCaseFallback(match[2]),
  };
}

function normalizeDisplayCase(value) {
  const text = String(value || "").trim();
  if (!text || /[a-z]/.test(text)) return text;
  const letters = text.replace(/[^A-ZА-ЯЁ]/g, "");
  if (letters.length < 4) return text;
  const upper = letters.replace(/[^A-ZА-ЯЁ]/g, "");
  if (upper.length !== letters.length) return text;
  return text
    .toLowerCase()
    .replace(/(^|[\s(-])([a-zа-яё])/g, (match, prefix, ch) => `${prefix}${ch.toUpperCase()}`)
    .split(" ")
    .map((word) => (["И", "Из", "В", "На", "Для", "От"].includes(word) ? word.toLowerCase() : word))
    .join(" ");
}

function normalizeCode(input) {
  const m = String(input || "").match(/([RAHE])\s*(\d{1,8})/i);
  if (!m) return null;
  return { code: `${m[1].toUpperCase()}${m[2]}`, prefix: m[1].toUpperCase(), id: Number(m[2]) };
}

function normalizeCategoryFilters(categories = []) {
  return [...new Set((Array.isArray(categories) ? categories : [categories])
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean))];
}

function categorySql(filters = []) {
  const normalized = normalizeCategoryFilters(filters);
  if (!normalized.length) return { sql: "((s.category LIKE 'refused_%') OR s.category = 'author_tour')", values: [] };
  return {
    sql: `s.category = ANY($CATEGORY_PARAM::text[])`,
    values: [normalized],
  };
}

function activeServiceStatusSql() {
  return "LOWER(COALESCE(s.status, '')) NOT IN ('archived', 'deleted', 'draft', 'rejected')";
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

function categoryTaskPrefix(category) {
  const normalized = String(category || "").toLowerCase();
  if (normalized === "refused_flight") return "A";
  if (normalized === "refused_hotel") return "H";
  if (normalized === "refused_event_ticket" || normalized === "refused_ticket") return "E";
  return "R";
}

function normalizeService(row) {
  const d = parseDetailsAny(row.details);
  const category = String(row.category || "").toLowerCase();
  const taskCode = `${categoryTaskPrefix(category)}${row.id}`;

  const price = pickGrossPrice(d, row);
  const currency = firstNonEmpty(row.currency, d.currency, d.priceCurrency, process.env.PRICE_CURRENCY || "USD");

  const title = titleCaseFallback(row.title) || `${categoryLabel(category)} #R${row.id}`;
  const routeFromTitle = parseRouteFromText(title);
  const explicitDestination = titleCaseFallback(firstNonEmpty(
    pick(d, ["destination", "direction", "country", "arrivalCity", "arrival_city", "toCity", "cityTo"]),
    row.title
  ));
  const destination = routeFromTitle.destination && routeFromTitle.destination !== title
    ? routeFromTitle.destination
    : normalizeDestinationName(explicitDestination);
  const fromCity = firstNonEmpty(
    pick(d, ["fromCity", "cityFrom", "departureCity", "departure_city", "city", "origin"]),
    routeFromTitle.fromCity
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
    taskCode,
    displayCode: taskCode,
    category,
    categoryLabel: categoryLabel(category),
    status: row.status || "",
    title,
    provider: {
      id: row.provider_id || row.p_id || null,
      name: row.provider_name || row.p_name || "",
      phone: row.provider_phone || row.p_phone || "",
      telegramUsername: row.provider_social || row.p_social || "",
    },
    details: d,
    videoContext: {
      code: taskCode,
      serviceId: row.id,
      title,
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

async function findRefusedServiceByCode(code, options = {}) {
  const normalized = normalizeCode(code);
  if (!normalized?.id) {
    return { found: false, code: code || "", reason: "BAD_CODE" };
  }
  const category = categorySql(options.categoryFilters || options.categories || []);

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
        NULL::text AS currency,
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
        AND ${category.sql.replace("$CATEGORY_PARAM", "$2")}
        AND s.deleted_at IS NULL
        AND ${activeServiceStatusSql()}
      LIMIT 1
    `,
    [normalized.id, ...(category.values.length ? category.values : [])]
  );

  const row = q.rows?.[0];
  if (!row) return { found: false, code: normalized.code, id: normalized.id, reason: "NOT_FOUND" };
  if (!isServiceActual(row.details, row)) return { found: false, code: normalized.code, id: normalized.id, reason: "NOT_ACTUAL" };
  return { found: true, service: normalizeService(row) };
}

async function listRecentRefusedServices({ limit = 8, categoryFilters = [], categories = [] } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 8, 20));
  const category = categorySql(categoryFilters.length ? categoryFilters : categories);
  const params = category.values.length ? [category.values[0], safeLimit] : [safeLimit];
  const limitParam = category.values.length ? 2 : 1;
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
        NULL::text AS currency,
        s.created_at,
        s.updated_at,
        s.deleted_at,
        p.id AS p_id,
        p.name AS provider_name,
        p.phone AS provider_phone,
        p.social AS provider_social
      FROM services s
      LEFT JOIN providers p ON p.id = s.provider_id
      WHERE ${category.sql.replace("$CATEGORY_PARAM", "$1")}
        AND s.deleted_at IS NULL
        AND ${activeServiceStatusSql()}
      ORDER BY s.id DESC
      LIMIT $${limitParam}
    `,
    params
  );
  return (q.rows || []).filter((row) => isServiceActual(row.details, row)).map(normalizeService);
}

async function findLatestRefusedService(options = {}) {
  const services = await listRecentRefusedServices({ limit: 1, categoryFilters: options.categoryFilters || options.categories || [] });
  const service = services[0] || null;
  return service ? { found: true, service } : { found: false, reason: "NO_REFUSED_SERVICES" };
}

async function searchRefusedServices({ q = "", limit = 10, categoryFilters = [], categories = [] } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 20));
  const filters = normalizeCategoryFilters(categoryFilters.length ? categoryFilters : categories);
  const where = ["s.deleted_at IS NULL", activeServiceStatusSql()];
  const params = [];

  if (filters.length) {
    params.push(filters);
    where.push(`s.category = ANY($${params.length}::text[])`);
  } else {
    where.push("((s.category LIKE 'refused_%') OR s.category = 'author_tour')");
  }

  const query = String(q || "").trim();
  const normalizedCode = normalizeCode(query);
  if (normalizedCode?.id) {
    params.push(normalizedCode.id);
    where.push(`s.id = $${params.length}`);
  } else if (query) {
    params.push(`%${query}%`);
    const i = params.length;
    where.push(`(
      s.title ILIKE $${i}
      OR s.category ILIKE $${i}
      OR COALESCE(s.details::text, '') ILIKE $${i}
      OR COALESCE(p.name, '') ILIKE $${i}
    )`);
  }

  params.push(safeLimit);
  const qres = await db.query(
    `
      SELECT
        s.id,
        s.category,
        s.status,
        s.title,
        s.provider_id,
        s.details,
        s.price,
        NULL::text AS currency,
        s.created_at,
        s.updated_at,
        s.deleted_at,
        p.id AS p_id,
        p.name AS provider_name,
        p.phone AS provider_phone,
        p.social AS provider_social
      FROM services s
      LEFT JOIN providers p ON p.id = s.provider_id
      WHERE ${where.join(" AND ")}
      ORDER BY s.id DESC
      LIMIT $${params.length}
    `,
    params
  );
  return (qres.rows || []).filter((row) => isServiceActual(row.details, row)).map(normalizeService);
}

module.exports = {
  findRefusedServiceByCode,
  findLatestRefusedService,
  listRecentRefusedServices,
  searchRefusedServices,
  normalizeService,
  normalizeCode,
};
