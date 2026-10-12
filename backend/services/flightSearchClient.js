const crypto = require("crypto");
const axios = require("axios");

function isConfigured() {
  return Boolean(String(process.env.SERPAPI_API_KEY || "").trim());
}

function parseFlightNumber(value) {
  const match = /^([A-Z0-9]{2,3})\s*[- ]?\s*(\d+[A-Z]?)$/i.exec(String(value || "").trim());
  return match ? { carrierCode: match[1].toUpperCase(), number: match[2].toUpperCase() } : { carrierCode: "", number: String(value || "") };
}

function baggageFromExtensions(extensions = []) {
  const item = (Array.isArray(extensions) ? extensions : []).find((value) => /bag|багаж|kg|кг/i.test(String(value)));
  return item ? String(item) : "";
}

function normalizeFlight(flight = {}) {
  const parsedNumber = parseFlightNumber(flight.flight_number);
  return {
    from: String(flight.departure_airport?.id || ""),
    to: String(flight.arrival_airport?.id || ""),
    departure_at: flight.departure_airport?.time || null,
    arrival_at: flight.arrival_airport?.time || null,
    carrier_code: parsedNumber.carrierCode,
    carrier_name: String(flight.airline || parsedNumber.carrierCode),
    number: parsedNumber.number,
    aircraft: String(flight.airplane || ""),
    duration_minutes: Number(flight.duration || 0) || null,
    stops: 0,
  };
}

function offerId(item) {
  if (item.booking_token) return String(item.booking_token);
  if (item.departure_token) return String(item.departure_token);
  return crypto.createHash("sha256").update(JSON.stringify(item.flights || item)).digest("hex").slice(0, 32);
}

function normalizeOffer(item, currency, fetchedAt = new Date()) {
  const flights = Array.isArray(item?.flights) ? item.flights : [];
  const segments = flights.map(normalizeFlight);
  const baggage = flights.map((flight) => baggageFromExtensions(flight.extensions)).find(Boolean) || "";
  const offerExpiresAt = new Date(fetchedAt.getTime() + 15 * 60 * 1000).toISOString();

  return {
    provider: "serpapi_google_flights",
    raw_offer_id: offerId(item),
    booking_token: item?.booking_token || null,
    one_way: true,
    fetched_at: fetchedAt.toISOString(),
    offer_expires_at: offerExpiresAt,
    seats_available: null,
    price: Number(item?.price || 0),
    base_price: Number(item?.price || 0),
    currency: String(currency || "USD"),
    cabin: String(flights[0]?.travel_class || ""),
    booking_class: "",
    baggage,
    validating_airline_codes: Array.from(new Set(segments.map((segment) => segment.carrier_code).filter(Boolean))),
    total_duration_minutes: Number(item?.total_duration || 0) || null,
    segments,
  };
}

function travelClassCode(value) {
  const normalized = String(value || "ECONOMY").toUpperCase();
  if (normalized === "PREMIUM_ECONOMY") return 2;
  if (normalized === "BUSINESS") return 3;
  if (normalized === "FIRST") return 4;
  return 1;
}

async function searchFlightOffers(params) {
  const apiKey = String(process.env.SERPAPI_API_KEY || "").trim();
  if (!apiKey) {
    const error = new Error("SerpApi API key is not configured");
    error.code = "SERPAPI_NOT_CONFIGURED";
    throw error;
  }

  const currency = String(params.currencyCode || "USD").toUpperCase();
  const response = await axios.get("https://serpapi.com/search.json", {
    params: {
      engine: "google_flights",
      api_key: apiKey,
      departure_id: params.originLocationCode,
      arrival_id: params.destinationLocationCode,
      outbound_date: params.departureDate,
      ...(params.returnDate ? { return_date: params.returnDate, type: 1 } : { type: 2 }),
      adults: params.adults,
      ...(params.children ? { children: params.children } : {}),
      travel_class: travelClassCode(params.travelClass),
      currency,
      hl: String(params.language || "en").slice(0, 2),
      gl: "uz",
    },
    timeout: 30000,
  });

  if (response.data?.error) {
    const error = new Error(String(response.data.error));
    error.code = "SERPAPI_ERROR";
    throw error;
  }

  const rows = [...(response.data?.best_flights || []), ...(response.data?.other_flights || [])];
  const fetchedAt = new Date();
  return rows.slice(0, Number(params.max || 8)).map((item) => normalizeOffer(item, currency, fetchedAt));
}

module.exports = { isConfigured, searchFlightOffers, normalizeOffer };
