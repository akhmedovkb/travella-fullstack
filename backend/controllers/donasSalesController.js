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
 * ==============
 * Audit helpers
 * ==============
 */
function getActor(req) {
  const u = req.user || {};
  return {
    id: u.id ?? null,
    role: String(u.role || "").toLowerCase() || null,
    email: u.email || u.mail || null,
    name: u.name || u.full_name || u.fullName || null,
  };
}

async function logAudit(req, { action, ym = null, diff = {}, meta = {} }) {
  // Таблица/вью могут отличаться на старых БД — не ломаем сервер.
  try {
    const actor = getActor(req);
    await db.query(
      `
      INSERT INTO donas_finance_audit
        (slug, ym, action, actor_id, actor_role, actor_email, actor_name, diff, meta)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
      `,
      [
        SLUG,
        ym,
        action,
        actor.id,
        actor.role,
        actor.email,
        actor.name,
        JSON.stringify(diff || {}),
        JSON.stringify(meta || {}),
      ]
    );
  } catch (e) {
    // silently ignore
  }
}

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

function calcProfitAndMargin(revenueTotal, cogsTotal) {
  const rev = toNum(revenueTotal);
  const cgs = toNum(cogsTotal);
  const profit = rev - cgs;
  const margin = rev === 0 ? 0 : (profit / rev) * 100;
  return { profit_total: profit, margin_pct: margin };
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
      where = "WHERE to_char(s.sold_at, 'YYYY-MM') = $1";
      params.push(month);
    }

    const { rows } = await db.query(
      `
      SELECT s.*,
             mi.name AS menu_item_name
      FROM donas_sales s
      LEFT JOIN donas_menu_items mi ON mi.id = s.menu_item_id
      ${where}
      ORDER BY s.sold_at DESC, s.id DESC
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

    const { profit_total, margin_pct } = calcProfitAndMargin(revenueTotal, cogsTotal);

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
        profit_total,
        margin_pct,
        channel,
        notes,
      ]
    );

    const row = rows[0];

    await logAudit(req, {
      action: "sales.create",
      ym,
      diff: {
        sale_id: row?.id,
        menu_item_id: menuItemId,
        qty,
        unit_price: unitPrice,
        revenue_total: revenueTotal,
        cogs_total: cogsTotal,
        profit_total,
        margin_pct,
        channel,
      },
      meta: { sale_id: row?.id },
    });

    return res.json(row);
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
    const notes = b.notes === undefined ? cur.notes : b.notes == null ? null : String(b.notes);

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

    const { profit_total, margin_pct } = calcProfitAndMargin(revenueTotal, cogsTotal);

    const before = {
      sold_at: cur.sold_at,
      menu_item_id: cur.menu_item_id,
      qty: toNum(cur.qty),
      unit_price: toNum(cur.unit_price),
      revenue_total: toNum(cur.revenue_total),
      cogs_snapshot_id: cur.cogs_snapshot_id,
      cogs_unit: toNum(cur.cogs_unit),
      cogs_total: toNum(cur.cogs_total),
      profit_total: toNum(cur.profit_total),
      margin_pct: toNum(cur.margin_pct),
      channel: cur.channel,
      notes: cur.notes,
    };

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
        profit_total,
        margin_pct,
        channel,
        notes,
      ]
    );

    const row = rows[0];

    await logAudit(req, {
      action: "sales.update",
      ym: newYm,
      diff: {
        sale_id: id,
        from: before,
        to: {
          sold_at: soldAt,
          menu_item_id: menuItemId,
          qty,
          unit_price: unitPrice,
          revenue_total: revenueTotal,
          cogs_snapshot_id: cogsSnapshotId,
          cogs_unit: cogsUnit,
          cogs_total: cogsTotal,
          profit_total,
          margin_pct,
          channel,
          notes,
        },
      },
      meta: { sale_id: id },
    });

    return res.json(row);
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

    const curQ = await db.query(`SELECT * FROM donas_sales WHERE id=$1 LIMIT 1`, [id]);
    const cur = curQ.rows?.[0];
    if (!cur) return res.status(404).json({ error: "Sale not found" });

    const ym = toYmFromDate(cur.sold_at);
    if (await isMonthLocked(ym)) {
      return res.status(409).json({ error: `Month ${ym} is locked (#locked)` });
    }

    await db.query(`DELETE FROM donas_sales WHERE id=$1`, [id]);

    await logAudit(req, {
      action: "sales.delete",
      ym,
      diff: { sale_id: id, deleted: true },
      meta: { sale_id: id },
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("deleteSale error:", e);
    return res.status(500).json({ error: "Failed to delete sale" });
  }
};

/**
 * POST /api/admin/donas/sales/recalc-cogs?month=YYYY-MM
 * Пересчитывает COGS + Profit/Margin по последнему donas_cogs для каждого menu_item_id.
 *
 * 🔒 Если месяц #locked — 409.
 */
exports.recalcCogs = async (req, res) => {
  try {
    const month = String(req.query.month || "").trim();
    if (!month || !isYm(month)) {
      return res.status(400).json({ error: "month query param required (YYYY-MM)" });
    }

    if (await isMonthLocked(month)) {
      return res.status(409).json({ error: `Month ${month} is locked (#locked)` });
    }

    // Один SQL, быстро и атомарно.
    // latest cogs per menu_item_id
    const q = `
      WITH latest AS (
        SELECT DISTINCT ON (menu_item_id)
          menu_item_id,
          id AS cogs_snapshot_id,
          COALESCE(total_cost, 0) AS cogs_unit
        FROM donas_cogs
        ORDER BY menu_item_id, created_at DESC NULLS LAST, id DESC
      ),
      upd AS (
        UPDATE donas_sales s
        SET
          revenue_total = COALESCE(s.qty,0) * COALESCE(s.unit_price,0),
          cogs_snapshot_id = l.cogs_snapshot_id,
          cogs_unit = COALESCE(l.cogs_unit,0),
          cogs_total = COALESCE(s.qty,0) * COALESCE(l.cogs_unit,0),
          profit_total = (COALESCE(s.qty,0) * COALESCE(s.unit_price,0)) - (COALESCE(s.qty,0) * COALESCE(l.cogs_unit,0)),
          margin_pct = CASE
            WHEN (COALESCE(s.qty,0) * COALESCE(s.unit_price,0)) = 0 THEN 0
            ELSE (
              ((COALESCE(s.qty,0) * COALESCE(s.unit_price,0)) - (COALESCE(s.qty,0) * COALESCE(l.cogs_unit,0)))
              / (COALESCE(s.qty,0) * COALESCE(s.unit_price,0))
            ) * 100
          END,
          updated_at = NOW()
        FROM latest l
        WHERE
          l.menu_item_id = s.menu_item_id
          AND to_char(s.sold_at, 'YYYY-MM') = $1
        RETURNING s.id
      )
      SELECT COUNT(*)::int AS updated
      FROM upd
    `;

    const { rows } = await db.query(q, [month]);
    const updated = rows?.[0]?.updated || 0;

    await logAudit(req, {
      action: "sales.recalc_cogs",
      ym: month,
      diff: { month, updated },
      meta: { month },
    });

    return res.json({ ok: true, month, updated });
  } catch (e) {
    console.error("recalcCogs error:", e);
    return res.status(500).json({ error: "Failed to recalc cogs" });
  }
};
