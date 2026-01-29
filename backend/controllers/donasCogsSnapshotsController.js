// backend/controllers/donasCogsSnapshotsController.js

const db = require("../db");

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

exports.createCogsSnapshot = async (req, res) => {
  try {
    const menu_item_id = Number(req.body?.menu_item_id);
    const total_cost = toNum(req.body?.total_cost);
    const breakdown = Array.isArray(req.body?.breakdown) ? req.body.breakdown : [];

    if (!Number.isFinite(menu_item_id) || menu_item_id <= 0) {
      return res.status(400).json({ error: "menu_item_id is required" });
    }

    // breakdown нормализуем (чтобы в БД не летели строки/мусор)
    const cleaned = breakdown
      .map((r) => ({
        ingredient_id: r?.ingredient_id == null ? null : Number(r.ingredient_id),
        qty: toNum(r?.qty),
        unit: String(r?.unit || "").trim() || "g",
        cost: toNum(r?.cost),
      }))
      .filter((r) => Number.isFinite(r.ingredient_id) && r.ingredient_id > 0);

    const ins = await db.query(
      `INSERT INTO donas_cogs_snapshots (menu_item_id, total_cost, breakdown)
       VALUES ($1, $2, $3::jsonb)
       RETURNING id, menu_item_id, total_cost, breakdown, created_at`,
      [menu_item_id, total_cost, JSON.stringify(cleaned)]
    );

    return res.json({ ok: true, snapshot: ins.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Failed to save COGS snapshot" });
  }
};

exports.listCogsSnapshots = async (req, res) => {
  try {
    const menu_item_id = req.query?.menu_item_id ? Number(req.query.menu_item_id) : null;
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 50)));
    const offset = Math.max(0, Number(req.query?.offset || 0));

    const where = [];
    const args = [];
    if (Number.isFinite(menu_item_id) && menu_item_id > 0) {
      args.push(menu_item_id);
      where.push(`s.menu_item_id = $${args.length}`);
    }

    args.push(limit);
    args.push(offset);

    const q = await db.query(
      `SELECT
         s.id,
         s.menu_item_id,
         s.total_cost,
         s.breakdown,
         s.created_at,
         mi.name as menu_item_name,
         mi.category as menu_item_category
       FROM donas_cogs_snapshots s
       LEFT JOIN donas_menu_items mi ON mi.id = s.menu_item_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY s.created_at DESC
       LIMIT $${args.length - 1}
       OFFSET $${args.length}`,
      args
    );

    return res.json({ ok: true, items: q.rows });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Failed to list COGS snapshots" });
  }
};

exports.getLatestCogsSnapshot = async (req, res) => {
  try {
    const menu_item_id = req.query?.menu_item_id ? Number(req.query.menu_item_id) : null;

    const args = [];
    let where = "";
    if (Number.isFinite(menu_item_id) && menu_item_id > 0) {
      args.push(menu_item_id);
      where = `WHERE s.menu_item_id = $1`;
    }

    const q = await db.query(
      `SELECT
         s.id,
         s.menu_item_id,
         s.total_cost,
         s.breakdown,
         s.created_at,
         mi.name as menu_item_name,
         mi.category as menu_item_category
       FROM donas_cogs_snapshots s
       LEFT JOIN donas_menu_items mi ON mi.id = s.menu_item_id
       ${where}
       ORDER BY s.created_at DESC
       LIMIT 1`,
      args
    );

    return res.json({ ok: true, snapshot: q.rows[0] || null });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Failed to load latest COGS snapshot" });
  }
};
