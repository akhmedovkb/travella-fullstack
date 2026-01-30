// backend/controllers/donasPurchasesController.js

const pool = require("../db");

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function slugOrDefault(v) {
  const s = String(v || "").trim();
  return s || "donas-dosas";
}

/**
 * GET /api/admin/donas/purchases
 * Query:
 *  - slug (optional)
 *  - type (optional)   e.g. "capex" | "purchase"
 *  - month (optional)  "YYYY-MM" (filters by date range month)
 *  - limit (optional)  default 200
 */
exports.listPurchases = async (req, res) => {
  try {
    const slug = slugOrDefault(req.query.slug);
    const type = String(req.query.type || "").trim();
    const month = String(req.query.month || "").trim();
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));

    const where = ["slug = $1"];
    const params = [slug];
    let p = 2;

    if (type) {
      where.push(`type = $${p++}`);
      params.push(type);
    }

    // month filter: YYYY-MM
    if (/^\d{4}-\d{2}$/.test(month)) {
      const start = `${month}-01`;
      const end = `${month}-01`;
      where.push(`date >= $${p++}::date`);
      params.push(start);
      where.push(`date < ($${p++}::date + interval '1 month')`);
      params.push(end);
    }

    params.push(limit);

    const q = await pool.query(
      `
      select
        id,
        slug,
        type,
        date,
        total,
        created_at
      from donas_purchases
      where ${where.join(" and ")}
      order by date desc, id desc
      limit $${p}
      `,
      params
    );

    res.json({ items: q.rows || [] });
  } catch (e) {
    console.error("listPurchases error:", e);
    res.status(500).json({ error: "Failed to load purchases" });
  }
};

/**
 * POST /api/admin/donas/purchases
 * Body:
 *  - slug (optional)
 *  - type (required)  e.g. "capex" | "purchase"
 *  - date (required)  "YYYY-MM-DD"
 *  - total (required) number
 */
exports.addPurchase = async (req, res) => {
  try {
    const b = req.body || {};

    const slug = slugOrDefault(b.slug);
    const type = String(b.type || "").trim();
    const date = String(b.date || "").trim();
    const total = toNum(b.total);

    if (!type) return res.status(400).json({ error: "type is required" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return res.status(400).json({ error: "date must be YYYY-MM-DD" });

    const q = await pool.query(
      `
      insert into donas_purchases (slug, type, date, total)
      values ($1,$2,$3::date,$4)
      returning id, slug, type, date, total, created_at
      `,
      [slug, type, date, total]
    );

    res.json({ ok: true, item: q.rows[0] });
  } catch (e) {
    console.error("addPurchase error:", e);
    res.status(500).json({ error: "Failed to add purchase" });
  }
};

/**
 * DELETE /api/admin/donas/purchases/:id
 */
exports.deletePurchase = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Bad id" });
    }

    const q = await pool.query(
      `delete from donas_purchases where id = $1 returning id`,
      [id]
    );

    if (!q.rows.length) return res.status(404).json({ error: "Not found" });

    res.json({ ok: true });
  } catch (e) {
    console.error("deletePurchase error:", e);
    res.status(500).json({ error: "Failed to delete purchase" });
  }
};
