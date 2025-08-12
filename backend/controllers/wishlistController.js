// controllers/wishlistController.js
const pool = require("../db");

/** Мягкая нормализация картинок в массив строк */
function normalizeImages(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : (val ? [val] : []);
    } catch {
      return [val];
    }
  }
  if (typeof val === "object") {
    // JSONB из pg может прийти объектом/массивом
    if (Array.isArray(val)) return val;
    return [];
  }
  return [];
}

/**
 * GET /api/wishlist?expand=service
 * Возвращает массив избранного; при expand=service добавляет объект service.
 * Элемент:
 * { id, service_id, created_at, service?: { id, title, images: string[] } }
 */
exports.listWishlist = async (req, res) => {
  try {
    const clientId = req.user.id;
    const expand = String(req.query.expand || "") === "service";

    if (expand) {
      // ВАЖНО: только s.title (без s.name) — чтобы не падать на несуществующей колонке.
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
 * - Если пришёл itemId/id — удаляем запись по её id (быстрое снятие).
 * - Если пришёл service_id — toggle по услуге (если было — удаляем, иначе — добавляем).
 */
exports.toggleWishlist = async (req, res) => {
  try {
    const clientId = req.user.id;
    const body = req.body || {};

    // Вариант 1: удаление по id записи wishlist
    const wishlistId = body.id || body.itemId;
    if (wishlistId) {
      const del = await pool.query(
        `DELETE FROM wishlist WHERE id = $1 AND client_id = $2`,
        [wishlistId, clientId]
      );
      // Фолбэк: если вдруг прислали service_id вместо id — попробуем удалить по service_id
      if (del.rowCount === 0) {
        const del2 = await pool.query(
          `DELETE FROM wishlist WHERE service_id = $1 AND client_id = $2`,
          [wishlistId, clientId]
        );
        if (del2.rowCount > 0) return res.json({ removed: true, by: "service_id_fallback" });
      }
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
