// backend/controllers/donasFinanceMonthsController.js

const db = require("../db");

const SLUG = "donas-dosas";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function isYm(s) {
  return /^\d{4}-\d{2}$/.test(String(s || ""));
}
function ymToMonthDate(ym) {
  return `${ym}-01`;
}
function monthToYm(m) {
  return String(m || "").slice(0, 7);
}
function hasLockedTag(notes) {
  return String(notes || "").toLowerCase().includes("#locked");
}
function addLockedTag(notes) {
  const s = String(notes || "").trim();
  if (!s) return "#locked";
  if (hasLockedTag(s)) return s;
  return `${s}\n#locked`;
}
function removeLockedTag(notes) {
  const s = String(notes || "");
  return s
    .split("\n")
    .filter((line) => !String(line).toLowerCase().includes("#locked"))
    .join("\n")
    .trim();
}
function prevYm(ym) {
  const [y, m] = String(ym).split("-").map((v) => Number(v));
  const d = new Date(Date.UTC(y, m - 2, 1));
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}
function nextYm(ym) {
  const [y, m] = String(ym).split("-").map((v) => Number(v));
  const d = new Date(Date.UTC(y, m, 1));
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

/**
 * =========================
 * Tables (ensure)
 * =========================
 */

async function ensureSettingsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS donas_finance_settings (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      currency TEXT NOT NULL DEFAULT 'UZS',
      cash_start NUMERIC NOT NULL DEFAULT 0,
      fixed_opex_month NUMERIC NOT NULL DEFAULT 0,
      variable_opex_month NUMERIC NOT NULL DEFAULT 0,
      loan_payment_month NUMERIC NOT NULL DEFAULT 0,
      reserve_target_months NUMERIC NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getCashStartFromSettings() {
  await ensureSettingsTable();
  const q = await db.query(
    `SELECT cash_start FROM donas_finance_settings WHERE slug=$1 LIMIT 1`,
    [SLUG]
  );
  return toNum(q.rows?.[0]?.cash_start);
}

async function ensureMonthsTable() {
  // Create with created_at+updated_at, but also ALTER for existing tables.
  await db.query(`
    CREATE TABLE IF NOT EXISTS donas_finance_months (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL,
      month DATE NOT NULL,
      revenue NUMERIC NOT NULL DEFAULT 0,
      cogs NUMERIC NOT NULL DEFAULT 0,
      opex NUMERIC NOT NULL DEFAULT 0,
      capex NUMERIC NOT NULL DEFAULT 0,
      loan_paid NUMERIC NOT NULL DEFAULT 0,
      cash_end NUMERIC NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Ensure columns exist (for older schema that had only updated_at)
  try {
    await db.query(`
      ALTER TABLE donas_finance_months
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `);
  } catch {}
  try {
    await db.query(`
      ALTER TABLE donas_finance_months
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `);
  } catch {}

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_donas_finance_months_slug_month
    ON donas_finance_months (slug, month);
  `);

  // Ensure unique for idempotent upsert
  try {
    await db.query(`
      ALTER TABLE donas_finance_months
      ADD CONSTRAINT donas_finance_months_slug_month_key UNIQUE (slug, month);
    `);
  } catch {}
}

async function ensurePurchasesTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS donas_purchases (
      id BIGSERIAL PRIMARY KEY,
      date DATE NOT NULL,
      ingredient TEXT NOT NULL,
      qty NUMERIC NOT NULL DEFAULT 1,
      price NUMERIC NOT NULL DEFAULT 0,
      total NUMERIC NOT NULL DEFAULT 0,
      type TEXT NOT NULL DEFAULT 'opex',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function ensureSalesTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS donas_sales (
      id BIGSERIAL PRIMARY KEY,
      sold_at DATE NOT NULL,
      ym TEXT NOT NULL,
      menu_item_id BIGINT,
      qty NUMERIC NOT NULL DEFAULT 1,
      unit_price NUMERIC NOT NULL DEFAULT 0,
      revenue NUMERIC NOT NULL DEFAULT 0,
      cogs_total NUMERIC NOT NULL DEFAULT 0,
      cogs_unit NUMERIC NOT NULL DEFAULT 0,
      channel TEXT NOT NULL DEFAULT 'cash',
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

/**
 * =========================
 * Audit (table + helpers)
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

async function ensureAuditTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS donas_finance_months_audit (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL,
      ym TEXT NOT NULL,
      action TEXT NOT NULL,
      actor JSONB,
      meta JSONB,
      diff JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_donas_finance_months_audit_slug_ym
    ON donas_finance_months_audit (slug, ym);
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_donas_finance_months_audit_created_at
    ON donas_finance_months_audit (created_at);
  `);
}

async function auditMonthAction(req, ym, action, meta = {}, diff = {}) {
  try {
    await ensureAuditTable();
    const actor = getActor(req);
    await db.query(
      `
      INSERT INTO donas_finance_months_audit (slug, ym, action, actor, meta, diff)
      VALUES ($1,$2,$3,$4,$5,$6)
      `,
      [SLUG, String(ym || ""), String(action || ""), actor, meta, diff]
    );
  } catch (e) {
    console.warn("auditMonthAction warning:", e?.message || e);
  }
}

/**
 * =========================
 * Data (months)
 * =========================
 */

async function getLatestMonthRow(ym) {
  await ensureMonthsTable();
  const q = await db.query(
    `
  SELECT *
  FROM donas_finance_months
  WHERE slug=$1 AND to_char(month,'YYYY-MM')=$2
  ORDER BY updated_at DESC, id DESC
  LIMIT 1
  `,
    [SLUG, ym]
  );
  return q.rows?.[0] || null;
}

async function ensureMonthRow(ym) {
  await ensureMonthsTable();
  const q = await db.query(
    `
    INSERT INTO donas_finance_months (slug, month)
    VALUES ($1, $2::date)
    ON CONFLICT (slug, month) DO NOTHING
    RETURNING *
    `,
    [SLUG, ymToMonthDate(ym)]
  );
  if (q.rows?.[0]) return q.rows[0];
  return (await getLatestMonthRow(ym)) || null;
}

async function insertMonthSnapshot(ym, row) {
  await ensureMonthsTable();
  const q = await db.query(
    `
    INSERT INTO donas_finance_months
      (slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes, updated_at)
    VALUES
      ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, NOW())
    RETURNING *
    `,
    [
      SLUG,
      ymToMonthDate(ym),
      toNum(row.revenue),
      toNum(row.cogs),
      toNum(row.opex),
      toNum(row.capex),
      toNum(row.loan_paid),
      toNum(row.cash_end),
      String(row.notes || ""),
    ]
  );
  return q.rows?.[0] || null;
}

/**
 * =========================
 * Aggregation
 * =========================
 */

async function sumSalesRevenueCogs(ym) {
  await ensureSalesTable();
  const q = await db.query(
    `
    SELECT
      COALESCE(SUM(revenue),0)::numeric AS revenue,
      COALESCE(SUM(cogs_total),0)::numeric AS cogs
    FROM donas_sales
    WHERE ym=$1
    `,
    [ym]
  );
  return {
    revenue: toNum(q.rows?.[0]?.revenue),
    cogs: toNum(q.rows?.[0]?.cogs),
  };
}

async function sumPurchasesByType(ym) {
  await ensurePurchasesTable();
  const q = await db.query(
    `
    SELECT
      type,
      COALESCE(SUM(total),0)::numeric AS total
    FROM donas_purchases
    WHERE to_char(date,'YYYY-MM')=$1
    GROUP BY type
    `,
    [ym]
  );
  const out = { opex: 0, capex: 0 };
  for (const r of q.rows || []) {
    const t = String(r.type || "").toLowerCase();
    const v = toNum(r.total);
    if (t === "capex") out.capex += v;
    else out.opex += v; // everything else counts as opex
  }
  return out;
}

async function updateMonthAggSnapshot(ym) {
  await ensureMonthRow(ym);
  const cur = (await getLatestMonthRow(ym)) || {};

  if (hasLockedTag(cur.notes)) {
    // locked month = do not overwrite revenue/cogs/opex/capex
    return cur;
  }

  const s = await sumSalesRevenueCogs(ym);
  const p = await sumPurchasesByType(ym);

  const nextRow = {
    revenue: s.revenue,
    cogs: s.cogs,
    opex: p.opex,
    capex: p.capex,
    loan_paid: toNum(cur.loan_paid),
    cash_end: toNum(cur.cash_end), // chain will overwrite later
    notes: String(cur.notes || ""),
  };

  const out = await insertMonthSnapshot(ym, nextRow);
  return out;
}

/**
 * =========================
 * Cash chain
 * =========================
 *
 * cash_end(ym) = cash_end(prevYm) + (revenue - cogs - opex - capex - loan_paid)
 */

async function getMaxYmFromMonthsOrData(fallbackYm) {
  await ensureMonthsTable();
  await ensurePurchasesTable();
  await ensureSalesTable();

  const maxMonths = await db.query(
    `
    SELECT to_char(MAX(month),'YYYY-MM') AS ym
    FROM donas_finance_months
    WHERE slug=$1
    `,
    [SLUG]
  );
  const maxPurch = await db.query(`SELECT to_char(MAX(date),'YYYY-MM') AS ym FROM donas_purchases`);
  const maxSales = await db.query(`SELECT MAX(ym) AS ym FROM donas_sales`);

  const candidates = [
    String(maxMonths.rows?.[0]?.ym || ""),
    String(maxPurch.rows?.[0]?.ym || ""),
    String(maxSales.rows?.[0]?.ym || ""),
    String(fallbackYm || ""),
  ].filter((x) => isYm(x));

  if (!candidates.length) return null;
  candidates.sort();
  return candidates[candidates.length - 1];
}

async function recomputeCashChainFrom(startYm, endYm) {
  if (!isYm(startYm) || !isYm(endYm)) return;

  await ensureMonthsTable();

  let ym = startYm;
  const startPrev = prevYm(ym);

  // prev cash: if exists month row -> take its cash_end; else take cash_start setting
  let prevCash = 0;
  const prevRow = await getLatestMonthRow(startPrev);
  if (prevRow) prevCash = toNum(prevRow.cash_end);
  else prevCash = await getCashStartFromSettings();

  while (String(ym).localeCompare(String(endYm)) <= 0) {
    await ensureMonthRow(ym);
    const cur = (await getLatestMonthRow(ym)) || {};

    const revenue = toNum(cur.revenue);
    const cogs = toNum(cur.cogs);
    const opex = toNum(cur.opex);
    const capex = toNum(cur.capex);
    const loan = toNum(cur.loan_paid);

    const cf = revenue - cogs - opex - capex - loan;
    const cash_end = prevCash + cf;

    const out = await insertMonthSnapshot(ym, {
      revenue,
      cogs,
      opex,
      capex,
      loan_paid: loan,
      cash_end,
      notes: String(cur.notes || ""),
    });

    prevCash = toNum(out.cash_end);
    ym = nextYm(ym);
  }
}

/**
 * =========================
 * Settings handlers
 * =========================
 */

async function getSettings(req, res) {
  try {
    await ensureSettingsTable();
    const q = await db.query(`SELECT * FROM donas_finance_settings WHERE slug=$1 LIMIT 1`, [SLUG]);
    const row =
      q.rows?.[0] || {
        slug: SLUG,
        currency: "UZS",
        cash_start: 0,
        fixed_opex_month: 0,
        variable_opex_month: 0,
        loan_payment_month: 0,
        reserve_target_months: 0,
      };
    return res.json(row);
  } catch (e) {
    console.error("getSettings error:", e);
    return res.status(500).json({ error: "Failed to load settings" });
  }
}

async function updateSettings(req, res) {
  try {
    await ensureSettingsTable();
    const b = req.body || {};
    const currency = String(b.currency || "UZS").trim() || "UZS";
    const cash_start = toNum(b.cash_start);
    const fixed_opex_month = toNum(b.fixed_opex_month);
    const variable_opex_month = toNum(b.variable_opex_month);
    const loan_payment_month = toNum(b.loan_payment_month);
    const reserve_target_months = toNum(b.reserve_target_months);

    const q = await db.query(
      `
      INSERT INTO donas_finance_settings
        (slug, currency, cash_start, fixed_opex_month, variable_opex_month, loan_payment_month, reserve_target_months)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (slug) DO UPDATE SET
        currency=EXCLUDED.currency,
        cash_start=EXCLUDED.cash_start,
        fixed_opex_month=EXCLUDED.fixed_opex_month,
        variable_opex_month=EXCLUDED.variable_opex_month,
        loan_payment_month=EXCLUDED.loan_payment_month,
        reserve_target_months=EXCLUDED.reserve_target_months
      RETURNING *
      `,
      [
        SLUG,
        currency,
        cash_start,
        fixed_opex_month,
        variable_opex_month,
        loan_payment_month,
        reserve_target_months,
      ]
    );

    return res.json(q.rows[0]);
  } catch (e) {
    console.error("updateSettings error:", e);
    return res.status(500).json({ error: "Failed to save settings" });
  }
}

/**
 * =========================
 * Months handlers
 * =========================
 */

async function listMonths(req, res) {
  try {
    await ensureMonthsTable();
    const { rows } = await db.query(
      `
      SELECT
        to_char(month,'YYYY-MM') AS month,
        revenue, cogs, opex, capex, loan_paid, cash_end, notes,
        /*
         * Some older DB schemas were created without created_at.
         * We keep response stable without hard-requiring that column.
         */
        updated_at AS created_at,
        updated_at
      FROM donas_finance_months
      WHERE slug=$1
      ORDER BY month ASC
      `,
      [SLUG]
    );
    return res.json({ months: rows || [] });
  } catch (e) {
    console.error("listMonths error:", e);
    return res.status(500).json({ error: "Failed to list months" });
  }
}

async function syncMonths(req, res) {
  try {
    await ensureMonthsTable();
    await ensurePurchasesTable();
    await ensureSalesTable();

    const minQ = await db.query(
      `
      SELECT
        LEAST(
          COALESCE((SELECT to_char(MIN(date),'YYYY-MM') FROM donas_purchases), '9999-12'),
          COALESCE((SELECT to_char(MIN(sold_at),'YYYY-MM') FROM donas_sales), '9999-12')
        ) AS ym
      `
    );
    const maxQ = await db.query(
      `
      SELECT
        GREATEST(
          COALESCE((SELECT to_char(MAX(date),'YYYY-MM') FROM donas_purchases), '0000-01'),
          COALESCE((SELECT to_char(MAX(sold_at),'YYYY-MM') FROM donas_sales), '0000-01')
        ) AS ym
      `
    );

    const minYm = String(minQ.rows?.[0]?.ym || "");
    const maxYm = String(maxQ.rows?.[0]?.ym || "");

    if (!isYm(minYm) || !isYm(maxYm) || minYm === "9999-12" || maxYm === "0000-01") {
      return res.json({ ok: true, synced: 0, range: null });
    }

    let ym = minYm;
    let touched = 0;
    while (String(ym).localeCompare(String(maxYm)) <= 0) {
      await ensureMonthRow(ym);
      await updateMonthAggSnapshot(ym);
      touched++;
      ym = nextYm(ym);
    }

    await recomputeCashChainFrom(minYm, maxYm);

    await auditMonthAction(req, minYm, "months.sync", { minYm, maxYm, touched }, {});
    return res.json({ ok: true, synced: touched, range: { minYm, maxYm } });
  } catch (e) {
    console.error("syncMonths error:", e);
    return res.status(500).json({ error: "Failed to sync months" });
  }
}

async function updateMonth(req, res) {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    await ensureMonthRow(ym);

    const cur = (await getLatestMonthRow(ym)) || {};
    if (hasLockedTag(cur.notes)) {
      return res.status(409).json({ error: `Month ${ym} is locked (#locked)` });
    }

    const b = req.body || {};
    const nextLoan = b.loan_paid == null ? toNum(cur.loan_paid) : toNum(b.loan_paid);
    const nextNotes = b.notes == null ? String(cur.notes || "") : String(b.notes || "");

    if (String(nextNotes).toLowerCase().includes("#locked")) {
      return res.status(400).json({ error: "Do not set #locked manually. Use Lock button." });
    }

    const out = await insertMonthSnapshot(ym, {
      revenue: toNum(cur.revenue),
      cogs: toNum(cur.cogs),
      opex: toNum(cur.opex),
      capex: toNum(cur.capex),
      loan_paid: nextLoan,
      cash_end: toNum(cur.cash_end),
      notes: nextNotes,
    });

    const endYm = (await getMaxYmFromMonthsOrData(ym)) || ym;
    await recomputeCashChainFrom(ym, endYm);

    await auditMonthAction(
      req,
      ym,
      "months.update",
      { ym },
      { loan_paid: { from: cur.loan_paid, to: nextLoan }, notes: { from: cur.notes, to: nextNotes } }
    );

    return res.json(out);
  } catch (e) {
    console.error("updateMonth error:", e);
    return res.status(500).json({ error: "Failed to update month" });
  }
}

async function lockMonth(req, res) {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    await ensureMonthRow(ym);

    const cur = (await getLatestMonthRow(ym)) || {};
    if (hasLockedTag(cur.notes)) return res.json({ ok: true, ym, already: true });

    const out = await insertMonthSnapshot(ym, {
      revenue: toNum(cur.revenue),
      cogs: toNum(cur.cogs),
      opex: toNum(cur.opex),
      capex: toNum(cur.capex),
      loan_paid: toNum(cur.loan_paid),
      cash_end: toNum(cur.cash_end),
      notes: addLockedTag(cur.notes || ""),
    });

    await auditMonthAction(req, ym, "months.lock", { ym }, { locked: true });
    return res.json({ ok: true, ym, month: out });
  } catch (e) {
    console.error("lockMonth error:", e);
    return res.status(500).json({ error: "Failed to lock month" });
  }
}

async function unlockMonth(req, res) {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    await ensureMonthRow(ym);

    const cur = (await getLatestMonthRow(ym)) || {};
    if (!hasLockedTag(cur.notes)) return res.json({ ok: true, ym, already: true });

    const out = await insertMonthSnapshot(ym, {
      revenue: toNum(cur.revenue),
      cogs: toNum(cur.cogs),
      opex: toNum(cur.opex),
      capex: toNum(cur.capex),
      loan_paid: toNum(cur.loan_paid),
      cash_end: toNum(cur.cash_end),
      notes: removeLockedTag(cur.notes || ""),
    });

    // after unlock: immediately refresh agg from data, then recompute chain
    await updateMonthAggSnapshot(ym);
    const endYm = (await getMaxYmFromMonthsOrData(ym)) || ym;
    await recomputeCashChainFrom(ym, endYm);

    await auditMonthAction(req, ym, "months.unlock", { ym }, { locked: false });
    return res.json({ ok: true, ym, month: out });
  } catch (e) {
    console.error("unlockMonth error:", e);
    return res.status(500).json({ error: "Failed to unlock month" });
  }
}

/**
 * =========================
 * UI helpers (preview + bulk ops)
 * =========================
 */

async function lockPreview(req, res) {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month" });

    await ensureMonthRow(ym);
    const cur = (await getLatestMonthRow(ym)) || {};
    const willLock = !hasLockedTag(cur.notes);
    return res.json({ ym, willLock, currentNotes: cur.notes || "" });
  } catch (e) {
    console.error("lockPreview error:", e);
    return res.status(500).json({ error: "Failed to preview lock" });
  }
}

