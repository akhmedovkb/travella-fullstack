// controllers/hotelController.js
const axios = require("axios");

// простейший in-memory кэш, чтобы не жечь лимиты
const cache = new Map();
const TTL_MS = 60 * 60 * 1000; // 1 час

function memoKey(p) {
  return JSON.stringify(p);
}
function getCached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expireAt) { cache.delete(key); return null; }
  return hit.data;
}
function setCached(key, data) {
  cache.set(key, { data, expireAt: Date.now() + TTL_MS });
}

function dedup(arr) {
  const seen = new Set();
  const out = [];
  for (const s of arr) {
    const k = String(s).trim();
    if (!k || seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
  }
  return out;
}

/* -------- Google Places (v1) -------- */
async function searchGooglePlaces({ query, country, lang }) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return [];

  // places:searchText с типом lodging
  const url = "https://places.googleapis.com/v1/places:searchText";
  const body = {
    textQuery: query,          // что ввёл пользователь
    includedType: "lodging",   // только отели/гостиницы
    languageCode: (lang || "en").slice(0, 2),
  };
  if (country && country.length === 2) {
    body.regionCode = country.toUpperCase(); // ISO-3166-1 alpha-2
  }

  const headers = {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": apiKey,
    // Просим только название для экономии квоты/скорости
    "X-Goog-FieldMask": "places.displayName",
  };

  const resp = await axios.post(url, body, { headers });
  const places = resp.data?.places || [];
  return dedup(places.map((p) => p?.displayName?.text).filter(Boolean));
}

/* -------- GeoNames (fallback) -------- */
async function searchGeoNames({ query, country, lang }) {
  const username = process.env.GEONAMES_USERNAME;
  if (!username) return [];

  // Ищем объекты типа hotel; если страну передали — сужаем
  const params = {
    q: query,
    featureClass: "S",
    featureCode: "HTL",
    maxRows: 15,
    username,
  };
  if (country) params.country = country.toUpperCase();
  if (lang) params.lang = (lang || "en").slice(0, 2);

  const r = await axios.get("https://secure.geonames.org/searchJSON", { params });
  const items = Array.isArray(r.data?.geonames) ? r.data.geonames : [];
  return dedup(items.map((g) => g.name).filter(Boolean));
}

/* -------- Контроллер маршрута /api/hotels/search -------- */
exports.searchHotels = async (req, res) => {
  try {
    const query = String(req.query.query || req.query.q || "").trim();
    if (!query || query.length < 2) return res.json([]);

    const country = (req.query.country || "").trim(); // ISO2, например AE
    const lang = (req.query.lang || "").trim();

    const key = memoKey({ query, country, lang, provider: process.env.HOTEL_AUTOCOMPLETE_PROVIDER || "google" });
    const cached = getCached(key);
    if (cached) return res.json(cached);

    let result = [];
    const provider = (process.env.HOTEL_AUTOCOMPLETE_PROVIDER || "google").toLowerCase();

    if (provider === "google") {
      try {
        result = await searchGooglePlaces({ query, country, lang });
      } catch (e) {
        console.warn("Hotels: Google failed → fallback to GeoNames. Reason:", e.response?.data || e.message);
      }
    }

    if (!result.length) {
      try {
        result = await searchGeoNames({ query, country, lang });
      } catch (e) {
        console.warn("Hotels: GeoNames failed:", e.response?.data || e.message);
      }
    }

    setCached(key, result);
    return res.json(result);
  } catch (e) {
    console.error("Hotels search error:", e.response?.data || e.message);
    return res.json([]); // мягко
  }
};
