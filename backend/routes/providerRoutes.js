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
  // календарь
  getBookedDates,
  getBlockedDates,
  saveBlockedDates,
  getCalendarPublic,
  // прочее
  getProviderPublicById,
  getProviderStats,
  listProviderFavorites,
  toggleProviderFavorite,
  removeProviderFavorite,
} = require("../controllers/providerController");
const { notifyModerationNew } = require("../utils/telegram");

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
  const type = String(qs.type || "").trim();                      // guide | transport | agent | ...
  const city = String(qs.city || qs.location || "").trim();       // Samarkand / Tashkent ...
  const q = String(qs.q || "").trim();
  const language = String(qs.language || qs.lang || "").trim();   // 'en','ru',...
  const date = String(qs.date || "").trim();                      // YYYY-MM-DD
  const start = String(qs.start || "").trim();                    // YYYY-MM-DD
  const end = String(qs.end || "").trim();                        // YYYY-MM-DD
  const limit = Math.min(Math.max(parseInt(qs.limit, 10) || 30, 1), 100);
  return { type, city, q, language, date, start, end, limit };
}

/**
 * Универсальный конструктор WHERE:
 * - p.location: поддержка text | text[] | jsonb-массив
 * - p.languages: поддержка jsonb-массив | text[] | text
 */
function buildBaseWhere({ type, city, q, language }, vals) {
  const where = [];

  // тип провайдера
  if (type) {
    vals.push(type);
    where.push(`LOWER(p.type) = LOWER($${vals.length})`);
  }

  // город
  if (city) {
    vals.push(city);
    const iEq = vals.length;
    vals.push(`%${city}%`);
    const iLike = vals.length;

    where.push(`
      (
        -- location как одиночная строка (text)
        (pg_typeof(p.location)::text = 'text'
          AND (LOWER(p.location::text) = LOWER($${iEq}) OR p.location::text ILIKE $${iLike}))

        OR
        -- location как массив строк (text[])
        (pg_typeof(p.location)::text = 'text[]'
          AND EXISTS (
            SELECT 1
            FROM unnest(p.location::text[]) loc
            WHERE LOWER(loc) = LOWER($${iEq}) OR loc ILIKE $${iLike}
          ))

        OR
        -- location как jsonb-массив строк: ["Samarkand", ...]
        (pg_typeof(p.location)::text = 'jsonb'
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(p.location) loc(val)
            WHERE LOWER(loc.val) = LOWER($${iEq}) OR loc.val ILIKE $${iLike}
          ))
      )
    `);
  }

  // свободный текст: имя/почта/телефон
  if (q) {
    vals.push(`%${q}%`);
    const i = vals.length;
    where.push(`(p.name ILIKE $${i} OR p.email ILIKE $${i} OR p.phone ILIKE $${i})`);
  }

  // язык — три независимых ветки по фактическому типу колонки
  if (language) {
    vals.push(language);
    const iLang = vals.length;

    where.push(`
      (
        -- jsonb-массив: ["en","ru"] или ["English","Русский"]
        (pg_typeof(p.languages)::text = 'jsonb' AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(p.languages) lang(code)
          WHERE LOWER(lang.code) = LOWER($${iLang})
        ))

        OR

        -- text[] массив: {'en','ru'}
        (pg_typeof(p.languages)::text = 'text[]' AND EXISTS (
          SELECT 1
          FROM unnest(p.languages::text[]) l(code)
          WHERE LOWER(l.code) = LOWER($${iLang})
        ))

        OR

        -- одиночная строка: 'en'
        (pg_typeof(p.languages)::text = 'text' AND LOWER(p.languages::text) = LOWER($${iLang}))
      )
    `);
  }

  return where;
}

/** GET /api/providers/search */
router.get("/search", async (req, res) => {
  try {
    const { type, city, q, language, limit } = parseQuery(req.query);
    const vals = [];
    const where = buildBaseWhere({ type, city, q, language }, vals);

    const sql = `
      SELECT p.id, p.name, p.type, p.location, p.phone, p.email, p.photo, p.languages, p.social AS telegram
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

    // без даты — как /search
    if (!date && !(start && end)) {
      const vals = [];
      const where = buildBaseWhere({ type, city, q, language }, vals);
      const sql = `
        SELECT p.id, p.name, p.type, p.location, p.phone, p.email, p.photo, p.languages, p.social AS telegram
        FROM providers p
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY p.name ASC
        LIMIT $${vals.push(limit)};
      `;
      const { rows } = await pool.query(sql, vals);
      return res.json({ items: rows });
    }

    const vals = [];
    const where = buildBaseWhere({ type, city, q, language }, vals);

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
      SELECT p.id, p.name, p.type, p.location, p.phone, p.email, p.photo, p.languages, p.social AS telegram
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

// Детализация забронированных дат в будущем
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

// Сводка календаря (публичный — ниже)
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

// публичный календарь конкретного провайдера
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

/* -------------------- PUBLIC PROVIDER CARD -------------------- */

router.get("/:id(\\d+)", getProviderPublicById);

module.exports = router;
