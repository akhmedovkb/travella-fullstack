// backend/controllers/donasSalesController.js
const db = require("../db");
const { touchMonthFromSales } = require("../utils/donasSalesMonthAggregator");

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

/**
 * =========================
 * Finance audit helpers (actions sales.*)
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

  // ВАЖНО: порядок колонок view совпадает с тем, что у тебя уже в БД:
  // id, slug, ym, action, diff, actor_name, actor_email, created_at, actor_role, actor_id, meta
  await db.query(`
    CREATE OR REPLACE VIEW donas_finance_audit AS
    SELECT
      id,
      slug,
      ym,
      action,
      diff,
      actor_name,
      actor_email,
      created_at,
      actor_role,
      actor_id,
      meta
    FROM donas_finance_audit_log;
  `);
}

async function auditInsert({ ym, action, diff, actor, meta }) {
  try {
    await ensureFinanceAudit();
    await db.query(
      `
      INSERT INTO donas_finance_audit_log
        (slug, ym, action, diff, actor_name, actor_email, actor_role, actor_id, meta)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `,
      [
        SLUG,
        String(ym || ""),
        String(action || ""),
        diff ? diff : {},
        actor?.name || null,
        actor?.email || null,
        actor?.role || null,
        actor?.id != null ? Number(actor.id) : null,
        meta ? meta : {},
      ]
    );
  } catch (e) {
    console.error("auditInsert error:", e);
  }
}

async function auditSales(req, ym, action, meta = {}, diff = {}) {
  if (!isYm(ym)) return;
  const actor = getActor(req);
  await auditInsert({
    ym,
    action: action || "sales.update",
    diff: diff || {},
    actor,
    meta: meta || {},
  });
}

/**
 * =========================
 * Existing logic
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

    // ✅ Audit: sales.add
    await auditSales(
      req,
      ym,
      "sales.add",
      { sale_id: rows?.[0]?.id || null, channel },
      { revenue_total: revenueTotal, cogs_total: cogsTotal }
    );

    // ✅ AUTO-TOUCH MONTHS (revenue/cogs from sales)
    await touchMonthFromSales(ym);

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

    // ✅ Audit:
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

    // ✅ AUTO-TOUCH MONTHS:
    // всегда трогаем исходный месяц
    await touchMonthFromSales(curYm);
    // если переехали — трогаем и новый
    if (newYm && newYm !== curYm) {
      await touchMonthFromSales(newYm);
    }

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

    // ✅ Audit: sales.delete
    await auditSales(req, ym, "sales.delete", { sale_id: id }, { deleted: true });

    // ✅ AUTO-TOUCH MONTHS
    await touchMonthFromSales(ym);

    return res.json({ ok: true });
  } catch (e) {
    console.error("deleteSale error:", e);
    return res.status(500).json({ error: "Failed to delete sale" });
  }
};
