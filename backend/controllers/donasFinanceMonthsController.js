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

function ymToFirstDay(ym) {
  if (!isYm(ym)) return null;
  return `${ym}-01`;
}

function isLockedNotes(notes) {
  return String(notes || "").toLowerCase().includes("#locked");
}

function addLockedTag(notes) {
  const s = String(notes || "").trim();
  if (!s) return "#locked";
  if (isLockedNotes(s)) return s;
  return `${s}\n#locked`;
}

function removeLockedTag(notes) {
  const s = String(notes || "");
  // убираем строку "#locked" или в конце/середине
  const lines = s
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => x && x.toLowerCase() !== "#locked");
  return lines.join("\n").trim();
}

async function loadSettings() {
  // берём последнюю запись, как у тебя в других местах
  const { rows } = await db.query(
    `SELECT opening_cash, fixed_opex_month, variable_opex_month, loan_payment_month, currency
     FROM donas_finance_settings
     ORDER BY updated_at DESC NULLS LAST, id DESC
     LIMIT 1`
  );

  const s = rows?.[0] || {};
  return {
    openingCash: toNum(s.opening_cash),
    fixedOpex: toNum(s.fixed_opex_month),
    variableOpex: toNum(s.variable_opex_month),
    loanPayment: toNum(s.loan_payment_month),
    currency: String(s.currency || "UZS"),
  };
}

// гарантируем строку (без ON CONFLICT — чтобы не зависеть от уникальных индексов)
async function ensureMonthRow(monthDate) {
  await db.query(
    `
    INSERT INTO donas_finance_months (slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes)
    SELECT $1, $2::date, 0, 0, 0, 0, 0, 0, ''
    WHERE NOT EXISTS (
      SELECT 1 FROM donas_finance_months WHERE slug=$1 AND month=$2::date
    )
    `,
    [SLUG, monthDate]
  );
}

async function getMonthRow(monthDate) {
  const { rows } = await db.query(
    `SELECT id, slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes, updated_at
     FROM donas_finance_months
     WHERE slug=$1 AND month=$2::date
     LIMIT 1`,
    [SLUG, monthDate]
  );
  return rows?.[0] || null;
}

async function calculateMonth(ym) {
  const monthDate = ymToFirstDay(ym);
  const settings = await loadSettings();

  await ensureMonthRow(monthDate);
  const cur = await getMonthRow(monthDate);

  // Если locked — возвращаем то, что сохранено в таблице (снэпшот)
  if (cur && isLockedNotes(cur.notes)) {
    return {
      locked: true,
      month: ym,
      currency: settings.currency,
      openingCash: settings.openingCash,
      data: {
        month: ym,
        revenue: toNum(cur.revenue),
        cogs: toNum(cur.cogs),
        opex: toNum(cur.opex),
        capex: toNum(cur.capex),
        loan_paid: toNum(cur.loan_paid),
        cash_end: toNum(cur.cash_end),
        notes: String(cur.notes || ""),
      },
    };
  }

  // shifts: revenue + payroll
  const shiftsQ = await db.query(
    `
    SELECT
      COALESCE(SUM(revenue),0) AS revenue,
      COALESCE(SUM(total_pay),0) AS payroll
    FROM donas_shifts
    WHERE slug=$1 AND to_char(date,'YYYY-MM')=$2
    `,
    [SLUG, ym]
  );
  const revenue = toNum(shiftsQ.rows?.[0]?.revenue);
  const payroll = toNum(shiftsQ.rows?.[0]?.payroll);

  // cogs: purchases where type='purchase'
  const cogsQ = await db.query(
    `
    SELECT COALESCE(SUM(total),0) AS cogs
    FROM donas_purchases
    WHERE slug=$1 AND type='purchase' AND to_char(date,'YYYY-MM')=$2
    `,
    [SLUG, ym]
  );
  const cogs = toNum(cogsQ.rows?.[0]?.cogs);

  // extra expenses: opex/capex
  const expQ = await db.query(
    `
    SELECT
      COALESCE(SUM(CASE WHEN kind='opex' THEN amount ELSE 0 END),0) AS opex_extra,
      COALESCE(SUM(CASE WHEN kind='capex' THEN amount ELSE 0 END),0) AS capex
    FROM donas_expenses
    WHERE slug=$1 AND to_char(date,'YYYY-MM')=$2
    `,
    [SLUG, ym]
  );
  const opexExtra = toNum(expQ.rows?.[0]?.opex_extra);
  const capex = toNum(expQ.rows?.[0]?.capex);

  // opex total: fixed + variable + payroll + opexExtra
  const opex = settings.fixedOpex + settings.variableOpex + payroll + opexExtra;

  // loan paid: берём из settings (можно потом руками менять через updateMonth)
  const loanPaid = settings.loanPayment;

  const netOperating = revenue - cogs - opex;
  const cashFlow = netOperating - loanPaid - capex;
  const cashEnd = settings.openingCash + cashFlow;

  // пишем рассчитанные цифры в таблицу (это “текущая версия”, пока не залочено)
  await db.query(
    `
    UPDATE donas_finance_months
    SET revenue=$3, cogs=$4, opex=$5, capex=$6, loan_paid=$7, cash_end=$8, updated_at=NOW()
    WHERE slug=$1 AND month=$2::date
    `,
    [SLUG, monthDate, revenue, cogs, opex, capex, loanPaid, cashEnd]
  );

  const after = await getMonthRow(monthDate);

  return {
    locked: false,
    month: ym,
    currency: settings.currency,
    openingCash: settings.openingCash,
    data: {
      month: ym,
      revenue: toNum(after?.revenue),
      cogs: toNum(after?.cogs),
      opex: toNum(after?.opex),
      capex: toNum(after?.capex),
      loan_paid: toNum(after?.loan_paid),
      cash_end: toNum(after?.cash_end),
      notes: String(after?.notes || ""),
      // справочно
      payroll,
      opex_extra: opexExtra,
      fixed_opex_month: settings.fixedOpex,
      variable_opex_month: settings.variableOpex,
      netOperating,
      cashFlow,
    },
  };
}

