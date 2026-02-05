// backend/controllers/donasFinanceMonthsController.js
const db = require("../db");

function getActor(req) {
  const u = req.user || {};
  return {
    id: u.id ?? null,
    role: String(u.role || "").toLowerCase() || null,
    email: u.email || u.mail || null,
    name: u.name || u.full_name || u.fullName || null,
  };
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function isYm(s) {
  return /^\d{4}-\d{2}$/.test(String(s || ""));
}

function monthToDate(ym) {
  // YYYY-MM -> YYYY-MM-01
  return `${ym}-01`;
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
    .filter((line) => line.trim().toLowerCase() !== "#locked")
    .join("\n")
    .trim();
}

// фиксируем slug для Dona's Dosas
const SLUG = "donas-dosas";

/**
 * =========================
 * Audit helpers
 * =========================
 */

async function logAudit(req, { action, ym = null, diff = {}, meta = {} }) {
  // Audit table может отсутствовать в старых БД — не ломаем сервер.
  try {
    const actor = getActor(req);
    await db.query(
      `
      INSERT INTO donas_finance_audit
        (slug, ym, action, actor_id, actor_role, actor_email, actor_name, diff, meta)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
      `,
      [
        SLUG,
        ym,
        action,
        actor.id,
        actor.role,
        actor.email,
        actor.name,
        JSON.stringify(diff || {}),
        JSON.stringify(meta || {}),
      ]
    );
  } catch (e) {
    // silently ignore
  }
}

/**
 * ВАЖНО:
 * В прод-таблице donas_finance_months может не быть unique constraint на (slug, month),
 * поэтому ON CONFLICT нельзя.
 *
 * Делаем idempotent insert через WHERE NOT EXISTS.
 */
async function ensureMonthRow(ym) {
  const d = monthToDate(ym);

  await db.query(
    `
    INSERT INTO donas_finance_months
      (slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes)
    SELECT
      $2, $1::date, 0, 0, 0, 0, 0, 0, ''
    WHERE NOT EXISTS (
      SELECT 1
      FROM donas_finance_months
      WHERE slug=$2 AND month=$1::date
      LIMIT 1
    )
    `,
    [d, SLUG]
  );
}

/**
 * Авто-суммы по месяцу (FACT):
 * - OPEX/CAPEX: из donas_purchases
 * - REVENUE/COGS: из donas_sales
 *
 * donas_sales уже хранит revenue_total и cogs_total — идеально для "Months".
 */
async function getAutoSumsByMonth() {
  const { rows } = await db.query(
    `
    WITH p AS (
      SELECT
        to_char(date_trunc('month', date)::date, 'YYYY-MM') as month,
        SUM(CASE WHEN type='opex'  THEN COALESCE(total, qty*price, 0) ELSE 0 END) as opex,
        SUM(CASE WHEN type='capex' THEN COALESCE(total, qty*price, 0) ELSE 0 END) as capex
      FROM donas_purchases
      GROUP BY 1
    ),
    s AS (
      SELECT
        to_char(date_trunc('month', sold_at)::date, 'YYYY-MM') as month,
        COALESCE(SUM(COALESCE(cogs_total, 0)), 0) as cogs,
        COALESCE(SUM(COALESCE(revenue_total, 0)), 0) as revenue
      FROM donas_sales
      GROUP BY 1
    )
    SELECT
      COALESCE(p.month, s.month) as month,
      COALESCE(p.opex, 0) as opex,
      COALESCE(p.capex, 0) as capex,
      COALESCE(s.cogs, 0) as cogs,
      COALESCE(s.revenue, 0) as revenue
    FROM p
    FULL JOIN s ON s.month = p.month
    ORDER BY 1 ASC
    `
  );

  const map = new Map();
  for (const r of rows || []) {
    map.set(String(r.month), {
      opex: toNum(r.opex),
      capex: toNum(r.capex),
      cogs: toNum(r.cogs),
      revenue: toNum(r.revenue),
    });
  }
  return map;
}

async function getSettingsRow() {
  const { rows } = await db.query(
    `SELECT * FROM donas_finance_settings ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`
  );
  return rows?.[0] || null;
}

async function getAllRelevantMonthsYms() {
  // months from purchases + sales + existing months rows
  const { rows } = await db.query(
    `
    WITH a AS (
      SELECT to_char(date_trunc('month', date)::date, 'YYYY-MM') as ym
      FROM donas_purchases
      UNION
      SELECT to_char(date_trunc('month', sold_at)::date, 'YYYY-MM') as ym
      FROM donas_sales
      UNION
      SELECT to_char(date_trunc('month', month)::date, 'YYYY-MM') as ym
      FROM donas_finance_months
      WHERE slug=$1
    )
    SELECT ym FROM a ORDER BY ym ASC
    `,
    [SLUG]
  );

  return (rows || []).map((r) => r.ym).filter(Boolean);
}

/**
 * =========================
 * Months view (READ)
 * =========================
 *
 * Главная витрина месяцев:
 * - unlock: revenue/cogs/opex/capex = auto (sales/purchases)
 * - locked: берём snapshot из таблицы (включая cash_end)
 * - loan_paid и notes всегда из таблицы
 *
 * Плюс:
 * - _diff = purchases - snapshot (для locked месяцев)
 *
 * IMPORTANT:
 * Таблица может содержать дубликаты month (нет unique). Поэтому берём только последнюю запись.
 */
async function computeMonthsView() {
  const allMonths = await getAllRelevantMonthsYms();
  for (const ym of allMonths) {
    if (isYm(ym)) await ensureMonthRow(ym);
  }

  const settings = await getSettingsRow();
  const openingCash = toNum(settings?.opening_cash);

  const autoMap = await getAutoSumsByMonth();

  const { rows } = await db.query(
    `
    SELECT DISTINCT ON (month)
      id,
      slug,
      to_char(month,'YYYY-MM') as month,
      revenue, cogs, opex, capex, loan_paid, cash_end,
      notes,
      updated_at
    FROM donas_finance_months
    WHERE slug=$1
    ORDER BY month ASC, updated_at DESC NULLS LAST, id DESC
    `,
    [SLUG]
  );

  const out = [];
  let prevCashEnd = openingCash;

  for (const r of rows || []) {
    const ym = String(r.month);
    const locked = hasLockedTag(r.notes);

    const storedRevenue = toNum(r.revenue);
    const loanPaid = toNum(r.loan_paid);

    const auto = autoMap.get(ym) || { opex: 0, capex: 0, cogs: 0, revenue: 0 };

    // ✅ Sales-first:
    // - locked: используем stored snapshot
    // - unlocked: всегда FACT из sales
    const revenue = locked ? storedRevenue : toNum(auto.revenue);
    const cogs = locked ? toNum(r.cogs) : toNum(auto.cogs);
    const opex = locked ? toNum(r.opex) : toNum(auto.opex);
    const capex = locked ? toNum(r.capex) : toNum(auto.capex);

    // purchases - snapshot (только для locked; для auto = 0)
    const diffOpex = locked ? toNum(auto.opex) - toNum(r.opex) : 0;
    const diffCapex = locked ? toNum(auto.capex) - toNum(r.capex) : 0;

    const opening = prevCashEnd;

    let cf = 0;
    let cashEnd = 0;

    if (locked) {
      cashEnd = toNum(r.cash_end);
      cf = cashEnd - opening;
    } else {
      cf = revenue - cogs - opex - capex - loanPaid;
      cashEnd = opening + cf;
    }

    const diff = cashEnd - opening;

    out.push({
      id: r.id,
      slug: r.slug,
      month: ym,
      revenue,
      cogs,
      opex,
      capex,
      loan_paid: loanPaid,
      cf,
      cash_end: cashEnd,
      diff,
      notes: r.notes || "",
      updated_at: r.updated_at,
      locked,
      _diff: { opex: diffOpex, capex: diffCapex },
    });

    prevCashEnd = cashEnd;
  }

  return { settings, months: out };
}

/**
 * =========================
 * Preview / planning helpers
 * =========================
 */

function calcCashEndFromParts(opening, { revenue, cogs, opex, capex, loan_paid }) {
  const cf = toNum(revenue) - toNum(cogs) - toNum(opex) - toNum(capex) - toNum(loan_paid);
  return { cf, cash_end: toNum(opening) + cf };
}

/**
 * IMPORTANT:
 * Таблица может содержать дубликаты month (нет unique). Поэтому берём только последнюю запись.
 */
async function loadMonthsBaseRows() {
  const settings = await getSettingsRow();
  const openingCash = toNum(settings?.opening_cash);
  const autoMap = await getAutoSumsByMonth();

  const { rows } = await db.query(
    `
    SELECT DISTINCT ON (month)
      id,
      to_char(month,'YYYY-MM') as ym,
      revenue, cogs, opex, capex, loan_paid, cash_end, notes,
      updated_at
    FROM donas_finance_months
    WHERE slug=$1
    ORDER BY month ASC, updated_at DESC NULLS LAST, id DESC
    `,
    [SLUG]
  );

  const list = (rows || []).map((r) => {
    const ym = String(r.ym);
    const locked = hasLockedTag(r.notes);
    const auto = autoMap.get(ym) || { opex: 0, capex: 0, cogs: 0, revenue: 0 };
    return {
      ym,
      locked,
      stored: {
        revenue: toNum(r.revenue),
        cogs: toNum(r.cogs),
        opex: toNum(r.opex),
        capex: toNum(r.capex),
        loan_paid: toNum(r.loan_paid),
        cash_end: toNum(r.cash_end),
        notes: String(r.notes || ""),
      },
      auto: {
        revenue: toNum(auto.revenue),
        cogs: toNum(auto.cogs),
        opex: toNum(auto.opex),
        capex: toNum(auto.capex),
      },
    };
  });

  return { settings, openingCash, months: list };
}

/**
 * Собираем план (preview):
 * - текущая модель: locked месяцы используют stored cash_end
 * - planned: для затронутых месяцев пересчитываем snapshot (включая cash_end)
 */
function buildPlannedChain({ openingCash, baseMonths, affect }) {
  const items = [];

  // current chain
  let curOpening = openingCash;
  const currentByYm = new Map();
  for (const m of baseMonths) {
    const ym = m.ym;
    const curLocked = m.locked;

    let revenue = curLocked ? m.stored.revenue : m.auto.revenue;
    let cogs = curLocked ? m.stored.cogs : m.auto.cogs;
    let opex = curLocked ? m.stored.opex : m.auto.opex;
    let capex = curLocked ? m.stored.capex : m.auto.capex;
    const loan_paid = m.stored.loan_paid;

    let cash_end;
    let cf;
    if (curLocked) {
      cash_end = m.stored.cash_end;
      cf = cash_end - curOpening;
    } else {
      const r = calcCashEndFromParts(curOpening, { revenue, cogs, opex, capex, loan_paid });
      cash_end = r.cash_end;
      cf = r.cf;
    }

    const row = {
      ym,
      locked: curLocked,
      revenue,
      cogs,
      opex,
      capex,
      loan_paid,
      cf,
      cash_end,
      notes: m.stored.notes,
    };
    currentByYm.set(ym, row);
    curOpening = cash_end;
  }

  // planned chain
  let planOpening = openingCash;
  const plannedByYm = new Map();
  for (const m of baseMonths) {
    const ym = m.ym;
    const a = affect(ym);

    let planLocked = m.locked;
    let revenue;
    let cogs;
    let opex;
    let capex;
    const loan_paid = m.stored.loan_paid;
    let notes = m.stored.notes;

    if (a?.type === "lock") {
      planLocked = true;
      notes = addLockedTag(notes);
      revenue = m.auto.revenue;
      cogs = m.auto.cogs;
      opex = m.auto.opex;
      capex = m.auto.capex;
      const r = calcCashEndFromParts(planOpening, { revenue, cogs, opex, capex, loan_paid });
      plannedByYm.set(ym, {
        ym,
        locked: true,
        revenue,
        cogs,
        opex,
        capex,
        loan_paid,
        cf: r.cf,
        cash_end: r.cash_end,
        notes,
      });
      planOpening = r.cash_end;
      continue;
    }

    if (a?.type === "resnapshot") {
      planLocked = true;
      notes = addLockedTag(notes);
      revenue = m.auto.revenue;
      cogs = m.auto.cogs;
      opex = m.auto.opex;
      capex = m.auto.capex;
      const r = calcCashEndFromParts(planOpening, { revenue, cogs, opex, capex, loan_paid });
      plannedByYm.set(ym, {
        ym,
        locked: true,
        revenue,
        cogs,
        opex,
        capex,
        loan_paid,
        cf: r.cf,
        cash_end: r.cash_end,
        notes,
      });
      planOpening = r.cash_end;
      continue;
    }

    // not affected
    if (planLocked) {
      revenue = m.stored.revenue;
      cogs = m.stored.cogs;
      opex = m.stored.opex;
      capex = m.stored.capex;
      const cash_end = m.stored.cash_end;
      plannedByYm.set(ym, {
        ym,
        locked: true,
        revenue,
        cogs,
        opex,
        capex,
        loan_paid,
        cf: cash_end - planOpening,
        cash_end,
        notes,
      });
      planOpening = cash_end;
    } else {
      revenue = m.auto.revenue;
      cogs = m.auto.cogs;
      opex = m.auto.opex;
      capex = m.auto.capex;
      const r = calcCashEndFromParts(planOpening, { revenue, cogs, opex, capex, loan_paid });
      plannedByYm.set(ym, {
        ym,
        locked: false,
        revenue,
        cogs,
        opex,
        capex,
        loan_paid,
        cf: r.cf,
        cash_end: r.cash_end,
        notes,
      });
      planOpening = r.cash_end;
    }
  }

  for (const m of baseMonths) {
    const ym = m.ym;
    const cur = currentByYm.get(ym);
    const plan = plannedByYm.get(ym);

    const purchases = m.auto;
    const snapO = cur?.locked ? toNum(m.stored.opex) : toNum(purchases.opex);
    const snapC = cur?.locked ? toNum(m.stored.capex) : toNum(purchases.capex);

    items.push({
      ym,
      purchases: { opex: toNum(purchases.opex), capex: toNum(purchases.capex) },
      current: cur,
      planned: plan,
      diff: {
        opex: toNum(purchases.opex) - toNum(snapO),
        capex: toNum(purchases.capex) - toNum(snapC),
      },
    });
  }

  return { items, currentByYm, plannedByYm };
}

/**
 * =========================
 * Chain guards (production)
 * =========================
 */

function lastLockedYm(baseMonths) {
  const locked = (baseMonths || []).filter((m) => !!m.locked).map((m) => m.ym);
  if (!locked.length) return null;
  locked.sort();
  return locked[locked.length - 1];
}

function isLastLocked(baseMonths, targetYm) {
  const last = lastLockedYm(baseMonths);
  return last && String(last) === String(targetYm);
}

function hasLockedAfter(baseMonths, targetYm) {
  return (baseMonths || []).some((m) => m.locked && String(m.ym) > String(targetYm));
}

function hasUnlockedBeforeWithLockedAfter(baseMonths, targetYm) {
  // если есть locked после target и при этом target сейчас unlocked — lock single "в середине" не разрешаем
  const target = baseMonths.find((m) => String(m.ym) === String(targetYm));
  if (!target) return false;
  return !target.locked && hasLockedAfter(baseMonths, targetYm);
}

/** ===================== Settings ===================== */
exports.getSettings = async (_req, res) => {
  try {
    const row = await getSettingsRow();
    return res.json(row);
  } catch (e) {
    console.error("getSettings error:", e);
    return res.status(500).json({ error: "Failed to load settings" });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const body = req.body || {};

    const { rows: curRows } = await db.query(
      `SELECT id FROM donas_finance_settings ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`
    );

    let id = curRows?.[0]?.id;

    if (!id) {
      const ins = await db.query(`INSERT INTO donas_finance_settings DEFAULT VALUES RETURNING id`);
      id = ins.rows?.[0]?.id;
    }

    const keys = Object.keys(body || {}).filter((k) => k !== "id");
    if (!keys.length) {
      const { rows } = await db.query(`SELECT * FROM donas_finance_settings WHERE id=$1`, [id]);
      return res.json(rows?.[0] || null);
    }

    const sets = [];
    const vals = [];
    let k = 2;

    for (const key of keys) {
      sets.push(`${key}=$${k++}`);
      vals.push(body[key]);
    }

    const q = `
      UPDATE donas_finance_settings
      SET ${sets.join(", ")}, updated_at=NOW()
      WHERE id=$1
      RETURNING *
    `;

    const { rows } = await db.query(q, [id, ...vals]);

    await logAudit(req, {
      action: "settings.update",
      ym: null,
      diff: keys.reduce((acc, k2) => {
        acc[k2] = body[k2];
        return acc;
      }, {}),
    });

    return res.json(rows?.[0] || null);
  } catch (e) {
    console.error("updateSettings error:", e);
    return res.status(500).json({ error: "Failed to update settings" });
  }
};

/** ===================== Months list / sync ===================== */
exports.listMonths = async (_req, res) => {
  try {
    const view = await computeMonthsView();
    return res.json(view.months);
  } catch (e) {
    console.error("listMonths error:", e);
    return res.status(500).json({ error: "Failed to load months" });
  }
};

exports.syncMonths = async (req, res) => {
  try {
    const allMonths = await getAllRelevantMonthsYms();
    let created = 0;

    for (const ym of allMonths) {
      if (!isYm(ym)) continue;
      const d = monthToDate(ym);
      const r = await db.query(
        `
        INSERT INTO donas_finance_months
          (slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes)
        SELECT
          $2, $1::date, 0, 0, 0, 0, 0, 0, ''
        WHERE NOT EXISTS (
          SELECT 1
          FROM donas_finance_months
          WHERE slug=$2 AND month=$1::date
          LIMIT 1
        )
        `,
        [d, SLUG]
      );
      if (r.rowCount > 0) created += 1;
    }

    await logAudit(req, {
      action: "months.sync",
      ym: null,
      diff: { created },
    });

    const view = await computeMonthsView();
    return res.json({ ok: true, created, months: view.months });
  } catch (e) {
    console.error("syncMonths error:", e);
    return res.status(500).json({ error: "Failed to sync months" });
  }
};

/**
 * PUT /api/admin/donas/finance/months/:month
 * ✅ вручную можно менять только loan_paid и notes.
 */
exports.updateMonth = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    await ensureMonthRow(month);

    const { rows: curRows } = await db.query(
      `
      SELECT notes
      FROM donas_finance_months
      WHERE slug=$2 AND month=$1::date
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT 1
      `,
      [monthToDate(month), SLUG]
    );
    const curNotes = String(curRows?.[0]?.notes || "");
    if (hasLockedTag(curNotes)) {
      return res.status(409).json({ error: "Month is locked (#locked). Remove tag to edit." });
    }

    const b = req.body || {};
    const loanPaid = toNum(b.loan_paid);
    const notes = String(b.notes ?? "");

    const before = await db.query(
      `
      SELECT loan_paid, notes
      FROM donas_finance_months
      WHERE slug=$2 AND month=$1::date
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT 1
      `,
      [monthToDate(month), SLUG]
    );
    const beforeRow = before.rows?.[0] || {};

    await db.query(
      `
      UPDATE donas_finance_months
      SET loan_paid=$3, notes=$4, updated_at=NOW()
      WHERE slug=$2 AND month=$1::date
      `,
      [monthToDate(month), SLUG, loanPaid, notes]
    );

    await logAudit(req, {
      action: "month.update",
      ym: month,
      diff: {
        loan_paid: { from: toNum(beforeRow.loan_paid), to: loanPaid },
        notes: { from: String(beforeRow.notes || ""), to: notes },
      },
    });

    const view = await computeMonthsView();
    const row = view.months.find((x) => x.month === month) || null;
    return res.json({ ok: true, month: row });
  } catch (e) {
    console.error("updateMonth error:", e);
    return res.status(500).json({ error: "Failed to update month" });
  }
};