async function resnapshotMonth(req, res) {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month" });

    await ensureMonthRow(ym);

    const cur = (await getLatestMonthRow(ym)) || {};
    if (hasLockedTag(cur.notes)) {
      return res.status(409).json({ error: `Month ${ym} is locked (#locked)` });
    }

    await updateMonthAggSnapshot(ym);

    const endYm = (await getMaxYmFromMonthsOrData(ym)) || ym;
    await recomputeCashChainFrom(ym, endYm);

    await auditMonthAction(req, ym, "months.resnapshot", { ym }, {});
    return res.json({ ok: true, ym });
  } catch (e) {
    console.error("resnapshotMonth error:", e);
    return res.status(500).json({ error: "Failed to resnapshot month" });
  }
}

async function lockUpTo(req, res) {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month" });

    await ensureMonthsTable();

    // lock all months <= ym
    const q = await db.query(
      `
      SELECT to_char(month,'YYYY-MM') AS ym, notes
      FROM donas_finance_months
      WHERE slug=$1
      ORDER BY month ASC
      `,
      [SLUG]
    );

    let locked = 0;
    for (const r of q.rows || []) {
      const m = String(r.ym || "");
      if (!isYm(m)) continue;
      if (String(m).localeCompare(String(ym)) > 0) break;

      await ensureMonthRow(m);
      const cur = (await getLatestMonthRow(m)) || {};
      if (!hasLockedTag(cur.notes)) {
        await insertMonthSnapshot(m, {
          revenue: toNum(cur.revenue),
          cogs: toNum(cur.cogs),
          opex: toNum(cur.opex),
          capex: toNum(cur.capex),
          loan_paid: toNum(cur.loan_paid),
          cash_end: toNum(cur.cash_end),
          notes: addLockedTag(cur.notes || ""),
        });
        locked++;
      }
    }

    await auditMonthAction(req, ym, "months.lockUpTo", { ym, locked }, {});
    return res.json({ ok: true, ym, locked });
  } catch (e) {
    console.error("lockUpTo error:", e);
    return res.status(500).json({ error: "Failed to lock up to" });
  }
}

