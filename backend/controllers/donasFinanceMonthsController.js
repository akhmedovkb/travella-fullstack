// backend/controllers/donasFinanceMonthsController.js

const db = require("../db");

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function isYm(s) {
  return /^\d{4}-\d{2}$/.test(String(s || ""));
}

function hasLockedTag(notes) {
  return String(notes || "").toLowerCase().includes("#locked");
}

// slug фиксируем под donas
const SLUG = "donas-dosas";

function monthToDate(ym) {
  // ym: YYYY-MM -> YYYY-MM-01
  return `${ym}-01`;
}

/**
 * Гарантируем строку месяца (под текущую схему таблицы).
 * ВАЖНО: в БД нет UNIQUE на (month) => нельзя ON CONFLICT(month).
 * Делаем безопасно через WHERE NOT EXISTS.
 */
async function ensureMonthRow(monthYm) {
  const d = monthToDate(monthYm);

  await db.query(
    `
    INSERT INTO donas_finance_months
      (slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes)
    SELECT
      $2, $1::date, 0, 0, 0, 0, 0, 0, ''
    WHERE NOT EXISTS (
      SELECT 1
      FROM donas_finance_months
      WHERE slug = $2 AND month = $1::date
    )
    `,
    [d, SLUG]
  );

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
    WHERE slug=$2 AND month=$1::date
    LIMIT 1
    `,
    [d, SLUG]
  );

  return rows?.[0] || null;
}

/** ===================== SETTINGS ===================== */
/**
 * Фронт ждёт:
 * GET  /api/admin/donas/finance/settings
 * PUT  /api/admin/donas/finance/settings
 */
exports.getSettings = async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM donas_finance_settings ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`
    );
    return res.json({ ok: true, settings: rows?.[0] || null });
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
      const { rows } = await db.query(`SELECT * FROM donas_finance_settings WHERE id=$1`, [id]);
      return res.json({ ok: true, settings: rows?.[0] || null });
    }

    const sets = [];
    const vals = [];
    let i = 2;
    for (const k of keys) {
      sets.push(`${k}=$${i++}`);
      vals.push(body[k]);
    }

    const q = `
      UPDATE donas_finance_settings
      SET ${sets.join(", ")}, updated_at=NOW()
      WHERE id=$1
      RETURNING *
    `;

    const { rows } = await db.query(q, [id, ...vals]);
    return res.json({ ok: true, settings: rows?.[0] || null });
  } catch (e) {
    console.error("updateSettings error:", e);
    return res.status(500).json({ error: "Failed to update settings" });
  }
};

/** ===================== MONTHS LIST ===================== */
/**
 * Фронт ждёт:
 * GET /api/admin/donas/finance/months
 */
