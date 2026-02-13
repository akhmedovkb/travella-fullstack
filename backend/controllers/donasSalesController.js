const db = require("../db");
const { touchMonthsFromYms } = require("../utils/donasSalesMonthAggregator");
const { autoSyncMonthsForDate } = require("../utils/donasFinanceAutoSync");
const invCtrl = require("./donasInventoryController");

const SLUG = "donas-dosas";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function s(x) {
  return String(x == null ? "" : x).trim();
}
function isYm(x) {
  return /^\d{4}-\d{2}$/.test(String(x || "").trim());
}
function monthFromDateLike(x) {
  const v = String(x || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.slice(0, 7);
  if (isYm(v)) return v;
  return "";
}
function normalizeSoldAt(x) {
  const v = String(x || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/^\d{4}-\d{2}$/.test(v)) return `${v}-01`;
  return "";
}

/**
 * =========================
 * Inventory auto-consume helpers
 * =========================
 */

function normUnit(u) {
  const v = String(u || "").trim().toLowerCase();
  return v || "pcs";
}

function convertQty(qty, fromUnit, toUnit) {
  const q = toNum(qty);
  const f = normUnit(fromUnit);
  const t = normUnit(toUnit);
  if (!q) return 0;
  if (f === t) return q;

  // weight
  if (f === "g" && t === "kg") return q / 1000;
  if (f === "kg" && t === "g") return q * 1000;

  // volume
  if (f === "ml" && t === "l") return q / 1000;
  if (f === "l" && t === "ml") return q * 1000;

  // no safe conversion
  return NaN;
}

async function getOnHand(client, itemId) {
  const q = await client.query(
    `
    SELECT COALESCE(SUM(qty_in - qty_out),0) AS on_hand
    FROM donas_inventory_ledger
    WHERE slug=$1 AND item_id=$2
    `,
    [SLUG, itemId]
  );
  return toNum(q.rows?.[0]?.on_hand);
}

async function ensureInventoryItemForIngredient(client, ingredientId) {
  // try find inventory item mapped to ingredient_id
  const ex = await client.query(
    `
    SELECT id, unit
    FROM donas_inventory_items
    WHERE slug=$1 AND ingredient_id=$2
    LIMIT 1
    `,
    [SLUG, ingredientId]
  );
  if (ex.rows?.length) return ex.rows[0];

  // fetch ingredient meta
  const ing = await client.query(
    `
    SELECT id, name, unit
    FROM donas_ingredients
    WHERE id=$1
    LIMIT 1
    `,
    [ingredientId]
  );
  if (!ing.rows?.length) return null;

  const r = ing.rows[0];
  const unit = normUnit(r.unit);

  // create inventory item linked to ingredient_id
  const ins = await client.query(
    `
    INSERT INTO donas_inventory_items (slug, name, unit, min_qty, is_active, ingredient_id)
    VALUES ($1,$2,$3,0,TRUE,$4)
    ON CONFLICT (slug, ingredient_id)
    DO UPDATE SET name=EXCLUDED.name, unit=EXCLUDED.unit, updated_at=NOW()
    RETURNING id, unit
    `,
    [SLUG, String(r.name || `#${r.id}`), unit, r.id]
  );
  return ins.rows?.[0] || null;
}

async function autoConsumeInventoryForSale(client, { saleId, soldAt, menuItemId, qty }) {
  // ensure tables exist (idempotent)
  if (invCtrl?._internal?.ensureInventoryTables) {
    await invCtrl._internal.ensureInventoryTables();
  }

  // get recipe/components for menu item
  const compsQ = await client.query(
    `
    SELECT ingredient_id, qty, unit
    FROM donas_menu_item_components
    WHERE menu_item_id=$1
    ORDER BY id ASC
    `,
    [menuItemId]
  );

  const comps = Array.isArray(compsQ.rows) ? compsQ.rows : [];
  if (!comps.length) return { ok: true, skipped: true, reason: "no_components" };

  // first pass: calculate + validate stock
  const lines = [];
  for (const c of comps) {
    const ingredientId = Number(c.ingredient_id);
    if (!Number.isFinite(ingredientId) || ingredientId <= 0) continue;

    const invItem = await ensureInventoryItemForIngredient(client, ingredientId);
    if (!invItem?.id) continue;

    const needRaw = toNum(c.qty) * toNum(qty); // in component unit
    const need = convertQty(needRaw, c.unit, invItem.unit); // in inventory unit
    if (!Number.isFinite(need) || need <= 0) {
      return {
        ok: false,
        error: `Unit mismatch for ingredient_id=${ingredientId}: ${c.unit} -> ${invItem.unit}`,
      };
    }

    const onHand = await getOnHand(client, invItem.id);
    if (onHand < need) {
      return {
        ok: false,
        status: 409,
        error: `Not enough stock for ingredient_id=${ingredientId}`,
        details: { ingredient_id: ingredientId, item_id: invItem.id, onHand, need },
      };
    }

    lines.push({ item_id: invItem.id, qty_out: need, ingredient_id: ingredientId });
  }

  // second pass: write ledger OUT
  for (const ln of lines) {
    await client.query(
      `
      INSERT INTO donas_inventory_ledger
        (slug, item_id, move_date, qty_in, qty_out, reason, ref_type, ref_id, notes)
      VALUES
        ($1,$2,$3::date,0,$4,'sale','sale',$5,$6)
      `,
      [
        SLUG,
        ln.item_id,
        soldAt,
        ln.qty_out,
        saleId,
        `sale#${saleId} menu_item_id=${menuItemId}`.trim(),
      ]
    );
  }

  return { ok: true, lines: lines.length };
}

/**
 * =========================
 * Ensure table (Sales)
 * =========================
 */

async function ensureSalesTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS donas_sales (
      id BIGSERIAL PRIMARY KEY,
      sold_at DATE NOT NULL,
      menu_item_id BIGINT NOT NULL,
      qty NUMERIC NOT NULL DEFAULT 0,
      unit_price NUMERIC NOT NULL DEFAULT 0,
      total NUMERIC GENERATED ALWAYS AS (qty * unit_price) STORED,
      channel TEXT NOT NULL DEFAULT '',
      cogs_snapshot_id BIGINT,
      cogs_unit NUMERIC NOT NULL DEFAULT 0,
      cogs_total NUMERIC NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_donas_sales_sold_at ON donas_sales (sold_at);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_donas_sales_menu_item ON donas_sales (menu_item_id);`);
}
/**
 * =========================
 * Audit
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

async function ensureAuditTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS donas_sales_audit (
      id BIGSERIAL PRIMARY KEY,
      at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      actor_id BIGINT,
      actor_role TEXT,
      actor_email TEXT,
      actor_name TEXT,
      ym TEXT NOT NULL,
      action TEXT NOT NULL,
      before_json JSONB,
      after_json JSONB
    );
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_donas_sales_audit_ym ON donas_sales_audit (ym);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_donas_sales_audit_at ON donas_sales_audit (at);`);
}

