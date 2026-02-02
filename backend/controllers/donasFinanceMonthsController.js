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

// гарантируем строку месяца (под текущую схему таблицы)
async function ensureMonthRow(monthYm) {
  const d = monthToDate(monthYm);

  // ВАЖНО: table donas_finance_months.month is DATE
  // поэтому вставляем $1::date где $1 = 'YYYY-MM-01'
  await db.query(
    `
    INSERT INTO donas_finance_months
      (slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes)
    VALUES
      ($2, $1::date, 0, 0, 0, 0, 0, 0, '')
    ON CONFLICT (month) DO NOTHING
    `,
    [d, SLUG]
  );
}

/** ===================== SETTINGS ===================== */
/**
 * Фронт ждёт:
 * GET  /api/admin/donas/finance/settings
 * PUT  /api/admin/donas/finance/settings
 *
 * Мы делаем максимально совместимо: отдаём последнюю строку "как есть".
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

    // Универсально: если строк нет — создаём пустую, потом обновляем.
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

    // Мы не знаем точную схему полей settings в твоей базе (она могла меняться),
    // поэтому обновляем только те поля, которые реально пришли.
    // Для этого собираем динамический UPDATE.
    const allowed = Object.keys(body || {});
    if (!allowed.length) {
      const { rows } = await db.query(`SELECT * FROM donas_finance_settings WHERE id=$1`, [id]);
      return res.json({ ok: true, settings: rows?.[0] || null });
    }

    const sets = [];
    const vals = [];
    let k = 2;

    for (const key of allowed) {
      // запрещаем менять id
      if (key === "id") continue;
      sets.push(`${key}=$${k++}`);
      vals.push(body[key]);
    }

    // если только id пришёл
    if (!sets.length) {
      const { rows } = await db.query(`SELECT * FROM donas_finance_settings WHERE id=$1`, [id]);
      return res.json({ ok: true, settings: rows?.[0] || null });
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
      WHERE month = $1::date
      LIMIT 1
      `,
      [monthToDate(month)]
    );

    const row = rows?.[0] || null;
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

    await ensureMonthRow(month);

    const { rows: curRows } = await db.query(
      `SELECT notes FROM donas_finance_months WHERE month=$1::date LIMIT 1`,
      [monthToDate(month)]
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
      [monthToDate(month), revenue, cogs, opex, capex, loanPaid, cashEnd, notes]
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

    await ensureMonthRow(month);

    const { rows } = await db.query(
      `SELECT notes FROM donas_finance_months WHERE month=$1::date LIMIT 1`,
      [monthToDate(month)]
    );

    const notes = String(rows?.[0]?.notes || "");
    const newNotes = hasLockedTag(notes)
      ? notes
      : (notes ? `${notes}\n#locked` : "#locked");

    await db.query(
      `UPDATE donas_finance_months SET notes=$2, updated_at=NOW() WHERE month=$1::date`,
      [monthToDate(month), newNotes]
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
      `SELECT notes FROM donas_finance_months WHERE month=$1::date LIMIT 1`,
      [monthToDate(month)]
    );

    const notes = String(rows?.[0]?.notes || "");
    const newNotes = notes
      .split("\n")
      .filter((line) => line.trim().toLowerCase() !== "#locked")
      .join("\n")
      .trim();

    await db.query(
      `UPDATE donas_finance_months SET notes=$2, updated_at=NOW() WHERE month=$1::date`,
      [monthToDate(month), newNotes]
    );

    return res.json({ ok: true, locked: false });
  } catch (e) {
    console.error("unlockMonth error:", e);
    return res.status(500).json({ error: "Failed to unlock month" });
  }
};
