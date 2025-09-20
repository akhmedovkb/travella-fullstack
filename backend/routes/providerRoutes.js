// backend/routes/providerRoutes.js
const express = require("express");
const router = express.Router();

const pool = require("../db");
const authenticateToken = require("../middleware/authenticateToken");

const {
  registerProvider,
  loginProvider,
  getProviderProfile,
  updateProviderProfile,
  changeProviderPassword,
  addService,
  getServices,
  updateService,
  deleteService,
  updateServiceImagesOnly,
  getBookedDates,
  getBlockedDates,
  saveBlockedDates,
  getCalendarPublic,
  getProviderPublicById,
  getProviderStats,
  listProviderFavorites,
  toggleProviderFavorite,
  removeProviderFavorite,
} = require("../controllers/providerController");

const { notifyModerationNew } = require("../utils/telegram");

// ⬇️ NEW: резолвер синонима -> slug
const { resolveCitySlugs } = require("../utils/cities");
async function resolveCitySlug(city) {
  if (!city) return null;
  const slugs = await resolveCitySlugs(pool, [city]);
  return slugs[0] || null;
}

function requireProvider(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ message: "Требуется авторизация" });
  }
  if (req.user.role && req.user.role !== "provider") {
    return res.status(403).json({ message: "Только для провайдера" });
  }
  next();
}

/* -------------------- PUBLIC SEARCH / AVAILABLE -------------------- */

function parseQuery(qs = {}) {
  const type = String(qs.type || "").trim();
  const city = String(qs.city || qs.location || "").trim();
  const q = String(qs.q || "").trim();
  const language = String(qs.language || qs.lang || "").trim();
  const date = String(qs.date || "").trim();
  const start = String(qs.start || "").trim();
  const end = String(qs.end || "").trim();
  const limit = Math.min(Math.max(parseInt(qs.limit, 10) || 30, 1), 100);
  return { type, city, q, language, date, start, end, limit };
}

/**
 * Базовый WHERE без города (город теперь фильтруем строго по slug в city_slugs)
 * Поддержка p.languages: text | text[] | jsonb[]
 */
function buildBaseWhereWithoutCity({ type, q, language }, vals) {
  const where = [];

  if (type) {
    vals.push(type);
    where.push(`LOWER(p.type) = LOWER($${vals.length})`);
  }

  if (q) {
    vals.push(`%${q}%`);
    const i = vals.length;
    where.push(`(p.name ILIKE $${i} OR p.email ILIKE $${i} OR p.phone ILIKE $${i})`);
  }

  if (language) {
    vals.push(language);
    const iLang = vals.length;
    // универсально: одиночная строка, text[], jsonb[]
    where.push(`
      (
        (pg_typeof(p.languages)::text = 'text'
          AND LOWER(p.languages::text) = LOWER($${iLang}))
        OR
        EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(
                 CASE
                   WHEN jsonb_typeof(to_jsonb(p.languages)) = 'array'
                     THEN to_jsonb(p.languages)
                   ELSE NULL::jsonb
                 END
               ) AS lang(code)
          WHERE LOWER(lang.code) = LOWER($${iLang})
        )
      )
    `);
  }

  return where;
}

/** GET /api/providers/search */
router.get("/search", async (req, res) => {
  try {
    const { type, city, q, language, limit } = parseQuery(req.query);

    // ⬇️ NEW: резолвим один раз
    const citySlug = city ? await resolveCitySlug(city) : null;

    const vals = [];
    const where = buildBaseWhereWithoutCity({ type, q, language }, vals);

    // ⬇️ NEW: строгий матч по slug в массиве city_slugs
    if (citySlug) {
      vals.push(citySlug);
      where.push(`$${vals.length} = ANY(p.city_slugs)`);
    }

    const sql = `
      SELECT p.id, p.name, p.type, p.location, p.city_slugs, p.phone, p.email, p.photo, p.languages, p.social AS telegram
      FROM providers p
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY p.name ASC
      LIMIT $${vals.push(limit)};
    `;
    const { rows } = await pool.query(sql, vals);
    res.json({ items: rows });
  } catch (e) {
    console.error("GET /api/providers/search error:", e);
    res.status(500).json({ error: "Failed to search providers" });
  }
});

