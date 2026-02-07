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

/**
 * =========================
 * Ensure months table
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
async function getSalesAggForMonth(ym) {
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

// Purchases → opex/capex (single ledger: type=OPEX|CAPEX)
async function getPurchasesAggForMonth(ym) {
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

async function isMonthLocked(ym) {
  const row = await ensureMonthRow(ym);
  return hasLockedTag(row?.notes || "");
}

function nextYm(ym) {
  const [y, m] = String(ym).split("-").map((v) => Number(v));
  const d = new Date(Date.UTC(y, (m - 1) + 1, 1));
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

function prevYm(ym) {
  const [y, m] = String(ym).split("-").map((v) => Number(v));
  const d = new Date(Date.UTC(y, (m - 1) - 1, 1));
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

async function updateMonthAgg(ym) {
  if (await isMonthLocked(ym)) {
    return { ym, ok: true, locked: true, updated: false };
  }

  await ensureMonthRow(ym);

  const [sales, pur] = await Promise.all([getSalesAggForMonth(ym), getPurchasesAggForMonth(ym)]);

  await db.query(
    `
    UPDATE donas_finance_months
    SET revenue=$1,
        cogs=$2,
        opex=$3,
        capex=$4
    WHERE slug=$5 AND month=($6)::date
    `,
    [sales.revenue, sales.cogs, pur.opex, pur.capex, SLUG, ymToMonthDate(ym)]
  );

  return { ym, ok: true, locked: false, updated: true, ...sales, ...pur };
}

// cash_end chain: stop on #locked month
async function recomputeCashChainFrom(startYm, endYm) {
  let cur = startYm;
  while (true) {
    await ensureMonthRow(cur);
    if (cur === endYm) break;
    cur = nextYm(cur);
  }

  const { rows } = await db.query(
    `
    SELECT *
    FROM donas_finance_months
    WHERE slug=$1
      AND month >= ($2)::date
      AND month <= ($3)::date
    ORDER BY month ASC, id ASC
    `,
    [SLUG, ymToMonthDate(startYm), ymToMonthDate(endYm)]
  );

  const byMonth = new Map();
  for (const r of rows || []) {
    const ym = monthToYm(r.month);
    const prev = byMonth.get(ym);
    if (!prev || Number(r.id) > Number(prev.id)) byMonth.set(ym, r);
  }

  const pYm = prevYm(startYm);
  let prevCash = 0;
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
    if (q.rows?.[0]) prevCash = toNum(q.rows[0].cash_end);
  } catch {}

  const results = [];
  cur = startYm;

  while (true) {
    const row = byMonth.get(cur) || (await ensureMonthRow(cur));
    const locked = hasLockedTag(row?.notes || "");

    if (locked) {
      results.push({ ym: cur, locked: true, cash_end: toNum(row.cash_end), updated: false });
      break;
    }

    const revenue = toNum(row.revenue);
    const cogs = toNum(row.cogs);
    const opex = toNum(row.opex);
    const capex = toNum(row.capex);
    const loan = toNum(row.loan_paid);

    const cf = revenue - cogs - opex - capex - loan;
    const cashEnd = prevCash + cf;

    await db.query(
      `
      UPDATE donas_finance_months
      SET cash_end=$1
      WHERE slug=$2 AND month=($3)::date
      `,
      [cashEnd, SLUG, ymToMonthDate(cur)]
    );

    results.push({ ym: cur, locked: false, cash_end: cashEnd, updated: true });

    prevCash = cashEnd;

    if (cur === endYm) break;
    cur = nextYm(cur);
  }

  return results;
}

/**
 * =========================
 * Public endpoints used by UI
 * =========================
 */

exports.getSettings = async (req, res) => {
  try {
    const s = await ensureSettingsRow();
    return res.json(s);
  } catch (e) {
    console.error("getSettings error:", e);
    return res.status(500).json({ error: "Failed to load settings" });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const s0 = await ensureSettingsRow();
    const b = req.body || {};

    const payload = {
      currency: String(b.currency ?? s0.currency ?? "UZS").trim() || "UZS",
      cash_start: toNum(b.cash_start ?? s0.cash_start),
      fixed_opex_month: toNum(b.fixed_opex_month ?? s0.fixed_opex_month),
      variable_opex_month: toNum(b.variable_opex_month ?? s0.variable_opex_month),
      loan_payment_month: toNum(b.loan_payment_month ?? s0.loan_payment_month),
      reserve_target_months: toNum(b.reserve_target_months ?? s0.reserve_target_months),
    };

    const { rows } = await db.query(
      `
      UPDATE donas_finance_settings
      SET
        currency=$2,
        cash_start=$3,
        fixed_opex_month=$4,
        variable_opex_month=$5,
        loan_payment_month=$6,
        reserve_target_months=$7,
        updated_at=NOW()
      WHERE slug=$1
      RETURNING *
      `,
      [
        SLUG,
        payload.currency,
        payload.cash_start,
        payload.fixed_opex_month,
        payload.variable_opex_month,
        payload.loan_payment_month,
        payload.reserve_target_months,
      ]
    );

    return res.json(rows?.[0] || payload);
  } catch (e) {
    console.error("updateSettings error:", e);
    return res.status(500).json({ error: "Failed to save settings" });
  }
};

