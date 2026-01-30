// backend/routes/adminDonasMenuItemsRoutes.js

const express = require("express");
const pool = require("../db");

const router = express.Router();

function toBool(x) {
  return x === true || x === "true" || x === 1 || x === "1";
}

function normalizeCategory(s) {
  const v = String(s || "").trim().toLowerCase();
  return v || "dosa";
}

// IMPORTANT: /menu-items/finance must be BEFORE /menu-items/:id routes

// GET /api/admin/donas/menu-items/finance?includeArchived=true
// Aгрегаты по блюдам: COGS/Profit/Margin (COGS считается 'на лету' по текущим ингредиентам)
router.get("/menu-items/finance", async (req, res) => {
  try {
    const includeArchived = toBool(req.query.includeArchived);
    const where = includeArchived ? "" : "WHERE mi.is_active = TRUE";

    const q = `
      SELECT
        mi.id,
        mi.name,
        mi.category,
        mi.is_active,
        mi.price,
        mi.sell_price,
        COALESCE(
          SUM(
            (
              COALESCE(i.pack_price, 0)::numeric
              / NULLIF(COALESCE(i.pack_size, 0)::numeric, 0)
            ) * COALESCE(c.qty, 0)::numeric
          ),
          0
        ) AS cogs,
        COUNT(c.id) AS recipe_rows
      FROM donas_menu_items mi
      LEFT JOIN donas_menu_item_components c ON c.menu_item_id = mi.id
      LEFT JOIN donas_ingredients i ON i.id = c.ingredient_id
      ${where}
      GROUP BY mi.id
      ORDER BY mi.is_active DESC, mi.id DESC
    `;

    const r = await pool.query(q);

    const items = (r.rows || []).map((row) => {
      const price = Number(row.sell_price ?? row.price ?? 0) || 0;
      const cogs = Number(row.cogs ?? 0) || 0;
      const profit = price - cogs;
      const margin = price > 0 ? (profit / price) * 100 : null;

      return {
        id: row.id,
        name: row.name,
        category: row.category,
        is_active: row.is_active,
        price: row.price,
        sell_price: row.sell_price,
        cogs,
        profit,
        margin,
        has_recipe: Number(row.recipe_rows || 0) > 0,
      };
    });

    return res.json({ ok: true, items });
  } catch (e) {
    console.error("GET /api/admin/donas/menu-items/finance error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// GET /api/admin/donas/menu-items?includeArchived=true
router.get("/menu-items", async (req, res) => {
  try {
    const includeArchived = toBool(req.query.includeArchived);

    const q = includeArchived
      ? `SELECT * FROM donas_menu_items ORDER BY is_active DESC, id DESC`
      : `SELECT * FROM donas_menu_items WHERE is_active = TRUE ORDER BY id DESC`;

    const r = await pool.query(q);
    return res.json({ ok: true, items: r.rows });
  } catch (e) {
    console.error("GET /api/admin/donas/menu-items error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// POST /api/admin/donas/menu-items
router.post("/menu-items", async (req, res) => {
  try {
    const { name, category, is_active, price, sell_price, description } = req.body || {};
    const nm = String(name || "").trim();
    if (!nm) return res.status(400).json({ ok: false, error: "Name is required" });

    const cat = normalizeCategory(category);
    const active = is_active === undefined ? true : toBool(is_active);

    const pRaw = sell_price ?? price;
    const p = pRaw === null || pRaw === undefined || pRaw === "" ? null : Number(pRaw);
    const desc = description === undefined ? null : String(description || "").trim() || null;

    const r = await pool.query(
      `INSERT INTO donas_menu_items (name, category, is_active, price, sell_price, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [nm, cat, active, p, p, desc]
    );

    return res.json({ ok: true, item: r.rows[0] });
  } catch (e) {
    console.error("POST /api/admin/donas/menu-items error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// PUT /api/admin/donas/menu-items/:id
router.put("/menu-items/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "Bad id" });

    const existingR = await pool.query(`SELECT * FROM donas_menu_items WHERE id = $1`, [id]);
    const existing = existingR.rows[0];
    if (!existing) return res.status(404).json({ ok: false, error: "Not found" });

    const body = req.body || {};
    const nm = body.name === undefined ? existing.name : String(body.name || "").trim();
    const cat = body.category === undefined ? existing.category : normalizeCategory(body.category);
    const active = body.is_active === undefined ? existing.is_active : toBool(body.is_active);

    const pRaw = body.sell_price ?? body.price;
    const nextPrice =
      pRaw === undefined
        ? existing.sell_price ?? existing.price ?? null
        : pRaw === null || pRaw === ""
          ? null
          : Number(pRaw);

    const desc =
      body.description === undefined
        ? existing.description ?? null
        : String(body.description || "").trim() || null;

    if (!nm) return res.status(400).json({ ok: false, error: "Name is required" });

    const r = await pool.query(
      `UPDATE donas_menu_items
       SET name = $1,
           category = $2,
           is_active = $3,
           price = $4,
           sell_price = $4,
           description = $5,
           updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [nm, cat, active, nextPrice, desc, id]
    );

    if (!r.rows[0]) return res.status(404).json({ ok: false, error: "Not found" });
    return res.json({ ok: true, item: r.rows[0] });
  } catch (e) {
    console.error("PUT /api/admin/donas/menu-items/:id error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// DELETE /api/admin/donas/menu-items/:id (архивирование)
router.delete("/menu-items/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "Bad id" });

    const r = await pool.query(
      `UPDATE donas_menu_items
       SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (!r.rows[0]) return res.status(404).json({ ok: false, error: "Not found" });
    return res.json({ ok: true, item: r.rows[0] });
  } catch (e) {
    console.error("DELETE /api/admin/donas/menu-items/:id error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// GET /api/admin/donas/menu-items/:id/recipe
router.get("/menu-items/:id/recipe", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "Bad id" });

    const itemR = await pool.query(`SELECT * FROM donas_menu_items WHERE id = $1`, [id]);
    if (!itemR.rows[0]) return res.status(404).json({ ok: false, error: "Not found" });

    const compR = await pool.query(
      `SELECT id, menu_item_id, ingredient_id, qty, unit
       FROM donas_menu_item_components
       WHERE menu_item_id = $1
       ORDER BY id ASC`,
      [id]
    );

    return res.json({ ok: true, item: itemR.rows[0], recipe: compR.rows });
  } catch (e) {
    console.error("GET /api/admin/donas/menu-items/:id/recipe error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// PUT /api/admin/donas/menu-items/:id/recipe (полная замена)
router.put("/menu-items/:id/recipe", async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "Bad id" });

    const rows = Array.isArray(req.body?.recipe) ? req.body.recipe : [];

    for (const r of rows) {
      const ingredient_id = Number(r.ingredient_id);
      const qty = Number(r.qty);
      const unit = String(r.unit || "").trim();

      if (!Number.isFinite(ingredient_id) || ingredient_id <= 0) {
        return res.status(400).json({ ok: false, error: "Bad ingredient_id" });
      }
      if (!Number.isFinite(qty) || qty < 0) {
        return res.status(400).json({ ok: false, error: "Bad qty" });
      }
      if (!unit) {
        return res.status(400).json({ ok: false, error: "Unit is required" });
      }
    }

    await client.query("BEGIN");

    const itemR = await client.query(`SELECT id FROM donas_menu_items WHERE id = $1`, [id]);
    if (!itemR.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "Not found" });
    }

    await client.query(`DELETE FROM donas_menu_item_components WHERE menu_item_id = $1`, [id]);

    for (const r of rows) {
      await client.query(
        `INSERT INTO donas_menu_item_components (menu_item_id, ingredient_id, qty, unit)
         VALUES ($1, $2, $3, $4)`,
        [id, Number(r.ingredient_id), Number(r.qty), String(r.unit).trim()]
      );
    }

    await client.query("COMMIT");

    const compR = await client.query(
      `SELECT id, menu_item_id, ingredient_id, qty, unit
       FROM donas_menu_item_components
       WHERE menu_item_id = $1
       ORDER BY id ASC`,
      [id]
    );

    return res.json({ ok: true, recipe: compR.rows });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("PUT /api/admin/donas/menu-items/:id/recipe error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  } finally {
    client.release();
  }
});

module.exports = router;
