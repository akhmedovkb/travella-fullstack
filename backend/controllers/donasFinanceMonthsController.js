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
  // ✅ robust: accepts Date, ISO string, "YYYY-MM-DD", "YYYY-MM"
  if (!m && m !== 0) return "";
  if (m instanceof Date && !Number.isNaN(m.getTime())) {
    const y = m.getFullYear();
    const mm = String(m.getMonth() + 1).padStart(2, "0");
    return `${y}-${mm}`;
  }
  const s = String(m || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 7);
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${mm}`;
  }
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
    .filter((l) => !String(l).toLowerCase().includes("#locked"))
    .join("\n")
    .trim();
}

// ✅ FIX: always return month as "YYYY-MM" string (no Date/ISO in API)
function normalizeMonthRow(r) {
  if (!r) return r;
  return { ...r, month: monthToYm(r.month) };
}

function clampInt(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

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

async function ensureAuditTable(client = db) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS donas_finance_months_audit (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL,
      month DATE NOT NULL,
      action TEXT NOT NULL,
      actor_id BIGINT,
      actor_role TEXT,
      actor_email TEXT,
      actor_name TEXT,
      diff JSONB NOT NULL DEFAULT '{}'::jsonb,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE OR REPLACE VIEW donas_finance_months_audit_view AS
    SELECT
      id,
      slug,
      to_char(month, 'YYYY-MM') AS ym,
      action,
      actor_id,
      actor_role,
      actor_email,
      actor_name,
      diff,
      meta,
      created_at
    FROM donas_finance_months_audit
    ORDER BY id DESC;
  `);
}

