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

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
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
  const [shareUrl, setShareUrl] = useState("");
  const [shareBusy, setShareBusy] = useState(false);

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
  async function createShareLink() {
    if (isTokenMode) return;
    setShareUrl("");
    setError("");
    setShareBusy(true);
    try {
      const auth =
        localStorage.getItem("token") ||
        localStorage.getItem("providerToken") ||
        "";

      const body = {
        months,
        end: end || undefined,
        ttl_days: 7,
      };

      const r = await fetch("/api/admin/donas/share-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setError(j?.error || "Failed to create share link");
        return;
      }
      setShareUrl(String(j.url || ""));
    } catch (e) {
      console.error(e);
      setError("Failed to create share link");
    } finally {
      setShareBusy(false);
    }
  }

  function handlePrintPdf() {
    // MVP bank-PDF: системная печать → "Save as PDF"
    window.print();
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTokenMode, token]);

  const meta = data?.meta || {};
  const totals = data?.totals || {};
  const rows = data?.months || [];

  const grossProfit = useMemo(
    () => (totals.revenue || 0) - (totals.cogs || 0),
    [totals]
  );

  const avgDscr = totals?.avgDscr == null ? null : safeNum(totals.avgDscr);
  const minDscr = totals?.minDscr == null ? null : safeNum(totals.minDscr);
  const riskDscr = Number.isFinite(minDscr) && minDscr > 0 && minDscr < 1;
  const riskCash = safeNum(totals.cashFlow) < 0;
  const showRisk = riskDscr || riskCash;
  return (
    <div className="p-6 space-y-6">
      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          header { display: none !important; }
          body { background: #fff !important; }
          .print-box { border: 1px solid #e5e7eb !important; }
          table { font-size: 12px !important; }
        }
      `}</style>

      {/* Header */}
      <div className="flex flex-wrap items-end gap-4 no-print">
        <div>
          <h1 className="text-2xl font-semibold">Dona’s Dosas — Investor View</h1>
          <p className="text-sm text-gray-500">
            Summary-range • cash flow • DSCR
          </p>
          {meta?.from && meta?.to && (
            <p className="text-xs text-gray-400 mt-1">
              Period: {meta.from} → {meta.to} • {meta.currency || "UZS"}
            </p>
          )}
        </div>

        {/* controls: только в admin mode */}
        {!isTokenMode && (
          <div className="ml-auto flex flex-wrap gap-2 items-end">
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
              onClick={createShareLink}
              disabled={shareBusy}
              className="h-9 mt-4 px-4 rounded border border-black/20 bg-white hover:bg-gray-50 disabled:opacity-50"
              title="Create share link (7 days)"
            >
              {shareBusy ? "Creating…" : "Share link"}
            </button>

            <button
              onClick={handlePrintPdf}
              className="h-9 mt-4 px-4 rounded border border-black/20 bg-white hover:bg-gray-50"
              title="Print / Save as PDF"
            >
              Print / PDF
            </button>
          </div>
        )}

        {/* token-mode: тоже даём PDF кнопку */}
        {isTokenMode && (
          <div className="ml-auto flex gap-2 items-end">
            <button
              onClick={handlePrintPdf}
              className="h-9 px-4 rounded border border-black/20 bg-white hover:bg-gray-50"
              title="Print / Save as PDF"
            >
              Print / PDF
            </button>
          </div>
        )}
      </div>
      {/* Share URL output */}
      {shareUrl && !isTokenMode && (
        <div className="p-3 border rounded bg-gray-50 no-print">
          <div className="text-xs text-gray-500 mb-1">Share URL (valid ~7 days)</div>
          <div className="flex gap-2 items-center">
            <input
              value={shareUrl}
              readOnly
              className="flex-1 border rounded px-2 py-1 bg-white text-sm"
            />
            <button
              onClick={() => navigator.clipboard.writeText(shareUrl)}
              className="px-3 py-1.5 rounded bg-black text-white text-sm"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {/* Risk flags */}
      {showRisk && (
        <div className="p-3 border rounded bg-yellow-50 border-yellow-200 text-yellow-800 no-print">
          <div className="font-semibold">Risk flags</div>
          <ul className="list-disc ml-5 text-sm mt-1">
            {riskDscr && <li>DSCR below 1.0 (min {minDscr?.toFixed ? minDscr.toFixed(2) : minDscr})</li>}
            {riskCash && <li>Negative total cash flow for the period</li>}
          </ul>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded no-print">
          {error}
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 print-box">
        <Kpi title="Revenue" value={fmt(totals.revenue)} />
        <Kpi title="COGS" value={fmt(totals.cogs)} />
        <Kpi
          title="Gross Profit"
          value={fmt(grossProfit)}
          sub={pct(grossProfit, totals.revenue)}
        />
        <Kpi title="OPEX" value={fmt(totals.opex)} />
        <Kpi
          title="Cash Flow"
          value={fmt(totals.cashFlow)}
          danger={safeNum(totals.cashFlow) < 0}
        />
        <Kpi
          title="DSCR"
          value={
            totals.avgDscr == null
              ? "—"
              : `${totals.avgDscr} (min ${totals.minDscr})`
          }
          danger={riskDscr}
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
                <Td>
                  <div className="flex items-center gap-2">
                    <span>{fmt(r.opex)}</span>
                    {r.opexSource && (
                      <span
                        className={[
                          "text-[10px] px-2 py-[2px] rounded-full border",
                          r.opexSource === "manual"
                            ? "bg-blue-50 border-blue-200 text-blue-700"
                            : "bg-gray-50 border-gray-200 text-gray-600",
                        ].join(" ")}
                        title={r.opexSource === "manual" ? "Manual OPEX (finance months)" : "Auto OPEX (settings + payroll)"}
                      >
                        {String(r.opexSource).toUpperCase()}
                      </span>
                    )}
                  </div>
                </Td>
                <Td className={r.netOperating < 0 ? "text-red-600 font-medium" : ""}>
                  {fmt(r.netOperating)}
                </Td>
                <Td className={safeNum(r.cashFlow) < 0 ? "text-red-600 font-medium" : ""}>
                  {fmt(r.cashFlow)}
                </Td>
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

      {loading && <div className="text-sm text-gray-500 no-print">Loading…</div>}

      {/* Print footer note */}
      <div className="hidden print:block text-xs text-gray-500">
        Dona’s Dosas — Investor Summary • {meta?.from || ""} → {meta?.to || ""} • Currency: {meta?.currency || "UZS"}
      </div>
    </div>
  );
}

/* ================= helpers ================= */

function Kpi({ title, value, sub, danger }) {
  return (
    <div className={`border rounded p-3 ${danger ? "border-red-300 bg-red-50" : ""}`}>
      <div className="text-xs text-gray-500">{title}</div>
      <div className={`text-lg font-semibold ${danger ? "text-red-700" : ""}`}>{value}</div>
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