async function bulkResnapshot(req, res) {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month" });

    await ensureMonthsTable();

    const q = await db.query(
      `
      SELECT to_char(month,'YYYY-MM') AS ym, notes
      FROM donas_finance_months
      WHERE slug=$1
      ORDER BY month ASC
      `,
      [SLUG]
    );

    let touched = 0;
    let firstTouched = null;

    for (const r of q.rows || []) {
      const m = String(r.ym || "");
      if (!isYm(m)) continue;
      if (String(m).localeCompare(String(ym)) > 0) break;

      await ensureMonthRow(m);
      const cur = (await getLatestMonthRow(m)) || {};
      if (hasLockedTag(cur.notes)) continue;

      await updateMonthAggSnapshot(m);
      touched++;
      if (!firstTouched) firstTouched = m;
    }

    if (firstTouched) {
      const endYm = (await getMaxYmFromMonthsOrData(firstTouched)) || firstTouched;
      await recomputeCashChainFrom(firstTouched, endYm);
    }

    await auditMonthAction(req, ym, "months.bulkResnapshot", { ym, touched }, {});
    return res.json({ ok: true, ym, touched });
  } catch (e) {
    console.error("bulkResnapshot error:", e);
    return res.status(500).json({ error: "Failed bulk resnapshot" });
  }
}

