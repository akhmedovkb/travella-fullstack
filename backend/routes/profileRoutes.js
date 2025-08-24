// backend/routes/profileRoutes.js
const express = require("express");
const router = express.Router();
const db = require("../db");

/** утилита: безопасно привести разные варианты полей к avatar_url */
function pickAvatarUrl(row) {
  const v =
    row?.avatar_url ||
    row?.avatarUrl ||
    row?.avatar ||
    null;

  if (!v) return null;
  // если это уже http(s) или data: — отдаем как есть
  if (/^https?:\/\//i.test(v) || /^data:/i.test(v)) return v;
  // иначе просто вернем строку (в некоторых инсталляциях avatar хранится как путь)
  return String(v);
}

/** Профиль клиента */
router.get("/client/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad_id" });

    const u = await db.query(
      `SELECT id, name, phone, telegram, email, avatar_url, avatar
         FROM clients
        WHERE id = $1
        LIMIT 1`,
      [id]
    );
    if (!u.rowCount) return res.status(404).json({ error: "not_found" });

    const row = u.rows[0];
    const avatar_url = pickAvatarUrl(row);

    // рейтинг + количество отзывов (если у вас таблица reviews уже есть)
    const rsum = await db.query(
      `SELECT COALESCE(AVG(rating), 0)::float  AS avg,
              COUNT(*)::int                  AS count
         FROM reviews
        WHERE subject_type = 'client' AND subject_id = $1`,
      [id]
    );
    const rating = rsum.rows[0] || { avg: 0, count: 0 };

    // последние отзывы (по желанию можно убрать LIMIT)
    const rlist = await db.query(
      `SELECT id, author_name, rating, text, created_at
         FROM reviews
        WHERE subject_type = 'client' AND subject_id = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [id]
    );

    res.json({
      id: row.id,
      name: row.name,
      phone: row.phone,
      telegram: row.telegram,
      email: row.email,
      avatar_url,
      rating,
      reviews: rlist.rows,
    });
  } catch (e) {
    console.error("profile client error:", e);
    res.status(500).json({ error: "profile_load_failed" });
  }
});

/** Профиль провайдера (если уже есть — оставьте свой код) */
router.get("/provider/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad_id" });

    const u = await db.query(
      `SELECT id, name, phone, social as telegram, email, avatar_url, avatar
         FROM providers
        WHERE id = $1
        LIMIT 1`,
      [id]
    );
    if (!u.rowCount) return res.status(404).json({ error: "not_found" });

    const row = u.rows[0];
    const avatar_url = pickAvatarUrl(row);

    const rsum = await db.query(
      `SELECT COALESCE(AVG(rating), 0)::float  AS avg,
              COUNT(*)::int                  AS count
         FROM reviews
        WHERE subject_type = 'provider' AND subject_id = $1`,
      [id]
    );
    const rating = rsum.rows[0] || { avg: 0, count: 0 };

    const rlist = await db.query(
      `SELECT id, author_name, rating, text, created_at
         FROM reviews
        WHERE subject_type = 'provider' AND subject_id = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [id]
    );

    res.json({
      id: row.id,
      name: row.name,
      phone: row.phone,
      telegram: row.telegram,
      email: row.email,
      avatar_url,
      rating,
      reviews: rlist.rows,
    });
  } catch (e) {
    console.error("profile provider error:", e);
    res.status(500).json({ error: "profile_load_failed" });
  }
});

module.exports = router;
