// backend/controllers/donasFinanceMonthsController.js

const db = require("../db");

const SLUG = "donas-dosas";
const MIN_YM_FLOOR = "2025-01";

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
  if (!m) return "";
  if (m instanceof Date) return m.toISOString().slice(0, 7);
  const s = String(m);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  return "";
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
  const d = new Date(Date.UTC(y, (m - 1) - 1, 1));
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}
function nextYm(ym) {
  const [y, m] = String(ym).split("-").map((v) => Number(v));
  const d = new Date(Date.UTC(y, (m - 1) + 1, 1));
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

      -- Source of truth:
      owner_capital NUMERIC NOT NULL DEFAULT 0,
      bank_loan NUMERIC NOT NULL DEFAULT 0,
      cash_start NUMERIC NOT NULL DEFAULT 0,

      -- legacy (keep for compatibility, not used)
      fixed_opex_month NUMERIC NOT NULL DEFAULT 0,
      variable_opex_month NUMERIC NOT NULL DEFAULT 0,
      loan_payment_month NUMERIC NOT NULL DEFAULT 0,

      reserve_target_months NUMERIC NOT NULL DEFAULT 0,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Safe schema upgrades (for existing DB)
  await db.query(
    `ALTER TABLE donas_finance_settings ADD COLUMN IF NOT EXISTS owner_capital NUMERIC NOT NULL DEFAULT 0;`
  );
  await db.query(
    `ALTER TABLE donas_finance_settings ADD COLUMN IF NOT EXISTS bank_loan NUMERIC NOT NULL DEFAULT 0;`
  );
  await db.query(
    `ALTER TABLE donas_finance_settings ADD COLUMN IF NOT EXISTS cash_start NUMERIC NOT NULL DEFAULT 0;`
  );
  await db.query(
    `ALTER TABLE donas_finance_settings ADD COLUMN IF NOT EXISTS reserve_target_months NUMERIC NOT NULL DEFAULT 0;`
  );
  await db.query(
    `ALTER TABLE donas_finance_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`
  );

  // legacy columns (keep)
  await db.query(
    `ALTER TABLE donas_finance_settings ADD COLUMN IF NOT EXISTS fixed_opex_month NUMERIC NOT NULL DEFAULT 0;`
  );
  await db.query(
    `ALTER TABLE donas_finance_settings ADD COLUMN IF NOT EXISTS variable_opex_month NUMERIC NOT NULL DEFAULT 0;`
  );
  await db.query(
    `ALTER TABLE donas_finance_settings ADD COLUMN IF NOT EXISTS loan_payment_month NUMERIC NOT NULL DEFAULT 0;`
  );
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
      qty NUMERIC NOT NULL DEFAULT 0,
      price NUMERIC NOT NULL DEFAULT 0,
      total NUMERIC GENERATED ALWAYS AS (qty * price) STORED,
      type TEXT NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_donas_purchases_date ON donas_purchases (date);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_donas_purchases_type ON donas_purchases (type);`);
}

async function ensureSalesTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS donas_sales (
      id BIGSERIAL PRIMARY KEY,
      sold_at DATE NOT NULL,
      menu_item_id BIGINT NOT NULL,
      qty NUMERIC NOT NULL DEFAULT 1,
      unit_price NUMERIC NOT NULL DEFAULT 0,
      revenue_total NUMERIC NOT NULL DEFAULT 0,
      cogs_snapshot_id BIGINT,
      cogs_unit NUMERIC NOT NULL DEFAULT 0,
      cogs_total NUMERIC NOT NULL DEFAULT 0,
      channel TEXT NOT NULL DEFAULT 'cash',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_donas_sales_sold_at ON donas_sales (sold_at);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_donas_sales_menu_item_id ON donas_sales (menu_item_id);`);
}

