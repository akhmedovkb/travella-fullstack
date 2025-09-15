//backend/controllers/hotelsController.js

/* eslint-disable no-console */
const axios = require("axios");
const { Pool } = require("pg");
const monitor = require("../utils/apiMonitor"); // <── NEW

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
});
const db = { query: (q, p) => pool.query(q, p) };

// ───────────────── cache ─────────────────
const cache = new Map();
const TTL_MS = 60 * 60 * 1000;
const memoKey = (p) => { try { return JSON.stringify(p); } catch { return String(p); } };
const getCached = (k) => {
  const hit = cache.get(k);
  if (!hit) return null;
  if (Date.now() > hit.expireAt) { cache.delete(k); return null; }
  return hit.data;
};
const setCached = (k, data) => { cache.set(k, { data, expireAt: Date.now() + TTL_MS }); return data; };

const first = (...vals) => {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return "";
};

// ─────────────── SEARCH ───────────────
async function searchHotels(req, res) {
  const name    = first(req.query.name,    req.query.query,  req.query.q);
  const city    = first(req.query.city,    req.query.location, req.query.loc, req.query.town);
  const country = first(req.query.country, req.query.countryCode, req.query.cc);
  const limit   = Math.min(50, Math.max(1, parseInt(first(req.query.limit, req.query.l) || "50", 10)));
  const langHdr = (req.headers["accept-language"] || "").slice(0, 2).toLowerCase();
  const langReq = (first(req.query.lang) || langHdr);
  const lang    = ["ru","uz","en"].includes(langReq) ? langReq : "en";

  // Если нет осмысленного ввода — отдаём локальные записи списком
  if ((name || "").length < 2 && (city || "").length < 2) {
    try {
      const { rows } = await db.query(
        `SELECT id, name, COALESCE(city, location) AS city, country
           FROM hotels
          ORDER BY name
          LIMIT $1`, [limit]
      );
      return res.json((rows || []).map(r => ({
        id: r.id, name: r.name, city: r.city || null, country: r.country || null,
        label: r.name, city_local: r.city || null, city_en: r.city || null, provider: "local",
      })));
    } catch {
      return res.json([]);
    }
  }

  try {
    // 1) Локальная БД
    let idx=1, where=[], params=[];
    if ((name||"").length>=2){ where.push(`(name ILIKE $${idx} OR COALESCE(city,location,'') ILIKE $${idx})`); params.push(`%${name}%`); idx++; }
    if ((city||"").length>=2){ where.push(`COALESCE(city,location,'') ILIKE $${idx}`); params.push(`%${city}%`); idx++; }
    if ((country||"").length>=2){ where.push(`COALESCE(country,'') ILIKE $${idx}`); params.push(`%${country}%`); idx++; }

    const ownSql = `
      SELECT id, name, COALESCE(city, location) AS city, country
        FROM hotels
       ${where.length ? "WHERE "+where.join(" AND ") : ""}
       ORDER BY name
       LIMIT $${idx}`;
    params.push(limit);
    const ownRows = await db.query(ownSql, params);
    const own = (ownRows.rows||[]).map(r => ({
      id: r.id, name: r.name,
      city: r.city || null, country: r.country || null,
      label: r.name, city_local: r.city || null, city_en: r.city || null,
      provider: "local",
    }));

    // 2) GeoNames
    const GEO_USER = process.env.GEONAMES_USERNAME || process.env.VITE_GEONAMES_USERNAME;
    let geo = [];
    if (!GEO_USER) {
      console.warn("[hotels.search] GeoNames username is not set -> skip external search");
      monitor.record("geonames", { ok: false, status: 0, message: "username_not_set" }); // <── log
    } else if (name || city) {
      const base = { username: GEO_USER, maxRows: Math.min(20, limit), style: "FULL", orderby: "relevance", lang };
      const qStr = (city ? `${name || ""} ${city}` : (name || "")).trim();
      const run = async (extra) => {
        const res = await axios.get("https://secure.geonames.org/searchJSON", { params: { ...base, ...extra }, timeout: 7000 });
        return res;
      };
      try {
        let res = await run({ featureClass: "S", featureCode: "HTL", name_startsWith: name || undefined, q: qStr || undefined, country: country || undefined });
        let arr = Array.isArray(res?.data?.geonames) ? res.data.geonames : [];
        // логируем удачный вызов
        monitor.record("geonames", { ok: true, status: res?.status || 200, message: `items=${arr.length}` });

        if (!arr.length) {
          res = await run({ q: qStr || name, country: country || undefined, fuzzy: 1 });
          arr = Array.isArray(res?.data?.geonames) ? res.data.geonames : [];
          monitor.record("geonames", { ok: true, status: res?.status || 200, message: `fallback.items=${arr.length}` });
        }
        if (!arr.length && name) {
          res = await run({ name_startsWith: name, fuzzy: 1, country: country || undefined });
          arr = Array.isArray(res?.data?.geonames) ? res.data.geonames : [];
          monitor.record("geonames", { ok: true, status: res?.status || 200, message: `startsWith.items=${arr.length}` });
        }

        geo = (arr || []).map(g => ({
          id: g.geonameId,
          name: g.name || g.toponymName || g.asciiName,
          city: g.adminName2 || g.adminName3 || g.adminName1 || null,
          country: g.countryName || g.countryCode || null,
          label: g.name || g.toponymName || g.asciiName,
          city_local: g.adminName2 || g.adminName3 || g.adminName1 || null,
          city_en: g.adminName2 || g.adminName3 || g.adminName1 || null,
          provider: "geonames",
        }));
      } catch (e) {
        const status = e?.response?.status ?? null;
        const msg =
          e?.response?.data?.status?.message ||
          e?.response?.data?.message ||
          e?.message || "geonames_error";
        console.warn("[hotels.search] GeoNames error:", status, msg);
        monitor.record("geonames", { ok: false, status, message: String(msg) }); // <── log error
      }
    }

    const out = [...own, ...geo];
    // убираем дубль по (name|city)
    const seen = new Set(); const deduped = [];
    for (const x of out) {
      const k = (String(x.name||"").toLowerCase()+"|"+String(x.city||"").toLowerCase());
      if (seen.has(k)) continue; seen.add(k); deduped.push(x);
    }
    return res.json(deduped.slice(0, limit));
  } catch (e) {
    console.error("hotels.search error", e);
    return res.status(500).json([]);
  }
}

