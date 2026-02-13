// backend/controllers/donasSalesController.js
const db = require("../db");

const SLUG = "donas-dosas";

/* =========================
 * small utils
 * ========================= */
function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function s(x) {
  return String(x == null ? "" : x).trim();
}
function isISODate(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(d || "").trim());
}
function isHHMM(t) {
  const v = s(t);
  return !v || /^\d{2}:\d{2}$/.test(v);
}

/* =========================
 * Ensure tables
 * ========================= */
async function ensureSalesTables() {
  // sales header
  await db.query(`
    CREATE TABLE IF NOT EXISTS donas_sales (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL,
      sale_date DATE NOT NULL,
      time_hhmm TEXT,                       -- "HH:MM" optional
      channel TEXT NOT NULL DEFAULT 'unknown',
      payment_method TEXT NOT NULL DEFAULT 'unknown',
      total_sum NUMERIC NOT NULL DEFAULT 0,
      discount_sum NUMERIC NOT NULL DEFAULT 0,
      cash_in NUMERIC NOT NULL DEFAULT 0,
      comment TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_donas_sales_slug_date
    ON donas_sales (slug, sale_date);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_donas_sales_slug_id
    ON donas_sales (slug, id);
  `);

  // optional lines (if you later want itemized sales)
  await db.query(`
    CREATE TABLE IF NOT EXISTS donas_sale_items (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL,
      sale_id BIGINT NOT NULL REFERENCES donas_sales(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      qty NUMERIC NOT NULL DEFAULT 1,
      price NUMERIC NOT NULL DEFAULT 0,
      total NUMERIC GENERATED ALWAYS AS (qty * price) STORED
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_donas_sale_items_sale
    ON donas_sale_items (sale_id);
  `);
}

/* =========================
 * List sales
 * GET /api/admin/donas/sales?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=50&offset=0
 * ========================= */
async function listSales(req, res) {
  try {
    await ensureSalesTables();

    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const offset = Math.max(0, Number(req.query.offset || 0));

    const from = s(req.query.from);
    const to = s(req.query.to);

    const where = ["slug=$1"];
    const vals = [SLUG];
    let i = 2;

    if (from) {
      if (!isISODate(from)) return res.status(400).json({ error: "from must be YYYY-MM-DD" });
      where.push(`sale_date >= $${i++}::date`);
      vals.push(from);
    }
    if (to) {
      if (!isISODate(to)) return res.status(400).json({ error: "to must be YYYY-MM-DD" });
      where.push(`sale_date <= $${i++}::date`);
      vals.push(to);
    }

    vals.push(limit);
    vals.push(offset);

    const q = await db.query(
      `
      SELECT
        id,
        sale_date,
        time_hhmm,
        channel,
        payment_method,
        total_sum,
        discount_sum,
        cash_in,
        comment,
        created_at,
        updated_at
      FROM donas_sales
      WHERE ${where.join(" AND ")}
      ORDER BY sale_date DESC, id DESC
      LIMIT $${i++} OFFSET $${i++}
      `,
      vals
    );

    return res.json({ sales: q.rows || [], limit, offset });
  } catch (e) {
    console.error("listSales error:", e);
    return res.status(500).json({ error: "Failed to list sales" });
  }
}

/* =========================
 * Get sale
 * GET /api/admin/donas/sales/:id
 * ========================= */
async function getSale(req, res) {
  try {
    await ensureSalesTables();

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Bad id" });

    const q = await db.query(
      `
      SELECT
        id,
        sale_date,
        time_hhmm,
        channel,
        payment_method,
        total_sum,
        discount_sum,
        cash_in,
        comment,
        created_at,
        updated_at
      FROM donas_sales
      WHERE slug=$1 AND id=$2
      LIMIT 1
      `,
      [SLUG, id]
    );

    if (!q.rows?.length) return res.status(404).json({ error: "Sale not found" });

    // include lines if any
    const linesQ = await db.query(
      `
      SELECT id, name, qty, price, total
      FROM donas_sale_items
      WHERE slug=$1 AND sale_id=$2
      ORDER BY id ASC
      `,
      [SLUG, id]
    );

    return res.json({ sale: q.rows[0], items: linesQ.rows || [] });
  } catch (e) {
    console.error("getSale error:", e);
    return res.status(500).json({ error: "Failed to get sale" });
  }
}

/* =========================
 * Create sale
 * POST /api/admin/donas/sales
 * body:
 * {
 *   sale_date: "YYYY-MM-DD",
 *   time_hhmm?: "HH:MM",
 *   channel?: "",
 *   payment_method?: "",
 *   total_sum?: number,
 *   discount_sum?: number,
 *   cash_in?: number,
 *   comment?: "",
 *   items?: [{ name, qty, price }]
 * }
 * ========================= */
