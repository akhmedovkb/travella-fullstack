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

function ymToDate(ym) {
  return `${ym}-01`;
}

function dateToYm(d) {
  if (!d) return "";
  return String(d).slice(0, 7);
}

function hasLockedTag(notes) {
  return String(notes || "").toLowerCase().includes("#locked");
}

function addLockedTag(notes) {
  const s = String(notes || "").trim();
  if (!s) return "#locked";
  if (hasLockedTag(s)) return s;
  return `${s} #locked`;
}

function removeLockedTag(notes) {
  return String(notes || "")
    .replace(/#locked/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getActor(req) {
  const u = req.user || {};
  return {
    id: u.id ?? null,
    role: String(u.role || "").toLowerCase() || null,
    email: u.email || u.mail || null,
    name: u.name || u.full_name || null,
  };
}

/**
 * =========================
 * Ensure tables/views exist
 * =========================
 */
async function ensureFinanceTables() {
  // settings
  await db.query(`
    CREATE TABLE IF NOT EXISTS donas_finance_settings (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      currency TEXT NOT NULL DEFAULT 'UZS',
      opening_cash NUMERIC NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // months storage (loan_paid + notes обязательны, остальное для snapshot)
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
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (slug, month)
    );
  `);

  // audit base table
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

  // view (важно: порядок колонок совпадает с тем, что ты сейчас видишь в БД)
  // id, slug, ym, action, diff, actor_name, actor_email, created_at, actor_role, actor_id, meta
  await db.query(`
    CREATE OR REPLACE VIEW donas_finance_audit AS
    SELECT
      id,
      slug,
      ym,
      action,
      diff,
      actor_name,
      actor_email,
      created_at,
      actor_role,
      actor_id,
      meta
    FROM donas_finance_audit_log;
  `);

  // seed settings row
  await db.query(
    `
    INSERT INTO donas_finance_settings (slug)
    VALUES ($1)
    ON CONFLICT (slug) DO NOTHING
    `,
    [SLUG]
  );
}

async function auditInsert({ ym, action, diff, actor, meta }) {
  try {
    await db.query(
      `
      INSERT INTO donas_finance_audit_log
        (slug, ym, action, diff, actor_name, actor_email, actor_role, actor_id, meta)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        SLUG,
        String(ym || ""),
        String(action || ""),
        diff ? diff : {},
        actor?.name || null,
        actor?.email || null,
        actor?.role || null,
        actor?.id != null ? Number(actor.id) : null,
        meta ? meta : {},
      ]
    );
  } catch (e) {
    console.error("auditInsert error:", e);
  }
}

/**
 * =========================
 * Aggregates
 * =========================
 */

// sales -> revenue/cogs
async function loadSalesAggByYm() {
  const { rows } = await db.query(`
    SELECT
      to_char(sold_at, 'YYYY-MM') AS ym,
      COALESCE(SUM(revenue_total), 0)::numeric AS revenue,
      COALESCE(SUM(cogs_total), 0)::numeric AS cogs
    FROM donas_sales
    GROUP BY 1
  `);

  const map = new Map();
  for (const r of rows || []) {
    map.set(String(r.ym), {
      revenue: toNum(r.revenue),
      cogs: toNum(r.cogs),
    });
  }
  return map;
}

// purchases -> opex/capex (type = 'OPEX'/'CAPEX' or lower)
async function loadPurchasesAggByYm() {
  const { rows } = await db.query(`
    SELECT
      to_char(date, 'YYYY-MM') AS ym,
      COALESCE(SUM(CASE WHEN lower(type)='opex' THEN total ELSE 0 END), 0)::numeric AS opex,
      COALESCE(SUM(CASE WHEN lower(type)='capex' THEN total ELSE 0 END), 0)::numeric AS capex
    FROM donas_purchases
    GROUP BY 1
  `);

  const map = new Map();
  for (const r of rows || []) {
    map.set(String(r.ym), {
      opex: toNum(r.opex),
      capex: toNum(r.capex),
    });
  }
  return map;
}

// months rows in DB (loan_paid, notes, snapshots)
async function loadMonthsDbRows() {
  const { rows } = await db.query(
    `
    SELECT *
    FROM donas_finance_months
    WHERE slug=$1
    ORDER BY month ASC
    `,
    [SLUG]
  );

  const map = new Map();
  for (const r of rows || []) {
    const ym = dateToYm(r.month);
    map.set(ym, r);
  }
  return map;
}

// build ym list from sales+purchases+months db
async function buildAllYmSorted() {
  const { rows } = await db.query(`
    WITH s AS (
      SELECT DISTINCT to_char(sold_at,'YYYY-MM') AS ym FROM donas_sales
    ),
    p AS (
      SELECT DISTINCT to_char(date,'YYYY-MM') AS ym FROM donas_purchases
    ),
    m AS (
      SELECT DISTINCT to_char(month,'YYYY-MM') AS ym FROM donas_finance_months WHERE slug='${SLUG}'
    )
    SELECT ym FROM (SELECT ym FROM s UNION SELECT ym FROM p UNION SELECT ym FROM m) x
    WHERE ym IS NOT NULL AND ym <> ''
    ORDER BY ym ASC
  `);

  return (rows || []).map((r) => String(r.ym));
}

/**
 * =========================
 * Compute Months response
 * =========================
 */
async function computeMonthsView() {
  await ensureFinanceTables();

  const s = await db.query(
    `SELECT currency, opening_cash FROM donas_finance_settings WHERE slug=$1 LIMIT 1`,
    [SLUG]
  );
  const settings = s.rows?.[0] || { currency: "UZS", opening_cash: 0 };

  const ymList = await buildAllYmSorted();

  const salesAgg = await loadSalesAggByYm();
  const purchAgg = await loadPurchasesAggByYm();
  const monthsDb = await loadMonthsDbRows();

  // compute cash_end chain
  let prevCash = toNum(settings.opening_cash);

  const out = [];
  for (const ym of ymList) {
    const dbRow = monthsDb.get(ym) || null;
    const locked = dbRow ? hasLockedTag(dbRow.notes) : false;

    // loan_paid + notes всегда берём из DB (чтобы сохранялись)
    const loan_paid = toNum(dbRow?.loan_paid);
    const notes = String(dbRow?.notes || "");

    let revenue = 0;
    let cogs = 0;
    let opex = 0;
    let capex = 0;
    let cash_end = 0;

    if (locked && dbRow) {
      // snapshot values
      revenue = toNum(dbRow.revenue);
      cogs = toNum(dbRow.cogs);
      opex = toNum(dbRow.opex);
      capex = toNum(dbRow.capex);
      cash_end = toNum(dbRow.cash_end);
    } else {
      // auto values
      const sa = salesAgg.get(ym) || { revenue: 0, cogs: 0 };
      const pa = purchAgg.get(ym) || { opex: 0, capex: 0 };
      revenue = toNum(sa.revenue);
      cogs = toNum(sa.cogs);
      opex = toNum(pa.opex);
      capex = toNum(pa.capex);

      const gp = revenue - cogs;
      const netOp = gp - opex;
      const cf = netOp - loan_paid - capex;
      cash_end = prevCash + cf;
    }

    // diff badges: purchases - snapshot (if locked)
    let diff = null;
    if (locked) {
      const pa = purchAgg.get(ym) || { opex: 0, capex: 0 };
      diff = {
        opex: toNum(pa.opex) - toNum(dbRow?.opex),
        capex: toNum(pa.capex) - toNum(dbRow?.capex),
      };
    } else {
      // unlocked -> no diff (or could show 0)
      diff = { opex: 0, capex: 0 };
    }

    // update prevCash for chain
    prevCash = cash_end;

    out.push({
      id: dbRow?.id || null,
      slug: SLUG,
      month: ymToDate(ym),
      revenue,
      cogs,
      opex,
      capex,
      loan_paid,
      cash_end,
      notes,
      _diff: diff,
    });
  }

  return { settings, months: out };
}

/**
 * =========================
 * Controllers
 * =========================
 */

exports.getSettings = async (req, res) => {
  try {
    await ensureFinanceTables();
    const { rows } = await db.query(
      `SELECT currency, opening_cash FROM donas_finance_settings WHERE slug=$1 LIMIT 1`,
      [SLUG]
    );
    const settings = rows?.[0] || { currency: "UZS", opening_cash: 0 };
    return res.json({ settings });
  } catch (e) {
    console.error("getSettings error:", e);
    return res.status(500).json({ error: "Failed to load settings" });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    await ensureFinanceTables();
    const b = req.body || {};
    const currency = String(b.currency || "UZS").trim() || "UZS";
    const opening_cash = toNum(b.opening_cash);

    await db.query(
      `
      UPDATE donas_finance_settings
      SET currency=$2, opening_cash=$3, updated_at=NOW()
      WHERE slug=$1
      `,
      [SLUG, currency, opening_cash]
    );

    await auditInsert({
      ym: "settings",
      action: "settings.update",
      diff: { currency, opening_cash },
      actor: getActor(req),
      meta: {},
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("updateSettings error:", e);
    return res.status(500).json({ error: "Failed to update settings" });
  }
};

exports.listMonths = async (req, res) => {
  try {
    const r = await computeMonthsView();
    return res.json({ months: r.months, settings: r.settings });
  } catch (e) {
    console.error("listMonths error:", e);
    return res.status(500).json({ error: "Failed to load months" });
  }
};

/**
 * Sync: создаёт недостающие строки в donas_finance_months
 * для всех месяцев, которые есть в sales/purchases.
 */
exports.syncMonths = async (req, res) => {
  try {
    await ensureFinanceTables();
    const actor = getActor(req);

    const ymList = await buildAllYmSorted();

    let created = 0;
    for (const ym of ymList) {
      const monthDate = ymToDate(ym);
      const ins = await db.query(
        `
        INSERT INTO donas_finance_months (slug, month, loan_paid, notes)
        VALUES ($1, $2::date, 0, '')
        ON CONFLICT (slug, month) DO NOTHING
        `,
        [SLUG, monthDate]
      );
      if (ins.rowCount > 0) created += 1;
    }

    await auditInsert({
      ym: "months",
      action: "months.sync",
      diff: { created },
      actor,
      meta: { count: created },
    });

    return res.json({ ok: true, created });
  } catch (e) {
    console.error("syncMonths error:", e);
    return res.status(500).json({ error: "Failed to sync months" });
  }
};

/**
 * PUT /months/:month (YYYY-MM)
 * UI сохраняет только loan_paid + notes (без #locked руками)
 */
exports.updateMonth = async (req, res) => {
  try {
    await ensureFinanceTables();
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    const b = req.body || {};
    const loan_paid = b.loan_paid == null ? 0 : toNum(b.loan_paid);
    const notes = b.notes == null ? "" : String(b.notes);

    // нельзя руками добавлять #locked
    if (String(notes).toLowerCase().includes("#locked")) {
      return res.status(400).json({ error: "Do not add #locked manually. Use Lock button." });
    }

    const monthDate = ymToDate(ym);

    // ensure row
    await db.query(
      `
      INSERT INTO donas_finance_months (slug, month, loan_paid, notes)
      VALUES ($1, $2::date, $3, $4)
      ON CONFLICT (slug, month) DO NOTHING
      `,
      [SLUG, monthDate, loan_paid, notes]
    );

    // update only editable fields
    const { rows: beforeRows } = await db.query(
      `SELECT loan_paid, notes FROM donas_finance_months WHERE slug=$1 AND month=$2::date LIMIT 1`,
      [SLUG, monthDate]
    );
    const before = beforeRows?.[0] || { loan_paid: 0, notes: "" };

    await db.query(
      `
      UPDATE donas_finance_months
      SET loan_paid=$3, notes=$4, updated_at=NOW()
      WHERE slug=$1 AND month=$2::date
      `,
      [SLUG, monthDate, loan_paid, notes]
    );

    const diff = {};
    if (toNum(before.loan_paid) !== loan_paid) diff.loan_paid = { from: toNum(before.loan_paid), to: loan_paid };
    if (String(before.notes || "") !== String(notes || "")) diff.notes = { from: String(before.notes || ""), to: String(notes || "") };

    await auditInsert({
      ym,
      action: "month.update",
      diff,
      actor: getActor(req),
      meta: {},
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("updateMonth error:", e);
    return res.status(500).json({ error: "Failed to update month" });
  }
};

/**
 * Lock month: сохраняем snapshot значений (revenue/cogs/opex/capex/cash_end) + добавляем #locked.
 */
exports.lockMonth = async (req, res) => {
  try {
    await ensureFinanceTables();
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    const actor = getActor(req);

    // считаем текущий view (auto)
    const { months } = await computeMonthsView();
    const row = months.find((x) => dateToYm(x.month) === ym);
    if (!row) return res.status(404).json({ error: "Month not found" });

    const monthDate = ymToDate(ym);

    // load current db row
    const curQ = await db.query(
      `SELECT notes, loan_paid FROM donas_finance_months WHERE slug=$1 AND month=$2::date LIMIT 1`,
      [SLUG, monthDate]
    );
    const cur = curQ.rows?.[0] || { notes: "", loan_paid: 0 };

    const newNotes = addLockedTag(cur.notes);

    await db.query(
      `
      INSERT INTO donas_finance_months
        (slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes)
      VALUES
        ($1, $2::date, $3, $4, $5, $6, $7, $8, $9)
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
      `,
      [
        SLUG,
        monthDate,
        toNum(row.revenue),
        toNum(row.cogs),
        toNum(row.opex),
        toNum(row.capex),
        toNum(cur.loan_paid), // loan_paid берём из DB
        toNum(row.cash_end),
        newNotes,
      ]
    );

    await auditInsert({
      ym,
      action: "month.lock",
      diff: { locked: true },
      actor,
      meta: {},
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("lockMonth error:", e);
    return res.status(500).json({ error: "Failed to lock month" });
  }
};

exports.unlockMonth = async (req, res) => {
  try {
    await ensureFinanceTables();
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    const monthDate = ymToDate(ym);

    const curQ = await db.query(
      `SELECT notes FROM donas_finance_months WHERE slug=$1 AND month=$2::date LIMIT 1`,
      [SLUG, monthDate]
    );
    const cur = curQ.rows?.[0];
    if (!cur) return res.status(404).json({ error: "Month not found" });

    await db.query(
      `
      UPDATE donas_finance_months
      SET notes=$3, updated_at=NOW()
      WHERE slug=$1 AND month=$2::date
      `,
      [SLUG, monthDate, removeLockedTag(cur.notes)]
    );

    await auditInsert({
      ym,
      action: "month.unlock",
      diff: { locked: false },
      actor: getActor(req),
      meta: {},
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("unlockMonth error:", e);
    return res.status(500).json({ error: "Failed to unlock month" });
  }
};

/**
 * Re-snapshot locked month: переснимаем snapshot по текущим Sales/Purchases + chain cash_end.
 * (UI использует когда #locked)
 */
exports.resnapshotMonth = async (req, res) => {
  try {
    await ensureFinanceTables();
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    const actor = getActor(req);

    const { months } = await computeMonthsView();
    const row = months.find((x) => dateToYm(x.month) === ym);
    if (!row) return res.status(404).json({ error: "Month not found" });

    const monthDate = ymToDate(ym);

    const curQ = await db.query(
      `SELECT notes, loan_paid FROM donas_finance_months WHERE slug=$1 AND month=$2::date LIMIT 1`,
      [SLUG, monthDate]
    );
    const cur = curQ.rows?.[0] || { notes: "", loan_paid: 0 };

    if (!hasLockedTag(cur.notes)) {
      return res.status(409).json({ error: "Month is not locked. Lock it first." });
    }

    await db.query(
      `
      UPDATE donas_finance_months
      SET
        revenue=$3,
        cogs=$4,
        opex=$5,
        capex=$6,
        cash_end=$7,
        updated_at=NOW()
      WHERE slug=$1 AND month=$2::date
      `,
      [
        SLUG,
        monthDate,
        toNum(row.revenue),
        toNum(row.cogs),
        toNum(row.opex),
        toNum(row.capex),
        toNum(row.cash_end),
      ]
    );

    await auditInsert({
      ym,
      action: "month.resnapshot",
      diff: { resnapshot: true },
      actor,
      meta: {},
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("resnapshotMonth error:", e);
    return res.status(500).json({ error: "Failed to resnapshot month" });
  }
};

/**
 * Lock all ≤ selected month
 */
exports.lockUpTo = async (req, res) => {
  try {
    await ensureFinanceTables();
    const targetYm = String(req.params.month || "").trim();
    if (!isYm(targetYm)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    const actor = getActor(req);

    const { months } = await computeMonthsView();
    const yms = months.map((m) => dateToYm(m.month)).filter(Boolean);

    let locked = 0;
    for (const ym of yms) {
      if (ym > targetYm) break;

      const monthDate = ymToDate(ym);
      const curQ = await db.query(
        `SELECT notes FROM donas_finance_months WHERE slug=$1 AND month=$2::date LIMIT 1`,
        [SLUG, monthDate]
      );
      const cur = curQ.rows?.[0] || { notes: "" };

      if (hasLockedTag(cur.notes)) continue;

      // lock one by one using same snapshot logic
      const row = months.find((x) => dateToYm(x.month) === ym);
      if (!row) continue;

      // ensure row exists
      await db.query(
        `
        INSERT INTO donas_finance_months (slug, month, loan_paid, notes)
        VALUES ($1, $2::date, 0, '')
        ON CONFLICT (slug, month) DO NOTHING
        `,
        [SLUG, monthDate]
      );

      const lpQ = await db.query(
        `SELECT loan_paid, notes FROM donas_finance_months WHERE slug=$1 AND month=$2::date LIMIT 1`,
        [SLUG, monthDate]
      );
      const lp = lpQ.rows?.[0] || { loan_paid: 0, notes: "" };

      await db.query(
        `
        UPDATE donas_finance_months
        SET
          revenue=$3,
          cogs=$4,
          opex=$5,
          capex=$6,
          cash_end=$7,
          notes=$8,
          updated_at=NOW()
        WHERE slug=$1 AND month=$2::date
        `,
        [
          SLUG,
          monthDate,
          toNum(row.revenue),
          toNum(row.cogs),
          toNum(row.opex),
          toNum(row.capex),
          toNum(row.cash_end),
          addLockedTag(lp.notes),
        ]
      );

      locked += 1;
    }

    await auditInsert({
      ym: targetYm,
      action: "months.lock_up_to",
      diff: { locked },
      actor,
      meta: { locked },
    });

    return res.json({ ok: true, locked });
  } catch (e) {
    console.error("lockUpTo error:", e);
    return res.status(500).json({ error: "Failed to lock up to" });
  }
};

/**
 * PREVIEW для UI (может быть не использован — но оставляем рабочим)
 */
exports.lockPreview = async (req, res) => {
  try {
    await ensureFinanceTables();
    const targetYm = String(req.params.month || "").trim();
    if (!isYm(targetYm)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    const scope = String(req.query.scope || "single");
    const { months } = await computeMonthsView();

    const items = [];
    for (const r of months) {
      const ym = dateToYm(r.month);
      if (!ym) continue;
      if (scope === "single" && ym !== targetYm) continue;
      if (scope === "upto" && ym > targetYm) break;

      // current state from DB (locked?)
      const monthDate = ymToDate(ym);
      const q = await db.query(
        `SELECT notes, cash_end, opex, capex FROM donas_finance_months WHERE slug=$1 AND month=$2::date LIMIT 1`,
        [SLUG, monthDate]
      );
      const cur = q.rows?.[0] || null;
      const currentLocked = cur ? hasLockedTag(cur.notes) : false;

      // planned: lock -> snapshot values
      items.push({
        ym,
        current: {
          locked: currentLocked,
          cash_end: cur ? toNum(cur.cash_end) : null,
          opex: cur ? toNum(cur.opex) : null,
          capex: cur ? toNum(cur.capex) : null,
        },
        planned: {
          locked: true,
          cash_end: toNum(r.cash_end),
          opex: toNum(r.opex),
          capex: toNum(r.capex),
          notes: addLockedTag(cur?.notes || ""),
        },
        purchases: r._diff
          ? {
              opex: toNum(r.opex) + toNum(r._diff.opex),
              capex: toNum(r.capex) + toNum(r._diff.capex),
            }
          : { opex: toNum(r.opex), capex: toNum(r.capex) },
        diff: r._diff || { opex: 0, capex: 0 },
      });
    }

    const target = months.find((x) => dateToYm(x.month) === targetYm);
    const summary = {
      targetWasLocked: false,
      deltaCashEndAtTarget: 0,
      affectedLockedCount: 0,
    };

    return res.json({ scope, items, summary });
  } catch (e) {
    console.error("lockPreview error:", e);
    return res.status(500).json({ error: "Failed to load lock preview" });
  }
};

// bulk previews: оставляем заглушки (UI их умеет пережить)
exports.resnapshotUpToPreview = async (req, res) => {
  return res.json({ scope: "upto", items: [], summary: { affectedLockedCount: 0 } });
};

exports.resnapshotUpTo = async (req, res) => {
  try {
    await ensureFinanceTables();
    const targetYm = String(req.params.month || "").trim();
    if (!isYm(targetYm)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    const actor = getActor(req);

    const { months } = await computeMonthsView();

    let updatedCount = 0;
    for (const r of months) {
      const ym = dateToYm(r.month);
      if (!ym) continue;
      if (ym > targetYm) break;

      const monthDate = ymToDate(ym);
      const curQ = await db.query(
        `SELECT notes FROM donas_finance_months WHERE slug=$1 AND month=$2::date LIMIT 1`,
        [SLUG, monthDate]
      );
      const cur = curQ.rows?.[0];
      if (!cur || !hasLockedTag(cur.notes)) continue;

      await db.query(
        `
        UPDATE donas_finance_months
        SET
          revenue=$3,
          cogs=$4,
          opex=$5,
          capex=$6,
          cash_end=$7,
          updated_at=NOW()
        WHERE slug=$1 AND month=$2::date
        `,
        [
          SLUG,
          monthDate,
          toNum(r.revenue),
          toNum(r.cogs),
          toNum(r.opex),
          toNum(r.capex),
          toNum(r.cash_end),
        ]
      );

      updatedCount += 1;
    }

    await auditInsert({
      ym: targetYm,
      action: "months.resnapshot_up_to",
      diff: { updatedCount },
      actor,
      meta: { updatedCount },
    });

    return res.json({ ok: true, updatedCount });
  } catch (e) {
    console.error("resnapshotUpTo error:", e);
    return res.status(500).json({ error: "Failed to bulk resnapshot" });
  }
};

/**
 * Audit endpoints
 */
exports.audit = async (req, res) => {
  try {
    await ensureFinanceTables();
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));

    const { rows } = await db.query(
      `
      SELECT *
      FROM donas_finance_audit
      WHERE slug=$1
      ORDER BY created_at DESC, id DESC
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

exports.auditMonth = async (req, res) => {
  try {
    await ensureFinanceTables();
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));

    const { rows } = await db.query(
      `
      SELECT *
      FROM donas_finance_audit
      WHERE slug=$1 AND ym=$2
      ORDER BY created_at DESC, id DESC
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

/**
 * CSV exports
 */
function csvEscape(v) {
  const s = String(v == null ? "" : v);
  if (s.includes('"') || s.includes(",") || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

exports.exportCsv = async (req, res) => {
  try {
    const { settings, months } = await computeMonthsView();

    // computed cashflow columns for UI
    const header = [
      "ym",
      "revenue",
      "cogs",
      "opex",
      "capex",
      "loan_paid",
      "gp",
      "netOp",
      "cf",
      "cash_end",
      "notes",
    ];

    const lines = [header.join(",")];

    for (const r of months) {
      const ym = dateToYm(r.month);
      const revenue = toNum(r.revenue);
      const cogs = toNum(r.cogs);
      const opex = toNum(r.opex);
      const capex = toNum(r.capex);
      const loan = toNum(r.loan_paid);

      const gp = revenue - cogs;
      const netOp = gp - opex;
      const cf = netOp - loan - capex;

      const row = [
        ym,
        revenue,
        cogs,
        opex,
        capex,
        loan,
        gp,
        netOp,
        cf,
        toNum(r.cash_end),
        String(r.notes || ""),
      ];

      lines.push(row.map(csvEscape).join(","));
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="donas_finance_months_${settings.currency || "UZS"}.csv"`
    );
    return res.send(lines.join("\n"));
  } catch (e) {
    console.error("exportCsv error:", e);
    return res.status(500).json({ error: "Failed to export csv" });
  }
};

exports.exportAuditCsv = async (req, res) => {
  try {
    await ensureFinanceTables();
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));

    const { rows } = await db.query(
      `
      SELECT *
      FROM donas_finance_audit
      WHERE slug=$1
      ORDER BY created_at DESC, id DESC
      LIMIT $2
      `,
      [SLUG, limit]
    );

    const header = ["created_at", "action", "ym", "actor_name", "actor_email", "diff"];
    const lines = [header.join(",")];

    for (const r of rows || []) {
      lines.push(
        [
          String(r.created_at || ""),
          String(r.action || ""),
          String(r.ym || ""),
          String(r.actor_name || ""),
          String(r.actor_email || ""),
          JSON.stringify(r.diff || {}),
        ]
          .map(csvEscape)
          .join(",")
      );
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="donas_finance_audit.csv"`);
    return res.send(lines.join("\n"));
  } catch (e) {
    console.error("exportAuditCsv error:", e);
    return res.status(500).json({ error: "Failed to export audit csv" });
  }
};

exports.exportAuditMonthCsv = async (req, res) => {
  try {
    await ensureFinanceTables();
    const ym = String(req.params.month || "").trim();
    if (!isYm(ym)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });

    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));

    const { rows } = await db.query(
      `
      SELECT *
      FROM donas_finance_audit
      WHERE slug=$1 AND ym=$2
      ORDER BY created_at DESC, id DESC
      LIMIT $3
      `,
      [SLUG, ym, limit]
    );

    const header = ["created_at", "action", "ym", "actor_name", "actor_email", "diff"];
    const lines = [header.join(",")];

    for (const r of rows || []) {
      lines.push(
        [
          String(r.created_at || ""),
          String(r.action || ""),
          String(r.ym || ""),
          String(r.actor_name || ""),
          String(r.actor_email || ""),
          JSON.stringify(r.diff || {}),
        ]
          .map(csvEscape)
          .join(",")
      );
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="donas_finance_audit_${ym}.csv"`
    );
    return res.send(lines.join("\n"));
  } catch (e) {
    console.error("exportAuditMonthCsv error:", e);
    return res.status(500).json({ error: "Failed to export month audit csv" });
  }
};

// legacy / not used by your UI right now:
exports.bulkResnapshot = async (req, res) => res.status(404).json({ error: "Use resnapshot-up-to" });