async function resnapshotUpToPreview(req, res) {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month" });

    await ensureMonthsTable();
    const q = await db.query(
      `
      SELECT to_char(month,'YYYY-MM') AS ym, notes
      FROM donas_finance_months
      WHERE slug=$1
      ORDER BY month ASC
      `,
      [SLUG]
    );

    const willTouch = [];
    for (const r of q.rows || []) {
      const m = String(r.ym || "");
      if (!isYm(m)) continue;
      if (String(m).localeCompare(String(ym)) > 0) break;
      if (!hasLockedTag(r.notes)) willTouch.push(m);
    }

    return res.json({ ym, willTouch, count: willTouch.length });
  } catch (e) {
    console.error("resnapshotUpToPreview error:", e);
    return res.status(500).json({ error: "Failed preview" });
  }
}

async function resnapshotUpTo(req, res) {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month" });

    await ensureMonthsTable();
    const q = await db.query(
      `
      SELECT to_char(month,'YYYY-MM') AS ym, notes
      FROM donas_finance_months
      WHERE slug=$1
      ORDER BY month ASC
      `,
      [SLUG]
    );

    let touched = 0;
    let firstTouched = null;

    for (const r of q.rows || []) {
      const m = String(r.ym || "");
      if (!isYm(m)) continue;
      if (String(m).localeCompare(String(ym)) > 0) break;

      await ensureMonthRow(m);
      const cur = (await getLatestMonthRow(m)) || {};
      if (hasLockedTag(cur.notes)) continue;

      await updateMonthAggSnapshot(m);
      touched++;
      if (!firstTouched) firstTouched = m;
    }

    if (firstTouched) {
      const endYm = (await getMaxYmFromMonthsOrData(firstTouched)) || firstTouched;
      await recomputeCashChainFrom(firstTouched, endYm);
    }

    await auditMonthAction(req, ym, "months.resnapshotUpTo", { ym, touched }, {});
    return res.json({ ok: true, ym, touched });
  } catch (e) {
    console.error("resnapshotUpTo error:", e);
    return res.status(500).json({ error: "Failed resnapshot up to" });
  }
}