/** GET /api/providers/available */
router.get("/available", async (req, res) => {
  try {
    const { type, city, q, language, date, start, end, limit } = parseQuery(req.query);

    // ⬇️ NEW: единый slug
    const citySlug = city ? await resolveCitySlug(city) : null;

    // без даты — как /search
    if (!date && !(start && end)) {
      const vals = [];
      const where = buildBaseWhereWithoutCity({ type, q, language }, vals);
      if (citySlug) {
        vals.push(citySlug);
        where.push(`$${vals.length} = ANY(p.city_slugs)`);
      }
      const sql = `
        SELECT p.id, p.name, p.type, p.location, p.city_slugs, p.phone, p.email, p.photo, p.languages, p.social AS telegram
        FROM providers p
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY p.name ASC
        LIMIT $${vals.push(limit)};
      `;
      const { rows } = await pool.query(sql, vals);
      return res.json({ items: rows });
    }

    const vals = [];
    const where = buildBaseWhereWithoutCity({ type, q, language }, vals);
    if (citySlug) {
      vals.push(citySlug);
      where.push(`$${vals.length} = ANY(p.city_slugs)`);
    }

    let busyClause;
    if (date) {
      vals.push(date);
      const i = vals.length;
      busyClause = `
        AND NOT EXISTS (
          SELECT 1
          FROM bookings b
          JOIN booking_dates bd ON bd.booking_id = b.id
          WHERE b.provider_id = p.id
            AND b.status IN ('confirmed','active')
            AND bd.date = $${i}::date
        )
        AND NOT EXISTS (
          SELECT 1
          FROM provider_blocked_dates d
          WHERE d.provider_id = p.id
            AND d.date = $${i}::date
        )
      `;
    } else {
      vals.push(start);
      const is = vals.length;
      vals.push(end);
      const ie = vals.length;
      busyClause = `
        AND NOT EXISTS (
          SELECT 1
          FROM bookings b
          JOIN booking_dates bd ON bd.booking_id = b.id
          WHERE b.provider_id = p.id
            AND b.status IN ('confirmed','active')
            AND bd.date BETWEEN $${is}::date AND $${ie}::date
        )
        AND NOT EXISTS (
          SELECT 1
          FROM provider_blocked_dates d
          WHERE d.provider_id = p.id
            AND d.date BETWEEN $${is}::date AND $${ie}::date
        )
      `;
    }

    const sql = `
      SELECT p.id, p.name, p.type, p.location, p.city_slugs, p.phone, p.email, p.photo, p.languages, p.social AS telegram
      FROM providers p
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ${busyClause}
      ORDER BY p.name ASC
      LIMIT $${vals.push(limit)};
    `;
    const { rows } = await pool.query(sql, vals);
    res.json({ items: rows });
  } catch (e) {
    console.error("GET /api/providers/available error:", e);
    res.status(500).json({ error: "Failed to get available providers" });
  }
});

/* -------------------- AUTH / PROFILE / SERVICES / CALENDAR -------------------- */

router.post("/register", registerProvider);
router.post("/login", loginProvider);

router.get("/profile", authenticateToken, requireProvider, getProviderProfile);
router.put("/profile", authenticateToken, requireProvider, updateProviderProfile);
router.put("/password", authenticateToken, requireProvider, changeProviderPassword);

router.get("/stats", authenticateToken, requireProvider, getProviderStats);

router.get("/services", authenticateToken, requireProvider, getServices);
router.post("/services", authenticateToken, requireProvider, addService);
router.put("/services/:id", authenticateToken, requireProvider, updateService);
router.delete("/services/:id", authenticateToken, requireProvider, deleteService);
router.patch("/services/:id/images", authenticateToken, requireProvider, updateServiceImagesOnly);

router.get("/booked-dates",  authenticateToken, requireProvider, getBookedDates);
router.get("/blocked-dates", authenticateToken, requireProvider, getBlockedDates);
router.post("/blocked-dates", authenticateToken, requireProvider, saveBlockedDates);

