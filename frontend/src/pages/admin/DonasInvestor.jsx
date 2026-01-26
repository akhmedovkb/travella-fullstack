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

function fmt(n) {
  const v = Number(n || 0);
  return v.toLocaleString("ru-RU");
}

function pct(a, b) {
  if (!b) return "—";
  return ((a / b) * 100).toFixed(1) + "%";
}

function monthLabel(ym) {
  // YYYY-MM → MM.YYYY
  if (!ym) return "";
  const [y, m] = ym.split("-");
  return `${m}.${y}`;
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

  const totals = data?.totals || {};
  const rows = data?.months || [];

  const grossProfit = useMemo(
    () => (totals.revenue || 0) - (totals.cogs || 0),
    [totals]
  );

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Dona’s Dosas — Investor View</h1>
          <p className="text-sm text-gray-500">
            Summary-range • cash flow • DSCR
          </p>
        </div>

        <div className="ml-auto flex gap-2">
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
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded">
          {error}
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Kpi title="Revenue" value={fmt(totals.revenue)} />
        <Kpi title="COGS" value={fmt(totals.cogs)} />
        <Kpi
          title="Gross Profit"
          value={fmt(grossProfit)}
          sub={pct(grossProfit, totals.revenue)}
        />
        <Kpi title="OPEX" value={fmt(totals.opex)} />
        <Kpi title="Cash Flow" value={fmt(totals.cashFlow)} />
        <Kpi
          title="DSCR"
          valu