/**
 * =========================
 * Audit endpoints
 * =========================
 */

async function auditMonth(req, res) {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month" });

    await ensureAuditTable();
    const q = await db.query(
      `
      SELECT id, ym, action, actor, meta, diff, created_at
      FROM donas_finance_months_audit
      WHERE slug=$1 AND ym=$2
      ORDER BY id DESC
      LIMIT 200
      `,
      [SLUG, ym]
    );
    return res.json({ rows: q.rows || [] });
  } catch (e) {
    console.error("auditMonth error:", e);
    return res.status(500).json({ error: "Failed to load audit" });
  }
}

function csvEscape(v) {
  const s = String(v == null ? "" : v);
  if (s.includes('"') || s.includes(",") || s.includes("\n")) return `"${s.replace(/\"/g, '""')}"`;
  return s;
}

async function exportAuditMonthCsv(req, res) {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month" });

    await ensureAuditTable();
    const q = await db.query(
      `
      SELECT id, ym, action, actor, meta, diff, created_at
      FROM donas_finance_months_audit
      WHERE slug=$1 AND ym=$2
      ORDER BY id DESC
      `,
      [SLUG, ym]
    );

    const header = ["id", "ym", "action", "actor", "meta", "diff", "created_at"];
    const lines = [header.join(",")];
    for (const r of q.rows || []) {
      lines.push(
        [
          r.id,
          r.ym,
          r.action,
          JSON.stringify(r.actor || {}),
          JSON.stringify(r.meta || {}),
          JSON.stringify(r.diff || {}),
          r.created_at,
        ]
          .map(csvEscape)
          .join(",")
      );
    }

    const csv = lines.join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="donas-audit-${ym}.csv"`);
    return res.send(csv);
  } catch (e) {
    console.error("exportAuditMonthCsv error:", e);
    return res.status(500).json({ error: "Failed to export audit csv" });
  }
}

async function audit(req, res) {
  try {
    await ensureAuditTable();
    const q = await db.query(
      `
      SELECT id, ym, action, actor, meta, diff, created_at
      FROM donas_finance_months_audit
      WHERE slug=$1
      ORDER BY id DESC
      LIMIT 500
      `,
      [SLUG]
    );
    return res.json({ rows: q.rows || [] });
  } catch (e) {
    console.error("audit error:", e);
    return res.status(500).json({ error: "Failed to load audit" });
  }
}

async function exportAuditCsv(req, res) {
  try {
    await ensureAuditTable();
    const q = await db.query(
      `
      SELECT id, ym, action, actor, meta, diff, created_at
      FROM donas_finance_months_audit
      WHERE slug=$1
      ORDER BY id DESC
      `,
      [SLUG]
    );

    const header = ["id", "ym", "action", "actor", "meta", "diff", "created_at"];
    const lines = [header.join(",")];
    for (const r of q.rows || []) {
      lines.push(
        [
          r.id,
          r.ym,
          r.action,
          JSON.stringify(r.actor || {}),
          JSON.stringify(r.meta || {}),
          JSON.stringify(r.diff || {}),
          r.created_at,
        ]
          .map(csvEscape)
          .join(",")
      );
    }

    const csv = lines.join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="donas-audit.csv"`);
    return res.send(csv);
  } catch (e) {
    console.error("exportAuditCsv error:", e);
    return res.status(500).json({ error: "Failed to export audit csv" });
  }
}

