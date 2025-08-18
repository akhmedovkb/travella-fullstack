// /app/controllers/marketplaceController.js
// Универсальный контроллер: поддерживает либо knex, либо node-postgres pool (db.query)

const dbMod = require("../db");

// Определяем доступный драйвер
let knex = null;
let pg = null;
if (typeof dbMod === "function") {
  // export = knex()
  knex = dbMod;
} else if (dbMod && typeof dbMod.knex === "function") {
  // module.exports = { knex }
  knex = dbMod.knex;
} else if (dbMod && typeof dbMod.default === "function") {
  // ESM default
  knex = dbMod.default;
} else if (dbMod && typeof dbMod.query === "function") {
  // node-postgres Pool
  pg = dbMod;
} else if (dbMod && dbMod.pool && typeof dbMod.pool.query === "function") {
  // { pool }
  pg = dbMod.pool;
}
// Никаких падений здесь — просто выбросим понятную ошибку при первом запросе, если и knex, и pg не найдены.

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
  // уже конечная категория
  return [key];
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

module.exports.search = async (req, res, next) => {
  try {
    if (!knex && !pg) {
      throw new Error("DB driver is not available: expected knex function or pg Pool with .query()");
    }

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

    // ---------- ВЕТКА KNEX ----------
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
        // только активные + неистёкшие
        .modify((qb) => {
          if (only_active) {
            qb.andWhereRaw(`COALESCE((details->>'isActive')::boolean, true) = true`)
              .andWhere((q2) =>
                q2.whereNull("expiration_at").orWhereRaw("expiration_at > now()")
              );
          }
        })
        // категория / алиасы
        .modify((qb) => {
          if (cats && cats.length) {
            qb.whereIn("category", cats);
          }
        })
        // текстовый поиск
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
        // фильтр по локации (город прибытия/место)
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
        // диапазон цены (нетто/price)
        .modify((qb) => {
          const pmin = toNum(price_min);
          const pmax = toNum(price_max);
          if (pmin != null) qb.andWhereRaw(`${PRICE_SQL} >= ?`, [pmin]);
          if (pmax != null) qb.andWhereRaw(`${PRICE_SQL} <= ?`, [pmax]);
        })
        // сортировка
        .modify((qb) => {
          switch (sort) {
            case "newest":
              qb.orderBy("created_at", "desc");
              break;
            case "price_asc":
              qb.orderByRaw(`${PRICE_SQL} asc nulls last`);
              break;
            case "price_desc":
              qb.orderByRaw(`${PRICE_SQL} desc nulls last`);
              break;
            default:
              qb.orderBy("created_at", "desc");
          }
        })
        .limit(lim)
        .offset(off);

      const items = await rowsQ;
      return res.json({ items, limit: lim, offset: off });
    }

    // ---------- ВЕТКА PG (node-postgres) ----------
    // Собираем where вручную
    const where = [];
    const params = [];
    let p = 1;

    if (only_active) {
      where.push(`COALESCE((details->>'isActive')::boolean, true) = true`);
      where.push(`(expiration_at IS NULL OR expiration_at > now())`);
    }

    if (cats && cats.length) {
      // category IN (...)
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
    if (pmin != null) {
      params.push(pmin);
      where.push(`${PRICE_SQL} >= $${p++}`);
    }
    if (pmax != null) {
      params.push(pmax);
      where.push(`${PRICE_SQL} <= $${p++}`);
    }

    let orderBy = "created_at DESC";
    switch (sort) {
      case "newest":
        orderBy = "created_at DESC";
        break;
      case "price_asc":
        orderBy = `${PRICE_SQL} ASC NULLS LAST`;
        break;
      case "price_desc":
        orderBy = `${PRICE_SQL} DESC NULLS LAST`;
        break;
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
