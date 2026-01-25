// donaFinance.js
// Финансовая модель Dona’s Dosas (1:1 логика с Excel)

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

// PMT — ежемесячный платёж по кредиту
export function calcPMT(rateAnnual, months, principal) {
  const r = rateAnnual / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

// Основные месячные показатели
export function calcMonthly(inputs) {
  const revenue =
    inputs.ordersPerDay * inputs.avgTicket * inputs.workingDays;
  const cogs = revenue * inputs.foodCost;
  const grossProfit = revenue - cogs;
  const ebitda = grossProfit - inputs.opex;

  return { revenue, cogs, grossProfit, ebitda };
}

// Break-even (заказы в день)
export function calcBreakEven(inputs) {
  return (
    inputs.opex /
    (inputs.avgTicket * inputs.workingDays * (1 - inputs.foodCost))
  );
}

// 36-месячная модель
export function calc36Months(inputs, loan) {
  const months = [];
  const pmt = calcPMT(loan.rate, loan.term, loan.amount);

  let cumulative = 0;

  for (let i = 1; i <= loan.term; i++) {
    const m = calcMonthly(inputs);
    const netCash = m.ebitda - pmt;
    cumulative += netCash;

    const dscr = pmt > 0 ? m.ebitda / pmt : null;

    months.push({
      month: i,
      revenue: m.revenue,
      ebitda: m.ebitda,
      loanPayment: pmt,
      netCash,
      cumulative,
      dscr,
    });
  }

  return months;
}
