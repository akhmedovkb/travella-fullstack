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
  for (const r of rowsQ.rows || []) {
    map.set(String(r.month).slice(0, 7), r);
  }
  return map;
}

async function getShiftsByMonth(fromYM, toYM) {
  const q = await pool.query(
    `
    select to_char(date,'YYYY-MM') as ym,
           coalesce(sum(total),0) as revenue
    from donas_shifts
    where slug=$1 and to_char(date,'YYYY-MM') between $2 and $3
    group by 1
    order by 1 asc
    `,
    [SLUG, fromYM, toYM]
  );

  const map = new Map();
  for (const r of q.rows || []) {
    map.set(String(r.ym), Number(r.revenue || 0));
  }
  return map;
}

async function getPurchasesCogsByMonth(fromYM, toYM) {
  // Мы считаем COGS как сумму закупок (позже можно заменить на recipe-based).
  const q = await pool.query(
    `
    select to_char(date,'YYYY-MM') as ym,
           coalesce(sum(total),0) as cogs
    from donas_purchases
    where slug=$1 and to_char(date,'YYYY-MM') between $2 and $3
    group by 1
    order by 1 asc
    `,
    [SLUG, fromYM, toYM]
  );

  const map = new Map();
  for (const r of q.rows || []) {
    map.set(String(r.ym), Number(r.cogs || 0));
  }
  return map;
}

async function getExpensesByMonth(fromYM, toYM) {
  const q = await pool.query(
    `
    select to_char(date,'YYYY-MM') as ym,
           coalesce(sum(case when kind='opex' then amount else 0 end),0) as opex,
           coalesce(sum(case when kind='capex' then amount else 0 end),0) as capex
    from donas_expenses
    where slug=$1 and to_char(date,'YYYY-MM') between $2 and $3
    group by 1
    order by 1 asc
    `,
    [SLUG, fromYM, toYM]
  );

  const map = new Map();
  for (const r of q.rows || []) {
    map.set(String(r.ym), { opex: Number(r.opex || 0), capex: Number(r.capex || 0) });
  }
  return map;
}

/** GET settings (самодостаточный: без slug, создаёт дефолт при первом заходе) */
router.get("/donas/finance/settings", authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const q = await pool.query("select * from donas_finance_settings order by id asc limit 1");

    if (!q.rows[0]) {
      const ins = await pool.query("insert into donas_finance_settings default values returning *");
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

    const first = await pool.query("select id from donas_finance_settings order by id asc limit 1");
    if (!first.rows[0]) {
      await pool.query("insert into donas_finance_settings default values");
    }

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
    let idx = 1;

    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(s, f)) {
        sets.push(`${f}=$${idx++}`);
        vals.push(s[f]);
      }
    }

    if (sets.length === 0) {
      const cur = await pool.query("select * from donas_finance_settings order by id asc limit 1");
      return res.json(cur.rows[0] || {});
    }

    await pool.query(
      `update donas_finance_settings set ${sets.join(", ")} where id=(select id from donas_finance_settings order by id asc limit 1)`,
      vals
    );

    const out = await pool.query("select * from donas_finance_settings order by id asc limit 1");
    return res.json(out.rows[0] || {});
  } catch (e) {
    console.error("PUT /donas/finance/settings error:", e);
    return res.status(500).json({ error: "Failed to save settings" });
  }
});

/** =========================================================
 *  FINANCE: MONTHS (Actuals)
 *  Авто-расчёт из OPS (shifts + purchases + expenses).
 *  Ручные значения/корректировки храним в donas_finance_months.
 *  Если месяц залочен (#locked) — берём ручные числа как "final".
 *  Если не залочен — считаем auto и поверх подмешиваем только notes/loan_paid (если задано).
 *  ========================================================= */

