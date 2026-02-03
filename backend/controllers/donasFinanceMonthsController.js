// backend/controllers/donasFinanceMonthsController.js

const db = require("../db");

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

function dateToYm(d) {
  // DATE -> YYYY-MM
  if (!d) return "";
  const s = String(d);
  // could be '2026-02-01T...' or '2026-02-01'
  return s.slice(0, 7);
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
 * ВАЖНО:
 * В твоей прод-таблице donas_finance_months, судя по ошибке,
 * НЕТ unique constraint на (month) или (slug, month),
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
 * Авто-суммы по месяцу:
 * - OPEX/CAPEX: из donas_purchases
 * - COGS: из donas_sales (ВАЖНО: COGS = Σ(qty * себестоимость на момент продажи))
 *
 * donas_sales уже хранит cogs_total (и cogs_unit) — это идеально для "Months".
 * Для locked-месяцев по-прежнему используется snapshot в donas_finance_months.
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
        COALESCE(SUM(COALESCE(cogs_total, 0)), 0) as cogs
      FROM donas_sales
      GROUP BY 1
    )
    SELECT
      COALESCE(p.month, s.month) as month,
      COALESCE(p.opex, 0) as opex,
      COALESCE(p.capex, 0) as capex,
      COALESCE(s.cogs, 0) as cogs
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
    });
  }
  return map;
}

/**
 * Вытаскиваем список месяцев, которые "должны быть" в finance:
 * - из purchases (opex/capex)
 * - из sales (cogs по продажам)
 * - из существующих donas_finance_months
 *
 * Можно расширить на shifts/revenue источники позже.
 */
async function getAllRelevantMonthsYms() {
  const { rows } = await db.query(
    `
    WITH m AS (
      SELECT to_char(date_trunc('month', date)::date, 'YYYY-MM') as month
      FROM donas_purchases
      GROUP BY 1

      UNION

      SELECT to_char(date_trunc('month', sold_at)::date, 'YYYY-MM') as month
      FROM donas_sales
      GROUP BY 1

      UNION

      SELECT to_char(month::date, 'YYYY-MM') as month
      FROM donas_finance_months
      WHERE slug=$1
      GROUP BY 1
    )
    SELECT month
    FROM m
    ORDER BY month ASC
    `,
    [SLUG]
  );

  return (rows || []).map((r) => String(r.month));
}

/**
 * Получаем settings (берём последнюю строку).
 * Фронт сейчас использует только currency, но для cash chain полезно opening_cash.
 */
async function getSettingsRow() {
  try {
    const { rows } = await db.query(
      `SELECT * FROM donas_finance_settings ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`
    );
    return rows?.[0] || null;
  } catch {
    // если таблицы settings нет или схема иная — не валим months
    return null;
  }
}

/**
 * Строим months view:
 * - подтягиваем базовые строки из donas_finance_months
 * - для unlocked месяцев подставляем авто cogs/opex/capex (cogs из sales!)
 * - считаем cf, cash_end, diff по цепочке
 *
 * Snapshot/locked:
 * - locked месяц = notes содержит #locked
 * - для locked месяцев НЕ меняем stored opex/capex/cogs/cash_end
 * - cf считаем как cash_end - opening (чтобы соответствовало снапшоту)
 */
async function computeMonthsView() {
  // ensure rows for all relevant months
  const allMonths = await getAllRelevantMonthsYms();
  for (const ym of allMonths) {
    if (isYm(ym)) await ensureMonthRow(ym);
  }

  const settings = await getSettingsRow();
  const openingCash = toNum(settings?.opening_cash);

  const autoMap = await getAutoSumsByMonth();

  const { rows } = await db.query(
    `
    SELECT
      id,
      slug,
      to_char(month,'YYYY-MM') as month,
      revenue, cogs, opex, capex, loan_paid, cash_end,
      notes,
      updated_at
    FROM donas_finance_months
    WHERE slug=$1
    ORDER BY month ASC
    `,
    [SLUG]
  );

  // normalize and compute
  const out = [];
  let prevCashEnd = openingCash;

  for (const r of rows || []) {
    const ym = String(r.month);
    const locked = hasLockedTag(r.notes);

    const revenue = toNum(r.revenue);
    const loanPaid = toNum(r.loan_paid);

    // auto (only for unlocked)
    const auto = autoMap.get(ym) || { opex: 0, capex: 0, cogs: 0 };

    const cogs = locked ? toNum(r.cogs) : toNum(auto.cogs);
    const opex = locked ? toNum(r.opex) : toNum(auto.opex);
    const capex = locked ? toNum(r.capex) : toNum(auto.capex);

    const opening = prevCashEnd;

    let cf = 0;
    let cashEnd = 0;

    if (locked) {
      // snapshot mode
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
    });

    prevCashEnd = cashEnd;
  }

  return { settings, months: out };
}

