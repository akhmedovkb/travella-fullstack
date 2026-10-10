const pool = require("../db");

function asDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

function asTime(value) {
  const match = String(value || "").match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? `${match[1]}:${match[2]}` : null;
}

async function ensureBookingTimeSlotsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS booking_time_slots (
      id BIGSERIAL PRIMARY KEY,
      booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      slot_date DATE NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT booking_time_slots_valid_range CHECK (end_time > start_time),
      CONSTRAINT booking_time_slots_unique UNIQUE (booking_id, slot_date, start_time, end_time)
    )
  `);
}

module.exports = async function providersAvailable(req, res) {
  try {
    const {
      type = "",
      location = "",
      date = "",
      language = "",
      q = "",
      limit = 50,
      start_time: startTimeRaw = "",
      end_time: endTimeRaw = "",
    } = req.query;

    const kind = String(type || "").toLowerCase().trim();
    if (!kind) return res.status(400).json({ error: "type required" });

    const city = String(location || "").trim();
    const day = asDate(date);
    if (!city || !day) return res.json({ items: [] });

    const startTime = asTime(startTimeRaw);
    const endTime = asTime(endTimeRaw);
    const hasTimeRange = Boolean(startTime && endTime && endTime > startTime);
    const qLike = `%${String(q).trim()}%`;
    const cityNorm = city.toLowerCase();
    const lim = Math.max(1, Math.min(100, Number(limit) || 50));

    await ensureBookingTimeSlotsTable();

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
          WHERE d.provider_id = b.id AND d.date = $6
        )
      ),
      not_booked AS (
        SELECT nb.*
        FROM not_blocked nb
        WHERE NOT EXISTS (
          SELECT 1
          FROM bookings bk
          JOIN booking_dates bd ON bd.booking_id = bk.id AND bd.date = $6
          LEFT JOIN booking_time_slots slot ON slot.booking_id = bk.id AND slot.slot_date = $6
          WHERE bk.provider_id = nb.id
            AND COALESCE(bk.status, 'pending') IN ('confirmed', 'active', 'accepted')
            AND (
              slot.id IS NULL
              OR $9::boolean = FALSE
              OR (slot.start_time < $11::time AND slot.end_time > $10::time)
            )
        )
      ),
      by_lang AS (
        SELECT *
        FROM not_booked x
        WHERE
          $7 = '' OR
          ((x.languages::text ILIKE '%' || $7 || '%')
            OR (x.languages @> to_jsonb(ARRAY[$7]::text[])))
      )
      SELECT
        id, name, type, location, phone, email,
        COALESCE(price_per_day, 0) AS price_per_day,
        COALESCE(currency, 'USD') AS currency,
        languages
      FROM by_lang
      ORDER BY COALESCE(rating, 0) DESC, name ASC
      LIMIT $8
    `;

    const params = [
      kind,
      cityNorm,
      `%${cityNorm}%`,
      String(q).trim(),
      qLike,
      day,
      String(language || "").trim().toLowerCase(),
      lim,
      hasTimeRange,
      startTime || "00:00",
      endTime || "23:59",
    ];

    const { rows } = await pool.query(sql, params);
    const items = rows.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone || "",
      email: row.email || "",
      location: row.location || "",
      price_per_day: Number(row.price_per_day) || 0,
      currency: row.currency || "USD",
      languages: row.languages || [],
      availability: hasTimeRange
        ? { date: day, start_time: startTime, end_time: endTime }
        : { date: day },
    }));
    return res.json({ items });
  } catch (error) {
    console.error("GET /api/providers/available error:", error);
    return res.status(500).json({ error: "failed" });
  }
};
