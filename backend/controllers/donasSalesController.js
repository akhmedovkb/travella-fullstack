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
 * Audit (best-effort)
 * =========================
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
  try {
    const actor = getActor(req);

    // Best-effort insert. If table/columns differ in some envs — ignore.
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
  } catch {
    // ignore (older db / schema differences)
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

    // ✅ cogs snapshot фиксируем при создании
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

    const created = rows?.[0] || null;

    await logAudit(req, {
      action: "sale.add",
      ym,
      diff: created
        ? {
            id: created.id,
            sold_at: created.sold_at,
            menu_item_id: created.menu_item_id,
            qty: created.qty,
            unit_price: created.unit_price,
            revenue_total: created.revenue_total,
            cogs_snapshot_id: created.cogs_snapshot_id,
            cogs_unit: created.cogs_unit,
            cogs_total: created.cogs_total,
            channel: created.channel,
            notes: created.notes,
          }
        : { sold_at: soldAt, menu_item_id: menuItemId, qty, unit_price: unitPrice, channel, notes },
    });

    return res.json(created);
  } catch (e) {
    console.error("addSale error:", e);
    return res.status(500).json({ error: "Failed to add sale" });
  }
};

/**
 * PUT /api/admin/donas/sales/:id
 * body: { sold_at?, menu_item_id?, qty?, unit_price?, channel?, notes? }
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
    const channel =
      b.channel == null ? String(cur.channel || "cash") : String(b.channel || "cash");
    const notes = b.notes === undefined ? cur.notes : b.notes == null ? null : String(b.notes);

    const newYm = toYmFromDate(soldAt);
    // если переносим продажу в другой месяц — проверяем и новый месяц тоже
    if (newYm !== curYm && (await isMonthLocked(newYm))) {
      return res.status(409).json({ error: `Month ${newYm} is locked (#locked)` });
    }

    // пересчитываем revenue
    const revenueTotal = qty * unitPrice;

    /**
     * ✅ ВАЖНО (Sales-first):
     * - snapshot COGS НЕ переснимаем при изменении qty/price/channel/notes/sold_at
     * - snapshot переснимаем ТОЛЬКО если поменяли menu_item_id
     */
    let cogsSnapshotId = cur.cogs_snapshot_id;
    let cogsUnit = toNum(cur.cogs_unit);
    let cogsTotal = qty * cogsUnit;

    const menuItemChanged = Number(menuItemId) !== Number(cur.menu_item_id);

    if (menuItemChanged) {
      const snap = await getLatestCogsForMenuItem(menuItemId);
      cogsUnit = toNum(snap?.total_cost);
      cogsTotal = qty * cogsUnit;
      cogsSnapshotId = snap?.id || null;
    } else {
      // menu item same: unit remains snapshot; total follows qty
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

    const updated = rows?.[0] || null;

    await logAudit(req, {
      action: "sale.update",
      ym: newYm,
      diff: {
        id,
        from: {
          sold_at: cur.sold_at,
          menu_item_id: cur.menu_item_id,
          qty: cur.qty,
          unit_price: cur.unit_price,
          revenue_total: cur.revenue_total,
          cogs_snapshot_id: cur.cogs_snapshot_id,
          cogs_unit: cur.cogs_unit,
          cogs_total: cur.cogs_total,
          channel: cur.channel,
          notes: cur.notes,
        },
        to: updated
          ? {
              sold_at: updated.sold_at,
              menu_item_id: updated.menu_item_id,
              qty: updated.qty,
              unit_price: updated.unit_price,
              revenue_total: updated.revenue_total,
              cogs_snapshot_id: updated.cogs_snapshot_id,
              cogs_unit: updated.cogs_unit,
              cogs_total: updated.cogs_total,
              channel: updated.channel,
              notes: updated.notes,
            }
          : { sold_at: soldAt, menu_item_id: menuItemId, qty, unit_price: unitPrice, channel, notes },
      },
      meta: { moved_month: curYm !== newYm, menu_item_changed: menuItemChanged },
    });

    return res.json(updated);
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
      action: "sale.delete",
      ym,
      diff: {
        id,
        sold_at: cur.sold_at,
        menu_item_id: cur.menu_item_id,
        qty: cur.qty,
        unit_price: cur.unit_price,
        revenue_total: cur.revenue_total,
        cogs_snapshot_id: cur.cogs_snapshot_id,
        cogs_unit: cur.cogs_unit,
        cogs_total: cur.cogs_total,
        channel: cur.channel,
        notes: cur.notes,
      },
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("deleteSale error:", e);
    return res.status(500).json({ error: "Failed to delete sale" });
  }
};