router.get("/donas/finance/months", authenticateToken, requireAdmin, async (req, res) => {
  try {
    // диапазон берём из query или считаем автоматически по данным
    const fromQ = String(req.query.from || "").trim(); // YYYY-MM
    const toQ = String(req.query.to || "").trim(); // YYYY-MM

    // Если from/to не передали — берём min/max по ops + months.
    let fromYM = fromQ;
    let toYM = toQ;

    if (!fromYM || !toYM) {
      const r = await pool.query(
        `
        with bounds as (
          select min(to_char(date,'YYYY-MM')) as min_ym, max(to_char(date,'YYYY-MM')) as max_ym from donas_shifts where slug=$1
          union all
          select min(to_char(date,'YYYY-MM')) as min_ym, max(to_char(date,'YYYY-MM')) as max_ym from donas_purchases where slug=$1
          union all
          select min(to_char(date,'YYYY-MM')) as min_ym, max(to_char(date,'YYYY-MM')) as max_ym from donas_expenses where slug=$1
          union all
          select min(to_char(month,'YYYY-MM')) as min_ym, max(to_char(month,'YYYY-MM')) as max_ym from donas_finance_months where slug=$1
        )
        select
          min(min_ym) as min_ym,
          max(max_ym) as max_ym
        from bounds
        `,
        [SLUG]
      );

      const minYM = String(r.rows[0]?.min_ym || "").trim();
      const maxYM = String(r.rows[0]?.max_ym || "").trim();

      // Если вообще нет данных — возвращаем пусто
      if (!minYM || !maxYM) return res.json([]);

      fromYM = fromYM || minYM;
      toYM = toYM || maxYM;
    }

    if (!/^\d{4}-\d{2}$/.test(fromYM) || !/^\d{4}-\d{2}$/.test(toYM)) {
      return res.status(400).json({ error: "from/to must be YYYY-MM" });
    }
    if (!ymLeq(fromYM, toYM)) {
      return res.status(400).json({ error: "from must be <= to" });
    }

    const settings = await getSettingsRow();
    const loanDefault = Number(settings.loan_payment_month || 0);

    const manualMap = await getManualMonthsMap(fromYM, toYM);
    const shiftsMap = await getShiftsByMonth(fromYM, toYM);
    const cogsMap = await getPurchasesCogsByMonth(fromYM, toYM);
    const expMap = await getExpensesByMonth(fromYM, toYM);

    const out = [];

    let t = fromYM;
    let guard = 0;
    while (t && ymLeq(t, toYM) && guard < 240) {
      const monthISO = monthStartISO(t); // YYYY-MM-01
      const manual = manualMap.get(t);

      const autoRevenue = Number(shiftsMap.get(t) || 0);
      const autoCogs = Number(cogsMap.get(t) || 0);
      const ex = expMap.get(t) || { opex: 0, capex: 0 };
      const autoOpex = Number(ex.opex || 0);
      const autoCapex = Number(ex.capex || 0);

      if (manual && isLockedNotes(manual.notes)) {
        // Locked → берём ручные числа как финальные (но если там пусто/NULL — подстрахуемся авто)
        out.push({
          slug: SLUG,
          month: String(manual.month).slice(0, 10),
          revenue: Number(manual.revenue ?? autoRevenue ?? 0),
          cogs: Number(manual.cogs ?? autoCogs ?? 0),
          opex: Number(manual.opex ?? autoOpex ?? 0),
          capex: Number(manual.capex ?? autoCapex ?? 0),
          loan_paid: Number(manual.loan_paid ?? loanDefault ?? 0),
          cash_end: Number(manual.cash_end ?? 0), // cash_end фронт считает цепочкой
          notes: manual.notes ?? "",
        });
      } else {
        // Not locked → считаем auto и поверх оставляем только notes + loan_paid (если в manual задан)
        out.push({
          slug: SLUG,
          month: monthISO,
          revenue: autoRevenue,
          cogs: autoCogs,
          opex: autoOpex,
          capex: autoCapex,
          loan_paid: Number(manual?.loan_paid ?? loanDefault ?? 0),
          cash_end: Number(manual?.cash_end ?? 0),
          notes: manual?.notes ?? "",
        });
      }

      t = addMonthsYM(t, 1);
      guard++;
    }

    return res.json(out);
  } catch (e) {
    console.error("GET /donas/finance/months error:", e);
    return res.status(500).json({ error: "Failed to load months" });
  }
});

/** UPSERT month (ручные значения / корректировки / lock) */
router.put("/donas/finance/months/:month", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const month = String(req.params.month || "").slice(0, 10); // YYYY-MM-01
    if (!/^\d{4}-\d{2}-\d{2}$/.test(month)) return res.status(400).json({ error: "month must be YYYY-MM-DD" });

    const b = req.body || {};

    // всегда фиксируем slug, даже если клиент пришлёт null/undefined
    const row = {
      slug: SLUG,
      month,
      revenue: b.revenue ?? 0,
      cogs: b.cogs ?? 0,
      opex: b.opex ?? 0,
      capex: b.capex ?? 0,
      loan_paid: b.loan_paid ?? 0,
      cash_end: b.cash_end ?? 0,
      notes: b.notes ?? "",
    };

    const q = await pool.query(
      `
      insert into donas_finance_months(slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9)
      on conflict (slug, month)
      do update set
        revenue=excluded.revenue,
        cogs=excluded.cogs,
        opex=excluded.opex,
        capex=excluded.capex,
        loan_paid=excluded.loan_paid,
        cash_end=excluded.cash_end,
        notes=excluded.notes
      returning *
      `,
      [
        row.slug,
        row.month,
        row.revenue,
        row.cogs,
        row.opex,
        row.capex,
        row.loan_paid,
        row.cash_end,
        row.notes,
      ]
    );

    return res.json(q.rows[0]);
  } catch (e) {
    console.error("PUT /donas/finance/months/:month error:", e);
    return res.status(500).json({ error: "Failed to save month" });
  }
});

/** =========================================================
 *  OPS: EXPENSES (OPEX/CAPEX events)
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

    await pool.query(`delete from donas_expenses where slug=$1 and id=$2`, [SLUG, id]);
    return res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /donas/ops/expenses/:id error:", e);
    return res.status(500).json({ error: "Failed to delete expense" });
  }
});

module.exports = router;
