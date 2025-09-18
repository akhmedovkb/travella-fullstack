//backend/routes/providerRoutes.js

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
  // Совместимо со старыми токенами: если role есть — проверяем, если нет — пропускаем.
  if (req.user.role && req.user.role !== "provider") {
    return res.status(403).json({ message: "Только для провайдера" });
  }
  next();
}

// --- PUBLIC SEARCH / AVAILABLE ---------------------------------------------

/** Нормализуем query */
function _parseProviderQuery(qs = {}) {
  const type  = String(qs.type || "").trim();                     // guide | transport | ...
  const city  = String(qs.city || qs.location || "").trim();      // Samarkand / Tashkent ...
  const q     = String(qs.q || "").trim();
  const date  = String(qs.date || "").trim();                     // YYYY-MM-DD
  const start = String(qs.start || "").trim();                    // YYYY-MM-DD
  const end   = String(qs.end || "").trim();                      // YYYY-MM-DD
  const limit = Math.min(Math.max(parseInt(qs.limit, 10) || 30, 1), 100);
  return { type, city, q, date, start, end, limit };
}

/** Общая часть WHERE для фильтров type/city/q */
function _buildBaseWhere({ type, city, q }, vals) {
  const where = [];

  if (type) {
    vals.push(type);
    where.push(`p.type = $${vals.length}`);
  }

  if (city) {
    // location: text[]  → ищем по любому элементу массива
    vals.push(`%${city}%`);
    where.push(`EXISTS (SELECT 1 FROM unnest(p.location) loc WHERE loc ILIKE $${vals.length})`);
  }

  if (q) {
    vals.push(`%${q}%`);
    const idx = vals.length;
    where.push(`(p.name ILIKE $${idx} OR p.email ILIKE $${idx} OR p.phone ILIKE $${idx})`);
  }

  return where;
}


/**
 * Нормализуем query: type, city|location, q, date, limit
 */
function _parseProviderQuery(qs = {}) {
  const type = (qs.type || "").trim();                       // guide | transport | agent | ...
  const city = (qs.city || qs.location || "").trim();        // Samarkand / Tashkent ...
  const q = (qs.q || "").trim();
  const date = (qs.date || "").trim();                       // YYYY-MM-DD
  const limit = Math.min(Math.max(parseInt(qs.limit || 30, 10) || 30, 1), 100);
  return { type, city, q, date, limit };
}

/**
 * GET /api/providers/search
 * Простой поиск без учёта занятости на дату
 */
router.get("/search", async (req, res) => {
  try {
    const { type, city, q, limit } = _parseProviderQuery(req.query);
    const vals = [];
    const where = _buildBaseWhere({ type, city, q }, vals);

    const sql = `
      SELECT p.id, p.name, p.type, p.location, p.phone, p.email, p.photo, p.languages
      FROM providers p
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY p.name ASC
      LIMIT $${vals.push(limit)};`;

    const { rows } = await pool.query(sql, vals);
    return res.json({ items: rows });
  } catch (e) {
    console.error("GET /api/providers/search error:", e);
    return res.status(500).json({ error: "Failed to search providers" });
  }
});

/**
 * GET /api/providers/available
 * Фильтруем по type/city/q и исключаем занятых по:
 * - bookings + booking_dates (status IN confirmed, active)
 * - provider_blocked_dates
 * Поддержка date ИЛИ (start,end) диапазона. Если ни одно не задано — как /search.
 * Если есть вспомогательная provider_busy — можно дополнительно учесть, но не требуется.
 */
