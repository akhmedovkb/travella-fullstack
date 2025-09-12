// backend/routes/marketplaceSectionsRoutes.js
const express = require("express");
const router = express.Router();
const db = require("../db");           // <-- как в profileRoutes
const q = (...args) => db.query(...args); // короткий алиас

// helpers
const toInt = (v, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
};

// ===== SQL helpers (safe JSONB → timestamptz / numeric) =====
const tsExpr = (key) => `
  CASE
    WHEN NULLIF(s.details->>'${key}','') IS NULL THEN NULL
    WHEN (s.details->>'${key}') ~ '^[0-9]{13}$' THEN to_timestamp(((s.details->>'${key}')::bigint)/1000.0)
    WHEN (s.details->>'${key}') ~ '^[0-9]{10}$' THEN to_timestamp((s.details->>'${key}')::bigint)
    ELSE NULLIF(s.details->>'${key}','')::timestamptz
  END
`;
const numExpr = (key) => `
  CASE
    WHEN (s.details->>'${key}') ~ '^-?\\d+(\\.\\d+)?$' THEN (s.details->>'${key}')::numeric
    ELSE 0
  END
`;

const EXPIRES_AT = `
  COALESCE(
    ${tsExpr("expires_at")},
    ${tsExpr("expire_at")},
    ${tsExpr("expiration_ts")},
    ${tsExpr("expiration")}
  )
`;
const UPCOMING_TS = `
  COALESCE(
    ${tsExpr("event_date")},
    ${tsExpr("eventDate")},
    ${tsExpr("hotel_check_in")},
    ${tsExpr("hotelCheckIn")},
    ${tsExpr("start_flight_date")},
    ${tsExpr("startFlightDate")},
    ${tsExpr("startDate")},
    ${tsExpr("departureFlightDate")}
  )
`;
const TOP_SCORE = `
  (
    ${numExpr("mod_points")} +
    ${numExpr("top_points")} +
    ${numExpr("boost_points")} +
    3 * ${numExpr("favorites")} +
    3 * ${numExpr("wishlist_count")} +
    (${numExpr("views")} / 50.0) +
    GREATEST(0, 14 - FLOOR(EXTRACT(EPOCH FROM (NOW() - s.created_at))/86400))
  )
`;


function buildWhere({ category }) {
  const clauses = [];
  const params = [];

  // только опубликованные
  clauses.push(`(s.status = 'published' OR s.status IS NULL)`);

  // ручное выключение
  clauses.push(`COALESCE(NULLIF(s.details->>'isActive','')::boolean, true) = true`);

    // exp: не истёк (ISO/epoch-safe)
  clauses.push(`( ${EXPIRES_AT} IS NULL OR ${EXPIRES_AT} >= NOW() )`);
  
  // ttl_hours от created_at
    clauses.push(`
    (
      NULLIF(s.details->>'ttl_hours','') IS NULL
      OR s.created_at IS NULL
      OR CASE
           WHEN (s.details->>'ttl_hours') ~ '^\\d+$'
             THEN (s.created_at + ((s.details->>'ttl_hours')::int * INTERVAL '1 hour')) >= NOW()
           ELSE TRUE
         END
    )
  `);

  // категория (колонка или JSONB)
  if (category) {
    params.push(category);
    clauses.push(`(s.category = $${params.length} OR s.details->>'category' = $${params.length})`);
  }

  return { where: clauses.map(c => `(${c})`).join(" AND "), params };
}

async function runSection({ orderBy, page, limit, category }) {
  const { where, params } = buildWhere({ category });
  const offset = (page - 1) * limit;

   // дополнительные условия для конкретных секций
  const extra = [];
  if (orderBy === "new") {
    extra.push(`s.created_at >= NOW() - INTERVAL '7 days'`);
  }
  if (orderBy === "upcoming") {
    extra.push(`${UPCOMING_TS} >= NOW() AND ${UPCOMING_TS} <= NOW() + INTERVAL '14 days'`);
  }
  const whereFull = [where, ...extra.map(c => `(${c})`)].join(" AND ");

  // счётчик
  const { rows: cntRows } = await q(
    `SELECT COUNT(*)::int AS cnt FROM services s WHERE ${whereFull}`,
    params
  );
  const total = cntRows?.[0]?.cnt ?? 0;

  // сортировка
  let orderSql = "s.created_at DESC NULLS LAST";
  if (orderBy === "top")      orderSql = `COALESCE(${TOP_SCORE}, 0) DESC, s.created_at DESC NULLS LAST`;
  if (orderBy === "upcoming") orderSql = `${UPCOMING_TS} ASC NULLS LAST`;

  const dataSql = `
    SELECT s.*
    FROM services s
    WHERE ${whereFull}
    ORDER BY ${orderSql}
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;
  const { rows } = await q(dataSql, [...params, limit, offset]);

  return { items: rows.map(r => ({ service: r })), total, page };
}

// routes
router.get("/top", async (req, res) => {
  try {
    const page = toInt(req.query.page, 1);
    const limit = toInt(req.query.limit, 12);
    const category = (req.query.category || "").trim() || null;
    res.json(await runSection({ orderBy: "top", page, limit, category }));
  } catch (e) {
    console.error("sections /top:", e);
    res.status(500).json({ error: "sections_failed" });
  }
});

router.get("/new", async (req, res) => {
  try {
    const page = toInt(req.query.page, 1);
    const limit = toInt(req.query.limit, 12);
    const category = (req.query.category || "").trim() || null;
    res.json(await runSection({ orderBy: "new", page, limit, category }));
  } catch (e) {
    console.error("sections /new:", e);
    res.status(500).json({ error: "sections_failed" });
  }
});

router.get("/upcoming", async (req, res) => {
  try {
    const page = toInt(req.query.page, 1);
    const limit = toInt(req.query.limit, 12);
    const category = (req.query.category || "").trim() || null;
    res.json(await runSection({ orderBy: "upcoming", page, limit, category }));
  } catch (e) {
    console.error("sections /upcoming:", e);
    res.status(500).json({ error: "sections_failed" });
  }
});

module.exports = router;
