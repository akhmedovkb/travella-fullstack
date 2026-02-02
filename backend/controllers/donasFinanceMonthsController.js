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

// slug в твоей системе используется в части таблиц, фиксируем для months
const SLUG = "donas-dosas";

// Гарантируем, что строка месяца существует (под ТВОЮ схему таблицы)
async function ensureMonthRow(month) {
  // ВАЖНО: у тебя, судя по всему, уникальность может быть только по month.
  // Поэтому делаем ON CONFLICT (month), как в твоей старой логике.
  await db.query(
    `
    INSERT INTO donas_finance_months
      (slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes)
    VALUES
      ($2, $1::date, 0, 0, 0, 0, 0, 0, '')
    ON CONFLICT (month) DO NOTHING
    `,
    [month, SLUG]
  );
}

// GET /api/admin/donas/finance/months/:month
exports.getMonth = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res
        .status(400)
        .json({ error: "Bad month format (expected YYYY-MM)" });
    }

    await ensureMonthRow(month);

    const { rows } = await db.query(
      `
      SELECT
        id, slug, to_char(month,'YYYY-MM') as month,
        revenue, cogs, opex, capex, loan_paid, cash_end,
        notes, updated_at
      FROM donas_finance_months
      WHERE month = $1::date
      LIMIT 1
      `,
      [`${month}-01`]
    );

    const row = rows?.[0] || null;
    if (!row) return res.status(404).json({ error: "Month not found" });

    // "locked" эмулируем через #locked в notes (раз у тебя нет колонки locked)
    const locked = hasLockedTag(row.notes);

    return res.json({ ok: true, locked, month: row });
  } catch (e) {
    console.error("getMonth error:", e);
    return res.status(500).json({ error: "Failed to load month" });
  }
};

// PUT /api/admin/donas/finance/months/:month
// сохраняем РУЧНЫЕ поля: revenue/cogs/opex/capex/loan_paid/cash_end/notes
exports.updateMonth = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res
        .status(400)
        .json({ error: "Bad month format (expected YYYY-MM)" });
    }

    await ensureMonthRow(month);

    const { rows: curRows } = await db.query(
      `SELECT notes FROM donas_finance_months WHERE month=$1::date LIMIT 1`,
      [`${month}-01`]
    );

    const curNotes = String(curRows?.[0]?.notes || "");
    if (hasLockedTag(curNotes)) {
      return res.status(409).json({ error: "Month is locked (#locked). Remove tag to edit." });
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
        revenue=$2,
        cogs=$3,
        opex=$4,
        capex=$5,
        loan_paid=$6,
        cash_end=$7,
        notes=$8,
        updated_at=NOW()
      WHERE month=$1::date
      RETURNING
        id, slug, to_char(month,'YYYY-MM') as month,
        revenue, cogs, opex, capex, loan_paid, cash_end,
        notes, updated_at
      `,
      [`${month}-01`, revenue, cogs, opex, capex, loanPaid, cashEnd, notes]
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
// делаем lock через добавление #locked в notes
exports.lockMonth = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res
        .status(400)
        .json({ error: "Bad month format (expected YYYY-MM)" });
    }

    await ensureMonthRow(month);

    const { rows } = await db.query(
      `SELECT notes FROM donas_finance_months WHERE month=$1::date LIMIT 1`,
      [`${month}-01`]
    );

    const notes = String(rows?.[0]?.notes || "");
    const newNotes = hasLockedTag(notes) ? notes : (notes ? `${notes}\n#locked` : "#locked");

    await db.query(
      `UPDATE donas_finance_months SET notes=$2, updated_at=NOW() WHERE month=$1::date`,
      [`${month}-01`, newNotes]
    );

    return res.json({ ok: true, locked: true });
  } catch (e) {
    console.error("lockMonth error:", e);
    return res.status(500).json({ error: "Failed to lock month" });
  }
};

// POST /api/admin/donas/finance/months/:month/unlock
// убираем #locked из notes
exports.unlockMonth = async (req, res) => {
  try {
    const { month } = req.params;
    if (!isYm(month)) {
      return res
        .status(400)
        .json({ error: "Bad month format (expected YYYY-MM)" });
    }

    await ensureMonthRow(month);

    const { rows } = await db.query(
      `SELECT notes FROM donas_finance_months WHERE month=$1::date LIMIT 1`,
      [`${month}-01`]
    );

    const notes = String(rows?.[0]?.notes || "");
    const newNotes = notes
      .split("\n")
      .filter((line) => line.trim().toLowerCase() !== "#locked")
      .join("\n")
      .trim();

    await db.query(
      `UPDATE donas_finance_months SET notes=$2, updated_at=NOW() WHERE month=$1::date`,
      [`${month}-01`, newNotes]
    );

    return res.json({ ok: true, locked: false });
  } catch (e) {
    console.error("unlockMonth error:", e);
    return res.status(500).json({ error: "Failed to unlock month" });
  }
};
