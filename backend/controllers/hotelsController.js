//backend/controllers/hotelsController.js

/* eslint-disable no-console */
const axios = require("axios");
const crypto = require("crypto");
const { Pool } = require("pg");
const { uploadBufferToCloudinary } = require("../utils/cloudinary");

// /api/hotels/:id/brief
async function getHotelBrief(req, res) {
  const { id } = req.params;
  const q = `
    SELECT id, name, stars, city, country, currency, rooms
    FROM hotels
    WHERE id = $1
  `;
  const { rows } = await db.query(q, [id]);
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  const h = rows[0];
  // rooms уже содержит prices.low / prices.high / resident/nonResident / BB/HB/FB/AI/UAI
  res.json({
    id: h.id,
    name: h.name,
    stars: h.stars,
    city: h.city,
    country: h.country,
    currency: h.currency,
    rooms: h.rooms || [],
  });
};

// /api/hotels/by-city?city=Samarkand&stars=3
async function listHotelsByCity(req, res) {
  const city = (req.query.city || "").trim();
  if (!city) return res.status(400).json({ error: "city required" });

  const stars = Number(req.query.stars);
  const params = [city];
  let where = `LOWER(city) = LOWER($1)`;

  if (Number.isFinite(stars)) {
    params.push(stars);
    where += ` AND stars = $2`;
  }

  const sql = `
    SELECT id, name, stars, city, country, currency
      FROM hotels
     WHERE ${where}
     ORDER BY name ASC
  `;
  const { rows } = await db.query(sql, params);
  res.json(rows);
}