async function exportCsv(req, res) {
  try {
    await ensureMonthsTable();
    const q = await db.query(
      `
      SELECT
        to_char(month,'YYYY-MM') AS month,
        revenue, cogs, opex, capex, loan_paid, cash_end, notes, updated_at
      FROM donas_finance_months
      WHERE slug=$1
      ORDER BY month ASC
      `,
      [SLUG]
    );

    const header = ["month", "revenue", "cogs", "opex", "capex", "loan_paid", "cash_end", "notes", "updated_at"];
    const lines = [header.join(",")];
    for (const r of q.rows || []) {
      lines.push(
        [
          r.month,
          r.revenue,
          r.cogs,
          r.opex,
          r.capex,
          r.loan_paid,
          r.cash_end,
          r.notes,
          r.updated_at,
        ]
          .map(csvEscape)
          .join(",")
      );
    }

    const csv = lines.join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="donas-months.csv"`);
    return res.send(csv);
  } catch (e) {
    console.error("exportCsv error:", e);
    return res.status(500).json({ error: "Failed to export csv" });
  }
}

module.exports = {
  getSettings,
  updateSettings,

  listMonths,
  syncMonths,

  updateMonth,
  lockMonth,
  unlockMonth,

  resnapshotMonth,
  lockUpTo,
  bulkResnapshot,

  // UI helpers (these must exist for routes)
  lockPreview,
  resnapshotUpToPreview,
  resnapshotUpTo,

  // audit + csv
  auditMonth,
  exportAuditMonthCsv,
  exportCsv,
  audit,
  exportAuditCsv,

  // used by auto-sync helper
  _internal: {
    isYm,
    prevYm,
    nextYm,
    getMaxYmFromMonthsOrData,
    updateMonthAgg: updateMonthAggSnapshot,
    updateMonthAggSnapshot,
    recomputeCashChainFrom,
    auditMonthAction,
  },
};
