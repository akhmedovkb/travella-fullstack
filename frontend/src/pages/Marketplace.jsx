// backend/controllers/marketplaceController.js
const db = require("../db");

// Цена: сначала netPrice из details, потом price
const PRICE_SQL = `COALESCE(NULLIF(details->>'netPrice','')::numeric, price)`;

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

function addLike(qb, column, value) {
  if (value == null || value === "") return;
  qb.andWhereRaw(`${column} ILIKE ?`, [`%${value}%`]);
}
function addDetailsLike(qb, key, value) {
  if (value == null || value === "") return;
  qb.andWhereRaw(`details->>? ILIKE ?`, [key, `%${value}%`]);
}
function addDetailsEq(qb, key, value) {
  if (value == null || value === "") return;
  qb.andWhereRaw(`details->>? = ?`, [key, String(value)]);
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
      ...rest
    } = req.body || {};

    const lim = Math.min(200, Math.max(1, Number(limit) || 60));
    const off = Math.max(0, Number(offset) || 0);

    // строка "YYYY-MM-DDTHH:MM" — как в details.expiration
    const nowIsoMinute = new Date().toISOString().slice(0, 16);

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
      ])
      .modify((qb) => {
        if (only_active) {
          // 1) isActive в JSONB (или по умолчанию true)
          qb.andWhereRaw(`COALESCE((details->>'isActive')::boolean, true) = true`);
          // 2) expiration хранится как текст "YYYY-MM-DDTHH:MM"
          // допускаем отсутствие/пустоту или дату в будущем
          qb.andWhere((q2) => {
            q2.whereRaw(`(details->>'expiration') IS NULL`)
              .orWhereRaw(`(details->>'expiration') = ''`)
              .orWhereRaw(`(details->>'expiration') > ?`, [nowIsoMinute]);
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
        Object.entries(rest || {}).forEach(([key, val]) => {
          if (!key.startsWith("details.")) return;
          const dkey = key.slice("details.".length);
          const isBool =
            val === true || val === false || val === "true" || val === "false";
          if (isBool) addDetailsEq(qb, dkey, String(val) === "true");
          else addDetailsLike(qb, dkey, String(val));
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