/**
 * =========================
 * Finance audit
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

async function ensureFinanceAudit() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS donas_finance_audit_log (
        id BIGSERIAL PRIMARY KEY,
        slug TEXT NOT NULL,
        ym TEXT NOT NULL,
        action TEXT NOT NULL,
        diff JSONB NOT NULL DEFAULT '{}'::jsonb,
        actor_name TEXT,
        actor_email TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actor_role TEXT,
        actor_id BIGINT,
        meta JSONB NOT NULL DEFAULT '{}'::jsonb
      );
    `);

    await db.query(`DROP VIEW IF EXISTS donas_finance_audit;`);

    await db.query(`
      CREATE VIEW donas_finance_audit AS
      SELECT
        id, slug, ym, action,
        actor_id, actor_role, actor_email, actor_name,
        diff, meta, created_at
      FROM donas_finance_audit_log;
    `);
  } catch (e) {
    console.error("ensureFinanceAudit error:", e);
  }
}

async function auditMonthAction(req, ym, action, meta = {}, diff = {}) {
  try {
    if (!isYm(ym)) return;
    await ensureFinanceAudit();
    const actor = getActor(req);
    await db.query(
      `
      INSERT INTO donas_finance_audit_log
        (slug, ym, action, actor_id, actor_role, actor_email, actor_name, diff, meta)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
      `,
      [
        SLUG,
        String(ym),
        String(action || "months.update"),
        actor.id,
        actor.role,
        actor.email,
        actor.name,
        JSON.stringify(diff || {}),
        JSON.stringify(meta || {}),
      ]
    );
  } catch (e) {
    console.error("auditMonthAction error:", e);
  }
}

/**
 * =========================
 * Helpers: months rows
 * =========================
 */

async function getLatestMonthRow(ym) {
  await ensureMonthsTable();
  if (!isYm(ym)) return null;

  const q = await db.query(
    `
    SELECT *
    FROM donas_finance_months
    WHERE slug=$1 AND month=($2 || '-01')::date
    ORDER BY id DESC
    LIMIT 1
    `,
    [SLUG, ym]
  );

  return q.rows?.[0] || null;
}

async function ensureMonthRow(ym) {
  const existing = await getLatestMonthRow(ym);
  if (existing) return existing;

  const ins = await db.query(
    `
    INSERT INTO donas_finance_months
      (slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes, created_at, updated_at)
    VALUES
      ($1, ($2)::date, 0,0,0,0,0,0,'', NOW(), NOW())
    ON CONFLICT (slug, month)
    DO UPDATE SET slug=EXCLUDED.slug
    RETURNING *
    `,
    [SLUG, ymToMonthDate(ym)]
  );

  return ins.rows?.[0] || (await getLatestMonthRow(ym));
}

async function isMonthLocked(ym) {
  const row = await getLatestMonthRow(ym);
  return !!(row && hasLockedTag(row.notes));
}

async function insertMonthSnapshot(ym, agg) {
  await ensureMonthsTable();
  await ensureMonthRow(ym);

  const a = agg || {};

  const ins = await db.query(
    `
    INSERT INTO donas_finance_months
      (slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes, created_at, updated_at)
    VALUES
      ($1, ($2)::date, $3,$4,$5,$6,$7,$8,$9, NOW(), NOW())
    ON CONFLICT (slug, month)
    DO UPDATE SET
      revenue=EXCLUDED.revenue,
      cogs=EXCLUDED.cogs,
      opex=EXCLUDED.opex,
      capex=EXCLUDED.capex,
      loan_paid=EXCLUDED.loan_paid,
      cash_end=EXCLUDED.cash_end,
      notes=EXCLUDED.notes,
      updated_at=NOW()
    RETURNING *
    `,
    [
      SLUG,
      ymToMonthDate(ym),
      toNum(a.revenue),
      toNum(a.cogs),
      toNum(a.opex),
      toNum(a.capex),
      toNum(a.loan_paid),
      toNum(a.cash_end),
      String(a.notes ?? ""),
    ]
  );

  return ins.rows?.[0] || (await getLatestMonthRow(ym));
}

/**
 * =========================
 * Aggregation: Sales + Purchases
 * =========================
 */

async function sumPurchasesForMonth(ym) {
  await ensurePurchasesTable();
  if (!isYm(ym)) return { opex: 0, capex: 0 };

  const start = `${ym}-01`;
  const end = `${nextYm(ym)}-01`;

  const { rows } = await db.query(
    `
    SELECT
      COALESCE(SUM(CASE WHEN lower(type)='opex' THEN total ELSE 0 END),0) AS opex,
      COALESCE(SUM(CASE WHEN lower(type)='capex' THEN total ELSE 0 END),0) AS capex
    FROM donas_purchases
    WHERE date >= $1::date AND date < $2::date
    `,
    [start, end]
  );

  const r = rows?.[0] || {};
  return { opex: toNum(r.opex), capex: toNum(r.capex) };
}