async function auditSales(req, ym, action, beforeObj, afterObj) {
  try {
    if (!ym) return;
    await ensureAuditTable();
    const a = getActor(req);
    await db.query(
      `
      INSERT INTO donas_sales_audit
        (actor_id, actor_role, actor_email, actor_name, ym, action, before_json, after_json)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
      `,
      [
        a.id,
        a.role,
        a.email,
        a.name,
        ym,
        action,
        JSON.stringify(beforeObj || {}),
        JSON.stringify(afterObj || {}),
      ]
    );
  } catch (e) {
    console.error("auditSales error:", e);
  }
}

/**
 * =========================
 * COGS helpers (uses latest ingredient prices)
 * =========================
 */

async function getLatestCogsForMenuItem(menuItemId) {
  // The project already uses COGS snapshots elsewhere.
  // Here we compute “live” cost from ingredients + components.
  // Return a “snapshot-like” object: { id:null, total_cost:number }
  try {
    const q = await db.query(
      `
      SELECT c.ingredient_id, c.qty, c.unit,
             i.unit AS ing_unit,
             i.pack_size, i.pack_price
      FROM donas_menu_item_components c
      JOIN donas_ingredients i ON i.id=c.ingredient_id
      WHERE c.menu_item_id=$1
      `,
      [menuItemId]
    );

    let total = 0;
    for (const r of q.rows || []) {
      const compQty = toNum(r.qty);
      const compUnit = r.unit;
      const ingUnit = r.ing_unit;
      const packSize = toNum(r.pack_size);
      const packPrice = toNum(r.pack_price);

      if (!(packSize > 0)) continue;

      const qtyInIngUnit = convertQty(compQty, compUnit, ingUnit);
      if (!Number.isFinite(qtyInIngUnit) || qtyInIngUnit <= 0) continue;

      const pricePerUnit = packPrice / packSize;
      total += qtyInIngUnit * pricePerUnit;
    }

    return { id: null, total_cost: total };
  } catch (e) {
    console.error("getLatestCogsForMenuItem error:", e);
    return { id: null, total_cost: 0 };
  }
}

