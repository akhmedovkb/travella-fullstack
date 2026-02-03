// backend/controllers/donasSalesController.js
const db = require("../db");

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

// GET /api/admin/donas/sales?month=YYYY-MM
exports.getSales = async (req, res) => {
  const { month } = req.query;

  let where = "";
  let params = [];

  if (month) {
    where = "WHERE to_char(sold_at, 'YYYY-MM') = $1";
    params.push(month);
  }

  const { rows } = await db.query(
    `
    SELECT s.*,
           mi.name AS menu_item_name
    FROM donas_sales s
    JOIN donas_menu_items mi ON mi.id = s.menu_item_id
    ${where}
    ORDER BY sold_at DESC, id DESC
    `,
    params
  );

  res.json(rows);
};

// POST /api/admin/donas/sales
exports.addSale = async (req, res) => {
  const {
    sold_at,
    menu_item_id,
    qty,
    unit_price,
    channel,
    notes,
  } = req.body;

  if (!sold_at || !menu_item_id || !qty) {
    return res.status(400).json({ error: "sold_at, menu_item_id, qty required" });
  }

  // берём последний COGS блюда
  const cogsSnap = await db.query(
    `
    SELECT id, total_cost
    FROM donas_cogs
    WHERE menu_item_id = $1
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    `,
    [menu_item_id]
  );

  const cogsSnapshotId = cogsSnap.rows[0]?.id || null;
  const cogsUnit = toNum(cogsSnap.rows[0]?.total_cost);

  const q = toNum(qty);
  const price = toNum(unit_price);

  const revenueTotal = q * price;
  const cogsTotal = q * cogsUnit;

  const { rows } = await db.query(
    `
    INSERT INTO donas_sales (
      sold_at,
      menu_item_id,
      qty,
      unit_price,
      revenue_total,
      cogs_snapshot_id,
      cogs_unit,
      cogs_total,
      channel,
      notes
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *
    `,
    [
      sold_at,
      menu_item_id,
      q,
      price,
      revenueTotal,
      cogsSnapshotId,
      cogsUnit,
      cogsTotal,
      channel || null,
      notes || null,
    ]
  );

  res.json(rows[0]);
};

// PUT /api/admin/donas/sales/:id
exports.updateSale = async (req, res) => {
  const { id } = req.params;
  const {
    sold_at,
    menu_item_id,
    qty,
    unit_price,
    channel,
    notes,
    recalc_cogs,
  } = req.body;

  const { rows: currentRows } = await db.query(
    `SELECT * FROM donas_sales WHERE id = $1`,
    [id]
  );

  if (!currentRows.length) {
    return res.status(404).json({ error: "Sale not found" });
  }

  const current = currentRows[0];

  let cogsUnit = toNum(current.cogs_unit);
  let cogsSnapshotId = current.cogs_snapshot_id;

  // если явно попросили пересчитать COGS или сменили блюдо
  if (recalc_cogs || menu_item_id !== current.menu_item_id) {
    const snap = await db.query(
      `
      SELECT id, total_cost
      FROM donas_cogs
      WHERE menu_item_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      `,
      [menu_item_id || current.menu_item_id]
    );

    cogsSnapshotId = snap.rows[0]?.id || null;
    cogsUnit = toNum(snap.rows[0]?.total_cost);
  }

  const q = toNum(qty ?? current.qty);
  const price = toNum(unit_price ?? current.unit_price);

  const revenueTotal = q * price;
  const cogsTotal = q * cogsUnit;

  const { rows } = await db.query(
    `
    UPDATE donas_sales
    SET sold_at = $1,
        menu_item_id = $2,
        qty = $3,
        unit_price = $4,
        revenue_total = $5,
        cogs_snapshot_id = $6,
        cogs_unit = $7,
        cogs_total = $8,
        channel = $9,
        notes = $10,
        updated_at = now()
    WHERE id = $11
    RETURNING *
    `,
    [
      sold_at ?? current.sold_at,
      menu_item_id ?? current.menu_item_id,
      q,
      price,
      revenueTotal,
      cogsSnapshotId,
      cogsUnit,
      cogsTotal,
      channel ?? current.channel,
      notes ?? current.notes,
      id,
    ]
  );

  res.json(rows[0]);
};

// DELETE /api/admin/donas/sales/:id
exports.deleteSale = async (req, res) => {
  const { id } = req.params;
  await db.query(`DELETE FROM donas_sales WHERE id = $1`, [id]);
  res.json({ ok: true });
};