// GET /api/admin/donas/finance/months/:month (month=YYYY-MM)
exports.getMonth = async (req, res) => {
  try {
    const { month } = req.params;

    if (!isYm(month)) {
      return res
        .status(400)
        .json({ error: "Bad month format (expected YYYY-MM)" });
    }

    const out = await calculateMonth(month);
    return res.json(out);
  } catch (e) {
    console.error("getMonth error:", e);
    return res.status(500).json({ error: "Failed to load month" });
  }
};

// PUT /api/admin/donas/finance/months/:month
// обновляем ТОЛЬКО ручные поля, которые реально есть: notes и (при желании) loan_paid
exports.updateMonth = async (req, res) => {
  try {
    const { month } = req.params;

    if (!isYm(month)) {
      return res
        .status(400)
        .json({ error: "Bad month format (expected YYYY-MM)" });
    }

    const monthDate = ymToFirstDay(month);
    await ensureMonthRow(monthDate);

    const cur = await getMonthRow(monthDate);
    if (cur && isLockedNotes(cur.notes)) {
      return res.status(409).json({ error: "Month is locked. Unlock first." });
    }

    const b = req.body || {};
    const notes = String(b.notes ?? cur?.notes ?? "");
    const loanPaid = b.loan_paid == null ? toNum(cur?.loan_paid) : toNum(b.loan_paid);

    await db.query(
      `
      UPDATE donas_finance_months
      SET notes=$3, loan_paid=$4, updated_at=NOW()
      WHERE slug=$1 AND month=$2::date
      `,
      [SLUG, monthDate, notes, loanPaid]
    );

    const out = await calculateMonth(month);
    return res.json({ ok: true, ...out });
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
      return res
        .status(400)
        .json({ error: "Bad month format (expected YYYY-MM)" });
    }

    const monthDate = ymToFirstDay(month);
    await ensureMonthRow(monthDate);

    // сначала пересчитываем и сохраняем актуальные цифры
    await calculateMonth(month);

    const cur = await getMonthRow(monthDate);
    const notes = addLockedTag(cur?.notes);

    await db.query(
      `
      UPDATE donas_finance_months
      SET notes=$3, updated_at=NOW()
      WHERE slug=$1 AND month=$2::date
      `,
      [SLUG, monthDate, notes]
    );

    const locked = await getMonthRow(monthDate);
    return res.json({
      ok: true,
      locked: true,
      month,
      data: locked,
    });
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
      return res
        .status(400)
        .json({ error: "Bad month format (expected YYYY-MM)" });
    }

    const monthDate = ymToFirstDay(month);
    await ensureMonthRow(monthDate);

    const cur = await getMonthRow(monthDate);
    const notes = removeLockedTag(cur?.notes);

    await db.query(
      `
      UPDATE donas_finance_months
      SET notes=$3, updated_at=NOW()
      WHERE slug=$1 AND month=$2::date
      `,
      [SLUG, monthDate, notes]
    );

    const out = await calculateMonth(month);
    return res.json({ ok: true, ...out });
  } catch (e) {
    console.error("unlockMonth error:", e);
    return res.status(500).json({ error: "Failed to unlock month" });
  }
};