/** ===================== Lock / Unlock / Snapshot ===================== */
exports.lockMonth = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    await ensureMonthRow(month);

    const base = await loadMonthsBaseRows();

    // Guard: нельзя lock single "в середине", если после есть locked (иначе цепочка будет странной)
    if (hasUnlockedBeforeWithLockedAfter(base.months, month)) {
      return res.status(409).json({
        error: `Cannot lock ${month} because there are locked months after it. Use lock-up-to.`,
      });
    }

    const target = month;

    const planned = buildPlannedChain({
      openingCash: base.openingCash,
      baseMonths: base.months,
      affect: (ym) => (ym === target ? { type: "lock" } : null),
    });

    const row = planned.plannedByYm.get(target);
    if (!row) return res.status(404).json({ error: "Month not found" });

    const before = await db.query(
      `
      SELECT revenue,cogs,opex,capex,cash_end,notes
      FROM donas_finance_months
      WHERE slug=$2 AND month=$1::date
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT 1
      `,
      [monthToDate(month), SLUG]
    );
    const b = before.rows?.[0] || {};

    const nextNotes = addLockedTag(row.notes);

    await db.query(
      `
      UPDATE donas_finance_months
      SET revenue=$3, cogs=$4, opex=$5, capex=$6, cash_end=$7, notes=$8, updated_at=NOW()
      WHERE slug=$2 AND month=$1::date
      `,
      [
        monthToDate(month),
        SLUG,
        toNum(row.revenue),
        toNum(row.cogs),
        toNum(row.opex),
        toNum(row.capex),
        toNum(row.cash_end),
        nextNotes,
      ]
    );

    await logAudit(req, {
      action: "month.lock",
      ym: month,
      diff: {
        revenue: { from: toNum(b.revenue), to: toNum(row.revenue) },
        cogs: { from: toNum(b.cogs), to: toNum(row.cogs) },
        opex: { from: toNum(b.opex), to: toNum(row.opex) },
        capex: { from: toNum(b.capex), to: toNum(row.capex) },
        cash_end: { from: toNum(b.cash_end), to: toNum(row.cash_end) },
        notes: { from: String(b.notes || ""), to: nextNotes },
      },
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("lockMonth error:", e);
    return res.status(500).json({ error: "Failed to lock month" });
  }
};