async function getSalesRowsForMonth(monthYm) {
  const q = await db.query(
    `
    SELECT id, sold_at, menu_item_id, qty, unit_price, channel, notes, cogs_unit, cogs_total, cogs_snapshot_id
    FROM donas_sales
    WHERE to_char(sold_at,'YYYY-MM')=$1
    ORDER BY sold_at ASC, id ASC
    `,
    [monthYm]
  );
  return q.rows || [];
}

// GET /api/admin/donas/sales/:id
async function getSale(req, res) {
  try {
    await ensureSalesTable();

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Bad id" });

    const sale = await getSaleByIdFormatted(id);
    if (!sale) return res.status(404).json({ error: "Not found" });

    return res.json({ ok: true, sale });
  } catch (e) {
    console.error("getSale error:", e);
    return res.status(500).json({ error: "Failed to get sale" });
  }
}

async function getSaleByIdFormatted(id) {
  const q = await db.query(
    `
    SELECT id, sold_at, menu_item_id, qty, unit_price, channel, notes, cogs_unit, cogs_total, cogs_snapshot_id, created_at, updated_at
    FROM donas_sales
    WHERE id=$1
    LIMIT 1
    `,
    [id]
  );
  return q.rows?.[0] || null;
}
/**
 * =========================
 * Handlers
 * =========================
 */

