import { useState, useMemo } from "react";
import {
  SCENARIOS,
  calcMonthly,
  calcBreakEven,
  calc36Months,
  calcPMT,
} from "../utils/donasFinance";

export default function DonasFinanceModel() {
  const [scenario, setScenario] = useState("Base");

  const [loan, setLoan] = useState({
    rate: 0.24,
    term: 36,
    amount: SCENARIOS.Base.capex,
  });

  const inputs = SCENARIOS[scenario];

  const monthly = useMemo(
    () => calcMonthly(inputs),
    [inputs]
  );

  const breakEven = useMemo(
    () => calcBreakEven(inputs),
    [inputs]
  );

  const pmt = useMemo(
    () => calcPMT(loan.rate, loan.term, loan.amount),
    [loan]
  );

  const model36 = useMemo(
    () => calc36Months(inputs, loan),
    [inputs, loan]
  );

  const avgDSCR =
    model36.reduce((s, m) => s + (m.dscr || 0), 0) / model36.length;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">
        Dona’s Dosas — Financial Model
      </h1>

      {/* Scenario */}
      <div className="mb-6 flex gap-2">
        {["Conservative", "Base", "Optimistic"].map((s) => (
          <button
            key={s}
            onClick={() => {
              setScenario(s);
              setLoan((l) => ({ ...l, amount: SCENARIOS[s].capex }));
            }}
            className={`px-4 py-2 rounded ${
              scenario === s
                ? "bg-black text-white"
                : "bg-gray-200"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Kpi title="Monthly Revenue" value={monthly.revenue} />
        <Kpi title="EBITDA" value={monthly.ebitda} />
        <Kpi
          title="Break-even (orders/day)"
          value={breakEven.toFixed(1)}
        />
        <Kpi title="Avg DSCR" value={avgDSCR.toFixed(2)} />
      </div>

      {/* Loan */}
      <div className="mb-8">
        <h2 className="font-semibold mb-2">Loan</h2>
        <div className="grid grid-cols-3 gap-4">
          <Input
            label="Annual rate"
            value={loan.rate}
            onChange={(v) =>
              setLoan({ ...loan, rate: Number(v) })
            }
          />
          <Input
            label="Term (months)"
            value={loan.term}
            onChange={(v) =>
              setLoan({ ...loan, term: Number(v) })
            }
          />
          <Input
            label="Amount"
            value={loan.amount}
            onChange={(v) =>
              setLoan({ ...loan, amount: Number(v) })
            }
          />
        </div>
        <div className="mt-2 text-sm">
          Monthly payment:{" "}
          <b>{Math.round(pmt).toLocaleString()} UZS</b>
        </div>
      </div>

      {/* 36 months */}
      <h2 className="font-semibold mb-2">36 months summary</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full border text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="border p-2">Month</th>
              <th className="border p-2">Revenue</th>
              <th className="border p-2">EBITDA</th>
              <th className="border p-2">Loan</th>
              <th className="border p-2">Net CF</th>
              <th className="border p-2">DSCR</th>
            </tr>
          </thead>
          <tbody>
            {model36.map((m) => (
              <tr key={m.month}>
                <td className="border p-2">{m.month}</td>
                <td className="border p-2">
                  {Math.round(m.revenue).toLocaleString()}
                </td>
                <td className="border p-2">
                  {Math.round(m.ebitda).toLocaleString()}
                </td>
                <td className="border p-2">
                  {Math.round(m.loanPayment).toLocaleString()}
                </td>
                <td className="border p-2">
                  {Math.round(m.netCash).toLocaleString()}
                </td>
                <td className="border p-2">
                  {m.dscr ? m.dscr.toFixed(2) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ title, value }) {
  return (
    <div className="border rounded p-4">
      <div className="text-xs text-gray-500">{title}</div>
      <div className="text-lg font-bold">
        {typeof value === "number"
          ? value.toLocaleString()
          : value}
      </div>
    </div>
  );
}

function Input({ label, value, onChange }) {
  return (
    <div>
      <label className="text-xs text-gray-500">{label}</label>
      <input
        className="w-full border p-2 rounded"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