// ─────────────── CREATE ───────────────
async function createHotel(req, res) {
  try {
    const p = req.body || {};
    const now = new Date();
    try {
      const sql = `
        INSERT INTO hotels
          (name, country, city, address, currency,
           rooms,            extra_bed_price, taxes,           amenities,        services,        images,
           created_at, updated_at)
        VALUES
          ($1,   $2,      $3,   $4,     $5,
           $6::jsonb,     $7::numeric,  $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb,
           $12,       $12)
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
        JSON.stringify(p.taxes ?? {}),
        JSON.stringify(Array.isArray(p.amenities) ? p.amenities : []),
        JSON.stringify(Array.isArray(p.services) ? p.services : []),
        JSON.stringify(p.images || []),
        now,
      ];
      const { rows } = await db.query(sql, params);
      return res.json({ id: rows[0].id });
    } catch (err) {
      console.warn("[hotels.create] legacy fallback:", err?.message);
      const sqlFallback = `
        INSERT INTO hotels (name, location, created_at)
        VALUES ($1, $2, $3)
        RETURNING id
      `;
      const paramsFallback = [
        (p.name || "").trim(),
        p.city || p.address || null,
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

// ─────────────── READ ONE / LIST ───────────────
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

async function listHotels(req, res) {
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "20", 10)));
  const offset = (page - 1) * limit;

  try {
    const { rows } = await db.query(
      `SELECT id, name, COALESCE(city, location) AS city, created_at
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

module.exports = { searchHotels, createHotel, getHotel, listHotels };