exports.listMonths = async (req, res) => {
  try {
    await ensureMonthsTable();
    const { rows } = await db.query(
      `
      SELECT *
      FROM donas_finance_months
      WHERE slug=$1
      ORDER BY month ASC, id ASC
      `,
      [SLUG]
    );

    // latest row per month
    const byMonth = new Map();
    for (const r of rows || []) {
      const ym = monthToYm(r.month);
      const prev = byMonth.get(ym);
      if (!prev || Number(r.id) > Number(prev.id)) byMonth.set(ym, r);
    }

    // ✅ FIX: normalize month to "YYYY-MM" in API response
    const out = Array.from(byMonth.values())
      .map(normalizeMonthRow)
      .sort((a, b) => String(a.month).localeCompare(String(b.month)));

    return res.json(out);
  } catch (e) {
    console.error("listMonths error:", e);
    return res.status(500).json({ error: "Failed to load months" });
  }
};

/**
 * Sync months aggregates from Sales + Purchases and recompute cash_end chain for the touched range
 * POST /api/admin/donas/finance/months/sync
 * body: { from?: 'YYYY-MM', to?: 'YYYY-MM' } (optional)
 */
exports.syncMonths = async (req, res) => {
  try {
    await ensureMonthsTable();

    const b = req.body || {};
    const from = isYm(b.from) ? b.from : null;
    const to = isYm(b.to) ? b.to : null;

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
      const minYm = q.rows?.[0]?.min_ym || null;
      const maxYm = q.rows?.[0]?.max_ym || null;
      startYm = startYm || minYm;
      endYm = endYm || maxYm;
    }

    if (!startYm || !endYm) {
      return res.json({ ok: true, touched: [], cash: [], reason: "no_data" });
    }

    if (String(startYm).localeCompare(String(endYm)) > 0) {
      const tmp = startYm;
      startYm = endYm;
      endYm = tmp;
    }

    const touched = [];
    let cur = startYm;
    while (true) {
      touched.push(await updateMonthAgg(cur));
      if (cur === endYm) break;
      cur = nextYm(cur);
    }

    const cash = await recomputeCashChainFrom(startYm, endYm);

    await auditMonthAction(req, endYm, "months.sync", { startYm, endYm }, { touched_count: touched.length });

    return res.json({ ok: true, range: { startYm, endYm }, touched, cash });
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

    await db.query(
      `
      UPDATE donas_finance_months
      SET loan_paid=$1,
          notes=$2
      WHERE slug=$3 AND month=($4)::date
      `,
      [loan_paid, notes, SLUG, ymToMonthDate(ym)]
    );

    await auditMonthAction(req, ym, "months.update", { loan_paid, notes }, {});

    const cash = await recomputeCashChainFrom(ym, ym);

    const out = await getLatestMonthRow(ym);
    return res.json({ ok: true, month: normalizeMonthRow(out), cash });
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

    await db.query(
      `
      UPDATE donas_finance_months
      SET notes=$1
      WHERE slug=$2 AND month=($3)::date
      `,
      [nextNotes, SLUG, ymToMonthDate(ym)]
    );

    await auditMonthAction(req, ym, "months.lock", { notes: nextNotes }, {});

    const out = await getLatestMonthRow(ym);
    return res.json({ ok: true, month: normalizeMonthRow(out) });
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

    await db.query(
      `
      UPDATE donas_finance_months
      SET notes=$1
      WHERE slug=$2 AND month=($3)::date
      `,
      [nextNotes, SLUG, ymToMonthDate(ym)]
    );

    await auditMonthAction(req, ym, "months.unlock", { notes: nextNotes }, {});

    const out = await getLatestMonthRow(ym);
    return res.json({ ok: true, month: normalizeMonthRow(out) });
  } catch (e) {
    console.error("unlockMonth error:", e);
    return res.status(500).json({ error: "Failed to unlock month" });
  }
};

/**
 * =========================
 * Extra endpoints used by UI (previews, resnapshot, export, audit)
 * =========================
 */

exports.lockPreview = async (req, res) => {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    const cur = await ensureMonthRow(ym);
    const preview = { ym, will_lock: !hasLockedTag(cur.notes), notes_next: addLockedTag(cur.notes) };

    return res.json({ ok: true, preview });
  } catch (e) {
    console.error("lockPreview error:", e);
    return res.status(500).json({ error: "Failed to preview lock" });
  }
};

