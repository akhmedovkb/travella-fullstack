// backend/routes/adminDonasFinanceRoutes.js

const express = require("express");
const router = express.Router();
const pool = require("../db");
const authenticateToken = require("../middleware/authenticateToken");

// fixed slug for Dona's Dosas
const SLUG = "donas-dosas";

/** ===================== Admin guard ===================== */
function isAdminUser(user) {
  if (!user) return false;
  const role = String(user.role || "").toLowerCase();
  if (role === "admin" || role === "root" || role === "super") return true;

  if (user.is_admin === true || user.admin === true) return true;

  const roles = Array.isArray(user.roles)
    ? user.roles.map((x) => String(x).toLowerCase())
    : [];
  const perms = Array.isArray(user.permissions)
    ? user.permissions.map((x) => String(x).toLowerCase())
    : [];

  return (
    roles.includes("admin") ||
    roles.includes("root") ||
    roles.includes("super") ||
    perms.includes("moderation") ||
    perms.includes("admin:moderation")
  );
}

function requireAdmin(req, res, next) {
  if (!isAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
  return next();
}

/** ===================== helpers ===================== */
function ymToDateUTC(ym) {
  // ym: "YYYY-MM"
  if (!/^\d{4}-\d{2}$/.test(String(ym || ""))) return null;
  const [y, m] = ym.split("-").map((x) => Number(x));
  return new Date(Date.UTC(y, m - 1, 1));
}

function dateToYM(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function dateToISOMonthStart(d) {
  // YYYY-MM-01
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

function addMonthsUTC(d, n) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

function clampYM(ym) {
  const d = ymToDateUTC(ym);
  if (!d) return null;
  return dateToYM(d);
}

/** ===================== FINANCE: settings ===================== */

/** GET settings */
router.get("/donas/finance/settings", authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const q = await pool.query("select * from donas_finance_settings order by id asc limit 1");
    if (!q.rows[0]) {
      await pool.query("insert into donas_finance_settings default values");
      const qq = await pool.query("select * from donas_finance_settings order by id asc limit 1");
      return res.json(qq.rows[0] || {});
    }
    return res.json(q.rows[0] || {});
  } catch (e) {
    console.error("GET /donas/finance/settings error:", e);
    return res.status(500).json({ error: "Failed to load settings" });
  }
});

/** PUT settings */
router.put("/donas/finance/settings", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const s = req.body || {};

    const first = await pool.query("select id from donas_finance_settings order by id asc limit 1");
    if (!first.rows[0]) {
      await pool.query("insert into donas_finance_settings default values");
    }

    // dynamic update
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

    if (!sets.length) {
      const cur = await pool.query("select * from donas_finance_settings order by id asc limit 1");
      return res.json(cur.rows[0] || {});
    }

    const sql = `
      update donas_finance_settings
      set ${sets.join(", ")}, updated_at=now()
      where id = (select id from donas_finance_settings order by id asc limit 1)
      returning *
    `;

    const q = await pool.query(sql, vals);
    return res.json(q.rows[0]);
  } catch (e) {
    console.error("PUT /donas/finance/settings error:", e);
    return res.status(500).json({ error: "Failed to save settings" });
  }
});

/** =========================================================
 *  FINANCE: months
 *  - manual table: donas_finance_months (editable)
 *  - auto: build from actual ops tables (shifts/purchases/expenses) + optional manual opex override
 *  ========================================================= */

/**
 * GET months list
 * - mode=manual -> as-is from donas_finance_months
 * - mode=auto (default) -> computed from actuals
 */