async function sumSalesForMonth(ym) {
  await ensureSalesTable();
  if (!isYm(ym)) return { revenue: 0, cogs: 0 };

  const { rows } = await db.query(
    `
    SELECT
      COALESCE(SUM(revenue_total),0) AS revenue,
      COALESCE(SUM(cogs_total),0) AS cogs
    FROM donas_sales
    WHERE to_char(sold_at,'YYYY-MM') = $1
    `,
    [ym]
  );

  const r = rows?.[0] || {};
  return { revenue: toNum(r.revenue), cogs: toNum(r.cogs) };
}

async function getMaxYmFromMonthsOrData(baseYm) {
  await ensureMonthsTable();
  await ensurePurchasesTable();
  await ensureSalesTable();

  const candidates = [];

  const mQ = await db.query(
    `
    SELECT to_char(MAX(month), 'YYYY-MM') AS ym
    FROM donas_finance_months
    WHERE slug=$1
    `,
    [SLUG]
  );
  if (mQ.rows?.[0]?.ym) candidates.push(String(mQ.rows[0].ym));

  const pQ = await db.query(`SELECT to_char(MAX(date), 'YYYY-MM') AS ym FROM donas_purchases`, []);
  if (pQ.rows?.[0]?.ym) candidates.push(String(pQ.rows[0].ym));

  const sQ = await db.query(`SELECT to_char(MAX(sold_at), 'YYYY-MM') AS ym FROM donas_sales`, []);
  if (sQ.rows?.[0]?.ym) candidates.push(String(sQ.rows[0].ym));

  candidates.push(String(baseYm || ""));

  const ok = candidates.filter((x) => isYm(x)).sort();
  return ok.length ? ok[ok.length - 1] : null;
}

async function updateMonthAggSnapshot(ym) {
  if (!isYm(ym)) return null;

  await ensureMonthRow(ym);

  // if locked — don't overwrite snapshot
  if (await isMonthLocked(ym)) return await getLatestMonthRow(ym);

  const [s, p] = await Promise.all([sumSalesForMonth(ym), sumPurchasesForMonth(ym)]);
  const cur = (await getLatestMonthRow(ym)) || {};

  return await insertMonthSnapshot(ym, {
    revenue: toNum(s.revenue),
    cogs: toNum(s.cogs),
    opex: toNum(p.opex),
    capex: toNum(p.capex),
    loan_paid: toNum(cur.loan_paid),
    cash_end: toNum(cur.cash_end), // chain recalculated later
    notes: String(cur.notes || ""),
  });
}

/**
 * cash_end chain:
 * cash_end(ym) = cash_end(prevYm) + (revenue - cogs - opex - capex - loan_paid)
 * If no prev month row — start from settings.cash_start
 * Locked month: keep its cash_end and continue from it.
 */

function isDummyPrevMonthRow(row) {
  if (!row) return false;
  if (hasLockedTag(row.notes)) return false;

  const notes = String(row.notes || "").trim();

  // "пустышка" = всё ноль + пустые notes + cash_end=0
  return (
    toNum(row.revenue) === 0 &&
    toNum(row.cogs) === 0 &&
    toNum(row.opex) === 0 &&
    toNum(row.capex) === 0 &&
    toNum(row.loan_paid) === 0 &&
    toNum(row.cash_end) === 0 &&
    notes === ""
  );
}

async function recomputeCashChainFrom(startYm, endYm) {
  if (!isYm(endYm)) return;
  if (!isYm(startYm)) startYm = endYm;

  // Ensure rows exist
  let ym = startYm;
  while (String(ym).localeCompare(String(endYm)) <= 0) {
    await ensureMonthRow(ym);
    ym = nextYm(ym);
  }

  const prevRow = await getLatestMonthRow(prevYm(startYm));
  
  const prevCash =
    !prevRow || isDummyPrevMonthRow(prevRow)
      ? await getCashStartFromSettings()
      : toNum(prevRow.cash_end);
  
  let running = prevCash;


  ym = startYm;
  while (String(ym).localeCompare(String(endYm)) <= 0) {
    const row = await getLatestMonthRow(ym);
    if (!row) {
      ym = nextYm(ym);
      continue;
    }

    const revenue = toNum(row.revenue);
    const cogs = toNum(row.cogs);
    const opex = toNum(row.opex);
    const capex = toNum(row.capex);
    const loan = toNum(row.loan_paid);
    const cf = revenue - cogs - opex - capex - loan;

    if (hasLockedTag(row.notes)) {
      running = toNum(row.cash_end);
      ym = nextYm(ym);
      continue;
    }

    running += cf;

    await insertMonthSnapshot(ym, {
      revenue,
      cogs,
      opex,
      capex,
      loan_paid: loan,
      cash_end: running,
      notes: String(row.notes || ""),
    });

    ym = nextYm(ym);
  }

  return running;
}

