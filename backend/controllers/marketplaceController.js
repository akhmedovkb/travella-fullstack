// Универсальный контроллер: поддерживает либо knex, либо node-postgres pool (db.query)

const dbMod = require("../db");

// Определяем доступный драйвер
let knex = null;
let pg = null;
if (typeof dbMod === "function") {
  knex = dbMod; // export = knex()
} else if (dbMod && typeof dbMod.knex === "function") {
  knex = dbMod.knex; // module.exports = { knex }
} else if (dbMod && typeof dbMod.default === "function") {
  knex = dbMod.default; // ESM default
} else if (dbMod && typeof dbMod.query === "function") {
  pg = dbMod; // node-postgres Pool
} else if (dbMod && dbMod.pool && typeof dbMod.pool.query === "function") {
  pg = dbMod.pool; // { pool }
}

const PRICE_SQL = `COALESCE(NULLIF(details->>'netPrice','')::numeric, price)`;

// Маппинг "групп" на реальные категории в БД
const CATEGORY_ALIAS = {
  guide: [
    "city_tour_guide",
    "mountain_tour_guide",
  ],
  transport: [
    "city_tour_transport",
    "mountain_tour_transport",
    "one_way_transfer",
    "dinner_transfer",
    "border_transfer",
    "hotel_transfer",
  ],
  // иногда фронт присылает "package" как отказной тур
  package: ["refused_tour", "author_tour"],
};

function expandCategory(cat) {
  if (!cat) return null;
  const key = String(cat).trim();
  if (CATEGORY_ALIAS[key]) return CATEGORY_ALIAS[key];
  return [key]; // уже конечная категория
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

module.exports.search = async (req, res, next) => {
  try {
    if (!knex && !pg) {
      throw new Error("DB driver is not available: expected knex() or pg Pool with .query()");
    }

    // не кэшируем выдачу, чтобы не ловить 304
    res.set("Cache-Control", "no-store");

    // поддерживаем и GET, и POST
    const src = req.method === "GET" ? (req.query || {}) : (req.body || {});

    const q           = src.q ?? undefined;
    const category    = src.category ?? undefined;
    const location    = src.location ?? undefined;
    const price_min   = src.price_min ?? undefined;
    const price_max   = src.price_max ?? undefined;
    const sort        = src.sort ?? undefined;

    // only_active может прийти строкой "false"
    const onlyActive = String(src.only_active ?? "true") !== "false";
    const lim        = Math.min(200, Math.max(1, Number(src.limit)  || 60));
    const off        = Math.max(0, Number(src.offset) || 0);

    const cats = expandCategory(category);

    /* ---------- ВЕТКА KNEX ---------- */
    if (knex) {
      const rowsQ = knex("services")
        .select([
          "id",
          "provider_id",
          "title",
          "description",
          "category",
          "price",
          "images",
          "availability",
          "created_at",
          "status",
          "details",
          "expiration_at",
        ])
        .modify((qb) => {
          if (onlyActive) {
            qb.andWhereRaw(`COALESCE((details->>'isActive')::boolean, true) = true`)
              .andWhere((q2) =>
                q2.whereNull("expiration_at").orWhereRaw("expiration_at > now()")
              );
          }
        })
        .modify((qb) => {
          if (cats && cats.length) qb.whereIn("category", cats);
        })
        .modify((qb) => {
          if (q && String(q).trim()) {
            const like = `%${String(q).trim()}%`;
            qb.andWhere((sub) => {
              sub.whereRaw(`title ILIKE ?`, [like])
                .orWhereRaw(`description ILIKE ?`, [like])
                .orWhereRaw(`details::text ILIKE ?`, [like]);
            });
          }
        })
        .modify((qb) => {
          if (location && String(location).trim()) {
            const like = `%${String(location).trim()}%`;
            qb.andWhere((sub) => {
              sub.whereRaw(`COALESCE(details->>'direction_to','') ILIKE ?`, [like])
                .orWhereRaw(`COALESCE(details->>'directionTo','') ILIKE ?`, [like])
                .orWhereRaw(`COALESCE(details->>'location','') ILIKE ?`, [like])
                .orWhereRaw(`COALESCE(details->>'direction','') ILIKE ?`, [like]);
            });
          }
        })
        .modify((qb) => {
          const pmin = toNum(price_min);
          const pmax = toNum(price_max);
          if (pmin != null) qb.andWhereRaw(`${PRICE_SQL} >= ?`, [pmin]);
          if (pmax != null) qb.andWhereRaw(`${PRICE_SQL} <= ?`, [pmax]);
        })
        .modify((qb) => {
          switch (sort) {
            case "newest":     qb.orderBy("created_at", "desc"); break;
            case "price_asc":  qb.orderByRaw(`${PRICE_SQL} asc nulls last`); break;
            case "price_desc": qb.orderByRaw(`${PRICE_SQL} desc nulls last`); break;
            default:           qb.orderBy("created_at", "desc");
          }
        })
        .limit(lim)
        .offset(off);

      const items = await rowsQ;
      return res.json({ items, limit: lim, offset: off });
    }

    /* ---------- ВЕТКА PG (node-postgres) ---------- */
    const where = [];
    const params = [];
    let p = 1;

    if (onlyActive) {
      where.push(`COALESCE((details->>'isActive')::boolean, true) = true`);
      where.push(`(expiration_at IS NULL OR expiration_at > now())`);
    }

    if (cats && cats.length) {
      const ph = cats.map(() => `$${p++}`).join(",");
      params.push(...cats);
      where.push(`category IN (${ph})`);
    }

    if (q && String(q).trim()) {
      const like = `%${String(q).trim()}%`;
      params.push(like, like, like);
      const c1 = `$${p++}`, c2 = `$${p++}`, c3 = `$${p++}`;
      where.push(`(title ILIKE ${c1} OR description ILIKE ${c2} OR details::text ILIKE ${c3})`);
    }

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

    const pmin = toNum(price_min);
    const pmax = toNum(price_max);
    if (pmin != null) { params.push(pmin); where.push(`${PRICE_SQL} >= $${p++}`); }
    if (pmax != null) { params.push(pmax); where.push(`${PRICE_SQL} <= $${p++}`); }

    let orderBy = "created_at DESC";
    switch (sort) {
      case "newest":     orderBy = "created_at DESC"; break;
      case "price_asc":  orderBy = `${PRICE_SQL} ASC NULLS LAST`; break;
      case "price_desc": orderBy = `${PRICE_SQL} DESC NULLS LAST`; break;
    }

    params.push(lim, off);
    const sql = `
      SELECT id, provider_id, title, description, category, price, images, availability, created_at, status, details, expiration_at
      FROM services
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY ${orderBy}
      LIMIT $${p++} OFFSET $${p++}
    `;

    const { rows } = await pg.query(sql, params);
    return res.json({ items: rows, limit: lim, offset: off });
  } catch (err) {
    next(err);
  }
};
