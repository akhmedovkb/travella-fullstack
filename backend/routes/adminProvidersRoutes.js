//backend/routes/adminProvidersRoutes.js

const express = require("express");
const router = express.Router();
const pool = require("../db");
const authenticateToken = require("../middleware/authenticateToken");

// простая проверка админа (в токене должен быть is_admin=true)
function requireAdmin(req, res, next) {
  try {
    if (!req.user || !req.user.is_admin) {
      return res.status(403).json({ error: "Admin only" });
    }
    next();
  } catch (e) {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

/**
 * GET /api/admin/providers
 * Параметры:
 *   - q (поиск по имени/email/телефону)
 *   - type (guide|transport|agent|hotel)
 *   - limit (по умолчанию 50)
 *   - cursor_created_at (ISO) + cursor_id (для пагинации по курсору вниз)
 */
router.get("/providers", authenticateToken, requireAdmin, async (req, res) => {
  const { q, type, limit = 50, cursor_created_at, cursor_id } = req.query;

  const where = [];
  const params = [];
  let idx = 1;

  if (q && q.trim()) {
    where.push(`(LOWER(p.name) ILIKE $${idx} OR LOWER(p.email) ILIKE $${idx} OR p.phone ILIKE $${idx})`);
    params.push(`%${q.toLowerCase()}%`);
    idx++;
  }
  if (type && type.trim()) {
    where.push(`p.type = $${idx}`); params.push(type); idx++;
  }

  // пагинация курсором: сначала по created_at desc, затем по id desc
  if (cursor_created_at && cursor_id) {
    where.push(`(p.created_at, p.id) < ($${idx}::timestamptz, $${idx+1}::bigint)`);
    params.push(new Date(cursor_created_at).toISOString(), cursor_id);
    idx += 2;
  }

  const sql = `
    SELECT p.id, p.name, p.type, p.email, p.phone, p.location, p.languages,
           p.created_at, p.updated_at, p.city_slugs, p.telegram_chat_id, p.photo
    FROM providers p
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT $${idx}
  `;
  params.push(Math.min(Number(limit) || 50, 200));

  const rows = (await pool.query(sql, params)).rows;

  // курсор на следующий запрос (последняя строка)
  let nextCursor = null;
  if (rows.length) {
    const last = rows[rows.length - 1];
    nextCursor = { cursor_created_at: last.created_at, cursor_id: last.id };
  }
  res.json({ items: rows, nextCursor });
});

/**
 * GET /api/admin/providers/new-count?since=ISO
 * Возвращает число провайдеров, созданных после метки времени.
 */
router.get("/providers/new-count", authenticateToken, requireAdmin, async (req, res) => {
  const { since } = req.query;
  if (!since) return res.json({ count: 0 });

  const sql = `SELECT COUNT(*)::int AS count FROM providers WHERE created_at > $1`;
  const { rows } = await pool.query(sql, [new Date(since).toISOString()]);
  res.json({ count: rows[0].count });
});

module.exports = router;