/**
 * =========================
 * Controllers
 * =========================
 */

async function getSettings(req, res) {
  try {
    await ensureSettingsTable();

    const q = await db.query(
      `SELECT * FROM donas_finance_settings WHERE slug=$1 LIMIT 1`,
      [SLUG]
    );
    if (q.rows?.length) return res.json(q.rows[0]);

    const ins = await db.query(
      `
      INSERT INTO donas_finance_settings
        (slug, currency, owner_capital, bank_loan, cash_start, reserve_target_months, created_at, updated_at)
      VALUES
        ($1,'UZS',0,0,0,0, NOW(), NOW())
      RETURNING *
      `,
      [SLUG]
    );

    return res.json(ins.rows[0]);
  } catch (e) {
    console.error("[donasFinance] getSettings error:", e);
    return res.status(500).json({ error: "Failed" });
  }
}

async function updateSettings(req, res) {
  try {
    await ensureSettingsTable();
    await ensureMonthsTable();

    const b = req.body || {};
    const currency = String(b.currency || "UZS").trim() || "UZS";

    const owner_capital = toNum(b.owner_capital);
    const bank_loan = toNum(b.bank_loan);

    // ✅ cash_start = owner + bank (если хоть одно задано)
    // иначе fallback на то, что прислали явно (legacy режим)
    const cash_start =
      owner_capital !== 0 || bank_loan !== 0 ? owner_capital + bank_loan : toNum(b.cash_start);

    const q = await db.query(
      `
      INSERT INTO donas_finance_settings
        (slug, currency, cash_start, owner_capital, bank_loan,
         fixed_opex_month, variable_opex_month, loan_payment_month, reserve_target_months)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (slug)
      DO UPDATE SET
        currency=EXCLUDED.currency,
        cash_start=EXCLUDED.cash_start,
        owner_capital=EXCLUDED.owner_capital,
        bank_loan=EXCLUDED.bank_loan,
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
        owner_capital,
        bank_loan,
        toNum(b.fixed_opex_month),
        toNum(b.variable_opex_month),
        toNum(b.loan_payment_month), // оставляем колонку, даже если UI убрали
        toNum(b.reserve_target_months),
      ]
    );

    // ✅ пересчитываем cash_end по цепочке месяцев (если months есть)
  const mm = await db.query(
    `SELECT
       to_char(MIN(month),'YYYY-MM') AS minym,
       to_char(MAX(month),'YYYY-MM') AS maxym
     FROM donas_finance_months
     WHERE slug=$1`,
    [SLUG]
  );
  
  const startYm = String(mm.rows?.[0]?.minym || "");
  const endYm = String(mm.rows?.[0]?.maxym || "");
  
  if (isYm(startYm) && isYm(endYm)) {
    await recomputeCashChainFrom(startYm, endYm);
  }
    return res.json(q.rows[0]);
  } catch (e) {
    console.error("updateSettings error:", e);
    return res.status(500).json({ error: "Failed to save settings" });
  }
}

async function listMonths(req, res) {
  try {
    await ensureMonthsTable();
    const { rows } = await db.query(
      `
      SELECT
        to_char(month,'YYYY-MM') AS month,
        revenue, cogs, opex, capex, loan_paid, cash_end, notes,
        COALESCE(created_at, updated_at) AS created_at,
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

    const rawMinYm = String(minQ.rows?.[0]?.ym || "");
    const rawMaxYm = String(maxQ.rows?.[0]?.ym || "");

    let minYm = rawMinYm;
    let maxYm = rawMaxYm;

    if (!isYm(minYm) || !isYm(maxYm) || minYm === "9999-12" || maxYm === "0000-01") {
      return res.json({ ok: true, synced: 0, range: null });
    }

    // ✅ SAFETY FLOOR: never generate months earlier than 2025-01
    if (String(maxYm).localeCompare(String(MIN_YM_FLOOR)) < 0) {
      await auditMonthAction(
        req,
        MIN_YM_FLOOR,
        "months.sync",
        { minYm: null, maxYm: null, touched: 0, floorYm: MIN_YM_FLOOR, rawMinYm, rawMaxYm, skipped: true },
        {}
      );
      return res.json({ ok: true, synced: 0, range: null });
    }

    if (String(minYm).localeCompare(String(MIN_YM_FLOOR)) < 0) {
      minYm = MIN_YM_FLOOR;
    }

    let ym = minYm;
    let touched = 0;
    while (String(ym).localeCompare(String(maxYm)) <= 0) {
      await ensureMonthRow(ym);
      await updateMonthAggSnapshot(ym);
      touched++;
      ym = nextYm(ym);
    }

        // ✅ пересчитать цепочку по фактическим месяцам в таблице
    const mm = await db.query(
      `SELECT MIN(month) AS minm, MAX(month) AS maxm
       FROM donas_finance_months
       WHERE slug=$1`,
      [SLUG]
    );
    
    const minm = mm.rows?.[0]?.minm;
    const maxm = mm.rows?.[0]?.maxm;
    
    if (minm && maxm) {
      await recomputeCashChainFrom(monthToYm(minm), monthToYm(maxm));
    }

    await auditMonthAction(req, minYm, "months.sync", { minYm, maxYm, touched, floorYm: MIN_YM_FLOOR, rawMinYm, rawMaxYm }, {});
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

async function resnapshotMonth(req, res) {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    await ensureMonthRow(ym);

    const cur = (await getLatestMonthRow(ym)) || {};
    const locked = hasLockedTag(cur.notes);

    const [s, p] = await Promise.all([sumSalesForMonth(ym), sumPurchasesForMonth(ym)]);

    const out = await insertMonthSnapshot(ym, {
      revenue: toNum(s.revenue),
      cogs: toNum(s.cogs),
      opex: toNum(p.opex),
      capex: toNum(p.capex),
      loan_paid: toNum(cur.loan_paid),
      cash_end: toNum(cur.cash_end),
      notes: locked ? addLockedTag(cur.notes || "") : String(cur.notes || ""),
    });

    const endYm = (await getMaxYmFromMonthsOrData(ym)) || ym;
    await recomputeCashChainFrom(ym, endYm);

    await auditMonthAction(req, ym, "months.resnapshot", { ym }, { locked });
    return res.json({ ok: true, ym, month: out });
  } catch (e) {
    console.error("resnapshotMonth error:", e);
    return res.status(500).json({ error: "Failed to resnapshot month" });
  }
}

async function lockUpTo(req, res) {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    await ensureMonthsTable();

    const minQ = await db.query(
      `SELECT to_char(MIN(month),'YYYY-MM') AS ym FROM donas_finance_months WHERE slug=$1`,
      [SLUG]
    );
    const minYm = String(minQ.rows?.[0]?.ym || "");
    if (!isYm(minYm)) return res.json({ ok: true, locked: 0 });

    let cur = minYm;
    let lockedCount = 0;

    while (String(cur).localeCompare(String(ym)) <= 0) {
      await ensureMonthRow(cur);
      const row = await getLatestMonthRow(cur);
      if (row && !hasLockedTag(row.notes)) {
        await insertMonthSnapshot(cur, {
          revenue: toNum(row.revenue),
          cogs: toNum(row.cogs),
          opex: toNum(row.opex),
          capex: toNum(row.capex),
          loan_paid: toNum(row.loan_paid),
          cash_end: toNum(row.cash_end),
          notes: addLockedTag(row.notes || ""),
        });
        lockedCount++;
      }
      cur = nextYm(cur);
    }

    await auditMonthAction(req, ym, "months.lock_upto", { ym }, { lockedCount });
    return res.json({ ok: true, locked: lockedCount });
  } catch (e) {
    console.error("lockUpTo error:", e);
    return res.status(500).json({ error: "Failed to lock up to" });
  }
}

async function bulkResnapshot(req, res) {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    await ensureMonthsTable();

    const minQ = await db.query(
      `SELECT to_char(MIN(month),'YYYY-MM') AS ym FROM donas_finance_months WHERE slug=$1`,
      [SLUG]
    );
    const minYm = String(minQ.rows?.[0]?.ym || "");
    if (!isYm(minYm)) return res.json({ ok: true, updatedCount: 0 });

    let cur = minYm;
    let updated = 0;

    while (String(cur).localeCompare(String(ym)) <= 0) {
      await ensureMonthRow(cur);
      const row = await getLatestMonthRow(cur);
      if (row && hasLockedTag(row.notes)) {
        const [s, p] = await Promise.all([sumSalesForMonth(cur), sumPurchasesForMonth(cur)]);
        await insertMonthSnapshot(cur, {
          revenue: toNum(s.revenue),
          cogs: toNum(s.cogs),
          opex: toNum(p.opex),
          capex: toNum(p.capex),
          loan_paid: toNum(row.loan_paid),
          cash_end: toNum(row.cash_end),
          notes: addLockedTag(row.notes || ""),
        });
        updated++;
      }
      cur = nextYm(cur);
    }

    const endYm = (await getMaxYmFromMonthsOrData(ym)) || ym;
    await recomputeCashChainFrom(minYm, endYm);

    await auditMonthAction(req, ym, "months.bulk_resnapshot", { ym }, { updated });
    return res.json({ ok: true, updatedCount: updated });
  } catch (e) {
    console.error("bulkResnapshot error:", e);
    return res.status(500).json({ error: "Failed to bulk resnapshot" });
  }
}

