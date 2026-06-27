// backend/utils/flightDetailsNormalizer.js
// Single normalizer for refused_flight details.
// Goal: if wizard/web/import stores a raw flightDetails line, category-aware matrix
// still receives airline + flightNumber with stable keys.

const AIRLINE_CODE_LABELS = {
  HY: "Uzbekistan Airways",
  HH: "Qanot Sharq",
  TK: "Turkish Airlines",
  PC: "Pegasus Airlines",
  VF: "AJet",
  J2: "Azerbaijan Airlines",
  KC: "Air Astana",
  QR: "Qatar Airways",
  EK: "Emirates",
  FZ: "Flydubai",
  G9: "Air Arabia",
  W6: "Wizz Air",
  U6: "Ural Airlines",
  SU: "Aeroflot",
  S7: "S7 Airlines",
  LO: "LOT Polish Airlines",
  BJ: "Nouvelair",
};

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const s = String(value).trim();
    if (s) return s;
  }
  return "";
}

function normalizeFlightNumber(code, num) {
  const c = String(code || "").trim().toUpperCase();
  const n = String(num || "").trim().toUpperCase();
  if (!c || !n) return "";
  return `${c}-${n}`;
}

function parseFlightTokens(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];

  const out = [];
  const seen = new Set();
  const re = /\b(?=[A-ZА-Я0-9]{2,3}\b)(?=[A-ZА-Я0-9]*[A-ZА-Я])([A-ZА-Я0-9]{2,3})\s*[- ]\s*(\d{2,5}[A-ZА-Я]?)\b/giu;
  let m;
  while ((m = re.exec(raw))) {
    const code = String(m[1] || "").trim().toUpperCase();
    const number = String(m[2] || "").trim().toUpperCase();
    const flightNumber = normalizeFlightNumber(code, number);
    if (!code || !number || seen.has(flightNumber)) continue;
    seen.add(flightNumber);
    out.push({ code, number, flightNumber });
  }
  return out;
}

function inferAirlineLabel(code) {
  const c = String(code || "").trim().toUpperCase();
  return AIRLINE_CODE_LABELS[c] || c || "";
}

function normalizeRefusedFlightDetails(details = {}) {
  const d = details && typeof details === "object" && !Array.isArray(details) ? { ...details } : {};

  const rawFlightDetails = firstNonEmpty(
    d.flightDetails,
    d.flight_details,
    d.flightInfo,
    d.flight_info,
    d.routeDetails,
    d.route_details
  );
  if (rawFlightDetails) d.flightDetails = rawFlightDetails;

  const explicitFlightNumber = firstNonEmpty(
    d.flightNumber,
    d.flight_number,
    d.flightNo,
    d.flight_no,
    d.flightCode,
    d.flight_code
  );

  const explicitAirline = firstNonEmpty(
    d.airline,
    d.airCompany,
    d.air_company,
    d.carrier,
    d.airlineName,
    d.airline_name
  );

  const tokens = parseFlightTokens([explicitFlightNumber, rawFlightDetails].filter(Boolean).join("\n"));
  const first = tokens[0] || null;

  if (!d.flightNumber && explicitFlightNumber) d.flightNumber = explicitFlightNumber;
  if (!d.flightNumber && first?.flightNumber) d.flightNumber = first.flightNumber;
  if (!d.flightCode && first?.code) d.flightCode = first.code;

  if (!d.airline && explicitAirline) d.airline = explicitAirline;
  if (!d.airline && first?.code) d.airline = inferAirlineLabel(first.code);

  if (!d.airCompany && d.airline) d.airCompany = d.airline;
  if (!d.carrier && d.airline) d.carrier = d.airline;

  if (tokens.length > 1) {
    d.flightNumbers = tokens.map((x) => x.flightNumber);
    d.departureFlightNumber = d.departureFlightNumber || tokens[0].flightNumber;
    d.returnFlightNumber = d.returnFlightNumber || tokens[1].flightNumber;
  }

  delete d.flight_details;
  delete d.flight_info;
  delete d.route_details;
  delete d.flight_number;
  delete d.flight_no;
  delete d.flight_code;
  delete d.air_company;
  delete d.airline_name;

  return d;
}

module.exports = {
  AIRLINE_CODE_LABELS,
  parseFlightTokens,
  normalizeRefusedFlightDetails,
};
