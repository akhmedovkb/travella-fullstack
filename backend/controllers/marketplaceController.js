// /app/controllers/marketplaceController.js

const db = require("../db"); // должен отдавать Pool или объект с .query
const pg = db?.query ? db : db?.pool;

if (!pg || typeof pg.query !== "function") {
  throw new Error("DB driver not available: expected node-postgres Pool with .query()");
}

const PRICE_SQL = `COALESCE(NULLIF(details->>'netPrice','')::numeric, price)`;

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

module.exports.search = async (req, res, next) => {
  try {
    const {
      q,
      category,
      location,
      price_min,
      price_max,
      sort,
      only_active = true,
      limit = 60,
      offset = 0,
    } = req.body || {};

    const cats = expandCategory(category);
    const lim = Math.min(200, Math.max(1, Number(limit) || 60));
    const off = Math.max(0, Number(offset) || 0);

    const where = [];
    const params = [];
    let p = 1;

    // только опубликованные
    params.push("published");
    where.push(`status = $${p++}`);

    // включено + не истекло (если надо)
    if (only_active) {
      where.push(`COALESCE((details->>'isActive')::boolean, true) = true`);
      where.push(`(expiration_at IS NULL OR expiration_at > now())`);
    }

    // категория / алиасы
    if (cats && cats.length) {
      const ph = cats.map(() => `$${p++}`).join(",");
      params.push(...cats);
      where.push(`category IN (${ph})`);
    }

    // текстовый поиск
    if (q && String(q).trim()) {
      const like = `%${String(q).trim()}%`;
      params.push(like, like, like);
      const c1 = `$${p++}`, c2 = `$${p++}`, c3 = `$${p++}`;
      where.push(`(title ILIKE ${c1} OR description ILIKE ${c2} OR details::text ILIKE ${c3})`);
    }

    // локация
    if (location && String(location).trim()) {
      const like = `%${String(location).trim()}%`;
      params.push(like, like, like, like);
      const c1 = `$${p++}`, c2 = `$${p++}`, c3 = `$${p++}`, c4 = `$${p++}`;
      where.push(`(
        COALESCE(details->>'direction_to','') ILIKE ${c1}
        OR COALESCE(details->>'directionTo','') ILIKE ${c2}
        OR COALESCE(details->>'location','') ILIKE ${c3}
        OR COALESCE(details->>'direction','') ILIKE ${c4}
      )`);
    }

    // цены (нетто/фоллбэк на price)
    const pmin = toNum(price_min);
    const pmax = toNum(price_max);
    if (pmin != null) { params.push(pmin); where.push(`${PRICE_SQL} >= $${p++}`); }
    if (pmax != null) { params.push(pmax); where.push(`${PRICE_SQL} <= $${p++}`); }

    // сортировка
    let orderBy = "created_at DESC";
    switch (sort) {
      case "newest":     orderBy = "created_at DESC"; break;
      case "price_asc":  orderBy = `${PRICE_SQL} ASC NULLS LAST`; break;
      case "price_desc": orderBy = `${PRICE_SQL} DESC NULLS LAST`; break;
    }

    params.push(lim, off);
    const sql = `
      SELECT id, provider_id, title, description, category, price, images, availability,
             created_at, status, details, expiration_at
      FROM services
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY ${orderBy}
      LIMIT $${p++} OFFSET $${p++}
    `;

    const { rows } = await pg.query(sql, params);
    res.json({ items: rows, limit: lim, offset: off });
  } catch (err) {
    next(err);
  }
};
