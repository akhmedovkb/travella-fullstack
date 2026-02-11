// backend/controllers/donasInventoryController.js
const db = require("../db");

const SLUG = "donas-dosas";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function s(x) {
  return String(x == null ? "" : x).trim();
}
function nonEmpty(x) {
  return s(x).length > 0;
}
function isISODate(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(d || "").trim());
}
function normUnit(u) {
  const v = s(u).toLowerCase();
  return v || "pcs";
}
function normFinanceType(t) {
  const v = s(t).toLowerCase();
  return v === "capex" ? "capex" : "opex";
}

/**
 * =========================
 * Ensure tables
 * =========================
 */

async function ensureInventoryTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS donas_inventory_items (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'pcs',
      min_qty NUMERIC NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (slug, name)
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_donas_inventory_items_slug
    ON donas_inventory_items (slug);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS donas_inventory_purchases (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL,
      purchased_at DATE NOT NULL,
      finance_type TEXT NOT NULL DEFAULT 'opex', -- opex/capex (для donas_purchases)
      vendor TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_donas_inventory_purchases_slug_date
    ON donas_inventory_purchases (slug, purchased_at);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS donas_inventory_purchase_items (
      id BIGSERIAL PRIMARY KEY,
      purchase_id BIGINT NOT NULL REFERENCES donas_inventory_purchases(id) ON DELETE CASCADE,
      item_id BIGINT NOT NULL REFERENCES donas_inventory_items(id),
      qty NUMERIC NOT NULL DEFAULT 0,
      unit_price NUMERIC NOT NULL DEFAULT 0,
      total NUMERIC GENERATED ALWAYS AS (qty * unit_price) STORED
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_donas_inventory_purchase_items_purchase
    ON donas_inventory_purchase_items (purchase_id);
  `);

  // Ledger (движение склада): приход/расход
  await db.query(`
    CREATE TABLE IF NOT EXISTS donas_inventory_ledger (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL,
      item_id BIGINT NOT NULL REFERENCES donas_inventory_items(id),
      move_date DATE NOT NULL,
      qty_in NUMERIC NOT NULL DEFAULT 0,
      qty_out NUMERIC NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT '',        -- "purchase" / "consume" / "adjust"
      ref_type TEXT NOT NULL DEFAULT '',      -- "purchase"
      ref_id BIGINT,                          -- id закупки
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_donas_inventory_ledger_slug_item
    ON donas_inventory_ledger (slug, item_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_donas_inventory_ledger_slug_date
    ON donas_inventory_ledger (slug, move_date);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_donas_inventory_ledger_slug_created_at
    ON donas_inventory_ledger (slug, created_at);
  `);

  // Таблица Finance purchases (если вдруг ещё нет)
  await db.query(`
    CREATE TABLE IF NOT EXISTS donas_purchases (
      id BIGSERIAL PRIMARY KEY,
      date DATE NOT NULL,
      ingredient TEXT NOT NULL,
      qty NUMERIC NOT NULL DEFAULT 0,
      price NUMERIC NOT NULL DEFAULT 0,
      total NUMERIC GENERATED ALWAYS AS (qty * price) STORED,
      type TEXT NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_donas_purchases_date ON donas_purchases (date);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_donas_purchases_type ON donas_purchases (type);`);
}

/**
 * =========================
 * Items CRUD
 * =========================
 */

async function listItems(req, res) {
  try {
    await ensureInventoryTables();

    const q = await db.query(
      `
      SELECT id, name, unit, min_qty, is_active, created_at, updated_at
      FROM donas_inventory_items
      WHERE slug=$1
      ORDER BY is_active DESC, name ASC
      `,
      [SLUG]
    );

    return res.json({ items: q.rows || [] });
  } catch (e) {
    console.error("listItems error:", e);
    return res.status(500).json({ error: "Failed to list items" });
  }
}

async function createItem(req, res) {
  try {
    await ensureInventoryTables();

    const b = req.body || {};
    const name = s(b.name);
    if (!nonEmpty(name)) return res.status(400).json({ error: "name is required" });

    const unit = normUnit(b.unit);
    const min_qty = toNum(b.min_qty);
    const is_active = b.is_active == null ? true : !!b.is_active;

    const ins = await db.query(
      `
      INSERT INTO donas_inventory_items (slug, name, unit, min_qty, is_active)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (slug, name)
      DO UPDATE SET
        unit=EXCLUDED.unit,
        min_qty=EXCLUDED.min_qty,
        is_active=EXCLUDED.is_active,
        updated_at=NOW()
      RETURNING id, name, unit, min_qty, is_active, created_at, updated_at
      `,
      [SLUG, name, unit, min_qty, is_active]
    );

    return res.json({ ok: true, item: ins.rows?.[0] });
  } catch (e) {
    console.error("createItem error:", e);
    return res.status(500).json({ error: "Failed to create item" });
  }
}

async function updateItem(req, res) {
  try {
    await ensureInventoryTables();

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Bad id" });

    const b = req.body || {};

    const fields = [];
    const vals = [];
    let i = 1;

    function add(sql, v) {
      fields.push(`${sql}=$${i++}`);
      vals.push(v);
    }

    if (b.name != null) {
      const name = s(b.name);
      if (!nonEmpty(name)) return res.status(400).json({ error: "name cannot be empty" });
      add("name", name);
    }
    if (b.unit != null) add("unit", normUnit(b.unit));
    if (b.min_qty != null) add("min_qty", toNum(b.min_qty));
    if (b.is_active != null) add("is_active", !!b.is_active);

    if (!fields.length) return res.json({ ok: true, skipped: true });

    vals.push(SLUG);
    vals.push(id);

    const q = await db.query(
      `
      UPDATE donas_inventory_items
      SET ${fields.join(", ")}, updated_at=NOW()
      WHERE slug=$${i++} AND id=$${i++}
      RETURNING id, name, unit, min_qty, is_active, created_at, updated_at
      `,
      vals
    );

    if (!q.rows?.length) return res.status(404).json({ error: "Item not found" });
    return res.json({ ok: true, item: q.rows[0] });
  } catch (e) {
    console.error("updateItem error:", e);
    return res.status(500).json({ error: "Failed to update item" });
  }
}

async function deleteItem(req, res) {
  try {
    await ensureInventoryTables();

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Bad id" });

    // мягкое удаление: делаем is_active=false (без удаления истории)
    const q = await db.query(
      `
      UPDATE donas_inventory_items
      SET is_active=FALSE, updated_at=NOW()
      WHERE slug=$1 AND id=$2
      RETURNING id
      `,
      [SLUG, id]
    );

    if (!q.rows?.length) return res.status(404).json({ error: "Item not found" });
    return res.json({ ok: true });
  } catch (e) {
    console.error("deleteItem error:", e);
    return res.status(500).json({ error: "Failed to delete item" });
  }
}

/**
 * =========================
 * Stock (остатки)
 * =========================
 */

async function getStock(req, res) {
  try {
    await ensureInventoryTables();

    const q = await db.query(
      `
      SELECT
        i.id,
        i.name,
        i.unit,
        i.min_qty,
        i.is_active,
        COALESCE(SUM(l.qty_in - l.qty_out), 0) AS on_hand
      FROM donas_inventory_items i
      LEFT JOIN donas_inventory_ledger l
        ON l.slug=i.slug AND l.item_id=i.id
      WHERE i.slug=$1
      GROUP BY i.id
      ORDER BY i.is_active DESC, i.name ASC
      `,
      [SLUG]
    );

    return res.json({ stock: q.rows || [] });
  } catch (e) {
    console.error("getStock error:", e);
    return res.status(500).json({ error: "Failed to get stock" });
  }
}

async function getLowStock(req, res) {
  try {
    await ensureInventoryTables();

    const q = await db.query(
      `
      SELECT
        i.id,
        i.name,
        i.unit,
        i.min_qty,
        COALESCE(SUM(l.qty_in - l.qty_out), 0) AS on_hand
      FROM donas_inventory_items i
      LEFT JOIN donas_inventory_ledger l
        ON l.slug=i.slug AND l.item_id=i.id
      WHERE i.slug=$1 AND i.is_active=TRUE
      GROUP BY i.id
      HAVING COALESCE(SUM(l.qty_in - l.qty_out), 0) <= i.min_qty
      ORDER BY (COALESCE(SUM(l.qty_in - l.qty_out), 0) - i.min_qty) ASC, i.name ASC
      `,
      [SLUG]
    );

    return res.json({ low: q.rows || [] });
  } catch (e) {
    console.error("getLowStock error:", e);
    return res.status(500).json({ error: "Failed to get low stock" });
  }
}

/**
 * =========================
 * Ledger (движения склада)
 * GET /ledger?limit=&offset=&item_id=
 * Возвращаем формат ПОД ФРОНТ:
 * [
 *   { id, created_at, item_id, item_name, direction:"in|out", qty, reason, notes, purchase_id }
 * ]
 * purchase_id = ref_id, если ref_type === 'purchase'
 * =========================
 */

async function listLedger(req, res) {
  try {
    await ensureInventoryTables();

    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const offset = Math.max(0, Number(req.query.offset || 0));

    const itemIdRaw = s(req.query.item_id);
    const item_id = itemIdRaw ? Number(itemIdRaw) : null;
    const hasItem = item_id != null && Number.isFinite(item_id) && item_id > 0;

    const q = await db.query(
      `
      SELECT
        l.id,
        l.created_at,
        l.move_date,
        l.item_id,
        i.name AS item_name,
        l.qty_in,
        l.qty_out,
        l.reason,
        l.notes,
        l.ref_type,
        l.ref_id
      FROM donas_inventory_ledger l
      LEFT JOIN donas_inventory_items i ON i.id=l.item_id
      WHERE l.slug=$1
        AND ($2::bigint IS NULL OR l.item_id=$2::bigint)
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT $3 OFFSET $4
      `,
      [SLUG, hasItem ? item_id : null, limit, offset]
    );

    const rows = (q.rows || []).map((r) => {
      const qtyIn = toNum(r.qty_in);
      const qtyOut = toNum(r.qty_out);
      const direction = qtyIn > 0 ? "in" : "out";
      const qty = qtyIn > 0 ? qtyIn : qtyOut;

      return {
        id: r.id,
        created_at: r.created_at,
        move_date: r.move_date,
        item_id: r.item_id,
        item_name: r.item_name,
        direction,
        qty,
        reason: r.reason || "",
        notes: r.notes || "",
        purchase_id: String(r.ref_type || "").toLowerCase() === "purchase" ? r.ref_id : null,
      };
    });

    return res.json({ ok: true, ledger: rows, limit, offset });
  } catch (e) {
    console.error("listLedger error:", e);
    return res.status(500).json({ error: "Failed to list ledger" });
  }
}

/**
 * =========================
 * Purchases (закупки) + интеграция с Finance
 * =========================
 */

async function createPurchase(req, res) {
  const client = await db.connect();
  try {
    await ensureInventoryTables();

    const b = req.body || {};
    const purchased_at = s(b.purchased_at);
    if (!isISODate(purchased_at)) {
      return res.status(400).json({ error: "purchased_at must be YYYY-MM-DD" });
    }

    const finance_type = normFinanceType(b.finance_type);
    const vendor = s(b.vendor);
    const notes = s(b.notes);

    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length) return res.status(400).json({ error: "items[] is required" });

    const normalized = [];
    for (const it of items) {
      const item_id = Number(it?.item_id);
      const qty = toNum(it?.qty);
      const unit_price = toNum(it?.unit_price);
      if (!Number.isFinite(item_id) || item_id <= 0) return res.status(400).json({ error: "Bad item_id" });
      if (!(qty > 0)) return res.status(400).json({ error: "qty must be > 0" });
      if (unit_price < 0) return res.status(400).json({ error: "unit_price must be >= 0" });
      normalized.push({ item_id, qty, unit_price });
    }

    await client.query("BEGIN");

    const pIns = await client.query(
      `
      INSERT INTO donas_inventory_purchases (slug, purchased_at, finance_type, vendor, notes)
      VALUES ($1,$2::date,$3,$4,$5)
      RETURNING id, slug, purchased_at, finance_type, vendor, notes, created_at, updated_at
      `,
      [SLUG, purchased_at, finance_type, vendor, notes]
    );

    const purchase = pIns.rows[0];

    const ids = normalized.map((x) => x.item_id);
    const itemsQ = await client.query(
      `
      SELECT id, name
      FROM donas_inventory_items
      WHERE slug=$1 AND id = ANY($2::bigint[])
      `,
      [SLUG, ids]
    );

    const nameById = new Map();
    for (const r of itemsQ.rows || []) nameById.set(Number(r.id), String(r.name));

    if (nameById.size !== ids.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "One or more items not found" });
    }

    for (const line of normalized) {
      await client.query(
        `
        INSERT INTO donas_inventory_purchase_items (purchase_id, item_id, qty, unit_price)
        VALUES ($1,$2,$3,$4)
        `,
        [purchase.id, line.item_id, line.qty, line.unit_price]
      );

      // ledger IN (ref_type/ref_id уже = purchase)
      await client.query(
        `
        INSERT INTO donas_inventory_ledger
          (slug, item_id, move_date, qty_in, qty_out, reason, ref_type, ref_id, notes)
        VALUES
          ($1,$2,$3::date,$4,0,'purchase','purchase',$5,$6)
        `,
        [SLUG, line.item_id, purchased_at, line.qty, purchase.id, notes]
      );

      // finance row
      const ingredientName = nameById.get(line.item_id);
      await client.query(
        `
        INSERT INTO donas_purchases (date, ingredient, qty, price, type, notes)
        VALUES ($1::date, $2, $3, $4, $5, $6)
        `,
        [
          purchased_at,
          ingredientName,
          line.qty,
          line.unit_price,
          finance_type,
          `[inventory#${purchase.id}] ${vendor || ""} ${notes || ""}`.trim(),
        ]
      );
    }

    await client.query("COMMIT");
    return res.json({ ok: true, purchase });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("createPurchase error:", e);
    return res.status(500).json({ error: "Failed to create purchase" });
  } finally {
    client.release();
  }
}

async function listPurchases(req, res) {
  try {
    await ensureInventoryTables();

    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const offset = Math.max(0, Number(req.query.offset || 0));

    const q = await db.query(
      `
      SELECT
        p.id, p.purchased_at, p.finance_type, p.vendor, p.notes, p.created_at,
        COALESCE(SUM(pi.total),0) AS total_sum,
        COUNT(pi.id) AS lines
      FROM donas_inventory_purchases p
      LEFT JOIN donas_inventory_purchase_items pi ON pi.purchase_id=p.id
      WHERE p.slug=$1
      GROUP BY p.id
      ORDER BY p.purchased_at DESC, p.id DESC
      LIMIT $2 OFFSET $3
      `,
      [SLUG, limit, offset]
    );

    return res.json({ purchases: q.rows || [], limit, offset });
  } catch (e) {
    console.error("listPurchases error:", e);
    return res.status(500).json({ error: "Failed to list purchases" });
  }
}

async function getPurchase(req, res) {
  try {
    await ensureInventoryTables();

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Bad id" });

    const pQ = await db.query(
      `
      SELECT id, purchased_at, finance_type, vendor, notes, created_at, updated_at
      FROM donas_inventory_purchases
      WHERE slug=$1 AND id=$2
      LIMIT 1
      `,
      [SLUG, id]
    );

    if (!pQ.rows?.length) return res.status(404).json({ error: "Not found" });

    const linesQ = await db.query(
      `
      SELECT
        pi.id,
        pi.item_id,
        i.name,
        i.unit,
        pi.qty,
        pi.unit_price,
        pi.total
      FROM donas_inventory_purchase_items pi
      JOIN donas_inventory_items i ON i.id=pi.item_id
      WHERE pi.purchase_id=$1
      ORDER BY pi.id ASC
      `,
      [id]
    );

    return res.json({ purchase: pQ.rows[0], items: linesQ.rows || [] });
  } catch (e) {
    console.error("getPurchase error:", e);
    return res.status(500).json({ error: "Failed to get purchase" });
  }
}

/**
 * =========================
 * Consume (расход со склада)
 * =========================
 */

async function consumeStock(req, res) {
  const client = await db.connect();
  try {
    await ensureInventoryTables();

    const b = req.body || {};
    const move_date = s(b.date);
    if (!isISODate(move_date)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });

    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length) return res.status(400).json({ error: "items[] is required" });

    const reason = s(b.reason) || "consume";
    const notes = s(b.notes);

    const normalized = [];
    for (const it of items) {
      const item_id = Number(it?.item_id);
      const qty = toNum(it?.qty);
      if (!Number.isFinite(item_id) || item_id <= 0) return res.status(400).json({ error: "Bad item_id" });
      if (!(qty > 0)) return res.status(400).json({ error: "qty must be > 0" });
      normalized.push({ item_id, qty });
    }

    await client.query("BEGIN");

    for (const line of normalized) {
      const st = await client.query(
        `
        SELECT COALESCE(SUM(qty_in - qty_out),0) AS on_hand
        FROM donas_inventory_ledger
        WHERE slug=$1 AND item_id=$2
        `,
        [SLUG, line.item_id]
      );
      const onHand = toNum(st.rows?.[0]?.on_hand);
      if (onHand < line.qty) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: `Not enough stock for item_id=${line.item_id}`, onHand });
      }

      await client.query(
        `
        INSERT INTO donas_inventory_ledger
          (slug, item_id, move_date, qty_in, qty_out, reason, ref_type, ref_id, notes)
        VALUES
          ($1,$2,$3::date,0,$4,$5,'',NULL,$6)
        `,
        [SLUG, line.item_id, move_date, line.qty, reason, notes]
      );
    }

    await client.query("COMMIT");
    return res.json({ ok: true });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("consumeStock error:", e);
    return res.status(500).json({ error: "Failed to consume stock" });
  } finally {
    client.release();
  }
}

module.exports = {
  // items
  listItems,
  createItem,
  updateItem,
  deleteItem,

  // stock
  getStock,
  getLowStock,

  // ledger
  listLedger,

  // purchases
  createPurchase,
  listPurchases,
  getPurchase,

  // consume
  consumeStock,

  // internal
  _internal: { ensureInventoryTables },
};
