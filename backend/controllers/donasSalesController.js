// backend/controllers/donasSalesController.js

const db = require("../db");
const { touchMonthsFromYms } = require("../utils/donasSalesMonthAggregator");

const SLUG = "donas-dosas";

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

/**
 * =========================
 * Finance audit helpers (sales.* actions)
 * =========================
 */

function getActor(req) {
  const u = req.user || {};
  return {
    id: u.id ?? null,
    role: String(u.role || "").toLowerCase() || null,
    email: u.email || u.mail || null,
    name: u.name || u.full_name || null,
  };
}

async function ensureFinanceAudit() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS donas_finance_audit_log (
        id BIGSERIAL PRIMARY KEY,
        slug TEXT NOT NULL,
        ym TEXT NOT NULL,
        action TEXT NOT NULL,
        diff JSONB NOT NULL DEFAULT '{}'::jsonb,
        actor_name TEXT,
        actor_email TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actor_role TEXT,
        actor_id BIGINT,
        meta JSONB NOT NULL DEFAULT '{}'::jsonb
      );
    `);

    await db.query(`
      CREATE OR REPLACE VIEW donas_finance_audit AS
      SELECT
        id,
        slug,
        ym,
        action,
        actor_id,
        actor_role,
        actor_email,
        actor_name,
        diff,
        meta,
        created_at
      FROM donas_finance_audit_log;
    `);
  } catch (e) {
    console.error("ensureFinanceAudit error:", e);
  }
}

async function auditSales(req, ym, action, meta = {}, diff = {}) {
  try {
    if (!isYm(ym)) return;
    await ensureFinanceAudit();
    const actor = getActor(req);
    await db.query(
      `
      INSERT INTO donas_finance_audit_log
        (slug, ym, action, actor_id, actor_role, actor_email, actor_name, diff, meta)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
      `,
      [
        SLUG,
        ym,
        String(action || "sales.update"),
        actor.id,
        actor.role,
        actor.email,
        actor.name,
        JSON.stringify(diff || {}),
        JSON.stringify(meta || {}),
      ]
    );
  } catch (e) {
    console.error("auditSales error:", e);
  }
}

/**
 * =========================
 * Month lock guard
 * =========================
 */

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

/**
 * Latest COGS snapshot
 */
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
 * =========================
 * Controllers
 * =========================
 */

/**
 * GET /api/admin/donas/sales?month=YYYY-MM
 */
async function getSales(req, res) {
  try {
    const { month } = req.query;

    let where = "";
    const params = [];

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
}

/**
 * POST /api/admin/donas/sales
 * body: { sold_at, menu_item_id, qty, unit_price, channel, notes? }
 */
async function addSale(req, res) {
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

    const { rows } = await db.query(
      `
      INSERT INTO donas_sales
        (sold_at, menu_item_id, qty, unit_price, revenue_total,
         cogs_snapshot_id, cogs_unit, cogs_total, channel, notes)
      VALUES
        ($1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10)
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
        channel,
        notes,
      ]
    );

    await auditSales(
      req,
      ym,
      "sales.add",
      { sale_id: rows?.[0]?.id || null, channel },
      { revenue_total: revenueTotal, cogs_total: cogsTotal }
    );

    // ✅ FULL auto-touch: sales+purchases+cash_end chain + locked stop
    await touchMonthsFromYms([ym]);

    return res.json(rows[0]);
  } catch (e) {
    console.error("addSale error:", e);
    return res.status(500).json({ error: "Failed to add sale" });
  }
}

/**
 * PUT /api/admin/donas/sales/:id
 */
async function updateSale(req, res) {
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
    const notes = b.notes === undefined ? cur.notes : b.notes == null ? null : String(b.notes);

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
        channel=$10,
        notes=$11,
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
        channel,
        notes,
      ]
    );

    await auditSales(
      req,
      curYm,
      "sales.update",
      { sale_id: id, channel },
      { revenue_total: revenueTotal, cogs_total: cogsTotal }
    );

    if (newYm && newYm !== curYm) {
      await auditSales(
        req,
        newYm,
        "sales.move",
        { sale_id: id, from: curYm, to: newYm, channel },
        { revenue_total: revenueTotal, cogs_total: cogsTotal }
      );
    }

    // ✅ FULL auto-touch с min(curYm,newYm) чтобы cash_end цепочка была корректной
    await touchMonthsFromYms([curYm, newYm]);

    return res.json(rows[0]);
  } catch (e) {
    console.error("updateSale error:", e);
    return res.status(500).json({ error: "Failed to update sale" });
  }
}

/**
 * DELETE /api/admin/donas/sales/:id
 */
async function deleteSale(req, res) {
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

    await auditSales(req, ym, "sales.delete", { sale_id: id }, { deleted: true });

    // ✅ FULL auto-touch
    await touchMonthsFromYms([ym]);

    return res.json({ ok: true });
  } catch (e) {
    console.error("deleteSale error:", e);
    return res.status(500).json({ error: "Failed to delete sale" });
  }
}

/**
 * POST /api/admin/donas/sales/recalc-cogs?month=YYYY-MM
 * Пересчитывает COGS для продаж месяца по актуальным donas_cogs
 */
async function recalcCogsMonth(req, res) {
  try {
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "month=YYYY-MM required" });
    }

    if (await isMonthLocked(month)) {
      return res.status(409).json({ error: `Month ${month} is locked (#locked)` });
    }

    const sales = await db.query(
      `
      SELECT id, menu_item_id, qty
      FROM donas_sales
      WHERE to_char(sold_at,'YYYY-MM') = $1
      `,
      [month]
    );

    let updated = 0;

    for (const s of sales.rows) {
      const snap = await getLatestCogsForMenuItem(s.menu_item_id);
      if (!snap) continue;

      const cogsUnit = toNum(snap.total_cost);
      const cogsTotal = cogsUnit * toNum(s.qty);

      await db.query(
        `
        UPDATE donas_sales
        SET
          cogs_snapshot_id = $2,
          cogs_unit = $3,
          cogs_total = $4,
          updated_at = NOW()
        WHERE id = $1
        `,
        [s.id, snap.id, cogsUnit, cogsTotal]
      );

      updated++;
    }

    await auditSales(req, month, "sales.recalc_cogs", { updated }, {});

    // ✅ FULL auto-touch (после пересчёта cogs_total поменялись)
    await touchMonthsFromYms([month]);

    return res.json({ ok: true, updated });
  } catch (e) {
    console.error("recalcCogsMonth error:", e);
    return res.status(500).json({ error: "Failed to recalc COGS" });
  }
}

module.exports = {
  getSales,
  addSale,
  updateSale,
  deleteSale,
  recalcCogsMonth,
};