exports.unlockMonth = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    await ensureMonthRow(month);

    const base = await loadMonthsBaseRows();

    // Guard: unlock только последнего locked (иначе цепочка cash_end ломается)
    if (!isLastLocked(base.months, month)) {
      const last = lastLockedYm(base.months);
      return res.status(409).json({
        error: `Only the last locked month can be unlocked. Last locked is ${last || "none"}.`,
      });
    }

    const { rows } = await db.query(
      `
      SELECT notes
      FROM donas_finance_months
      WHERE slug=$2 AND month=$1::date
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT 1
      `,
      [monthToDate(month), SLUG]
    );

    const notes = String(rows?.[0]?.notes || "");
    const newNotes = removeLockedTag(notes);
    const beforeNotes = notes;

    await db.query(
      `
      UPDATE donas_finance_months
      SET notes=$3, updated_at=NOW()
      WHERE slug=$2 AND month=$1::date
      `,
      [monthToDate(month), SLUG, newNotes]
    );

    await logAudit(req, {
      action: "month.unlock",
      ym: month,
      diff: { notes: { from: beforeNotes, to: newNotes } },
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("unlockMonth error:", e);
    return res.status(500).json({ error: "Failed to unlock month" });
  }
};

exports.resnapshotMonth = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    await ensureMonthRow(month);

    const base = await loadMonthsBaseRows();
    const target = month;

    // Если после target есть locked — делаем chain resnapshot target..lastLocked, чтобы cash_end совпал
    const last = lastLockedYm(base.months);
    const doChain = last && String(last) > String(target);

    if (doChain) {
      // обновим все locked в диапазоне [target..last]
      let updated = 0;

      const planned = buildPlannedChain({
        openingCash: base.openingCash,
        baseMonths: base.months,
        affect: (ym) => {
          if (String(ym) < String(target)) return null;
          if (String(ym) > String(last)) return null;
          const m = base.months.find((x) => x.ym === ym);
          if (!m?.locked) return null;
          return { type: "resnapshot" };
        },
      });

      for (const m of base.months) {
        const ym = m.ym;
        if (String(ym) < String(target) || String(ym) > String(last)) continue;
        if (!m.locked) continue;

        const row = planned.plannedByYm.get(ym);
        if (!row) continue;

        await db.query(
          `
          UPDATE donas_finance_months
          SET revenue=$3, cogs=$4, opex=$5, capex=$6, cash_end=$7, notes=$8, updated_at=NOW()
          WHERE slug=$2 AND month=$1::date
          `,
          [
            monthToDate(ym),
            SLUG,
            toNum(row.revenue),
            toNum(row.cogs),
            toNum(row.opex),
            toNum(row.capex),
            toNum(row.cash_end),
            addLockedTag(row.notes),
          ]
        );

        updated += 1;
      }

      await logAudit(req, {
        action: "month.resnapshot_chain",
        ym: month,
        diff: { from: target, to: last, updated },
      });

      return res.json({ ok: true, updated, chain: { from: target, to: last } });
    }

    // обычный single resnapshot
    const planned = buildPlannedChain({
      openingCash: base.openingCash,
      baseMonths: base.months,
      affect: (ym) => (ym === target ? { type: "resnapshot" } : null),
    });

    const row = planned.plannedByYm.get(target);
    if (!row) return res.status(404).json({ error: "Month not found" });

    const before = await db.query(
      `
      SELECT revenue,cogs,opex,capex,cash_end,notes
      FROM donas_finance_months
      WHERE slug=$2 AND month=$1::date
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT 1
      `,
      [monthToDate(month), SLUG]
    );
    const b = before.rows?.[0] || {};

    await db.query(
      `
      UPDATE donas_finance_months
      SET revenue=$3, cogs=$4, opex=$5, capex=$6, cash_end=$7, notes=$8, updated_at=NOW()
      WHERE slug=$2 AND month=$1::date
      `,
      [
        monthToDate(month),
        SLUG,
        toNum(row.revenue),
        toNum(row.cogs),
        toNum(row.opex),
        toNum(row.capex),
        toNum(row.cash_end),
        addLockedTag(row.notes),
      ]
    );

    await logAudit(req, {
      action: "month.resnapshot",
      ym: month,
      diff: {
        revenue: { from: toNum(b.revenue), to: toNum(row.revenue) },
        cogs: { from: toNum(b.cogs), to: toNum(row.cogs) },
        opex: { from: toNum(b.opex), to: toNum(row.opex) },
        capex: { from: toNum(b.capex), to: toNum(row.capex) },
        cash_end: { from: toNum(b.cash_end), to: toNum(row.cash_end) },
      },
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("resnapshotMonth error:", e);
    return res.status(500).json({ error: "Failed to resnapshot month" });
  }
};