exports.listMonths = async (_req, res) => {
  try {
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
      WHERE slug = $1
      ORDER BY month ASC
      `,
      [SLUG]
    );

    const out = (rows || []).map((r) => ({
      ...r,
      locked: hasLockedTag(r.notes),
    }));

    return res.json({ ok: true, months: out });
  } catch (e) {
    console.error("listMonths error:", e);
    return res.status(500).json({ error: "Failed to load months" });
  }
};

/** ===================== ADD MONTH ===================== */
/**
 * На кнопке Add обычно дергают POST /months с body { month: "YYYY-MM" }
 */
exports.addMonth = async (req, res) => {
  try {
    const ym = String(req.body?.month || "").trim();
    if (!isYm(ym)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    const row = await ensureMonthRow(ym);
    return res.json({ ok: true, month: row, locked: hasLockedTag(row?.notes) });
  } catch (e) {
    console.error("addMonth error:", e);
    return res.status(500).json({ error: "Failed to add month" });
  }
};

/** ===================== SYNC MONTHS ===================== */
/**
 * Фронт ждёт:
 * POST /api/admin/donas/finance/months/sync
 *
 * Делает "добивку" месяцев из данных:
 * - donas_shifts.date
 * - donas_purchases.date
 * - donas_expenses.date
 */
exports.syncMonths = async (_req, res) => {
  try {
    const { rows } = await db.query(
      `
      SELECT DISTINCT ym FROM (
        SELECT to_char(date,'YYYY-MM') AS ym FROM donas_shifts
        UNION
        SELECT to_char(date,'YYYY-MM') AS ym FROM donas_purchases
        UNION
        SELECT to_char(date,'YYYY-MM') AS ym FROM donas_expenses
      ) t
      WHERE ym IS NOT NULL AND ym <> ''
      ORDER BY ym ASC
      `
    );

    const yms = (rows || []).map((r) => String(r.ym)).filter(isYm);

    let created = 0;
    for (const ym of yms) {
      const before = await db.query(
        `SELECT 1 FROM donas_finance_months WHERE slug=$2 AND month=$1::date LIMIT 1`,
        [monthToDate(ym), SLUG]
      );
      const exists = (before.rows || []).length > 0;
      await ensureMonthRow(ym);
      if (!exists) created += 1;
    }

    // отдадим сразу свежий список
    const { rows: list } = await db.query(
      `
      SELECT
        id,
        slug,
        to_char(month,'YYYY-MM') as month,
        revenue, cogs, opex, capex, loan_paid, cash_end,
        notes,
        updated_at
      FROM donas_finance_months
      WHERE slug = $1
      ORDER BY month ASC
      `,
      [SLUG]
    );

    const out = (list || []).map((r) => ({
      ...r,
      locked: hasLockedTag(r.notes),
    }));

    return res.json({ ok: true, created, months: out });
  } catch (e) {
    console.error("syncMonths error:", e);
    return res.status(500).json({ error: "Failed to sync months" });
  }
};

/** ===================== SINGLE MONTH ===================== */
// GET /api/admin/donas/finance/months/:month
exports.getMonth = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    const row = await ensureMonthRow(month);
    if (!row) return res.status(404).json({ error: "Month not found" });

    const locked = hasLockedTag(row.notes);
    return res.json({ ok: true, locked, month: row });
  } catch (e) {
    console.error("getMonth error:", e);
    return res.status(500).json({ error: "Failed to load month" });
  }
};

// PUT /api/admin/donas/finance/months/:month
exports.updateMonth = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    const cur = await ensureMonthRow(month);
    if (hasLockedTag(cur?.notes)) {
      return res.status(409).json({
        error: "Month is locked (#locked). Remove tag to edit.",
      });
    }

    const b = req.body || {};

    const revenue = toNum(b.revenue);
    const cogs = toNum(b.cogs);
    const opex = toNum(b.opex);
    const capex = toNum(b.capex);
    const loanPaid = toNum(b.loan_paid);
    const cashEnd = toNum(b.cash_end);
    const notes = String(b.notes ?? "");

    const { rows } = await db.query(
      `
      UPDATE donas_finance_months
      SET
        revenue=$3,
        cogs=$4,
        opex=$5,
        capex=$6,
        loan_paid=$7,
        cash_end=$8,
        notes=$9,
        updated_at=NOW()
      WHERE slug=$2 AND month=$1::date
      RETURNING
        id, slug, to_char(month,'YYYY-MM') as month,
        revenue, cogs, opex, capex, loan_paid, cash_end,
        notes, updated_at
      `,
      [
        monthToDate(month),
        SLUG,
        revenue,
        cogs,
        opex,
        capex,
        loanPaid,
        cashEnd,
        notes,
      ]
    );

    const saved = rows?.[0] || null;
    const locked = hasLockedTag(saved?.notes);

    return res.json({ ok: true, locked, month: saved });
  } catch (e) {
    console.error("updateMonth error:", e);
    return res.status(500).json({ error: "Failed to update month" });
  }
};

// POST /api/admin/donas/finance/months/:month/lock
exports.lockMonth = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    const cur = await ensureMonthRow(month);

    const notes = String(cur?.notes || "");
    const newNotes = hasLockedTag(notes)
      ? notes
      : (notes ? `${notes}\n#locked` : "#locked");

    await db.query(
      `UPDATE donas_finance_months SET notes=$3, updated_at=NOW() WHERE slug=$2 AND month=$1::date`,
      [monthToDate(month), SLUG, newNotes]
    );

    return res.json({ ok: true, locked: true });
  } catch (e) {
    console.error("lockMonth error:", e);
    return res.status(500).json({ error: "Failed to lock month" });
  }
};

// POST /api/admin/donas/finance/months/:month/unlock
exports.unlockMonth = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    const cur = await ensureMonthRow(month);

    const notes = String(cur?.notes || "");
    const newNotes = notes
      .split("\n")
      .filter((line) => line.trim().toLowerCase() !== "#locked")
      .join("\n")
      .trim();

    await db.query(
      `UPDATE donas_finance_months SET notes=$3, updated_at=NOW() WHERE slug=$2 AND month=$1::date`,
      [monthToDate(month), SLUG, newNotes]
    );

    return res.json({ ok: true, locked: false });
  } catch (e) {
    console.error("unlockMonth error:", e);
    return res.status(500).json({ error: "Failed to unlock month" });
  }
};