// GET /api/hotels/mine?q=&city=&page=&limit=
async function listMyHotels(req, res) {
  const providerId = Number(req?.user?.id);
  if (!Number.isFinite(providerId)) return res.status(401).json({ error: "auth_required" });

  const page  = Math.max(1, parseInt(req.query.page || "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "20", 10)));
  const offset = (page - 1) * limit;

  const qName = String(req.query.q || "").trim();
  const qCity = String(req.query.city || "").trim();

  const where = [`provider_id = $1`];
  const params = [providerId];
  let i = params.length;

  if (qName) { params.push(`%${qName}%`); where.push(`name ILIKE $${++i}`); }
  if (qCity) { params.push(`%${qCity}%`); where.push(`COALESCE(city,location,'') ILIKE $${++i}`); }

  try {
    const sql = `
      SELECT id, name, COALESCE(city, location) AS city, created_at
        FROM hotels
       WHERE ${where.join(" AND ")}
       ORDER BY id DESC
       LIMIT $${i + 1} OFFSET $${i + 2}
    `;
    params.push(limit, offset);

    const { rows } = await db.query(sql, params);

    // Подсчёт total (для пагинации, опционально)
    const { rows: cnt } = await db.query(
      `SELECT COUNT(*)::int AS c FROM hotels WHERE ${where.join(" AND ")}`,
      params.slice(0, i) // те же параметры без limit/offset
    );

    return res.json({ items: rows, page, limit, total: cnt[0]?.c ?? rows.length });
  } catch (e) {
    console.error("hotels.listMy error:", e);
    return res.status(500).json({ error: "list_failed" });
  }
}


// ─── мониторинг (фолбек в консоль) ───
let monitor = { record: (...args) => console.log("[monitor]", ...args) };
try {
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

// ─── кэш под внешние вызовы (резерв) ───
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
function parseIntSafe(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

// какие колонки реально есть
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
/* hotels */
function isAdminLike(u = {}) {
  const roles = []
    .concat(u.role || u.type || [])
    .concat(Array.isArray(u.roles) ? u.roles : [])
    .map(r => String(r).toLowerCase());
  const flag = u.is_admin === true || String(u.is_admin).toLowerCase() === "true";
  return flag || roles.includes("admin") || roles.includes("moderator");
}

async function assertCanTouchHotel(req, hotelId) {
  if (isAdminLike(req.user)) return;
  const meProviderId = Number(req?.user?.id);              // у провайдера это его provider_id
  if (!meProviderId) throw Object.assign(new Error("forbidden"), { status: 403 });
  const q = await db.query(`SELECT provider_id FROM hotels WHERE id=$1`, [hotelId]);
  const owner = q.rows?.[0]?.provider_id || null;
  if (!owner || owner !== meProviderId) {
    throw Object.assign(new Error("forbidden"), { status: 403 });
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * SEARCH (с опцией внешних подсказок)
 * GET /api/hotels/search?name=&city=&country=&limit=&lang=&ext=0
 * ext=0|false|off|local → только локальные
 * ──────────────────────────────────────────────────────────────────────────── */
async function searchHotels(req, res) {
  const name    = first(req.query.name,    req.query.query,  req.query.q);
  const city    = first(req.query.city,    req.query.location, req.query.loc, req.query.town);
  const country = first(req.query.country, req.query.countryCode, req.query.cc);
  const limit   = Math.min(50, Math.max(1, parseInt(first(req.query.limit, req.query.l) || "50", 10)));
  const langHdr = (req.headers["accept-language"] || "").slice(0, 2).toLowerCase();
  const langReq = (first(req.query.lang) || langHdr);
  const lang    = ["ru","uz","en"].includes(langReq) ? langReq : "en";

  const externalParam = first(
    req.query.ext, req.query.external, req.query.geo, req.query.geonames, req.query.source
  );
  const useExternal = !/^(0|no|false|off|local|none)$/i.test(String(externalParam || ""));

  // если пусто — покажем локальные записи
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
    // 1) локально
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
      id: r.id, name: r.name, city: r.city || null, country: r.country || null,
      label: r.name, city_local: r.city || null, city_en: r.city || null, provider: "local",
    }));

    // 2) GeoNames (если разрешено)
    const GEO_USER = process.env.GEONAMES_USERNAME || process.env.VITE_GEONAMES_USERNAME;
    let geo = [];
    if (useExternal && (name || city)) {
      if (!GEO_USER) {
        console.warn("[hotels.search] GeoNames username is not set -> skip");
        monitor.record("geonames", { ok: false, status: 0, message: "username_not_set" });
      } else {
        const base = { username: GEO_USER, maxRows: Math.min(20, limit), style: "FULL", orderby: "relevance", lang };
        const qStr = (city ? `${name || ""} ${city}` : (name || "")).trim();
        const run = (extra) => axios.get("https://secure.geonames.org/searchJSON", { params: { ...base, ...extra }, timeout: 7000 });

        try {
          let resGeo = await run({ featureClass: "S", featureCode: "HTL", name_startsWith: name || undefined, q: qStr || undefined, country: country || undefined });
          let arr = Array.isArray(resGeo?.data?.geonames) ? resGeo.data.geonames : [];
          monitor.record("geonames", { ok: true, status: resGeo?.status || 200, message: `items=${arr.length}` });

          if (!arr.length) { resGeo = await run({ q: qStr || name, country: country || undefined, fuzzy: 1 }); arr = Array.isArray(resGeo?.data?.geonames) ? resGeo.data.geonames : []; }
          if (!arr.length && name) { resGeo = await run({ name_startsWith: name, fuzzy: 1, country: country || undefined }); arr = Array.isArray(resGeo?.data?.geonames) ? resGeo.data.geonames : []; }

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
          const msg = e?.response?.data?.status?.message || e?.response?.data?.message || e?.message || "geonames_error";
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

/* ────────────────────────────────────────────────────────────────────────────
 * RANKED (ТОП/ПОПУЛЯРНЫЕ/НОВЫЕ)
 * GET /api/hotels/ranked?type=top|popular|new&limit=20
 * ──────────────────────────────────────────────────────────────────────────── */
async function listRankedHotels(req, res) {
  const type  = String((req.query.type || "top")).toLowerCase();   // top | popular | new
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "20", 10)));

  try {
    const cols = await tableHasColumns("hotels", [
      "rating_avg","rating","stars",
      "views","view_count","popularity","seen","hits",
      "city","location","country","created_at"
    ]);

    // выражения для score (универсально под наличие колонок)
    const scoreTopParts = [];
    if (cols.rating_avg) scoreTopParts.push("rating_avg::numeric");
    if (cols.rating)     scoreTopParts.push("rating::numeric");
    if (cols.stars)      scoreTopParts.push("stars::numeric");
    const topExpr = scoreTopParts.length ? `COALESCE(${scoreTopParts.join(",")}, 0)` : "0::numeric";

    const scorePopParts = [];
    if (cols.views)      scorePopParts.push("views::numeric");
    if (cols.view_count) scorePopParts.push("view_count::numeric");
    if (cols.popularity) scorePopParts.push("popularity::numeric");
    if (cols.seen)       scorePopParts.push("seen::numeric");
    if (cols.hits)       scorePopParts.push("hits::numeric");
    const popExpr = scorePopParts.length ? `COALESCE(${scorePopParts.join(",")}, 0)` : "0::numeric";

    // для «Новые» — сортируем по created_at (если есть), иначе по id
    let selectScore = topExpr;
    let orderBy = "score DESC NULLS LAST, id DESC";
    if (type === "popular") {
      selectScore = popExpr;
      orderBy = "score DESC NULLS LAST, id DESC";
    } else if (type === "new") {
      selectScore = cols.created_at ? "EXTRACT(EPOCH FROM created_at)" : "id::numeric";
      orderBy = cols.created_at ? "created_at DESC NULLS LAST, id DESC" : "id DESC";
    }

    const cityExpr = `COALESCE(${cols.city ? "city" : "NULL"}, ${cols.location ? "location" : "NULL"})`;
    const countryExpr = cols.country ? "country" : "NULL";
    const createdExpr = cols.created_at ? "created_at" : "NULL::timestamp";

    const sql = `
      SELECT id, name,
             ${cityExpr}    AS city,
             ${countryExpr} AS country,
             ${createdExpr} AS created_at,
             ${selectScore} AS score
        FROM hotels
       ORDER BY ${orderBy}
       LIMIT $1
    `;
    const q = await db.query(sql, [limit]);
    return res.json(q.rows || []);
  } catch (e) {
    console.error("hotels.ranked error:", e);
    return res.status(500).json([]);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * CREATE
 * ──────────────────────────────────────────────────────────────────────────── */
async function createHotel(req, res) {
  try {
    const p = req.body || {};
    const now = new Date();

    try {
      const support = await tableHasColumns("hotels", [
        "address","currency","rooms","extra_bed_price","taxes",
        "amenities","services","images","stars","contact","country","city","location","provider_id"
      ]);

      const cols = ["name"];
      const vals = [(p.name || "").trim()];

      if (support.country)  { cols.push("country");  vals.push(p.country || null); }
      if (support.city)     { cols.push("city");     vals.push(p.city || null); }
      else if (support.location && p.city) { cols.push("location"); vals.push(p.city); }

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
      // смена владельца — только для админа (если колонка есть)
      // владелец: текущий провайдер, а админ может явно задать p.provider_id
      if (support.provider_id) {
        const provId = isAdminLike(req.user)
          ? (parseIntSafe(p.provider_id) ?? parseIntSafe(req.user?.id) ?? null)
          : (parseIntSafe(req.user?.id) ?? null);
        cols.push("provider_id");
        vals.push(provId);
      }
      cols.push("created_at","updated_at");
      vals.push(now, now);

      const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
      const sql = `INSERT INTO hotels (${cols.join(",")}) VALUES (${placeholders}) RETURNING id`;

      const { rows } = await db.query(sql, vals);
      return res.json({ id: rows[0].id });
    } catch (err) {
      console.warn("[hotels.create] legacy fallback:", err?.message);
      const sqlFallback = `
        INSERT INTO hotels (name, location, created_at)
        VALUES ($1, $2, $3) RETURNING id
      `;
      const paramsFallback = [(p.name || "").trim(), p.city || p.address || null, new Date()];
      const { rows } = await db.query(sqlFallback, paramsFallback);
      return res.json({ id: rows[0].id, _fallback: true });
    }
  } catch (e) {
    console.error("hotels.create error:", e);
    return res.status(500).json({ error: "create_failed" });
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * READ ONE (с auto-инкрементом просмотров, если колонка есть)
 * ──────────────────────────────────────────────────────────────────────────── */
async function getHotel(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "bad_id" });
  try {
    await assertCanTouchHotel(req, id);
    const { rows } = await db.query(`SELECT * FROM hotels WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "not_found" });

    tableHasColumns("hotels", ["views","view_count","popularity","seen","hits"]).then(async (c) => {
      try {
        if (c.views)            await db.query(`UPDATE hotels SET views = COALESCE(views,0)+1 WHERE id=$1`, [id]);
        else if (c.view_count)  await db.query(`UPDATE hotels SET view_count = COALESCE(view_count,0)+1 WHERE id=$1`, [id]);
        else if (c.popularity)  await db.query(`UPDATE hotels SET popularity = COALESCE(popularity,0)+1 WHERE id=$1`, [id]);
        else if (c.seen)        await db.query(`UPDATE hotels SET seen = COALESCE(seen,0)+1 WHERE id=$1`, [id]);
        else if (c.hits)        await db.query(`UPDATE hotels SET hits = COALESCE(hits,0)+1 WHERE id=$1`, [id]);
      } catch (_) {}
    });

    return res.json(rows[0]);
  } catch (e) {
    if (e && e.status === 403) {
      // правильный статус вместо 500
      return res.status(403).json({ error: "forbidden" });
    }
    console.error("hotels.get error:", e);
    return res.status(500).json({ error: "read_failed" });
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * LIST (админ/пагинация)
 * ──────────────────────────────────────────────────────────────────────────── */
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

/* ────────────────────────────────────────────────────────────────────────────
 * UPDATE (динамически по существующим колонкам)
 * ──────────────────────────────────────────────────────────────────────────── */
async function updateHotel(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "bad_id" });

  try {
    await assertCanTouchHotel(req, id);
    const p = req.body || {};
    const now = new Date();

    try {
      const support = await tableHasColumns("hotels", [
        "address","currency","rooms","extra_bed_price","taxes",
        "amenities","services","images","stars","contact","country","city","location","provider_id"
      ]);

      const sets = ["name=$1"];
      const params = [(p.name || "").trim()];
      let i = params.length;

      if (support.country)  { sets.push(`country=$${++i}`);  params.push(p.country || null); }
      if (support.city)     { sets.push(`city=$${++i}`);     params.push(p.city || null); }
      else if (support.location) { sets.push(`location=$${++i}`); params.push(p.city || p.address || null); }

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
      // смена владельца — только для админа
      if (support.provider_id && isAdminLike(req.user)) {
        if (Object.prototype.hasOwnProperty.call(p, "provider_id")) {
          sets.push(`provider_id=$${++i}`);
          const newOwner = Number.isFinite(Number(p.provider_id)) ? Number(p.provider_id) : null;
          params.push(newOwner);
        }
      }
      sets.push(`updated_at=$${++i}`); params.push(now);

      params.push(id);
      const sql = `UPDATE hotels SET ${sets.join(", ")} WHERE id=$${i + 1} RETURNING id`;
      const q = await db.query(sql, params);
      if (!q.rows.length) return res.status(404).json({ error: "not_found" });
      return res.json({ id });
    } catch (err) {
      console.warn("[hotels.update] legacy fallback:", err?.message);
      const sqlFallback = `
        UPDATE hotels
           SET name=$1, location=$2, updated_at=$3
         WHERE id=$4
         RETURNING id
      `;
      const paramsFallback = [(p.name || "").trim(), p.city || p.address || null, now, id];
      const { rows } = await db.query(sqlFallback, paramsFallback);
      if (!rows.length) return res.status(404).json({ error: "not_found" });
      return res.json({ id, _fallback: true });
    }
  } catch (e) {
    if (e && e.status === 403) return res.status(403).json({ error: "forbidden" });
    console.error("hotels.update error:", e);
    return res.status(500).json({ error: "update_failed" });
  }
}

/* ===================== INSPECTIONS + агрегаты + лайки ===================== */

// колонка hotels.attrs для агрегатов
async function ensureHotelsAttrsColumn() {
  await db.query(`ALTER TABLE hotels ADD COLUMN IF NOT EXISTS attrs JSONB DEFAULT '{}'::jsonb`);
}

// таблица инспекций + мягкие миграции
async function ensureInspectionsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS inspections (
      id          SERIAL PRIMARY KEY,
      hotel_id    INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
      author_name TEXT,
      author_provider_id INTEGER,
      review      TEXT,
      pros        TEXT,
      cons        TEXT,
      features    TEXT,
      media       JSONB,
      -- структурные поля для скорингов/фич
      scores      JSONB,
      amenities   JSONB,
      nearby      JSONB,
      likes       INTEGER DEFAULT 0,
      created_at  TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
    )
  `);
  await db.query(`ALTER TABLE inspections ADD COLUMN IF NOT EXISTS author_provider_id INTEGER`);
  await db.query(`ALTER TABLE inspections ADD COLUMN IF NOT EXISTS author_client_id INTEGER`);
  await db.query(`ALTER TABLE inspections ADD COLUMN IF NOT EXISTS author_type TEXT`);
  await db.query(`ALTER TABLE inspections ADD COLUMN IF NOT EXISTS title TEXT`);
  await db.query(`ALTER TABLE inspections ADD COLUMN IF NOT EXISTS visit_type TEXT`);
  await db.query(`ALTER TABLE inspections ADD COLUMN IF NOT EXISTS trip_type TEXT`);
  await db.query(`ALTER TABLE inspections ADD COLUMN IF NOT EXISTS travel_month INTEGER`);
  await db.query(`ALTER TABLE inspections ADD COLUMN IF NOT EXISTS recommendation_score INTEGER`);
  await db.query(`ALTER TABLE inspections ADD COLUMN IF NOT EXISTS scores JSONB`);
  await db.query(`ALTER TABLE inspections ADD COLUMN IF NOT EXISTS amenities JSONB`);
  await db.query(`ALTER TABLE inspections ADD COLUMN IF NOT EXISTS nearby JSONB`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_inspections_hotel ON inspections(hotel_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_inspections_author ON inspections(author_provider_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_inspections_client ON inspections(author_client_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_inspections_author_type ON inspections(author_type)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_inspections_travel_month ON inspections(travel_month)`);
  // уникальность: один провайдер — одна инспекция на отель. Клиентские обзоры не блокируем этим индексом.
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_inspections_hotel_author
      ON inspections(hotel_id, author_provider_id)
      WHERE author_provider_id IS NOT NULL
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS hotel_inspection_media (
      id SERIAL PRIMARY KEY,
      inspection_id INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
      media_type TEXT NOT NULL CHECK (media_type IN ('photo','video')),
      section_key TEXT NOT NULL,
      caption TEXT,
      tags JSONB DEFAULT '[]'::jsonb,
      url TEXT NOT NULL,
      public_id TEXT,
      thumbnail_url TEXT,
      width INTEGER,
      height INTEGER,
      duration_seconds INTEGER,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_hotel_inspection_media_inspection ON hotel_inspection_media(inspection_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_hotel_inspection_media_section ON hotel_inspection_media(section_key)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS hotel_inspection_audience (
      id SERIAL PRIMARY KEY,
      inspection_id INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
      audience_key TEXT NOT NULL,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_hotel_inspection_audience_inspection ON hotel_inspection_audience(inspection_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_hotel_inspection_audience_key ON hotel_inspection_audience(audience_key)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS hotel_inspection_cons (
      id SERIAL PRIMARY KEY,
      inspection_id INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
      con_key TEXT NOT NULL,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_hotel_inspection_cons_inspection ON hotel_inspection_cons(inspection_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_hotel_inspection_cons_key ON hotel_inspection_cons(con_key)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS hotel_inspection_comments (
      id SERIAL PRIMARY KEY,
      inspection_id INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
      author_type TEXT,
      author_id INTEGER,
      author_name TEXT,
      text TEXT NOT NULL,
      likes INTEGER DEFAULT 0,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
      deleted_at TIMESTAMP WITHOUT TIME ZONE
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_hotel_inspection_comments_inspection ON hotel_inspection_comments(inspection_id)`);
}

// таблица уникальных лайков (toggle)
async function ensureInspectionLikesTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS inspection_likes (
      id             SERIAL PRIMARY KEY,
      inspection_id  INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
      actor_type     TEXT,     -- 'provider' | 'client' | 'user' | NULL
      actor_id       INTEGER,  -- nullable
      fp             TEXT,     -- fingerprint для гостей
      created_at     TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
    )
  `);
  // уникальность для авторизованных
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS u_inspection_likes_actor
      ON inspection_likes(inspection_id, actor_type, actor_id)
      WHERE actor_id IS NOT NULL
  `);
  // уникальность для гостей по fingerprint
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS u_inspection_likes_fp
      ON inspection_likes(inspection_id, fp)
      WHERE fp IS NOT NULL
  `);
}

// actor из токена/заголовков (fallback для гостей: ip+ua)

const HOTEL_REVIEW_MEDIA_SECTIONS = new Set([
  "room",
  "food",
  "beach",
  "pool",
  "territory",
  "kids",
  "entertainment",
  "service",
  "location",
  "spa",
  "sport",
  "view",
  "warning",
]);

const HOTEL_REVIEW_AUDIENCE_KEYS = new Set([
  "youth",
  "families",
  "couples",
  "seniors",
  "business",
  "solo",
  "luxury",
  "budget",
  "quiet",
  "active",
]);

const HOTEL_REVIEW_CON_KEYS = new Set([
  "noise",
  "old_renovation",
  "weak_wifi",
  "queues",
  "few_sunbeds",
  "construction",
  "far_sea",
  "monotone_food",
  "small_beach",
  "crowded",
]);

function safeJson(v, fallback = null) {
  if (v == null || v === "") return fallback;
  if (typeof v === "object") return v;
  try { return JSON.parse(String(v)); } catch { return fallback; }
}

function normalizeKey(v, allowed, fallback = null) {
  const k = String(v || "").trim().toLowerCase();
  return allowed.has(k) ? k : fallback;
}

function normalizeStringArray(v, allowed = null, limit = 20) {
  const raw = Array.isArray(v) ? v : safeJson(v, []);
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const k = String(item || "").trim().toLowerCase();
    if (!k) continue;
    if (allowed && !allowed.has(k)) continue;
    if (!out.includes(k)) out.push(k);
    if (out.length >= limit) break;
  }
  return out;
}

function clampInt(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function inferUploadedMediaType(file = {}) {
  const m = String(file.mimetype || "").toLowerCase();
  if (m.startsWith("video/")) return "video";
  return "photo";
}

function buildUploadMeta(req) {
  const body = req.body || {};
  const raw = safeJson(body.mediaMeta || body.media_meta, []);
  return Array.isArray(raw) ? raw : [];
}

async function insertHotelInspectionRelations(client, inspectionId, { audienceKeys = [], conKeys = [], mediaRows = [] }) {
  for (const audienceKey of audienceKeys) {
    await client.query(
      `INSERT INTO hotel_inspection_audience (inspection_id, audience_key) VALUES ($1,$2)`,
      [inspectionId, audienceKey]
    );
  }

  for (const conKey of conKeys) {
    await client.query(
      `INSERT INTO hotel_inspection_cons (inspection_id, con_key) VALUES ($1,$2)`,
      [inspectionId, conKey]
    );
  }

  for (const m of mediaRows) {
    await client.query(
      `INSERT INTO hotel_inspection_media
         (inspection_id, media_type, section_key, caption, tags, url, public_id, thumbnail_url, width, height, duration_seconds, sort_order)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12)`,
      [
        inspectionId,
        m.media_type,
        m.section_key || "room",
        m.caption || null,
        JSON.stringify(Array.isArray(m.tags) ? m.tags : []),
        m.url,
        m.public_id || null,
        m.thumbnail_url || null,
        m.width || null,
        m.height || null,
        m.duration_seconds || null,
        Number.isFinite(Number(m.sort_order)) ? Number(m.sort_order) : 0,
      ]
    );
  }
}

function getActorFromReq(req) {
  const u = req.user || {};
  const role = (u.role || u.type || "").toString().toLowerCase();

  const providerId =
    parseIntSafe(u.provider_id) ??
    parseIntSafe(u.providerId) ??
    parseIntSafe(u.company_id) ??
    parseIntSafe(u.companyId) ??
    (role === "provider" ? parseIntSafe(u.id) : null);

  const clientId =
    parseIntSafe(u.client_id) ??
    parseIntSafe(u.clientId) ??
    (role === "client" ? parseIntSafe(u.id) : null);

  let actorType = null;
  let actorId = null;
  if (providerId) { actorType = "provider"; actorId = providerId; }
  else if (clientId) { actorType = "client"; actorId = clientId; }
  else if (parseIntSafe(u.id)) { actorType = "user"; actorId = parseIntSafe(u.id); }

  // fingerprint (если нет авторизации)
  let fp = (req.headers["x-client-fp"] || "").toString().trim() || null;
  if (!actorId) {
    const ip = (req.headers["x-forwarded-for"] || req.ip || "").toString();
    const ua = (req.headers["user-agent"] || "").toString();
    const raw = `${ip}|${ua}`;
    if (raw.trim()) fp = crypto.createHash("sha1").update(raw).digest("hex");
  }
  return { actorType, actorId, fp };
}

// пересчёт агрегатов по инспекциям → hotels.attrs.aggregated_from_inspections
async function ensureHotelsAggregates(hotelId) {
  await ensureHotelsAttrsColumn();

  const { rows } = await db.query(`
    WITH x AS (
      SELECT
        COUNT(*)                                     AS n,
        AVG( (scores->>'quiet_level')::numeric )     AS quiet_level,
        AVG( (scores->>'family_score')::numeric )    AS family_score,
        AVG( (scores->>'infra_score')::numeric )     AS infra_score,
        AVG( (scores->>'nightlife_score')::numeric ) AS nightlife_score,
        AVG( (scores->>'activity_score')::numeric )  AS activity_score,
        AVG( (scores->>'business_score')::numeric )  AS business_score,
        AVG( (scores->>'wellness_score')::numeric )  AS wellness_score,
        AVG( (scores->>'value_score')::numeric )     AS value_score,
        AVG( (scores->>'access_score')::numeric )    AS access_score,
        MIN( (nearby->>'metro_m')::numeric )         AS metro_m,
        MIN( (nearby->>'supermarket_m')::numeric )   AS supermarket_m,
        MIN( (nearby->>'pharmacy_m')::numeric )      AS pharmacy_m,
        MIN( (nearby->>'park_m')::numeric )          AS park_m
      FROM inspections
      WHERE hotel_id = $1
    ),
    am AS (
      SELECT jsonb_agg(DISTINCT a) AS amenities
      FROM (
        SELECT jsonb_array_elements(amenities) AS a
        FROM inspections
        WHERE hotel_id = $1 AND amenities IS NOT NULL
      ) z
    )
    SELECT
      x.n,
      jsonb_strip_nulls(
        jsonb_build_object(
          'scores', jsonb_strip_nulls(
            jsonb_build_object(
              'quiet_level',   x.quiet_level,
              'family_score',  x.family_score,
              'infra_score',   x.infra_score,
              'nightlife_score', x.nightlife_score,
              'activity_score',  x.activity_score,
              'business_score',  x.business_score,
              'wellness_score',  x.wellness_score,
              'value_score',     x.value_score,
              'access_score',    x.access_score
            )
          ),
          'nearby', jsonb_strip_nulls(
            jsonb_build_object(
              'metro_m',       x.metro_m,
              'supermarket_m', x.supermarket_m,
              'pharmacy_m',    x.pharmacy_m,
              'park_m',        x.park_m
            )
          ),
          'amenities', COALESCE(am.amenities, '[]'::jsonb)
        )
      ) AS attrs
    FROM x, am
  `, [hotelId]);

  const row = rows[0] || {};
  const attrs = row.attrs || {};
  const n = Number(row.n || 0);

  await db.query(
    `UPDATE hotels
       SET attrs = COALESCE(attrs,'{}'::jsonb) || jsonb_build_object('aggregated_from_inspections', $2),
           updated_at = NOW()
     WHERE id=$1`,
    [hotelId, { n, ...attrs }]
  );
}

// GET /api/hotels/:id/inspections?sort=top|new
async function listHotelInspections(req, res) {
  const hotelId = parseIntSafe(req.params.id);
  if (!hotelId) return res.status(400).json({ items: [] });

  try {
    await ensureInspectionsTable();
    await ensureInspectionLikesTable();

    const { actorType, actorId, fp } = getActorFromReq(req);
    const myProviderId = (actorType === "provider") ? actorId : null;
    const myClientId = (actorType === "client") ? actorId : null;

    const sort = String(req.query.sort || "top").toLowerCase();
    const baseOrder =
      sort === "new"
        ? `i.created_at DESC, i.id DESC`
        : `COALESCE(i.likes,0) DESC, i.created_at DESC`;

    const params = [hotelId];
    let idx = 1;

    let myOrder = ``;
    if (myProviderId != null) {
      params.push(myProviderId);
      const myProvIdx = ++idx;
      myOrder = `CASE WHEN i.author_provider_id = $${myProvIdx}::int THEN 0 ELSE 1 END, `;
    } else if (myClientId != null) {
      params.push(myClientId);
      const myClientIdx = ++idx;
      myOrder = `CASE WHEN i.author_client_id = $${myClientIdx}::int THEN 0 ELSE 1 END, `;
    }

    params.push(actorId);      const actorIdIdx   = ++idx;
    params.push(actorType);    const actorTypeIdx = ++idx;
    params.push(fp);           const fpIdx        = ++idx;

    const sql = `
      SELECT
        i.id, i.hotel_id, i.author_name, i.author_type, i.author_provider_id, i.author_client_id,
        i.title, i.visit_type, i.trip_type, i.travel_month, i.recommendation_score,
        i.review, i.pros, i.cons, i.features,
        i.media, i.scores, i.amenities, i.nearby,
        i.likes, i.created_at,
        COALESCE(media.media_items, '[]'::jsonb) AS section_media,
        COALESCE(aud.audience_keys, '[]'::jsonb) AS audience_keys,
        COALESCE(cns.con_keys, '[]'::jsonb) AS con_keys,
        (liked.id IS NOT NULL) AS liked_by_me
      FROM inspections i
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', m.id,
            'media_type', m.media_type,
            'section_key', m.section_key,
            'caption', m.caption,
            'tags', COALESCE(m.tags, '[]'::jsonb),
            'url', m.url,
            'public_id', m.public_id,
            'thumbnail_url', m.thumbnail_url,
            'width', m.width,
            'height', m.height,
            'duration_seconds', m.duration_seconds,
            'sort_order', m.sort_order
          ) ORDER BY m.section_key, m.sort_order, m.id
        ) AS media_items
        FROM hotel_inspection_media m
        WHERE m.inspection_id = i.id
      ) media ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(DISTINCT a.audience_key) AS audience_keys
        FROM hotel_inspection_audience a
        WHERE a.inspection_id = i.id
      ) aud ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(DISTINCT c.con_key) AS con_keys
        FROM hotel_inspection_cons c
        WHERE c.inspection_id = i.id
      ) cns ON true
      LEFT JOIN inspection_likes liked
        ON liked.inspection_id = i.id
       AND (
            ($${actorIdIdx}::int IS NOT NULL AND liked.actor_type = $${actorTypeIdx}::text AND liked.actor_id = $${actorIdIdx}::int)
            OR ($${fpIdx}::text IS NOT NULL AND liked.fp = $${fpIdx}::text)
       )
      WHERE i.hotel_id = $1
      ORDER BY ${myOrder}${baseOrder}
      LIMIT 200
    `;

    const { rows } = await db.query(sql, params);

    const items = (rows || []).map((r) => ({
      ...r,
      media: typeof r.media === "string"
        ? JSON.parse(r.media || "[]")
        : (Array.isArray(r.media) ? r.media : (r.media || [])),
      section_media: Array.isArray(r.section_media) ? r.section_media : (r.section_media || []),
      audience_keys: Array.isArray(r.audience_keys) ? r.audience_keys : (r.audience_keys || []),
      con_keys: Array.isArray(r.con_keys) ? r.con_keys : (r.con_keys || []),
      author_profile_url: r.author_provider_id ? `/profile/provider/${r.author_provider_id}` : null,
    }));

    res.json({ items });
  } catch (e) {
    console.error("listHotelInspections error", e);
    res.status(500).json({ items: [] });
  }
}

// POST /api/hotels/:id/inspections  (+ запрет повторной инспекции для провайдера)
async function createHotelInspection(req, res) {
  const hotelId = parseIntSafe(req.params.id);
  if (!hotelId) return res.status(400).json({ error: "bad_hotel_id" });

  const p = req.body || {};
  try {
    await ensureInspectionsTable();

    const u = req.user || {};
    const role = (u.role || u.type || "").toString().toLowerCase();

    const providerIdFromToken =
      parseIntSafe(u.provider_id) ??
      parseIntSafe(u.providerId) ??
      parseIntSafe(u.company_id) ??
      parseIntSafe(u.companyId) ??
      (role === "provider" ? parseIntSafe(u.id) : null);

    const clientIdFromToken =
      parseIntSafe(u.client_id) ??
      parseIntSafe(u.clientId) ??
      (role === "client" ? parseIntSafe(u.id) : null);

    const authorProviderId =
      parseIntSafe(p.author_provider_id) ??
      parseIntSafe(p.provider_id) ??
      parseIntSafe(p.providerId) ??
      providerIdFromToken ??
      null;

    const authorClientId =
      parseIntSafe(p.author_client_id) ??
      parseIntSafe(p.client_id) ??
      parseIntSafe(p.clientId) ??
      clientIdFromToken ??
      null;

    const authorType = authorProviderId ? "provider" : (authorClientId ? "client" : (role || "user"));

    if (!authorProviderId && !authorClientId && !isAdminLike(u)) {
      return res.status(403).json({ error: "auth_required" });
    }

    // запрет: один провайдер == одна инспекция на отель. Клиентские обзоры не блокируем.
    if (authorProviderId) {
      const dup = await db.query(
        `SELECT 1 FROM inspections WHERE hotel_id=$1 AND author_provider_id=$2 LIMIT 1`,
        [hotelId, authorProviderId]
      );
      if (dup.rowCount) {
        return res.status(409).json({ error: "already_inspected" });
      }
    }

    const nameFinal =
      first(p.author_name) ||
      first(u.company_name, u.provider_name, u.name, u.full_name, u.companyName, u.display_name) ||
      (authorType === "client" ? "клиент Travella" : "провайдер");

    const legacyMediaArr = Array.isArray(p.media) ? p.media.slice(0, 20) : safeJson(p.media, []);
    const scores    = (p.scores && typeof p.scores === "object") ? p.scores : safeJson(p.scores, null);
    const amenities = Array.isArray(p.amenities) ? p.amenities : safeJson(p.amenities, null);
    const nearby    = (p.nearby && typeof p.nearby === "object") ? p.nearby : safeJson(p.nearby, null);

    const audienceKeys = normalizeStringArray(p.audience_keys || p.audienceKeys, HOTEL_REVIEW_AUDIENCE_KEYS, 12);
    const conKeys = normalizeStringArray(p.con_keys || p.conKeys, HOTEL_REVIEW_CON_KEYS, 12);

    const travelMonth = clampInt(p.travel_month || p.travelMonth, 1, 12);
    const recommendationScore = clampInt(p.recommendation_score || p.recommendationScore, 1, 5);

    const mediaMeta = buildUploadMeta(req);
    const uploadFiles = Array.isArray(req.files) ? req.files : [];
    const mediaRows = [];

    for (let i = 0; i < uploadFiles.length; i += 1) {
      const file = uploadFiles[i];
      const meta = mediaMeta[i] || {};
      const sectionKey = normalizeKey(meta.section_key || meta.sectionKey || p.section_key, HOTEL_REVIEW_MEDIA_SECTIONS, "room");
      const tags = normalizeStringArray(meta.tags, null, 16);
      const uploaded = await uploadBufferToCloudinary(file, {
        public_prefix: `hotel-${hotelId}-${sectionKey}`,
      });
      mediaRows.push({
        media_type: inferUploadedMediaType(file),
        section_key: sectionKey,
        caption: first(meta.caption, meta.label),
        tags,
        url: uploaded.url,
        public_id: uploaded.public_id,
        thumbnail_url: uploaded.thumbnail_url,
        width: uploaded.width,
        height: uploaded.height,
        duration_seconds: uploaded.duration_seconds,
        sort_order: i,
      });
    }

    // Legacy URLs/dataURL are preserved in inspections.media for old UI compatibility.
    // If frontend sends structured URL media, also persist it in section table.
    const structuredUrlMedia = safeJson(p.section_media || p.sectionMedia, []);
    if (Array.isArray(structuredUrlMedia)) {
      for (let i = 0; i < structuredUrlMedia.length; i += 1) {
        const m = structuredUrlMedia[i] || {};
        const url = first(m.url, m.src);
        if (!url) continue;
        mediaRows.push({
          media_type: String(m.media_type || m.mediaType || "photo").toLowerCase() === "video" ? "video" : "photo",
          section_key: normalizeKey(m.section_key || m.sectionKey, HOTEL_REVIEW_MEDIA_SECTIONS, "room"),
          caption: first(m.caption, m.label),
          tags: normalizeStringArray(m.tags, null, 16),
          url,
          public_id: m.public_id || m.publicId || null,
          thumbnail_url: m.thumbnail_url || m.thumbnailUrl || url,
          sort_order: Number.isFinite(Number(m.sort_order)) ? Number(m.sort_order) : i,
        });
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `INSERT INTO inspections
           (hotel_id, author_name, author_type, author_provider_id, author_client_id,
            title, visit_type, trip_type, travel_month, recommendation_score,
            review, pros, cons, features,
            media, scores, amenities, nearby, likes)
         VALUES
           ($1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10,
            $11, $12, $13, $14,
            $15::jsonb, $16::jsonb, $17::jsonb, $18::jsonb, 0)
         RETURNING id`,
        [
          hotelId,
          nameFinal || null,
          authorType,
          authorProviderId,
          authorClientId,
          p.title || null,
          p.visit_type || p.visitType || null,
          p.trip_type || p.tripType || null,
          travelMonth,
          recommendationScore,
          p.review || null,
          p.pros || null,
          p.cons || null,
          p.features || null,
          JSON.stringify(Array.isArray(legacyMediaArr) ? legacyMediaArr.slice(0, 20) : []),
          scores ? JSON.stringify(scores) : null,
          amenities ? JSON.stringify(amenities) : null,
          nearby ? JSON.stringify(nearby) : null,
        ]
      );

      const inspectionId = rows[0].id;
      await insertHotelInspectionRelations(client, inspectionId, { audienceKeys, conKeys, mediaRows });
      await client.query("COMMIT");

      await ensureHotelsAggregates(hotelId);

      return res.json({ id: inspectionId, media: mediaRows });
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("createHotelInspection error", e);
    if (e?.code === "cloudinary_not_configured") {
      return res.status(500).json({ error: "cloudinary_not_configured" });
    }
    res.status(500).json({ error: "create_failed" });
  }
}

// POST /api/hotels/inspections/:id/like  (или /api/inspections/:id/like)
// Лайк уникален и работает как toggle. likes пересчитываем из таблицы лайков.
async function likeInspection(req, res) {
  const inspectionId = parseIntSafe(req.params.id);
  if (!inspectionId) return res.status(400).json({ error: "bad_id" });

  await ensureInspectionsTable();
  await ensureInspectionLikesTable();

  // идентифицируем «кто»
  const { actorType, actorId, fp } = getActorFromReq(req);

  // если ни актор, ни fp — не сможем обеспечить уникальность
  if (!actorId && !fp) {
    return res.status(401).json({ error: "auth_required" });
  }

  try {
    // проверяем, есть ли уже лайк
    const existing = await db.query(
      `SELECT id FROM inspection_likes
        WHERE inspection_id=$1
          AND (
                ($2::int IS NOT NULL AND actor_type=$3::text AND actor_id=$2::int)
                OR ($4::text IS NOT NULL AND fp=$4::text)
              )
        LIMIT 1`,
      [inspectionId, actorId, actorType, fp]
    );

    if (existing.rowCount) {
      // toggle off
      await db.query(`DELETE FROM inspection_likes WHERE id=$1`, [existing.rows[0].id]);
    } else {
      // toggle on
      await db.query(
        `INSERT INTO inspection_likes (inspection_id, actor_type, actor_id, fp)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT DO NOTHING`,
        [inspectionId, actorType, actorId, fp]
      );
    }

    // пересчитываем количество
    const cnt = await db.query(
      `SELECT COUNT(*)::int AS c FROM inspection_likes WHERE inspection_id=$1`,
      [inspectionId]
    );
    const likes = cnt.rows[0]?.c ?? 0;

    await db.query(`UPDATE inspections SET likes=$2 WHERE id=$1`, [inspectionId, likes]);

    // liked — текущее состояние после операции
    const likedNow = existing.rowCount === 0;

    return res.json({ id: inspectionId, likes, liked: likedNow });
  } catch (e) {
    console.error("likeInspection error", e);
    return res.status(500).json({ error: "like_failed" });
  }
}

module.exports = {
  // отели
  searchHotels,
  listRankedHotels,
  createHotel,
  getHotel,
  listHotels,
  updateHotel,
  listMyHotels,
  getHotelBrief,
  listHotelsByCity,
  // инспекции + лайки
  listHotelInspections,
  createHotelInspection,
  likeInspection,
};
