/* eslint-disable no-console */
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
});
const db = { query: (q, p) => pool.query(q, p) };

let ensured = false;
async function ensureTable() {
  if (ensured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS hotel_inspections (
      id           SERIAL PRIMARY KEY,
      hotel_id     INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
      author_role  TEXT,
      author_id    TEXT,
      review       TEXT NOT NULL,
      pros         TEXT,
      cons         TEXT,
      features     TEXT,
      media        JSONB NOT NULL DEFAULT '[]'::jsonb,
      likes        INTEGER NOT NULL DEFAULT 0,
      created_at   TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS hotel_inspections_hotel_id_idx ON hotel_inspections(hotel_id);
    CREATE INDEX IF NOT EXISTS hotel_inspections_likes_idx ON hotel_inspections(likes);
    CREATE INDEX IF NOT EXISTS hotel_inspections_created_at_idx ON hotel_inspections(created_at);
  `);
  ensured = true;
}

/** POST /api/hotels/:hotelId/inspections */
async function createInspection(req, res) {
  try {
    await ensureTable();
    const hotelId = Number(req.params.hotelId);
    if (!Number.isFinite(hotelId)) return res.status(400).json({ error: "bad_hotel_id" });

    const p = req.body || {};
    const media = Array.isArray(p.media) ? p.media : [];

    const { rows } = await db.query(
      `INSERT INTO hotel_inspections
         (hotel_id, author_role, author_id, review, pros, cons, features, media)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [
        hotelId,
        // если есть ваша авторизация — можно проставлять роли/ид
        (req.user?.role || p.authorRole || null),
        (req.user?.id || p.authorId || null),
        String(p.review || "").trim(),
        p.pros ?? null,
        p.cons ?? null,
        p.features ?? null,
        JSON.stringify(media),
      ],
    );

    return res.json({ id: rows[0].id });
  } catch (e) {
    console.error("inspections.create error:", e);
    return res.status(500).json({ error: "create_failed" });
  }
}

/** GET /api/hotels/:hotelId/inspections?sort=top|new */
async function listInspections(req, res) {
  try {
    await ensureTable();
    const hotelId = Number(req.params.hotelId);
    if (!Number.isFinite(hotelId)) return res.status(400).json({ error: "bad_hotel_id" });

    const sort = String(req.query.sort || "top").toLowerCase();
    const order =
      sort === "new" ? `ORDER BY created_at DESC, id DESC` : `ORDER BY likes DESC, created_at DESC, id DESC`;

    const { rows } = await db.query(
      `SELECT id, hotel_id, author_role, author_id, review, pros, cons, features, media, likes, created_at
         FROM hotel_inspections
        WHERE hotel_id = $1
        ${order}
        LIMIT 100`,
      [hotelId],
    );

    return res.json({ items: rows, count: rows.length });
  } catch (e) {
    console.error("inspections.list error:", e);
    return res.status(500).json({ error: "list_failed" });
  }
}

/** POST /api/hotel-inspections/:inspectionId/like */
async function likeInspection(req, res) {
  try {
    await ensureTable();
    const id = Number(req.params.inspectionId);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad_id" });

    const { rows } = await db.query(
      `UPDATE hotel_inspections
          SET likes = likes + 1
        WHERE id = $1
      RETURNING id, likes`,
      [id],
    );
    if (!rows.length) return res.status(404).json({ error: "not_found" });
    return res.json(rows[0]);
  } catch (e) {
    console.error("inspections.like error:", e);
    return res.status(500).json({ error: "like_failed" });
  }
}

module.exports = {
  createInspection,
  listInspections,
  likeInspection,
};
