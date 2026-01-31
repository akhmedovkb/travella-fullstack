// backend/routes/adminDonasFinanceRoutes.js

const express = require("express");
const pool = require("../db");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const router = express.Router();

const SLUG = "donas-dosas"; // один фудтрак: фиксируем slug

function isLockedNotes(notes) {
  return String(notes || "").toLowerCase().includes("#locked");
}

function ymFromDateLike(x) {
  const s = String(x || "");
  if (!s) return null;
  // "YYYY-MM-01" or "YYYY-MM-31T..." -> "YYYY-MM"
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  // "YYYY-MM"
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  return null;
}

function isoMonthStartFromYM(ym) {
  const m = ymFromDateLike(ym);
  if (!m) return null;
  return `${m}-01`;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeMonthISO(d) {
  // DB date -> "YYYY-MM-01"
  const s = String(d || "");
  if (!s) return "";
  return s.slice(0, 10);
}

async function getPurchasesSumsByMonth(ymList) {
  const months = (Array.isArray(ymList) ? ymList : [])
    .map((x) => ymFromDateLike(x))
    .filter(Boolean);

  if (!months.length) return {};

  const q = await pool.query(
    `
    select
      to_char(date,'YYYY-MM') as ym,
      type,
      coalesce(sum(total),0) as total
    from donas_purchases
    where to_char(date,'YYYY-MM') = any($1)
      and type in ('opex','capex')
    group by 1,2
    `,
    [months]
  );

  const out = {};
  for (const r of q.rows || []) {
    const ym = ymFromDateLike(r.ym);
    if (!ym) continue;
    if (!out[ym]) out[ym] = { opex: 0, capex: 0 };
    if (r.type === "opex") out[ym].opex = toNum(r.total);
    if (r.type === "capex") out[ym].capex = toNum(r.total);
  }
  return out;
}

function computeChainWithSnapshots({ cashStart, monthRows, purchasesByYm }) {
  let cash = toNum(cashStart);

  return (monthRows || []).map((r) => {
    const ym = ymFromDateLike(r.month);
    const locked = Boolean(r._locked);

    const revenue = toNum(r.revenue);
    const cogs = toNum(r.cogs);
    const loan_paid = toNum(r.loan_paid);

    const purchases = purchasesByYm?.[ym] || { opex: 0, capex: 0 };

    // Для unlocked: берём из purchases
    // Для locked: берём snapshot из donas_finance_months
    const opex = locked ? toNum(r.opex) : toNum(purchases.opex);
    const capex = locked ? toNum(r.capex) : toNum(purchases.capex);

    const gp = revenue - cogs;
    const netOp = gp - opex;
    const cf = netOp - loan_paid - capex;

    if (locked) {
      cash = toNum(r.cash_end);
      return {
        ...r,
        opex,
        capex,
        cash_end: cash,
        _calc: { gp, netOp, cf },
        _source: { opex: "snapshot", capex: "snapshot" },
      };
    }

    cash = cash + cf;
    return {
      ...r,
      opex,
      capex,
      cash_end: cash,
      _calc: { gp, netOp, cf },
      _source: { opex: "purchases", capex: "purchases" },
    };
  });
}

/**
 * SETTINGS
 * GET  /api/admin/donas/finance/settings
 * PUT  /api/admin/donas/finance/settings
 */
router.get("/donas/finance/settings", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const q = await pool.query(
      `
      select
        slug,
        currency,
        avg_check,
        cogs_per_unit,
        units_per_day,
        days_per_month,
        fixed_opex_month,
        variable_opex_month,
        loan_payment_month,
        cash_start,
        reserve_target_months
      from donas_finance_settings
      where slug = $1
      limit 1
      `,
      [SLUG]
    );

    if (!q.rows.length) {
      return res.json({
        slug: SLUG,
        currency: "UZS",
        avg_check: 0,
        cogs_per_unit: 0,
        units_per_day: 0,
        days_per_month: 26,
        fixed_opex_month: 0,
        variable_opex_month: 0,
        loan_payment_month: 0,
        cash_start: 0,
        reserve_target_months: 6,
      });
    }

    res.json(q.rows[0]);
  } catch (e) {
    console.error("finance/settings GET error:", e);
    res.status(500).json({ error: "Failed to load settings" });
  }
});