async function auditMonthAction(req, ym, action, diff = {}, meta = {}) {
  try {
    if (!isYm(ym)) return;
    await ensureAuditTable();
    const actor = getActor(req);
    await db.query(
      `
      INSERT INTO donas_finance_months_audit
        (slug, month, action, actor_id, actor_role, actor_email, actor_name, diff, meta)
      VALUES
        ($1, ($2)::date, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
      `,
      [
        SLUG,
        ymToMonthDate(ym),
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
 * Ensure settings
 * =========================
 */

async function ensureSettingsRow() {
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
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const q = await db.query(`SELECT * FROM donas_finance_settings WHERE slug=$1 LIMIT 1`, [SLUG]);
  if (q.rows?.[0]) return q.rows[0];

  const ins = await db.query(
    `
    INSERT INTO donas_finance_settings
      (slug, currency, cash_start, fixed_opex_month, variable_opex_month, loan_payment_month, reserve_target_months)
    VALUES
      ($1,'UZS',0,0,0,0,0)
    RETURNING *
    `,
    [SLUG]
  );
  return ins.rows[0];
}

async function getCashStartSeed() {
  try {
    const s = await ensureSettingsRow();
    return toNum(s?.cash_start);
  } catch {
    return 0;
  }
}

/**
 * =========================
 * Ensure months table (snapshots)
 * =========================
 */
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
}

/**
 * =========================
 * Aggregations
 * =========================
 */

// Sales → revenue/cogs
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

  await db.query(`
    ALTER TABLE donas_sales
      ADD COLUMN IF NOT EXISTS menu_item_id BIGINT,
      ADD COLUMN IF NOT EXISTS qty NUMERIC NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS unit_price NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS revenue_total NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS cogs_snapshot_id BIGINT,
      ADD COLUMN IF NOT EXISTS cogs_unit NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS cogs_total NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'cash',
      ADD COLUMN IF NOT EXISTS notes TEXT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
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

async function getSalesAggForMonth(ym) {
  await ensureSalesTable();
  const { rows } = await db.query(
    `
    SELECT
      COALESCE(SUM(revenue_total),0) AS revenue,
      COALESCE(SUM(cogs_total),0)    AS cogs
    FROM donas_sales
    WHERE to_char(sold_at,'YYYY-MM') = $1
    `,
    [ym]
  );
  const r = rows?.[0] || {};
  return { revenue: toNum(r.revenue), cogs: toNum(r.cogs) };
}

// Purchases → opex/capex
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

async function getPurchasesAggForMonth(ym) {
  await ensurePurchasesTable();
  const { rows } = await db.query(
    `
    SELECT
      COALESCE(SUM(CASE WHEN upper(type)='OPEX'  THEN total ELSE 0 END),0) AS opex,
      COALESCE(SUM(CASE WHEN upper(type)='CAPEX' THEN total ELSE 0 END),0) AS capex
    FROM donas_purchases
    WHERE to_char(date,'YYYY-MM') = $1
    `,
    [ym]
  );
  const r = rows?.[0] || {};
  return { opex: toNum(r.opex), capex: toNum(r.capex) };
}

/**
 * =========================
 * Snapshot helpers (append-only)
 * =========================
 */

async function getLatestMonthRow(ym) {
  await ensureMonthsTable();
  const q = await db.query(
    `
    SELECT *
    FROM donas_finance_months
    WHERE slug=$1 AND month=($2)::date
    ORDER BY id DESC
    LIMIT 1
    `,
    [SLUG, ymToMonthDate(ym)]
  );
  return q.rows?.[0] || null;
}

async function ensureMonthRow(ym) {
  const existing = await getLatestMonthRow(ym);
  if (existing) return existing;

  const ins = await db.query(
    `
    INSERT INTO donas_finance_months
      (slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes)
    VALUES
      ($1, ($2)::date, 0, 0, 0, 0, 0, 0, '')
    RETURNING *
    `,
    [SLUG, ymToMonthDate(ym)]
  );
  return ins.rows[0];
}

async function insertMonthSnapshot(ym, patch = {}) {
  const cur = await ensureMonthRow(ym);

  const next = {
    revenue: patch.revenue == null ? toNum(cur.revenue) : toNum(patch.revenue),
    cogs: patch.cogs == null ? toNum(cur.cogs) : toNum(patch.cogs),
    opex: patch.opex == null ? toNum(cur.opex) : toNum(patch.opex),
    capex: patch.capex == null ? toNum(cur.capex) : toNum(patch.capex),
    loan_paid: patch.loan_paid == null ? toNum(cur.loan_paid) : toNum(patch.loan_paid),
    cash_end: patch.cash_end == null ? toNum(cur.cash_end) : toNum(patch.cash_end),
    notes: patch.notes === undefined ? String(cur.notes || "") : String(patch.notes || ""),
  };

  const ins = await db.query(
    `
    INSERT INTO donas_finance_months
      (slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes)
    VALUES
      ($1, ($2)::date, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
    `,
    [
      SLUG,
      ymToMonthDate(ym),
      next.revenue,
      next.cogs,
      next.opex,
      next.capex,
      next.loan_paid,
      next.cash_end,
      next.notes,
    ]
  );

  return ins.rows[0];
}

async function isMonthLocked(ym) {
  const row = await ensureMonthRow(ym);
  return hasLockedTag(row?.notes || "");
}

function nextYm(ym) {
  const [y, m] = String(ym).split("-").map((v) => Number(v));
  const d = new Date(Date.UTC(y, m - 1 + 1, 1));
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

function prevYm(ym) {
  const [y, m] = String(ym).split("-").map((v) => Number(v));
  const d = new Date(Date.UTC(y, m - 1 - 1, 1));
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

async function getMaxYmFromMonthsOrData(fallbackYm) {
  try {
    await ensureMonthsTable();

    const q1 = await db.query(
      `
      SELECT MAX(to_char(month,'YYYY-MM')) AS max_ym
      FROM donas_finance_months
      WHERE slug=$1
      `,
      [SLUG]
    );
    const max1 = q1.rows?.[0]?.max_ym;
    if (isYm(max1)) return max1;

    // sales+purchases max
    const q2 = await db.query(
      `
      SELECT MAX(to_char(d,'YYYY-MM')) AS max_ym
      FROM (
        SELECT sold_at::date AS d FROM donas_sales
        UNION ALL
        SELECT date::date AS d FROM donas_purchases
      ) t
      `
    );
    const max2 = q2.rows?.[0]?.max_ym;
    if (isYm(max2)) return max2;
  } catch {
    // ignore
  }

  return isYm(fallbackYm) ? fallbackYm : null;
}

async function updateMonthAggSnapshot(ym) {
  const cur = await ensureMonthRow(ym);
  const locked = hasLockedTag(cur.notes || "");
  if (locked) {
    // 🔒 locked сам по себе можно переснимать (UI), но обычный sync не обязан
    return { ym, ok: true, locked: true, updated: false };
  }

  const [sales, pur] = await Promise.all([getSalesAggForMonth(ym), getPurchasesAggForMonth(ym)]);

  await insertMonthSnapshot(ym, {
    revenue: sales.revenue,
    cogs: sales.cogs,
    opex: pur.opex,
    capex: pur.capex,
    // loan_paid/notes/cash_end сохраняем как в текущем
  });

  return { ym, ok: true, locked: false, updated: true, ...sales, ...pur };
}

// ✅ Helper: recompute month aggregates (if NOT locked)
async function updateMonthAgg(ym) {
  return updateMonthAggSnapshot(ym);
}


// cash_end chain (append-only):
// - locked: не трогаем, но используем cash_end locked как seed дальше
// - unlocked: вставляем новый snapshot с пересчитанным cash_end
async function recomputeCashChainFrom(startYm, endYm) {
  // ensure all months exist
  let cur = startYm;
  while (true) {
    await ensureMonthRow(cur);
    if (cur === endYm) break;
    cur = nextYm(cur);
  }

  // seed prevCash from previous month cash_end (or settings.cash_start)
  const pYm = prevYm(startYm);
  let prevCash = 0;
  let prevFound = false;

  try {
    const q = await db.query(
      `
      SELECT cash_end
      FROM donas_finance_months
      WHERE slug=$1 AND month=($2)::date
      ORDER BY id DESC
      LIMIT 1
      `,
      [SLUG, ymToMonthDate(pYm)]
    );
    if (q.rows?.[0]) {
      prevCash = toNum(q.rows[0].cash_end);
      prevFound = true;
    }
  } catch {}

  if (!prevFound) prevCash = await getCashStartSeed();

  const results = [];
  cur = startYm;

  while (true) {
    const row = await ensureMonthRow(cur);
    const locked = hasLockedTag(row?.notes || "");

    if (locked) {
      const lockedCash = toNum(row.cash_end);
      results.push({ ym: cur, locked: true, cash_end: lockedCash, updated: false });
      prevCash = lockedCash;
    } else {
      const revenue = toNum(row.revenue);
      const cogs = toNum(row.cogs);
      const opex = toNum(row.opex);
      const capex = toNum(row.capex);
      const loan = toNum(row.loan_paid);

      const cf = revenue - cogs - opex - capex - loan;
      const cashEnd = prevCash + cf;

      await insertMonthSnapshot(cur, { cash_end: cashEnd });

      results.push({ ym: cur, locked: false, updated: true, cf, cash_end: cashEnd });
      prevCash = cashEnd;
    }

    if (cur === endYm) break;
    cur = nextYm(cur);
  }

  return results;
}

/**
 * =========================
 * Controllers
 * =========================
 */

// GET /api/admin/donas/finance/settings
exports.getSettings = async (req, res) => {
  try {
    const row = await ensureSettingsRow();
    return res.json(row);
  } catch (e) {
    console.error("getSettings error:", e);
    return res.status(500).json({ error: "Failed to load settings" });
  }
};

// PUT /api/admin/donas/finance/settings
exports.updateSettings = async (req, res) => {
  try {
    const cur = await ensureSettingsRow();
    const b = req.body || {};

    const currency = String(b.currency || cur.currency || "UZS").trim() || "UZS";
    const cash_start = b.cash_start == null ? toNum(cur.cash_start) : toNum(b.cash_start);
    const fixed_opex_month =
      b.fixed_opex_month == null ? toNum(cur.fixed_opex_month) : toNum(b.fixed_opex_month);
    const variable_opex_month =
      b.variable_opex_month == null
        ? toNum(cur.variable_opex_month)
        : toNum(b.variable_opex_month);
    const loan_payment_month =
      b.loan_payment_month == null ? toNum(cur.loan_payment_month) : toNum(b.loan_payment_month);
    const reserve_target_months =
      b.reserve_target_months == null
        ? toNum(cur.reserve_target_months)
        : toNum(b.reserve_target_months);

    const { rows } = await db.query(
      `
      UPDATE donas_finance_settings
      SET currency=$1,
          cash_start=$2,
          fixed_opex_month=$3,
          variable_opex_month=$4,
          loan_payment_month=$5,
          reserve_target_months=$6,
          updated_at=NOW()
      WHERE slug=$7
      RETURNING *
      `,
      [
        currency,
        cash_start,
        fixed_opex_month,
        variable_opex_month,
        loan_payment_month,
        reserve_target_months,
        SLUG,
      ]
    );

    await auditMonthAction(req, "1970-01", "settings.update", rows?.[0] || {}, {});
    return res.json(rows[0]);
  } catch (e) {
    console.error("updateSettings error:", e);
    return res.status(500).json({ error: "Failed to update settings" });
  }
};

// GET /api/admin/donas/finance/months
exports.listMonths = async (req, res) => {
  try {
    await ensureMonthsTable();
    const { rows } = await db.query(
      `
      SELECT DISTINCT ON (month)
        *
      FROM donas_finance_months
      WHERE slug=$1
      ORDER BY month ASC, id DESC
      `,
      [SLUG]
    );

    return res.json((rows || []).map(normalizeMonthRow));
  } catch (e) {
    console.error("listMonths error:", e);
    return res.status(500).json({ error: "Failed to load months" });
  }
};

/**
 * POST /api/admin/donas/finance/months/sync
 * Optional body: { from?: 'YYYY-MM', to?: 'YYYY-MM' }
 */
exports.syncMonths = async (req, res) => {
  try {
    await ensureMonthsTable();
    await ensureSalesTable();
    await ensurePurchasesTable();

    const b = req.body || {};
    let from = isYm(b.from) ? b.from : null;
    let to = isYm(b.to) ? b.to : null;

    let startYm = from;
    let endYm = to;

    if (!startYm || !endYm) {
      const q = await db.query(
        `
        SELECT
          MIN(to_char(d,'YYYY-MM')) AS min_ym,
          MAX(to_char(d,'YYYY-MM')) AS max_ym
        FROM (
          SELECT sold_at::date AS d FROM donas_sales
          UNION ALL
          SELECT date::date AS d FROM donas_purchases
        ) t
        `
      );
      startYm = startYm || q.rows?.[0]?.min_ym || null;
      endYm = endYm || q.rows?.[0]?.max_ym || null;
    }

    if (!startYm || !endYm) {
      return res.json({ ok: true, touched: [], cash: [], reason: "no_data" });
    }

    if (String(startYm).localeCompare(String(endYm)) > 0) {
      const tmp = startYm;
      startYm = endYm;
      endYm = tmp;
    }

    const chainStart = prevYm(startYm);

    // touch range + chainStart
    const touched = [];
    const ymSet = new Set([chainStart]);
    let cur = startYm;
    while (true) {
      ymSet.add(cur);
      if (cur === endYm) break;
      cur = nextYm(cur);
    }

    const ymsToUpdate = Array.from(ymSet).filter(isYm).sort();
    for (const m of ymsToUpdate) {
      touched.push(await updateMonthAggSnapshot(m));
    }

    const cash = await recomputeCashChainFrom(chainStart, endYm);

    await auditMonthAction(req, endYm, "months.sync", { startYm, endYm }, { touched_count: touched.length });

    return res.json({ ok: true, range: { startYm, endYm }, chainStart, touched, cash });
  } catch (e) {
    console.error("syncMonths error:", e);
    return res.status(500).json({ error: "Failed to sync months" });
  }
};

/**
 * PUT /api/admin/donas/finance/months/:month
 * month = YYYY-MM
 * body: { loan_paid?, notes? }
 */
exports.updateMonth = async (req, res) => {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    const cur = await ensureMonthRow(ym);
    const b = req.body || {};

    const loan_paid = b.loan_paid == null ? toNum(cur.loan_paid) : toNum(b.loan_paid);
    const notes = b.notes === undefined ? String(cur.notes || "") : String(b.notes || "");

    if (hasLockedTag(cur.notes)) {
      return res.status(409).json({ error: `Month ${ym} is locked (#locked)` });
    }
    if (String(notes || "").toLowerCase().includes("#locked")) {
      return res.status(400).json({ error: "Do not add #locked manually. Use Lock button." });
    }

    const snap = await insertMonthSnapshot(ym, { loan_paid, notes });

    await auditMonthAction(req, ym, "months.update", { loan_paid, notes }, {});

    // cash_end chain: update this month and all future months up to current max
    const endYm = (await getMaxYmFromMonthsOrData(ym)) || ym;
    const chainStart = prevYm(ym);
    const cash = await recomputeCashChainFrom(chainStart, endYm);

    return res.json({ ok: true, month: normalizeMonthRow(snap), chainStart, endYm, cash });
  } catch (e) {
    console.error("updateMonth error:", e);
    return res.status(500).json({ error: "Failed to update month" });
  }
};

exports.lockMonth = async (req, res) => {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    const cur = await ensureMonthRow(ym);
    const nextNotes = addLockedTag(cur.notes);

    const snap = await insertMonthSnapshot(ym, { notes: nextNotes });

    await auditMonthAction(req, ym, "months.lock", { notes: nextNotes }, {});

    return res.json({ ok: true, month: normalizeMonthRow(snap) });
  } catch (e) {
    console.error("lockMonth error:", e);
    return res.status(500).json({ error: "Failed to lock month" });
  }
};

exports.unlockMonth = async (req, res) => {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    const cur = await ensureMonthRow(ym);
    const nextNotes = removeLockedTag(cur.notes);

    const snap = await insertMonthSnapshot(ym, { notes: nextNotes });

    await auditMonthAction(req, ym, "months.unlock", { notes: nextNotes }, {});

    return res.json({ ok: true, month: normalizeMonthRow(snap) });
  } catch (e) {
    console.error("unlockMonth error:", e);
    return res.status(500).json({ error: "Failed to unlock month" });
  }
};

/**
 * ✅ UI: Re-snapshot доступен ИМЕННО для locked.
 * Здесь переснимаем агрегаты месяца из Sales+Purchases, но сохраняем #locked в notes.
 */
exports.resnapshotMonth = async (req, res) => {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    const cur = await ensureMonthRow(ym);
    const locked = hasLockedTag(cur.notes || "");

    const [sales, pur] = await Promise.all([getSalesAggForMonth(ym), getPurchasesAggForMonth(ym)]);

    // сохраняем notes как есть (если там #locked — остаётся)
    const snap = await insertMonthSnapshot(ym, {
      revenue: sales.revenue,
      cogs: sales.cogs,
      opex: pur.opex,
      capex: pur.capex,
      notes: String(cur.notes || ""),
    });

    // chain пересчитать до конца
    const endYm = (await getMaxYmFromMonthsOrData(ym)) || ym;
    const chainStart = prevYm(ym);
    const cash = await recomputeCashChainFrom(chainStart, endYm);

    await auditMonthAction(req, ym, "months.resnapshot", { ...sales, ...pur }, { locked });

    return res.json({ ok: true, month: normalizeMonthRow(snap), agg: { ...sales, ...pur }, chainStart, endYm, cash });
  } catch (e) {
    console.error("resnapshotMonth error:", e);
    return res.status(500).json({ error: "Failed to resnapshot month" });
  }
};