/**
 * Фронт ждёт:
 * GET  /api/admin/donas/finance/settings   -> raw row (или null)
 * PUT  /api/admin/donas/finance/settings   -> raw row
 */
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
      const ins = await db.query(
        `INSERT INTO donas_finance_settings DEFAULT VALUES RETURNING id`
      );
      id = ins.rows?.[0]?.id;
    }

    const keys = Object.keys(body || {}).filter((k) => k !== "id");
    if (!keys.length) {
      const { rows } = await db.query(
        `SELECT * FROM donas_finance_settings WHERE id=$1`,
        [id]
      );
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
    return res.json(rows?.[0] || null);
  } catch (e) {
    console.error("updateSettings error:", e);
    return res.status(500).json({ error: "Failed to update settings" });
  }
};

/**
 * Фронт ждёт:
 * GET /api/admin/donas/finance/months  -> array
 */
exports.listMonths = async (_req, res) => {
  try {
    const view = await computeMonthsView();
    return res.json(view.months);
  } catch (e) {
    console.error("listMonths error:", e);
    return res.status(500).json({ error: "Failed to load months" });
  }
};

/**
 * POST /api/admin/donas/finance/months/sync
 * - создаём строки месяцев для всех релевантных месяцев
 * - возвращаем обновлённый список
 */
exports.syncMonths = async (_req, res) => {
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

    const view = await computeMonthsView();
    return res.json({ ok: true, created, months: view.months });
  } catch (e) {
    console.error("syncMonths error:", e);
    return res.status(500).json({ error: "Failed to sync months" });
  }
};

/**
 * PUT /api/admin/donas/finance/months/:month
 * сохраняем РУЧНЫЕ поля: revenue, loan_paid, notes
 */
exports.updateMonth = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    await ensureMonthRow(month);

    // если locked — запрещаем менять
    const { rows: curRows } = await db.query(
      `SELECT notes FROM donas_finance_months WHERE slug=$2 AND month=$1::date LIMIT 1`,
      [monthToDate(month), SLUG]
    );
    const curNotes = String(curRows?.[0]?.notes || "");
    if (hasLockedTag(curNotes)) {
      return res.status(409).json({ error: "Month is locked (#locked). Remove tag to edit." });
    }

    const b = req.body || {};
    const revenue = toNum(b.revenue);
    const loanPaid = toNum(b.loan_paid);
    const notes = String(b.notes ?? "");

    await db.query(
      `
      UPDATE donas_finance_months
      SET revenue=$3, loan_paid=$4, notes=$5, updated_at=NOW()
      WHERE slug=$2 AND month=$1::date
      `,
      [monthToDate(month), SLUG, revenue, loanPaid, notes]
    );

    const view = await computeMonthsView();
    const row = view.months.find((x) => x.month === month) || null;
    return res.json({ ok: true, month: row });
  } catch (e) {
    console.error("updateMonth error:", e);
    return res.status(500).json({ error: "Failed to update month" });
  }
};

/**
 * POST /api/admin/donas/finance/months/:month/lock
 */
exports.lockMonth = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    await ensureMonthRow(month);

    const view = await computeMonthsView();
    const row = view.months.find((x) => x.month === month);
    if (!row) return res.status(404).json({ error: "Month not found" });

    const newNotes = addLockedTag(row.notes);

    await db.query(
      `
      UPDATE donas_finance_months
      SET
        cogs=$3,
        opex=$4,
        capex=$5,
        cash_end=$6,
        notes=$7,
        updated_at=NOW()
      WHERE slug=$2 AND month=$1::date
      `,
      [
        monthToDate(month),
        SLUG,
        toNum(row.cogs),
        toNum(row.opex),
        toNum(row.capex),
        toNum(row.cash_end),
        newNotes,
      ]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("lockMonth error:", e);
    return res.status(500).json({ error: "Failed to lock month" });
  }
};

/**
 * POST /api/admin/donas/finance/months/:month/unlock
 */
exports.unlockMonth = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    await ensureMonthRow(month);

    const { rows } = await db.query(
      `SELECT notes FROM donas_finance_months WHERE slug=$2 AND month=$1::date LIMIT 1`,
      [monthToDate(month), SLUG]
    );

    const notes = String(rows?.[0]?.notes || "");
    const newNotes = removeLockedTag(notes);

    await db.query(
      `UPDATE donas_finance_months SET notes=$3, updated_at=NOW() WHERE slug=$2 AND month=$1::date`,
      [monthToDate(month), SLUG, newNotes]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("unlockMonth error:", e);
    return res.status(500).json({ error: "Failed to unlock month" });
  }
};

