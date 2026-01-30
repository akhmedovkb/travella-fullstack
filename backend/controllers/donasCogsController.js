// backend/controllers/donasCogsController.js

const db = require("../db");

// GET /api/admin/donas/cogs?menu_item_id=5&limit=30
exports.listCogsSnapshots = async (req, res) => {
  const menuItemId = req.query.menu_item_id ? Number(req.query.menu_item_id) : null;
  const limit = req.query.limit ? Math.min(200, Math.max(1, Number(req.query.limit))) : 30;

  const params = [];
  let where = "";
  if (Number.isFinite(menuItemId) && menuItemId > 0) {
    params.push(menuItemId);
    where = `WHERE menu_item_id = $${params.length}`;
  }
  params.push(limit);

  const q = `
    SELECT id, menu_item_id, total_cost, sell_price, margin, breakdown, created_at
    FROM donas_cogs
    ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT $${params.length}
  `;

  const r = await db.query(q, params);
  res.json({ items: r.rows || [] });
};

// GET /api/admin/donas/cogs/:menuItemId?limit=30
exports.getCogsSnapshotsForItem = async (req, res) => {
  const menuItemId = Number(req.params.menuItemId);
  const limit = req.query.limit ? Math.min(200, Math.max(1, Number(req.query.limit))) : 30;

  if (!Number.isFinite(menuItemId) || menuItemId <= 0) {
    return res.status(400).json({ error: "Bad menuItemId" });
  }

  const r = await db.query(
    `
    SELECT id, menu_item_id, total_cost, sell_price, margin, breakdown, created_at
    FROM donas_cogs
    WHERE menu_item_id = $1
    ORDER BY created_at DESC, id DESC
    LIMIT $2
    `,
    [menuItemId, limit]
  );

  res.json({ items: r.rows || [] });
};

// POST /api/admin/donas/cogs
// body: { menu_item_id, total_cost, sell_price?, margin?, breakdown:[{ingredient_id,qty,unit,cost}] }
exports.createCogsSnapshot = async (req, res) => {
  const menuItemId = Number(req.body?.menu_item_id);
  const totalCost = Number(req.body?.total_cost);
  const sellPriceRaw = req.body?.sell_price;
  const marginRaw = req.body?.margin;
  const breakdown = Array.isArray(req.body?.breakdown) ? req.body.breakdown : [];

  if (!Number.isFinite(menuItemId) || menuItemId <= 0) {
    return res.status(400).json({ error: "Bad menu_item_id" });
  }

  const safeTotal = Number.isFinite(totalCost) ? totalCost : 0;
  const safeSellPrice = sellPriceRaw == null ? null : Number(sellPriceRaw);
  const safeMargin = marginRaw == null ? null : Number(marginRaw);

  // немного “чистим” breakdown
  const safeBreakdown = breakdown
    .map((x) => ({
      ingredient_id: Number(x?.ingredient_id) || null,
      qty: Number(x?.qty) || 0,
      unit: String(x?.unit || "g"),
      cost: Number(x?.cost) || 0,
    }))
    .filter((x) => Number.isFinite(x.ingredient_id) && x.ingredient_id > 0);

  const ins = await db.query(
    `
    INSERT INTO donas_cogs (menu_item_id, total_cost, sell_price, margin, breakdown)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, menu_item_id, total_cost, sell_price, margin, breakdown, created_at
    `,
    [
      menuItemId,
      safeTotal,
      Number.isFinite(safeSellPrice) ? safeSellPrice : null,
      Number.isFinite(safeMargin) ? safeMargin : null,
      JSON.stringify(safeBreakdown),
    ]
  );

  res.json({ ok: true, item: ins.rows?.[0] || null });
};