async function createSale(req, res) {
  const client = await db.connect();
  try {
    await ensureSalesTables();

    const b = req.body || {};
    const sale_date = String(b.sale_date || "").slice(0, 10);
    if (!isISODate(sale_date)) return res.status(400).json({ error: "sale_date must be YYYY-MM-DD" });

    const time_hhmm = s(b.time_hhmm);
    if (!isHHMM(time_hhmm)) return res.status(400).json({ error: "time_hhmm must be HH:MM" });

    const channel = s(b.channel) || "unknown";
    const payment_method = s(b.payment_method) || "unknown";

    const total_sum = toNum(b.total_sum);
    const discount_sum = toNum(b.discount_sum);
    const cash_in = toNum(b.cash_in);
    const comment = s(b.comment);

    const items = Array.isArray(b.items) ? b.items : [];

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

    const sale = ins.rows[0];

    // optional lines
    for (const it of items) {
      const nm = s(it?.name);
      const qty = toNum(it?.qty);
      const price = toNum(it?.price);
      if (!nm) continue;
      await client.query(
        `
        INSERT INTO donas_sale_items (slug, sale_id, name, qty, price)
        VALUES ($1,$2,$3,$4,$5)
        `,
        [SLUG, sale.id, nm, qty || 1, price]
      );
    }

    await client.query("COMMIT");
    return res.json({ ok: true, sale });
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

/* =========================
 * Update sale
 * PUT /api/admin/donas/sales/:id
 * body can contain any fields from createSale
 * ========================= */
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

    function add(col, v) {
      fields.push(`${col}=$${i++}`);
      vals.push(v);
    }

    if (b.sale_date != null) {
      const sale_date = String(b.sale_date || "").slice(0, 10);
      if (!isISODate(sale_date)) return res.status(400).json({ error: "sale_date must be YYYY-MM-DD" });
      add("sale_date", sale_date);
    }

    if (b.time_hhmm != null) {
      const time_hhmm = s(b.time_hhmm);
      if (!isHHMM(time_hhmm)) return res.status(400).json({ error: "time_hhmm must be HH:MM" });
      add("time_hhmm", time_hhmm || null);
    }

    if (b.channel != null) add("channel", s(b.channel) || "unknown");
    if (b.payment_method != null) add("payment_method", s(b.payment_method) || "unknown");
    if (b.total_sum != null) add("total_sum", toNum(b.total_sum));
    if (b.discount_sum != null) add("discount_sum", toNum(b.discount_sum));
    if (b.cash_in != null) add("cash_in", toNum(b.cash_in));
    if (b.comment != null) add("comment", s(b.comment));

    await client.query("BEGIN");

    let saleRow = null;

    if (fields.length) {
      vals.push(SLUG);
      vals.push(id);

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
      saleRow = q.rows[0];
    } else {
      // just fetch current
      const q = await client.query(
        `
        SELECT
          id, slug, sale_date, time_hhmm, channel, payment_method, total_sum, discount_sum, cash_in, comment, created_at, updated_at
        FROM donas_sales
        WHERE slug=$1 AND id=$2
        LIMIT 1
        `,
        [SLUG, id]
      );
      if (!q.rows?.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Sale not found" });
      }
      saleRow = q.rows[0];
    }

    // if items provided -> replace lines
    if (Array.isArray(b.items)) {
      await client.query(`DELETE FROM donas_sale_items WHERE slug=$1 AND sale_id=$2`, [SLUG, id]);

      for (const it of b.items) {
        const nm = s(it?.name);
        const qty = toNum(it?.qty);
        const price = toNum(it?.price);
        if (!nm) continue;
        await client.query(
          `
          INSERT INTO donas_sale_items (slug, sale_id, name, qty, price)
          VALUES ($1,$2,$3,$4,$5)
          `,
          [SLUG, id, nm, qty || 1, price]
        );
      }
    }

    await client.query("COMMIT");
    return res.json({ ok: true, sale: saleRow });
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

/* =========================
 * Delete sale
 * DELETE /api/admin/donas/sales/:id
 * ========================= */
async function deleteSale(req, res) {
  const client = await db.connect();
  try {
    await ensureSalesTables();

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Bad id" });

    await client.query("BEGIN");

    // delete lines (safe even if none)
    await client.query(`DELETE FROM donas_sale_items WHERE slug=$1 AND sale_id=$2`, [SLUG, id]);

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
