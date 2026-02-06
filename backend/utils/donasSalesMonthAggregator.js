// backend/utils/donasSalesMonthAggregator.js
const db = require("../db");

const SLUG = "donas-dosas";

function isYm(s) {
  return /^\d{4}-\d{2}$/.test(String(s || ""));
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function hasLockedTag(notes) {
  return String(notes || "").toLowerCase().includes("#locked");
}

function ymToMonthDate(ym) {
  return `${ym}-01`;
}

function nextYm(ym) {
  const [y, m] = String(ym).split("-").map((v) => Number(v));
  const d = new Date(Date.UTC(y, (m - 1) + 1, 1)); // next month
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

/**
 * Берём существующие months по диапазону (от startYm до endYm включительно)
 */
async function listMonthsRange(startYm, endYm) {
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
  return rows || [];
}

/**
 * Находим “последнюю” строку месяца (если есть дубликаты id)
 */
function pickLastByMonth(rows) {
  const map = new Map();
  for (const r of rows) {
    const ym = String(r.month).slice(0, 7);
    const prev = map.get(ym);
    if (!prev || Number(r.id) > Number(prev.id)) map.set(ym, r);
  }
  return map;
}

async function ensureMonthRow(ym) {
  const monthDate = ymToMonthDate(ym);

  // пробуем найти последнюю запись месяца
  const q = await db.query(
    `
    SELECT *
    FROM donas_finance_months
    WHERE slug=$1 AND month=($2)::date
    ORDER BY id DESC
    LIMIT 1
    `,
    [SLUG, monthDate]
  );

  if (q.rows?.[0]) return q.rows[0];

  // создаём, если нет
  const ins = await db.query(
    `
    INSERT INTO donas_finance_months
      (slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes)
    VALUES
      ($1, ($2)::date, 0, 0, 0, 0, 0, 0, '')
    RETURNING *
    `,
    [SLUG, monthDate]
  );

  return ins.rows[0];
}

async function isLockedMonth(ym) {
  const r = await ensureMonthRow(ym);
  return hasLockedTag(r?.notes || "");
}

/**
 * Агрегируем Sales → revenue/cogs
 */
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

/**
 * Агрегируем Purchases → opex/capex
 * (считаем из donas_purchases по type='OPEX'/'CAPEX')
 */
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

/**
 * Обновляем month: revenue/cogs/opex/capex, не трогаем loan_paid/notes вручную.
 * cash_end пересчитывается отдельно цепочкой.
 */
async function updateMonthAgg(ym) {
  // если locked — не трогаем и выходим
  if (await isLockedMonth(ym)) {
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

/**
 * cash_end chain:
 * cash_end(ym) = cash_end(prevYm) + (revenue - cogs - opex - capex - loan_paid)
 * Стопаемся если встретили #locked (снепшот)
 */
async function recomputeCashChainFrom(startYm, endYm) {
  // убедимся что все месяцы существуют
  // (если где-то дырка — создадим)
  let cur = startYm;
  while (true) {
    await ensureMonthRow(cur);
    if (cur === endYm) break;
    cur = nextYm(cur);
  }

  // берём диапазон
  const rows = await listMonthsRange(startYm, endYm);
  const byMonth = pickLastByMonth(rows);

  // чтобы посчитать startYm, нужен prevYm cash_end
  // prevYm = startYm - 1 месяц
  const [sy, sm] = startYm.split("-").map(Number);
  const prevDate = new Date(Date.UTC(sy, sm - 2, 1));
  const prevYm =
    `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, "0")}`;

  // prev cash_end: берём из months если есть, иначе 0
  let prevCash = 0;
  try {
    const prevRowQ = await db.query(
      `
      SELECT cash_end
      FROM donas_finance_months
      WHERE slug=$1 AND month=($2)::date
      ORDER BY id DESC
      LIMIT 1
      `,
      [SLUG, ymToMonthDate(prevYm)]
    );
    if (prevRowQ.rows?.[0]) prevCash = toNum(prevRowQ.rows[0].cash_end);
  } catch {
    // ignore
  }

  const results = [];
  cur = startYm;

  while (true) {
    const row = byMonth.get(cur) || (await ensureMonthRow(cur));
    const locked = hasLockedTag(row?.notes || "");

    // если locked — стоп: это снепшот, дальше не пересчитываем
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
 * PUBLIC: full auto-touch для списка месяцев.
 * Важно: чтобы cash цепочка была корректной, пересчитываем с MIN(ym) до MAX(ym)
 */
async function touchMonthsFromYms(yms = []) {
  const list = (yms || []).filter(Boolean).filter(isYm);
  const uniq = [...new Set(list)].sort();
  if (!uniq.length) return { ok: true, touched: [], cash: [] };

  const startYm = uniq[0];
  const endYm = uniq[uniq.length - 1];

  // 1) обновляем агрегаты по каждому ym из списка
  const touched = [];
  for (const ym of uniq) {
    touched.push(await updateMonthAgg(ym));
  }

  // 2) пересчитываем cash chain на диапазон (start..end), stop on #locked
  const cash = await recomputeCashChainFrom(startYm, endYm);

  return { ok: true, touched, cash, range: { startYm, endYm } };
}

module.exports = {
  touchMonthsFromYms,
  getSalesAggForMonth, // если где-то нужно
};
