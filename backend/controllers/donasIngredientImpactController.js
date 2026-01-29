// backend/controllers/donasIngredientImpactController.js
const db = require("../db");

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

exports.getMarginImpact = async (req, res) => {
  try {
    const ingredientId = Number(req.params.id);
    if (!Number.isInteger(ingredientId) || ingredientId <= 0) {
      return res.status(400).json({ error: "Bad ingredient id" });
    }

    const threshold = Math.max(0, Math.min(100, toNum(req.query.threshold ?? 40)));

    // важно: ограничим только наш slug, чтобы не цеплять чужие данные
    const SLUG = "donas-dosas";

    const q = await db.query(
      `
      SELECT
        mi.id as menu_item_id,
        mi.name,
        mi.price,
        c.total_cogs as cogs,
        CASE WHEN mi.price > 0 THEN ((mi.price - c.total_cogs)/mi.price)*100 ELSE NULL END as margin
      FROM donas_menu_items mi
      JOIN donas_cogs c ON c.menu_item_id = mi.id
      WHERE mi.slug = $1
        AND EXISTS (
          SELECT 1
          FROM donas_menu_item_recipe r
          WHERE r.menu_item_id = mi.id
            AND r.ingredient_id = $2
        )
      AND mi.price > 0
      AND ((mi.price - c.total_cogs)/mi.price)*100 < $3
      ORDER BY margin ASC NULLS LAST
      `,
      [SLUG, ingredientId, threshold]
    );

    return res.json({
      ok: true,
      threshold,
      below: (q.rows || []).map((r) => ({
        menu_item_id: Number(r.menu_item_id),
        name: r.name,
        price: toNum(r.price),
        cogs: toNum(r.cogs),
        margin: r.margin == null ? null : toNum(r.margin),
      })),
    });
  } catch (e) {
    console.error("getMarginImpact error:", e);
    return res.status(500).json({ error: "Failed to calculate margin impact" });
  }
};