/**
 * ===== UI helpers used by routes (IMPORTANT: must exist, иначе будет Undefined callback)
 */

async function lockPreview(req, res) {
  try {
    const ym = String(req.params.month || "").trim();
    const scope = String(req.query.scope || "single");
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    if (scope === "upto") {
      const minQ = await db.query(
        `SELECT to_char(MIN(month),'YYYY-MM') AS ym FROM donas_finance_months WHERE slug=$1`,
        [SLUG]
      );
      const minYm = String(minQ.rows?.[0]?.ym || "");
      const list = [];
      if (isYm(minYm)) {
        let cur = minYm;
        while (String(cur).localeCompare(String(ym)) <= 0) {
          const row = await getLatestMonthRow(cur);
          list.push({ ym: cur, locked: !!(row && hasLockedTag(row.notes)) });
          cur = nextYm(cur);
        }
      }
      return res.json({ ym, scope, months: list });
    }

    const row = await getLatestMonthRow(ym);
    return res.json({ ym, scope: "single", locked: !!(row && hasLockedTag(row.notes)) });
  } catch (e) {
    console.error("lockPreview error:", e);
    return res.status(500).json({ error: "Failed to preview lock" });
  }
}

async function resnapshotUpToPreview(req, res) {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    const minQ = await db.query(
      `SELECT to_char(MIN(month),'YYYY-MM') AS ym FROM donas_finance_months WHERE slug=$1`,
      [SLUG]
    );
    const minYm = String(minQ.rows?.[0]?.ym || "");
    const list = [];

    if (isYm(minYm)) {
      let cur = minYm;
      while (String(cur).localeCompare(String(ym)) <= 0) {
        const row = await getLatestMonthRow(cur);
        list.push({ ym: cur, locked: !!(row && hasLockedTag(row.notes)) });
        cur = nextYm(cur);
      }
    }

    return res.json({ ym, months: list });
  } catch (e) {
    console.error("resnapshotUpToPreview error:", e);
    return res.status(500).json({ error: "Failed to preview resnapshot" });
  }
}

