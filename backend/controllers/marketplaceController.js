// /app/controllers/marketplaceController.js

const db = require("../db"); // должен отдавать Pool или объект с .query
const pg = db?.query ? db : db?.pool;

if (!pg || typeof pg.query !== "function") {
  throw new Error("DB driver not available: expected node-postgres Pool with .query()");
}

// важно: использовать алиас таблицы services (s.*) в формулах
const PRICE_SQL = `COALESCE(NULLIF(s.details->>'netPrice','')::numeric, s.price)`;

// Алиасы категорий (как было)
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

function expandCategory(cat) {
  if (!cat) return null;
  const key = String(cat).trim();
  return CATEGORY_ALIAS[key] || [key];
}
const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);

// ========================= S E A R C H =========================
module.exports.search = async (req, res, next) => {
  try {
    // единый источник параметров: и GET, и POST
    const src = { ...(req.query || {}), ...(req.body || {}) };
    const q          = typeof src.q === "string" ? src.q.trim() : "";
    const category   = src.category ?? null;
    const location   = typeof src.location === "string" ? src.location.trim() : "";
    const price_min  = src.price_min ?? src.min ?? undefined;
    const price_max  = src.price_max ?? src.max ?? undefined;
    const sort       = src.sort ?? null;
    const only_active =
      String(src.only_active ?? "true").toLowerCase() !== "false"; // по умолчанию true
    const limit  = Math.min(200, Math.max(1, parseInt(src.limit  ?? "60", 10)));
    const offset = Math.max(0, parseInt(src.offset ?? "0", 10));

    const cats = expandCategory(category);

    const where = [];
    const params = [];
    let p = 1;

    // только опубликованные
    params.push("published");
    where.push(`s.status = $${p++}`);

    // включено + не истекло (если надо)
    if (only_active) {
      where.push(`COALESCE((s.details->>'isActive')::boolean, true) = true`);
      where.push(`(s.expiration_at IS NULL OR s.expiration_at > now())`);
    }

    // категория / алиасы
    if (cats && cats.length) {
      const ph = cats.map(() => `$${p++}`).join(",");
      params.push(...cats);
      where.push(`s.category IN (${ph})`);
    }

    // текстовый поиск (услуга + провайдер)
    if (q) {
      const like = `%${q}%`;
      // title/description/details + provider name/company/brand/location
      params.push(like, like, like, like, like, like, like);
      const c1 = `$${p++}`, c2 = `$${p++}`, c3 = `$${p++}`;
      const c4 = `$${p++}`, c5 = `$${p++}`, c6 = `$${p++}`, c7 = `$${p++}`;
      where.push(`(
        s.title ILIKE ${c1}
        OR s.description ILIKE ${c2}
        OR s.details::text ILIKE ${c3}
        OR COALESCE(p.name,'') ILIKE ${c4}
        OR COALESCE(p.company_name,'') ILIKE ${c5}
        OR COALESCE(p.brand,'') ILIKE ${c6}
        OR COALESCE(p.location,'') ILIKE ${c7}
      )`);
    }

    // фильтр по локации (и по details у услуги, и по providers.location)
    if (location) {
      const like = `%${location}%`;
      params.push(like, like, like, like, like);
      const c1 = `$${p++}`, c2 = `$${p++}`, c3 = `$${p++}`, c4 = `$${p++}`, c5 = `$${p++}`;
      where.push(`(
        COALESCE(s.details->>'direction_to','') ILIKE ${c1}
        OR COALESCE(s.details->>'directionTo','') ILIKE ${c2}
        OR COALESCE(s.details->>'location','') ILIKE ${c3}
        OR COALESCE(s.details->>'direction','') ILIKE ${c4}
        OR COALESCE(p.location,'') ILIKE ${c5}
      )`);
    }

    // цены (нетто/фоллбэк на price)
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
        s.id,
        s.provider_id,
        s.title,
        s.description,
        s.category,
        s.price,
        s.images,
        s.availability,
        s.created_at,
        s.status,
        s.details,
        s.expiration_at,
        -- компактная инфа о провайдере
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'company_name', p.company_name,
          'brand', p.brand,
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

// ========================= S U G G E S T =========================
// GET /api/marketplace/suggest?q=...&limit=8
module.exports.suggest = async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit || "8", 10)));
    if (q.length < 2) return res.json({ items: [] });

    const like = `%${q}%`;
    const { rows } = await pg.query(
      `
      WITH s_cand AS (
        -- заголовки/локации/направления из услуг
        SELECT title AS label, 100 AS w
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
      p_cand AS (
        -- названия и локации провайдеров, у которых есть опубликованные услуги
        SELECT DISTINCT ON (LOWER(TRIM(p.location)))
               p.location AS label, 75 AS w
        FROM providers p
        JOIN services s ON s.provider_id = p.id AND s.status = 'published'
        WHERE COALESCE(p.location,'') ILIKE $1

        UNION ALL
        SELECT DISTINCT ON (LOWER(TRIM(coalesce(p.name,'') || ' ' || coalesce(p.company_name,'') || ' ' || coalesce(p.brand,''))))
               TRIM(coalesce(p.name,'') || ' ' || coalesce(p.company_name,'') || ' ' || coalesce(p.brand,'')) AS label,
               65 AS w
        FROM providers p
        JOIN services s ON s.provider_id = p.id AND s.status = 'published'
        WHERE (coalesce(p.name,'') || ' ' || coalesce(p.company_name,'') || ' ' || coalesce(p.brand,'')) ILIKE $1
      ),
      cand AS (
        SELECT * FROM s_cand
        UNION ALL
        SELECT * FROM p_cand
      ),
      norm AS (
        SELECT
          LOWER(TRIM(label)) AS key,
          MIN(TRIM(label))   AS label,
          MAX(w)             AS w
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
