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

    const normalized = rows.map((r) => ({
      ...r,
      revenue: toNum(r.revenue),
      cogs: toNum(r.cogs),
      opex: toNum(r.opex),
      capex: toNum(r.capex),
      loan_paid: toNum(r.loan_paid),
      cash_end: toNum(r.cash_end),
      notes: r.notes || "",
      _source: { opex_source: "ops", mixed: false },
    }));

    let cash = cashStart;

    const out = normalized.map((r) => {
      const locked = isLockedNotes(r.notes);

      const revenue = toNum(r.revenue);
      const cogs = toNum(r.cogs);
      const opex = toNum(r.opex);
      const capex = toNum(r.capex);
      const loan_paid = toNum(r.loan_paid);

      const gp = revenue - cogs;
      const netOp = gp - opex;
      const cf = netOp - loan_paid - capex;

      if (locked) {
        cash = toNum(r.cash_end);
        return { ...r, cash_end: cash, _calc: { gp, netOp, cf } };
      }

      cash = cash + cf;
      return { ...r, cash_end: cash, _calc: { gp, netOp, cf } };
    });

    res.json(out);
  } catch (e) {
    console.error("finance/months GET error:", e);
    res.status(500).json({ error: "Failed to load months" });
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

    const payload = {
      slug: SLUG,
      month,
      revenue: toNum(b.revenue),
      cogs: toNum(b.cogs),
      opex: toNum(b.opex),
      capex: toNum(b.capex),
      loan_paid: toNum(b.loan_paid),
      cash_end: toNum(b.cash_end),
      notes: String(b.notes || ""),
    };

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
