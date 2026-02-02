// backend/controllers/donasFinanceMonthsController.js

const db = require("../db");

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function isYm(s) {
  return /^\d{4}-\d{2}$/.test(String(s || ""));
}

function ymToDate(ym) {
  // "2026-02" -> "2026-02-01"
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
  return String(notes || "")
    .split("\n")
    .filter((line) => line.trim().toLowerCase() !== "#locked")
    .join("\n")
    .trim();
}

// фиксируем slug для months
const SLUG = "donas-dosas";

// гарантируем, что строка месяца существует
async function ensureMonthRow(ym) {
  const d = ymToDate(ym);

  // ON CONFLICT DO NOTHING — универсально: сработает при любом unique-ограничении (month) или (slug, month)
  await db.query(
    `
    INSERT INTO donas_finance_months
      (slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes)
    VALUES
      ($1, $2::date, 0, 0, 0, 0, 0, 0, '')
    ON CONFLICT DO NOTHING
    `,
    [SLUG, d]
  );
}

// GET /api/admin/donas/finance/months/:month   (month = YYYY-MM)
exports.getMonth = async (req, res) => {
  try {
    const { month } = req.params;

    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    await ensureMonthRow(month);

    const d = ymToDate(month);

    // если вдруг уникальность только по month (без slug) — всё равно достанем строку
    const { rows } = await db.query(
      `
      SELECT
        id,
        slug,
        to_char(month,'YYYY-MM') AS month,
        revenue, cogs, opex, capex, loan_paid, cash_end,
        notes,
        updated_at
      FROM donas_finance_months
      WHERE month = $1::date
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT 1
      `,
      [d]
    );

    const row = rows?.[0];
    if (!row) return res.status(404).json({ error: "Month not found" });

    return res.json({
      ok: true,
      locked: hasLockedTag(row.notes),
      month: row,
    });
  } catch (e) {
    console.error("getMonth error:", e);
    return res.status(500).json({ error: "Failed to load month" });
  }
};

// PUT /api/admin/donas/finance/months/:month
// сохраняем ручные поля: revenue/cogs/opex/capex/loan_paid/cash_end/notes
exports.updateMonth = async (req, res) => {
  try {
    const { month } = req.params;

    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    await ensureMonthRow(month);

    const d = ymToDate(month);

    const { rows: curRows } = await db.query(
      `SELECT notes FROM donas_finance_months WHERE month=$1::date ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`,
      [d]
    );

    const curNotes = String(curRows?.[0]?.notes || "");
    if (hasLockedTag(curNotes)) {
      return res.status(409).json({ error: "Month is locked (#locked). Unlock first." });
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
        id,
        slug,
        to_char(month,'YYYY-MM') AS month,
        revenue, cogs, opex, capex, loan_paid, cash_end,
        notes,
        updated_at
      `,
      [d, revenue, cogs, opex, capex, loanPaid, cashEnd, notes]
    );

    const saved = rows?.[0];
    if (!saved) return res.status(404).json({ error: "Month not found" });

    return res.json({
      ok: true,
      locked: hasLockedTag(saved.notes),
      month: saved,
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

    const d = ymToDate(month);

    const { rows } = await db.query(
      `SELECT notes FROM donas_finance_months WHERE month=$1::date ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`,
      [d]
    );

    const notes = String(rows?.[0]?.notes || "");
    const newNotes = addLockedTag(notes);

    await db.query(
      `UPDATE donas_finance_months SET notes=$2, updated_at=NOW() WHERE month=$1::date`,
      [d, newNotes]
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

    const d = ymToDate(month);

    const { rows } = await db.query(
      `SELECT notes FROM donas_finance_months WHERE month=$1::date ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`,
      [d]
    );

    const notes = String(rows?.[0]?.notes || "");
    const newNotes = removeLockedTag(notes);

    await db.query(
      `UPDATE donas_finance_months SET notes=$2, updated_at=NOW() WHERE month=$1::date`,
      [d, newNotes]
    );

    return res.json({ ok: true, locked: false });
  } catch (e) {
    console.error("unlockMonth error:", e);
    return res.status(500).json({ error: "Failed to unlock month" });
  }
};
