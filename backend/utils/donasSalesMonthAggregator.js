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

function prevYm(ym) {
  const [y, m] = String(ym).split("-").map((v) => Number(v));
  const d = new Date(Date.UTC(y, (m - 1) - 1, 1)); // prev month
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

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
 * Возвращает последний существующий YM в donas_finance_months (по max(month)).
 * Если таблица пустая — вернём endYm (чтобы не уходить в бесконечность).
 */
async function getLastExistingYmFallback(endYm) {
  try {
    const q = await db.query(
      `
      SELECT to_char(MAX(month), 'YYYY-MM') AS ym
      FROM donas_finance_months
      WHERE slug=$1
      `,
      [SLUG]
    );
    const ym = q.rows?.[0]?.ym || "";
    if (isYm(ym)) return ym;
  } catch (e) {
    console.error("getLastExistingYmFallback error:", e);
  }
  return endYm;
}

/**
 * Sales → revenue/cogs
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
 * Purchases → opex/capex
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
 * Обновляем агрегаты в "последней" строке месяца (latest id),
 * НЕ трогаем loan_paid, notes.
 * Если месяц locked — ничего не обновляем.
 */
async function updateMonthAgg(ym) {
  if (!isYm(ym)) return { ym, ok: false, reason: "bad_ym" };

  const row = await ensureMonthRow(ym);
  const locked = hasLockedTag(row?.notes || "");

  if (locked) {
    return { ym, ok: true, locked: true, updated: false };
  }

  const [sales, pur] = await Promise.all([getSalesAggForMonth(ym), getPurchasesAggForMonth(ym)]);

  await db.query(
    `
    UPDATE donas_finance_months
    SET revenue=$1,
        cogs=$2,
        opex=$3,
        capex=$4
    WHERE id=$5
    `,
    [sales.revenue, sales.cogs, pur.opex, pur.capex, row.id]
  );

  return { ym, ok: true, locked: false, updated: true, ...sales, ...pur, id: row.id };
}

/**
 * cash_end chain:
 * - стартуем с startYm
 * - cash_end(startYm) = cash_end(prevYm) + CF(startYm)
 * - CF = revenue - cogs - opex - capex - loan_paid
 * - loan_paid НЕ пересчитываем (используем то, что уже в строке месяца)
 * - стоп на первом #locked (и locked месяц не обновляем, и дальше не идём)
 */
async function recomputeCashChainFrom(startYm, endYm) {
  if (!isYm(startYm) || !isYm(endYm)) return [];

  // ensure every month row exists in range
  let cur = startYm;
  while (true) {
    await ensureMonthRow(cur);
    if (cur === endYm) break;
    cur = nextYm(cur);
  }

  // читаем все строки в диапазоне и берём latest по месяцу
  const rows = await listMonthsRange(startYm, endYm);
  const byMonth = pickLastByMonth(rows);

  // prev cash_end
  const pYm = prevYm(startYm);
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
      [SLUG, ymToMonthDate(pYm)]
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

    if (locked) {
      results.push({
        ym: cur,
        locked: true,
        cash_end: toNum(row.cash_end),
        updated: false,
        id: row.id,
      });
      break; // стоп цепочки
    }

    const revenue = toNum(row.revenue);
    const cogs = toNum(row.cogs);
    const opex = toNum(row.opex);
    const capex = toNum(row.capex);
    const loan = toNum(row.loan_paid); // ✅ ручное поле, НЕ трогаем

    const cf = revenue - cogs - opex - capex - loan;
    const cashEnd = prevCash + cf;

    await db.query(
      `
      UPDATE donas_finance_months
      SET cash_end=$1
      WHERE id=$2
      `,
      [cashEnd, row.id]
    );

    results.push({
      ym: cur,
      locked: false,
      cash_end: cashEnd,
      updated: true,
      id: row.id,
      cf,
    });

    prevCash = cashEnd;

    if (cur === endYm) break;
    cur = nextYm(cur);
  }

  return results;
}

/**
 * PUBLIC: full auto-touch
 * - обновляет аггрегаты sales+purchases для uniq ym
 * - cash_end пересчитывает от minYm до последнего существующего месяца (чтобы протянуть цепочку)
 * - стоп на #locked
 */
async function touchMonthsFromYms(yms = []) {
  const list = (yms || []).filter(Boolean).filter(isYm);
  const uniq = [...new Set(list)].sort();
  if (!uniq.length) return { ok: true, touched: [], cash: [] };

  const startYm = uniq[0];

  // агрегаты обновляем только на затронутых месяцах
  const touched = [];
  for (const ym of uniq) {
    touched.push(await updateMonthAgg(ym));
  }

  // cash_end надо протянуть дальше — до последнего существующего месяца
  const lastExistingYm = await getLastExistingYmFallback(uniq[uniq.length - 1]);

  // endYm для цепочки: максимум(lastExisting, lastTouched)
  const lastTouchedYm = uniq[uniq.length - 1];
  const endYm = String(lastExistingYm).localeCompare(String(lastTouchedYm)) >= 0
    ? lastExistingYm
    : lastTouchedYm;

  const cash = await recomputeCashChainFrom(startYm, endYm);

  return { ok: true, touched, cash, range: { startYm, endYm } };
}

module.exports = {
  touchMonthsFromYms,
  getSalesAggForMonth,
};