exports.lockUpTo = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    const base = await loadMonthsBaseRows();
    const target = month;

    const planned = buildPlannedChain({
      openingCash: base.openingCash,
      baseMonths: base.months,
      affect: (ym) => (String(ym) <= String(target) ? { type: "lock" } : null),
    });

    let lockedCount = 0;
    for (const m of base.months) {
      const ym = m.ym;
      if (String(ym) > String(target)) continue;
      const row = planned.plannedByYm.get(ym);
      if (!row) continue;

      await db.query(
        `
        UPDATE donas_finance_months
        SET revenue=$3, cogs=$4, opex=$5, capex=$6, cash_end=$7, notes=$8, updated_at=NOW()
        WHERE slug=$2 AND month=$1::date
        `,
        [
          monthToDate(ym),
          SLUG,
          toNum(row.revenue),
          toNum(row.cogs),
          toNum(row.opex),
          toNum(row.capex),
          toNum(row.cash_end),
          addLockedTag(row.notes),
        ]
      );
      lockedCount += 1;
    }

    await logAudit(req, {
      action: "month.lock_upto",
      ym: month,
      diff: { lockedCount },
    });

    return res.json({ ok: true, locked: lockedCount });
  } catch (e) {
    console.error("lockUpTo error:", e);
    return res.status(500).json({ error: "Failed to lock up to month" });
  }
};

