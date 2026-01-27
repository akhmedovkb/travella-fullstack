//frontend/src/pages/admin/DonasInvestor.jsx
import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../api";

/**
 * Investor / Bank View (READ ONLY)
 * Источник данных:
 *   GET /api/public/donas/summary-range?key=...&months=12&end=YYYY-MM
 *
 * Требует:
 *   VITE_DONAS_PUBLIC_KEY в env фронта
 */

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n) {
  const v = Math.round(toNum(n));
  return v.toLocaleString("ru-RU");
}

function pct(a, b) {
  const A = toNum(a);
  const B = toNum(b);
  if (!B) return "—";
  return ((A / B) * 100).toFixed(1) + "%";
}

function monthLabel(ym) {
  // YYYY-MM → MM.YYYY
  if (!ym) return "";
  const [y, m] = String(ym).split("-");
  return `${m}.${y}`;
}

function escCsvCell(v) {
  const s = String(v ?? "");
  // если есть спецсимволы — экранируем
  if (/[",\n\r;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadTextFile(filename, text, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function DonasInvestor() {
  const [months, setMonths] = useState(12);
  const [end, setEnd] = useState(""); // YYYY-MM
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const publicKey = import.meta.env.VITE_DONAS_PUBLIC_KEY;

  async function load() {
    if (!publicKey) {
      setError("VITE_DONAS_PUBLIC_KEY not set");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams({
        key: publicKey,
        months: String(months),
      });
      if (end) q.set("end", end);

      const res = await apiGet(`/api/public/donas/summary-range?${q.toString()}`);
      setData(res);
    } catch (e) {
      console.error(e);
      setError("Failed to load investor summary");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const meta = data?.meta || {};
  const totals = data?.totals || {};
  const rows = data?.months || [];

  const grossProfit = useMemo(() => toNum(totals.revenue) - toNum(totals.cogs), [totals]);

  function handleExportCsv() {
    if (!rows.length) return;

    const header = [
      "Month",
      "Revenue",
      "COGS",
      "Payroll",
      "OPEX",
      "NetOperating",
      "CashFlow",
      "DSCR",
      "Currency",
    ];

    const lines = [];
    lines.push(header.map(escCsvCell).join(";"));

    for (const r of rows) {
      const line = [
        r.month,
        toNum(r.revenue),
        toNum(r.cogs),
        toNum(r.payroll),
        toNum(r.opex),
        toNum(r.netOperating),
        toNum(r.cashFlow),
        r.dscr == null ? "" : r.dscr,
        meta.currency || "UZS",
      ];
      lines.push(line.map(escCsvCell).join(";"));
    }

    // totals row
    lines.push("");
    lines.push(["TOTALS", "", "", "", "", "", "", "", meta.currency || "UZS"].map(escCsvCell).join(";"));
    lines.push(
      [
        `Period ${meta.from || ""}..${meta.to || ""}`,
        toNum(totals.revenue),
        toNum(totals.cogs),
        toNum(totals.payroll),
        toNum(totals.opex),
        toNum(totals.netOperating),
        toNum(totals.cashFlow),
        totals.avgDscr == null ? "" : totals.avgDscr,
        meta.currency || "UZS",
      ]
        .map(escCsvCell)
        .join(";")
    );

    const filename = `donas_investor_${meta.from || "from"}_${meta.to || "to"}.csv`;
    // Excel (RU) часто любит ; разделитель — поэтому используем ;
    downloadTextFile(filename, lines.join("\n"), "text/csv;charset=utf-8");
  }

  function handlePrintPdf() {
    // Для банка: печать → "Save as PDF"
    window.print();
  }

  return (
    <div className="p-6 space-y-6">
      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          header { display: none !important; } /* если у тебя Header sticky */
          .print-box { border: 1px solid #e5e7eb !important; }
          table { font-size: 12px !important; }
          .page-title { margin-bottom: 8px !important; }
        }
      `}</style>

      {/* Header */}
      <div className="flex flex-wrap items-end gap-4 no-print">
        <div>
          <h1 className="text-2xl font-semibold page-title">Dona’s Dosas — Investor View</h1>
          <p className="text-sm text-gray-500">
            Summary-range • cash flow • DSCR
          </p>
          {meta.from && meta.to && (
            <p className="text-xs text-gray-400 mt-1">
              Period: {meta.from} → {meta.to} • {meta.currency || "UZS"}
            </p>
          )}
        </div>

        <div className="ml-auto flex flex-wrap gap-2">
          <div>
            <label className="block text-xs text-gray-500">Months</label>
            <select
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              className="border rounded px-2 py-1"
            >
              {[6, 9, 12, 18, 24].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-500">End (YYYY-MM)</label>
            <input
              type="month"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="border rounded px-2 py-1"
            />
          </div>

          <button
            onClick={load}
            className="h-9 mt-4 px-4 rounded bg-black text-white"
          >
            Refresh
          </button>

          <button
            onClick={handleExportCsv}
            disabled={!rows.length}
            className="h-9 mt-4 px-4 rounded border border-black/20 bg-white hover:bg-gray-50 disabled:opacity-50"
            title="Export CSV (Excel)"
          >
            Export CSV
          </button>

          <button
            onClick={handlePrintPdf}
            className="h-9 mt-4 px-4 rounded border border-black/20 bg-white hover:bg-gray-50"
            title="Print / Save as PDF"
          >
            Print / PDF
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded no-print">
          {error}
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 print-box">
        <Kpi title="Revenue" value={fmt(totals.revenue)} />
        <Kpi title="COGS" value={fmt(totals.cogs)} />
        <Kpi title="Gross Profit" value={fmt(grossProfit)} sub={pct(grossProfit, totals.revenue)} />
        <Kpi title="OPEX" value={fmt(totals.opex)} />
        <Kpi title="Cash Flow" value={fmt(totals.cashFlow)} />
        <Kpi
          title="DSCR"
          value={
            totals.avgDscr == null
              ? "—"
              : `${totals.avgDscr} (min ${totals.minDscr})`
          }
        />
      </div>

      {/* Table */}
      <div className="overflow-auto border rounded print-box">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <Th>Month</Th>
              <Th>Revenue</Th>
              <Th>COGS</Th>
              <Th>Payroll</Th>
              <Th>OPEX</Th>
              <Th>Net Operating</Th>
              <Th>Cash Flow</Th>
              <Th>DSCR</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month} className="border-t">
                <Td>{monthLabel(r.month)}</Td>
                <Td>{fmt(r.revenue)}</Td>
                <Td>{fmt(r.cogs)}</Td>
                <Td>{fmt(r.payroll)}</Td>
                <Td>{fmt(r.opex)}</Td>
                <Td className={toNum(r.netOperating) < 0 ? "text-red-600 font-medium" : ""}>
                  {fmt(r.netOperating)}
                </Td>
                <Td>{fmt(r.cashFlow)}</Td>
                <Td>
                  {r.dscr == null ? (
                    "—"
                  ) : toNum(r.dscr) < 1 ? (
                    <span className="text-red-600 font-medium">{r.dscr}</span>
                  ) : (
                    r.dscr
                  )}
                </Td>
              </tr>
            ))}

            {!rows.length && !loading && (
              <tr>
                <Td colSpan={8} className="text-center text-gray-400 py-6">
                  No data
                </Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {loading && <div className="text-sm text-gray-500 no-print">Loading…</div>}

      {/* Print footer note */}
      <div className="hidden print:block text-xs text-gray-500">
        Dona’s Dosas — Investor Summary • {meta.from || ""} → {meta.to || ""} • Currency: {meta.currency || "UZS"}
      </div>
    </div>
  );
}

/* ================= helpers ================= */

function Kpi({ title, value, sub }) {
  return (
    <div className="border rounded p-3">
      <div className="text-xs text-gray-500">{title}</div>
      <div className="text-lg font-semibold">{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  );
}

function Th({ children }) {
  return (
    <th className="px-3 py-2 text-left font-medium text-gray-600">
      {children}
    </th>
  );
}

function Td({ children, colSpan, className = "" }) {
  return (
    <td colSpan={colSpan} className={`px-3 py-2 whitespace-nowrap ${className}`}>
      {children}
    </td>
  );
}
