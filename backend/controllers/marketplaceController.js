// /app/controllers/marketplaceController.js

const db = require("../db");
const pg = db?.query ? db : db?.pool;
if (!pg || typeof pg.query !== "function") {
  throw new Error("DB driver not available: expected node-postgres Pool with .query()");
}

// используем алиас s.* для services
const PRICE_SQL = `COALESCE(NULLIF(s.details->>'netPrice','')::numeric, s.price)`;

// Алиасы категорий
const CATEGORY_ALIAS = {
  guide: ["city_tour_guide", "mountain_tour_guide"],
  transport: [
    "city_tour_transport",
    "mountain_tour_transport",
    "one_way_transfer",
    "dinner_transfer",
    "border_transfer",
    "hotel_transfer",
  ],
  package: ["refused_tour", "author_tour"],
};
const expandCategory = (cat) => (cat ? CATEGORY_ALIAS[String(cat).trim()] || [String(cat).trim()] : null);
const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);

/* ========================= SEARCH ========================= */
module.exports.search = async (req, res, next) => {
  try {
    const src = { ...(req.query || {}), ...(req.body || {}) };
    const q          = typeof src.q === "string" ? src.q.trim() : "";
    const category   = src.category ?? null;
    const location   = typeof src.location === "string" ? src.location.trim() : "";
    const price_min  = src.price_min ?? src.min ?? undefined;
    const price_max  = src.price_max ?? src.max ?? undefined;
    const sort       = src.sort ?? null;
    const only_active =
      String(src.only_active ?? "true").toLowerCase() !== "false";
    const limit  = Math.min(200, Math.max(1, parseInt(src.limit  ?? "60", 10)));
    const offset = Math.max(0, parseInt(src.offset ?? "0", 10));

    const cats = expandCategory(category);

    const where = [];
    const params = [];
    let p = 1;

    // опубликованные
    params.push("published");
    where.push(`s.status = $${p++}`);

    if (only_active) {
      where.push(`COALESCE((s.details->>'isActive')::boolean, true) = true`);
      where.push(`(s.expiration_at IS NULL OR s.expiration_at > now())`);
    }

    if (cats && cats.length) {
      const ph = cats.map(() => `$${p++}`).join(",");
      params.push(...cats);
      where.push(`s.category IN (${ph})`);
    }

    // текстовый поиск: по service + по провайдеру (name, location[])
    if (q) {
      const like = `%${q}%`;
      params.push(like, like, like, like, like);
      const c1 = `$${p++}`, c2 = `$${p++}`, c3 = `$${p++}`;
      const c4 = `$${p++}`, c5 = `$${p++}`;
      where.push(`(
        s.title ILIKE ${c1}
        OR s.description ILIKE ${c2}
        OR s.details::text ILIKE ${c3}
        OR COALESCE(p.name,'') ILIKE ${c4}
        OR COALESCE(array_to_string(p.location, ', '),'') ILIKE ${c5}
      )`);
    }

    // фильтр по локации: по details услуги И по массиву локаций провайдера
    if (location) {
      const like = `%${location}%`;
      params.push(like, like, like, like, like);
      const c1 = `$${p++}`, c2 = `$${p++}`, c3 = `$${p++}`, c4 = `$${p++}`, c5 = `$${p++}`;
      where.push(`(
        COALESCE(s.details->>'direction_to','') ILIKE ${c1}
        OR COALESCE(s.details->>'directionTo','') ILIKE ${c2}
        OR COALESCE(s.details->>'location','') ILIKE ${c3}
        OR COALESCE(s.details->>'direction','') ILIKE ${c4}
        OR COALESCE(array_to_string(p.location, ', '),'') ILIKE ${c5}
      )`);
    }

    // цены
    const pmin = toNum(price_min);
    const pmax = toNum(price_max);
    if (pmin != null) { params.push(pmin); where.push(`${PRICE_SQL} >= $${p++}`); }
    if (pmax != null) { params.push(pmax); where.push(`${PRICE_SQL} <= $${p++}`); }

    // сортировка
    let orderBy = "s.created_at DESC";
    switch (sort) {
      case "newest":     orderBy = "s.created_at DESC"; break;
      case "price_asc":  orderBy = `${PRICE_SQL} ASC NULLS LAST`; break;
      case "price_desc": orderBy = `${PRICE_SQL} DESC NULLS LAST`; break;
    }

    params.push(limit, offset);
    const sql = `
      SELECT
        s.id, s.provider_id, s.title, s.description, s.category, s.price,
        s.images, s.availability, s.created_at, s.status, s.details, s.expiration_at,
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'location', p.location
        ) AS provider
      FROM services s
      LEFT JOIN providers p ON p.id = s.provider_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY ${orderBy}
      LIMIT $${p++} OFFSET $${p++}
    `;

    const { rows } = await pg.query(sql, params);
    res.json({ items: rows, limit, offset });
  } catch (err) {
    next(err);
  }
};

/* ========================= SUGGEST =========================
   GET /api/marketplace/suggest?q=...&limit=8
   Источники: title/locations из услуг + локации/имена провайдеров.
   Для providers.location (text[]) аккуратно разворачиваем через unnest.
*/
module.exports.suggest = async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit || "8", 10)));
    if (q.length < 2) return res.json({ items: [] });

    const like = `%${q}%`;
    const { rows } = await pg.query(
      `
      WITH s_cand AS (
        SELECT s.title AS label, 100 AS w
        FROM services s
        WHERE s.status = 'published' AND s.title ILIKE $1

        UNION ALL
        SELECT NULLIF(s.details->>'location','') AS label, 80 AS w
        FROM services s
        WHERE s.status = 'published' AND COALESCE(s.details->>'location','') ILIKE $1

        UNION ALL
        SELECT NULLIF(s.details->>'direction_to','') AS label, 70 AS w
        FROM services s
        WHERE s.status = 'published' AND COALESCE(s.details->>'direction_to','') ILIKE $1

        UNION ALL
        SELECT NULLIF(s.details->>'direction','') AS label, 60 AS w
        FROM services s
        WHERE s.status = 'published' AND COALESCE(s.details->>'direction','') ILIKE $1
      ),
      p_loc AS (
        -- локации провайдеров (location text[]) через unnest
        SELECT DISTINCT TRIM(loc) AS label, 75 AS w
        FROM providers p
        CROSS JOIN LATERAL unnest(COALESCE(p.location, ARRAY[]::text[])) AS loc
        JOIN services s ON s.provider_id = p.id AND s.status = 'published'
        WHERE TRIM(loc) <> '' AND loc ILIKE $1
      ),
      p_name AS (
        -- имена провайдеров
        SELECT DISTINCT TRIM(p.name) AS label, 65 AS w
        FROM providers p
        JOIN services s ON s.provider_id = p.id AND s.status = 'published'
        WHERE TRIM(COALESCE(p.name,'')) <> '' AND p.name ILIKE $1
      ),
      cand AS (
        SELECT * FROM s_cand
        UNION ALL SELECT * FROM p_loc
        UNION ALL SELECT * FROM p_name
      ),
      norm AS (
        SELECT LOWER(TRIM(label)) AS key, MIN(TRIM(label)) AS label, MAX(w) AS w
        FROM cand
        WHERE label IS NOT NULL AND TRIM(label) <> ''
        GROUP BY LOWER(TRIM(label))
      )
      SELECT label
      FROM norm
      ORDER BY w DESC, label ASC
      LIMIT $2
      `,
      [like, limit]
    );

    res.json({ items: rows.map(r => r.label) });
  } catch (err) {
    next(err);
  }
};
