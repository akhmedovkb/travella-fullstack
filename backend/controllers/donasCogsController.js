// backend/controllers/donasCogsController.js
import db from "../db.js"; // или как у тебя подключение к pg

export async function getCogsLatest(req, res) {
  const menuItemId = Number(req.query.menu_item_id);
  if (!Number.isFinite(menuItemId) || menuItemId <= 0) {
    return res.status(400).json({ error: "menu_item_id is required" });
  }

  const { rows } = await db.query(
    `
    SELECT id, menu_item_id, total_cost, breakdown, created_at
    FROM donas_cogs_snapshots
    WHERE menu_item_id = $1
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [menuItemId]
  );

  return res.json(rows[0] || null);
}

export async function listCogsHistory(req, res) {
  const menuItemId = Number(req.query.menu_item_id);
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);

  if (!Number.isFinite(menuItemId) || menuItemId <= 0) {
    return res.status(400).json({ error: "menu_item_id is required" });
  }

  const { rows } = await db.query(
    `
    SELECT id, menu_item_id, total_cost, created_at
    FROM donas_cogs_snapshots
    WHERE menu_item_id = $1
    ORDER BY created_at DESC
    LIMIT $2
    `,
    [menuItemId, limit]
  );

  return res.json({ items: rows });
}