router.get("/booked-details", authenticateToken, requireProvider, async (req, res) => {
  try {
    const providerId = req.user.id;
    const q = await pool.query(
      `SELECT
         bd.date::text AS date,
         COALESCE(rp.name, c.name)   AS name,
         COALESCE(rp.phone, c.phone) AS phone,
         CASE WHEN rp.id IS NOT NULL THEN rp.social ELSE c.telegram END AS telegram,
         CASE WHEN rp.id IS NOT NULL THEN 'provider' ELSE 'client' END   AS role,
         COALESCE(rp.id, c.id) AS "profileId",
         CASE
           WHEN rp.id IS NOT NULL THEN '/profile/provider/' || rp.id
           ELSE '/profile/client/'   || c.id
         END AS "profileUrl"
       FROM booking_dates bd
       JOIN bookings b   ON b.id = bd.booking_id
       LEFT JOIN clients   c  ON c.id = b.client_id
       LEFT JOIN providers rp ON rp.id = b.requester_provider_id
       WHERE b.provider_id = $1
         AND b.status IN ('confirmed','active')
         AND bd.date >= CURRENT_DATE
       ORDER BY bd.date, name`,
      [providerId]
    );
    res.json(q.rows);
  } catch (e) {
    console.error("providers/booked-details error:", e);
    res.status(500).json({ message: "booked-details error" });
  }
});

router.get("/calendar", authenticateToken, requireProvider, async (req, res) => {
  try {
    const providerId = req.user.id;
    const [booked, blocked, details] = await Promise.all([
      pool.query(
        `SELECT DISTINCT bd.date::text AS date
           FROM booking_dates bd
           JOIN bookings b ON b.id = bd.booking_id
          WHERE b.provider_id = $1
            AND b.status IN ('confirmed','active')
            AND bd.date >= CURRENT_DATE
          ORDER BY 1`,
        [providerId]
      ),
      pool.query(
        `SELECT date::text AS date
           FROM provider_blocked_dates
          WHERE provider_id = $1
          ORDER BY 1`,
        [providerId]
      ),
      pool.query(
        `SELECT
           bd.date::text AS date,
           COALESCE(rp.name, c.name)   AS name,
           COALESCE(rp.phone, c.phone) AS phone,
           CASE WHEN rp.id IS NOT NULL THEN rp.social ELSE c.telegram END AS telegram,
           CASE WHEN rp.id IS NOT NULL THEN 'provider' ELSE 'client' END   AS role,
           COALESCE(rp.id, c.id) AS "profileId",
           CASE
             WHEN rp.id IS NOT NULL THEN '/profile/provider/' || rp.id
             ELSE '/profile/client/' || c.id
           END AS "profileUrl"
         FROM booking_dates bd
         JOIN bookings b   ON b.id = bd.booking_id
         LEFT JOIN clients   c  ON c.id = b.client_id
         LEFT JOIN providers rp ON rp.id = b.requester_provider_id
         WHERE b.provider_id = $1
           AND b.status IN ('confirmed','active')
           AND bd.date >= CURRENT_DATE
         ORDER BY bd.date, name`,
        [providerId]
      ),
    ]);
    res.json({
      booked: booked.rows,
      blocked: blocked.rows,
      bookedDetails: details.rows,
    });
  } catch (e) {
    console.error("providers/calendar error:", e);
    res.status(500).json({ message: "calendar error" });
  }
});

router.get("/:providerId(\\d+)/calendar", getCalendarPublic);

/* -------------------- FAVORITES -------------------- */

router.get   ("/favorites",            authenticateToken, requireProvider, listProviderFavorites);
router.post  ("/favorites/toggle",     authenticateToken, requireProvider, toggleProviderFavorite);
router.delete("/favorites/:serviceId", authenticateToken, requireProvider, removeProviderFavorite);

/* -------------------- SUBMIT SERVICE TO MODERATION -------------------- */

router.post("/services/:id/submit",
  authenticateToken,
  requireProvider,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { rows } = await pool.query(
        `UPDATE services
           SET status='pending',
               submitted_at = NOW(),
               updated_at   = NOW()
         WHERE id=$1
           AND provider_id=$2
           AND status IN ('draft','rejected')
         RETURNING id, status, submitted_at`,
        [id, req.user.id]
      );
      if (!rows.length) {
        return res.status(409).json({ message: "Service must be in draft/rejected to submit" });
      }
      try { await notifyModerationNew({ service: rows[0].id }); } catch {}
      return res.json({ ok: true, service: rows[0] });
    } catch (e) { next(e); }
  }
);

router.get("/:id(\\d+)", getProviderPublicById);

module.exports = router;
