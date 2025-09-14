// backend/controllers/hotelController.js
/* eslint-disable no-console */
const axios = require("axios");

// ---------------- PG helper ----------------
const { Pool } = require("pg");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
});
const db = { query: (q, p) => pool.query(q, p) };

// ---------------- In-memory cache + utils ----------------
const cache = new Map();
const TTL_MS = 60 * 60 * 1000; // 1 час

function memoKey(p) {
  try { return JSON.stringify(p); } catch { return String(p); }
}

function getCached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expireAt) { cache.delete(key); return null; }
  return hit.data;
}
function setCached(key, data) {
  cache.set(key, { data, expireAt: Date.now() + TTL_MS });
  return data;
}

/** Убираем дубликаты по (name + city), регистронезависимо */
function dedup(arr = []) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = [
      String(x.name || x.label || "").trim().toLowerCase(),
      String(x.city || x.city_local || x.city_en || "").trim().toLowerCase(),
    ].join("|");
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

// --------------- Нормализация query (name|query|q и т.д.) ---------------
function normalizeHotelSearchQuery(q = {}) {
  const firstNonEmpty = (...vals) => {
    for (const v of vals) {
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number") return String(v);
    }
    return "";
  };
  const name = firstNonEmpty(q.name, q.query, q.q);
  const city = firstNonEmpty(q.city, q.location, q.loc, q.town);

  const pageRaw  = Number(firstNonEmpty(q.page, q.p)) || 1;
  const limitRaw = Number(firstNonEmpty(q.limit, q.l)) || 20;
  const page  = Math.max(1, pageRaw);
  const limit = Math.min(50, Math.max(1, limitRaw));
  return { name, city, page, limit };
}

// --------------- Опциональный внешний поиск (можно расширить) ---------------
async function fetchExternalHotels(name = "", city = "") {
  // При необходимости сюда можно добавить реальные источники.
  // Оставляем пустым, чтобы ничего не ломать.
  return [];
}
async function fetchExternalHotelsCached(name = "", city = "") {
  const key = memoKey({ kind: "external_hotel_search", name, city });
  const hit = getCached(key);
  if (hit) return hit;
  const data = await fetchExternalHotels(name, city);
  return setCached(key, data);
}