router.get("/available", async (req, res) => {
  try {
    const { type, city, q, date, start, end, limit } = _parseProviderQuery(req.query);

    // нет даты — ведём себя как /search (но без router.handle)
    if (!date && !(start && end)) {
      const vals = [];
      const where = _buildBaseWhere({ type, city, q }, vals);
      const sql = `
        SELECT p.id, p.name, p.type, p.location, p.phone, p.email, p.photo, p.languages
        FROM providers p
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY p.name ASC
        LIMIT $${vals.push(limit)};`;
      const { rows } = await pool.query(sql, vals);
      return res.json({ items: rows });
    }

    const vals = [];
    const where = _buildBaseWhere({ type, city, q }, vals);

    // Условие занятости: одиночная дата или интервал
    let busySql;
    if (date) {
      vals.push(date);
      const dIdx = vals.length;

      busySql = `
        AND NOT EXISTS (                -- активные/подтверждённые брони на дату
          SELECT 1
          FROM bookings b
          JOIN booking_dates bd ON bd.booking_id = b.id
          WHERE b.provider_id = p.id
            AND b.status IN ('confirmed','active')
            AND bd.date = $${dIdx}::date
        )
        AND NOT EXISTS (                -- ручные блокировки на дату
          SELECT 1
          FROM provider_blocked_dates d
          WHERE d.provider_id = p.id
            AND d.date = $${dIdx}::date
        )`;
    } else {
      // диапазон обязателен (в эту ветку мы попали по условию выше)
      vals.push(start);
      const sIdx = vals.length;
      vals.push(end);
      const eIdx = vals.length;

      busySql = `
        AND NOT EXISTS (
          SELECT 1
          FROM bookings b
          JOIN booking_dates bd ON bd.booking_id = b.id
          WHERE b.provider_id = p.id
            AND b.status IN ('confirmed','active')
            AND bd.date BETWEEN $${sIdx}::date AND $${eIdx}::date
        )
        AND NOT EXISTS (
          SELECT 1
          FROM provider_blocked_dates d
          WHERE d.provider_id = p.id
            AND d.date BETWEEN $${sIdx}::date AND $${eIdx}::date
        )`;
    }

    const sql = `
      SELECT p.id, p.name, p.type, p.location, p.phone, p.email, p.photo, p.languages
      FROM providers p
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ${busySql}
      ORDER BY p.name ASC
      LIMIT $${vals.push(limit)};`;

    const { rows } = await pool.query(sql, vals);
    return res.json({ items: rows });
  } catch (e) {
    console.error("GET /api/providers/available error:", e);
    return res.status(500).json({ error: "Failed to get available providers" });
  }
});

// Auth
router.post("/register", registerProvider);
router.post("/login", loginProvider);

// Profile
router.get("/profile", authenticateToken, requireProvider, getProviderProfile);
router.put("/profile", authenticateToken, requireProvider, updateProviderProfile);
router.put("/password", authenticateToken, requireProvider, changeProviderPassword);

// Stats
router.get("/stats", authenticateToken, requireProvider, getProviderStats);

// Services CRUD
router.get("/services", authenticateToken, requireProvider, getServices);
router.post("/services", authenticateToken, requireProvider, addService);
router.put("/services/:id", authenticateToken, requireProvider, updateService);
router.delete("/services/:id", authenticateToken, requireProvider, deleteService);
router.patch("/services/:id/images", authenticateToken, requireProvider, updateServiceImagesOnly);

// --- Календарь (важно держать ДО публичного /:providerId/calendar) ---
router.get("/booked-dates",  authenticateToken, requireProvider, getBookedDates);
router.get("/blocked-dates", authenticateToken, requireProvider, getBlockedDates);
router.post("/blocked-dates", authenticateToken, requireProvider, saveBlockedDates);

// Подробности по занятым датам для тултипа
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
         COALESCE(rp.id, c.id)       AS "profileId",
         CASE
           WHEN rp.id IS NOT NULL THEN '/profile/provider/' || rp.id
           ELSE '/profile/client/'   || c.id
         END                         AS "profileUrl"
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


    // формат фронту: плоский массив объектов; фронт сам сгруппирует по date
    res.json(q.rows);
  } catch (e) {
    console.error("providers/booked-details error:", e);
    res.status(500).json({ message: "booked-details error" });
  }
});


// Единый приватный эндпоинт календаря провайдера
// Единый приватный эндпоинт календаря провайдера (даты + детали для тултипа)
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
      booked: booked.rows,         // [{ date }]
      blocked: blocked.rows,       // [{ date }]
      bookedDetails: details.rows, // [{ date, name, phone, telegram, role, profile_id, profile_url }]
    });
  } catch (e) {
    console.error("providers/calendar error:", e);
    res.status(500).json({ message: "calendar error" });
  }
});


// Публичный календарь (для клиентов)
router.get("/:providerId(\\d+)/calendar", getCalendarPublic);

// Favorites
router.get   ("/favorites",            authenticateToken, requireProvider, listProviderFavorites);
router.post  ("/favorites/toggle",     authenticateToken, requireProvider, toggleProviderFavorite);
router.delete("/favorites/:serviceId", authenticateToken, requireProvider, removeProviderFavorite);

// отправить на модерацию
router.post(
  "/services/:id/submit",
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
        // сервис либо не ваш, либо уже в pending/published/archived
        return res.status(409).json({ message: "Service must be in draft/rejected to submit" });
      }
      // TG: уведомить админов о новой услуге в очереди
      try { await notifyModerationNew({ service: rows[0].id }); } catch {}
      return res.json({ ok: true, service: rows[0] });
    } catch (e) { next(e); }
  }
);

// Публичная страница провайдера
router.get("/:id(\\d+)", getProviderPublicById);

module.exports = router;