exports.lockPreview = async (req, res) => {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    const scope = String(req.query.scope || "single").toLowerCase(); // single|upto
    await ensureMonthsTable();

    let list = [ym];

    if (scope === "upto") {
      const { rows } = await db.query(
        `
        SELECT DISTINCT to_char(month,'YYYY-MM') AS ym
        FROM donas_finance_months
        WHERE slug=$1 AND month <= ($2)::date
        ORDER BY ym ASC
        `,
        [SLUG, ymToMonthDate(ym)]
      );
      list = (rows || []).map((r) => r.ym).filter(isYm);
      if (!list.length) list = [ym];
    }

    const items = [];
    for (const m of list) {
      const cur = await ensureMonthRow(m);
      const locked = hasLockedTag(cur.notes);
      items.push({
        ym: m,
        alreadyLocked: locked,
        willLock: !locked,
        notes_next: locked ? String(cur.notes || "") : addLockedTag(cur.notes),
      });
    }

    return res.json({ ok: true, scope, upto: ym, count: items.length, items });
  } catch (e) {
    console.error("lockPreview error:", e);
    return res.status(500).json({ error: "Failed to preview lock" });
  }
};

exports.lockUpTo = async (req, res) => {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    await ensureMonthsTable();

    const { rows } = await db.query(
      `
      SELECT DISTINCT to_char(month,'YYYY-MM') AS ym
      FROM donas_finance_months
      WHERE slug=$1 AND month <= ($2)::date
      ORDER BY ym ASC
      `,
      [SLUG, ymToMonthDate(ym)]
    );

    const list = (rows || []).map((r) => r.ym).filter(isYm);
    let lockedCount = 0;

    for (const m of list) {
      const cur = await ensureMonthRow(m);
      if (hasLockedTag(cur.notes)) continue;
      const nextNotes = addLockedTag(cur.notes);
      await insertMonthSnapshot(m, { notes: nextNotes });
      lockedCount++;
    }

    await auditMonthAction(req, ym, "months.lock_up_to", { lockedCount }, { months: list });
    return res.json({ ok: true, lockedCount, months: list });
  } catch (e) {
    console.error("lockUpTo error:", e);
    return res.status(500).json({ error: "Failed to lock up to" });
  }
};

