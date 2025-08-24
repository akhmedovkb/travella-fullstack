// backend/routes/profileRoutes.js
const express = require("express");
const router = express.Router();
const db = require("../db");

/** Нормализуем аватар в строку, пригодную для <img src> */
function normalizeAvatar(row) {
  const v = row?.avatar_url ?? row?.avatar ?? null;
  if (!v) return null;

  // Уже корректный URL / data URI
  if (typeof v === "string" && (/^https?:\/\//i.test(v) || /^data:/i.test(v))) return v;

  // Похоже на base64 без префикса — превращаем в data:
  if (typeof v === "string" && /^[A-Za-z0-9+/=\s]+$/.test(v) && v.length > 100) {
    return `data:image/jpeg;base64,${v.replace(/\s+/g, "")}`;
  }

  // bytea → Buffer (node-postgres обычно даёт Buffer)
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(v)) {
    return `data:image/jpeg;base64,${Buffer.from(v).toString("base64")}`;
  }

  // Иногда в avatar_url лежит JSON вида {"url":"..."}
  if (typeof v === "string") {
    try {
      const j = JSON.parse(v);
      const url = j?.url ?? j?.src ?? j?.href;
      if (url) return url;
    } catch {}
  }

  // Последняя попытка — отдать как есть (м.б. относительный путь)
  return String(v);
}

/** Профиль клиента */
router.get("/client/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad_id" });

    const q = await db.query(
      `SELECT id, name, phone, telegram, email, avatar_url, avatar
         FROM clients
        WHERE id = $1
        LIMIT 1`,
      [id]
    );
    if (!q.rowCount) return res.status(404).json({ error: "not_found" });

    const row = q.rows[0];
    const avatar_url = normalizeAvatar(row);

    // Отзывы позже подключим; сейчас — безопасные заглушки
    res.json({
      id: row.id,
      name: row.name,
      phone: row.phone,
      telegram: row.telegram,
      email: row.email,
      avatar_url,
      rating: { avg: 0, count: 0 },
      reviews: [],
    });
  } catch (e) {
    console.error("[profile client] error:", e?.stack || e);
    res.status(500).json({ error: "profile_load_failed" });
  }
});

/** Профиль провайдера (для симметрии; также без отзывов) */
router.get("/provider/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad_id" });

    const q = await db.query(
      `SELECT id, name, phone, social AS telegram, email, avatar_url, avatar
         FROM providers
        WHERE id = $1
        LIMIT 1`,
      [id]
    );
    if (!q.rowCount) return res.status(404).json({ error: "not_found" });

    const row = q.rows[0];
    const avatar_url = normalizeAvatar(row);

    res.json({
      id: row.id,
      name: row.name,
      phone: row.phone,
      telegram: row.telegram,
      email: row.email,
      avatar_url,
      rating: { avg: 0, count: 0 },
      reviews: [],
    });
  } catch (e) {
    console.error("[profile provider] error:", e?.stack || e);
    res.status(500).json({ error: "profile_load_failed" });
  }
});

module.exports = router;