// ================= SEARCH =================
// ----------------- SEARCH: БД + GeoNames (с fallback) -----------------
async function searchHotels(req, res) {
  const pick = (obj, ...keys) => {
    for (const k of keys) {
      const v = obj?.[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number") return String(v);
    }
    return "";
  };

  const name    = pick(req.query, "name", "query", "q");
  const city    = pick(req.query, "city", "location", "loc", "town");
  const country = pick(req.query, "country", "countryCode", "cc"); // ISO2, если пришлют
  const page    = Math.max(1, parseInt(pick(req.query, "page", "p") || "1", 10));
  const limit   = Math.min(50, Math.max(1, parseInt(pick(req.query, "limit", "l") || "20", 10)));
  const langHdr = (req.headers["accept-language"] || "").slice(0,2).toLowerCase();
  const lang    = ["ru","uz","en"].includes(pick(req.query,"lang") || langHdr) ? (pick(req.query,"lang") || langHdr) : "en";

  if ((name || "").length < 2 && (city || "").length < 2) return res.json([]);

  const dedup = (arr) => {
    const seen = new Set();
    const out = [];
    for (const x of arr) {
      const key = (String(x.name||"").toLowerCase()+"|"+String(x.city||"").toLowerCase());
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(x);
    }
    return out;
  };

  try {
    // 1) Наши сохранённые отели
    let idx = 1, where = [], params = [];
    if ((name || "").length >= 2) { where.push(`(name ILIKE $${idx} OR COALESCE(city, location, '') ILIKE $${idx})`); params.push(`%${name}%`); idx++; }
    if ((city || "").length >= 2) { where.push(`COALESCE(city, location, '') ILIKE $${idx}`); params.push(`%${city}%`); idx++; }

    const sql = `
      SELECT id, name, COALESCE(city, location) AS city, country
        FROM hotels
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY name
       LIMIT $${idx}
    `;
    params.push(limit);

    const ownRows = await db.query(sql, params);
    const own = (ownRows.rows || []).map(r => ({
      id: r.id,
      name: r.name,
      city: r.city || null,
      country: r.country || null,
      label: r.name,
      city_local: r.city || null,
      city_en: r.city || null,
      provider: "local",
    }));

    // 2) GeoNames (если настроен логин)
    const GEO_USER = process.env.GEONAMES_USERNAME || process.env.VITE_GEONAMES_USERNAME;
    let geo = [];
    if (GEO_USER && (name || city)) {
      const base = {
        username: GEO_USER,
        maxRows: Math.min(20, limit),
        style: "FULL",
        orderby: "relevance",
        lang,
      };
      const qStr = (city ? `${name || ""} ${city}` : (name || "")).trim();

      const run = async (extra) => {
        const { data } = await axios.get("https://secure.geonames.org/searchJSON", {
          params: { ...base, ...extra },
          timeout: 7000,
        });
        return Array.isArray(data?.geonames) ? data.geonames : [];
      };

      try {
        // A) строго: только отели
        let arr = await run({
          featureClass: "S",
          featureCode: "HTL",
          name_startsWith: name || undefined,
          q: qStr || undefined,
          country: country || undefined,
        });

        // B) fallback: общий поиск без фильтров по типу
        if (!arr.length) {
          arr = await run({
            q: qStr || name,
            country: country || undefined,
          });
        }

        geo = arr.map(g => ({
          id: g.geonameId,
          name: g.name || g.toponymName || g.asciiName,
          city: g.adminName2 || g.adminName3 || g.adminName1 || g.adminName4 || null,
          country: g.countryName || g.countryCode || null,
          label: g.name || g.toponymName || g.asciiName,
          city_local: g.adminName2 || g.adminName3 || g.adminName1 || null,
          city_en: g.adminName2 || g.adminName3 || g.adminName1 || null,
          provider: "geonames",
        }));
      } catch (e) {
        console.warn("GeoNames search error:", e?.response?.status || e?.message || e);
      }
    }

    const out = dedup([...own, ...geo]).slice(0, limit);
    return res.json(out);
  } catch (e) {
    console.error("hotels.search error", e);
    return res.status(500).json([]);
  }
}



// ================= CREATE =================
async function createHotel(req, res) {
  try {
    const p = req.body || {};
    const now = new Date();

    // --- Пытаемся вставить в «новую» расширенную схему
    try {
      const sql = `
        INSERT INTO hotels
          (name, country, city, address, currency,
           rooms, extra_bed_price, taxes, amenities, services, images,
           created_at, updated_at)
        VALUES
          ($1,$2,$3,$4,$5,
           $6,$7,$8,$9,$10,$11,
           $12,$12)
        RETURNING id
      `;
      const params = [
        (p.name || "").trim(),
        p.country || null,
        p.city || null,
        p.address || null,
        p.currency || "UZS",
        JSON.stringify(p.rooms || []),
        p.extraBedPrice ?? null,
        JSON.stringify(p.taxes ?? null),
        Array.isArray(p.amenities) ? p.amenities : [],
        Array.isArray(p.services) ? p.services : [],
        JSON.stringify(p.images || []),
        now,
      ];
      const { rows } = await db.query(sql, params);
      return res.json({ id: rows[0].id });
    } catch (err) {
      // --- Если колонок нет (старая схема) — мягкий fallback
      const sqlFallback = `
        INSERT INTO hotels (name, location, stars, created_at)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `;
      const paramsFallback = [
        (p.name || "").trim(),
        p.city || p.address || null,
        null,
        now,
      ];
      const { rows } = await db.query(sqlFallback, paramsFallback);
      return res.json({ id: rows[0].id, _fallback: true });
    }
  } catch (e) {
    console.error("hotels.create error:", e);
    return res.status(500).json({ error: "create_failed" });
  }
}

// ================= GET ONE =================
async function getHotel(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "bad_id" });
  try {
    const { rows } = await db.query(`SELECT * FROM hotels WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "not_found" });
    return res.json(rows[0]);
  } catch (e) {
    console.error("hotels.get error:", e);
    return res.status(500).json({ error: "read_failed" });
  }
}

// ================= LIST (простая пагинация) =================
async function listHotels(req, res) {
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "20", 10)));
  const offset = (page - 1) * limit;

  try {
    // Не делаем SELECT по колонкам, которых может не быть
    const { rows } = await db.query(
      `SELECT id,
              name,
              COALESCE(city, location) AS city,
              created_at
         FROM hotels
        ORDER BY id DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return res.json({ items: rows, page, limit });
  } catch (e) {
    console.error("hotels.list error:", e);
    return res.status(500).json({ error: "list_failed" });
  }
}

module.exports = {
  searchHotels,
  createHotel,
  getHotel,
  listHotels,
};
