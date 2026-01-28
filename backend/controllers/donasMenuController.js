//backend/controllers/donasMenuController.js

import db from "../db.js";

function toBool(x) {
  return x === true || x === "true" || x === 1 || x === "1";
}

function normalizeCategory(s) {
  const v = String(s || "").trim().toLowerCase();
  if (!v) return "dosa";
  // можно расширять список
  if (["dosa", "drinks", "extras"].includes(v)) return v;
  return v; // пусть проходит кастом
}

// GET /api/donas/menu-items
export async function getMenuItems(req, res) {
  try {
    const includeArchived = toBool(req.query.includeArchived);
    const q = includeArchived
      ? `SELECT * FROM donas_menu_items ORDER BY is_active DESC, id DESC`
      : `SELECT * FROM donas_menu_items WHERE is_active = TRUE ORDER BY id DESC`;

    const r = await db.query(q);
    return res.json({ ok: true, items: r.rows });
  } catch (e) {
    console.error("getMenuItems error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

// POST /api/donas/menu-items
export async function createMenuItem(req, res) {
  try {
    const { name, category, is_active } = req.body || {};
    const nm = String(name || "").trim();
    if (!nm) return res.status(400).json({ ok: false, error: "Name is required" });

    const cat = normalizeCategory(category);
    const active = is_active === undefined ? true : toBool(is_active);

    const r = await db.query(
      `INSERT INTO donas_menu_items (name, category, is_active)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [nm, cat, active]
    );

    return res.json({ ok: true, item: r.rows[0] });
  } catch (e) {
    console.error("createMenuItem error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

// PUT /api/donas/menu-items/:id
export async function updateMenuItem(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "Bad id" });

    const { name, category, is_active } = req.body || {};
    const nm = String(name || "").trim();
    if (!nm) return res.status(400).json({ ok: false, error: "Name is required" });

    const cat = normalizeCategory(category);
    const active = is_active === undefined ? true : toBool(is_active);

    const r = await db.query(
      `UPDATE donas_menu_items
       SET name = $1, category = $2, is_active = $3
       WHERE id = $4
       RETURNING *`,
      [nm, cat, active, id]
    );

    if (!r.rows[0]) return res.status(404).json({ ok: false, error: "Not found" });
    return res.json({ ok: true, item: r.rows[0] });
  } catch (e) {
    console.error("updateMenuItem error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

// DELETE /api/donas/menu-items/:id  (архивирование)
export async function archiveMenuItem(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "Bad id" });

    const r = await db.query(
      `UPDATE donas_menu_items
       SET is_active = FALSE
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (!r.rows[0]) return res.status(404).json({ ok: false, error: "Not found" });
    return res.json({ ok: true, item: r.rows[0] });
  } catch (e) {
    console.error("archiveMenuItem error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

// GET /api/donas/menu-items/:id/recipe
export async function getMenuItemRecipe(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "Bad id" });

    const itemR = await db.query(`SELECT * FROM donas_menu_items WHERE id = $1`, [id]);
    if (!itemR.rows[0]) return res.status(404).json({ ok: false, error: "Not found" });

    const compR = await db.query(
      `SELECT id, menu_item_id, ingredient_id, qty, unit
       FROM donas_menu_item_components
       WHERE menu_item_id = $1
       ORDER BY id ASC`,
      [id]
    );

    return res.json({ ok: true, item: itemR.rows[0], recipe: compR.rows });
  } catch (e) {
    console.error("getMenuItemRecipe error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

// PUT /api/donas/menu-items/:id/recipe  (полностью заменить рецепт)
export async function replaceMenuItemRecipe(req, res) {
  const client = await db.connect();
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "Bad id" });

    const { recipe } = req.body || {};
    const rows = Array.isArray(recipe) ? recipe : [];

    // Валидация по минимуму
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
    console.error("replaceMenuItemRecipe error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  } finally {
    client.release();
  }
}
