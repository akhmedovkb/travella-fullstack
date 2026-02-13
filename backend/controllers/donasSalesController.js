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
