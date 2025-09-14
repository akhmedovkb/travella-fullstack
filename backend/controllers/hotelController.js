// backend/controllers/hotelController.js
const axios = require("axios");

// ----- простейший PG-хелпер -----
// если у тебя уже есть общий модуль БД — подключи его вместо этого блока
const { Pool } = require("pg");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
});
const db = { query: (q, p) => pool.query(q, p) };

// ----------------- ТВОИ КЭШ/УТИЛИТЫ (оставляем как у тебя) -----------------
// ... здесь твои memKey(), cache, getCached()/setCached(), dedup() и т.п. ...

// ----------------- SEARCH: сперва — БД, затем (как раньше) внешние источники -----------------
async function searchHotels(req, res) {
  const q = String(req.query.query || "").trim();
  if (q.length < 2) return res.json([]);

  const like = `%${q}%`;

  try {
    // 1) Наши сохранённые отели
    const sql = `
      SELECT id, name, COALESCE(city, location) AS city, country
      FROM hotels
      WHERE name ILIKE $1 OR COALESCE(city, location, '') ILIKE $1
      ORDER BY name
      LIMIT 20
    `;
    const { rows } = await db.query(sql, [like]);

    const own = rows.map(r => ({
      id: r.id,
      name: r.name,
      city: r.city || null,
      country: r.country || null,
      label: r.name,
      city_local: r.city || null,
      city_en: r.city || null,
      provider: "local",
    }));

    // Если нашли в своей БД — этого обычно достаточно для автодополнения
    if (own.length >= 10) return res.json(own);

    // 2) (опционально) добиваем результат твоим прежним объединённым поиском
    //    ... здесь твоя логика через axios + кэш ...
    //    предположим, она вернёт массив external[]
    const external = []; // если не используешь, оставь пусто

    const out = dedup([...own, ...external]);
    return res.json(out);
  } catch (e) {
    console.error("hotels.search error", e);
    return res.status(500).json([]);
  }
}

// ----------------- CREATE -----------------
async function createHotel(req, res) {
  try {
    const p = req.body || {};
    const now = new Date();

    const sql = `
      INSERT INTO hotels
      (name, country, city, address, currency,
       rooms, extra_bed_price, taxes, amenities, services, images,
       created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,
              $6,$7,$8,$9,$10,$11,
              $12,$12)
      RETURNING id
    `;

    const params = [
      (p.name || "").trim(),
      p.country || null,
      p.city || null,
      p.address || null,
      p.currency || "UZS",
      JSON.stringify(p.rooms || []),
      p.extraBedPrice ?? null,
      JSON.stringify(p.taxes || null),
      Array.isArray(p.amenities) ? p.amenities : [],
      Array.isArray(p.services) ? p.services : [],
      JSON.stringify(p.images || []),
      now,
    ];

    const { rows } = await db.query(sql, params);
    return res.json({ id: rows[0].id });
  } catch (e) {
    console.error("hotels.create error", e);
    return res.status(500).json({ error: "create_failed" });
  }
}

// ----------------- GET ONE -----------------
async function getHotel(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "bad_id" });

  try {
    const { rows } = await db.query(
      `SELECT *
         FROM hotels
        WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "not_found" });
    return res.json(rows[0]);
  } catch (e) {
    console.error("hotels.get error", e);
    return res.status(500).json({ error: "read_failed" });
  }
}

// ----------------- LIST (простая пагинация) -----------------
async function listHotels(req, res) {
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "20", 10)));
  const offset = (page - 1) * limit;

  try {
    const { rows } = await db.query(
      `SELECT id, name, country, COALESCE(city, location) AS city, stars, created_at, updated_at
         FROM hotels
        ORDER BY id DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return res.json({ items: rows, page, limit });
  } catch (e) {
    console.error("hotels.list error", e);
    return res.status(500).json({ error: "list_failed" });
  }
}

module.exports = {
  searchHotels,
  createHotel,
  getHotel,
  listHotels,
};
