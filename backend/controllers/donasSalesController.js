// backend/controllers/donasSalesController.js
const db = require("../db");
const { autoSyncMonthsForDate } = require("../utils/donasFinanceAutoSync");

const SLUG = "donas-dosas";

// Inventory auto-consume
const inv = require("./donasInventoryController");

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
  return String(u || "").trim().toLowerCase() || "pcs";
}
function convertQty(qty, fromUnit, toUnit) {
  const q = toNum(qty);
  const f = normUnit(fromUnit);
  const t = normUnit(toUnit);
  if (!q) return 0;
  if (f === t) return q;

  // mass
  if (f === "g" && t === "kg") return q / 1000;
  if (f === "kg" && t === "g") return q * 1000;

  // volume
  if (f === "ml" && t === "l") return q / 1000;
  if (f === "l" && t === "ml") return q * 1000;

  // fallback: no conversion
  return q;
}

async function ensureInventoryItemForIngredient(client, ingredient) {
  // ingredient: {id, name, unit}
  const ins = await client.query(
    `
    INSERT INTO donas_inventory_items (slug, name, unit, min_qty, is_active, ingredient_id)
    VALUES ($1,$2,$3,0,TRUE,$4)
    ON CONFLICT (slug, ingredient_id)
    DO UPDATE SET
      name = EXCLUDED.name,
      unit = EXCLUDED.unit,
      updated_at = NOW()
    RETURNING id, unit
    `,
    [SLUG, String(ingredient.name), normUnit(ingredient.unit), Number(ingredient.id)]
  );
  return ins.rows?.[0] || null;
}

