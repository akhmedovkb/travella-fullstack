// backend/routes/adminDonasFinanceRoutes.js

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

/* =========================================================
   OPS: SHIFTS / PURCHASES / RECIPE NORMS / COGS CHECK / SUMMARY
   Все под admin + slug фиксированный (donas-dosas)
   ========================================================= */

/** POST shift */
router.post("/donas/ops/shifts", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const fixed = Number(b.fixed_pay || 0);
    const perc = Number(b.percent_pay || 0);
    const bonus = Number(b.bonus || 0);
    const total = fixed + perc + bonus;

    const q = await pool.query(
      `
      insert into donas_shifts(
        slug, date, staff_name, units_sold, revenue, gross_profit,
        fixed_pay, percent_pay, bonus, total_pay, status
      )
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      returning *
      `,
      [
        SLUG,
        b.date,
        b.staff_name || null,
        Number(b.units_sold || 0),
        Number(b.revenue || 0),
        Number(b.gross_profit || 0),
        fixed,
        perc,
        bonus,
        total,
        b.status || "ok",
      ]
    );

    return res.json(q.rows[0]);
  } catch (e) {
    console.error("POST /donas/ops/shifts error:", e);
    return res.status(500).json({ error: "Failed to create shift" });
  }
});

/** GET shifts by month (YYYY-MM) */
router.get("/donas/ops/shifts", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const month = String(req.query.month || "");
    const q = await pool.query(
      `
      select * from donas_shifts
      where slug=$1 and to_char(date,'YYYY-MM')=$2
      order by date desc, id desc
      `,
      [SLUG, month]
    );
    return res.json(q.rows);
  } catch (e) {
    console.error("GET /donas/ops/shifts error:", e);
    return res.status(500).json({ error: "Failed to load shifts" });
  }
});

/** POST purchase/writeoff */
router.post("/donas/ops/purchases", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const q = await pool.query(
      `
      insert into donas_purchases(slug, date, ingredient, qty, price, type)
      values($1,$2,$3,$4,$5,$6)
      returning *
      `,
      [
        SLUG,
        b.date,
        b.ingredient,
        Number(b.qty || 0),
        Number(b.price || 0),
        b.type, // 'purchase' | 'writeoff'
      ]
    );
    return res.json(q.rows[0]);
  } catch (e) {
    console.error("POST /donas/ops/purchases error:", e);
    return res.status(500).json({ error: "Failed to add purchase" });
  }
});

/** GET purchases by month (YYYY-MM) */
router.get("/donas/ops/purchases", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const month = String(req.query.month || "");
    const q = await pool.query(
      `
      select * from donas_purchases
      where slug=$1 and to_char(date,'YYYY-MM')=$2
      order by date desc, id desc
      `,
      [SLUG, month]
    );
    return res.json(q.rows);
  } catch (e) {
    console.error("GET /donas/ops/purchases error:", e);
    return res.status(500).json({ error: "Failed to load purchases" });
  }
});

/** UPSERT recipe norm */
router.post("/donas/ops/recipe-norms", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const q = await pool.query(
      `
      insert into donas_recipe_norms(slug, ingredient, grams_per_unit, price_per_kg)
      values($1,$2,$3,$4)
      on conflict (slug, ingredient) do update set
        grams_per_unit=excluded.grams_per_unit,
        price_per_kg=excluded.price_per_kg,
        updated_at=now()
      returning *
      `,
      [SLUG, b.ingredient, Number(b.grams_per_unit || 0), Number(b.price_per_kg || 0)]
    );
    return res.json(q.rows[0]);
  } catch (e) {
    console.error("POST /donas/ops/recipe-norms error:", e);
    return res.status(500).json({ error: "Failed to save recipe norm" });
  }
});

/** GET recipe norms */
router.get("/donas/ops/recipe-norms", authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const q = await pool.query(
      `select * from donas_recipe_norms where slug=$1 order by ingredient asc`,
      [SLUG]
    );
    return res.json(q.rows);
  } catch (e) {
    console.error("GET /donas/ops/recipe-norms error:", e);
    return res.status(500).json({ error: "Failed to load recipe norms" });
  }
});

