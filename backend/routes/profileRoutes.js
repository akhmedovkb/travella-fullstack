// backend/routes/profileRoutes.js
const express = require("express");
const router = express.Router();
const db = require("../db");

/** Нормализуем аватар в пригодный для <img src> вид */
function pickAvatarUrl(row) {
  const v = row?.avatar_url ?? row?.avatarUrl ?? row?.avatar ?? null;
  if (!v) return null;

  // Уже пригодный URL / data URI
  if (typeof v === "string" && (/^https?:\/\//i.test(v) || /^data:/i.test(v))) return v;

  // Если строка похожа на base64 без префикса — превратим в data:
  if (typeof v === "string" && /^[A-Za-z0-9+/=\s]+$/.test(v) && v.length > 100) {
    return `data:image/jpeg;base64,${v.replace(/\s+/g, "")}`;
  }

  // Если это Buffer (bytea)
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(v)) {
    return `data:image/jpeg;base64,${Buffer.from(v).toString("base64")}`;
  }

  // Иногда хранят JSON вроде {url:"..."}
  if (typeof v === "string") {
    try {
      const obj = JSON.parse(v);
      const url = obj?.url ?? obj?.src ?? obj?.href;
      if (url) return url;
    } catch {}
  }

  // Последняя попытка — просто строка (на случай относительного пути)
  return String(v);
}

/** Безопасно читаем рейтинг/отзывы: если таблицы reviews ещё нет — отдаём пусто */
async function safeReviews(subjectType, subjectId) {
  try {
    const rsum = await db.query(
      `SELECT COALESCE(AVG(rating), 0)::float AS avg,
              COUNT(*)::int                 AS count
         FROM reviews
        WHERE subject_type = $1 AND subject_id = $2`,
      [subjectType, subjectId]
    );

    const rlist = await db.query(
      `SELECT id, author_name, rating, text, created_at
         FROM reviews
        WHERE subject_type = $1 AND subject_id = $2
        ORDER BY created_at DESC
        LIMIT 50`,
      [subjectType, subjectId]
    );

    return { rating: rsum.rows[0] || { avg: 0, count: 0 }, reviews: rlist.rows };
  } catch (e) {
    // Если таблицы/колонок нет — тихо возвращаем заглушки
    if (String(e?.message || e).toLowerCase().includes("reviews")) {
      return { rating: { avg: 0, count: 0 }, reviews: [] };
    }
    throw e;
  }
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
    const { rating, reviews } = await safeReviews("client", id);

    res.json({
      id: row.id,
      name: row.name,
      phone: row.phone,
      telegram: row.telegram,
      email: row.email,
      avatar_url,
      rating,
      reviews,
    });
  } catch (e) {
    console.error("profile client error:", e);
    res.status(500).json({ error: "profile_load_failed" });
  }
});

/** Профиль провайдера (оставил без изменений логики, но с safeReviews/pickAvatarUrl) */
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
    const { rating, reviews } = await safeReviews("provider", id);

    res.json({
      id: row.id,
      name: row.name,
      phone: row.phone,
      telegram: row.telegram,
      email: row.email,
      avatar_url,
      rating,
      reviews,
    });
  } catch (e) {
    console.error("profile provider error:", e);
    res.status(500).json({ error: "profile_load_failed" });
  }
});

module.exports = router;
