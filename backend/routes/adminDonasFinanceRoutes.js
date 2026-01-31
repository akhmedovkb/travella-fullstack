// backend/routes/adminDonasFinanceRoutes.js

const express = require("express");
const pool = require("../db");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const router = express.Router();

const SLUG = "donas-dosas";

function isLockedNotes(notes) {
  return String(notes || "").toLowerCase().includes("#locked");
}

function ymFromDateLike(x) {
  const s = String(x || "");
  if (!s) return null;
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  return null;
}

function isoMonthStartFromYM(ym) {
  const m = ymFromDateLike(ym);
  if (!m) return null;
  return `${m}-01`;
}

function normalizeMonthISO(d) {
  const s = String(d || "");
  if (!s) return "";
  return s.slice(0, 10);
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function cleanLockedTag(notes) {
  const prev = String(notes || "");
  return prev
    .split(/\s+/)
    .filter((t) => t && t.toLowerCase() !== "#locked")
    .join(" ")
    .trim();
}

function ensureLockedTag(notes) {
  const prev = String(notes || "").trim();
  if (!prev) return "#locked";
  if (isLockedNotes(prev)) return prev;
  return `${prev} #locked`.trim();
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

    const opexEff = locked ? toNum(r.opex) : toNum(purchases.opex);
    const capexEff = locked ? toNum(r.capex) : toNum(purchases.capex);

    const gp = revenue - cogs;
    const netOp = gp - opexEff;
    const cf = netOp - loan_paid - capexEff;

    const snapshot = {
      opex: toNum(r.opex),
      capex: toNum(r.capex),
      cash_end: toNum(r.cash_end),
      notes: String(r.notes || ""),
    };

    const purchasesBlock = {
      opex: toNum(purchases.opex),
      capex: toNum(purchases.capex),
    };

    if (locked) {
      cash = toNum(r.cash_end);
      return {
        ...r,
        opex: opexEff,
        capex: capexEff,
        cash_end: cash,
        _calc: { gp, netOp, cf },
        _source: { opex: "snapshot", capex: "snapshot" },
        _snapshot: snapshot,
        _purchases: purchasesBlock,
      };
    }

    cash = cash + cf;
    return {
      ...r,
      opex: opexEff,
      capex: capexEff,
      cash_end: cash,
      _calc: { gp, netOp, cf },
      _source: { opex: "purchases", capex: "purchases" },
      _snapshot: snapshot,
      _purchases: purchasesBlock,
    };
  });
}

async function getCashStart() {
  const s = await pool.query(
    `select cash_start from donas_finance_settings where slug=$1 limit 1`,
    [SLUG]
  );
  return toNum(s.rows?.[0]?.cash_start);
}

async function loadMonthsRaw() {
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

  return rows;
}

async function upsertMonthRow(payload) {
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
  return q.rows[0];
}

async function snapshotMonthByISO(monthIso) {
  // monthIso: YYYY-MM-01 обязательно
  const rows = await loadMonthsRaw();
  const targetYM = ymFromDateLike(monthIso);

  const idx = rows.findIndex((r) => normalizeMonthISO(r.month) === monthIso);
  if (idx < 0) throw new Error("Month not found");

  const row = rows[idx];
  const lockedNotes = ensureLockedTag(row.notes);

  // purchases for all months (чтобы посчитать autos + UI blocks)
  const cashStart = await getCashStart();
  const purchasesByYmAll = await getPurchasesSumsByMonth(rows.map((r) => r._ym).filter(Boolean));

  // purchases for target
  const pur = purchasesByYmAll?.[targetYM] || { opex: 0, capex: 0 };

  // inject snapshot fields for target, cash_end temporary 0
  rows[idx] = {
    ...row,
    notes: lockedNotes,
    _locked: true,
    opex: toNum(pur.opex),
    capex: toNum(pur.capex),
    cash_end: 0,
  };

  const computed = computeChainWithSnapshots({
    cashStart,
    monthRows: rows,
    purchasesByYm: purchasesByYmAll,
  });

  const snap = computed.find((r) => normalizeMonthISO(r.month) === monthIso);
  if (!snap) throw new Error("Snapshot compute failed");

  // Persist: set opex/capex/cash_end and ensure notes include #locked
  const saved = await upsertMonthRow({
    slug: SLUG,
    month: monthIso,
    revenue: toNum(row.revenue),
    cogs: toNum(row.cogs),
    loan_paid: toNum(row.loan_paid),
    opex: toNum(pur.opex),
    capex: toNum(pur.capex),
    cash_end: toNum(snap.cash_end),
    notes: lockedNotes,
  });

  return saved;
}

/**
 * SETTINGS
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
 * POST /api/admin/donas/finance/months/:month/resnapshot
 * POST /api/admin/donas/finance/months/:month/lock
 */