async function resnapshotUpTo(req, res) {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    const minQ = await db.query(
      `SELECT to_char(MIN(month),'YYYY-MM') AS ym FROM donas_finance_months WHERE slug=$1`,
      [SLUG]
    );
    const minYm = String(minQ.rows?.[0]?.ym || "");
    if (!isYm(minYm)) return res.json({ ok: true, updatedCount: 0 });

    let cur = minYm;
    let updated = 0;

    while (String(cur).localeCompare(String(ym)) <= 0) {
      await ensureMonthRow(cur);
      const row = await getLatestMonthRow(cur);
      if (row && hasLockedTag(row.notes)) {
        const [s, p] = await Promise.all([sumSalesForMonth(cur), sumPurchasesForMonth(cur)]);
        await insertMonthSnapshot(cur, {
          revenue: toNum(s.revenue),
          cogs: toNum(s.cogs),
          opex: toNum(p.opex),
          capex: toNum(p.capex),
          loan_paid: toNum(row.loan_paid),
          cash_end: toNum(row.cash_end),
          notes: addLockedTag(row.notes || ""),
        });
        updated++;
      }
      cur = nextYm(cur);
    }

    const endYm = (await getMaxYmFromMonthsOrData(ym)) || ym;
    await recomputeCashChainFrom(minYm, endYm);

    await auditMonthAction(req, ym, "months.resnapshot_upto", { ym }, { updated });
    return res.json({ ok: true, updatedCount: updated });
  } catch (e) {
    console.error("resnapshotUpTo error:", e);
    return res.status(500).json({ error: "Failed to resnapshot up to" });
  }
}

