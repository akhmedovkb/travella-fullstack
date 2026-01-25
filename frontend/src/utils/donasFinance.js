// frontend/src/utils/donasFinance.js
// Dona’s Dosas — Financial Model (Excel-like)
// Includes: scenarios, seasonality, PMT, amortization, 36-month model, DSCR, break-even

export const SCENARIOS = {
  Conservative: {
    ordersPerDay: 70,
    avgTicket: 60000,
    workingDays: 26,
    foodCost: 0.30,
    opex: 60000000,
    capex: 230000000,
  },
  Base: {
    ordersPerDay: 90,
    avgTicket: 65000,
    workingDays: 26,
    foodCost: 0.28,
    opex: 55000000,
    capex: 210000000,
  },
  Optimistic: {
    ordersPerDay: 120,
    avgTicket: 75000,
    workingDays: 26,
    foodCost: 0.26,
    opex: 60000000,
    capex: 250000000,
  },
};

// Default seasonality multipliers (Jan..Dec)
export const DEFAULT_SEASONALITY = [1.0, 0.95, 1.0, 1.0, 1.05, 1.1, 1.05, 1.0, 1.0, 1.1, 1.2, 1.3];

export function calcPMT(rateAnnual, months, principal) {
  const r = Number(rateAnnual) / 12;
  const n = Number(months);
  const pv = Number(principal);

  if (!isFinite(r) || !isFinite(n) || !isFinite(pv) || n <= 0) return 0;
  if (r === 0) return pv / n;

  return (pv * r) / (1 - Math.pow(1 + r, -n));
}

export function calcMonthlyBase(inputs) {
  const revenue = inputs.ordersPerDay * inputs.avgTicket * inputs.workingDays;
  const cogs = revenue * inputs.foodCost;
  const grossProfit = revenue - cogs;
  const ebitda = grossProfit - inputs.opex;

  return { revenue, cogs, grossProfit, ebitda };
}

export function calcBreakEvenOrdersPerDay(inputs) {
  const denom = inputs.avgTicket * inputs.workingDays * (1 - inputs.foodCost);
  if (denom <= 0) return null;
  return inputs.opex / denom;
}

// Amortization schedule
export function calcAmortization({ amount, rateAnnual, termMonths }) {
  const principal = Number(amount);
  const rate = Number(rateAnnual);
  const term = Number(termMonths);

  const pmt = calcPMT(rate, term, principal);
  const r = rate / 12;

  let balance = principal;
  const rows = [];

  for (let m = 1; m <= term; m++) {
    const interest = balance * r;
    const principalPaid = pmt - interest;
    const endBalance = balance - principalPaid;

    rows.push({
      month: m,
      beginBalance: balance,
      payment: pmt,
      interest,
      principal: principalPaid,
      endBalance: endBalance < 0 ? 0 : endBalance,
    });

    balance = endBalance;
    if (balance <= 0) break;
  }

  return { pmt, rows };
}

// 36-month model (optionally seasonality)
export function calc36MonthsModel({
  inputs,
  loan,
  applySeasonality,
  seasonality = DEFAULT_SEASONALITY,
}) {
  const term = Number(loan.termMonths);
  const pmt = calcPMT(loan.rateAnnual, term, loan.amount);

  let cumulative = 0;

  const months = [];

  for (let i = 1; i <= term; i++) {
    const monthIndex = (i - 1) % 12; // Jan..Dec repeating
    const k = applySeasonality ? Number(seasonality?.[monthIndex] ?? 1) : 1;

    const revenue = inputs.ordersPerDay * k * inputs.avgTicket * inputs.workingDays;
    const cogs = revenue * inputs.foodCost;
    const grossProfit = revenue - cogs;
    const ebitda = grossProfit - inputs.opex;

    const netCash = ebitda - pmt;
    cumulative += netCash;

    const dscr = pmt > 0 ? ebitda / pmt : null;

    months.push({
      month: i,
      seasonalityK: k,
      revenue,
      cogs,
      grossProfit,
      opex: inputs.opex,
      ebitda,
      loanPayment: pmt,
      netCash,
      cumulative,
      dscr,
    });
  }

  const dscrValues = months.map((x) => x.dscr).filter((v) => typeof v === "number" && isFinite(v));
  const avgDSCR = dscrValues.length ? dscrValues.reduce((a, b) => a + b, 0) / dscrValues.length : null;
  const minDSCR = dscrValues.length ? Math.min(...dscrValues) : null;

  return { pmt, months, avgDSCR, minDSCR };
}

export function formatUZS(n) {
  const x = Number(n);
  if (!isFinite(x)) return "-";
  return Math.round(x).toLocaleString("ru-RU");
}
