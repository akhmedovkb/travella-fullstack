// backend/controllers/hotelsController.js

/* eslint-disable no-console */
const axios = require("axios");
const { Pool } = require("pg");

// ─── Мягкий фолбек для мониторинга (если utils/apiMonitor отсутствует) ───
let monitor = { record: (...args) => console.log("[monitor]", ...args) };
try {
  // ожидается интерфейс: monitor.record(source, { ok, status, message })
  // если файл есть — используем реальный
  // eslint-disable-next-line global-require, import/no-unresolved
  monitor = require("../utils/apiMonitor");
} catch (_e) {
  console.warn("[hotelsController] utils/apiMonitor not found — using console fallback");
}

// ─── DB ───
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
});
const db = { query: (q, p) => pool.query(q, p) };

// ───────────────── cache (зарезервировано под внешние вызовы) ─────────────────
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

// ─── helpers ───
const first = (...vals) => {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return "";
};

// проверяем, какие колонки реально есть в таблице
async function tableHasColumns(table, cols = []) {
  const q = await db.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_name = $1
        AND column_name = ANY($2::text[])`,
    [table, cols]
  );
  const set = new Set(q.rows.map((r) => r.column_name));
  return cols.reduce((acc, c) => ((acc[c] = set.has(c)), acc), {});
}

// ─────────────── SEARCH ───────────────
// GET /api/hotels/search?name=&city=&country=&limit=&lang=&ext=0
// ext=0|false|off|local  → только локальная таблица (без GeoNames)
async function searchHotels(req, res) {
  const name    = first(req.query.name,    req.query.query,  req.query.q);
  const city    = first(req.query.city,    req.query.location, req.query.loc, req.query.town);
  const country = first(req.query.country, req.query.countryCode, req.query.cc);
  const limit   = Math.min(50, Math.max(1, parseInt(first(req.query.limit, req.query.l) || "50", 10)));
  const langHdr = (req.headers["accept-language"] || "").slice(0, 2).toLowerCase();
  const langReq = (first(req.query.lang) || langHdr);
  const lang    = ["ru","uz","en"].includes(langReq) ? langReq : "en";

  // флаг внешних подсказок (по умолчанию ВКЛ)
  const externalParam = first(
    req.query.ext,
    req.query.external,
    req.query.geo,
    req.query.geonames,
    req.query.source
  );
  const useExternal = !/^(0|no|false|off|local|none)$/i.test(String(externalParam || ""));

  // Если нет осмысленного ввода — отдаём локальные записи списком
  if ((name || "").length < 2 && (city || "").length < 2) {
    try {
      const { rows } = await db.query(
        `SELECT id, name, COALESCE(city, location) AS city, country
           FROM hotels
          ORDER BY name
          LIMIT $1`,
        [limit]
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
    let idx = 1; const where = []; const params = [];
    if ((name || "").length >= 2) {
      where.push(`(name ILIKE $${idx} OR COALESCE(city,location,'') ILIKE $${idx})`);
      params.push(`%${name}%`); idx++;
    }
    if ((city || "").length >= 2) {
      where.push(`COALESCE(city,location,'') ILIKE $${idx}`);
      params.push(`%${city}%`); idx++;
    }
    if ((country || "").length >= 2) {
      where.push(`COALESCE(country,'') ILIKE $${idx}`);
      params.push(`%${country}%`); idx++;
    }

    const ownSql = `
      SELECT id, name, COALESCE(city, location) AS city, country
        FROM hotels
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY name
       LIMIT $${idx}`;
    params.push(limit);

    const ownRows = await db.query(ownSql, params);
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

    // 2) GeoNames (если разрешено useExternal === true)
    const GEO_USER = process.env.GEONAMES_USERNAME || process.env.VITE_GEONAMES_USERNAME;
    let geo = [];

    if (useExternal && (name || city)) {
      if (!GEO_USER) {
        console.warn("[hotels.search] GeoNames username is not set -> skip external search");
        monitor.record("geonames", { ok: false, status: 0, message: "username_not_set" });
      } else {
        const base = { username: GEO_USER, maxRows: Math.min(20, limit), style: "FULL", orderby: "relevance", lang };
        const qStr = (city ? `${name || ""} ${city}` : (name || "")).trim();
        const run = async (extra) =>
          axios.get("https://secure.geonames.org/searchJSON", { params: { ...base, ...extra }, timeout: 7000 });

        try {
          let resGeo = await run({
            featureClass: "S",
            featureCode: "HTL",
            name_startsWith: name || undefined,
            q: qStr || undefined,
            country: country || undefined,
          });
          let arr = Array.isArray(resGeo?.data?.geonames) ? resGeo.data.geonames : [];
          monitor.record("geonames", { ok: true, status: resGeo?.status || 200, message: `items=${arr.length}` });

          if (!arr.length) {
            resGeo = await run({ q: qStr || name, country: country || undefined, fuzzy: 1 });
            arr = Array.isArray(resGeo?.data?.geonames) ? resGeo.data.geonames : [];
            monitor.record("geonames", { ok: true, status: resGeo?.status || 200, message: `fallback.items=${arr.length}` });
          }
          if (!arr.length && name) {
            resGeo = await run({ name_startsWith: name, fuzzy: 1, country: country || undefined });
            arr = Array.isArray(resGeo?.data?.geonames) ? resGeo.data.geonames : [];
            monitor.record("geonames", { ok: true, status: resGeo?.status || 200, message: `startsWith.items=${arr.length}` });
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
            e?.message ||
            "geonames_error";
          console.warn("[hotels.search] GeoNames error:", status, msg);
          monitor.record("geonames", { ok: false, status, message: String(msg) });
        }
      }
    }

    // merge + дедуп по (name|city)
    const out = [...own, ...geo];
    const seen = new Set(); const deduped = [];
    for (const x of out) {
      const k = (String(x.name || "").toLowerCase() + "|" + String(x.city || "").toLowerCase());
      if (seen.has(k)) continue;
      seen.add(k);
      deduped.push(x);
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
      // динамически учитываем только реально существующие колонки
      const support = await tableHasColumns("hotels", [
        "address", "currency", "rooms", "extra_bed_price", "taxes",
        "amenities", "services", "images", "stars", "contact"
      ]);

      const cols = ["name", "country", "city"];
      const vals = [(p.name || "").trim(), p.country || null, p.city || null];

      if (support.address)         { cols.push("address");          vals.push(p.address || null); }
      if (support.currency)        { cols.push("currency");         vals.push(p.currency || "UZS"); }
      if (support.rooms)           { cols.push("rooms");            vals.push(JSON.stringify(p.rooms || [])); }
      if (support.extra_bed_price) { cols.push("extra_bed_price");  vals.push(p.extraBedPrice ?? null); }
      if (support.taxes)           { cols.push("taxes");            vals.push(JSON.stringify(p.taxes ?? {})); }
      if (support.amenities)       { cols.push("amenities");        vals.push(JSON.stringify(Array.isArray(p.amenities) ? p.amenities : [])); }
      if (support.services)        { cols.push("services");         vals.push(JSON.stringify(Array.isArray(p.services) ? p.services : [])); }
      if (support.images)          { cols.push("images");           vals.push(JSON.stringify(p.images || [])); }
      if (support.stars)           { cols.push("stars");            vals.push(p.stars ?? null); }
      if (support.contact)         { cols.push("contact");          vals.push(p.contact ?? null); }

      cols.push("created_at", "updated_at");
      vals.push(now, now);

      const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
      const sql = `INSERT INTO hotels (${cols.join(",")}) VALUES (${placeholders}) RETURNING id`;

      const { rows } = await db.query(sql, vals);
      return res.json({ id: rows[0].id });
    } catch (err) {
      // legacy-резерв на очень старых БД
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

// ─────────────── READ ONE ───────────────
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

// ─────────────── LIST ───────────────
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

// ─────────────── UPDATE ───────────────
async function updateHotel(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "bad_id" });

  try {
    const p = req.body || {};
    const now = new Date();

    try {
      const support = await tableHasColumns("hotels", [
        "address","currency","rooms","extra_bed_price","taxes",
        "amenities","services","images","stars","contact"
      ]);

      const sets = ["name=$1", "country=$2", "city=$3"];
      const params = [(p.name || "").trim(), p.country || null, p.city || null];
      let i = params.length;

      if (support.address)         { sets.push(`address=$${++i}`);         params.push(p.address || null); }
      if (support.currency)        { sets.push(`currency=$${++i}`);        params.push(p.currency || "UZS"); }
      if (support.rooms)           { sets.push(`rooms=$${++i}::jsonb`);    params.push(JSON.stringify(p.rooms || [])); }
      if (support.extra_bed_price) { sets.push(`extra_bed_price=$${++i}`); params.push(p.extraBedPrice ?? null); }
      if (support.taxes)           { sets.push(`taxes=$${++i}::jsonb`);    params.push(JSON.stringify(p.taxes ?? {})); }
      if (support.amenities)       { sets.push(`amenities=$${++i}::jsonb`);params.push(JSON.stringify(Array.isArray(p.amenities) ? p.amenities : [])); }
      if (support.services)        { sets.push(`services=$${++i}::jsonb`); params.push(JSON.stringify(Array.isArray(p.services) ? p.services : [])); }
      if (support.images)          { sets.push(`images=$${++i}::jsonb`);   params.push(JSON.stringify(p.images || [])); }
      if (support.stars)           { sets.push(`stars=$${++i}`);           params.push(p.stars ?? null); }
      if (support.contact)         { sets.push(`contact=$${++i}`);         params.push(p.contact ?? null); }

      sets.push(`updated_at=$${++i}`); params.push(now);

      const whereIndex = i + 1; // следующий параметр — это id
      params.push(id);

      const sql = `UPDATE hotels SET ${sets.join(", ")} WHERE id=$${whereIndex} RETURNING id`;
      const q = await db.query(sql, params);
      if (!q.rows.length) return res.status(404).json({ error: "not_found" });
      return res.json({ id });
    } catch (err) {
      // legacy fallback — если нет новых колонок
      console.warn("[hotels.update] legacy fallback:", err?.message);
      const sqlFallback = `
        UPDATE hotels
           SET name=$1, location=$2, updated_at=$3
         WHERE id=$4
         RETURNING id
      `;
      const paramsFallback = [
        (p.name || "").trim(),
        p.city || p.address || null,
        now,
        id,
      ];
      const { rows } = await db.query(sqlFallback, paramsFallback);
      if (!rows.length) return res.status(404).json({ error: "not_found" });
      return res.json({ id, _fallback: true });
    }
  } catch (e) {
    console.error("hotels.update error:", e);
    return res.status(500).json({ error: "update_failed" });
  }
}

module.exports = { searchHotels, createHotel, getHotel, listHotels, updateHotel };