exports.resnapshotMonth = async (req, res) => {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    if (await isMonthLocked(ym)) {
      return res.status(409).json({ error: `Month ${ym} is locked (#locked)` });
    }

    const agg = await updateMonthAgg(ym);
    const cash = await recomputeCashChainFrom(ym, ym);

    await auditMonthAction(req, ym, "months.resnapshot", agg, {});

    const out = await getLatestMonthRow(ym);
    return res.json({ ok: true, month: normalizeMonthRow(out), agg, cash });
  } catch (e) {
    console.error("resnapshotMonth error:", e);
    return res.status(500).json({ error: "Failed to resnapshot month" });
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
      await db.query(
        `UPDATE donas_finance_months SET notes=$1 WHERE slug=$2 AND month=($3)::date`,
        [nextNotes, SLUG, ymToMonthDate(m)]
      );
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
      if (await isMonthLocked(cur)) {
        agg.push({ ym: cur, locked: true, updated: false });
      } else {
        agg.push(await updateMonthAgg(cur));
      }
      if (cur === endYm) break;
      cur = nextYm(cur);
    }

    const cash = await recomputeCashChainFrom(startYm, endYm);

    await auditMonthAction(req, ym, "months.bulk_resnapshot", { startYm, endYm }, { count: agg.length });

    return res.json({ ok: true, range: { startYm, endYm }, agg, cash });
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
        note: "Preview only. Real resnapshot uses POST /resnapshot-up-to",
      },
    });
  } catch (e) {
    console.error("resnapshotUpToPreview error:", e);
    return res.status(500).json({ error: "Failed to preview" });
  }
};

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
    if (!minYm) return res.json({ ok: true, agg: [], cash: [], reason: "no_data" });

    const startYm = minYm;
    const endYm = ym;

    const agg = [];
    let cur = startYm;
    while (true) {
      if (await isMonthLocked(cur)) {
        agg.push({ ym: cur, locked: true, updated: false });
      } else {
        agg.push(await updateMonthAgg(cur));
      }
      if (cur === endYm) break;
      cur = nextYm(cur);
    }

    const cash = await recomputeCashChainFrom(startYm, endYm);

    await auditMonthAction(req, ym, "months.resnapshot_up_to", { startYm, endYm }, { count: agg.length });

    return res.json({ ok: true, range: { startYm, endYm }, agg, cash });
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

    const { rows } = await db.query(
      `
      SELECT *
      FROM donas_finance_months_audit_view
      WHERE slug=$1 AND ym=$2
      ORDER BY id DESC
      `,
      [SLUG, ym]
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
    const { rows } = await db.query(
      `
      SELECT *
      FROM donas_finance_months_audit_view
      WHERE slug=$1
      ORDER BY id DESC
      LIMIT 500
      `,
      [SLUG]
    );
    return res.json(rows || []);
  } catch (e) {
    console.error("audit error:", e);
    return res.status(500).json({ error: "Failed to load audit" });
  }
};

function toCsv(rows) {
  const safe = Array.isArray(rows) ? rows : [];
  if (!safe.length) return "empty\n";
  const cols = Object.keys(safe[0]);
  const esc = (v) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const head = cols.join(",");
  const body = safe.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\n");
  return `${head}\n${body}\n`;
}

exports.exportCsv = async (req, res) => {
  try {
    await ensureMonthsTable();
    const { rows } = await db.query(
      `
      SELECT
        to_char(month,'YYYY-MM') AS ym,
        revenue, cogs, opex, capex, loan_paid, cash_end, notes
      FROM donas_finance_months
      WHERE slug=$1
      ORDER BY month ASC, id ASC
      `,
      [SLUG]
    );

    const csv = toCsv(rows || []);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="donas_months.csv"`);
    return res.send(csv);
  } catch (e) {
    console.error("exportCsv error:", e);
    return res.status(500).json({ error: "Failed to export csv" });
  }
};

exports.exportAuditCsv = async (req, res) => {
  try {
    await ensureAuditTable();
    const { rows } = await db.query(
      `
      SELECT *
      FROM donas_finance_months_audit_view
      WHERE slug=$1
      ORDER BY id DESC
      LIMIT 2000
      `,
      [SLUG]
    );

    const csv = toCsv(rows || []);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="donas_audit.csv"`);
    return res.send(csv);
  } catch (e) {
    console.error("exportAuditCsv error:", e);
    return res.status(500).json({ error: "Failed to export audit csv" });
  }
};

exports.exportAuditMonthCsv = async (req, res) => {
  try {
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    await ensureAuditTable();
    const { rows } = await db.query(
      `
      SELECT *
      FROM donas_finance_months_audit_view
      WHERE slug=$1 AND ym=$2
      ORDER BY id DESC
      LIMIT 2000
      `,
      [SLUG, ym]
    );

    const csv = toCsv(rows || []);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="donas_audit_${ym}.csv"`);
    return res.send(csv);
  } catch (e) {
    console.error("exportAuditMonthCsv error:", e);
    return res.status(500).json({ error: "Failed to export month audit csv" });
  }
};
