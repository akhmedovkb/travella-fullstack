// backend/controllers/hotelController.js
// Единый автокомплит отелей с выбором провайдера через .env
// Возвращает: string[] имен (без ломания фронта). Node 18+: используем глобальный fetch.

const TTL_MS = 10 * 60 * 1000;
const cache = new Map();
const PROVIDER = String(process.env.HOTEL_AUTOCOMPLETE_PROVIDER || "geonames").toLowerCase();

const uniq = (arr) => Array.from(new Set((arr || []).map(s => String(s || "").trim()).filter(Boolean)));
const pad = (n) => String(n).padStart(2, "0");

function cacheKey(q, country, lang, limit) {
  return `${PROVIDER}||${q}||${country || ""}||${lang || ""}||${limit || 20}`;
}
function getCache(key) {
  const v = cache.get(key);
  if (!v) return null;
  if (Date.now() - v.ts > TTL_MS) { cache.delete(key); return null; }
  return v.data;
}
function setCache(key, data) { cache.set(key, { ts: Date.now(), data }); }

module.exports = { searchHotels };

async function searchHotels(req, res) {
  try {
    const q = String(req.query.query || req.query.q || "").trim();
    if (!q) return res.json([]);
    const country = String(req.query.country || "").trim(); // ISO2, опционально
    const lang    = String(req.query.lang || "ru").trim();
    const limit   = Math.min(Number(req.query.maxRows) || 20, 100);

    const key = cacheKey(q, country, lang, limit);
    const cached = getCache(key);
    if (cached) return res.json(cached);

    let names = [];
    switch (PROVIDER) {
      case "google":     names = await viaGoogle(q, country, lang, limit); break;
      case "mapbox":     names = await viaMapbox(q, country, lang, limit); break;
      case "foursquare": names = await viaFoursquare(q, country, lang, limit); break;
      case "tomtom":     names = await viaTomTom(q, country, lang, limit); break;
      case "nominatim":  names = await viaNominatim(q, country, lang, limit); break;
      case "geonames":
      default:           names = await viaGeoNames(q, country, lang, limit); break;
    }

    names = uniq(names).slice(0, limit);
    setCache(key, names);
    res.json(names);
  } catch (e) {
    console.error("hotel autocomplete error:", e?.message || e);
    res.json([]);
  }
}

/* ---------------- Providers ---------------- */

async function viaGeoNames(q, country, lang, limit) {
  const username = process.env.GEONAMES_USERNAME;
  if (!username) return [];
  const url = new URL("https://secure.geonames.org/searchJSON");
  url.searchParams.set("q", q);
  url.searchParams.set("name_startsWith", q);
  url.searchParams.set("featureClass", "S");
  url.searchParams.set("featureCode", "HTL");
  url.searchParams.set("maxRows", String(limit));
  url.searchParams.set("lang", lang);
  url.searchParams.set("username", username);
  if (country) url.searchParams.set("country", country);
  const r = await fetch(url); if (!r.ok) return [];
  const j = await r.json();
  return uniq((j.geonames || []).map(x => x.name));
}

async function viaGoogle(q, country, lang, limit) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return [];
  // Places API v1: Text Search with lodging filter
  const body = {
    textQuery: q,
    includedType: "lodging",         // все средства размещения
    languageCode: lang || "ru",
    maxResultCount: Math.min(limit, 20)
  };
  if (country) body.regionCode = country.toUpperCase();

  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.displayName"
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) { console.error("Google Places err:", r.status); return []; }
  const j = await r.json();
  return uniq((j.places || []).map(p => p.displayName?.text));
}

async function viaMapbox(q, country, lang, limit) {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) return [];
  const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json`);
  url.searchParams.set("types", "poi");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("language", lang || "ru");
  // categories — официальный фильтр по категориям
  url.searchParams.set("categories", "lodging,hotel");
  if (country) url.searchParams.set("country", country.toLowerCase());
  url.searchParams.set("access_token", token);

  const r = await fetch(url); if (!r.ok) return [];
  const j = await r.json();
  return uniq((j.features || []).map(f => f.text || f.properties?.name || f.place_name));
}

async function viaFoursquare(q, country, lang, limit) {
  const key = process.env.FSQ_API_KEY;
  if (!key) return [];
  const url = new URL("https://api.foursquare.com/v3/places/search");
  url.searchParams.set("query", q);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("locale", lang || "ru");
  // Категории Foursquare (семейство “Hotels”):
  // 19014 Hotel, 19015 Motel, 19016 Resort (и т.п.)
  url.searchParams.set("categories", "19014,19015,19016");
  // Для лучшей релевантности желательно near=Город или ll=lat,long.
  if (country) url.searchParams.set("near", country);

  const r = await fetch(url, { headers: { "Authorization": key, "Accept": "application/json" } });
  if (!r.ok) return [];
  const j = await r.json();
  return uniq((j.results || []).map(p => p.name));
}

async function viaTomTom(q, country, lang, limit) {
  const key = process.env.TOMTOM_API_KEY;
  if (!key) return [];
  const url = new URL(`https://api.tomtom.com/search/2/search/${encodeURIComponent(q)}.json`);
  url.searchParams.set("limit", String(limit));
  // categorySet 7315 = Hotels/Motels
  url.searchParams.set("categorySet", "7315");
  url.searchParams.set("key", key);
  if (country) url.searchParams.set("countrySet", country.toUpperCase());
  if (lang) url.searchParams.set("language", `${lang}-${lang.toUpperCase()}`);

  const r = await fetch(url); if (!r.ok) return [];
  const j = await r.json();
  return uniq((j.results || []).map(it => it.poi?.name || it.address?.freeformAddress));
}

async function viaNominatim(q, country, lang, limit) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  // Принудим слово 'hotel' в запросе для фильтрации, но оставим исходник впереди
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("accept-language", lang || "ru");
  if (country) url.searchParams.set("countrycodes", country.toLowerCase());
  const r = await fetch(url.toString(), {
    headers: { "User-Agent": "Travella/1.0 (autocomp@travella.local)" }
  });
  if (!r.ok) return [];
  const j = await r.json();
  // Берём “первую часть” названия (до первой запятой) как короткое имя
  return uniq(j.map(e => String(e.display_name || "").split(",")[0]));
}
