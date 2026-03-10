// backend/routes/adminProvidersRoutes.js

const express = require("express");
const router = express.Router();
const pool = require("../db");
const authenticateToken = require("../middleware/authenticateToken");

// простая проверка админа (в токене должен быть is_admin=true)
// Проверка админа, согласованная с фронтом (Header.jsx)
function requireAdmin(req, res, next) {
  try {
    const u = req.user || {};
    const roles = []
      .concat(u.role || [])
      .concat(u.roles || [])
      .flatMap((r) => String(r).split(","))
      .map((s) => s.trim().toLowerCase());
    const perms = []
      .concat(u.permissions || u.perms || [])
      .map((x) => String(x).toLowerCase());

    const isAdmin =
      u.is_admin === true ||
      u.moderator === true ||
      roles.some((r) => ["admin", "moderator", "super", "root"].includes(r)) ||
      perms.some((x) => ["moderation", "admin:moderation"].includes(x));

    if (!isAdmin) {
      return res.status(403).json({ error: "Admin only" });
    }
    return next();
  } catch (e) {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

/**
 * GET /api/admin/providers-table
 * Параметры:
 *   - q (поиск по имени/email/телефону/telegram/type/location/social/chat_id)
 *   - type (guide|transport|agent|hotel)
 *   - limit (по умолчанию 50)
 *   - cursor_created_at (ISO) + cursor_id (для пагинации по курсору вниз)
 */
router.get("/providers-table", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { q, type, limit = 50, cursor_created_at, cursor_id } = req.query;

    const where = [];
    const params = [];
    let idx = 1;

    if (q && q.trim()) {
      where.push(`
        (
          LOWER(COALESCE(p.name, '')) ILIKE $${idx}
          OR LOWER(COALESCE(p.email, '')) ILIKE $${idx}
          OR COALESCE(p.phone, '') ILIKE $${idx}
          OR LOWER(COALESCE(p.type, '')) ILIKE $${idx}
          OR LOWER(COALESCE(p.location, '')) ILIKE $${idx}
          OR LOWER(COALESCE(p.social::text, '')) ILIKE $${idx}
          OR COALESCE(CAST(p.telegram_chat_id AS text), '') ILIKE $${idx}
        )
      `);
      params.push(`%${String(q).trim().toLowerCase()}%`);
      idx++;
    }

    if (type && String(type).trim()) {
      where.push(`p.type = $${idx}`);
      params.push(String(type).trim());
      idx++;
    }

    // пагинация курсором: сначала по created_at desc, затем по id desc
    if (cursor_created_at && cursor_id) {
      where.push(`(p.created_at, p.id) < ($${idx}::timestamptz, $${idx + 1}::bigint)`);
      params.push(new Date(cursor_created_at).toISOString(), cursor_id);
      idx += 2;
    }

    const sql = `
      SELECT
        p.id,
        p.name,
        p.type,
        p.email,
        p.phone,
        p.location,
        p.languages,
        p.social,
        p.created_at,
        p.updated_at,
        p.city_slugs,
        p.telegram_chat_id,
        p.photo
      FROM providers p
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT $${idx}
    `;
    params.push(Math.min(Number(limit) || 50, 200));

    const rows = (await pool.query(sql, params)).rows;

    let nextCursor = null;
    if (rows.length) {
      const last = rows[rows.length - 1];
      nextCursor = {
        cursor_created_at: last.created_at,
        cursor_id: last.id,
      };
    }

    return res.type("application/json").json({ items: rows, nextCursor });
  } catch (e) {
    console.error("GET /api/admin/providers-table error:", e);
    return res.status(500).json({ error: "Failed to load providers table" });
  }
});

/**
 * GET /api/admin/providers-table/new-count?since=ISO
 * Возвращает число провайдеров, созданных после метки времени.
 */
router.get("/providers-table/new-count", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { since } = req.query;
    if (!since) return res.json({ count: 0 });

    const sql = `SELECT COUNT(*)::int AS count FROM providers WHERE created_at > $1`;
    const { rows } = await pool.query(sql, [new Date(since).toISOString()]);

    return res.type("application/json").json({ count: rows[0]?.count || 0 });
  } catch (e) {
    console.error("GET /api/admin/providers-table/new-count error:", e);
    return res.status(500).json({ error: "Failed to load providers new count" });
  }
});

/**
 * GET /api/admin/clients-table
 * Параметры:
 *   - q (поиск по имени/email/телефону/telegram/chat_id)
 *   - limit (по умолчанию 50)
 *   - cursor_created_at (ISO) + cursor_id (для пагинации по курсору вниз)
 */
router.get("/clients-table", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { q, limit = 50, cursor_created_at, cursor_id } = req.query;

    const where = [];
    const params = [];
    let idx = 1;

    if (q && String(q).trim()) {
      const needle = `%${String(q).trim().toLowerCase()}%`;
      where.push(`
        (
          LOWER(COALESCE(c.name, '')) ILIKE $${idx}
          OR LOWER(COALESCE(c.email, '')) ILIKE $${idx}
          OR COALESCE(c.phone, '') ILIKE $${idx}
          OR LOWER(COALESCE(c.telegram, '')) ILIKE $${idx}
          OR COALESCE(CAST(c.telegram_chat_id AS text), '') ILIKE $${idx}
        )
      `);
      params.push(needle);
      idx++;
    }

    if (cursor_created_at && cursor_id) {
      where.push(`(c.created_at, c.id) < ($${idx}::timestamptz, $${idx + 1}::bigint)`);
      params.push(new Date(cursor_created_at).toISOString(), cursor_id);
      idx += 2;
    }

    const sql = `
      SELECT
        c.id,
        c.name,
        c.email,
        c.phone,
        c.telegram,
        c.telegram_chat_id,
        c.avatar_url,
        c.created_at,
        c.updated_at
      FROM clients c
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT $${idx}
    `;
    params.push(Math.min(Number(limit) || 50, 200));

    const rows = (await pool.query(sql, params)).rows;

    let nextCursor = null;
    if (rows.length) {
      const last = rows[rows.length - 1];
      nextCursor = {
        cursor_created_at: last.created_at,
        cursor_id: last.id,
      };
    }

    return res.type("application/json").json({ items: rows, nextCursor });
  } catch (e) {
    console.error("GET /api/admin/clients-table error:", e);
    return res.status(500).json({ error: "Failed to load clients table" });
  }
});

/**
 * GET /api/admin/clients-table/new-count?since=ISO
 * Возвращает число клиентов, созданных после метки времени.
 */
router.get("/clients-table/new-count", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { since } = req.query;
    if (!since) return res.json({ count: 0 });

    const sql = `SELECT COUNT(*)::int AS count FROM clients WHERE created_at > $1`;
    const { rows } = await pool.query(sql, [new Date(since).toISOString()]);

    return res.type("application/json").json({ count: rows[0]?.count || 0 });
  } catch (e) {
    console.error("GET /api/admin/clients-table/new-count error:", e);
    return res.status(500).json({ error: "Failed to load clients new count" });
  }
});

module.exports = router;
