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
  if (!s) return "";
  return s
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => x && x.toLowerCase() !== "#locked")
    .join("\n")
    .trim();
}

function nextYm(ym) {
  const [y, m] = String(ym).split("-").map((v) => Number(v));
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + 1);
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

function prevYm(ym) {
  const [y, m] = String(ym).split("-").map((v) => Number(v));
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

async function ensureSettingsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS donas_finance_settings (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL,
      opening_cash NUMERIC NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_donas_finance_settings_slug ON donas_finance_settings (slug);`);
}

async function ensureMonthsTable() {
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_donas_finance_months_slug_month ON donas_finance_months (slug, month);
  `);

  // ✅ Unique guard: needed for UPSERT. Some DBs already have donas_finance_months_slug_month_key.
  try {
    await db.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_donas_finance_months_slug_month ON donas_finance_months (slug, month);`
    );
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

  try {
    await db.query(
      `ALTER TABLE donas_sales
       ADD CONSTRAINT fk_donas_sales_menu_item
       FOREIGN KEY (menu_item_id) REFERENCES donas_menu_items(id)
       ON DELETE RESTRICT;`
    );
  } catch {}

  try {
    await db.query(
      `ALTER TABLE donas_sales
       ADD CONSTRAINT fk_donas_sales_cogs_snapshot
       FOREIGN KEY (cogs_snapshot_id) REFERENCES donas_cogs(id)
       ON DELETE SET NULL;`
    );
  } catch {}
}

async function ensureMonthRow(ym) {
  await ensureMonthsTable();
  const monthDate = ymToMonthDate(ym);

  const existing = await db.query(
    `SELECT * FROM donas_finance_months WHERE slug=$1 AND month=$2 LIMIT 1`,
    [SLUG, monthDate]
  );
  if (existing.rows && existing.rows[0]) return existing.rows[0];

  const inserted = await db.query(
    `
    INSERT INTO donas_finance_months (slug, month)
    VALUES ($1,$2)
    ON CONFLICT (slug, month) DO UPDATE SET slug=EXCLUDED.slug
    RETURNING *
    `,
    [SLUG, monthDate]
  );
  return inserted.rows[0];
}

async function getLatestMonthRow(ym) {
  await ensureMonthsTable();
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

async function isMonthLocked(ym) {
  if (!isYm(ym)) return false;
  const row = await getLatestMonthRow(ym);
  if (!row) return false;
  return hasLockedTag(row.notes);
}

async function getOpeningCash() {
  await ensureSettingsTable();
  const q = await db.query(
    `
    SELECT opening_cash
    FROM donas_finance_settings
    WHERE slug=$1
    ORDER BY id DESC
    LIMIT 1
    `,
    [SLUG]
  );
  return toNum(q.rows?.[0]?.opening_cash);
}

async function computeAggsForMonth(ym) {
  await ensureMonthsTable();
  await ensurePurchasesTable();
  await ensureSalesTable();

  // revenue from sales
  const salesQ = await db.query(
    `
    SELECT
      COALESCE(SUM(revenue_total),0) AS revenue,
      COALESCE(SUM(cogs_total),0) AS cogs
    FROM donas_sales
    WHERE to_char(sold_at,'YYYY-MM')=$1
    `,
    [ym]
  );

  const revenue = toNum(salesQ.rows?.[0]?.revenue);
  const cogs = toNum(salesQ.rows?.[0]?.cogs);

  // purchases (opex/capex) from donas_purchases
  const start = `${ym}-01`;
  const end = `${nextYm(ym)}-01`;

  const purQ = await db.query(
    `
    SELECT
      lower(type) AS type,
      COALESCE(SUM(total),0) AS total
    FROM donas_purchases
    WHERE date >= $1 AND date < $2
    GROUP BY lower(type)
    `,
    [start, end]
  );

  let opex = 0;
  let capex = 0;
  let loanPaid = 0;

  for (const r of purQ.rows || []) {
    const t = String(r.type || "").toLowerCase();
    const v = toNum(r.total);
    if (t === "opex") opex += v;
    else if (t === "capex") capex += v;
    else if (t === "loan" || t === "loan_paid") loanPaid += v;
    // NOTE: "cogs" purchases are not used here — COGS comes from sales snapshots
  }

  return { revenue, cogs, opex, capex, loan_paid: loanPaid };
}

/**
 * ✅ UPSERT version
 * Fixes: duplicate key value violates unique constraint (slug, month)
 */
async function insertMonthSnapshot(ym, payload) {
  await ensureMonthsTable();

  const p = payload || {};
  const revenue = toNum(p.revenue);
  const cogs = toNum(p.cogs);
  const opex = toNum(p.opex);
  const capex = toNum(p.capex);
  const loanPaid = toNum(p.loan_paid);
  const cashEnd = toNum(p.cash_end);
  const notes = String(p.notes || "");

  const { rows } = await db.query(
    `
    INSERT INTO donas_finance_months
      (slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes)
    VALUES
      ($1, ($2 || '-01')::date, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (slug, month)
    DO UPDATE SET
      revenue   = EXCLUDED.revenue,
      cogs      = EXCLUDED.cogs,
      opex      = EXCLUDED.opex,
      capex     = EXCLUDED.capex,
      loan_paid = EXCLUDED.loan_paid,
      cash_end  = EXCLUDED.cash_end,
      notes     = EXCLUDED.notes
    RETURNING *
    `,
    [SLUG, ym, revenue, cogs, opex, capex, loanPaid, cashEnd, notes]
  );

  return rows?.[0] || null;
}

async function updateMonthAggSnapshot(ym) {
  if (!isYm(ym)) return null;

  // ✅ do not modify locked months
  if (await isMonthLocked(ym)) return getLatestMonthRow(ym);

  await ensureMonthRow(ym);

  const agg = await computeAggsForMonth(ym);

  // cash_end will be recomputed by chain later; here keep existing and update payload
  const cur = (await getLatestMonthRow(ym)) || {};
  const cashEnd = toNum(cur.cash_end);

  const payload = {
    revenue: agg.revenue,
    cogs: agg.cogs,
    opex: agg.opex,
    capex: agg.capex,
    loan_paid: agg.loan_paid,
    cash_end: cashEnd,
    notes: String(cur.notes || ""),
  };

  return insertMonthSnapshot(ym, payload);
}

/**
 * ✅ Used by auto-sync utils: recompute month aggregates (only if not locked).
 * Backward-compatible alias for updateMonthAggSnapshot (it already guards #locked).
 */
async function updateMonthAgg(ym) {
  return updateMonthAggSnapshot(ym);
}

async function recomputeCashChainFrom(startYm, endYm) {
  if (!isYm(startYm) || !isYm(endYm)) return;

  await ensureMonthsTable();
  await ensureSettingsTable();

  // we recompute starting from startYm (inclusive) to endYm (inclusive)
  const openingCash = await getOpeningCash();

  // find previous month cash_end (or opening cash)
  const prev = prevYm(startYm);
  let carry = openingCash;

  const prevRow = await getLatestMonthRow(prev);
  if (prevRow) carry = toNum(prevRow.cash_end);

  let ym = startYm;
  while (true) {
    // lock guard: keep cash_end if locked, but still carry it forward
    const row = await getLatestMonthRow(ym);
    if (!row) {
      await ensureMonthRow(ym);
    }

    const cur = (await getLatestMonthRow(ym)) || {};
    const locked = hasLockedTag(cur.notes);

    let cashEnd = toNum(cur.cash_end);
    if (!locked) {
      const revenue = toNum(cur.revenue);
      const cogs = toNum(cur.cogs);
      const opex = toNum(cur.opex);
      const capex = toNum(cur.capex);
      const loanPaid = toNum(cur.loan_paid);

      cashEnd = carry + revenue - cogs - opex - capex - loanPaid;

      await insertMonthSnapshot(ym, {
        revenue,
        cogs,
        opex,
        capex,
        loan_paid: loanPaid,
        cash_end: cashEnd,
        notes: String(cur.notes || ""),
      });
    }

    carry = cashEnd;

    if (ym === endYm) break;
    ym = nextYm(ym);
  }
}

/**
 * =========================
 * Finance audit helpers
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
        id,
        slug,
        ym,
        action,
        actor_id,
        actor_role,
        actor_email,
        actor_name,
        diff,
        meta,
        created_at
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
        ym,
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
 * Controllers
 * =========================
 */

async function getSettings(req, res) {
  try {
    await ensureSettingsTable();
    const q = await db.query(
      `
      SELECT opening_cash
      FROM donas_finance_settings
      WHERE slug=$1
      ORDER BY id DESC
      LIMIT 1
      `,
      [SLUG]
    );
    res.json({ opening_cash: toNum(q.rows?.[0]?.opening_cash) });
  } catch (e) {
    console.error("getSettings error:", e);
    res.status(500).json({ error: "Failed to load settings" });
  }
}

async function updateSettings(req, res) {
  try {
    await ensureSettingsTable();
    const opening_cash = toNum(req.body?.opening_cash);

    await db.query(
      `
      INSERT INTO donas_finance_settings (slug, opening_cash)
      VALUES ($1,$2)
      `,
      [SLUG, opening_cash]
    );

    // recompute chain from earliest month to latest
    const q = await db.query(
      `SELECT to_char(min(month),'YYYY-MM') AS min_ym, to_char(max(month),'YYYY-MM') AS max_ym
       FROM donas_finance_months
       WHERE slug=$1`,
      [SLUG]
    );
    const minYm = q.rows?.[0]?.min_ym;
    const maxYm = q.rows?.[0]?.max_ym;
    if (isYm(minYm) && isYm(maxYm)) {
      const start = minYm;
      const end = maxYm;
      await recomputeCashChainFrom(start, end);
    }

    await auditMonthAction(req, monthToYm(new Date().toISOString()), "settings.update", { opening_cash }, {});

    res.json({ ok: true, opening_cash });
  } catch (e) {
    console.error("updateSettings error:", e);
    res.status(500).json({ error: "Failed to update settings" });
  }
}

async function listMonths(req, res) {
  try {
    await ensureMonthsTable();
    const q = await db.query(
      `
      SELECT
        to_char(month,'YYYY-MM') AS ym,
        revenue, cogs, opex, capex, loan_paid, cash_end,
        notes,
        created_at
      FROM donas_finance_months
      WHERE slug=$1
      ORDER BY month ASC
      `,
      [SLUG]
    );
    res.json({ rows: q.rows || [] });
  } catch (e) {
    console.error("listMonths error:", e);
    res.status(500).json({ error: "Failed to load months" });
  }
}

async function syncMonths(req, res) {
  try {
    await ensureMonthsTable();

    // compute range by existing months OR by data in purchases/sales
    const q1 = await db.query(
      `SELECT to_char(min(month),'YYYY-MM') AS min_ym, to_char(max(month),'YYYY-MM') AS max_ym
       FROM donas_finance_months
       WHERE slug=$1`,
      [SLUG]
    );

    const existingMin = q1.rows?.[0]?.min_ym;
    const existingMax = q1.rows?.[0]?.max_ym;

    await ensurePurchasesTable();
    await ensureSalesTable();

    const q2 = await db.query(
      `SELECT
         MIN(d) AS min_d,
         MAX(d) AS max_d
       FROM (
         SELECT MIN(date) AS d FROM donas_purchases
         UNION ALL
         SELECT MIN(sold_at) AS d FROM donas_sales
       ) t`
    );
    const q3 = await db.query(
      `SELECT
         MIN(d) AS min_d,
         MAX(d) AS max_d
       FROM (
         SELECT MAX(date) AS d FROM donas_purchases
         UNION ALL
         SELECT MAX(sold_at) AS d FROM donas_sales
       ) t`
    );

    const dataMin = q2.rows?.[0]?.min_d ? monthToYm(q2.rows[0].min_d) : null;
    const dataMax = q3.rows?.[0]?.max_d ? monthToYm(q3.rows[0].max_d) : null;

    let minYm = existingMin || dataMin;
    let maxYm = existingMax || dataMax;

    if (dataMin && (!minYm || dataMin < minYm)) minYm = dataMin;
    if (dataMax && (!maxYm || dataMax > maxYm)) maxYm = dataMax;

    if (!isYm(minYm) || !isYm(maxYm)) {
      return res.json({ ok: true, rows: [] });
    }

    // build months
    let ym = minYm;
    while (true) {
      await ensureMonthRow(ym);
      await updateMonthAggSnapshot(ym);
      if (ym === maxYm) break;
      ym = nextYm(ym);
    }

    // recompute cash chain
    await recomputeCashChainFrom(minYm, maxYm);

    await auditMonthAction(req, maxYm, "months.sync", { minYm, maxYm }, {});

    const out = await db.query(
      `
      SELECT
        to_char(month,'YYYY-MM') AS ym,
        revenue, cogs, opex, capex, loan_paid, cash_end,
        notes,
        created_at
      FROM donas_finance_months
      WHERE slug=$1
      ORDER BY month ASC
      `,
      [SLUG]
    );

    res.json({ ok: true, rows: out.rows || [] });
  } catch (e) {
    console.error("syncMonths error:", e);
    res.status(500).json({ error: "Failed to sync months" });
  }
}

async function updateMonth(req, res) {
  try {
    await ensureMonthsTable();

    const ym = String(req.params.month || "");
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    const cur = await getLatestMonthRow(ym);
    if (cur && hasLockedTag(cur.notes)) {
      return res.status(409).json({ error: `Month ${ym} is locked (#locked)` });
    }

    await ensureMonthRow(ym);

    // Only allow manual edits for these fields (typical)
    const patch = req.body || {};

    const revenue = patch.revenue == null ? toNum(cur?.revenue) : toNum(patch.revenue);
    const cogs = patch.cogs == null ? toNum(cur?.cogs) : toNum(patch.cogs);
    const opex = patch.opex == null ? toNum(cur?.opex) : toNum(patch.opex);
    const capex = patch.capex == null ? toNum(cur?.capex) : toNum(patch.capex);
    const loan_paid = patch.loan_paid == null ? toNum(cur?.loan_paid) : toNum(patch.loan_paid);
    const notes = patch.notes == null ? String(cur?.notes || "") : String(patch.notes || "");

    const cash_end = toNum(cur?.cash_end);

    await insertMonthSnapshot(ym, { revenue, cogs, opex, capex, loan_paid, cash_end, notes });

    // recompute chain from previous month to end
    const endQ = await db.query(
      `SELECT to_char(max(month),'YYYY-MM') AS max_ym FROM donas_finance_months WHERE slug=$1`,
      [SLUG]
    );
    const endYm = endQ.rows?.[0]?.max_ym || ym;
    await recomputeCashChainFrom(prevYm(ym), endYm);

    await auditMonthAction(req, ym, "months.update", { ym }, patch);

    const out = await getLatestMonthRow(ym);
    res.json({ ok: true, row: out });
  } catch (e) {
    console.error("updateMonth error:", e);
    res.status(500).json({ error: "Failed to update month" });
  }
}

async function lockMonth(req, res) {
  try {
    const ym = String(req.params.month || "");
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    await ensureMonthRow(ym);

    const cur = (await getLatestMonthRow(ym)) || {};
    const notes = addLockedTag(cur.notes);

    await insertMonthSnapshot(ym, {
      revenue: toNum(cur.revenue),
      cogs: toNum(cur.cogs),
      opex: toNum(cur.opex),
      capex: toNum(cur.capex),
      loan_paid: toNum(cur.loan_paid),
      cash_end: toNum(cur.cash_end),
      notes,
    });

    await auditMonthAction(req, ym, "months.lock", { ym }, {});

    res.json({ ok: true });
  } catch (e) {
    console.error("lockMonth error:", e);
    res.status(500).json({ error: "Failed to lock month" });
  }
}

async function unlockMonth(req, res) {
  try {
    const ym = String(req.params.month || "");
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    await ensureMonthRow(ym);

    const cur = (await getLatestMonthRow(ym)) || {};
    const notes = removeLockedTag(cur.notes);

    await insertMonthSnapshot(ym, {
      revenue: toNum(cur.revenue),
      cogs: toNum(cur.cogs),
      opex: toNum(cur.opex),
      capex: toNum(cur.capex),
      loan_paid: toNum(cur.loan_paid),
      cash_end: toNum(cur.cash_end),
      notes,
    });

    // after unlock: recompute aggregates and chain
    await updateMonthAggSnapshot(ym);

    const endQ = await db.query(
      `SELECT to_char(max(month),'YYYY-MM') AS max_ym FROM donas_finance_months WHERE slug=$1`,
      [SLUG]
    );
    const endYm = endQ.rows?.[0]?.max_ym || ym;
    await recomputeCashChainFrom(prevYm(ym), endYm);

    await auditMonthAction(req, ym, "months.unlock", { ym }, {});

    res.json({ ok: true });
  } catch (e) {
    console.error("unlockMonth error:", e);
    res.status(500).json({ error: "Failed to unlock month" });
  }
}

async function resnapshotMonth(req, res) {
  try {
    const ym = String(req.params.month || "");
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    if (await isMonthLocked(ym)) {
      return res.status(409).json({ error: `Month ${ym} is locked (#locked)` });
    }

    await ensureMonthRow(ym);
    await updateMonthAggSnapshot(ym);

    const endQ = await db.query(
      `SELECT to_char(max(month),'YYYY-MM') AS max_ym FROM donas_finance_months WHERE slug=$1`,
      [SLUG]
    );
    const endYm = endQ.rows?.[0]?.max_ym || ym;

    await recomputeCashChainFrom(prevYm(ym), endYm);

    await auditMonthAction(req, ym, "months.resnapshot", { ym }, {});

    res.json({ ok: true });
  } catch (e) {
    console.error("resnapshotMonth error:", e);
    res.status(500).json({ error: "Failed to resnapshot month" });
  }
}

exports.getSettings = getSettings;
exports.updateSettings = updateSettings;
exports.listMonths = listMonths;
exports.syncMonths = syncMonths;
exports.updateMonth = updateMonth;
exports.lockMonth = lockMonth;
exports.unlockMonth = unlockMonth;
exports.resnapshotMonth = resnapshotMonth;

exports._internal = {
  SLUG,
  toNum,
  isYm,
  nextYm,
  prevYm,
  ymToMonthDate,
  monthToYm,
  hasLockedTag,
  addLockedTag,
  removeLockedTag,
  ensureMonthsTable,
  ensureMonthRow,
  getLatestMonthRow,
  computeAggsForMonth,
  insertMonthSnapshot,
  updateMonthAggSnapshot,
  updateMonthAgg,
  recomputeCashChainFrom,
  auditMonthAction,
};
