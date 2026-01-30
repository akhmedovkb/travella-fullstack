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
 * Текущая "истина" проекта:
 * - donas_menu_items: id, name, price, sell_price
 * - donas_menu_item_components: menu_item_id, ingredient_id, qty, unit
 * - donas_ingredients: id, pack_size, pack_price (и т.п.)
 *
 * Важно: COGS считаем "на лету" по рецепту и текущим ценам ингредиентов:
 *   cogs = SUM( (pack_price / pack_size) * qty )
 * где pack_size=0 -> строка даёт 0 (чтобы не падать).
 */
exports.getMarginImpact = async (req, res) => {
  const ingredientId = Number(req.params.id);
  if (!Number.isInteger(ingredientId) || ingredientId <= 0) {
    return res.status(400).json({ error: "Bad ingredient id" });
  }

  const threshold = Math.max(0, Math.min(100, toNum(req.query.threshold ?? 40)));

  try {
    const q = await pool.query(
      `
      WITH affected AS (
        SELECT DISTINCT c.menu_item_id
        FROM donas_menu_item_components c
        WHERE c.ingredient_id = $1
      ),
      cogs_by_item AS (
        SELECT
          c.menu_item_id,
          COALESCE(
            SUM(
              (
                COALESCE(i.pack_price, 0)::numeric
                / NULLIF(COALESCE(i.pack_size, 0)::numeric, 0)
              ) * COALESCE(c.qty, 0)::numeric
            ),
            0
          ) AS cogs
        FROM donas_menu_item_components c
        JOIN affected a ON a.menu_item_id = c.menu_item_id
        LEFT JOIN donas_ingredients i ON i.id = c.ingredient_id
        GROUP BY c.menu_item_id
      )
      SELECT
        mi.id AS menu_item_id,
        mi.name,
        COALESCE(mi.sell_price, mi.price, 0) AS price,
        COALESCE(cb.cogs, 0) AS cogs,
        CASE
          WHEN COALESCE(mi.sell_price, mi.price, 0) <= 0 THEN NULL
          ELSE (
            (COALESCE(mi.sell_price, mi.price, 0) - COALESCE(cb.cogs, 0))
            / COALESCE(mi.sell_price, mi.price, 0)
          ) * 100
        END AS margin
      FROM affected a
      JOIN donas_menu_items mi ON mi.id = a.menu_item_id
      LEFT JOIN cogs_by_item cb ON cb.menu_item_id = mi.id
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

    return res.json({
      threshold,
      checked_count: rows.length,
      below,
    });
  } catch (e) {
    console.error("getMarginImpact error:", e);
    return res.status(500).json({ error: "Failed to calculate margin impact" });
  }
};