router.put("/donas/finance/settings", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};

    const payload = {
      slug: SLUG,
      currency: b.currency || "UZS",
      avg_check: toNum(b.avg_check),
      cogs_per_unit: toNum(b.cogs_per_unit),
      units_per_day: toNum(b.units_per_day),
      days_per_month: toNum(b.days_per_month) || 26,
      fixed_opex_month: toNum(b.fixed_opex_month),
      variable_opex_month: toNum(b.variable_opex_month),
      loan_payment_month: toNum(b.loan_payment_month),
      cash_start: toNum(b.cash_start),
      reserve_target_months: toNum(b.reserve_target_months) || 0,
    };

    const q = await pool.query(
      `
      insert into donas_finance_settings (
        slug, currency, avg_check, cogs_per_unit, units_per_day, days_per_month,
        fixed_opex_month, variable_opex_month, loan_payment_month,
        cash_start, reserve_target_months
      ) values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
      )
      on conflict (slug) do update set
        currency = excluded.currency,
        avg_check = excluded.avg_check,
        cogs_per_unit = excluded.cogs_per_unit,
        units_per_day = excluded.units_per_day,
        days_per_month = excluded.days_per_month,
        fixed_opex_month = excluded.fixed_opex_month,
        variable_opex_month = excluded.variable_opex_month,
        loan_payment_month = excluded.loan_payment_month,
        cash_start = excluded.cash_start,
        reserve_target_months = excluded.reserve_target_months
      returning *
      `,
      [
        payload.slug,
        payload.currency,
        payload.avg_check,
        payload.cogs_per_unit,
        payload.units_per_day,
        payload.days_per_month,
        payload.fixed_opex_month,
        payload.variable_opex_month,
        payload.loan_payment_month,
        payload.cash_start,
        payload.reserve_target_months,
      ]
    );

    res.json(q.rows[0]);
  } catch (e) {
    console.error("finance/settings PUT error:", e);
    res.status(500).json({ error: "Failed to save settings" });
  }
});

/**
 * MONTHS
 * GET  /api/admin/donas/finance/months
 * PUT  /api/admin/donas/finance/months/:month
 * POST /api/admin/donas/finance/months/sync
 * POST /api/admin/donas/finance/months/:month/unlock
 */

router.get("/donas/finance/months", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const s = await pool.query(
      `select cash_start from donas_finance_settings where slug=$1 limit 1`,
      [SLUG]
    );
    const cashStart = toNum(s.rows?.[0]?.cash_start);

    const q = await pool.query(
      `
      select
        slug,
        month,
        revenue,
        cogs,
        opex,
        capex,
        loan_paid,
        cash_end,
        notes
      from donas_finance_months
      where slug = $1
      order by month asc
      `,
      [SLUG]
    );

    const rows = (q.rows || []).map((r) => {
      const monthIso = normalizeMonthISO(r.month);
      const ym = ymFromDateLike(monthIso);
      const notes = String(r.notes || "");
      return {
        ...r,
        month: monthIso,
        revenue: toNum(r.revenue),
        cogs: toNum(r.cogs),
        opex: toNum(r.opex),
        capex: toNum(r.capex),
        loan_paid: toNum(r.loan_paid),
        cash_end: toNum(r.cash_end),
        notes,
        _locked: isLockedNotes(notes),
        _ym: ym,
      };
    });

    const yms = rows.map((r) => r._ym).filter(Boolean);
    const purchasesByYm = await getPurchasesSumsByMonth(yms);

    const computed = computeChainWithSnapshots({ cashStart, monthRows: rows, purchasesByYm });

    res.json(computed);
  } catch (e) {
    console.error("finance/months GET error:", e);
    res.status(500).json({ error: "Failed to load months" });
  }
});

// ✅ Sync months from donas_purchases (auto-create missing months)
router.post("/donas/finance/months/sync", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(`
      select
        min(to_char(date,'YYYY-MM')) as min_ym,
        max(to_char(date,'YYYY-MM')) as max_ym
      from donas_purchases
      where type in ('opex','capex')
    `);

    const minYm = r.rows?.[0]?.min_ym;
    const maxYm = r.rows?.[0]?.max_ym;

    if (!minYm || !maxYm) {
      return res.json({ ok: true, inserted: 0, message: "No purchases found" });
    }

    const months = [];
    const [minY, minM] = minYm.split("-").map((x) => Number(x));
    const [maxY, maxM] = maxYm.split("-").map((x) => Number(x));

    let y = minY;
    let m = minM;

    while (y < maxY || (y === maxY && m <= maxM)) {
      const mm = String(m).padStart(2, "0");
      months.push(`${y}-${mm}-01`);
      m += 1;
      if (m === 13) {
        m = 1;
        y += 1;
      }
    }

    const ins = await pool.query(
      `
      insert into donas_finance_months (slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes)
      select $1 as slug, x.month::date, 0,0,0,0,0,0,''
      from unnest($2::text[]) as x(month)
      on conflict (slug, month) do nothing
      returning month
      `,
      [SLUG, months]
    );

    return res.json({
      ok: true,
      inserted: ins.rows?.length || 0,
      range: { minYm, maxYm },
    });
  } catch (e) {
    console.error("finance/months sync error:", e);
    res.status(500).json({ error: "Failed to sync months" });
  }
});