/**
 * POST /api/admin/donas/finance/months/:month/resnapshot
 */
exports.resnapshotMonth = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    await ensureMonthRow(month);

    const view = await computeMonthsView();
    const row = view.months.find((x) => x.month === month);
    if (!row) return res.status(404).json({ error: "Month not found" });

    const keepLocked = row.locked || hasLockedTag(row.notes);
    const notes = keepLocked ? addLockedTag(row.notes) : row.notes;

    await db.query(
      `
      UPDATE donas_finance_months
      SET
        cogs=$3,
        opex=$4,
        capex=$5,
        cash_end=$6,
        notes=$7,
        updated_at=NOW()
      WHERE slug=$2 AND month=$1::date
      `,
      [
        monthToDate(month),
        SLUG,
        toNum(row.cogs),
        toNum(row.opex),
        toNum(row.capex),
        toNum(row.cash_end),
        notes || "",
      ]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("resnapshotMonth error:", e);
    return res.status(500).json({ error: "Failed to resnapshot month" });
  }
};

/**
 * POST /api/admin/donas/finance/months/:month/lock-up-to
 */
exports.lockUpTo = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    const view = await computeMonthsView();
    const target = month;

    let lockedCount = 0;

    for (const r of view.months) {
      if (String(r.month) > target) continue;

      const newNotes = addLockedTag(r.notes);

      await db.query(
        `
        UPDATE donas_finance_months
        SET cogs=$3, opex=$4, capex=$5, cash_end=$6, notes=$7, updated_at=NOW()
        WHERE slug=$2 AND month=$1::date
        `,
        [
          monthToDate(r.month),
          SLUG,
          toNum(r.cogs),
          toNum(r.opex),
          toNum(r.capex),
          toNum(r.cash_end),
          newNotes,
        ]
      );

      lockedCount += 1;
    }

    return res.json({ ok: true, locked: lockedCount });
  } catch (e) {
    console.error("lockUpTo error:", e);
    return res.status(500).json({ error: "Failed to lock up to month" });
  }
};

/**
 * POST /api/admin/donas/finance/months/:month/bulk-resnapshot
 */
exports.bulkResnapshot = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    const view = await computeMonthsView();
    const target = month;

    let updated = 0;

    for (const r of view.months) {
      if (String(r.month) > target) continue;
      if (!r.locked) continue;

      const notes = addLockedTag(r.notes);

      await db.query(
        `
        UPDATE donas_finance_months
        SET cogs=$3, opex=$4, capex=$5, cash_end=$6, notes=$7, updated_at=NOW()
        WHERE slug=$2 AND month=$1::date
        `,
        [
          monthToDate(r.month),
          SLUG,
          toNum(r.cogs),
          toNum(r.opex),
          toNum(r.capex),
          toNum(r.cash_end),
          notes,
        ]
      );

      updated += 1;
    }

    return res.json({ ok: true, updated });
  } catch (e) {
    console.error("bulkResnapshot error:", e);
    return res.status(500).json({ error: "Failed to bulk resnapshot" });
  }
};

/**
 * GET /api/admin/donas/finance/months/export.csv
 */
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
    res.setHeader("Content-Disposition", `attachment; filename=\"donas_months.csv\"`);
    return res.send(csv);
  } catch (e) {
    console.error("exportCsv error:", e);
    return res.status(500).json({ error: "Failed to export CSV" });
  }
};

/**
 * GET /api/admin/donas/finance/audit?limit=50
 */
exports.audit = async (req, res) => {
  try {
    const limit = Math.min(Math.max(toNum(req.query.limit) || 50, 1), 200);

    const { rows } = await db.query(
      `
      SELECT
        to_char(month,'YYYY-MM') as month,
        updated_at,
        notes
      FROM donas_finance_months
      WHERE slug=$1
      ORDER BY updated_at DESC NULLS LAST, month DESC
      LIMIT $2
      `,
      [SLUG, limit]
    );

    const out = (rows || []).map((r) => ({
      month: r.month,
      updated_at: r.updated_at,
      locked: hasLockedTag(r.notes),
    }));

    return res.json(out);
  } catch (e) {
    console.error("audit error:", e);
    return res.status(500).json({ error: "Failed to load audit" });
  }
};