/**
 * ===== Audit + CSV exports
 */

async function audit(req, res) {
  try {
    await ensureFinanceAudit();
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));
    const q = await db.query(
      `
      SELECT *
      FROM donas_finance_audit
      WHERE slug=$1
      ORDER BY created_at DESC, id DESC
      LIMIT $2
      `,
      [SLUG, limit]
    );
    return res.json(q.rows || []);
  } catch (e) {
    console.error("audit error:", e);
    return res.status(500).json({ error: "Failed to load audit" });
  }
}

async function auditMonth(req, res) {
  try {
    await ensureFinanceAudit();
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));
    const q = await db.query(
      `
      SELECT *
      FROM donas_finance_audit
      WHERE slug=$1 AND ym=$2
      ORDER BY created_at DESC, id DESC
      LIMIT $3
      `,
      [SLUG, ym, limit]
    );
    return res.json(q.rows || []);
  } catch (e) {
    console.error("auditMonth error:", e);
    return res.status(500).json({ error: "Failed to load month audit" });
  }
}

function csvEscape(v) {
  const s = v == null ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/\"/g, '""')}"`;
  return s;
}

async function exportCsv(req, res) {
  try {
    await ensureMonthsTable();
    const { rows } = await db.query(
      `
      SELECT
        to_char(month,'YYYY-MM') AS month,
        revenue, cogs, opex, capex, loan_paid, cash_end, notes,
        COALESCE(created_at, updated_at) AS created_at,
        updated_at
      FROM donas_finance_months
      WHERE slug=$1
      ORDER BY month ASC
      `,
      [SLUG]
    );

    const header = [
      "month",
      "revenue",
      "cogs",
      "opex",
      "capex",
      "loan_paid",
      "cash_end",
      "notes",
      "created_at",
      "updated_at",
    ];
    const lines = [header.join(",")];

    for (const r of rows || []) {
      lines.push(header.map((k) => csvEscape(r[k])).join(","));
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(lines.join("\n"));
  } catch (e) {
    console.error("exportCsv error:", e);
    return res.status(500).json({ error: "Failed to export csv" });
  }
}

async function exportAuditCsv(req, res) {
  try {
    await ensureFinanceAudit();
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));
    const q = await db.query(
      `
      SELECT *
      FROM donas_finance_audit
      WHERE slug=$1
      ORDER BY created_at DESC, id DESC
      LIMIT $2
      `,
      [SLUG, limit]
    );

    const rows = q.rows || [];
    const header = [
      "id",
      "slug",
      "ym",
      "action",
      "actor_id",
      "actor_role",
      "actor_email",
      "actor_name",
      "diff",
      "meta",
      "created_at",
    ];
    const lines = [header.join(",")];

    for (const r of rows) {
      lines.push(
        header
          .map((k) => csvEscape(typeof r[k] === "object" && r[k] != null ? JSON.stringify(r[k]) : r[k]))
          .join(",")
      );
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(lines.join("\n"));
  } catch (e) {
    console.error("exportAuditCsv error:", e);
    return res.status(500).json({ error: "Failed to export audit csv" });
  }
}

async function exportAuditMonthCsv(req, res) {
  try {
    await ensureFinanceAudit();
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));
    const q = await db.query(
      `
      SELECT *
      FROM donas_finance_audit
      WHERE slug=$1 AND ym=$2
      ORDER BY created_at DESC, id DESC
      LIMIT $3
      `,
      [SLUG, ym, limit]
    );

    const rows = q.rows || [];
    const header = [
      "id",
      "slug",
      "ym",
      "action",
      "actor_id",
      "actor_role",
      "actor_email",
      "actor_name",
      "diff",
      "meta",
      "created_at",
    ];
    const lines = [header.join(",")];

    for (const r of rows) {
      lines.push(
        header
          .map((k) => csvEscape(typeof r[k] === "object" && r[k] != null ? JSON.stringify(r[k]) : r[k]))
          .join(",")
      );
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(lines.join("\n"));
  } catch (e) {
    console.error("exportAuditMonthCsv error:", e);
    return res.status(500).json({ error: "Failed to export month audit csv" });
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