// ✅ Proper unlock: remove #locked and clear snapshot fields (so month becomes auto again)
router.post("/donas/finance/months/:month/unlock", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const monthParam = req.params.month;
    const month = isoMonthStartFromYM(monthParam) || monthParam;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(month))) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM or YYYY-MM-01)" });
    }

    const prev = await pool.query(
      `select notes from donas_finance_months where slug=$1 and month=$2 limit 1`,
      [SLUG, month]
    );

    if (!prev.rows.length) {
      return res.status(404).json({ error: "Month not found" });
    }

    const prevNotes = String(prev.rows?.[0]?.notes || "");
    const cleaned = prevNotes
      .split(/\s+/)
      .filter((t) => t.toLowerCase() !== "#locked")
      .join(" ")
      .trim();

    const q = await pool.query(
      `
      update donas_finance_months
      set
        notes = $3,
        opex = 0,
        capex = 0,
        cash_end = 0
      where slug=$1 and month=$2
      returning *
      `,
      [SLUG, month, cleaned]
    );

    return res.json({ ok: true, month: q.rows[0] });
  } catch (e) {
    console.error("finance/month unlock error:", e);
    res.status(500).json({ error: "Failed to unlock month" });
  }
});

router.put("/donas/finance/months/:month", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const monthParam = req.params.month;
    const month = isoMonthStartFromYM(monthParam) || monthParam;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(month))) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM or YYYY-MM-01)" });
    }

    const b = req.body || {};
    const nextNotes = String(b.notes || "");

    // determine lock transition
    const prev = await pool.query(
      `select notes from donas_finance_months where slug=$1 and month=$2 limit 1`,
      [SLUG, month]
    );
    const prevNotes = String(prev.rows?.[0]?.notes || "");
    const wasLocked = isLockedNotes(prevNotes);
    const willBeLocked = isLockedNotes(nextNotes);

    const payload = {
      slug: SLUG,
      month,
      revenue: toNum(b.revenue),
      cogs: toNum(b.cogs),
      loan_paid: toNum(b.loan_paid),
      // default for unlocked: do not store derived fields
      opex: 0,
      capex: 0,
      cash_end: 0,
      notes: nextNotes,
    };

    // If month is locked and stays locked: allow manual snapshot edits
    if (wasLocked && willBeLocked) {
      payload.opex = toNum(b.opex);
      payload.capex = toNum(b.capex);
      payload.cash_end = toNum(b.cash_end);
    }

    // If transition to locked now: create snapshot (opex/capex from purchases + computed cash_end)
    if (!wasLocked && willBeLocked) {
      const all = await pool.query(
        `
        select
          slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes
        from donas_finance_months
        where slug=$1
        order by month asc
        `,
        [SLUG]
      );

      const list = (all.rows || []).map((r) => {
        const mIso = normalizeMonthISO(r.month);
        const ym = ymFromDateLike(mIso);
        const notes = String(r.notes || "");
        return {
          ...r,
          month: mIso,
          revenue: toNum(r.revenue),
          cogs: toNum(r.cogs),
          opex: toNum(r.opex),
          capex: toNum(r.capex),
          loan_paid: toNum(r.loan_paid),
          cash_end: toNum(r.cash_end),
          notes,
          _locked: isLockedNotes(notes),
          _ym: ym,
        };
      });

      // inject current edited month row into list with locked=true
      const monthIso = normalizeMonthISO(month);
      const ym = ymFromDateLike(monthIso);

      const injected = {
        slug: SLUG,
        month: monthIso,
        revenue: payload.revenue,
        cogs: payload.cogs,
        opex: 0,
        capex: 0,
        loan_paid: payload.loan_paid,
        cash_end: 0,
        notes: nextNotes,
        _locked: true,
        _ym: ym,
      };

      const idx = list.findIndex((r) => normalizeMonthISO(r.month) === monthIso);
      if (idx >= 0) list[idx] = { ...list[idx], ...injected };
      else list.push(injected);

      // compute chain with purchases + existing snapshots
      const s = await pool.query(
        `select cash_start from donas_finance_settings where slug=$1 limit 1`,
        [SLUG]
      );
      const cashStart = toNum(s.rows?.[0]?.cash_start);

      const sorted = list
        .filter((r) => ymFromDateLike(r.month))
        .sort((a, b) => String(a.month || "").localeCompare(String(b.month || "")));

      const purchasesByYm = await getPurchasesSumsByMonth(sorted.map((r) => r._ym));
      const computed = computeChainWithSnapshots({ cashStart, monthRows: sorted, purchasesByYm });

      const snap = computed.find((r) => normalizeMonthISO(r.month) === monthIso);

      payload.opex = toNum(snap?.opex);
      payload.capex = toNum(snap?.capex);
      payload.cash_end = toNum(snap?.cash_end);
    }

    const q = await pool.query(
      `
      insert into donas_finance_months (
        slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes
      ) values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9
      )
      on conflict (slug, month) do update set
        revenue = excluded.revenue,
        cogs = excluded.cogs,
        opex = excluded.opex,
        capex = excluded.capex,
        loan_paid = excluded.loan_paid,
        cash_end = excluded.cash_end,
        notes = excluded.notes
      returning *
      `,
      [
        payload.slug,
        payload.month,
        payload.revenue,
        payload.cogs,
        payload.opex,
        payload.capex,
        payload.loan_paid,
        payload.cash_end,
        payload.notes,
      ]
    );

    res.json(q.rows[0]);
  } catch (e) {
    console.error("finance/month PUT error:", e);
    res.status(500).json({ error: "Failed to save month" });
  }
});

module.exports = router;