router.get("/donas/finance/months", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const cashStart = await getCashStart();
    const rows = await loadMonthsRaw();

    const yms = rows.map((r) => r._ym).filter(Boolean);
    const purchasesByYm = await getPurchasesSumsByMonth(yms);

    const computed = computeChainWithSnapshots({ cashStart, monthRows: rows, purchasesByYm });
    res.json(computed);
  } catch (e) {
    console.error("finance/months GET error:", e);
    res.status(500).json({ error: "Failed to load months" });
  }
});

// Sync: auto-create missing months based on purchases min/max
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

// Unlock: remove #locked and clear snapshot fields
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

    const cleaned = cleanLockedTag(prev.rows?.[0]?.notes);

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

// Re-snapshot locked month: opex/capex from purchases + recompute cash_end chain
router.post("/donas/finance/months/:month/resnapshot", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const monthParam = req.params.month;
    const month = isoMonthStartFromYM(monthParam) || monthParam;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(month))) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM or YYYY-MM-01)" });
    }

    const cur = await pool.query(
      `select notes from donas_finance_months where slug=$1 and month=$2 limit 1`,
      [SLUG, month]
    );
    if (!cur.rows.length) return res.status(404).json({ error: "Month not found" });

    if (!isLockedNotes(cur.rows?.[0]?.notes)) {
      return res.status(400).json({ error: "Month is not locked (#locked missing). Lock it first." });
    }

    const saved = await snapshotMonthByISO(month);
    return res.json({ ok: true, month: saved });
  } catch (e) {
    console.error("finance/month resnapshot error:", e);
    res.status(500).json({ error: "Failed to resnapshot month" });
  }
});

// ✅ NEW: Lock month by button (auto snapshot immediately)
router.post("/donas/finance/months/:month/lock", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const monthParam = req.params.month;
    const month = isoMonthStartFromYM(monthParam) || monthParam;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(month))) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM or YYYY-MM-01)" });
    }

    // ensure month exists (if not — create)
    const cur = await pool.query(
      `
      select slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes
      from donas_finance_months
      where slug=$1 and month=$2
      limit 1
      `,
      [SLUG, month]
    );

    if (!cur.rows.length) {
      await upsertMonthRow({
        slug: SLUG,
        month,
        revenue: 0,
        cogs: 0,
        loan_paid: 0,
        opex: 0,
        capex: 0,
        cash_end: 0,
        notes: "#locked",
      });
    } else {
      const prevNotes = String(cur.rows?.[0]?.notes || "");
      const nextNotes = ensureLockedTag(prevNotes);
      if (nextNotes !== prevNotes) {
        await pool.query(
          `update donas_finance_months set notes=$3 where slug=$1 and month=$2`,
          [SLUG, month, nextNotes]
        );
      }
    }

    // snapshot now (opex/capex from purchases + chain cash_end)
    const saved = await snapshotMonthByISO(month);
    return res.json({ ok: true, month: saved });
  } catch (e) {
    console.error("finance/month lock error:", e);
    res.status(500).json({ error: "Failed to lock month" });
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

    const prev = await pool.query(
      `select notes from donas_finance_months where slug=$1 and month=$2 limit 1`,
      [SLUG, month]
    );
    const prevNotes = String(prev.rows?.[0]?.notes || "");
    const wasLocked = isLockedNotes(prevNotes);
    const willBeLocked = isLockedNotes(nextNotes);

    // base payload
    const payload = {
      slug: SLUG,
      month,
      revenue: toNum(b.revenue),
      cogs: toNum(b.cogs),
      loan_paid: toNum(b.loan_paid),
      notes: nextNotes,
      opex: 0,
      capex: 0,
      cash_end: 0,
    };

    // locked stays locked: allow manual edits (if you want)
    if (wasLocked && willBeLocked) {
      payload.opex = toNum(b.opex);
      payload.capex = toNum(b.capex);
      payload.cash_end = toNum(b.cash_end);
      const saved = await upsertMonthRow(payload);
      return res.json(saved);
    }

    // transition to locked: snapshot it automatically
    if (!wasLocked && willBeLocked) {
      // save revenue/cogs/loan first (so snapshotMonth can read it)
      await upsertMonthRow(payload);
      const saved = await snapshotMonthByISO(month);
      return res.json(saved);
    }

    // auto month: ignore opex/capex/cash_end in DB (will be computed)
    payload.opex = 0;
    payload.capex = 0;
    payload.cash_end = 0;

    const saved = await upsertMonthRow(payload);
    return res.json(saved);
  } catch (e) {
    console.error("finance/month PUT error:", e);
    res.status(500).json({ error: "Failed to save month" });
  }
});

module.exports = router;
