// backend/controllers/donasSalesController.js

const db = require("../db");
const { touchMonthsFromYms } = require("../utils/donasSalesMonthAggregator");
const { autoSyncMonthsForDate } = require("../utils/donasFinanceAutoSync");

const SLUG = "donas-dosas";

async function ensureSalesTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS donas_sales (
      id BIGSERIAL PRIMARY KEY,
      sold_at DATE NOT NULL,
      menu_item_id BIGINT NOT NULL,
      qty NUMERIC NOT NULL DEFAULT 1,
      unit_price NUMERIC NOT NULL DEFAULT 0,
      revenue_total NUMERIC NOT NULL DEFAULT 0,
      cogs_snapshot_id BIGINT,
      cogs_unit NUMERIC NOT NULL DEFAULT 0,
      cogs_total NUMERIC NOT NULL DEFAULT 0,
      channel TEXT NOT NULL DEFAULT 'cash',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_donas_sales_sold_at ON donas_sales (sold_at);`);
  await db.query(
    `CREATE INDEX IF NOT EXISTS idx_donas_sales_menu_item_id ON donas_sales (menu_item_id);`
  );

  try {
    await db.query(
      `ALTER TABLE donas_sales
       ADD CONSTRAINT fk_donas_sales_menu_item
       FOREIGN KEY (menu_item_id) REFERENCES donas_menu_items(id)
       ON DELETE RESTRICT;`
    );
  } catch {}

  try {
    await db.query(
      `ALTER TABLE donas_sales
       ADD CONSTRAINT fk_donas_sales_cogs_snapshot
       FOREIGN KEY (cogs_snapshot_id) REFERENCES donas_cogs(id)
       ON DELETE SET NULL;`
    );
  } catch {}
}

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
 * ✅ Normalize sold_at to YYYY-MM-DD (no timezone).
 * Accepts: YYYY-MM-DD, YYYY-MM-DDTHH..., DD.MM.YYYY, DD/MM/YYYY
 */
function normalizeSoldAt(x) {
  const s = String(x || "").trim();
  if (!s) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);

  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split(".");
    return `${yyyy}-${mm}-${dd}`;
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split("/");
    return `${yyyy}-${mm}-${dd}`;
  }

  return s;
}

/**
 * =========================
 * Finance audit helpers
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

    // ✅ FIX: если view раньше был с другим набором колонок — Postgres не даст "CREATE OR REPLACE"
    // Поэтому всегда дропаем и создаём заново.
    await db.query(`DROP VIEW IF EXISTS donas_finance_audit;`);

    await db.query(`
      CREATE VIEW donas_finance_audit AS
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
 * ✅ Price source of truth from Menu Items
 * We prefer sell_price, fallback to price, else 0
 */
async function getMenuItemUnitPrice(menuItemId) {
  const { rows } = await db.query(
    `
    SELECT sell_price, price
    FROM donas_menu_items
    WHERE id=$1
    LIMIT 1
    `,
    [menuItemId]
  );
  const r = rows?.[0] || {};
  const sp = toNum(r.sell_price);
  const p = toNum(r.price);
  return sp > 0 ? sp : p > 0 ? p : 0;
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
 * ✅ Always return sold_at as "YYYY-MM-DD" string
 */
async function getSaleByIdFormatted(id) {
  if (!id) return null;

  const { rows } = await db.query(
    `
    SELECT
      s.id,
      to_char(s.sold_at, 'YYYY-MM-DD') AS sold_at,
      s.menu_item_id,
      s.qty,
      s.unit_price,
      s.revenue_total,
      s.cogs_snapshot_id,
      s.cogs_unit,
      s.cogs_total,
      s.channel,
      s.notes,
      s.created_at,
      s.updated_at,
      (COALESCE(s.revenue_total,0) - COALESCE(s.cogs_total,0)) AS profit_total,
      CASE
        WHEN COALESCE(s.revenue_total,0) = 0 THEN 0
        ELSE ((COALESCE(s.revenue_total,0) - COALESCE(s.cogs_total,0)) / COALESCE(s.revenue_total,0)) * 100
      END AS margin_pct,
      mi.name AS menu_item_name
    FROM donas_sales s
    LEFT JOIN donas_menu_items mi ON mi.id = s.menu_item_id
    WHERE s.id = $1
    LIMIT 1
    `,
    [id]
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
    await ensureSalesTable();
    const { month } = req.query;

    let where = "";
    const params = [];

    if (month) {
      if (!isYm(month)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });
      where = "WHERE to_char(s.sold_at, 'YYYY-MM') = $1";
      params.push(month);
    }

    // ✅ IMPORTANT: sold_at is returned as plain "YYYY-MM-DD" string (no timezone shifts)
    const { rows } = await db.query(
      `
      SELECT
        s.id,
        to_char(s.sold_at, 'YYYY-MM-DD') AS sold_at,
        s.menu_item_id,
        s.qty,
        s.unit_price,
        s.revenue_total,
        s.cogs_snapshot_id,
        s.cogs_unit,
        s.cogs_total,
        s.channel,
        s.notes,
        s.created_at,
        s.updated_at,
        (COALESCE(s.revenue_total,0) - COALESCE(s.cogs_total,0)) AS profit_total,
        CASE
          WHEN COALESCE(s.revenue_total,0) = 0 THEN 0
          ELSE ((COALESCE(s.revenue_total,0) - COALESCE(s.cogs_total,0)) / COALESCE(s.revenue_total,0)) * 100
        END AS margin_pct,
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
}

/**
 * POST /api/admin/donas/sales
 * body: { sold_at, menu_item_id, qty, unit_price?, channel, notes? }
 */
async function addSale(req, res) {
  try {
    await ensureSalesTable();
    const b = req.body || {};

    const soldAt = normalizeSoldAt(b.sold_at);
    const menuItemId = Number(b.menu_item_id);
    const qty = toNum(b.qty);
    let unitPrice = toNum(b.unit_price);
    const channel = String(b.channel || "cash").trim() || "cash";
    const notes = b.notes == null ? null : String(b.notes);

    if (!soldAt) return res.status(400).json({ error: "sold_at required" });
    if (!Number.isFinite(menuItemId) || menuItemId <= 0) {
      return res.status(400).json({ error: "menu_item_id required" });
    }
    if (!qty || qty <= 0) return res.status(400).json({ error: "qty must be > 0" });

    const ym = toYmFromDate(soldAt);
    if (!isYm(ym)) return res.status(400).json({ error: "sold_at invalid" });

    if (await isMonthLocked(ym)) {
      return res.status(409).json({ error: `Month ${ym} is locked (#locked)` });
    }

    // ✅ if unit_price not provided or 0 -> take from menu item
    if (unitPrice <= 0) {
      unitPrice = await getMenuItemUnitPrice(menuItemId);
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
        ($1::date, $2, $3, $4, $5,
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
      { revenue_total: revenueTotal, cogs_total: cogsTotal, unit_price: unitPrice }
    );

    // ✅ legacy recompute hook (keeps current behavior)
    await touchMonthsFromYms([ym]);

    // ✅ NEW: auto-sync chain (cash_end) immediately
    await autoSyncMonthsForDate(req, soldAt, "sales.add");

    const out = await getSaleByIdFormatted(rows?.[0]?.id);
    return res.json(out || rows[0]);
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
    await ensureSalesTable();
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

    const soldAt =
      b.sold_at == null ? String(cur.sold_at).slice(0, 10) : normalizeSoldAt(b.sold_at);

    const menuItemId = b.menu_item_id == null ? Number(cur.menu_item_id) : Number(b.menu_item_id);
    const qty = b.qty == null ? toNum(cur.qty) : toNum(b.qty);

    let unitPrice = b.unit_price == null ? toNum(cur.unit_price) : toNum(b.unit_price);

    const channel = b.channel == null ? String(cur.channel || "cash") : String(b.channel || "cash");
    const notes = b.notes === undefined ? cur.notes : b.notes == null ? null : String(b.notes);

    if (!soldAt) return res.status(400).json({ error: "sold_at required" });
    if (!Number.isFinite(menuItemId) || menuItemId <= 0) {
      return res.status(400).json({ error: "menu_item_id required" });
    }
    if (!qty || qty <= 0) return res.status(400).json({ error: "qty must be > 0" });

    const nextYm = toYmFromDate(soldAt);
    if (!isYm(nextYm)) return res.status(400).json({ error: "sold_at invalid" });

    if (nextYm !== curYm && (await isMonthLocked(nextYm))) {
      return res.status(409).json({ error: `Month ${nextYm} is locked (#locked)` });
    }

    // ✅ if unit_price is 0 -> take from menu item (supports changing menu item too)
    if (unitPrice <= 0) {
      unitPrice = await getMenuItemUnitPrice(menuItemId);
    }

    const revenueTotal = qty * unitPrice;

    const snap = await getLatestCogsForMenuItem(menuItemId);
    const cogsUnit = toNum(snap?.total_cost);
    const cogsTotal = qty * cogsUnit;
    const cogsSnapshotId = snap?.id || null;

    const diff = {};
    const setDiff = (k, vOld, vNew) => {
      if (String(vOld ?? "") !== String(vNew ?? "")) diff[k] = { from: vOld, to: vNew };
    };

    setDiff("sold_at", cur.sold_at, soldAt);
    setDiff("menu_item_id", cur.menu_item_id, menuItemId);
    setDiff("qty", cur.qty, qty);
    setDiff("unit_price", cur.unit_price, unitPrice);
    setDiff("revenue_total", cur.revenue_total, revenueTotal);
    setDiff("cogs_snapshot_id", cur.cogs_snapshot_id, cogsSnapshotId);
    setDiff("cogs_unit", cur.cogs_unit, cogsUnit);
    setDiff("cogs_total", cur.cogs_total, cogsTotal);
    setDiff("channel", cur.channel, channel);
    setDiff("notes", cur.notes, notes);

    const { rows } = await db.query(
      `
      UPDATE donas_sales
      SET sold_at=$1::date,
          menu_item_id=$2,
          qty=$3,
          unit_price=$4,
          revenue_total=$5,
          cogs_snapshot_id=$6,
          cogs_unit=$7,
          cogs_total=$8,
          channel=$9,
          notes=$10,
          updated_at=NOW()
      WHERE id=$11
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
        id,
      ]
    );

    await auditSales(req, nextYm, "sales.update", { sale_id: id }, diff);

    const yms = nextYm === curYm ? [nextYm] : [curYm, nextYm];

    // ✅ legacy recompute hook (keeps current behavior)
    await touchMonthsFromYms(yms);

    // ✅ NEW: auto-sync chain for affected months (old + new dates)
    const dates = new Set([String(cur.sold_at).slice(0, 10), soldAt]);
    for (const d of dates) {
      await autoSyncMonthsForDate(req, d, "sales.update");
    }

    const out = await getSaleByIdFormatted(id);
    return res.json(out || rows[0]);
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
    await ensureSalesTable();
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

    await auditSales(req, ym, "sales.delete", { sale_id: id }, { deleted: true });

    // ✅ legacy recompute hook — НЕ блокируем ответ
    touchMonthsFromYms([ym]).catch((e) =>
      console.error("touchMonthsFromYms async error:", e)
    );

    // ✅ auto-sync chain — НЕ блокируем ответ
    autoSyncMonthsForDate(req, String(cur.sold_at).slice(0, 10), "sales.delete").catch((e) =>
      console.error("autoSyncMonthsForDate async error:", e)
    );

    return res.json({ ok: true });

  } catch (e) {
    console.error("deleteSale error:", e);
    return res.status(500).json({ error: "Failed to delete sale" });
  }
}

/**
 * POST /api/admin/donas/sales/recalc-cogs?month=YYYY-MM
 */
async function recalcCogsMonth(req, res) {
  try {
    await ensureSalesTable();
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "month=YYYY-MM required" });
    }

    if (await isMonthLocked(month)) {
      return res.status(409).json({ error: `Month ${month} is locked (#locked)` });
    }

    const salesQ = await db.query(
      `
      SELECT *
      FROM donas_sales
      WHERE to_char(sold_at,'YYYY-MM')=$1
      ORDER BY sold_at ASC, id ASC
      `,
      [month]
    );

    let updated = 0;
    for (const s of salesQ.rows || []) {
      const snap = await getLatestCogsForMenuItem(s.menu_item_id);
      const cogsUnit = toNum(snap?.total_cost);
      const cogsTotal = toNum(s.qty) * cogsUnit;
      const cogsSnapshotId = snap?.id || null;

      if (
        Number(toNum(s.cogs_unit)) === Number(cogsUnit) &&
        Number(toNum(s.cogs_total)) === Number(cogsTotal) &&
        Number(s.cogs_snapshot_id || 0) === Number(cogsSnapshotId || 0)
      ) {
        continue;
      }

      await db.query(
        `
        UPDATE donas_sales
        SET cogs_snapshot_id=$1,
            cogs_unit=$2,
            cogs_total=$3,
            updated_at=NOW()
        WHERE id=$4
        `,
        [cogsSnapshotId, cogsUnit, cogsTotal, s.id]
      );

      updated++;
    }

    await auditSales(req, month, "sales.recalc_cogs", { updated }, {});

    // ✅ legacy recompute hook (keeps current behavior)
    await touchMonthsFromYms([month]);

    // ✅ NEW: auto-sync chain (use month start as dateLike)
    await autoSyncMonthsForDate(req, `${month}-01`, "sales.recalc_cogs");

    return res.json({ ok: true, month, updated });
  } catch (e) {
    console.error("recalcCogsMonth error:", e);
    return res.status(500).json({ error: "Failed to recalc cogs" });
  }
}

module.exports = {
  getSales,
  addSale,
  updateSale,
  deleteSale,
  recalcCogsMonth,
};
