//frontend/src/pages/admin/DonasInvestor.jsx
import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../api";
import { useLocation } from "react-router-dom";

/**
 * Investor / Bank View (READ ONLY)
 * Источник данных:
 *  - Admin mode (без токена): /api/public/donas/summary-range?key=...&months=...&end=...
 *  - Token mode (с токеном ?t=...): /api/public/donas/summary-range-token?t=...
 *
 * Требует:
 *  - Admin mode: VITE_DONAS_PUBLIC_KEY в env фронта
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
  const [y, m] = String(ym).split("-");
  return `${m}.${y}`;
}

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export default function DonasInvestor() {
  const query = useQuery();
  const token = String(query.get("t") || "").trim();
  const isTokenMode = !!token;

  const [months, setMonths] = useState(12);
  const [end, setEnd] = useState(""); // YYYY-MM
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const publicKey = import.meta.env.VITE_DONAS_PUBLIC_KEY;

  async function load() {
    setLoading(true);
    setError("");
    try {
      // ✅ Token mode: без key
      if (isTokenMode) {
        const res = await apiGet(
          `/api/public/donas/summary-range-token?t=${encodeURIComponent(token)}`
        );
        setData(res);
        return;
      }

      // ✅ Admin mode: как было
      if (!publicKey) {
        setError("VITE_DONAS_PUBLIC_KEY not set");
        return;
      }

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
  }, [isTokenMode, token]);

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

        {/* controls: только в admin mode */}
        {!isTokenMode && (
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
        )}
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
          value={
            totals.avgDscr == null
              ? "—"
              : `${totals.avgDscr} (min ${totals.minDscr})`
          }
        />
      </div>

      {/* Table */}
      <div className="overflow-auto border rounded">
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
                <Td className={r.netOperating < 0 ? "text-red-600 font-medium" : ""}>
                  {fmt(r.netOperating)}
                </Td>
                <Td>{fmt(r.cashFlow)}</Td>
                <Td>
                  {r.dscr == null ? (
                    "—"
                  ) : r.dscr < 1 ? (
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

      {loading && <div className="text-sm text-gray-500">Loading…</div>}
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
