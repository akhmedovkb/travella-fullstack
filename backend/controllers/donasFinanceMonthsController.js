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

const SLUG = "donas-dosas";

function monthToDate(ym) {
  // YYYY-MM -> YYYY-MM-01
  return `${ym}-01`;
}

// ✅ Гарантируем строку месяца без ON CONFLICT (у тебя нет UNIQUE)
async function ensureMonthRow(monthYm) {
  const d = monthToDate(monthYm);

  // 1) проверяем наличие
  const { rows } = await db.query(
    `SELECT id FROM donas_finance_months WHERE slug=$1 AND month=$2::date LIMIT 1`,
    [SLUG, d]
  );

  if (rows?.[0]?.id) return;

  // 2) если нет — вставляем
  await db.query(
    `
    INSERT INTO donas_finance_months
      (slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes)
    VALUES
      ($1, $2::date, 0, 0, 0, 0, 0, 0, '')
    `,
    [SLUG, d]
  );
}

/** ===================== SETTINGS ===================== */
/**
 * Фронт ждёт:
 * GET /api/admin/donas/finance/settings
 * PUT /api/admin/donas/finance/settings
 */
exports.getSettings = async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM donas_finance_settings
       ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 1`
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

    // найдём последнюю запись
    const { rows: curRows } = await db.query(
      `SELECT id FROM donas_finance_settings
       ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 1`
    );

    let id = curRows?.[0]?.id;

    // если нет — создаём
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
      return res.json({ ok: true, settings: rows?.[0] || null });
    }

    const sets = [];
    const vals = [];
    let p = 2;

    for (const k of keys) {
      sets.push(`${k}=$${p++}`);
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
      WHERE slug=$1
      ORDER BY month ASC
      `,
      [SLUG]
    );

    const out = (rows || []).map((r) => ({
      ...r,
      // ✅ для фронта (который ждёт Loan)
      loan: toNum(r.loan_paid),
      locked: hasLockedTag(r.notes),
    }));

    return res.json({ ok: true, months: out });
  } catch (e) {
    console.error("listMonths error:", e);
    return res.status(500).json({ error: "Failed to load months" });
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

    await ensureMonthRow(month);

    const { rows } = await db.query(
      `
      SELECT
        id, slug, to_char(month,'YYYY-MM') as month,
        revenue, cogs, opex, capex, loan_paid, cash_end,
        notes, updated_at
      FROM donas_finance_months
      WHERE slug=$2 AND month=$1::date
      LIMIT 1
      `,
      [monthToDate(month), SLUG]
    );

    const row = rows?.[0] || null;
    if (!row) return res.status(404).json({ error: "Month not found" });

    const locked = hasLockedTag(row.notes);

    return res.json({
      ok: true,
      locked,
      month: {
        ...row,
        loan: toNum(row.loan_paid),
      },
    });
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

    await ensureMonthRow(month);

    const { rows: curRows } = await db.query(
      `SELECT notes FROM donas_finance_months WHERE slug=$2 AND month=$1::date LIMIT 1`,
      [monthToDate(month), SLUG]
    );

    const curNotes = String(curRows?.[0]?.notes || "");
    if (hasLockedTag(curNotes)) {
      return res.status(409).json({
        error: "Month is locked (#locked). Remove tag to edit.",
      });
    }

    const b = req.body || {};

    const revenue = toNum(b.revenue);
    const cogs = toNum(b.cogs);
    const opex = toNum(b.opex);
    const capex = toNum(b.capex);

    // поддержка: фронт может прислать loan или loan_paid
    const loanPaid = toNum(b.loan_paid ?? b.loan);
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
      [monthToDate(month), SLUG, revenue, cogs, opex, capex, loanPaid, cashEnd, notes]
    );

    const saved = rows?.[0] || null;
    const locked = hasLockedTag(saved?.notes);

    return res.json({
      ok: true,
      locked,
      month: {
        ...saved,
        loan: toNum(saved?.loan_paid),
      },
    });
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

    await ensureMonthRow(month);

    const { rows } = await db.query(
      `SELECT notes FROM donas_finance_months WHERE slug=$2 AND month=$1::date LIMIT 1`,
      [monthToDate(month), SLUG]
    );

    const notes = String(rows?.[0]?.notes || "");
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

    await ensureMonthRow(month);

    const { rows } = await db.query(
      `SELECT notes FROM donas_finance_months WHERE slug=$2 AND month=$1::date LIMIT 1`,
      [monthToDate(month), SLUG]
    );

    const notes = String(rows?.[0]?.notes || "");
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
