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

function monthStartISOFromYM(ym) {
  const m = ymFromDateLike(ym);
  if (!m) return null;
  return `${m}-01`;
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
  // monthRows: sorted asc, each item already normalized and contains _locked
  let cash = toNum(cashStart);

  return (monthRows || []).map((r) => {
    const ym = ymFromDateLike(r.month);
    const locked = Boolean(r._locked);

    const revenue = toNum(r.revenue);
    const cogs = toNum(r.cogs);
    const loan_paid = toNum(r.loan_paid);

    const purchases = purchasesByYm?.[ym] || { opex: 0, capex: 0 };
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
        _source: { opex_source: "snapshot", capex_source: "snapshot", mixed: false },
      };
    }

    cash = cash + cf;
    return {
      ...r,
      opex,
      capex,
      cash_end: cash,
      _calc: { gp, netOp, cf },
      _source: { opex_source: "purchases", capex_source: "purchases", mixed: false },
    };
  });
}

/**
 * SETTINGS
 * GET  /api/admin/donas/finance/settings
 * PUT  /api/admin/donas/finance/settings
 *
 * Важно: этот роут подключён в backend/index.js как:
 *   app.use('/api/admin', adminDonasFinanceRoutes)
 * поэтому здесь держим полный префикс /donas/finance/*
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

    const rows = q.rows || [];

    const normalized = rows
      .map((r) => {
        const ym = ymFromDateLike(r.month);
        const month = monthStartISOFromYM(ym) || r.month;
        const notes = r.notes || "";
        return {
          ...r,
          month,
          revenue: toNum(r.revenue),
          cogs: t