/** GET COGS check (month=YYYY-MM) */
router.get("/donas/ops/cogs-check", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const month = String(req.query.month || "");

    const soldQ = await pool.query(
      `select coalesce(sum(units_sold),0) as units
       from donas_shifts
       where slug=$1 and to_char(date,'YYYY-MM')=$2`,
      [SLUG, month]
    );

    const normsQ = await pool.query(
      `select grams_per_unit, price_per_kg
       from donas_recipe_norms
       where slug=$1`,
      [SLUG]
    );

    const actualQ = await pool.query(
      `select coalesce(sum(total),0) as actual
       from donas_purchases
       where slug=$1 and type='purchase' and to_char(date,'YYYY-MM')=$2`,
      [SLUG, month]
    );

    const sold = Number(soldQ.rows[0]?.units || 0);

    let ideal = 0;
    for (const n of normsQ.rows) {
      ideal += (sold * Number(n.grams_per_unit) * Number(n.price_per_kg)) / 1000;
    }

    const actual = Number(actualQ.rows[0]?.actual || 0);
    const diff = actual - ideal;

    // алерт только если перерасход > 10% от ideal и ideal > 0
    if (ideal > 0 && diff > ideal * 0.1) {
      await pool.query(
        `insert into donas_alerts(slug, type, severity, message)
         values($1,'cogs','warn',$2)`,
        [SLUG, `COGS превышен на ${Math.round(diff)} UZS за ${month}`]
      );
    }

    return res.json({ sold, ideal: Math.round(ideal), actual: Math.round(actual), diff: Math.round(diff) });
  } catch (e) {
    console.error("GET /donas/ops/cogs-check error:", e);
    return res.status(500).json({ error: "Failed to check cogs" });
  }
});

/** GET finance summary (CF + DSCR) from ops data + settings */
router.get("/donas/finance/summary", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const month = String(req.query.month || "");

    const settingsQ = await pool.query(
      `select * from donas_finance_settings where slug=$1 limit 1`,
      [SLUG]
    );
    const s = settingsQ.rows[0] || {};

    const revenueQ = await pool.query(
      `select coalesce(sum(revenue),0) as v
       from donas_shifts
       where slug=$1 and to_char(date,'YYYY-MM')=$2`,
      [SLUG, month]
    );

    const cogsQ = await pool.query(
      `select coalesce(sum(total),0) as v
       from donas_purchases
       where slug=$1 and type='purchase' and to_char(date,'YYYY-MM')=$2`,
      [SLUG, month]
    );

    const payrollQ = await pool.query(
      `select coalesce(sum(total_pay),0) as v
       from donas_shifts
       where slug=$1 and to_char(date,'YYYY-MM')=$2`,
      [SLUG, month]
    );

    const R = Number(revenueQ.rows[0]?.v || 0);
    const C = Number(cogsQ.rows[0]?.v || 0);
    const payroll = Number(payrollQ.rows[0]?.v || 0);

    const fixedOpex = Number(s.fixed_opex_month || 0);
    const variableOpex = Number(s.variable_opex_month || 0);

    // OPEX = fixed + variable + payroll (чтобы payroll не терялся)
    const O = fixedOpex + variableOpex + payroll;

    const loan = Number(s.loan_payment_month || 0);

    const netOperating = R - C - O;
    const cashFlow = netOperating - loan;
    const dscr = loan > 0 ? netOperating / loan : null;

    return res.json({
      month,
      revenue: Math.round(R),
      cogs: Math.round(C),
      payroll: Math.round(payroll),
      opex: Math.round(O),
      loan: Math.round(loan),
      netOperating: Math.round(netOperating),
      cashFlow: Math.round(cashFlow),
      dscr: dscr == null ? null : Number(dscr.toFixed(2)),
    });
  } catch (e) {
    console.error("GET /donas/finance/summary error:", e);
    return res.status(500).json({ error: "Failed to calc summary" });
  }
});

module.exports = router;
