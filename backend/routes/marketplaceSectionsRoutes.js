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

function buildWhere({ category }) {
  const clauses = [];
  const params = [];

  // только опубликованные
  clauses.push(`(s.status = 'published' OR s.status IS NULL)`);

  // ручное выключение
  clauses.push(`COALESCE(NULLIF(s.details->>'isActive','')::boolean, true) = true`);

  // exp: expires_at/expire_at/expiration не прошли
  clauses.push(`
    COALESCE(
      NULLIF(s.details->>'expires_at','')::timestamptz,
      NULLIF(s.details->>'expire_at','')::timestamptz,
      NULLIF(s.details->>'expiration','')::timestamptz
    ) IS NULL
    OR
    COALESCE(
      NULLIF(s.details->>'expires_at','')::timestamptz,
      NULLIF(s.details->>'expire_at','')::timestamptz,
      NULLIF(s.details->>'expiration','')::timestamptz
    ) >= NOW()
  `);

  // ttl_hours от created_at
  clauses.push(`
    (
      NULLIF(s.details->>'ttl_hours','') IS NULL
      OR s.created_at IS NULL
      OR (s.created_at + (NULLIF(s.details->>'ttl_hours','')::int * INTERVAL '1 hour')) >= NOW()
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

  // счётчик
  const { rows: cntRows } = await q(`SELECT COUNT(*)::int AS cnt FROM services s WHERE ${where}`, params);
  const total = cntRows?.[0]?.cnt ?? 0;

  // ключевая дата для upcoming
  const startExpr = `
    COALESCE(
      NULLIF(s.details->>'startDate','')::timestamptz,
      NULLIF(s.details->>'hotel_check_in','')::timestamptz,
      NULLIF(s.details->>'departureFlightDate','')::timestamptz,
      s.start_date,
      s.created_at
    )
  `;

  let orderSql = "s.created_at DESC NULLS LAST";
  if (orderBy === "top") orderSql = "COALESCE(s.mod_points, 0) DESC, s.created_at DESC NULLS LAST";
  if (orderBy === "upcoming") orderSql = `${startExpr} ASC NULLS LAST`;

  const dataSql = `
    SELECT s.*
    FROM services s
    WHERE ${where}
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
