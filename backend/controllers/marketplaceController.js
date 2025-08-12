// SERVER: marketplaceController.js (CommonJS). Работает с Knex ИЛИ с pg.Pool.

const dbModule = require("../db");

// --------- Определяем, что нам отдали из ../db ----------
const isKnex = typeof dbModule === "function" && typeof dbModule.raw === "function";
const knex =
  (isKnex && dbModule) ||
  (dbModule && typeof dbModule.knex === "function" && dbModule.knex) ||
  null;

const isPgPool =
  dbModule &&
  typeof dbModule === "object" &&
  typeof dbModule.query === "function";

// Общие утилиты
const PRICE_SQL = `COALESCE(NULLIF(details->>'netPrice','')::numeric, price)`;
const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);

// --------- Реализация через pg.Pool (raw SQL) ----------
async function searchWithPg(req, res, next) {
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
      ...rest
    } = req.body || {};

    const lim = Math.min(200, Math.max(1, Number(limit) || 60));
    const off = Math.max(0, Number(offset) || 0);

    const where = [];
    const params = [];

    const add = (sqlFrag, ...vals) => {
      where.push(sqlFrag);
      for (const v of vals) params.push(v);
    };

    if (only_active) {
      add(`COALESCE((details->>'isActive')::boolean, true) = true`);
      add(`(expiration_at IS NULL OR expiration_at > now())`);
    }
    if (category) add(`category = $${params.length + 1}`, category);

    if (q && String(q).trim()) {
      const p = `%${q}%`;
      add(`(title ILIKE $${params.length + 1} OR description ILIKE $${params.length + 2} OR details::text ILIKE $${params.length + 3})`, p, p, p);
    }

    const pmin = toNum(price_min);
    const pmax = toNum(price_max);
    if (pmin != null) add(`${PRICE_SQL} >= $${params.length + 1}`, pmin);
    if (pmax != null) add(`${PRICE_SQL} <= $${params.length + 1}`, pmax);

    // произвольные details.*
    Object.entries(rest || {}).forEach(([k, v]) => {
      if (!k.startsWith("details.")) return;
      if (v === undefined || v === null || v === "") return;
      const dkey = k.slice("details.".length);
      // jsonb ->> $param допускается в Postgres
      add(`(details->> $${params.length + 1}) ILIKE $${params.length + 2}`, dkey, `%${v}%`);
    });

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
      default:
        orderBy = "created_at DESC";
    }

    const sql = `
      SELECT id, provider_id, title, description, category, price, images,
             availability, created_at, status, details, expiration_at
      FROM services
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY ${orderBy}
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
    `;
    params.push(lim, off);

    const { rows } = await dbModule.query(sql, params);
    res.json({ items: rows, limit: lim, offset: off });
  } catch (err) {
    next(err);
  }
}

// --------- Реализация через Knex ----------
async function searchWithKnex(req, res, next) {
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
            sub.whereRaw(`title ILIKE ?`, [`%${q}%`])
              .orWhereRaw(`description ILIKE ?`, [`%${q}%`])
              .orWhereRaw(`details::text ILIKE ?`, [`%${q}%`]);
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
}

// --------- Экспорт общего обработчика ----------
module.exports.search = isKnex
  ? searchWithKnex
  : isPgPool
  ? searchWithPg
  : (req, res, next) => next(new Error("DB adapter is not supported: ../db has neither knex nor pg.Pool"));