exports.bulkResnapshot = async (req, res) => {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    const b = req.body || {};
    const from = isYm(b.from) ? b.from : null;
    const to = isYm(b.to) ? b.to : null;

    let startYm = from || ym;
    let endYm = to || ym;

    if (String(startYm).localeCompare(String(endYm)) > 0) {
      const tmp = startYm;
      startYm = endYm;
      endYm = tmp;
    }

    const agg = [];
    let cur = startYm;
    while (true) {
      const row = await ensureMonthRow(cur);
      if (hasLockedTag(row.notes)) {
        agg.push({ ym: cur, locked: true, updated: false });
      } else {
        const s = await getSalesAggForMonth(cur);
        const p = await getPurchasesAggForMonth(cur);
        await insertMonthSnapshot(cur, { revenue: s.revenue, cogs: s.cogs, opex: p.opex, capex: p.capex });
        agg.push({ ym: cur, locked: false, updated: true, ...s, ...p });
      }
      if (cur === endYm) break;
      cur = nextYm(cur);
    }

    const chainStart = prevYm(startYm);
    const cash = await recomputeCashChainFrom(chainStart, endYm);

    await auditMonthAction(req, ym, "months.bulk_resnapshot", { startYm, endYm }, { count: agg.length });

    return res.json({ ok: true, range: { startYm, endYm }, chainStart, agg, cash });
  } catch (e) {
    console.error("bulkResnapshot error:", e);
    return res.status(500).json({ error: "Failed to bulk resnapshot" });
  }
};

