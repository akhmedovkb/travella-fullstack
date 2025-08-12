// app/controllers/marketplaceController.js
"use strict";

const dbMod = require("../db");

// Гарантированно получаем функцию knex: db("services")...
const db =
  typeof dbMod === "function"
    ? dbMod
    : dbMod?.knex || dbMod?.db || dbMod?.default;

if (typeof db !== "function") {
  throw new Error("Knex instance not found in ../db");
}

// Цена: сначала details.netPrice (если есть), иначе price из строки
const PRICE_SQL = `COALESCE(NULLIF(details->>'netPrice','')::numeric, price)`;

// -------- helpers --------
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

function addLike(qb, column, value) {
  if (!value) return;
  qb.andWhereRaw(`${column} ILIKE ?`, [`%${value}%`]);
}
function addDetailsLike(qb, key, value) {
  if (!value) return;
  qb.andWhereRaw(`details->>? ILIKE ?`, [key, `%${value}%`]);
}
function addDetailsEq(qb, key, value) {
  if (value == null) return;
  qb.andWhereRaw(`details->>? = ?`, [key, String(value)]);
}

// -------- controller --------
async function search(req, res, next) {
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

    const rowsQ = db("services")
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
      // Только активные и неистёкшие
      .modify((qb) => {
        if (only_active) {
          qb.whereRaw(
            `COALESCE(NULLIF(details->>'isActive','')::boolean, true) = true`
          ).andWhere(function () {
            this.whereNull("expiration_at").orWhere(
              "expiration_at",
              ">",
              db.fn.now()
            );
          });
        }
      })
      // Категория
      .modify((qb) => {
        if (category) qb.andWhere("category", category);
      })
      // Поиск по тексту
      .modify((qb) => {
        if (q && String(q).trim()) {
          qb.andWhere((sub) => {
            addLike(sub, "title", q);
            sub.orWhereRaw(`description ILIKE ?`, [`%${q}%`]);
            sub.orWhereRaw(`details::text ILIKE ?`, [`%${q}%`]);
          });
        }
      })
      // Диапазон цены
      .modify((qb) => {
        const pmin = toNum(price_min);
        const pmax = toNum(price_max);
        if (pmin != null) qb.andWhereRaw(`${PRICE_SQL} >= ?`, [pmin]);
        if (pmax != null) qb.andWhereRaw(`${PRICE_SQL} <= ?`, [pmax]);
      })
      // Произвольные details.*
      .modify((qb) => {
        Object.entries(rest || {}).forEach(([key, val]) => {
          if (!key.startsWith("details.")) return;
          const dkey = key.slice("details.".length);
          const isBool =
            val === true || val === false || val === "true" || val === "false";
          if (isBool) addDetailsEq(qb, dkey, String(val) === "true");
          else addDetailsLike(qb, dkey, String(val));
        });
      })
      // Сортировка
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

module.exports = { search };
