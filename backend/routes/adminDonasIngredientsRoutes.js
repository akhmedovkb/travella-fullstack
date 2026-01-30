// backend/routes/adminDonasIngredientsRoutes.js

const express = require("express");
const router = express.Router();

const pool = require("../db");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const { getMarginImpact } = require("../controllers/donasIngredientImpactController");

const SLUG = "donas-dosas";

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function cleanUnit(u) {
  const v = String(u || "").trim().toLowerCase();
  if (v === "g" || v === "ml" || v === "pcs") return v;
  return "g";
}

function isTruthy(v) {
  const s = String(v || "").toLowerCase().trim();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

/**
 * ✅ GET /api/admin/donas/ingredients/:id/margin-impact?threshold=40
 */
router.get(
  "/ingredients/:id/margin-impact",
  authenticateToken,
  requireAdmin,
  getMarginImpact
);

/**
 * GET /api/admin/donas/ingredients?includeArchived=true
 */
router.get("/ingredients", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const includeArchived = isTruthy(req.query.includeArchived);

    const q = await pool.query(
      `
      SELECT
        id,
        slug,
        name,
        unit,
        pack_size,
        pack_price,
        supplier,
        notes,
        is_active,
        is_archived,
        created_at,
        updated_at
      FROM donas_ingredients
      WHERE slug = $1
        AND ($2::bool = true OR is_archived = false)
      ORDER BY is_archived ASC, name ASC, id ASC
      `,
      [SLUG, includeArchived]
    );

    const items = (q.rows || []).map((r) => {
      const packSize = toNum(r.pack_size);
      const packPrice = toNum(r.pack_price);
      const ppu = packSize > 0 ? packPrice / packSize : 0;

      return {
        ...r,
        pack_size: packSize,
        pack_price: packPrice,
        price_per_unit: Number.isFinite(ppu) ? Number(ppu.toFixed(6)) : 0,
      };
    });

    res.json({ items });
  } catch (e) {
    console.error("GET /ingredients error:", e);
    res.status(500).json({ error: "Failed to load ingredients" });
  }
});

/**
 * POST /api/admin/donas/ingredients
 * body: { name, unit, pack_size, pack_price, supplier, notes, is_active }
 */
router.post("/ingredients", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || "").trim();
    if (!name) return res.status(400).json({ error: "Name is required" });

    const unit = cleanUnit(b.unit);
    const pack_size = Math.max(0, toNum(b.pack_size));
    const pack_price = Math.max(0, toNum(b.pack_price));
    const supplier = String(b.supplier || "").trim() || null;
    const notes = String(b.notes || "").trim() || null;

    // если фронт не шлёт is_active — считаем, что true
    const is_active = b.is_active == null ? true : !!b.is_active;

    const q = await pool.query(
      `
      INSERT INTO donas_ingredients (
        slug, name, unit, pack_size, pack_price, supplier, notes, is_active, is_archived
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false)
      RETURNING *
      `,
      [SLUG, name, unit, pack_size, pack_price, supplier, notes, is_active]
    );

    res.json(q.rows[0]);
  } catch (e) {
    console.error("POST /ingredients error:", e);
    res.status(500).json({ error: "Failed to create ingredient" });
  }
});

/**
 * PUT /api/admin/donas/ingredients/:id
 */
router.put("/ingredients/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Bad id" });

    const b = req.body || {};
    const name = String(b.name || "").trim();
    if (!name) return res.status(400).json({ error: "Name is required" });

    const unit = cleanUnit(b.unit);
    const pack_size = Math.max(0, toNum(b.pack_size));
    const pack_price = Math.max(0, toNum(b.pack_price));
    const supplier = String(b.supplier || "").trim() || null;
    const notes = String(b.notes || "").trim() || null;

    // если фронт не шлёт is_active — оставляем true (чтобы не “гасить” ингредиент)
    const is_active = b.is_active == null ? true : !!b.is_active;
    const is_archived = !!b.is_archived;

    const q = await pool.query(
      `
      UPDATE donas_ingredients
         SET name=$1,
             unit=$2,
             pack_size=$3,
             pack_price=$4,
             supplier=$5,
             notes=$6,
             is_active=$7,
             is_archived=$8,
             updated_at=NOW()
       WHERE id=$9 AND slug=$10
       RETURNING *
      `,
      [name, unit, pack_size, pack_price, supplier, notes, is_active, is_archived, id, SLUG]
    );

    if (!q.rows.length) return res.status(404).json({ error: "Not found" });
    res.json(q.rows[0]);
  } catch (e) {
    console.error("PUT /ingredients/:id error:", e);
    res.status(500).json({ error: "Failed to update ingredient" });
  }
});

/**
 * DELETE /api/admin/donas/ingredients/:id
 * мягкое удаление = архивирование
 */
router.delete("/ingredients/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Bad id" });

    const q = await pool.query(
      `
      UPDATE donas_ingredients
         SET is_archived=true,
             is_active=false,
             updated_at=NOW()
       WHERE id=$1 AND slug=$2
       RETURNING id
      `,
      [id, SLUG]
    );

    if (!q.rows.length) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true, id });
  } catch (e) {
    console.error("DELETE /ingredients/:id error:", e);
    res.status(500).json({ error: "Failed to delete ingredient" });
  }
});

module.exports = router;
