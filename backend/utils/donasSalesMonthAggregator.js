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
function ymToDate(ym) {
  return `${ym}-01`;
}
function nextYm(ym) {
  const [y, m] = String(ym).split("-").map((v) => Number(v));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return "";
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + 1);
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}
function hasLockedTag(notes) {
  return String(notes || "").toLowerCase().includes("#locked");
}

async function getCashStart() {
  try {
    const { rows } = await db.query(
      `
      SELECT cash_start
      FROM donas_finance_settings
      WHERE slug=$1
      ORDER BY id DESC
      LIMIT 1
      `,
      [SLUG]
    );
    return toNum(rows?.[0]?.cash_start);
  } catch (e) {
    // если таблицы/поля нет — не валим
    return 0;
  }
}

/**
 * Sales agg: revenue/cogs за месяц ym
 */
async function getSalesAggForMonth(ym) {
  const { rows } = await db.query(
    `
    SELECT
      COALESCE(SUM(revenue_total), 0) AS revenue,
      COALESCE(SUM(cogs_total), 0)    AS cogs,
      COUNT(*)::int                  AS cnt
    FROM donas_sales
    WHERE to_char(sold_at, 'YYYY-MM') = $1
    `,
    [ym]
  );

  const r = rows?.[0] || {};
  return {
    revenue: toNum(r.revenue),
    cogs: toNum(r.cogs),
    cnt: Number(r.cnt || 0) || 0,
  };
}

/**
 * Purchases agg: opex/capex за месяц ym
 * - ожидаем donas_purchases(date, total, type)
 * - type может быть 'OPEX'/'CAPEX' или 'opex'/'capex'
 */
async function getPurchasesAggForMonth(ym) {
  const { rows } = await db.query(
    `
    SELECT
      COALESCE(SUM(CASE WHEN LOWER(type) = 'opex'  THEN COALESCE(total,0) ELSE 0 END), 0) AS opex,
      COALESCE(SUM(CASE WHEN LOWER(type) = 'capex' THEN COALESCE(total,0) ELSE 0 END), 0) AS capex
    FROM donas_purchases
    WHERE to_char(date, 'YYYY-MM') = $1
    `,
    [ym]
  );
  const r = rows?.[0] || {};
  return {
    opex: toNum(r.opex),
    capex: toNum(r.capex),
  };
}

async function getMonthRow(ym) {
  const { rows } = await db.query(
    `
    SELECT *
    FROM donas_finance_months
    WHERE slug=$1 AND month = ($2)::date
    ORDER BY id DESC
    LIMIT 1
    `,
    [SLUG, ymToDate(ym)]
  );
  return rows?.[0] || null;
}

async function ensureMonthRowExists(ym) {
  const cur = await getMonthRow(ym);
  if (cur) return cur;

  const { rows } = await db.query(
    `
    INSERT INTO donas_finance_months
      (slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes)
    VALUES
      ($1, ($2)::date, 0, 0, 0, 0, 0, 0, '')
    RETURNING *
    `,
    [SLUG, ymToDate(ym)]
  );
  return rows?.[0] || null;
}

/**
 * Возвращает список месяцев >= fromYm, которые уже есть в таблице months
 * (нужен для пересчёта цепочки cash_end вперёд)
 */
async function listMonthsFrom(fromYm) {
  const { rows } = await db.query(
    `
    SELECT to_char(month, 'YYYY-MM') AS ym, notes
    FROM donas_finance_months
    WHERE slug=$1 AND month >= ($2)::date
    ORDER BY month ASC
    `,
    [SLUG, ymToDate(fromYm)]
  );
  return (rows || []).map((r) => ({ ym: r.ym, notes: r.notes || "" }));
}

/**
 * Находим предыдущий месяц, который есть в таблице months.
 * Если нет — вернём null.
 */
async function getPrevExistingMonthYm(ym) {
  const { rows } = await db.query(
    `
    SELECT to_char(month, 'YYYY-MM') AS ym
    FROM donas_finance_months
    WHERE slug=$1 AND month < ($2)::date
    ORDER BY month DESC
    LIMIT 1
    `,
    [SLUG, ymToDate(ym)]
  );
  return rows?.[0]?.ym || null;
}

/**
 * Пересчитать один месяц (если не locked):
 * - revenue/cogs из sales
 * - opex/capex из purchases
 * - cash_end по формуле через prevCashEnd
 */
