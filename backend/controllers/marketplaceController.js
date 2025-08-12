// app/controllers/marketplaceController.js
"use strict";

const dbMod = require("../db");

// --- адаптер БД: поддерживаем knex ИЛИ pg.Pool ---
let knex = null;
let psql = null;

(function detectDB(m) {
  if (!m) return;
  const c = m.default || m;

  // knex: сама функция (knex('table')), либо объект с raw/client/select
  if (typeof c === "function" || (c && typeof c.raw === "function")) {
    knex = c;
    return;
  }
  // pg.Pool: объект с .query
  if (c && typeof c.query === "function") {
    psql = c;
    return;
  }
})(dbMod);

// Общая формула цены: details.netPrice (если есть) иначе services.price
const PRICE_SQL = `COALESCE(NULLIF(details->>'netPrice','')::numeric, price)`;

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

// ===================== KNEX ВАРИАНТ =====================
async function searchWithKnex(req) {
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
        qb.whereRaw(
          `COALESCE(NULLIF(details->>'isActive','')::boolean, true) = true`
        ).andWhere(function () {
          this.whereNull("expiration_at").orWhere(
            "expiration_at",
            ">",
            knex.fn.now()
          );
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
        const dkey = key.slice(8);
        const isBool =
          val === true || val === false || val === "true" || val === "false";
        if (isBool) {
          qb.andWhereRaw(`details->>? = ?`, [dkey, String(val) === "true" ? "true" : "false"]);
        } else {
          qb.andWhereRaw(`details->>? ILIKE ?`, [dkey, `%${val}%`]);
        }
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
  return { items, limit: lim, offset: off };
}

// ===================== PG ВАРИАНТ =====================
async function searchWithPG(req) {
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

  const cols = [
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
  ];

  const params = [];
  const where = [];

  if (only_active) {
    where.push(
      `COALESCE(NULLIF(details->>'isActive','')::boolean, true) = true`
    );
    where.push(`(expiration_at IS NULL OR expiration_at > now())`);
  }

  if (category) {
    params.push(category);
    where.push(`category = $${params.length}`);
  }

  if (q && String(q).trim()) {
    params.push(`%${q}%`);
    const n = params.length;
    where.push(`(title ILIKE $${n} OR description ILIKE $${n} OR details::text ILIKE $${n})`);
  }

  const pmin = toNum(price_min);
  if (pmin != null) {
    params.push(pmin);
    where.push(`${PRICE_SQL} >= $${params.length}`);
  }
  const pmax = toNum(price_max);
  if (pmax != null) {
    params.push(pmax);
    where.push(`${PRICE_SQL} <= $${params.length}`);
  }

  Object.entries(rest || {}).forEach(([key, val]) => {
    if (!key.startsWith("details.")) return;
    const dkey = key.slice(8);
    const isBool =
      val === true || val === false || val === "true" || val === "false";
    if (isBool) {
      params.push(String(val) === "true" ? "true" : "false");
      where.push(`details->>'${dkey}' = $${params.length}`);
    } else {
      params.push(`%${val}%`);
      where.push(`details->>'${dkey}' ILIKE $${params.length}`);
    }
  });

  let orderBy = `created_at DESC`;
  if (sort === "price_asc") orderBy = `${PRICE_SQL} ASC NULLS LAST`;
  else if (sort === "price_desc") orderBy = `${PRICE_SQL} DESC NULLS LAST`;

  params.push(lim);
  params.push(off);

  const sql = `
    SELECT ${cols.join(", ")}
    FROM services
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY ${orderBy}
    LIMIT $${params.length - 1}
    OFFSET $${params.length}
  `;

  const { rows } = await psql.query(sql, params);
  return { items: rows, limit: lim, offset: off };
}

// ===================== Контроллер =====================
async function search(req, res, next) {
  try {
    let result;
    if (knex) result = await searchWithKnex(req);
    else if (psql) result = await searchWithPG(req);
    else throw new Error("DB adapter not found (neither knex nor pg.Pool).");

    res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { search };
