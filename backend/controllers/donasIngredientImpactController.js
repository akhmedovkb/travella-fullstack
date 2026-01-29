// backend/controllers/donasIngredientImpactController.js

const db = require("../db");

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

// GET /api/admin/donas/ingredients/:id/margin-impact?threshold=40
exports.getMarginImpact = async (req, res) => {
  try {
    const ingredientId = Number(req.params.id);
    const threshold =
      req.query.threshold != null ? toNum(req.query.threshold) : 40;

    if (!Number.isFinite(ingredientId) || ingredientId <= 0) {
      return res.status(400).json({ error: "Bad ingredient id" });
    }

    // какие блюда используют этот ингредиент
    const mi = await db.query(
      `
      SELECT DISTINCT menu_item_id
      FROM donas_menu_item_recipe
      WHERE ingredient_id = $1
      `,
      [ingredientId]
    );

    const menuItemIds = (mi.rows || [])
      .map((r) => Number(r.menu_item_id))
      .filter(Boolean);

    if (menuItemIds.length === 0) {
      return res.json({ threshold, items: [], below: [] });
    }

    // тянем рецепты и ингредиенты пачкой
    const recipeRows = await db.query(
      `
      SELECT
        r.menu_item_id,
        r.ingredient_id,
        r.qty,
        r.unit,
        i.name as ing_name,
        i.unit as ing_unit,
        i.pack_size,
        i.pack_price
      FROM donas_menu_item_recipe r
      JOIN donas_ingredients i ON i.id = r.ingredient_id
      WHERE r.menu_item_id = ANY($1::int[])
      `,
      [menuItemIds]
    );

    // цены блюда (sell_price если есть, иначе price)
    const menuItems = await db.query(
      `
      SELECT id, name, COALESCE(sell_price, price) as price
      FROM donas_menu_items
      WHERE id = ANY($1::int[])
      `,
      [menuItemIds]
    );

    const byMenu = new Map();
    for (const r of recipeRows.rows || []) {
      const id = Number(r.menu_item_id);
      if (!byMenu.has(id)) byMenu.set(id, []);
      byMenu.get(id).push(r);
    }

    const menuMap = new Map();
    for (const m of menuItems.rows || []) menuMap.set(Number(m.id), m);

    const out = [];

    for (const id of menuItemIds) {
      const m = menuMap.get(id);
      const price = toNum(m?.price);

      const lines = byMenu.get(id) || [];
      let cogs = 0;

      for (const line of lines) {
        const packSize = toNum(line.pack_size);
        const packPrice = toNum(line.pack_price);
        const ppu = packSize > 0 ? packPrice / packSize : 0; // цена за 1 unit (g/ml/pcs)
        const qty = toNum(line.qty);
        cogs += ppu * qty;
      }

      let margin = null;
      let profit = null;
      if (price > 0) {
        profit = price - cogs;
        margin = (profit / price) * 100;
      }

      out.push({
        menu_item_id: id,
        name: m?.name || `#${id}`,
        price: price || null,
        cogs,
        profit,
        margin,
      });
    }

    // сначала самые низкие маржи
    out.sort((a, b) => {
      const am = a.margin == null ? 999999 : a.margin;
      const bm = b.margin == null ? 999999 : b.margin;
      return am - bm;
    });

    const below = out.filter((x) => x.margin != null && x.margin < threshold);

    return res.json({ threshold, items: out, below });
  } catch (e) {
    console.error("getMarginImpact error:", e);
    return res.status(500).json({ error: "Failed to calculate margin impact" });
  }
};
