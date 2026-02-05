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
  // works for '2026-02-01' and '2026-02-01T...'
  return String(d).slice(0, 7);
}

function hasLockedTag(notes) {
  return String(notes || "").toLowerCase().includes("#locked");
}

// фиксируем slug
const SLUG = "donas-dosas";

/**
 * =========================
 * Finance audit helpers (AUTO-TOUCH)
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
  // Таблица аудита
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

  // ВАЖНО: порядок колонок у VIEW должен совпадать с тем, что у тебя уже в БД
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

async function touchMonthAudit(req, ym, meta = {}) {
  if (!isYm(ym)) return;
  const actor = getActor(req);
  await auditInsert({
    ym,
    action: "month.touch",
    diff: { source: "sales" },
    actor,
    meta,
  });
}

/**
 * =========================
 * Existing logic
 * =========================
 */

/**
 * Проверяем, locked ли месяц в donas_finance_months (notes содержит #locked)
 * ym = 'YYYY-MM'
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
 * Находим актуальную себестоимость блюда (total_cost) из donas_cogs
 * Берём последнюю запись по времени/ид.
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

    // 🔒 month lock guard
    const ym = toYmFromDate(soldAt);
    if (await isMonthLocked(ym)) {
      return res.status(409).json({ error: `Month ${ym} is locked (#locked)` });
    }

    const revenueTotal = qty * unitPrice;

    // cogs snapshot
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

    // ✅ AUTO-TOUCH Months audit
    await touchMonthAudit(req, ym, { op: "sale.add", sale_id: rows?.[0]?.id || null });

    return res.json(rows[0]);
  } catch (e) {
    console.error("addSale error:", e);
    return res.status(500).json({ error: "Failed to add sale" });
  }
};

/**
 * PUT /api/admin/donas/sales/:id
 * body: { sold_at?, menu_item_id?, qty?, unit_price?, channel?, notes? }
 *
 * ✅ PATCH:
 * Если у текущей продажи COGS пустой (snapshot_id null / cogs_unit 0),
 * то при сохранении подтягиваем latest COGS даже без смены menu_item_id.
 */
exports.updateSale = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Bad id" });

    // current row
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
    // если переносим продажу в другой месяц — проверяем и новый месяц тоже
    if (newYm !== curYm && (await isMonthLocked(newYm))) {
      return res.status(409).json({ error: `Month ${newYm} is locked (#locked)` });
    }

    // пересчитываем revenue
    const revenueTotal = qty * unitPrice;

    // cogs
    let cogsSnapshotId = cur.cogs_snapshot_id;
    let cogsUnit = toNum(cur.cogs_unit);
    let cogsTotal = toNum(cur.cogs_total);

    const menuItemChanged = Number(menuItemId) !== Number(cur.menu_item_id);
    const qtyChanged = qty !== toNum(cur.qty);

    // ✅ если текущий COGS пустой — лечим при любом сохранении
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

    // ✅ AUTO-TOUCH Months audit:
    // 1) всегда touch исходный месяц
    await touchMonthAudit(req, curYm, { op: "sale.update", sale_id: id });

    // 2) если месяц поменяли — touch новый тоже
    if (newYm && newYm !== curYm) {
      await touchMonthAudit(req, newYm, { op: "sale.move", sale_id: id, from: curYm, to: newYm });
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

    // ✅ AUTO-TOUCH Months audit
    await touchMonthAudit(req, ym, { op: "sale.delete", sale_id: id });

    return res.json({ ok: true });
  } catch (e) {
    console.error("deleteSale error:", e);
    return res.status(500).json({ error: "Failed to delete sale" });
  }
};