exports.bulkResnapshot = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    const base = await loadMonthsBaseRows();
    const target = month;

    const planned = buildPlannedChain({
      openingCash: base.openingCash,
      baseMonths: base.months,
      affect: (ym) => {
        if (String(ym) > String(target)) return null;
        const baseRow = base.months.find((x) => x.ym === ym);
        if (!baseRow?.locked) return null;
        return { type: "resnapshot" };
      },
    });

    let updated = 0;
    for (const m of base.months) {
      const ym = m.ym;
      if (String(ym) > String(target)) continue;
      if (!m.locked) continue;
      const row = planned.plannedByYm.get(ym);
      if (!row) continue;

      await db.query(
        `
        UPDATE donas_finance_months
        SET revenue=$3, cogs=$4, opex=$5, capex=$6, cash_end=$7, notes=$8, updated_at=NOW()
        WHERE slug=$2 AND month=$1::date
        `,
        [
          monthToDate(ym),
          SLUG,
          toNum(row.revenue),
          toNum(row.cogs),
          toNum(row.opex),
          toNum(row.capex),
          toNum(row.cash_end),
          addLockedTag(row.notes),
        ]
      );
      updated += 1;
    }

    await logAudit(req, {
      action: "month.resnapshot_upto",
      ym: month,
      diff: { updated },
    });

    return res.json({ ok: true, updated });
  } catch (e) {
    console.error("bulkResnapshot error:", e);
    return res.status(500).json({ error: "Failed to bulk resnapshot" });
  }
};

