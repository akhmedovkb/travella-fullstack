// backend/routes/adminDonasFinanceRoutes.js

const express = require("express");
const pool = require("../db");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const router = express.Router();
const SLUG = "donas-dosas";

/**
 * =========================
 * Audit (DB + helpers)
 * =========================
 */

function getActor(req) {
  const u = req.user || {};
  return {
    id: u.id ?? null,
    role: String(u.role || "").toLowerCase() || null,
    email: u.email || u.mail || null,
    name: u.name || u.full_name || null,
  };
}

async function ensureAuditTable(client = pool) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS donas_finance_months_audit (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL,
      month DATE,
      action TEXT NOT NULL,
      actor_id BIGINT,
      actor_role TEXT,
      actor_email TEXT,
      actor_name TEXT,
      meta JSONB,
      prev JSONB,
      next JSONB,
      diff JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_donas_fin_audit_slug_month_time
    ON donas_finance_months_audit(slug, month, created_at DESC);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_donas_fin_audit_slug_time
    ON donas_finance_months_audit(slug, created_at DESC);
  `);
}

async function ensureCoreTables(client = pool) {
  // Settings (Months relies on cash_start and slug row existence)
  await client.query(`
    CREATE TABLE IF NOT EXISTS donas_finance_settings (
      slug TEXT PRIMARY KEY,
      currency TEXT NOT NULL DEFAULT 'UZS',
      avg_check NUMERIC NOT NULL DEFAULT 0,
      cogs_per_unit NUMERIC NOT NULL DEFAULT 0,
      units_per_day NUMERIC NOT NULL DEFAULT 0,
      days_per_month INTEGER NOT NULL DEFAULT 26,
      fixed_opex_month NUMERIC NOT NULL DEFAULT 0,
      variable_opex_month NUMERIC NOT NULL DEFAULT 0,
      loan_payment_month NUMERIC NOT NULL DEFAULT 0,
      cash_start NUMERIC NOT NULL DEFAULT 0,
      reserve_target_months INTEGER NOT NULL DEFAULT 6
    );
  `);

  // Months table (snapshots stored here: opex/capex/cash_end + #locked in notes)
  await client.query(`
    CREATE TABLE IF NOT EXISTS donas_finance_months (
      slug TEXT NOT NULL,
      month DATE NOT NULL,
      revenue NUMERIC NOT NULL DEFAULT 0,
      cogs NUMERIC NOT NULL DEFAULT 0,
      opex NUMERIC NOT NULL DEFAULT 0,
      capex NUMERIC NOT NULL DEFAULT 0,
      loan_paid NUMERIC NOT NULL DEFAULT 0,
      cash_end NUMERIC NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (slug, month)
    );
  `);

  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_donas_fin_months_slug_month ON donas_finance_months (slug, month);`
  );

  // Ensure at least one settings row exists for our slug
  await client.query(
    `INSERT INTO donas_finance_settings (slug) VALUES ($1) ON CONFLICT (slug) DO NOTHING`,
    [SLUG]
  );
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeMonthISO(d) {
  const s = String(d || "");
  if (!s) return "";
  return s.slice(0, 10);
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

function pickMonthRowForAudit(row) {
  if (!row) return null;
  const monthIso = normalizeMonthISO(row.month);
  return {
    slug: row.slug,
    month: monthIso,
    revenue: toNum(row.revenue),
    cogs: toNum(row.cogs),
    opex: toNum(row.opex),
    capex: toNum(row.capex),
    loan_paid: toNum(row.loan_paid),
    cash_end: toNum(row.cash_end),
    notes: String(row.notes || ""),
  };
}

function diffMonth(prev, next) {
  const p = prev || {};
  const n = next || {};
  const keys = ["revenue", "cogs", "opex", "capex", "loan_paid", "cash_end", "notes"];
  const d = {};
  for (const k of keys) {
    const pv = p[k];
    const nv = n[k];
    const same =
      typeof pv === "number" && typeof nv === "number"
        ? toNum(pv) === toNum(nv)
        : String(pv ?? "") === String(nv ?? "");
    if (!same) d[k] = { from: pv ?? null, to: nv ?? null };
  }
  return d;
}

async function writeAudit(client, req, { action, monthIso = null, meta = null, prev = null, next = null }) {
  await ensureAuditTable(client);
  const actor = getActor(req);
  const diff = diffMonth(prev, next);

  await client.query(
    `
    INSERT INTO donas_finance_months_audit
      (slug, month, action, actor_id, actor_role, actor_email, actor_name, meta, prev, next, diff)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb)
    `,
    [
      SLUG,
      monthIso ? normalizeMonthISO(monthIso) : null,
      String(action),
      actor.id,
      actor.role,
      actor.email,
      actor.name,
      meta ? JSON.stringify(meta) : null,
      prev ? JSON.stringify(prev) : null,
      next ? JSON.stringify(next) : null,
      JSON.stringify(diff || {}),
    ]
  );
}

/**
 * =========================
 * Core helpers
 * =========================
 */

function isLockedNotes(notes) {
  return String(notes || "").toLowerCase().includes("#locked");
}

function ensureLockedTag(notes) {
  const s = String(notes || "").trim();
  if (!s) return "#locked";
  if (isLockedNotes(s)) return s;
  return `${s} #locked`.trim();
}

function removeLockedTag(notes) {
  const prev = String(notes || "");
  return prev
    .split(/\s+/)
    .filter((t) => t && t.toLowerCase() !== "#locked")
    .join(" ")
    .trim();
}

async function getCashStart(client = pool) {
  await ensureCoreTables(client);
  const s = await client.query(
    `select cash_start from donas_finance_settings where slug=$1 limit 1`,
    [SLUG]
  );
  return toNum(s.rows?.[0]?.cash_start);
}


async function loadMonthsRaw(client = pool) {
  await ensureCoreTables(client);
  const q = await client.query(
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

  return (q.rows || []).map((r) => {
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
      _ym: ym,
      _locked: isLockedNotes(notes),
    };
  });
}

async function upsertMonthRow(client, payload) {
  const q = await client.query(
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

async function ensureMonthExists(client, monthIso) {
  await client.query(
    `
    insert into donas_finance_months (slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes)
    values ($1, $2, 0,0,0,0,0,0,'')
    on conflict (slug, month) do nothing
    `,
    [SLUG, monthIso]
  );
}

async function ensureMonthsRange(client, fromYm, toYm) {
  const f = ymFromDateLike(fromYm);
  const t = ymFromDateLike(toYm);
  if (!f || !t) return;

  const [fy, fm] = f.split("-").map(Number);
  const [ty, tm] = t.split("-").map(Number);

  let y = fy;
  let m = fm;

  while (y < ty || (y === ty && m <= tm)) {
    const mm = String(m).padStart(2, "0");
    const monthIso = `${y}-${mm}-01`;
    // eslint-disable-next-line no-await-in-loop
    await ensureMonthExists(client, monthIso);

    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
}

async function getPurchasesSumsByMonth(client, ymList) {
  const months = (Array.isArray(ymList) ? ymList : [])
    .map((x) => ymFromDateLike(x))
    .filter(Boolean);

  if (!months.length) return {};

  const q = await client.query(
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

/**
 * =========================
 * Adjustments (one-off cashflow deltas)
 * =========================
 * amount: positive adds cash, negative reduces cash
 * запрещаем создавать/редактировать/удалять для locked месяца
 */

async function ensureAdjustmentsTable(client = pool) {
  // Adjustments are manual cashflow corrections (in/out) that are applied on top of Months.
  // IMPORTANT: amount is always non-negative; direction is controlled by `kind` = 'in' | 'out'.
  await client.query(`
    CREATE TABLE IF NOT EXISTS donas_finance_adjustments (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL,
      month DATE NOT NULL,
      kind TEXT NOT NULL DEFAULT 'in',
      amount NUMERIC NOT NULL DEFAULT 0,
      title TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Backward-compatible migrations (if table existed in older shape)
  await client.query(`ALTER TABLE donas_finance_adjustments ADD COLUMN IF NOT EXISTS kind TEXT;`);
  await client.query(`ALTER TABLE donas_finance_adjustments ADD COLUMN IF NOT EXISTS notes TEXT;`);

  // Fill missing values (for old rows)
  await client.query(`UPDATE donas_finance_adjustments SET kind = COALESCE(kind, 'in');`);
  await client.query(`UPDATE donas_finance_adjustments SET notes = COALESCE(notes, '');`);

  // Add constraints in an idempotent way (Postgres doesn't support IF NOT EXISTS for ADD CONSTRAINT)
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_donas_fin_adj_kind') THEN
        ALTER TABLE donas_finance_adjustments
          ADD CONSTRAINT chk_donas_fin_adj_kind CHECK (kind IN ('in','out'));
      END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_donas_fin_adj_amount_nonneg') THEN
        ALTER TABLE donas_finance_adjustments
          ADD CONSTRAINT chk_donas_fin_adj_amount_nonneg CHECK (amount >= 0);
      END IF;
    END $$;
  `);

  await client.query(`CREATE INDEX IF NOT EXISTS idx_donas_fin_adj_slug_month ON donas_finance_adjustments (slug, month);`);
}

async function getAdjustmentsSumsByMonth(client, ymList) {
  await ensureAdjustmentsTable(client);

  const months = (Array.isArray(ymList) ? ymList : [])
    .map((x) => ymFromDateLike(x))
    .filter(Boolean);

  if (!months.length) return {};

  const q = await client.query(
    `
    select
      to_char(month,'YYYY-MM') as ym,
      coalesce(sum(case when kind='in' then amount else -amount end),0) as total
    from donas_finance_adjustments
    where slug=$1 and to_char(month,'YYYY-MM') = any($2)
    group by 1
    `,
    [SLUG, months]
  );

  const out = {};
  for (const r of q.rows || []) {
    const ym = ymFromDateLike(r.ym);
    if (!ym) continue;
    out[ym] = toNum(r.total);
  }
  return out;
}

async function assertMonthNotLocked(client, slug, monthIso) {
  const q = await client.query(
    `select notes from donas_finance_months where slug=$1 and month=$2 limit 1`,
    [SLUG, monthIso]
  );
  const notes = String(q.rows?.[0]?.notes || "");
  if (isLockedNotes(notes)) {
    const err = new Error("Locked month is read-only. Adjustments are forbidden in locked months.");
    err.statusCode = 409;
    throw err;
  }
}

function computeChainWithSnapshots({ cashStart, monthRows, purchasesByYm, adjustmentsByYm }) {
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

    const adj = toNum(adjustmentsByYm?.[ym] ?? 0);

    const gp = revenue - cogs;
    const netOp = gp - opexEff;
    const cf = netOp - loan_paid - capexEff + adj;

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

      const adjustmentsBlock = { total: adj };

    if (locked) {
      cash = toNum(r.cash_end);
      return {
        ...r,
        opex: opexEff,
        capex: capexEff,
        cash_end: cash,
          _calc: { gp, netOp, adj, cf },
        _source: { opex: "snapshot", capex: "snapshot" },
        _snapshot: snapshot,
        _purchases: purchasesBlock,
          _adjustments: adjustmentsBlock,
      };
    }

    cash = cash + cf;
    return {
      ...r,
      opex: opexEff,
      capex: capexEff,
      cash_end: cash,
        _calc: { gp, netOp, adj, cf },
      _source: { opex: "purchases", capex: "purchases" },
      _snapshot: snapshot,
      _purchases: purchasesBlock,
        _adjustments: adjustmentsBlock,
    };
  });
}

async function snapshotMonthByISO(client, monthIso) {
  const rows = await loadMonthsRaw(client);
  const targetYm = ymFromDateLike(monthIso);

  const idx = rows.findIndex((r) => normalizeMonthISO(r.month) === monthIso);
  if (idx < 0) throw new Error("Month not found");

  const cashStart = await getCashStart(client);
  const purchasesByYmAll = await getPurchasesSumsByMonth(
    client,
    rows.map((r) => r._ym).filter(Boolean)
  );

  const adjustmentsByYmAll = await getAdjustmentsSumsByMonth(
    client,
    rows.map((r) => r._ym).filter(Boolean)
  );

  const pur = purchasesByYmAll?.[targetYm] || { opex: 0, capex: 0 };

  rows[idx] = {
    ...rows[idx],
    _locked: true,
    notes: ensureLockedTag(rows[idx].notes),
    opex: toNum(pur.opex),
    capex: toNum(pur.capex),
    cash_end: 0,
  };

  const computed = computeChainWithSnapshots({
    cashStart,
    monthRows: rows,
    purchasesByYm: purchasesByYmAll,
    adjustmentsByYm: adjustmentsByYmAll,
  });

  const snap = computed.find((r) => normalizeMonthISO(r.month) === monthIso);
  if (!snap) throw new Error("Snapshot compute failed");

  const saved = await upsertMonthRow(client, {
    slug: SLUG,
    month: monthIso,
    revenue: toNum(rows[idx].revenue),
    cogs: toNum(rows[idx].cogs),
    loan_paid: toNum(rows[idx].loan_paid),
    opex: toNum(pur.opex),
    capex: toNum(pur.capex),
    cash_end: toNum(snap.cash_end),
    notes: ensureLockedTag(rows[idx].notes),
  });

  return saved;
}

async function snapshotUpToISO(client, targetMonthIso) {
  const targetYm = ymFromDateLike(targetMonthIso);
  if (!targetYm) throw new Error("Bad month");

  const minMonthDb = await client.query(
    `select min(to_char(month,'YYYY-MM')) as min_ym from donas_finance_months where slug=$1`,
    [SLUG]
  );
  const minYmDb = minMonthDb.rows?.[0]?.min_ym || null;

  const minMonthPurch = await client.query(`
    select min(to_char(date,'YYYY-MM')) as min_ym
    from donas_purchases
    where type in ('opex','capex')
  `);
  const minYmPurch = minMonthPurch.rows?.[0]?.min_ym || null;

  const fromYm = ymFromDateLike(minYmDb || minYmPurch || targetYm) || targetYm;
  await ensureMonthsRange(client, fromYm, targetYm);

  const rows = await loadMonthsRaw(client);

  const cashStart = await getCashStart(client);
  const purchasesByYmAll = await getPurchasesSumsByMonth(
    client,
    rows.map((r) => r._ym).filter(Boolean)
  );

  const adjustmentsByYmAll = await getAdjustmentsSumsByMonth(
    client,
    rows.map((r) => r._ym).filter(Boolean)
  );

  const work = rows.map((r) => {
    const ym = r._ym;
    const shouldLock = ym && ym <= targetYm;
    if (!shouldLock) return r;

    const pur = purchasesByYmAll?.[ym] || { opex: 0, capex: 0 };
    return {
      ...r,
      _locked: true,
      notes: ensureLockedTag(r.notes),
      opex: toNum(pur.opex),
      capex: toNum(pur.capex),
      cash_end: 0,
    };
  });

  const computed = computeChainWithSnapshots({
    cashStart,
    monthRows: work,
    purchasesByYm: purchasesByYmAll,
    adjustmentsByYm: adjustmentsByYmAll,
  });

  let lockedCount = 0;
  for (const r of computed) {
    const ym = ymFromDateLike(r.month);
    const shouldLock = ym && ym <= targetYm;
    if (!shouldLock) continue;

    // eslint-disable-next-line no-await-in-loop
    await upsertMonthRow(client, {
      slug: SLUG,
      month: normalizeMonthISO(r.month),
      revenue: toNum(r.revenue),
      cogs: toNum(r.cogs),
      loan_paid: toNum(r.loan_paid),
      opex: toNum(r.opex),
      capex: toNum(r.capex),
      cash_end: toNum(r.cash_end),
      notes: ensureLockedTag(r.notes),
    });

    lockedCount += 1;
  }

  return { lockedCount };
}

async function resnapshotLockedUpToISO(client, targetMonthIso) {
  const targetYm = ymFromDateLike(targetMonthIso);
  if (!targetYm) throw new Error("Bad month");

  const rows = await loadMonthsRaw(client);
  const cashStart = await getCashStart(client);

  const yms = rows.map((r) => r._ym).filter(Boolean);
  const purchasesByYmAll = await getPurchasesSumsByMonth(client, yms);

  const adjustmentsByYmAll = await getAdjustmentsSumsByMonth(client, yms);

  const work = rows.map((r) => {
    const ym = r._ym;
    const shouldResnap = Boolean(r._locked && ym && ym <= targetYm);
    if (!shouldResnap) return r;

    const pur = purchasesByYmAll?.[ym] || { opex: 0, capex: 0 };
    return {
      ...r,
      _locked: true,
      notes: ensureLockedTag(r.notes),
      opex: toNum(pur.opex),
      capex: toNum(pur.capex),
      cash_end: 0,
    };
  });

  const computed = computeChainWithSnapshots({
    cashStart,
    monthRows: work,
    purchasesByYm: purchasesByYmAll,
    adjustmentsByYm: adjustmentsByYmAll,
  });

  let updatedCount = 0;

  for (const r of computed) {
    const ym = ymFromDateLike(r.month);
    const shouldUpdate = Boolean(r._locked && ym && ym <= targetYm);
    if (!shouldUpdate) continue;

    // eslint-disable-next-line no-await-in-loop
    await upsertMonthRow(client, {
      slug: SLUG,
      month: normalizeMonthISO(r.month),
      revenue: toNum(r.revenue),
      cogs: toNum(r.cogs),
      loan_paid: toNum(r.loan_paid),
      opex: toNum(r.opex),
      capex: toNum(r.capex),
      cash_end: toNum(r.cash_end),
      notes: ensureLockedTag(r.notes),
    });

    updatedCount += 1;
  }

  return { updatedCount };
}

/**
 * =========================
 * CSV helpers (export)
 * =========================
 */

function csvEscape(v) {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(arr) {
  return `${arr.map(csvEscape).join(",")}\n`;
}

/**
 * =========================
 * SETTINGS
 * =========================
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
      insert into donas_finance_settings
        (slug, currency, avg_check, cogs_per_unit, units_per_day, days_per_month,
         fixed_opex_month, variable_opex_month, loan_payment_month, cash_start, reserve_target_months)
      values
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
 * =========================
 * MONTHS (server cashflow + auto/snapshot)
 * =========================
 */

router.get("/donas/finance/months", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const cashStart = await getCashStart(pool);
    const rows = await loadMonthsRaw(pool);

    const yms = rows.map((r) => r._ym).filter(Boolean);
    const purchasesByYm = await getPurchasesSumsByMonth(pool, yms);

    const adjustmentsByYm = await getAdjustmentsSumsByMonth(pool, yms);

    const computed = computeChainWithSnapshots({
      cashStart,
      monthRows: rows,
      purchasesByYm,
      adjustmentsByYm,
    });

    const out = computed.map((r) => {
      const ym = ymFromDateLike(r.month);
      const pur = purchasesByYm?.[ym] || { opex: 0, capex: 0 };
      const snap = { opex: toNum(r._snapshot?.opex), capex: toNum(r._snapshot?.capex) };
      const adj = toNum(adjustmentsByYm?.[ym] ?? 0);
      return {
        ...r,
        _adj_total: adj,
        _diff: {
          opex: toNum(pur.opex) - toNum(snap.opex),
          capex: toNum(pur.capex) - toNum(snap.capex),
        },
      };
    });

    res.json(out);
  } catch (e) {
    console.error("finance/months GET error:", e);
    res.status(500).json({ error: "Failed to load months" });
  }
});

/**
 * =========================
 * EXPORT: Months CSV
 * =========================
 */

router.get("/donas/finance/months/export.csv", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const fromYm = ymFromDateLike(req.query.from || "");
    const toYm = ymFromDateLike(req.query.to || "");

    const cashStart = await getCashStart(pool);
    const rows = await loadMonthsRaw(pool);

    const yms = rows.map((r) => r._ym).filter(Boolean);
    const purchasesByYm = await getPurchasesSumsByMonth(pool, yms);
    const adjustmentsByYm = await getAdjustmentsSumsByMonth(pool, yms);
    
    const computed = computeChainWithSnapshots({
      cashStart,
      monthRows: rows,
      purchasesByYm,
      adjustmentsByYm,
    });

    const filtered = computed.filter((r) => {
      const ym = ymFromDateLike(r.month);
      if (!ym) return false;
      if (fromYm && ym < fromYm) return false;
      if (toYm && ym > toYm) return false;
      return true;
    });

    const filename = `donas_finance_months_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    res.write(
      csvRow([
        "ym",
        "locked",
        "revenue",
        "cogs",
        "opex",
        "capex",
        "loan_paid",
        "cash_end",
        "gp",
        "netOp",
        "cf",
        "source_opex",
        "source_capex",
        "purchases_opex",
        "purchases_capex",
        "snapshot_opex",
        "snapshot_capex",
        "diff_opex",
        "diff_capex",
        "notes",
      ])
    );

    for (const r of filtered) {
      const ym = ymFromDateLike(r.month);
      const pur = purchasesByYm?.[ym] || { opex: 0, capex: 0 };
      const snapOpex = toNum(r._snapshot?.opex);
      const snapCapex = toNum(r._snapshot?.capex);

      const revenue = toNum(r.revenue);
      const cogs = toNum(r.cogs);
      const opex = toNum(r.opex);
      const capex = toNum(r.capex);
      const loan_paid = toNum(r.loan_paid);

      const gp = revenue - cogs;
      const netOp = gp - opex;
      const adj = toNum(adjustmentsByYm?.[ym] ?? 0);
      const cf = netOp - loan_paid - capex + adj;

      const diffOpex = toNum(pur.opex) - toNum(snapOpex);
      const diffCapex = toNum(pur.capex) - toNum(snapCapex);

      res.write(
        csvRow([
          ym,
          r._locked ? "1" : "0",
          revenue,
          cogs,
          opex,
          capex,
          loan_paid,
          toNum(r.cash_end),
          gp,
          netOp,
          cf,
          String(r._source?.opex || ""),
          String(r._source?.capex || ""),
          toNum(pur.opex),
          toNum(pur.capex),
          snapOpex,
          snapCapex,
          diffOpex,
          diffCapex,
          String(r.notes || ""),
        ])
      );
    }

    res.end();
  } catch (e) {
    console.error("finance/months export.csv error:", e);
    res.status(500).json({ error: "Failed to export months CSV" });
  }
});

/**
 * =========================
 * AUDIT API
 * =========================
 */

router.get("/audit", authenticateToken, requireAdmin, async (req, res) => {
  try {
    await ensureAuditTable(pool);

    const fromYm = ymFromDateLike(req.query.from || "");
    const toYm = ymFromDateLike(req.query.to || "");
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));

    let where = `where slug = $1`;
    const params = [SLUG];

    if (fromYm) {
      params.push(`${fromYm}-01`);
      where += ` and month >= $${params.length}`;
    }
    if (toYm) {
      params.push(`${toYm}-01`);
      where += ` and month <= $${params.length}`;
    }

    params.push(limit);

    const q = await pool.query(
      `
      select
        id,
        to_char(month,'YYYY-MM') as ym,
        action,
        actor_id,
        actor_role,
        actor_email,
        actor_name,
        meta,
        diff,
        prev,
        next,
        created_at
      from donas_finance_months_audit
      ${where}
      order by created_at desc
      limit $${params.length}
      `,
      params
    );

    return res.json({ ok: true, items: q.rows || [] });
  } catch (e) {
    console.error("finance/audit GET error:", e);
    return res.status(500).json({ error: "Failed to load audit" });
  }
});

router.get("/donas/finance/months/:month/audit", authenticateToken, requireAdmin, async (req, res) => {
  try {
    await ensureAuditTable(pool);

    const monthParam = req.params.month;
    const monthIso = isoMonthStartFromYM(monthParam) || monthParam;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(monthIso))) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM or YYYY-MM-01)" });
    }

    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));

    const q = await pool.query(
      `
      select
        id,
        to_char(month,'YYYY-MM') as ym,
        action,
        actor_id,
        actor_role,
        actor_email,
        actor_name,
        meta,
        diff,
        prev,
        next,
        created_at
      from donas_finance_months_audit
      where slug=$1 and month=$2
      order by created_at desc
      limit $3
      `,
      [SLUG, monthIso, limit]
    );

    return res.json({ ok: true, items: q.rows || [] });
  } catch (e) {
    console.error("finance/month audit GET error:", e);
    return res.status(500).json({ error: "Failed to load month audit" });
  }
});

/**
 * =========================
 * EXPORT: Audit CSV
 * =========================
 */

router.get("/donas/finance/audit/export.csv", authenticateToken, requireAdmin, async (req, res) => {
  try {
    await ensureAuditTable(pool);

    const fromYm = ymFromDateLike(req.query.from || "");
    const toYm = ymFromDateLike(req.query.to || "");
    const limit = Math.min(5000, Math.max(1, Number(req.query.limit || 500)));

    let where = `where slug = $1`;
    const params = [SLUG];

    if (fromYm) {
      params.push(`${fromYm}-01`);
      where += ` and month >= $${params.length}`;
    }
    if (toYm) {
      params.push(`${toYm}-01`);
      where += ` and month <= $${params.length}`;
    }

    params.push(limit);

    const q = await pool.query(
      `
      select
        id,
        to_char(month,'YYYY-MM') as ym,
        action,
        actor_id,
        actor_role,
        actor_email,
        actor_name,
        meta,
        diff,
        prev,
        next,
        created_at
      from donas_finance_months_audit
      ${where}
      order by created_at desc
      limit $${params.length}
      `,
      params
    );

    const filename = `donas_finance_audit_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    res.write(
      csvRow([
        "id",
        "created_at",
        "ym",
        "action",
        "actor_id",
        "actor_role",
        "actor_email",
        "actor_name",
        "diff_keys",
        "meta_json",
      ])
    );

    for (const r of q.rows || []) {
      const diffKeys = Object.keys(r.diff || {});
      res.write(
        csvRow([
          r.id,
          r.created_at,
          r.ym || "",
          r.action || "",
          r.actor_id ?? "",
          r.actor_role || "",
          r.actor_email || "",
          r.actor_name || "",
          diffKeys.join("|"),
          r.meta ? JSON.stringify(r.meta) : "",
        ])
      );
    }

    res.end();
  } catch (e) {
    console.error("finance/audit export.csv error:", e);
    res.status(500).json({ error: "Failed to export audit CSV" });
  }
});

router.get(
  "/donas/finance/months/:month/audit/export.csv",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      await ensureAuditTable(pool);

      const monthParam = req.params.month;
      const monthIso = isoMonthStartFromYM(monthParam) || monthParam;

      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(monthIso))) {
        return res.status(400).json({ error: "Bad month format (expected YYYY-MM or YYYY-MM-01)" });
      }

      const limit = Math.min(5000, Math.max(1, Number(req.query.limit || 500)));

      const q = await pool.query(
        `
        select
          id,
          to_char(month,'YYYY-MM') as ym,
          action,
          actor_id,
          actor_role,
          actor_email,
          actor_name,
          meta,
          diff,
          prev,
          next,
          created_at
        from donas_finance_months_audit
        where slug=$1 and month=$2
        order by created_at desc
        limit $3
        `,
        [SLUG, monthIso, limit]
      );

      const filename = `donas_finance_audit_${ymFromDateLike(monthIso)}_${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

      res.write(
        csvRow([
          "id",
          "created_at",
          "ym",
          "action",
          "actor_id",
          "actor_role",
          "actor_email",
          "actor_name",
          "diff_keys",
          "meta_json",
        ])
      );

      for (const r of q.rows || []) {
        const diffKeys = Object.keys(r.diff || {});
        res.write(
          csvRow([
            r.id,
            r.created_at,
            r.ym || "",
            r.action || "",
            r.actor_id ?? "",
            r.actor_role || "",
            r.actor_email || "",
            r.actor_name || "",
            diffKeys.join("|"),
            r.meta ? JSON.stringify(r.meta) : "",
          ])
        );
      }

      res.end();
    } catch (e) {
      console.error("finance/month audit export.csv error:", e);
      res.status(500).json({ error: "Failed to export month audit CSV" });
    }
  }
);

/**
 * =========================
 * PREVIEW: Lock / Lock ≤
 * =========================
 */

router.get("/donas/finance/months/:month/lock-preview", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const monthParam = req.params.month;
    const monthIso = isoMonthStartFromYM(monthParam) || monthParam;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(monthIso))) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM or YYYY-MM-01)" });
    }

    const scope = String(req.query.scope || "single").toLowerCase(); // single | upto
    const targetYm = ymFromDateLike(monthIso);

    await ensureMonthExists(pool, monthIso);

    const cashStart = await getCashStart(pool);
    const baseRows = await loadMonthsRaw(pool);

    const yms = baseRows.map((r) => r._ym).filter(Boolean);
    const purchasesByYm = await getPurchasesSumsByMonth(pool, yms);

    const adjustmentsByYm = await getAdjustmentsSumsByMonth(pool, yms);

    const currentComputed = computeChainWithSnapshots({
      cashStart,
      monthRows: baseRows,
      purchasesByYm,
      adjustmentsByYm,
    });

    const plannedRows = baseRows.map((r) => {
      const ym = r._ym;
      const alreadyLocked = Boolean(r._locked);

      const shouldAffect =
        scope === "upto"
          ? Boolean(ym && ym <= targetYm)
          : Boolean(ym && ym === targetYm);

      if (alreadyLocked) return r;

      if (shouldAffect) {
        const pur = purchasesByYm?.[ym] || { opex: 0, capex: 0 };
        return {
          ...r,
          _locked: true,
          notes: ensureLockedTag(r.notes),
          opex: toNum(pur.opex),
          capex: toNum(pur.capex),
          cash_end: 0,
        };
      }

      return r;
    });

    const plannedComputed = computeChainWithSnapshots({
      cashStart,
      monthRows: plannedRows,
      purchasesByYm,
      adjustmentsByYm,
    });

    const byYmCurrent = {};
    const byYmPlanned = {};
    for (const r of currentComputed) {
      const ym = ymFromDateLike(r.month);
      if (ym) byYmCurrent[ym] = r;
    }
    for (const r of plannedComputed) {
      const ym = ymFromDateLike(r.month);
      if (ym) byYmPlanned[ym] = r;
    }

    const affectedYms = currentComputed
      .map((r) => ymFromDateLike(r.month))
      .filter(Boolean)
      .filter((ym) => (scope === "upto" ? ym <= targetYm : ym === targetYm));

    const items = affectedYms.map((ym) => {
      const cur = byYmCurrent[ym];
      const plan = byYmPlanned[ym];
      const pur = purchasesByYm?.[ym] || { opex: 0, capex: 0 };
      const adj = toNum(adjustmentsByYm?.[ym] ?? 0);

      const snapOpex = toNum(cur?._snapshot?.opex);
      const snapCapex = toNum(cur?._snapshot?.capex);

      return {
        ym,
        current: {
          locked: Boolean(cur?._locked),
          cash_end: toNum(cur?.cash_end),
          opex: toNum(cur?.opex),
          capex: toNum(cur?.capex),
          notes: String(cur?.notes || ""),
        },
        planned: {
          locked: Boolean(plan?._locked),
          cash_end: toNum(plan?.cash_end),
          opex: toNum(plan?.opex),
          capex: toNum(plan?.capex),
          notes: String(plan?.notes || ""),
        },
        purchases: {
          opex: toNum(pur.opex),
          capex: toNum(pur.capex),
        },
        adjustments: {
          total: adj,
        },
        snapshot: {
          opex: snapOpex,
          capex: snapCapex,
          cash_end: toNum(cur?._snapshot?.cash_end),
          notes: String(cur?._snapshot?.notes || ""),
        },
        diff: {
          opex: toNum(pur.opex) - toNum(snapOpex),
          capex: toNum(pur.capex) - toNum(snapCapex),
        },
      };
    });

    const curTarget = byYmCurrent[targetYm] || null;
    const planTarget = byYmPlanned[targetYm] || null;

    return res.json({
      ok: true,
      scope,
      targetYm,
      summary: {
        targetWasLocked: Boolean(curTarget?._locked),
        currentCashEndAtTarget: toNum(curTarget?.cash_end),
        plannedCashEndAtTarget: toNum(planTarget?.cash_end),
        deltaCashEndAtTarget: toNum(planTarget?.cash_end) - toNum(curTarget?.cash_end),
      },
      items,
    });
  } catch (e) {
    console.error("finance/month lock-preview error:", e);
    res.status(500).json({ error: "Failed to build lock preview" });
  }
});

/**
 * =========================
 * PREVIEW: Bulk Re-snapshot ≤ (locked only)
 * =========================
 */

router.get(
  "/donas/finance/months/:month/resnapshot-up-to-preview",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const monthParam = req.params.month;
      const monthIso = isoMonthStartFromYM(monthParam) || monthParam;

      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(monthIso))) {
        return res.status(400).json({ error: "Bad month format (expected YYYY-MM or YYYY-MM-01)" });
      }

      const targetYm = ymFromDateLike(monthIso);
      await ensureMonthExists(pool, monthIso);

      const cashStart = await getCashStart(pool);
      const baseRows = await loadMonthsRaw(pool);

      const yms = baseRows.map((r) => r._ym).filter(Boolean);
      const purchasesByYm = await getPurchasesSumsByMonth(pool, yms);

      const adjustmentsByYm = await getAdjustmentsSumsByMonth(pool, yms);

      const currentComputed = computeChainWithSnapshots({
        cashStart,
        monthRows: baseRows,
        purchasesByYm,
        adjustmentsByYm,
      });

      const plannedRows = baseRows.map((r) => {
        const ym = r._ym;
        const shouldResnap = Boolean(r._locked && ym && ym <= targetYm);
        if (!shouldResnap) return r;

        const pur = purchasesByYm?.[ym] || { opex: 0, capex: 0 };
        return {
          ...r,
          _locked: true,
          notes: ensureLockedTag(r.notes),
          opex: toNum(pur.opex),
          capex: toNum(pur.capex),
          cash_end: 0,
        };
      });

      const plannedComputed = computeChainWithSnapshots({
        cashStart,
        monthRows: plannedRows,
        purchasesByYm,
        adjustmentsByYm,
      });

      const byYmCurrent = {};
      const byYmPlanned = {};
      for (const r of currentComputed) {
        const ym = ymFromDateLike(r.month);
        if (ym) byYmCurrent[ym] = r;
      }
      for (const r of plannedComputed) {
        const ym = ymFromDateLike(r.month);
        if (ym) byYmPlanned[ym] = r;
      }

      const affectedLockedYms = currentComputed
        .map((r) => ymFromDateLike(r.month))
        .filter(Boolean)
        .filter((ym) => ym <= targetYm)
        .filter((ym) => Boolean(byYmCurrent[ym]?._locked));

      const items = affectedLockedYms.map((ym) => {
        const cur = byYmCurrent[ym];
        const plan = byYmPlanned[ym];
        const pur = purchasesByYm?.[ym] || { opex: 0, capex: 0 };
        const adj = toNum(adjustmentsByYm?.[ym] ?? 0);

        const curSnapOpex = toNum(cur?._snapshot?.opex);
        const curSnapCapex = toNum(cur?._snapshot?.capex);

        return {
          ym,
          purchases: { opex: toNum(pur.opex), capex: toNum(pur.capex) },
          adjustments: { total: adj },
          snapshot_before: {
            opex: curSnapOpex,
            capex: curSnapCapex,
            cash_end: toNum(cur?.cash_end),
          },
          snapshot_after: {
            opex: toNum(plan?.opex),
            capex: toNum(plan?.capex),
            cash_end: toNum(plan?.cash_end),
          },
          diff_before: {
            opex: toNum(pur.opex) - toNum(curSnapOpex),
            capex: toNum(pur.capex) - toNum(curSnapCapex),
          },
          diff_after: {
            opex: toNum(pur.opex) - toNum(plan?.opex),
            capex: toNum(pur.capex) - toNum(plan?.capex),
          },
          delta_cash_end: toNum(plan?.cash_end) - toNum(cur?.cash_end),
        };
      });

      const curTarget = byYmCurrent[targetYm] || null;
      const planTarget = byYmPlanned[targetYm] || null;

      return res.json({
        ok: true,
        targetYm,
        summary: {
          affectedLockedCount: affectedLockedYms.length,
          currentCashEndAtTarget: toNum(curTarget?.cash_end),
          plannedCashEndAtTarget: toNum(planTarget?.cash_end),
          deltaCashEndAtTarget: toNum(planTarget?.cash_end) - toNum(curTarget?.cash_end),
        },
        items,
      });
    } catch (e) {
      console.error("finance/resnapshot-up-to-preview error:", e);
      return res.status(500).json({ error: "Failed to build resnapshot preview" });
    }
  }
);

/**
 * =========================
 * Actions: sync / lock / unlock / resnapshot / bulk
 * =========================
 */

router.post("/months/sync", authenticateToken, requireAdmin, async (req, res) => {
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

    await ensureMonthsRange(pool, minYm, maxYm);

    await writeAudit(pool, req, {
      action: "months_sync",
      meta: { range: { minYm, maxYm } },
    });

    return res.json({
      ok: true,
      inserted: 0,
      range: { minYm, maxYm },
    });
  } catch (e) {
    console.error("finance/months sync error:", e);
    res.status(500).json({ error: "Failed to sync months" });
  }
});

router.post("/donas/finance/months/:month/lock", authenticateToken, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const monthParam = req.params.month;
    const monthIso = isoMonthStartFromYM(monthParam) || monthParam;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(monthIso))) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM or YYYY-MM-01)" });
    }

    await client.query("begin");
    await ensureMonthExists(client, monthIso);

    const prevQ = await client.query(
      `select * from donas_finance_months where slug=$1 and month=$2 limit 1`,
      [SLUG, monthIso]
    );
    const prevRow = pickMonthRowForAudit(prevQ.rows?.[0]);

    const saved = await snapshotMonthByISO(client, monthIso);
    const nextRow = pickMonthRowForAudit(saved);

    await writeAudit(client, req, {
      action: "lock",
      monthIso,
      meta: { scope: "single" },
      prev: prevRow,
      next: nextRow,
    });

    await client.query("commit");

    return res.json({ ok: true, month: saved });
  } catch (e) {
    try {
      await client.query("rollback");
    } catch {}
    console.error("finance/month lock error:", e);
    res.status(500).json({ error: "Failed to lock month" });
  } finally {
    client.release();
  }
});

router.post("/donas/finance/months/:month/lock-up-to", authenticateToken, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const monthParam = req.params.month;
    const monthIso = isoMonthStartFromYM(monthParam) || monthParam;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(monthIso))) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM or YYYY-MM-01)" });
    }

    await client.query("begin");
    const { lockedCount } = await snapshotUpToISO(client, monthIso);

    await writeAudit(client, req, {
      action: "lock_up_to",
      monthIso,
      meta: { target: ymFromDateLike(monthIso), lockedCount },
    });

    await client.query("commit");

    return res.json({ ok: true, lockedCount });
  } catch (e) {
    try {
      await client.query("rollback");
    } catch {}
    console.error("finance/month lock-up-to error:", e);
    res.status(500).json({ error: "Failed to lock months up to selected" });
  } finally {
    client.release();
  }
});

router.post("/donas/finance/months/:month/unlock", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const monthParam = req.params.month;
    const monthIso = isoMonthStartFromYM(monthParam) || monthParam;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(monthIso))) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM or YYYY-MM-01)" });
    }

    const prev = await pool.query(`select * from donas_finance_months where slug=$1 and month=$2 limit 1`, [
      SLUG,
      monthIso,
    ]);
    if (!prev.rows.length) return res.status(404).json({ error: "Month not found" });

    const cleaned = removeLockedTag(prev.rows?.[0]?.notes);

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
      [SLUG, monthIso, cleaned]
    );

    await writeAudit(pool, req, {
      action: "unlock",
      monthIso,
      prev: pickMonthRowForAudit(prev.rows?.[0]),
      next: pickMonthRowForAudit(q.rows?.[0]),
    });

    return res.json({ ok: true, month: q.rows[0] });
  } catch (e) {
    console.error("finance/month unlock error:", e);
    res.status(500).json({ error: "Failed to unlock month" });
  }
});

/**
 * =========================
 * ADJUSTMENTS API
 * =========================
 */

router.get(
  "/donas/finance/months/:month/adjustments",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const monthParam = req.params.month;
      const monthIso = isoMonthStartFromYM(monthParam) || monthParam;

      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(monthIso))) {
        return res.status(400).json({ error: "Bad month format (expected YYYY-MM or YYYY-MM-01)" });
      }

      await ensureAdjustmentsTable(pool);

      const q = await pool.query(
        `
        select id, to_char(month,'YYYY-MM') as ym, kind, amount, title, notes, created_at, updated_at
        from donas_finance_adjustments
        where slug=$1 and month=$2
        order by id desc
        `,
        [SLUG, monthIso]
      );

      return res.json({ ok: true, items: q.rows || [] });
    } catch (e) {
      console.error("finance/adjustments list error:", e);
      return res.status(500).json({ error: "Failed to load adjustments" });
    }
  }
);

router.post(
  "/donas/finance/months/:month/adjustments",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const client = await pool.connect();
    try {
      const monthParam = req.params.month;
      const monthIso = isoMonthStartFromYM(monthParam) || monthParam;

      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(monthIso))) {
        return res.status(400).json({ error: "Bad month format (expected YYYY-MM or YYYY-MM-01)" });
      }

      const b = req.body || {};
      const kind = String(b.kind || 'in').trim() || 'in';
      const amount = toNum(b.amount);
      const title = String(b.title || '').trim();
      const notes = String(b.notes || '').trim();

      if (!['in','out'].includes(kind)) return res.status(400).json({ error: 'Bad kind (expected in|out)' });
      if (amount < 0) return res.status(400).json({ error: 'Amount must be >= 0' });

      await client.query("begin");
      await ensureMonthExists(client, monthIso);
      await assertMonthNotLocked(client, SLUG, monthIso);
      await ensureAdjustmentsTable(client);

      const q = await client.query(
        `
        insert into donas_finance_adjustments (slug, month, kind, amount, title, notes)
        values ($1,$2,$3,$4,$5,$6)
        returning id, to_char(month,'YYYY-MM') as ym, kind, amount, title, notes, created_at, updated_at
        `,
        [SLUG, monthIso, kind, amount, title, notes]
      );

      await writeAudit(client, req, {
        action: "adjustment_create",
        monthIso,
        meta: { kind, amount, title, notes },
      });

      await client.query("commit");
      return res.json({ ok: true, item: q.rows?.[0] || null });
    } catch (e) {
      try {
        await client.query("rollback");
      } catch {}
      console.error("finance/adjustments create error:", e);
      return res.status(e.statusCode || 500).json({ error: e.message || "Failed to create adjustment" });
    } finally {
      client.release();
    }
  }
);

router.put(
  "/donas/finance/adjustments/:id",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const client = await pool.connect();
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Bad id" });

      const b = req.body || {};
      const kind = String(b.kind || '').trim();
      const amount = toNum(b.amount);
      const title = String(b.title || '').trim();
      const notes = String(b.notes || '').trim();

      if (kind && !['in','out'].includes(kind)) return res.status(400).json({ error: 'Bad kind (expected in|out)' });
      if (amount < 0) return res.status(400).json({ error: 'Amount must be >= 0' });

      await client.query("begin");
      await ensureAdjustmentsTable(client);

      const cur = await client.query(
        `select id, month, kind, amount, title, notes from donas_finance_adjustments where slug=$1 and id=$2 limit 1`,
        [SLUG, id]
      );
      if (!cur.rows.length) return res.status(404).json({ error: "Not found" });

      const monthIso = normalizeMonthISO(cur.rows[0].month);
      await assertMonthNotLocked(client, SLUG, monthIso);

      const q = await client.query(
        `
        update donas_finance_adjustments
        set kind=COALESCE(NULLIF($3,''), kind), amount=$4, title=$5, notes=$6, updated_at=now()
        where slug=$1 and id=$2
        returning id, to_char(month,'YYYY-MM') as ym, kind, amount, title, notes, created_at, updated_at
        `,
        [SLUG, id, kind, amount, title, notes]
      );

      await writeAudit(client, req, {
        action: "adjustment_update",
        monthIso,
        meta: {
          id,
          from: { amount: toNum(cur.rows[0].amount), title: String(cur.rows[0].title || "") },
          to: { kind: kind || String(cur.rows[0].kind || 'in'), amount, title, notes },
        },
      });

      await client.query("commit");
      return res.json({ ok: true, item: q.rows?.[0] || null });
    } catch (e) {
      try {
        await client.query("rollback");
      } catch {}
      console.error("finance/adjustments update error:", e);
      return res.status(e.statusCode || 500).json({ error: e.message || "Failed to update adjustment" });
    } finally {
      client.release();
    }
  }
);

router.delete(
  "/donas/finance/adjustments/:id",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const client = await pool.connect();
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Bad id" });

      await client.query("begin");
      await ensureAdjustmentsTable(client);

      const cur = await client.query(
        `select id, month, kind, amount, title, notes from donas_finance_adjustments where slug=$1 and id=$2 limit 1`,
        [SLUG, id]
      );
      if (!cur.rows.length) return res.status(404).json({ error: "Not found" });

      const monthIso = normalizeMonthISO(cur.rows[0].month);
      await assertMonthNotLocked(client, SLUG, monthIso);

      await client.query(`delete from donas_finance_adjustments where slug=$1 and id=$2`, [SLUG, id]);

      await writeAudit(client, req, {
        action: "adjustment_delete",
        monthIso,
        meta: { id, amount: toNum(cur.rows[0].amount), title: String(cur.rows[0].title || "") },
      });

      await client.query("commit");
      return res.json({ ok: true });
    } catch (e) {
      try {
        await client.query("rollback");
      } catch {}
      console.error("finance/adjustments delete error:", e);
      return res.status(e.statusCode || 500).json({ error: e.message || "Failed to delete adjustment" });
    } finally {
      client.release();
    }
  }
);

router.post("/donas/finance/months/:month/resnapshot", authenticateToken, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const monthParam = req.params.month;
    const monthIso = isoMonthStartFromYM(monthParam) || monthParam;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(monthIso))) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM or YYYY-MM-01)" });
    }

    const cur = await client.query(`select * from donas_finance_months where slug=$1 and month=$2 limit 1`, [
      SLUG,
      monthIso,
    ]);
    if (!cur.rows.length) return res.status(404).json({ error: "Month not found" });
    if (!isLockedNotes(cur.rows?.[0]?.notes)) {
      return res.status(400).json({ error: "Month is not locked. Lock it first." });
    }

    await client.query("begin");

    const prevRow = pickMonthRowForAudit(cur.rows?.[0]);

    const saved = await snapshotMonthByISO(client, monthIso);
    const nextRow = pickMonthRowForAudit(saved);

    await writeAudit(client, req, {
      action: "resnapshot",
      monthIso,
      meta: { scope: "single" },
      prev: prevRow,
      next: nextRow,
    });

    await client.query("commit");

    return res.json({ ok: true, month: saved });
  } catch (e) {
    try {
      await client.query("rollback");
    } catch {}
    console.error("finance/month resnapshot error:", e);
    res.status(500).json({ error: "Failed to resnapshot month" });
  } finally {
    client.release();
  }
});

router.post("/donas/finance/months/:month/resnapshot-up-to", authenticateToken, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const monthParam = req.params.month;
    const monthIso = isoMonthStartFromYM(monthParam) || monthParam;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(monthIso))) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM or YYYY-MM-01)" });
    }

    await client.query("begin");
    const { updatedCount } = await resnapshotLockedUpToISO(client, monthIso);

    await writeAudit(client, req, {
      action: "resnapshot_up_to",
      monthIso,
      meta: { target: ymFromDateLike(monthIso), updatedCount },
    });

    await client.query("commit");

    return res.json({ ok: true, updatedCount });
  } catch (e) {
    try {
      await client.query("rollback");
    } catch {}
    console.error("finance/month resnapshot-up-to error:", e);
    res.status(500).json({ error: "Failed to bulk resnapshot" });
  } finally {
    client.release();
  }
});

/**
 * PUT month (manual fields only)
 */
router.put("/donas/finance/months/:month", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const monthParam = req.params.month;
    const monthIso = isoMonthStartFromYM(monthParam) || monthParam;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(monthIso))) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM or YYYY-MM-01)" });
    }

    const b = req.body || {};
    const incomingNotes = String(b.notes || "");

    const prev = await pool.query(`select * from donas_finance_months where slug=$1 and month=$2 limit 1`, [
      SLUG,
      monthIso,
    ]);

    const prevNotes = String(prev.rows?.[0]?.notes || "");
    const wasLocked = isLockedNotes(prevNotes);
    const willBeLocked = isLockedNotes(incomingNotes);

    if (wasLocked) {
      return res.status(400).json({
        error: "Locked month is read-only. Unlock first (or use Re-snapshot).",
      });
    }

    if (!wasLocked && willBeLocked) {
      return res.status(400).json({
        error: "To lock a month use the Lock button (POST /lock). Notes cannot lock via Save.",
      });
    }

    await ensureMonthExists(pool, monthIso);

    const prevRow = pickMonthRowForAudit(prev.rows?.[0]);

    const payload = {
      slug: SLUG,
      month: monthIso,
      revenue: toNum(b.revenue),
      cogs: toNum(b.cogs),
      loan_paid: toNum(b.loan_paid),
      opex: 0,
      capex: 0,
      cash_end: 0,
      notes: incomingNotes,
    };

    const saved = await upsertMonthRow(pool, payload);

    await writeAudit(pool, req, {
      action: "update_manual",
      monthIso,
      prev: prevRow,
      next: pickMonthRowForAudit(saved),
    });

    res.json(saved);
  } catch (e) {
    console.error("finance/month PUT error:", e);
    res.status(500).json({ error: "Failed to save month" });
  }
});

module.exports = router;
