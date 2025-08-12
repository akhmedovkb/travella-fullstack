// SERVER: marketplaceController.js (CommonJS)

const dbModule = require("../db");

// Пытаемся корректно получить knex из любого варианта экспорта
const knex =
  (typeof dbModule === "function" && dbModule) ||
  dbModule?.knex ||
  dbModule?.db ||
  dbModule?.default;

if (!knex || typeof knex !== "function") {
  throw new Error("Knex instance not found in ../db");
}

// Цена: сначала netPrice из JSON, иначе обычная price
const PRICE_SQL = `COALESCE(NULLIF(details->>'netPrice','')::numeric, price)`;

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function addLike(qb, column, value) {
  if (!value) return;
  qb.andWhereRaw(`${column} ILIKE ?`, [`%${value}%`]);
}

module.exports.search = async (req, res, next) => {
  try {
    const {
      q,
      category,
      price_min,
      price_max,
      sort,
      only_active = true,
      limit = 60,
      offset = 0,
      // возможны доп. поля: details.directionFrom и т.п.
      ...rest
    } = req.body || {};

    const lim = Math.min(200, Math.max(1, Number(limit) || 60));
    const off = Math.max(0, Number(offset) || 0);

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
        if (only_active) {
          // Активные в JSON и неистёкшие по expiration_at
          qb.andWhereRaw(`COALESCE((details->>'isActive')::boolean, true) = true`)
            .andWhere((sub) => {
              sub.whereNull("expiration_at").orWhereRaw("expiration_at > now()");
            });
        }
      })
      .modify((qb) => {
        if (category) qb.andWhere("category", category);
      })
      .modify((qb) => {
        if (q && String(q).trim()) {
          qb.andWhere((sub) => {
            addLike(sub, "title", q);
            sub.orWhereRaw(`description ILIKE ?`, [`%${q}%`]);
            sub.orWhereRaw(`details::text ILIKE ?`, [`%${q}%`]);
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
        // произвольные фильтры по details.*   (напр. details.directionFrom="Tashkent")
        Object.entries(rest || {}).forEach(([key, val]) => {
          if (!key.startsWith("details.")) return;
          const dkey = key.slice("details.".length);
          if (val === undefined || val === null || val === "") return;
          qb.andWhereRaw(`details->>? ILIKE ?`, [dkey, `%${val}%`]);
        });
      })
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
    res.json({ items, limit: lim, offset: off });
  } catch (err) {
    next(err);
  }
};
