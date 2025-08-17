// server/routes/extHotels.js
import express from "express";
import fetch from "node-fetch";

const router = express.Router();

// простой кэш на 5 минут
const cache = new Map();
const TTL = 5 * 60 * 1000;

const GEO_USER =
  process.env.GEONAMES_USERNAME ||
  process.env.VITE_GEONAMES_USERNAME ||  // вдруг положили туда
  null;

// ---- GeoNames: отели по name_startsWith ----
async function geonamesHotels(q) {
  if (!GEO_USER) return [];
  const url = new URL("https://secure.geonames.org/searchJSON");
  url.searchParams.set("name_startsWith", q);
  url.searchParams.set("featureClass", "S");
  url.searchParams.set("featureCode", "HTL");
  url.searchParams.set("maxRows", "10");
  url.searchParams.set("orderby", "relevance");
  url.searchParams.set("username", GEO_USER);

  const r = await fetch(url.toString(), { timeout: 8000 });
  if (!r.ok) return [];
  const j = await r.json();
  const arr = Array.isArray(j?.geonames) ? j.geonames : [];
  return arr
    .map((x) => ({
      name: x.name || x.toponymName || "",
      city: x.adminName2 || x.adminName1 || x.city || "",
      country: x.countryName || x.countryCode || "",
    }))
    .filter((x) => x.name);
}

// ---- Overpass fallback (без ключа), ищем tourism=hotel name~"^q" ----
async function overpassHotels(q) {
  const query = `
    [out:json][timeout:10];
    (
      node["tourism"="hotel"]["name"~"^${q.replace(/"/g, '\\"')}",i];
      way["tourism"="hotel"]["name"~"^${q.replace(/"/g, '\\"')}",i];
      relation["tourism"="hotel"]["name"~"^${q.replace(/"/g, '\\"')}",i];
    );
    out tags center 10;
  `;
  const r = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: query,
    timeout: 10000,
  }).catch(() => null);
  if (!r || !r.ok) return [];
  const j = await r.json().catch(() => ({}));
  const arr = Array.isArray(j?.elements) ? j.elements : [];
  return arr
    .map((el) => {
      const t = el.tags || {};
      return {
        name: t.name || "",
        city: t["addr:city"] || "",
        country: t["addr:country"] || "",
      };
    })
    .filter((x) => x.name);
}

router.get("/api/ext/hotels", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json([]);
    const now = Date.now();

    const cached = cache.get(q);
    if (cached && now - cached.t < TTL) return res.json(cached.data);

    let list = await geonamesHotels(q);
    if (!list.length) list = await overpassHotels(q);

    // нормализуем и уникализируем
    const seen = new Set();
    const data = [];
    for (const h of list) {
      const key = `${h.name}|${h.city}|${h.country}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      data.push(h);
      if (data.length >= 10) break;
    }

    cache.set(q, { t: now, data });
    res.json(data);
  } catch (e) {
    console.error("ext/hotels error:", e);
    res.json([]);
  }
});

export default router;