// alias for UI: POST .../resnapshot-up-to
exports.resnapshotUpTo = exports.bulkResnapshot;

/** ===================== Previews (UI) ===================== */

exports.lockPreview = async (req, res) => {
  try {
    const { month } = req.params;
    const scope = String(req.query.scope || "single").toLowerCase();
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    const base = await loadMonthsBaseRows();
    const target = month;

    const affect = (ym) => {
      if (scope === "upto") return String(ym) <= String(target) ? { type: "lock" } : null;
      return ym === target ? { type: "lock" } : null;
    };

    const chain = buildPlannedChain({
      openingCash: base.openingCash,
      baseMonths: base.months,
      affect,
    });

    const curTarget = chain.currentByYm.get(target);
    const planTarget = chain.plannedByYm.get(target);
    const deltaCashEndAtTarget = toNum(planTarget?.cash_end) - toNum(curTarget?.cash_end);

    const affectedLockedCount = base.months.filter((m) => affect(m.ym) && !m.locked).length;

    return res.json({
      scope,
      target,
      summary: {
        targetWasLocked: !!curTarget?.locked,
        affectedLockedCount,
        deltaCashEndAtTarget,
      },
      items: chain.items.filter((it) => (scope === "upto" ? it.ym <= target : it.ym === target)),
    });
  } catch (e) {
    console.error("lockPreview error:", e);
    return res.status(500).json({ error: "Failed to build lock preview" });
  }
};

