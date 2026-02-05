// backend/controllers/donasSalesController.js
const db = require("../db");

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function isYm(s) {
  return /^\d{4}-\d{2}$/.test(String(s || ""));
}

function toYmFromDate(d) {
  if (!d) return "";
  return String(d).slice(0, 7);
}

function hasLockedTag(notes) {
  return String(notes || "").toLowerCase().includes("#locked");
}

const SLUG = "donas-dosas";

async function isMonthLocked(ym) {
  if (!isYm(ym)) return false;

  const { rows } = await db.query(
    `
    SELECT notes
    FROM donas_finance_months
    WHERE slug=$1 AND month = ($2 || '-01')::date
    ORDER BY id DESC
    LIMIT 1
    `,
    [SLUG, ym]
  );

  const notes = rows?.[0]?.notes || "";
  return hasLockedTag(notes);
}

async function getLatestCogsForMenuItem(menuItemId) {
  const { rows } = await db.query(
    `
    SELECT id, menu_item_id, total_cost, created_at
    FROM donas_cogs
    WHERE menu_item_id = $1
    ORDER BY created_at DESC NULLS LAST, id DESC
    LIMIT 1
    `,
    [menuItemId]
  );
  return rows?.[0] || null;
}

/**
 * GET /api/admin/donas/sales?month=YYYY-MM
 */
exports.getSales = async (req, res) => {
  try {
    const { month } = req.query;

    let where = "";
    let params = [];

    if (month) {
      if (!isYm(month)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });
      where = "WHERE to_char(sold_at, 'YYYY-MM') = $1";
      params.push(month);
    }

    const { rows } = await db.query(
      `
      SELECT s.*,
             mi.name AS menu_item_name
      FROM donas_sales s
      LEFT JOIN donas_menu_items mi ON mi.id = s.menu_item_id
      ${where}
      ORDER BY sold_at DESC, id DESC
      `,
      params
    );

    return res.json(rows || []);
  } catch (e) {
    console.error("getSales error:", e);
    return res.status(500).json({ error: "Failed to load sales" });
  }
};

/**
 * POST /api/admin/donas/sales
 * body: { sold_at, menu_item_id, qty, unit_price, channel, notes? }
 */
exports.addSale = async (req, res) => {
  try {
    const b = req.body || {};

    const soldAt = String(b.sold_at || "").trim();
    const menuItemId = Number(b.menu_item_id);
    const qty = toNum(b.qty);
    const unitPrice = toNum(b.unit_price);
    const channel = String(b.channel || "cash").trim() || "cash";
    const notes = b.notes == null ? null : String(b.notes);

    if (!soldAt) return res.status(400).json({ error: "sold_at required" });
    if (!Number.isFinite(menuItemId) || menuItemId <= 0) {
      return res.status(400).json({ error: "menu_item_id required" });
    }

    const ym = toYmFromDate(soldAt);
    if (await isMonthLocked(ym)) {
      return res.status(409).json({ error: `Month ${ym} is locked (#locked)` });
    }

    const revenueTotal = qty * unitPrice;

    const snap = await getLatestCogsForMenuItem(menuItemId);
    const cogsUnit = toNum(snap?.total_cost);
    const cogsTotal = qty * cogsUnit;
    const cogsSnapshotId = snap?.id || null;

    const profitTotal = revenueTotal - cogsTotal;
    const marginPct = revenueTotal === 0 ? 0 : (profitTotal / revenueTotal) * 100;

    const { rows } = await db.query(
      `
      INSERT INTO donas_sales
        (sold_at, menu_item_id, qty, unit_price, revenue_total,
         cogs_snapshot_id, cogs_unit, cogs_total,
         profit_total, margin_pct,
         channel, notes)
      VALUES
        ($1, $2, $3, $4, $5,
         $6, $7, $8,
         $9, $10,
         $11, $12)
      RETURNING *
      `,
      [
        soldAt,
        menuItemId,
        qty,
        unitPrice,
        revenueTotal,
        cogsSnapshotId,
        cogsUnit,
        cogsTotal,
        profitTotal,
        marginPct,
        channel,
        notes,
      ]
    );

    return res.json(rows[0]);
  } catch (e) {
    console.error("addSale error:", e);
    return res.status(500).json({ error: "Failed to add sale" });
  }
};

/**
 * PUT /api/admin/donas/sales/:id
 */