async function getSales(req, res) {
  try {
    await ensureSalesTable();

    const month = String(req.query.month || "").trim();
    if (!isYm(month)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    const rows = await getSalesRowsForMonth(month);
    return res.json({ ok: true, month, sales: rows });
  } catch (e) {
    console.error("getSales error:", e);
    return res.status(500).json({ error: "Failed to get sales" });
  }
}

async function addSale(req, res) {
  const client = await db.connect();
  try {
    await ensureSalesTable();

    const b = req.body || {};
    const soldAt = normalizeSoldAt(b.sold_at);
    const menuItemId = Number(b.menu_item_id);
    const qty = toNum(b.qty);
    let unitPrice = toNum(b.unit_price);
    const channel = String(b.channel || "").trim();
    const notes = String(b.notes || "").trim();

    if (!soldAt) return res.status(400).json({ error: "Bad sold_at (YYYY-MM-DD)" });
    if (!Number.isFinite(menuItemId) || menuItemId <= 0) return res.status(400).json({ error: "Bad menu_item_id" });
    if (!(qty > 0)) return res.status(400).json({ error: "Bad qty" });

    if (!(unitPrice >= 0)) unitPrice = 0;

    const ym = monthFromDateLike(soldAt);

    await client.query("BEGIN");

    // compute live cogs per 1 unit
    const snap = await getLatestCogsForMenuItem(menuItemId);
    const cogsUnit = toNum(snap?.total_cost);
    const cogsTotal = qty * cogsUnit;
    const cogsSnapshotId = snap?.id || null;

    const ins = await client.query(
      `
      INSERT INTO donas_sales
        (sold_at, menu_item_id, qty, unit_price, channel, notes, cogs_snapshot_id, cogs_unit, cogs_total)
      VALUES
        ($1::date,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id
      `,
      [soldAt, menuItemId, qty, unitPrice, channel, notes, cogsSnapshotId, cogsUnit, cogsTotal]
    );

    const saleId = ins.rows?.[0]?.id;

    // ✅ auto-consume inventory (ledger OUT) inside same transaction
    const consume = await autoConsumeInventoryForSale(client, {
      saleId,
      soldAt,
      menuItemId,
      qty,
    });

    if (!consume?.ok) {
      await client.query("ROLLBACK");
      return res.status(consume?.status || 400).json({
        error: consume?.error || "Inventory consume failed",
        details: consume?.details || null,
      });
    }

    await client.query("COMMIT");

    const afterRow = await getSaleByIdFormatted(saleId);
    await auditSales(req, ym, "sales.add", {}, { sale: afterRow, inventory: consume });

    // recompute finance months
    await touchMonthsFromYms([ym]);
    await autoSyncMonthsForDate(req, soldAt, "sales.add");

    return res.json({ ok: true, sale: afterRow, inventory: consume });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("addSale error:", e);
    return res.status(500).json({ error: "Failed to add sale" });
  } finally {
    client.release();
  }
}

async function updateSale(req, res) {
  try {
    await ensureSalesTable();

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Bad id" });

    const before = await getSaleByIdFormatted(id);
    if (!before) return res.status(404).json({ error: "Sale not found" });

    const b = req.body || {};

    const soldAt = b.sold_at != null ? normalizeSoldAt(b.sold_at) : null;
    const menuItemId = b.menu_item_id != null ? Number(b.menu_item_id) : null;
    const qty = b.qty != null ? toNum(b.qty) : null;
    const unitPrice = b.unit_price != null ? toNum(b.unit_price) : null;
    const channel = b.channel != null ? String(b.channel || "").trim() : null;
    const notes = b.notes != null ? String(b.notes || "").trim() : null;

    if (soldAt != null && !soldAt) return res.status(400).json({ error: "Bad sold_at" });
    if (menuItemId != null && (!Number.isFinite(menuItemId) || menuItemId <= 0))
      return res.status(400).json({ error: "Bad menu_item_id" });
    if (qty != null && !(qty > 0)) return res.status(400).json({ error: "Bad qty" });
    if (unitPrice != null && !(unitPrice >= 0)) return res.status(400).json({ error: "Bad unit_price" });

    const nextSoldAt = soldAt || String(before.sold_at).slice(0, 10);
    const nextMenuItemId = menuItemId || Number(before.menu_item_id);
    const nextQty = qty != null ? qty : toNum(before.qty);
    const nextUnitPrice = unitPrice != null ? unitPrice : toNum(before.unit_price);

    // recompute cogs for updated sale
    const snap = await getLatestCogsForMenuItem(nextMenuItemId);
    const cogsUnit = toNum(snap?.total_cost);
    const cogsTotal = nextQty * cogsUnit;
    const cogsSnapshotId = snap?.id || null;

    await db.query(
      `
      UPDATE donas_sales
      SET sold_at=COALESCE($1::date, sold_at),
          menu_item_id=COALESCE($2, menu_item_id),
          qty=COALESCE($3, qty),
          unit_price=COALESCE($4, unit_price),
          channel=COALESCE($5, channel),
          notes=COALESCE($6, notes),
          cogs_snapshot_id=$7,
          cogs_unit=$8,
          cogs_total=$9,
          updated_at=NOW()
      WHERE id=$10
      `,
      [soldAt, menuItemId, qty, unitPrice, channel, notes, cogsSnapshotId, cogsUnit, cogsTotal, id]
    );

    const after = await getSaleByIdFormatted(id);

    const beforeYm = monthFromDateLike(String(before.sold_at).slice(0, 10));
    const afterYm = monthFromDateLike(String(after.sold_at).slice(0, 10));

    await auditSales(req, afterYm || beforeYm, "sales.update", { sale: before }, { sale: after });

    await touchMonthsFromYms([beforeYm, afterYm].filter(Boolean));
    await autoSyncMonthsForDate(req, `${afterYm || beforeYm}-01`, "sales.update");

    return res.json({ ok: true, sale: after });
  } catch (e) {
    console.error("updateSale error:", e);
    return res.status(500).json({ error: "Failed to update sale" });
  }
}
async function deleteSale(req, res) {
  try {
    await ensureSalesTable();

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Bad id" });

    const before = await getSaleByIdFormatted(id);
    if (!before) return res.status(404).json({ error: "Sale not found" });

    const ym = monthFromDateLike(String(before.sold_at).slice(0, 10));

    await db.query(`DELETE FROM donas_sales WHERE id=$1`, [id]);

    await auditSales(req, ym, "sales.delete", { sale: before }, {});

    await touchMonthsFromYms([ym]);
    await autoSyncMonthsForDate(req, `${ym}-01`, "sales.delete");

    return res.json({ ok: true });
  } catch (e) {
    console.error("deleteSale error:", e);
    return res.status(500).json({ error: "Failed to delete sale" });
  }
}

async function recalcCogsMonth(req, res) {
  try {
    await ensureSalesTable();

    const month = String(req.params.month || "").trim();
    if (!isYm(month)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    const salesQ = await db.query(
      `
      SELECT id, sold_at, menu_item_id, qty, cogs_unit, cogs_total, cogs_snapshot_id
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
  getSale,
  addSale,
  updateSale,
  deleteSale,
  recalcCogsMonth,
};