exports.resnapshotUpToPreview = async (req, res) => {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    return res.json({
      ok: true,
      preview: {
        up_to: ym,
        note: "Preview only. Real resnapshot uses POST /resnapshot-up-to (locked-only in UI).",
      },
    });
  } catch (e) {
    console.error("resnapshotUpToPreview error:", e);
    return res.status(500).json({ error: "Failed to preview" });
  }
};

/**
 * ✅ UI: Re-snapshot ≤  (locked only)
 * пересчитываем ТОЛЬКО locked месяцы в диапазоне [minYm .. ym]
 */
exports.resnapshotUpTo = async (req, res) => {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    const q = await db.query(
      `
      SELECT MIN(to_char(d,'YYYY-MM')) AS min_ym
      FROM (
        SELECT sold_at::date AS d FROM donas_sales
        UNION ALL
        SELECT date::date AS d FROM donas_purchases
      ) t
      `
    );
    const minYm = q.rows?.[0]?.min_ym || null;
    if (!minYm) return res.json({ ok: true, updatedCount: 0, touched: [], cash: [], reason: "no_data" });

    const startYm = minYm;
    const endYm = ym;

    const touched = [];
    let updatedCount = 0;

    let cur = startYm;
    while (true) {
      const row = await ensureMonthRow(cur);
      const locked = hasLockedTag(row.notes);

      if (locked) {
        const s = await getSalesAggForMonth(cur);
        const p = await getPurchasesAggForMonth(cur);

        await insertMonthSnapshot(cur, {
          revenue: s.revenue,
          cogs: s.cogs,
          opex: p.opex,
          capex: p.capex,
          notes: String(row.notes || ""), // keep #locked
        });

        updatedCount++;
        touched.push({ ym: cur, locked: true, updated: true });
      } else {
        touched.push({ ym: cur, locked: false, updated: false });
      }

      if (cur === endYm) break;
      cur = nextYm(cur);
    }

    const chainStart = prevYm(startYm);
    const cash = await recomputeCashChainFrom(chainStart, endYm);

    await auditMonthAction(req, ym, "months.resnapshot_up_to", { startYm, endYm }, { updatedCount });

    return res.json({ ok: true, range: { startYm, endYm }, chainStart, updatedCount, touched, cash });
  } catch (e) {
    console.error("resnapshotUpTo error:", e);
    return res.status(500).json({ error: "Failed to resnapshot up to" });
  }
};