exports.resnapshotUpToPreview = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }
    const base = await loadMonthsBaseRows();
    const target = month;

    const affect = (ym) => {
      if (String(ym) > String(target)) return null;
      const m = base.months.find((x) => x.ym === ym);
      if (!m?.locked) return null;
      return { type: "resnapshot" };
    };

    const chain = buildPlannedChain({
      openingCash: base.openingCash,
      baseMonths: base.months,
      affect,
    });

    const curTarget = chain.currentByYm.get(target);
    const planTarget = chain.plannedByYm.get(target);
    const deltaCashEndAtTarget = toNum(planTarget?.cash_end) - toNum(curTarget?.cash_end);

    const affectedLockedCount = base.months.filter((m) => !!affect(m.ym)).length;

    return res.json({
      scope: "upto",
      target,
      summary: {
        affectedLockedCount,
        deltaCashEndAtTarget,
      },
      items: chain.items.filter((it) => it.ym <= target && it.current?.locked),
    });
  } catch (e) {
    console.error("resnapshotUpToPreview error:", e);
    return res.status(500).json({ error: "Failed to build resnapshot preview" });
  }
};

/** ===================== Export / Audit ===================== */
exports.exportCsv = async (_req, res) => {
  try {
    const view = await computeMonthsView();

    const header = [
      "month",
      "revenue",
      "cogs",
      "opex",
      "capex",
      "loan_paid",
      "cf",
      "cash_end",
      "diff",
      "locked",
      "notes",
    ].join(",");

    const lines = [header];

    for (const r of view.months) {
      const notes = String(r.notes || "").replace(/\"/g, "\"\"");
      const notesCell = `"${notes}"`;

      lines.push(
        [
          r.month,
          toNum(r.revenue),
          toNum(r.cogs),
          toNum(r.opex),
          toNum(r.capex),
          toNum(r.loan_paid),
          toNum(r.cf),
          toNum(r.cash_end),
          toNum(r.diff),
          r.locked ? "1" : "0",
          notesCell,
        ].join(",")
      );
    }

    const csv = lines.join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="donas_months.csv"`);
    return res.send(csv);
  } catch (e) {
    console.error("exportCsv error:", e);
    return res.status(500).json({ error: "Failed to export CSV" });
  }
};

async function queryAudit({ ym = null, limit = 200 }) {
  const lim = Math.min(Math.max(toNum(limit) || 200, 1), 500);
  const args = [SLUG];
  let where = "slug=$1";
  if (ym) {
    args.push(ym);
    where += ` AND ym=$${args.length}`;
  }
  args.push(lim);

  const { rows } = await db.query(
    `
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
    FROM donas_finance_audit
    WHERE ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT $${args.length}
    `,
    args
  );
  return rows || [];
}

function auditRowToUi(r) {
  return {
    id: r.id,
    ym: r.ym,
    action: r.action,
    actor_id: r.actor_id,
    actor_role: r.actor_role,
    actor_email: r.actor_email,
    actor_name: r.actor_name,
    diff: r.diff || {},
    meta: r.meta || {},
    created_at: r.created_at,
  };
}

exports.audit = async (req, res) => {
  try {
    const limit = Math.min(Math.max(toNum(req.query.limit) || 200, 1), 500);
    try {
      const rows = await queryAudit({ ym: null, limit });
      return res.json(rows.map(auditRowToUi));
    } catch (e) {
      // fallback for старых БД
      const { rows } = await db.query(
        `
        SELECT to_char(month,'YYYY-MM') as month, updated_at, notes
        FROM donas_finance_months
        WHERE slug=$1
        ORDER BY updated_at DESC NULLS LAST, month DESC
        LIMIT $2
        `,
        [SLUG, Math.min(limit, 200)]
      );
      return res.json(
        (rows || []).map((r, idx) => ({
          id: `fallback-${idx}`,
          ym: r.month,
          action: "month.touch",
          actor_name: null,
          actor_email: null,
          diff: {},
          created_at: r.updated_at,
        }))
      );
    }
  } catch (e) {
    console.error("audit error:", e);
    return res.status(500).json({ error: "Failed to load audit" });
  }
};

exports.auditMonth = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }
    const limit = Math.min(Math.max(toNum(req.query.limit) || 200, 1), 500);
    const rows = await queryAudit({ ym: month, limit });
    return res.json(rows.map(auditRowToUi));
  } catch (e) {
    console.error("auditMonth error:", e);
    return res.status(500).json({ error: "Failed to load month audit" });
  }
};

exports.exportAuditCsv = async (req, res) => {
  try {
    const limit = Math.min(Math.max(toNum(req.query.limit) || 200, 1), 500);
    const rows = await queryAudit({ ym: null, limit });

    const header = ["created_at", "action", "ym", "actor_name", "actor_email", "diff"].join(",");
    const lines = [header];
    for (const r of rows) {
      const diff = JSON.stringify(r.diff || {}).replace(/"/g, '""');
      lines.push(
        [
          String(r.created_at || "").replace("T", " ").slice(0, 19),
          String(r.action || ""),
          String(r.ym || ""),
          String(r.actor_name || ""),
          String(r.actor_email || ""),
          `"${diff}"`,
        ].join(",")
      );
    }
    const csv = lines.join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="donas_audit.csv"`);
    return res.send(csv);
  } catch (e) {
    console.error("exportAuditCsv error:", e);
    return res.status(500).json({ error: "Failed to export audit CSV" });
  }
};

exports.exportAuditMonthCsv = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }
    const limit = Math.min(Math.max(toNum(req.query.limit) || 200, 1), 500);
    const rows = await queryAudit({ ym: month, limit });

    const header = ["created_at", "action", "ym", "actor_name", "actor_email", "diff"].join(",");
    const lines = [header];
    for (const r of rows) {
      const diff = JSON.stringify(r.diff || {}).replace(/"/g, '""');
      lines.push(
        [
          String(r.created_at || "").replace("T", " ").slice(0, 19),
          String(r.action || ""),
          String(r.ym || ""),
          String(r.actor_name || ""),
          String(r.actor_email || ""),
          `"${diff}"`,
        ].join(",")
      );
    }
    const csv = lines.join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="donas_audit_${month}.csv"`);
    return res.send(csv);
  } catch (e) {
    console.error("exportAuditMonthCsv error:", e);
    return res.status(500).json({ error: "Failed to export month audit CSV" });
  }
};
