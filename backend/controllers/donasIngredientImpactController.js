// backend/controllers/donasIngredientImpactController.js

const pool = require("../db");

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * GET /api/admin/donas/ingredients/:id/margin-impact?threshold=40
 * Возвращает блюда, где маржа стала ниже порога (после изменения цены ингредиента).
 *
 * Требования к схеме:
 * - donas_menu_items: id, slug, name, price
 * - donas_menu_item_recipe: menu_item_id, ingredient_id, qty
 * - donas_ingredients: id, slug, pack_size, pack_price, is_archived
 * - donas_cogs: menu_item_id, total_cost   (!!! именно total_cost)
 */
exports.getMarginImpact = async (req, res) => {
  const ingredientId = Number(req.params.id);
  if (!Number.isInteger(ingredientId) || ingredientId <= 0) {
    return res.status(400).json({ error: "Bad ingredient id" });
  }

  const threshold = Math.max(0, Math.min(100, toNum(req.query.threshold ?? 40)));

  try {
    // 1) Берём все блюда, где есть этот ингредиент в рецепте
    // 2) Берём текущую цену блюда (price)
    // 3) Берём текущий total_cost (COGS) из donas_cogs
    // 4) Считаем маржу = (price - cogs) / price * 100
    // 5) Фильтруем по threshold

    const q = await pool.query(
      `
      WITH affected AS (
        SELECT DISTINCT r.menu_item_id
        FROM donas_menu_item_recipe r
        WHERE r.ingredient_id = $1
      )
      SELECT
        mi.id AS menu_item_id,
        mi.name,
        mi.price,
        COALESCE(c.total_cost, 0) AS cogs,
        CASE
          WHEN COALESCE(mi.price, 0) <= 0 THEN NULL
          ELSE ((COALESCE(mi.price, 0) - COALESCE(c.total_cost, 0)) / COALESCE(mi.price, 0)) * 100
        END AS margin
      FROM affected a
      JOIN donas_menu_items mi ON mi.id = a.menu_item_id
      LEFT JOIN donas_cogs c ON c.menu_item_id = mi.id
      ORDER BY mi.id ASC
      `,
      [ingredientId]
    );

    const rows = q.rows || [];
    const below = rows
      .map((r) => ({
        menu_item_id: Number(r.menu_item_id),
        name: r.name,
        price: toNum(r.price),
        cogs: toNum(r.cogs),
        margin: r.margin == null ? null : toNum(r.margin),
      }))
      .filter((x) => x.margin != null && x.margin < threshold);

    return res.json({ threshold, below });
  } catch (e) {
    console.error("getMarginImpact error:", e);
    return res.status(500).json({ error: "Failed to calculate margin impact" });
  }
};
