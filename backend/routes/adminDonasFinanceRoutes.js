// backend/routes/adminDonasFinanceRoutes.js

const express = require("express");
const pool = require("../db");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const router = express.Router();

const SLUG = "donas-dosas"; // один фудтрак: фиксируем slug (в ops/months/expenses он используется)

function isLockedNotes(notes) {
  return String(notes || "").toLowerCase().includes("#locked");
}

function ymFromDateLike(d) {
  const s = String(d || "");
  // most common: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 7);
  // fallback: try Date
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return "";
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthStartISO(ym) {
  if (!/^\d{4}-\d{2}$/.test(String(ym || ""))) return null;
  return `${ym}-01`;
}

function addMonthsYM(ym, n) {
  if (!/^\d{4}-\d{2}$/.test(String(ym || ""))) return null;
  const [Y, M] = ym.split("-").map((x) => Number(x));
  const d = new Date(Date.UTC(Y, M - 1 + n, 1));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function ymLeq(a, b) {
  const aa = String(a || "");
  const bb = String(b || "");
  if (!aa || !bb) return false;
  return aa.localeCompare(bb) <= 0;
}

async function getSettingsRow() {
  const q = await pool.query(`select * from donas_finance_settings order by id asc limit 1`);
  return q.rows[0] || {};
}

async function getManualMonthsMap(fromYM, toYM) {
  // returns Map<YYYY-MM, row>
  const rowsQ = await pool.query(
    `
      select *
      from donas_finance_months
      where slug=$1
        and to_char(month,'YYYY-MM') between $2 and $3
      order by month asc
    `,
    [SLUG, fromYM, toYM]
  );
  const map = new Map();
  for (const r of rowsQ.rows || []) map.set(String(r.month).slice(0, 7), r);
  return map;
}

async function computeAutoMonth(ym, settings) {
  // Revenue + payroll
  const shiftsQ = await pool.query(
    `
      select
        coalesce(sum(revenue),0) as revenue,
        coalesce(sum(total_pay),0) as payroll
      from donas_shifts
      where slug=$1 and to_char(date,'YYYY-MM')=$2
    `,
    [SLUG, ym]
  );

  // COGS
  const cogsQ = await pool.query(
    `
      select coalesce(sum(total),0) as cogs
      from donas_purchases
      where slug=$1 and type='purchase' and to_char(date,'YYYY-MM')=$2
    `,
    [SLUG, ym]
  );

  // one-off expenses
  const expQ = await pool.query(
    `
      select
        coalesce(sum(case when kind='opex' then amount else 0 end),0) as opex_extra,
        coalesce(sum(case when kind='capex' then amount else 0 end),0) as capex
      from donas_expenses
      where slug=$1 and to_char(date,'YYYY-MM')=$2
    `,
    [SLUG, ym]
  );

  const fixedOpex = Number(settings.fixed_opex_month || 0);
  const variableOpex = Number(settings.variable_opex_month || 0);
  const loan = Number(settings.loan_payment_month || 0);

  const revenue = Number(shiftsQ.rows[0]?.revenue || 0);
  const payroll = Number(shiftsQ.rows[0]?.payroll || 0);
  const cogs = Number(cogsQ.rows[0]?.cogs || 0);
  const opexExtra = Number(expQ.rows[0]?.opex_extra || 0);
  const capex = Number(expQ.rows[0]?.capex || 0);

  const opexAuto = fixedOpex + variableOpex + payroll + opexExtra;

  return {
    ym,
    revenue,
    cogs,
    payroll,
    fixedOpex,
    variableOpex,
    opexAuto,
    opexExtra,
    capex,
    loan,
  };
}

async function upsertMonthIfNotLocked(ym, settings) {
  const monthISO = monthStartISO(ym);
  if (!monthISO) return;

  const curQ = await pool.query(
    `select * from donas_finance_months where slug=$1 and month=$2 limit 1`,
    [SLUG, monthISO]
  );
  const cur = curQ.rows[0] || null;
  if (cur && isLockedNotes(cur.notes)) return; // respect lock

  const auto = await computeAutoMonth(ym, settings);

  // If user set manual opex (locked months), we won't overwrite; for unlocked months we set auto.
  const payload = {
    revenue: Math.round(auto.revenue),
    cogs: Math.round(auto.cogs),
    opex: Math.round(auto.opexAuto),
    capex: Math.round(auto.capex),
    loan_paid: Math.round(auto.loan),
    cash_end: 0,
    notes: cur?.notes || "",
  };

  await pool.query(
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
    `,
    [
      SLUG,
      monthISO,
      payload.revenue,
      payload.cogs,
      payload.opex,
      payload.capex,
      payload.loan_paid,
      payload.cash_end,
      payload.notes,
    ]
  );
}

/** GET settings (самодостаточный: без slug, создаёт дефолт при первом заходе) */
router.get("/donas/finance/settings", authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const q = await pool.query(
      "select * from donas_finance_settings order by id asc limit 1"
    );

    if (!q.rows[0]) {
      const ins = await pool.query(
        "insert into donas_finance_settings default values returning *"
      );
      return res.json(ins.rows[0]);
    }

    return res.json(q.rows[0]);
  } catch (e) {
    console.error("GET /donas/finance/settings error:", e);
    return res.status(500).json({ error: "Failed to load settings" });
  }
});


/** PUT settings (самодостаточный: без slug, создаёт дефолт если пусто) */
router.put("/donas/finance/settings", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const s = req.body || {};

    // 1) гарантируем, что в таблице есть хотя бы 1 строка
    const first = await pool.query(
      "select id from donas_finance_settings order by id asc limit 1"
    );

    if (!first.rows[0]) {
      await pool.query("insert into donas_finance_settings default values");
    }

    // 2) собираем динамический UPDATE
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

    // если ничего не пришло — просто вернём текущие настройки
    if (!sets.length) {
      const cur = await pool.query(
        "select * from donas_finance_settings order by id asc limit 1"
      );
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

/** GET months list */
async function loadSettings() {
  const q = await pool.query(
    "select * from donas_finance_settings order by id asc limit 1"
  );
  return q.rows[0] || {};
}

async function computeAutoMonth(ym, settings) {
  const month = String(ym || ""); // YYYY-MM
  if (!month) return null;

  // revenue + payroll
  const shiftsQ = await pool.query(
    `
      select
        coalesce(sum(revenue),0) as revenue,
        coalesce(sum(total_pay),0) as payroll
      from donas_shifts
      where slug=$1 and to_char(date,'YYYY-MM')=$2
    `,
    [SLUG, month]
  );
  const revenue = Number(shiftsQ.rows[0]?.revenue || 0);
  const payroll = Number(shiftsQ.rows[0]?.payroll || 0);

  // cogs (purchases only)
  const cogsQ = await pool.query(
    `
      select coalesce(sum(total),0) as cogs
      from donas_purchases
      where slug=$1 and type='purchase' and to_char(date,'YYYY-MM')=$2
    `,
    [SLUG, month]
  );
  const cogs = Number(cogsQ.rows[0]?.cogs || 0);

  // one-off expenses
  const expQ = await pool.query(
    `
      select
        coalesce(sum(case when kind='opex' then amount else 0 end),0) as opex_extra,
        coalesce(sum(case when kind='capex' then amount else 0 end),0) as capex
      from donas_expenses
      where slug=$1 and to_char(date,'YYYY-MM')=$2
    `,
    [SLUG, month]
  );
  const opexExtra = Number(expQ.rows[0]?.opex_extra || 0);
  const capex = Number(expQ.rows[0]?.capex || 0);

  const fixedOpex = Number(settings.fixed_opex_month || 0);
  const variableOpex = Number(settings.variable_opex_month || 0);
  const loanPaid = Number(settings.loan_payment_month || 0);

  const opexAuto = fixedOpex + variableOpex + payroll + opexExtra;

  // optional manual override from donas_finance_months (ONLY opex for now)
  const manualQ = await pool.query(
    `
      select month, opex, notes
      from donas_finance_months
      where slug=$1 and to_char(month,'YYYY-MM')=$2
      limit 1
    `,
    [SLUG, month]
  );
  const manual = manualQ.rows[0] || null;
  const hasManualOpex = manual?.opex != null;
  const opex = hasManualOpex ? Number(manual.opex || 0) : opexAuto;
  const notes = manual?.notes || "";

  return {
    ym: month,
    monthISO: monthStartISO(month),
    revenue: Math.round(revenue),
    cogs: Math.round(cogs),
    opex: Math.round(opex),
    capex: Math.round(capex),
    loan_paid: Math.round(loanPaid),
    notes,
    _auto: {
      opex_auto: Math.round(opexAuto),
      payroll: Math.round(payroll),
      opex_extra: Math.round(opexExtra),
      fixed_opex: Math.round(fixedOpex),
      variable_opex: Math.round(variableOpex),
      opex_source: hasManualOpex ? "manual" : "auto",
    },
  };
}

async function getMonthsRangeYM() {
  // min/max month from ops + manual months table
  const q = await pool.query(
    `
      with m as (
        select min(to_char(date,'YYYY-MM')) as min_ym, max(to_char(date,'YYYY-MM')) as max_ym
        from donas_shifts where slug=$1
      ), p as (
        select min(to_char(date,'YYYY-MM')) as min_ym, max(to_char(date,'YYYY-MM')) as max_ym
        from donas_purchases where slug=$1
      ), e as (
        select min(to_char(date,'YYYY-MM')) as min_ym, max(to_char(date,'YYYY-MM')) as max_ym
        from donas_expenses where slug=$1
      ), fm as (
        select min(to_char(month,'YYYY-MM')) as min_ym, max(to_char(month,'YYYY-MM')) as max_ym
        from donas_finance_months where slug=$1
      )
      select
        (select min(x) from (values (m.min_ym),(p.min_ym),(e.min_ym),(fm.min_ym)) as v(x)) as min_ym,
        (select max(x) from (values (m.max_ym),(p.max_ym),(e.max_ym),(fm.max_ym)) as v(x)) as max_ym
      from m, p, e, fm
    `,
    [SLUG]
  );
  const minYM = q.rows[0]?.min_ym || "";
  const maxYM = q.rows[0]?.max_ym || "";
  return { minYM, maxYM };
}

function expandYMRange(minYM, maxYM) {
  if (!minYM || !maxYM) return [];
  if (!/\d{4}-\d{2}/.test(minYM) || !/\d{4}-\d{2}/.test(maxYM)) return [];
  const out = [];
  let cur = minYM;
  let guard = 0;
  while (cur && cur.localeCompare(maxYM) <= 0 && guard < 240) {
    out.push(cur);
    cur = addMonthsYM(cur, 1);
    guard++;
  }
  return out;
}

async function upsertAutoMonthToTable(ym, settings) {
  const auto = await computeAutoMonth(ym, settings);
  if (!auto || !auto.monthISO) return;

  // if month is locked, do NOT overwrite numbers (keep adjustments)
  const existingQ = await pool.query(
    `select * from donas_finance_months where slug=$1 and month=$2 limit 1`,
    [SLUG, auto.monthISO]
  );
  const existing = existingQ.rows[0] || null;
  if (existing && isLockedNotes(existing.notes)) return;

  // keep notes if exists
  const notes = existing?.notes || auto.notes || null;

  await pool.query(
    `
      insert into donas_finance_months(slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9)
      on conflict (slug, month) do update set
        revenue=excluded.revenue,
        cogs=excluded.cogs,
        opex=excluded.opex,
        capex=excluded.capex,
        loan_paid=excluded.loan_paid,
        -- cash_end считается на фронте цепочкой, не трогаем (оставляем как было)
        notes=excluded.notes,
        updated_at=now()
    `,
    [
      SLUG,
      auto.monthISO,
      auto.revenue,
      auto.cogs,
      auto.opex,
      auto.capex,
      auto.loan_paid,
      existing?.cash_end ?? 0,
      notes,
    ]
  );
}

/** GET months list
 *  - default (no mode): AUTO actuals computed from OPS (+ manual opex override)
 *  - ?mode=manual: raw rows from donas_finance_months
 */
router.get("/donas/finance/months", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const mode = String(req.query.mode || "");
    if (mode === "manual") {
      const q = await pool.query(
        "select * from donas_finance_months where slug=$1 order by month asc",
        [SLUG]
      );
      return res.json(q.rows);
    }

    const settings = await loadSettings();
    const { minYM, maxYM } = await getMonthsRangeYM();
    const yms = expandYMRange(minYM, maxYM);

    // build a map of manual rows for notes/locked/adjusted compare
    const manualQ = await pool.query(
      `select * from donas_finance_months where slug=$1`,
      [SLUG]
    );
    const manualMap = new Map(
      (manualQ.rows || []).map((r) => [String(r.month).slice(0, 7), r])
    );

    const out = [];
    for (const ym of yms) {
      const auto = await computeAutoMonth(ym, settings);
      if (!auto) continue;

      const manual = manualMap.get(ym) || null;
      const locked = manual ? isLockedNotes(manual.notes) : false;

      // if locked: show manual numbers, but also send auto snapshot for UI badges
      const revenue = locked ? Number(manual.revenue || 0) : auto.revenue;
      const cogs = locked ? Number(manual.cogs || 0) : auto.cogs;
      const opex = locked ? Number(manual.opex || 0) : auto.opex;
      const capex = locked ? Number(manual.capex || 0) : auto.capex;
      const loan_paid = locked ? Number(manual.loan_paid || 0) : auto.loan_paid;
      const cash_end = manual ? Number(manual.cash_end || 0) : 0;
      const notes = manual?.notes || auto.notes || "";

      const mixed =
        locked &&
        (Math.round(revenue) !== Math.round(auto.revenue) ||
          Math.round(cogs) !== Math.round(auto.cogs) ||
          Math.round(opex) !== Math.round(auto.opex) ||
          Math.round(capex) !== Math.round(auto.capex) ||
          Math.round(loan_paid) !== Math.round(auto.loan_paid));

      out.push({
        slug: SLUG,
        month: auto.monthISO, // YYYY-MM-01
        revenue,
        cogs,
        opex,
        capex,
        loan_paid,
        cash_end,
        notes,
        _source: {
          mode: locked ? "manual" : "auto",
          locked,
          mixed,
          opex_source: auto._auto?.opex_source || "auto",
        },
        _auto_values: {
          revenue: auto.revenue,
          cogs: auto.cogs,
          opex: auto.opex,
          capex: auto.capex,
          loan_paid: auto.loan_paid,
        },
        _auto_breakdown: auto._auto,
      });
    }

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

    // ✅ auto-recalc month actuals cache (skip if month locked)
    try {
      const ym = ymFromDateLike(b.date);
      const settings = await loadSettings();
      await upsertAutoMonthToTable(ym, settings);
    } catch (e) {
      console.warn("auto month recalc after shift failed:", e?.message || e);
    }

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

    // ✅ auto-recalc month actuals cache
    try {
      const ym = ymFromDateLike(b.date);
      const settings = await loadSettings();
      await upsertAutoMonthToTable(ym, settings);
    } catch (e) {
      console.warn("auto month recalc after purchase failed:", e?.message || e);
    }
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

/** =========================================================
 *  OPS: ONE-OFF EXPENSES (OPEX/CAPEX events)
 *  ========================================================= */

/** POST expense { date, amount, kind:'opex'|'capex', category?, note? } */
router.post("/donas/ops/expenses", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const date = b.date;
    const kind = String(b.kind || "").toLowerCase();
    const amount = Number(b.amount || 0);
    const category = b.category ? String(b.category) : null;
    const note = b.note ? String(b.note) : null;

    if (!date) return res.status(400).json({ error: "date required" });
    if (kind !== "opex" && kind !== "capex") return res.status(400).json({ error: "kind must be opex/capex" });

    const q = await pool.query(
      `
      insert into donas_expenses(slug, date, amount, kind, category, note)
      values($1,$2,$3,$4,$5,$6)
      returning *
      `,
      [SLUG, date, amount, kind, category, note]
    );

    // ✅ auto-recalc month actuals cache
    try {
      const ym = ymFromDateLike(date);
      const settings = await loadSettings();
      await upsertAutoMonthToTable(ym, settings);
    } catch (e) {
      console.warn("auto month recalc after expense failed:", e?.message || e);
    }
    return res.json(q.rows[0]);
  } catch (e) {
    console.error("POST /donas/ops/expenses error:", e);
    return res.status(500).json({ error: "Failed to create expense" });
  }
});

/** GET expenses (month=YYYY-MM) OR (from/to=YYYY-MM) */
router.get("/donas/ops/expenses", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const month = String(req.query.month || "");
    const from = String(req.query.from || "");
    const to = String(req.query.to || "");

    let q;
    if (month) {
      q = await pool.query(
        `
        select * from donas_expenses
        where slug=$1 and to_char(date,'YYYY-MM')=$2
        order by date desc, id desc
        `,
        [SLUG, month]
      );
      return res.json(q.rows);
    }

    if (from && to) {
      q = await pool.query(
        `
        select * from donas_expenses
        where slug=$1 and to_char(date,'YYYY-MM') between $2 and $3
        order by date desc, id desc
        `,
        [SLUG, from, to]
      );
      return res.json(q.rows);
    }

    return res.status(400).json({ error: "month or from/to required" });
  } catch (e) {
    console.error("GET /donas/ops/expenses error:", e);
    return res.status(500).json({ error: "Failed to load expenses" });
  }
});

/** DELETE expense */
router.delete("/donas/ops/expenses/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: "id required" });
    const q = await pool.query(
      `delete from donas_expenses where slug=$1 and id=$2 returning id, date`,
      [SLUG, id]
    );

    // ✅ auto-recalc month actuals cache
    try {
      const ym = ymFromDateLike(q.rows[0]?.date);
      const settings = await loadSettings();
      await upsertAutoMonthToTable(ym, settings);
    } catch (e) {
      console.warn("auto month recalc after expense delete failed:", e?.message || e);
    }

    return res.json({ ok: true, id: q.rows[0]?.id || id });
  } catch (e) {
    console.error("DELETE /donas/ops/expenses/:id error:", e);
    return res.status(500).json({ error: "Failed to delete expense" });
  }
});

/** GET finance summary (CF + DSCR) from ops data + settings */
router.get("/donas/finance/summary", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const month = String(req.query.month || "");

    // 1. settings — просто первая строка
    const settingsQ = await pool.query(
      `select * from donas_finance_settings order by id asc limit 1`
    );
    const s = settingsQ.rows[0] || {};

    // 2. revenue (выручка)
    const revenueQ = await pool.query(
      `
      select coalesce(sum(revenue),0) as v
      from donas_shifts
      where to_char(date,'YYYY-MM')=$1
      `,
      [month]
    );

    // 3. COGS (закупки)
    const cogsQ = await pool.query(
      `
      select coalesce(sum(total),0) as v
      from donas_purchases
      where type='purchase'
        and to_char(date,'YYYY-MM')=$1
      `,
      [month]
    );

    // 4. payroll (выплаты персоналу)
    const payrollQ = await pool.query(
      `
      select coalesce(sum(total_pay),0) as v
      from donas_shifts
      where to_char(date,'YYYY-MM')=$1
      `,
      [month]
    );

    const R = Number(revenueQ.rows[0]?.v || 0);
    const C = Number(cogsQ.rows[0]?.v || 0);
    const payroll = Number(payrollQ.rows[0]?.v || 0);

    const fixedOpex = Number(s.fixed_opex_month || 0);
    const variableOpex = Number(s.variable_opex_month || 0);

    // one-off expenses (opex/capex) for month
    const expQ = await pool.query(
      `
      select
        coalesce(sum(case when kind='opex' then amount else 0 end),0) as opex_extra,
        coalesce(sum(case when kind='capex' then amount else 0 end),0) as capex
      from donas_expenses
      where slug=$1 and to_char(date,'YYYY-MM')=$2
      `,
      [SLUG, month]
    );
    const opexExtra = Number(expQ.rows[0]?.opex_extra || 0);
    const capex = Number(expQ.rows[0]?.capex || 0);

    // OPEX = fixed + variable + payroll
    const O = fixedOpex + variableOpex + payroll + opexExtra;

    const loan = Number(s.loan_payment_month || 0);

    const netOperating = R - C - O;
    const cashFlow = netOperating - loan - capex;
    const dscr = loan > 0 && netOperating > 0 ? netOperating / loan : null;

    return res.json({
      month,
      revenue: Math.round(R),
      cogs: Math.round(C),
      payroll: Math.round(payroll),
      opex: Math.round(O),
      opexExtra: Math.round(opexExtra),
      capex: Math.round(capex),
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

/** GET finance summary range (months list) */
router.get("/donas/finance/summary-range", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const from = String(req.query.from || "");
    const to = String(req.query.to || "");

    if (!from || !to) return res.status(400).json({ error: "from/to required" });

    const settingsQ = await pool.query(
      `select * from donas_finance_settings order by id asc limit 1`
    );
    const s = settingsQ.rows[0] || {};

    const fixedOpex = Number(s.fixed_opex_month || 0);
    const variableOpex = Number(s.variable_opex_month || 0);
    const loan = Number(s.loan_payment_month || 0);

        // manual OPEX override by month (optional)
    const manualOpexQ = await pool.query(
      `
      select to_char(month,'YYYY-MM') as month,
             opex
      from donas_finance_months
      where slug=$1
        and to_char(month,'YYYY-MM') between $2 and $3
      order by 1
      `,
      [SLUG, from, to]
    );
    const manualOpexMap = new Map(
      (manualOpexQ.rows || []).map((r) => [String(r.month), r.opex])
    );

    // revenue + payroll by month
    const shiftsQ = await pool.query(
      `
      select to_char(date,'YYYY-MM') as month,
             coalesce(sum(revenue),0) as revenue,
             coalesce(sum(total_pay),0) as payroll
      from donas_shifts
      where to_char(date,'YYYY-MM') between $1 and $2
      group by 1
      order by 1
      `,
      [from, to]
    );

    // cogs by month
    const cogsQ = await pool.query(
      `
      select to_char(date,'YYYY-MM') as month,
             coalesce(sum(total),0) as cogs
      from donas_purchases
      where type='purchase'
        and to_char(date,'YYYY-MM') between $1 and $2
      group by 1
      order by 1
      `,
      [from, to]
    );

    // one-off expenses by month
    const expQ = await pool.query(
      `
      select to_char(date,'YYYY-MM') as month,
             coalesce(sum(case when kind='opex' then amount else 0 end),0) as opex_extra,
             coalesce(sum(case when kind='capex' then amount else 0 end),0) as capex
      from donas_expenses
      where slug=$1 and to_char(date,'YYYY-MM') between $2 and $3
      group by 1
      order by 1
      `,
      [SLUG, from, to]
    );

    const map = new Map();
    for (const r of shiftsQ.rows) {
      map.set(r.month, {
        month: r.month,
        revenue: Number(r.revenue || 0),
        payroll: Number(r.payroll || 0),
        cogs: 0,
        opexExtra: 0,
        capex: 0,
      });
    }
    for (const r of cogsQ.rows) {
      const cur = map.get(r.month) || { month: r.month, revenue: 0, payroll: 0, cogs: 0 };
      cur.cogs = Number(r.cogs || 0);
      map.set(r.month, cur);
    }

    // ensure months that exist only in manual months are also present
    for (const [m] of manualOpexMap.entries()) {
      if (!map.has(m)) map.set(m, { month: m, revenue: 0, payroll: 0, cogs: 0, opexExtra: 0, capex: 0 });
    }
    for (const r of expQ.rows) {
      const cur = map.get(r.month) || { month: r.month, revenue: 0, payroll: 0, cogs: 0, opexExtra: 0, capex: 0 };
      cur.opexExtra = Number(r.opex_extra || 0);
      cur.capex = Number(r.capex || 0);
      map.set(r.month, cur);
    }   
    const out = Array.from(map.values()).map((m) => {
      const manualVal = manualOpexMap.has(m.month) ? manualOpexMap.get(m.month) : null;
      const hasManual = manualVal !== null && manualVal !== undefined;
      const opexAuto = fixedOpex + variableOpex + m.payroll + (m.opexExtra || 0);
      const opex = hasManual ? Number(manualVal || 0) : opexAuto;
      const netOperating = m.revenue - m.cogs - opex;
      const cashFlow = netOperating - loan - (m.capex || 0);
      const dscr = loan > 0 && netOperating > 0 ? netOperating / loan : null;

      return {
        month: m.month,
        revenue: Math.round(m.revenue),
        cogs: Math.round(m.cogs),
        payroll: Math.round(m.payroll),
        fixedOpex: Math.round(fixedOpex),
        variableOpex: Math.round(variableOpex),
        opex: Math.round(opex),
        opexSource: hasManual ? "manual" : "auto",
        opexExtra: Math.round(m.opexExtra || 0),
        capex: Math.round(m.capex || 0),
        loan: Math.round(loan),
        netOperating: Math.round(netOperating),
        cashFlow: Math.round(cashFlow),
        dscr: dscr == null ? null : Number(dscr.toFixed(2)),
      };
    });

    return res.json(out);
  } catch (e) {
    console.error("GET /donas/finance/summary-range error:", e);
    return res.status(500).json({ error: "Failed to calc summary range" });
  }
});


module.exports = router;