exports.auditMonth = async (req, res) => {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    await ensureAuditTable();

    const limit = clampInt(req.query.limit, 200, 1, 500);

    const { rows } = await db.query(
      `
      SELECT *
      FROM donas_finance_months_audit_view
      WHERE slug=$1 AND ym=$2
      ORDER BY id DESC
      LIMIT $3
      `,
      [SLUG, ym, limit]
    );

    return res.json(rows || []);
  } catch (e) {
    console.error("auditMonth error:", e);
    return res.status(500).json({ error: "Failed to load month audit" });
  }
};

exports.audit = async (req, res) => {
  try {
    await ensureAuditTable();

    const limit = clampInt(req.query.limit, 200, 1, 500);

    const { rows } = await db.query(
      `
      SELECT *
      FROM donas_finance_months_audit_view
      WHERE slug=$1
      ORDER BY id DESC
      LIMIT $2
      `,
      [SLUG, limit]
    );
    return res.json(rows || []);
  } catch (e) {
    console.error("audit error:", e);
    return res.status(500).json({ error: "Failed to load audit" });
  }
};

// =========================
// CSV exports (required by routes)
// =========================

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(headers, rows) {
  const head = headers.map(csvEscape).join(",");
  const body = (rows || [])
    .map((r) => headers.map((h) => csvEscape(r[h])).join(","))
    .join("\n");
  return "\uFEFF" + head + "\n" + body + "\n";
}

