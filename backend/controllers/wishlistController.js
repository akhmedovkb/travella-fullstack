// controllers/wishlistController.js
const pool = require("../db");

/** Нормализуем images в массив строк (поддержка jsonb, text[], строки) */
function normalizeImages(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    // может быть JSON-строкой или одиночным URL/base64
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : parsed ? [val] : [];
    } catch {
      return [val];
    }
  }
  if (typeof val === "object") {
    // если пришёл jsonb-объект (например, массив) от pg
    if (Array.isArray(val)) return val;
    return [];
  }
  return [];
}

/**
 * GET /api/wishlist?expand=service
 * Возвращает массив избранного. При expand=service добавляет объект `service`.
 * Формат элемента:
 * {
 *   id, service_id, created_at,
 *   service?: { id, title, images: string[] }
 * }
 */
exports.listWishlist = async (req, res) => {
  try {
    const clientId = req.user.id;
    const expand = String(req.query.expand || "") === "service";

    if (expand) {
      // ВАЖНО: не используем несуществующие поля (s.name).
      // Заголовок берём безопасно: только s.title.
      // Картинки берём через to_jsonb(s)->'images', чтобы не падать, если в схеме нет колонки images.
      const sql = `
        SELECT
          w.id,
          w.service_id,
          w.created_at,
          COALESCE(s.title, 'Service') AS title,
          (to_jsonb(s) -> 'images') AS images_json
        FROM wishlist w
        LEFT JOIN services s ON s.id = w.service_id
        WHERE w.client_id = $1
        ORDER BY w.created_at DESC
      `;
      const { rows } = await pool.query(sql, [clientId]);
      const items = rows.map((r) => ({
        id: r.id,
        service_id: r.service_id,
        created_at: r.created_at,
        service: {
          id: r.service_id,
          title: r.title || "Service",
          images: normalizeImages(r.images_json),
        },
      }));
      return res.json(items);
    } else {
      const { rows } = await pool.query(
        `SELECT id, service_id, created_at
         FROM wishlist
         WHERE client_id = $1
         ORDER BY created_at DESC`,
        [clientId]
      );
      return res.json(rows);
    }
  } catch (e) {
    console.error("listWishlist error", e);
    return res.status(500).json({ error: "wishlist_failed" });
  }
};

/**
 * POST /api/wishlist/toggle
 * Тело: { service_id? , itemId? | id? }
 * - Если передан itemId/id — удаляем запись по её id.
 * - Иначе работаем по service_id: если была — удаляем, если не было — создаём.
 */
exports.toggleWishlist = async (req, res) => {
  try {
    const clientId = req.user.id;
    const body = req.body || {};

    // Вариант 1: удаление по id записи
    const wishlistId = body.id || body.itemId;
    if (wishlistId) {
      const del = await pool.query(
        `DELETE FROM wishlist WHERE id = $1 AND client_id = $2`,
        [wishlistId, clientId]
      );
      return res.json({ removed: del.rowCount > 0, by: "wishlist_id" });
    }

    // Вариант 2: toggle по service_id
    const serviceId = body.service_id;
    if (!serviceId) {
      return res.status(400).json({ error: "service_id required" });
    }

    const exists = await pool.query(
      `SELECT id FROM wishlist WHERE client_id = $1 AND service_id = $2`,
      [clientId, serviceId]
    );
    if (exists.rowCount > 0) {
      await pool.query(
        `DELETE FROM wishlist WHERE client_id = $1 AND service_id = $2`,
        [clientId, serviceId]
      );
      return res.json({ removed: true, by: "service_id" });
    } else {
      const ins = await pool.query(
        `INSERT INTO wishlist (client_id, service_id)
         VALUES ($1, $2)
         ON CONFLICT (client_id, service_id) DO NOTHING
         RETURNING id`,
        [clientId, serviceId]
      );
      return res.json({ added: true, id: ins.rows[0]?.id || null });
    }
  } catch (e) {
    console.error("toggleWishlist error", e);
    return res.status(500).json({ error: "wishlist_toggle_failed" });
  }
};
