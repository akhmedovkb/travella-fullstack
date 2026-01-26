//backend/routes/adminDonasFinanceRoutes.js

const express = require("express");
const pool = require("../db");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const router = express.Router();

const SLUG = "donas-dosas";

/** GET settings (создаёт дефолт при первом заходе) */
router.get("/donas/finance/settings", authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const q = await pool.query(
      "select * from donas_finance_settings where slug=$1 limit 1",
      [SLUG]
    );

    if (!q.rows[0]) {
      const ins = await pool.query(
        "insert into donas_finance_settings(slug) values($1) returning *",
        [SLUG]
      );
      return res.json(ins.rows[0]);
    }

    return res.json(q.rows[0]);
  } catch (e) {
    console.error("GET /donas/finance/settings error:", e);
    return res.status(500).json({ error: "Failed to load settings" });
  }
});

/** PUT settings */
router.put("/donas/finance/settings", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const s = req.body || {};

    const fields = [
      "currency",
      "avg_check",
      "cogs_per_unit",
      "units_per_day",
      "days_per_month",
      "fixed_opex_month",
      "variable_opex_month",
      "loan_payment_month",
      "cash_start",
      "reserve_target_months",
    ];

    const sets = [];
    const vals = [];
    let i = 1;

    for (const f of fields) {
      if (s[f] == null) continue;
      sets.push(`${f}=$${i++}`);
      vals.push(s[f]);
    }

    // where slug = $i
    vals.push(SLUG);

    const sql = `
      update donas_finance_settings
      set ${sets.length ? sets.join(", ") + ", " : ""} updated_at=now()
      where slug=$${i}
      returning *
    `;

    const q = await pool.query(sql, vals);
    return res.json(q.rows[0]);
  } catch (e) {
    console.error("PUT /donas/finance/settings error:", e);
    return res.status(500).json({ error: "Failed to save settings" });
  }
});

/** GET months list */
router.get("/donas/finance/months", authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const q = await pool.query(
      "select * from donas_finance_months where slug=$1 order by month asc",
      [SLUG]
    );
    return res.json(q.rows);
  } catch (e) {
    console.error("GET /donas/finance/months error:", e);
    return res.status(500).json({ error: "Failed to load months" });
  }
});

/** PUT month upsert */
router.put("/donas/finance/months/:month", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const month = req.params.month; // YYYY-MM-01
    const b = req.body || {};

    const q = await pool.query(
      `
      insert into donas_finance_months(
        slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes
      )
      values($1,$2,$3,$4,$5,$6,$7,$8,$9)
      on conflict (slug, month) do update set
        revenue=excluded.revenue,
        cogs=excluded.cogs,
        opex=excluded.opex,
        capex=excluded.capex,
        loan_paid=excluded.loan_paid,
        cash_end=excluded.cash_end,
        notes=excluded.notes,
        updated_at=now()
      returning *
      `,
      [
        SLUG,
        month,
        Number(b.revenue || 0),
        Number(b.cogs || 0),
        Number(b.opex || 0),
        Number(b.capex || 0),
        Number(b.loan_paid || 0),
        Number(b.cash_end || 0),
        b.notes || null,
      ]
    );

    return res.json(q.rows[0]);
  } catch (e) {
    console.error("PUT /donas/finance/months/:month error:", e);
    return res.status(500).json({ error: "Failed to save month" });
  }
});

module.exports = router;