// GET /api/admin/donas/finance/months/export.csv
exports.exportCsv = async (req, res) => {
  try {
    await ensureMonthsTable();

    const { rows } = await db.query(
      `
      SELECT DISTINCT ON (month)
        to_char(month,'YYYY-MM') AS ym,
        revenue, cogs, opex, capex, loan_paid, cash_end,
        notes,
        created_at
      FROM donas_finance_months
      WHERE slug=$1
      ORDER BY month ASC, id DESC
      `,
      [SLUG]
    );

    const headers = ["ym", "revenue", "cogs", "opex", "capex", "loan_paid", "cash_end", "notes", "created_at"];
    const csv = rowsToCsv(headers, rows);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="months_${SLUG}.csv"`);
    return res.send(csv);
  } catch (e) {
    console.error("exportCsv error:", e);
    return res.status(500).json({ error: "Failed to export months csv" });
  }
};

// GET /api/admin/donas/finance/audit/export.csv
exports.exportAuditCsv = async (req, res) => {
  try {
    await ensureAuditTable();

    const limit = clampInt(req.query.limit, 200, 1, 5000);

    const { rows } = await db.query(
      `
      SELECT
        id,
        slug,
        to_char(month,'YYYY-MM') AS ym,
        action,
        actor_id,
        actor_role,
        actor_email,
        actor_name,
        diff,
        meta,
        created_at
      FROM donas_finance_months_audit
      WHERE slug=$1
      ORDER BY id DESC
      LIMIT $2
      `,
      [SLUG, limit]
    );

    const mapped = (rows || []).map((r) => ({
      ...r,
      diff: r.diff ? JSON.stringify(r.diff) : "",
      meta: r.meta ? JSON.stringify(r.meta) : "",
    }));

    const headers = [
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

    const csv = rowsToCsv(headers, mapped);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="audit_${SLUG}.csv"`);
    return res.send(csv);
  } catch (e) {
    console.error("exportAuditCsv error:", e);
    return res.status(500).json({ error: "Failed to export audit csv" });
  }
};

