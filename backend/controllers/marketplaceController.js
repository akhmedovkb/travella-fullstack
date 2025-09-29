const db = require("../db");
const pg = db?.query ? db : db?.pool;

if (!pg || typeof pg.query !== "function") {
  throw new Error("DB driver not available: expected node-postgres Pool with .query()");
}

const PRICE_SQL = `COALESCE(NULLIF(s.details->>'netPrice','')::numeric, s.price)`;

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
const expandCategory = (cat) => (cat ? (CATEGORY_ALIAS[String(cat).trim()] || [String(cat).trim()]) : null);
const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);

/**
 * SEARCH
 * Ищем ТОЛЬКО по полям провайдера:
 *   - providers.type
 *   - providers.location
 *   - providers.languages (любой тип; приводим к jsonb -> text и ищем по строке)
 */
module.exports.search = async (req, res, next) => {
  try {
    const src = { ...(req.query || {}), ...(req.body || {}) };

    const q           = typeof src.q === "string" ? src.q.trim() : "";
    const category    = src.category ?? null;
    const sort        = src.sort ?? null;
    const only_active = String(src.only_active ?? "true").toLowerCase() !== "false";

    const limit  = Math.min(200, Math.max(1, parseInt(src.limit  ?? "60", 10)));
    const offset = Math.max(0, parseInt(src.offset ?? "0", 10));

    const cats = expandCategory(category);

    const where = [];
    const params = [];
    let p = 1;

    // только опубликованные услуги
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

    // --- фильтр по провайдеру ---
    if (q) {
      const like = `%${q}%`;
      params.push(like, like, like);
      const c1 = `$${p++}`, c2 = `$${p++}`, c3 = `$${p++}`;
      // languages приводим к jsonb->text: работает и для массива, и для строки, и для json/jsonb
      where.push(`(
        COALESCE(p.type,'') ILIKE ${c1}
        OR COALESCE(p.location,'') ILIKE ${c2}
        OR COALESCE(to_jsonb(p.languages)::text,'') ILIKE ${c3}
      )`);
    }

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
        s.id, s.provider_id, s.title, s.description, s.category, s.price, s.images, s.availability,
        s.created_at, s.status, s.details, s.expiration_at,
        row_to_json(p) AS provider
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

/**
 * SUGGEST
 * Подсказки строим только из providers: type/location/languages
 */
module.exports.suggest = async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit || "8", 10)));
    if (q.length < 2) return res.json({ items: [] });

    const like = `%${q}%`;

    // Отдаём простые текстовые подсказки. Для languages берём всю строку (если массив — будет вида ["ru","en"]).
    const { rows } = await pg.query(
      `
      WITH cand AS (
        SELECT COALESCE(NULLIF(TRIM(p.type), ''), NULL)      AS label, 100 AS w
        FROM providers p WHERE COALESCE(p.type,'') ILIKE $1

        UNION ALL
        SELECT COALESCE(NULLIF(TRIM(p.location), ''), NULL)  AS label, 90  AS w
        FROM providers p WHERE COALESCE(p.location,'') ILIKE $1

        UNION ALL
        SELECT COALESCE(NULLIF(TRIM(to_jsonb(p.languages)::text), ''), NULL) AS label, 80 AS w
        FROM providers p WHERE COALESCE(to_jsonb(p.languages)::text,'') ILIKE $1
      ),
      norm AS (
        SELECT LOWER(TRIM(label)) AS key, MIN(TRIM(label)) AS label, MAX(w) AS w
        FROM cand
        WHERE label IS NOT NULL
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
