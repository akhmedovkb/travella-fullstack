// frontend/src/pages/DonasFinanceModel.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  SCENARIOS,
  DEFAULT_SEASONALITY,
  calcMonthlyBase,
  calcBreakEvenOrdersPerDay,
  calc36MonthsModel,
  calcAmortization,
  formatUZS,
} from "../utils/donasFinance";

// Export helpers
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

export default function DonasFinanceModel() {
  const [scenario, setScenario] = useState("Base");

  // Inputs override (editable)
  const [inputs, setInputs] = useState({ ...SCENARIOS.Base });

  // Loan
  const [loan, setLoan] = useState({
    amount: SCENARIOS.Base.capex,
    rateAnnual: 0.24,
    termMonths: 36,
  });

  // Seasonality
  const [applySeasonality, setApplySeasonality] = useState(true);
  const [seasonality, setSeasonality] = useState([...DEFAULT_SEASONALITY]);

  // Versions
  const [versions, setVersions] = useState([]);
  const [saveName, setSaveName] = useState("");
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [busy, setBusy] = useState(false);

  const reportRef = useRef(null);

  // Sync inputs when scenario changes
  useEffect(() => {
    const base = SCENARIOS[scenario] || SCENARIOS.Base;
    setInputs({ ...base });
    setLoan((l) => ({ ...l, amount: base.capex }));
  }, [scenario]);

  const monthly = useMemo(() => calcMonthlyBase(inputs), [inputs]);
  const breakEven = useMemo(() => calcBreakEvenOrdersPerDay(inputs), [inputs]);

  const model = useMemo(
    () =>
      calc36MonthsModel({
        inputs,
        loan,
        applySeasonality,
        seasonality,
      }),
    [inputs, loan, applySeasonality, seasonality]
  );

  const amort = useMemo(
    () =>
      calcAmortization({
        amount: loan.amount,
        rateAnnual: loan.rateAnnual,
        termMonths: loan.termMonths,
      }),
    [loan]
  );

  // Load versions list
  async function refreshVersions() {
    setLoadingVersions(true);
    try {
      const r = await fetch("/api/finance-models", { credentials: "include" });
      const data = await r.json();
      setVersions(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setVersions([]);
    } finally {
      setLoadingVersions(false);
    }
  }

  useEffect(() => {
    refreshVersions();
  }, []);

  // Save current model
  async function handleSave() {
    if (!saveName.trim()) return alert("Укажи название версии (name).");
    setBusy(true);
    try {
      const payload = {
        name: saveName.trim(),
        data: {
          scenario,
          inputs,
          loan,
          applySeasonality,
          seasonality,
        },
      };

      const r = await fetch("/api/finance-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await r.json();
      if (!r.ok) throw new Error(data?.message || "Save failed");
      setSaveName("");
      await refreshVersions();
      alert("Сохранено.");
    } catch (e) {
      alert(`Ошибка сохранения: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleLoad(id) {
    setBusy(true);
    try {
      const r = await fetch(`/api/finance-models/${id}`, { credentials: "include" });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.message || "Load failed");

      const d = data?.item?.data;
      if (!d) throw new Error("No data");

      setScenario(d.scenario || "Base");
      setInputs(d.inputs || SCENARIOS.Base);
      setLoan(d.loan || { amount: SCENARIOS.Base.capex, rateAnnual: 0.24, termMonths: 36 });
      setApplySeasonality(Boolean(d.applySeasonality));
      setSeasonality(Array.isArray(d.seasonality) ? d.seasonality : [...DEFAULT_SEASONALITY]);
      alert("Загружено.");
    } catch (e) {
      alert(`Ошибка загрузки: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm("Удалить эту версию?")) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/finance-models/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.message || "Delete failed");
      await refreshVersions();
    } catch (e) {
      alert(`Ошибка удаления: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  // Export Excel
  function exportExcel() {
    const wb = XLSX.utils.book_new();

    // Inputs
    const inputsRows = [
      ["Scenario", scenario],
      ["Orders/day", inputs.ordersPerDay],
      ["Avg ticket (UZS)", inputs.avgTicket],
      ["Working days/month", inputs.workingDays],
      ["Food cost %", inputs.foodCost],
      ["Monthly OPEX (UZS)", inputs.opex],
      ["CAPEX (UZS)", inputs.capex],
      ["Loan amount (UZS)", loan.amount],
      ["Annual rate", loan.rateAnnual],
      ["Loan term (months)", loan.termMonths],
      ["Seasonality enabled", applySeasonality ? "YES" : "NO"],
      ["Seasonality (Jan..Dec)", seasonality.join(", ")],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(inputsRows), "Inputs");

    // P&L (monthly)
    const pnlRows = [
      ["Metric", "Value (monthly)"],
      ["Revenue", monthly.revenue],
      ["COGS", monthly.cogs],
      ["Gross Profit", monthly.grossProfit],
      ["OPEX", inputs.opex],
      ["EBITDA", monthly.ebitda],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pnlRows), "P&L");

    // Loan schedule
    const loanRows = [
      ["Month", "Begin", "Payment", "Interest", "Principal", "End"],
      ...amort.rows.map((x) => [x.month, x.beginBalance, x.payment, x.interest, x.principal, x.endBalance]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(loanRows), "Loan");

    // 36M model
    const mRows = [
      ["Month", "K", "Revenue", "EBITDA", "Loan", "Net CF", "Cumulative", "DSCR"],
      ...model.months.map((m) => [
        m.month,
        m.seasonalityK,
        m.revenue,
        m.ebitda,
        m.loanPayment,
        m.netCash,
        m.cumulative,
        m.dscr ?? "",
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(mRows), "36M");

    // DSCR summary
    const dscrRows = [
      ["Metric", "Value"],
      ["Average DSCR", model.avgDSCR ?? ""],
      ["Minimum DSCR", model.minDSCR ?? ""],
      ["Monthly payment (PMT)", model.pmt],
      ["Break-even orders/day", breakEven ?? ""],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dscrRows), "DSCR");

    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    saveAs(new Blob([out], { type: "application/octet-stream" }), "Dona_s_Dosas_Financial_Model.xlsx");
  }

  // Export PDF (captures report area)
  async function exportPDF() {
    if (!reportRef.current) return;

    setBusy(true);
    try {
      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");

      const pageWidth = 210;
      const pageHeight = 297;

      // Canvas size in px
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save("Dona_s_Dosas_Financial_Model.pdf");
    } finally {
      setBusy(false);
    }
  }

  function setInputField(key, val) {
    setInputs((p) => ({ ...p, [key]: Number(val) }));
  }

  function setLoanField(key, val) {
    setLoan((p) => ({ ...p, [key]: Number(val) }));
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <h1 className="text-2xl font-bold">Dona’s Dosas — Financial Model</h1>

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={exportExcel}
            className="px-3 py-2 rounded bg-gray-200 hover:bg-gray-300 text-sm"
            disabled={busy}
          >
            Export Excel
          </button>
          <button
            onClick={exportPDF}
            className="px-3 py-2 rounded bg-gray-200 hover:bg-gray-300 text-sm"
            disabled={busy}
          >
            Export PDF
          </button>
        </div>
      </div>

      {/* Scenario switch */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {["Conservative", "Base", "Optimistic"].map((s) => (
          <button
            key={s}
            onClick={() => setScenario(s)}
            className={`px-4 py-2 rounded text-sm ${
              scenario === s ? "bg-black text-white" : "bg-gray-200 hover:bg-gray-300"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Versions */}
      <div className="border rounded p-4 mb-6">
        <div className="flex gap-2 flex-wrap items-end">
          <div className="flex-1 min-w-[240px]">
            <label className="text-xs text-gray-500">Save version name</label>
            <input
              className="w-full border p-2 rounded"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="e.g., BRB Base v1"
            />
          </div>
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded bg-black text-white text-sm disabled:opacity-50"
            disabled={busy}
          >
            Save
          </button>
          <button
            onClick={refreshVersions}
            className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 text-sm disabled:opacity-50"
            disabled={busy || loadingVersions}
          >
            Refresh
          </button>
        </div>

        <div className="mt-4">
          <div className="text-sm font-semibold mb-2">Saved versions</div>
          {versions.length === 0 ? (
            <div className="text-sm text-gray-500">
              {loadingVersions ? "Loading..." : "No saved versions yet."}
            </div>
          ) : (
            <div className="space-y-2">
              {versions.map((v) => (
                <div key={v.id} className="flex items-center justify-between border rounded p-2">
                  <div className="text-sm">
                    <div className="font-semibold">{v.name}</div>
                    <div className="text-xs text-gray-500">
                      {v.updated_at ? new Date(v.updated_at).toLocaleString() : ""}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleLoad(v.id)}
                      className="px-3 py-1.5 rounded bg-gray-200 hover:bg-gray-300 text-sm"
                      disabled={busy}
                    >
                      Load
                    </button>
                    <button
                      onClick={() => handleDelete(v.id)}
                      className="px-3 py-1.5 rounded bg-red-100 hover:bg-red-200 text-sm"
                      disabled={busy}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* INPUTS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="border rounded p-4">
          <div className="font-semibold mb-3">Inputs</div>

          <Field label="Orders per day" value={inputs.ordersPerDay} onChange={(v) => setInputField("ordersPerDay", v)} />
          <Field label="Average ticket (UZS)" value={inputs.avgTicket} onChange={(v) => setInputField("avgTicket", v)} />
          <Field label="Working days / month" value={inputs.workingDays} onChange={(v) => setInputField("workingDays", v)} />
          <Field label="Food cost %" value={inputs.foodCost} step="0.01" onChange={(v) => setInputField("foodCost", v)} />
          <Field label="Monthly OPEX (UZS)" value={inputs.opex} onChange={(v) => setInputField("opex", v)} />
          <Field label="CAPEX (UZS)" value={inputs.capex} onChange={(v) => setInputField("capex", v)} />

          <div className="mt-3 flex items-center gap-2">
            <input
              type="checkbox"
              checked={applySeasonality}
              onChange={(e) => setApplySeasonality(e.target.checked)}
            />
            <span className="text-sm">Apply seasonality</span>
          </div>

          {applySeasonality && (
            <div className="mt-3">
              <div className="text-xs text-gray-500 mb-2">Seasonality multipliers (Jan..Dec)</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m, idx) => (
                  <div key={m} className="border rounded p-2">
                    <div className="text-xs text-gray-500">{m}</div>
                    <input
                      className="w-full border p-2 rounded text-sm"
                      value={seasonality[idx]}
                      onChange={(e) => {
                        const next = [...seasonality];
                        next[idx] = Number(e.target.value);
                        setSeasonality(next);
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="border rounded p-4">
          <div className="font-semibold mb-3">Loan</div>
          <Field label="Loan amount (UZS)" value={loan.amount} onChange={(v) => setLoanField("amount", v)} />
          <Field label="Annual interest rate" value={loan.rateAnnual} step="0.01" onChange={(v) => setLoanField("rateAnnual", v)} />
          <Field label="Term (months)" value={loan.termMonths} onChange={(v) => setLoanField("termMonths", v)} />

          <div className="mt-3 text-sm">
            Monthly payment (PMT): <b>{formatUZS(model.pmt)} UZS</b>
          </div>

          <div className="mt-4 text-xs text-gray-500">
            DSCR is calculated as <b>EBITDA / Monthly Payment</b>. Banks often want DSCR ≥ 1.2.
          </div>
        </div>
      </div>

      {/* REPORT AREA (for PDF) */}
      <div ref={reportRef}>
        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
          <Kpi title="Revenue (monthly)" value={`${formatUZS(monthly.revenue)} UZS`} />
          <Kpi title="EBITDA (monthly)" value={`${formatUZS(monthly.ebitda)} UZS`} />
          <Kpi title="Net CF (monthly)" value={`${formatUZS(monthly.ebitda - model.pmt)} UZS`} />
          <Kpi title="Break-even orders/day" value={breakEven ? breakEven.toFixed(1) : "-"} />
          <Kpi title="Avg DSCR" value={model.avgDSCR ? model.avgDSCR.toFixed(2) : "-"} />
          <Kpi title="Min DSCR" value={model.minDSCR ? model.minDSCR.toFixed(2) : "-"} />
        </div>

        {/* 36M table */}
        <div className="border rounded p-4 mb-6">
          <div className="font-semibold mb-3">36 months model</div>
          <div className="overflow-x-auto">
            <table className="min-w-full border text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="border p-2">M</th>
                  <th className="border p-2">K</th>
                  <th className="border p-2">Revenue</th>
                  <th className="border p-2">EBITDA</th>
                  <th className="border p-2">Loan</th>
                  <th className="border p-2">Net CF</th>
                  <th className="border p-2">Cumulative</th>
                  <th className="border p-2">DSCR</th>
                </tr>
              </thead>
              <tbody>
                {model.months.map((m) => (
                  <tr key={m.month}>
                    <td className="border p-2">{m.month}</td>
                    <td className="border p-2">{Number(m.seasonalityK).toFixed(2)}</td>
                    <td className="border p-2">{formatUZS(m.revenue)}</td>
                    <td className="border p-2">{formatUZS(m.ebitda)}</td>
                    <td className="border p-2">{formatUZS(m.loanPayment)}</td>
                    <td className="border p-2">{formatUZS(m.netCash)}</td>
                    <td className="border p-2">{formatUZS(m.cumulative)}</td>
                    <td className="border p-2">{m.dscr ? m.dscr.toFixed(2) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Loan table */}
        <div className="border rounded p-4">
          <div className="font-semibold mb-3">Loan amortization</div>
          <div className="overflow-x-auto">
            <table className="min-w-full border text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="border p-2">M</th>
                  <th className="border p-2">Begin</th>
                  <th className="border p-2">Payment</th>
                  <th className="border p-2">Interest</th>
                  <th className="border p-2">Principal</th>
                  <th className="border p-2">End</th>
                </tr>
              </thead>
              <tbody>
                {amort.rows.map((x) => (
                  <tr key={x.month}>
                    <td className="border p-2">{x.month}</td>
                    <td className="border p-2">{formatUZS(x.beginBalance)}</td>
                    <td className="border p-2">{formatUZS(x.payment)}</td>
                    <td className="border p-2">{formatUZS(x.interest)}</td>
                    <td className="border p-2">{formatUZS(x.principal)}</td>
                    <td className="border p-2">{formatUZS(x.endBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, step }) {
  return (
    <div className="mb-2">
      <label className="text-xs text-gray-500">{label}</label>
      <input
        className="w-full border p-2 rounded text-sm"
        value={value}
        step={step}
        type="number"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function Kpi({ title, value }) {
  return (
    <div className="border rounded p-3">
      <div className="text-xs text-gray-500">{title}</div>
      <div className="text-sm font-bold">{value}</div>
    </div>
  );
}