// GET /api/admin/donas/finance/months/:month/audit/export.csv
exports.exportAuditMonthCsv = async (req, res) => {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    await ensureAuditTable();

    const limit = clampInt(req.query.limit, 200, 1, 5000);

    const { rows } = await db.query(
      `
      SELECT
        id,
        slug,
        to_char(month,'YYYY-MM') AS ym,
        action,
        actor_id,
        actor_role,
        actor_email,
        actor_name,
        diff,
        meta,
        created_at
      FROM donas_finance_months_audit
      WHERE slug=$1 AND month=($2)::date
      ORDER BY id DESC
      LIMIT $3
      `,
      [SLUG, ymToMonthDate(ym), limit]
    );

    const mapped = (rows || []).map((r) => ({
      ...r,
      diff: r.diff ? JSON.stringify(r.diff) : "",
      meta: r.meta ? JSON.stringify(r.meta) : "",
    }));

    const headers = [
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

    const csv = rowsToCsv(headers, mapped);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="audit_${SLUG}_${ym}.csv"`);
    return res.send(csv);
  } catch (e) {
    console.error("exportAuditMonthCsv error:", e);
    return res.status(500).json({ error: "Failed to export month audit csv" });
  }
};

// =========================
// Internal exports (for auto-sync from Sales/Purchases)
// =========================
// ⚠️ used by backend/utils/donasFinanceAutoSync.js
exports._internal = {
  isYm,
  monthToYm,
  ymToMonthDate,
  nextYm,
  prevYm,
  getMaxYmFromMonthsOrData,
  updateMonthAgg,
  recomputeCashChainFrom,
  auditMonthAction,
};