async function ensureInventoryConsumeForSale(client, sale) {
  // sale: { id, date, menu_item_id, qty, item_name }
  await inv._internal.ensureInventoryTables(client);
  await inv._internal.ensureInventoryItemsFromIngredients(client);

  // Load recipe/components
  const compQ = await client.query(
    `
    SELECT
      c.ingredient_id,
      c.qty AS comp_qty,
      c.unit AS comp_unit,
      i.name AS ingredient_name,
      i.unit AS ingredient_unit
    FROM donas_menu_item_components c
    JOIN donas_ingredients i ON i.id=c.ingredient_id
    WHERE c.menu_item_id=$1
      AND i.slug=$2
      AND COALESCE(i.is_archived, FALSE) = FALSE
    ORDER BY c.id ASC
    `,
    [sale.menu_item_id, SLUG]
  );

  const comps = compQ.rows || [];
  if (!comps.length) return; // no recipe, skip

  // For each component: compute needed qty in ingredient unit, ensure inventory item exists, check stock, write ledger OUT
  for (const c of comps) {
    const neededCompQty = toNum(c.comp_qty) * toNum(sale.qty);
    if (!(neededCompQty > 0)) continue;

    const need = convertQty(neededCompQty, c.comp_unit, c.ingredient_unit);
    if (!(need > 0)) continue;

    const invItem = await ensureInventoryItemForIngredient(client, {
      id: c.ingredient_id,
      name: c.ingredient_name,
      unit: c.ingredient_unit,
    });

    if (!invItem?.id) continue;

    // on_hand
    const st = await client.query(
      `
      SELECT COALESCE(SUM(qty_in - qty_out),0) AS on_hand
      FROM donas_inventory_ledger
      WHERE slug=$1 AND item_id=$2
      `,
      [SLUG, invItem.id]
    );
    const onHand = toNum(st.rows?.[0]?.on_hand);

    if (onHand < need) {
      const msg = `Not enough stock for ingredient “${c.ingredient_name}”: need ${need} ${normUnit(
        c.ingredient_unit
      )}, on_hand ${onHand}`;
      const err = new Error(msg);
      err.status = 409;
      err.payload = {
        error: msg,
        ingredient_id: c.ingredient_id,
        ingredient: c.ingredient_name,
        need,
        unit: normUnit(c.ingredient_unit),
        on_hand: onHand,
      };
      throw err;
    }

    await client.query(
      `
      INSERT INTO donas_inventory_ledger
        (slug, item_id, move_date, qty_in, qty_out, reason, ref_type, ref_id, notes)
      VALUES
        ($1,$2,$3::date,0,$4,'sale','sale',$5,$6)
      `,
      [
        SLUG,
        invItem.id,
        sale.date,
        need,
        sale.id,
        `[sale#

    return res.status(500).json({ error: "Failed to list sales" });
  }
}

async function getSale(req, res) {
  try {
    await ensureSalesTables();

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Bad id" });

    const q = await db.query(
      `
      SELECT
        s.id,
        s.sale_date,
        s.time_hhmm,
        s.channel,
        s.payment_method,
        s.total_sum,
        s.discount_sum,
        s.cash_in,
        s.comment,
        s.created_at,
        s.updated_at
      FROM donas_sales s
      WHERE s.slug=$1 AND s.id=$2
      LIMIT 1
      `,
      [SLUG, id]
    );

    if (!q.rows?.length) return res.status(404).json({ error: "Sale not found" });
    return res.json({ sale: q.rows[0] });
  } catch (e) {
    console.error("getSale error:", e);
    return res.status(500).json({ error: "Failed to get sale" });
  }
}

async function createSale(req, res) {
  const client = await db.connect();
  try {
    await ensureSalesTables();

    const b = req.body || {};
    const sale_date = String(b.sale_date || "").slice(0, 10);
    if (!isISODate(sale_date)) return res.status(400).json({ error: "sale_date must be YYYY-MM-DD" });

    const channel = s(b.channel) || "unknown";
    const payment_method = s(b.payment_method) || "unknown";

    const total_sum = toNum(b.total_sum);
    const discount_sum = toNum(b.discount_sum);
    const cash_in = toNum(b.cash_in);

    const time_hhmm = s(b.time_hhmm);
    if (time_hhmm && !/^\d{2}:\d{2}$/.test(time_hhmm)) return res.status(400).json({ error: "time_hhmm must be HH:MM" });

    const comment = s(b.comment);

    await client.query("BEGIN");

    const ins = await client.query(
      `
      INSERT INTO donas_sales
        (slug, sale_date, time_hhmm, channel, payment_method, total_sum, discount_sum, cash_in, comment)
      VALUES
        ($1,$2::date,$3,$4,$5,$6,$7,$8,$9)
      RETURNING
        id, slug, sale_date, time_hhmm, channel, payment_method, total_sum, discount_sum, cash_in, comment, created_at, updated_at
      `,
      [SLUG, sale_date, time_hhmm || null, channel, payment_method, total_sum, discount_sum, cash_in, comment]
    );

    await client.query("COMMIT");
    return res.json({ ok: true, sale: ins.rows[0] });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("createSale error:", e);
    return res.status(500).json({ error: "Failed to create sale" });
  } finally {
    client.release();
  }
}

async function updateSale(req, res) {
  const client = await db.connect();
  try {
    await ensureSalesTables();

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

    if (b.sale_date != null) {
      const sale_date = String(b.sale_date || "").slice(0, 10);
      if (!isISODate(sale_date)) return res.status(400).json({ error: "sale_date must be YYYY-MM-DD" });
      add("sale_date", sale_date);
    }

    if (b.time_hhmm != null) {
      const time_hhmm = s(b.time_hhmm);
      if (time_hhmm && !/^\d{2}:\d{2}$/.test(time_hhmm)) return res.status(400).json({ error: "time_hhmm must be HH:MM" });
      add("time_hhmm", time_hhmm || null);
    }

    if (b.channel != null) add("channel", s(b.channel) || "unknown");
    if (b.payment_method != null) add("payment_method", s(b.payment_method) || "unknown");
    if (b.total_sum != null) add("total_sum", toNum(b.total_sum));
    if (b.discount_sum != null) add("discount_sum", toNum(b.discount_sum));
    if (b.cash_in != null) add("cash_in", toNum(b.cash_in));
    if (b.comment != null) add("comment", s(b.comment));

    if (!fields.length) return res.json({ ok: true, skipped: true });

    vals.push(SLUG);
    vals.push(id);

    await client.query("BEGIN");

    const q = await client.query(
      `
      UPDATE donas_sales
      SET ${fields.join(", ")}, updated_at=NOW()
      WHERE slug=$${i++} AND id=$${i++}
      RETURNING
        id, slug, sale_date, time_hhmm, channel, payment_method, total_sum, discount_sum, cash_in, comment, created_at, updated_at
      `,
      vals
    );

    if (!q.rows?.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Sale not found" });
    }

    await client.query("COMMIT");
    return res.json({ ok: true, sale: q.rows[0] });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("updateSale error:", e);
    return res.status(500).json({ error: "Failed to update sale" });
  } finally {
    client.release();
  }
}

async function deleteSale(req, res) {
  const client = await db.connect();
  try {
    await ensureSalesTables();

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Bad id" });

    await client.query("BEGIN");

    // delete lines first (if table exists / used)
    try {
      await client.query(`DELETE FROM donas_sale_items WHERE slug=$1 AND sale_id=$2`, [SLUG, id]);
    } catch {}

    const q = await client.query(`DELETE FROM donas_sales WHERE slug=$1 AND id=$2 RETURNING id`, [SLUG, id]);
    if (!q.rows?.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Sale not found" });
    }

    await client.query("COMMIT");
    return res.json({ ok: true });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("deleteSale error:", e);
    return res.status(500).json({ error: "Failed to delete sale" });
  } finally {
    client.release();
  }
}

module.exports = {
  listSales,
  getSale,
  createSale,
  updateSale,
  deleteSale,

  _internal: { ensureSalesTables },
};