async function recomputeOneMonth(ym, prevCashEnd) {
  const row = await ensureMonthRowExists(ym);
  if (!row) return { ok: false, ym, reason: "no_row" };

  if (hasLockedTag(row.notes)) {
    return { ok: true, ym, locked: true, cash_end: toNum(row.cash_end) };
  }

  const sales = await getSalesAggForMonth(ym);
  const purch = await getPurchasesAggForMonth(ym);

  const loan = toNum(row.loan_paid);

  const gp = sales.revenue - sales.cogs;
  const netOp = gp - purch.opex;
  const cf = netOp - loan - purch.capex;

  const cash_end = toNum(prevCashEnd) + cf;

  await db.query(
    `
    UPDATE donas_finance_months
    SET revenue=$1,
        cogs=$2,
        opex=$3,
        capex=$4,
        cash_end=$5
    WHERE slug=$6 AND month=($7)::date
    `,
    [
      sales.revenue,
      sales.cogs,
      purch.opex,
      purch.capex,
      cash_end,
      SLUG,
      ymToDate(ym),
    ]
  );

  return {
    ok: true,
    ym,
    locked: false,
    revenue: sales.revenue,
    cogs: sales.cogs,
    opex: purch.opex,
    capex: purch.capex,
    loan_paid: loan,
    cash_end,
    cf,
    sales_cnt: sales.cnt,
  };
}

/**
 * FULL AUTO-TOUCH:
 * - начинает с fromYm
 * - пересчитывает cash_end цепочкой по существующим months вперёд
 * - останавливается на первом locked месяце (его не трогаем, дальше тоже не идём)
 */
async function touchMonthsFrom( fromYm ) {
  if (!isYm(fromYm)) return { ok: false, reason: "bad_ym", fromYm };

  // чтобы месяц существовал даже если sales только что создали новый ym
  await ensureMonthRowExists(fromYm);

  const months = await listMonthsFrom(fromYm);
  if (!months.length) return { ok: true, fromYm, touched: 0, stoppedOnLocked: false, items: [] };

  // prevCashEnd: берём из предыдущего существующего месяца, иначе cash_start из settings
  const prevYm = await getPrevExistingMonthYm(fromYm);
  let prevCashEnd;
  if (prevYm) {
    const prevRow = await getMonthRow(prevYm);
    prevCashEnd = toNum(prevRow?.cash_end);
  } else {
    prevCashEnd = await getCashStart();
  }

  const items = [];
  let stoppedOnLocked = false;

  for (const m of months) {
    const curRow = await getMonthRow(m.ym);
    if (curRow && hasLockedTag(curRow.notes)) {
      // STOP: locked месяц не трогаем и дальше не идём
      items.push({ ym: m.ym, locked: true, skipped: true, cash_end: toNum(curRow.cash_end) });
      stoppedOnLocked = true;
      break;
    }

    const r = await recomputeOneMonth(m.ym, prevCashEnd);
    items.push(r);

    // обновляем prevCashEnd для следующего месяца
    if (r && r.ok && !r.locked) prevCashEnd = toNum(r.cash_end);
    else if (r && r.ok && r.locked) {
      // теоретически сюда не попадём, мы выше stop-аем, но пусть будет
      prevCashEnd = toNum(r.cash_end);
      stoppedOnLocked = true;
      break;
    } else {
      // если что-то пошло не так — стоп, чтобы не размазывать ошибку
      break;
    }
  }

  return {
    ok: true,
    fromYm,
    touched: items.filter((x) => x && x.ok && !x.locked).length,
    stoppedOnLocked,
    items,
  };
}

/**
 * Удобный хелпер: когда updateSale меняет месяц (oldYm/newYm)
 * — пересчитываем начиная с MIN(ym) (чтобы цепочка cash_end была корректной).
 */
async function touchMonthsFromYms(yms) {
  const list = []
    .concat(yms || [])
    .map((s) => String(s || "").slice(0, 7))
    .filter((s) => isYm(s));

  if (!list.length) return { ok: false, reason: "no_valid_yms" };

  list.sort(); // лексикографически YYYY-MM работает
  const fromYm = list[0];

  return await touchMonthsFrom(fromYm);
}

module.exports = {
  // legacy exports (оставляем, вдруг где-то уже использовалось)
  getSalesAggForMonth,

  // new full-touch exports
  touchMonthsFrom,
  touchMonthsFromYms,
};