router.get("/donas/finance/months", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const mode = String(req.query.mode || "auto").toLowerCase();

    if (mode === "manual") {
      const q = await pool.query(
        "select * from donas_finance_months where slug=$1 order by month asc",
        [SLUG]
      );
      return res.json(q.rows);
    }

    // settings (for fixed/variable opex + loan)
    const sQ = await pool.query("select * from donas_finance_settings order by id asc limit 1");
    const s = sQ.rows[0] || {};
    const fixedOpex = Number(s.fixed_opex_month || 0);
    const variableOpex = Number(s.variable_opex_month || 0);
    const loan = Number(s.loan_payment_month || 0);

    // detect range from actuals + manual months (to not return empty)
    const rangeQ = await pool.query(
      `
      with
        a as (
          select min(date_trunc('month', date)) as minm, max(date_trunc('month', date)) as maxm
          from donas_shifts
        ),
        b as (
          select min(date_trunc('month', date)) as minm, max(date_trunc('month', date)) as maxm
          from donas_purchases
        ),
        c as (
          select min(date_trunc('month', date)) as minm, max(date_trunc('month', date)) as maxm
          from donas_expenses
          where slug=$1
        ),
        d as (
          select min(date_trunc('month', month)) as minm, max(date_trunc('month', month)) as maxm
          from donas_finance_months
          where slug=$1
        )
      select
        to_char(
          least(
            coalesce(a.minm, '9999-12-01'::date),
            coalesce(b.minm, '9999-12-01'::date),
            coalesce(c.minm, '9999-12-01'::date),
            coalesce(d.minm, '9999-12-01'::date)
          ),
          'YYYY-MM'
        ) as min_ym,
        to_char(
          greatest(
            coalesce(a.maxm, '0001-01-01'::date),
            coalesce(b.maxm, '0001-01-01'::date),
            coalesce(c.maxm, '0001-01-01'::date),
            coalesce(d.maxm, '0001-01-01'::date)
          ),
          'YYYY-MM'
        ) as max_ym
      from a, b, c, d
      `,
      [SLUG]
    );

    const minYM = clampYM(rangeQ.rows?.[0]?.min_ym);
    const maxYM = clampYM(rangeQ.rows?.[0]?.max_ym);

    // if absolutely nothing exists in DB yet -> return empty (frontend will show "Нет данных")
    if (!minYM || !maxYM) return res.json([]);

    // manual OPEX override map + notes (optional)
    const manualQ = await pool.query(
      `
      select to_char(month,'YYYY-MM') as ym, opex, notes
      from donas_finance_months
      where slug=$1 and to_char(month,'YYYY-MM') between $2 and $3
      order by 1
      `,
      [SLUG, minYM, maxYM]
    );
    const manualOpexMap = new Map((manualQ.rows || []).map((r) => [String(r.ym), r.opex]));
    const manualNotesMap = new Map((manualQ.rows || []).map((r) => [String(r.ym), r.notes || ""]));

    // revenue + payroll by month
    const shiftsQ = await pool.query(
      `
      select to_char(date,'YYYY-MM') as ym,
             coalesce(sum(revenue),0) as revenue,
             coalesce(sum(total_pay),0) as payroll
      from donas_shifts
      where to_char(date,'YYYY-MM') between $1 and $2
      group by 1
      order by 1
      `,
      [minYM, maxYM]
    );

    // cogs by month (purchase only)
    const cogsQ = await pool.query(
      `
      select to_char(date,'YYYY-MM') as ym,
             coalesce(sum(total),0) as cogs
      from donas_purchases
      where type='purchase'
        and to_char(date,'YYYY-MM') between $1 and $2
      group by 1
      order by 1
      `,
      [minYM, maxYM]
    );

    // expenses by month: opex_extra + capex
    const expQ = await pool.query(
      `
      select to_char(date,'YYYY-MM') as ym,
             coalesce(sum(case when kind='opex' then amount else 0 end),0) as opex_extra,
             coalesce(sum(case when kind='capex' then amount else 0 end),0) as capex
      from donas_expenses
      where slug=$1
        and to_char(date,'YYYY-MM') between $2 and $3
      group by 1
      order by 1
      `,
      [SLUG, minYM, maxYM]
    );

    // Build base months map from the full range (even if some months have 0 rows)
    const fromD = ymToDateUTC(minYM);
    const toD = ymToDateUTC(maxYM);
    const base = new Map();

    // fill all months between min and max inclusive
    let cur = fromD;
    let guard = 0;
    while (cur <= toD && guard < 240) {
      const ym = dateToYM(cur);
      base.set(ym, {
        slug: SLUG,
        month: dateToISOMonthStart(cur),
        revenue: 0,
        cogs: 0,
        payroll: 0,
        opexExtra: 0,
        capex: 0,
      });
      cur = addMonthsUTC(cur, 1);
      guard++;
    }

    for (const r of shiftsQ.rows || []) {
      const ym = String(r.ym);
      const curRow = base.get(ym);
      if (!curRow) continue;
      curRow.revenue = Number(r.revenue || 0);
      curRow.payroll = Number(r.payroll || 0);
    }

    for (const r of cogsQ.rows || []) {
      const ym = String(r.ym);
      const curRow = base.get(ym);
      if (!curRow) continue;
      curRow.cogs = Number(r.cogs || 0);
    }

    for (const r of expQ.rows || []) {
      const ym = String(r.ym);
      const curRow = base.get(ym);
      if (!curRow) continue;
      curRow.opexExtra = Number(r.opex_extra || 0);
      curRow.capex = Number(r.capex || 0);
    }

    const out = Array.from(base.entries())
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([ym, m]) => {
        const manualOpex = manualOpexMap.has(ym) ? manualOpexMap.get(ym) : null;
        const hasManualOpex = manualOpex !== null && manualOpex !== undefined;

        const opexAuto = fixedOpex + variableOpex + Number(m.payroll || 0) + Number(m.opexExtra || 0);
        const opex = hasManualOpex ? Number(manualOpex || 0) : opexAuto;

        // we return the same shape as donas_finance_months rows (frontend expects it)
        return {
          slug: SLUG,
          month: m.month,
          revenue: Number(m.revenue || 0),
          cogs: Number(m.cogs || 0),
          opex: Number(opex || 0),
          capex: Number(m.capex || 0),
          loan_paid: loan,
          cash_end: 0, // frontend chain recalculates using cash_start anyway
          notes: manualNotesMap.get(ym) || "",
          _auto: {
            payroll: Number(m.payroll || 0),
            opex_extra: Number(m.opexExtra || 0),
            fixed_opex: fixedOpex,
            variable_opex: variableOpex,
          },
        };
      });

    return res.json(out);
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

// остальные OPS/recipe/cogs/summary-роуты — оставляем как были в твоём файле
module.exports = router;