exports.updateSale = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Bad id" });

    const curQ = await db.query(`SELECT * FROM donas_sales WHERE id=$1 LIMIT 1`, [id]);
    const cur = curQ.rows?.[0];
    if (!cur) return res.status(404).json({ error: "Sale not found" });

    const curYm = toYmFromDate(cur.sold_at);
    if (await isMonthLocked(curYm)) {
      return res.status(409).json({ error: `Month ${curYm} is locked (#locked)` });
    }

    const b = req.body || {};
    const soldAt = String(b.sold_at || cur.sold_at);
    const menuItemId = Number(b.menu_item_id ?? cur.menu_item_id);
    const qty = b.qty == null ? toNum(cur.qty) : toNum(b.qty);
    const unitPrice = b.unit_price == null ? toNum(cur.unit_price) : toNum(b.unit_price);
    const channel = b.channel == null ? String(cur.channel || "cash") : String(b.channel || "cash");
    const notes = b.notes === undefined ? cur.notes : (b.notes == null ? null : String(b.notes));

    const newYm = toYmFromDate(soldAt);
    if (newYm !== curYm && (await isMonthLocked(newYm))) {
      return res.status(409).json({ error: `Month ${newYm} is locked (#locked)` });
    }

    const revenueTotal = qty * unitPrice;

    let cogsSnapshotId = cur.cogs_snapshot_id;
    let cogsUnit = toNum(cur.cogs_unit);
    let cogsTotal = toNum(cur.cogs_total);

    const menuItemChanged = Number(menuItemId) !== Number(cur.menu_item_id);
    const qtyChanged = qty !== toNum(cur.qty);

    const cogsIsEmpty = !cogsSnapshotId || toNum(cur.cogs_unit) <= 0;

    if (menuItemChanged || qtyChanged || cogsIsEmpty) {
      const snap = await getLatestCogsForMenuItem(menuItemId);
      cogsUnit = toNum(snap?.total_cost);
      cogsTotal = qty * cogsUnit;
      cogsSnapshotId = snap?.id || null;
    } else {
      cogsTotal = qty * cogsUnit;
    }

    const profitTotal = revenueTotal - cogsTotal;
    const marginPct = revenueTotal === 0 ? 0 : (profitTotal / revenueTotal) * 100;

    const { rows } = await db.query(
      `
      UPDATE donas_sales
      SET
        sold_at=$2,
        menu_item_id=$3,
        qty=$4,
        unit_price=$5,
        revenue_total=$6,
        cogs_snapshot_id=$7,
        cogs_unit=$8,
        cogs_total=$9,
        profit_total=$10,
        margin_pct=$11,
        channel=$12,
        notes=$13,
        updated_at=NOW()
      WHERE id=$1
      RETURNING *
      `,
      [
        id,
        soldAt,
        menuItemId,
        qty,
        unitPrice,
        revenueTotal,
        cogsSnapshotId,
        cogsUnit,
        cogsTotal,
        profitTotal,
        marginPct,
        channel,
        notes,
      ]
    );

    return res.json(rows[0]);
  } catch (e) {
    console.error("updateSale error:", e);
    return res.status(500).json({ error: "Failed to update sale" });
  }
};

/**
 * DELETE /api/admin/donas/sales/:id
 */
exports.deleteSale = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Bad id" });

    const curQ = await db.query(`SELECT sold_at FROM donas_sales WHERE id=$1 LIMIT 1`, [id]);
    const cur = curQ.rows?.[0];
    if (!cur) return res.status(404).json({ error: "Sale not found" });

    const ym = toYmFromDate(cur.sold_at);
    if (await isMonthLocked(ym)) {
      return res.status(409).json({ error: `Month ${ym} is locked (#locked)` });
    }

    await db.query(`DELETE FROM donas_sales WHERE id=$1`, [id]);
    return res.json({ ok: true });
  } catch (e) {
    console.error("deleteSale error:", e);
    return res.status(500).json({ error: "Failed to delete sale" });
  }
};

/**
 * POST /api/admin/donas/sales/recalc-cogs?month=YYYY-MM
 * Пересчитывает COGS/Profit/Margin для всех продаж месяца по последнему donas_cogs.
 */
exports.recalcCogsMonth = async (req, res) => {
  try {
    const month = String(req.query.month || "").trim();
    if (!isYm(month)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    if (await isMonthLocked(month)) {
      return res.status(409).json({ error: `Month ${month} is locked (#locked)` });
    }

    // 1) build latest cogs per menu_item_id
    // 2) update sales rows having cogs
    const q1 = await db.query(
      `
      WITH latest AS (
        SELECT DISTINCT ON (menu_item_id)
          menu_item_id,
          id AS cogs_id,
          total_cost
        FROM donas_cogs
        ORDER BY menu_item_id, created_at DESC NULLS LAST, id DESC
      ),
      upd AS (
        UPDATE donas_sales s
        SET
          cogs_snapshot_id = l.cogs_id,
          cogs_unit        = COALESCE(l.total_cost, 0),
          cogs_total       = s.qty * COALESCE(l.total_cost, 0),
          profit_total     = s.revenue_total - (s.qty * COALESCE(l.total_cost, 0)),
          margin_pct       = CASE
                               WHEN s.revenue_total = 0 THEN 0
                               ELSE ((s.revenue_total - (s.qty * COALESCE(l.total_cost,0))) / s.revenue_total) * 100
                             END,
          updated_at       = NOW()
        FROM latest l
        WHERE to_char(s.sold_at,'YYYY-MM') = $1
          AND s.menu_item_id = l.menu_item_id
        RETURNING s.id
      )
      SELECT COUNT(*)::int AS updated
      FROM upd
      `,
      [month]
    );

    // для строк, где нет COGS вообще — приводим к нулю (чтобы было явно)
    await db.query(
      `
      UPDATE donas_sales s
      SET
        cogs_snapshot_id = NULL,
        cogs_unit        = 0,
        cogs_total       = 0,
        profit_total     = s.revenue_total,
        margin_pct       = CASE WHEN s.revenue_total = 0 THEN 0 ELSE 100 END,
        updated_at       = NOW()
      WHERE to_char(s.sold_at,'YYYY-MM') = $1
        AND (s.cogs_snapshot_id IS NULL OR s.cogs_unit IS NULL OR s.cogs_unit = 0)
        AND NOT EXISTS (
          SELECT 1 FROM donas_cogs c WHERE c.menu_item_id = s.menu_item_id
        )
      `,
      [month]
    );

    const updated = q1.rows?.[0]?.updated ?? 0;
    return res.json({ ok: true, month, updated });
  } catch (e) {
    console.error("recalcCogsMonth error:", e);
    return res.status(500).json({ error: "Failed to recalc cogs" });
  }
};
