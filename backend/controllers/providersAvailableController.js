// backend/controllers/providersAvailableController.js
const pool = require("../db");

function asDate(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

module.exports = async function providersAvailable(req, res) {
  try {
    const { type = "", location = "", date = "", language = "", q = "", limit = 50 } = req.query;

    const kind = String(type || "").toLowerCase().trim();
    if (!kind) return res.status(400).json({ error: "type required" });

    const city = String(location || "").trim();
    const day = asDate(date);
    if (!city || !day) return res.json({ items: [] });

    const qLike = `%${String(q).trim()}%`;
    const cityNorm = city.toLowerCase();
    const lim = Math.max(1, Math.min(100, Number(limit) || 50));

    // Таблицы: providers, provider_blocked_dates, bookings
    const sql = `
      WITH base AS (
        SELECT p.*
        FROM providers p
        WHERE LOWER(p.type) = $1
          AND (LOWER(p.location) = $2 OR p.location ILIKE $3)
          AND ($4 = '' OR p.name ILIKE $5)
      ),
      not_blocked AS (
        SELECT b.*
        FROM base b
        WHERE NOT EXISTS (
          SELECT 1
          FROM provider_blocked_dates d
          WHERE d.provider_id = b.id AND d.day = $6
        )
      ),
      not_booked AS (
        SELECT nb.*
        FROM not_blocked nb
        WHERE NOT EXISTS (
          SELECT 1
          FROM bookings bk
          WHERE bk.provider_id = nb.id
            AND $6 BETWEEN bk.date_from AND bk.date_to
            AND COALESCE(bk.status, 'pending') IN ('pending', 'confirmed', 'accepted')
        )
      ),
      by_lang AS (
        SELECT *
        FROM not_booked x
        WHERE
          $7 = '' OR
          ( (x.languages::text ILIKE '%' || $7 || '%')
            OR (x.languages @> to_jsonb(ARRAY[$7]::text[])) )
      )
      SELECT
        id, name, type, location, phone, email,
        COALESCE(price_per_day, 0) AS price_per_day,
        COALESCE(currency, 'USD')  AS currency,
        languages
      FROM by_lang
      ORDER BY COALESCE(rating, 0) DESC, name ASC
      LIMIT $8
    `;

    const params = [
      kind, cityNorm, `%${cityNorm}%`,
      String(q).trim(), qLike,
      day,
      String(language || "").trim().toLowerCase(),
      lim,
    ];

    const { rows } = await pool.query(sql, params);
    const items = rows.map(r => ({
      id: r.id,
      name: r.name,
      phone: r.phone || "",
      email: r.email || "",
      location: r.location || "",
      price_per_day: Number(r.price_per_day) || 0,
      currency: r.currency || "USD",
      languages: r.languages || [],
    }));
    return res.json({ items });
  } catch (e) {
    console.error("GET /api/providers/available error:", e);
    return res.status(500).json({ error: "failed" });
  }
};
