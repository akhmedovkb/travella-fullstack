// frontend/src/pages/admin/DonasInvestor.jsx

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { apiGet, apiPost } from "../../api";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n) {
  const v = Math.round(toNum(n));
  return v.toLocaleString("ru-RU");
}

function monthKey(iso) {
  return String(iso || "").slice(0, 7);
}

function ymToIso(ym) {
  const s = String(ym || "").trim();
  if (!/^\d{4}-\d{2}$/.test(s)) return null;
  return `${s}-01`;
}

function calcRow(m) {
  const revenue = toNum(m.revenue);
  const cogs = toNum(m.cogs);
  const opex = toNum(m.opex);
  const capex = toNum(m.capex);
  const loan = toNum(m.loan_paid);
  const cashEnd = toNum(m.cash_end);

  const gross = revenue - cogs;
  const netOp = gross - opex;
  const cashFlow = netOp - loan - capex;
  const dscr = loan > 0 ? netOp / loan : null;

  const denom = opex + loan;
  const runway = denom > 0 ? cashEnd / denom : null;

  return { revenue, cogs, opex, capex, loan, cashEnd, gross, netOp, cashFlow, dscr, runway };
}

function avg(list, key) {
  const arr = (list || []).map((x) => toNum(x?.[key])).filter((x) => Number.isFinite(x));
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export default function DonasInvestor() {
  const loc = useLocation();
  const isPublicPath = String(loc?.pathname || "").startsWith("/public/");
  const params = useMemo(() => new URLSearchParams(loc.search || ""), [loc.search]);
  const t = params.get("t") || "";

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [settings, setSettings] = useState(null);
  const [months, setMonths] = useState([]);
  const [meta, setMeta] = useState(null);

  // share UI (admin only)
  const [shareFrom, setShareFrom] = useState("");
  const [shareTo, setShareTo] = useState("");
  const [ttlHours, setTtlHours] = useState("168"); // 7 days
  const [shareToken, setShareToken] = useState("");

  const currency = settings?.currency || "UZS";

  const loadAdmin = async () => {
    setErr("");
    setLoading(true);
    try {
      const s = await apiGet("/api/admin/donas/finance/settings", "provider");
      const m = await apiGet("/api/admin/donas/finance/months", "provider");
      setSettings(s || null);
      setMonths(Array.isArray(m) ? m : []);
      setMeta({ mode: "admin" });
    } catch (e) {
      setErr(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  const loadPublicByToken = async (token) => {
    setErr("");
    setLoading(true);
    try {
      const r = await apiGet(
        `/api/public/donas/summary-range-token?t=${encodeURIComponent(token)}`,
        false
      );
      // ожидаем { meta, settings, months, totals }
      setMeta(r?.meta || null);
      setSettings(r?.settings || null);
      setMonths(Array.isArray(r?.months) ? r.months : []);
    } catch (e) {
      setErr(e?.message || "Failed to load public investor view");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isPublicPath) {
      if (!t) {
        setLoading(false);
        setErr("Нет токена. Открой ссылку вида /public/donas/investor?t=TOKEN");
        return;
      }
      loadPublicByToken(t);
      return;
    }

    // admin mode
    loadAdmin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPublicPath, t]);

  const sortedMonths = useMemo(() => {
    return [...(months || [])].sort((a, b) => String(a.month).localeCompare(String(b.month)));
  }, [months]);

  // defaults for share range from months
  useEffect(() => {
    if (isPublicPath) return;
    if (!sortedMonths.length) return;

    const last = sortedMonths[sortedMonths.length - 1];
    const firstIdx = Math.max(0, sortedMonths.length - 6);
    const first = sortedMonths[firstIdx];

    if (!shareTo) setShareTo(monthKey(last.month));
    if (!shareFrom) setShareFrom(monthKey(first.month));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedMonths.length, isPublicPath]);

  const rows = useMemo(() => {
    return sortedMonths.map((m) => {
      const c = calcRow(m);
      return { ...m, _calc: c };
    });
  }, [sortedMonths]);

  const last = rows.length ? rows[rows.length - 1] : null;

  const last3 = useMemo(() => {
    const tail = rows.slice(Math.max(0, rows.length - 3));
    return {
      revenue: avg(tail.map((x) => x._calc), "revenue"),
      cogs: avg(tail.map((x) => x._calc), "cogs"),
      opex: avg(tail.map((x) => x._calc), "opex"),
      netOp: avg(tail.map((x) => x._calc), "netOp"),
      cashFlow: avg(tail.map((x) => x._calc), "cashFlow"),
      dscr: avg(tail.map((x) => x._calc), "dscr"),
    };
  }, [rows]);

  const makeShare = async () => {
    setErr("");
    setShareToken("");
    try {
      const fromIso = ymToIso(shareFrom);
      const toIso = ymToIso(shareTo);
      if (!fromIso || !toIso) throw new Error("Неверный формат месяца. Нужно YYYY-MM");

      const ttl = Math.max(1, Math.floor(toNum(ttlHours || 0)));
      const body = {
        slug: "donas-dosas",
        from: fromIso,
        to: toIso,
        ttl_hours: ttl,
      };

      const r = await apiPost("/api/admin/donas/share-token", body, "provider");
      const token = r?.token || r?.t || "";
      if (!token) throw new Error("Не вернулся token от сервера");
      setShareToken(token);
    } catch (e) {
      setErr(e?.message || "Failed to create share token");
    }
  };

  const shareUrl = useMemo(() => {
    if (!shareToken) return "";
    return `${window.location.origin}/public/donas/investor?t=${encodeURIComponent(shareToken)}`;
  }, [shareToken]);

  if (loading) return <div className="p-4">Loading…</div>;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dona’s Dosas — Investor</h1>
          <p className="text-sm text-gray-600">
            {isPublicPath ? "Public view (tokenized)" : "Admin view"} · DSCR / runway / cash_end · plan/fact на базе actuals
          </p>
          {meta?.slug && (
            <div className="mt-1 text-xs text-gray-500">
              slug: <span className="font-mono">{meta.slug}</span>
              {meta?.from && meta?.to ? (
                <span className="ml-2">
                  · range: <span className="font-mono">{meta.from}</span> →{" "}
                  <span className="font-mono">{meta.to}</span>
                </span>
              ) : null}
            </div>
          )}
        </div>

        {!isPublicPath && (
          <button onClick={loadAdmin} className="px-3 py-2 rounded-lg bg-white border">
            Refresh
          </button>
        )}
      </div>

      {err && (
        <div className="mt-3 p-3 rounded-lg bg-red-50 text-red-700 border border-red-200">
          {err}
        </div>
      )}

      {/* TOP KPI */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Kpi
          title={`Last month cash_end (${last ? monthKey(last.month) : "—"})`}
          value={last ? `${fmt(last._calc.cashEnd)} ${currency}` : "—"}
          sub={
            last
              ? `Runway: ${last._calc.runway == null ? "—" : `${last._calc.runway.toFixed(1)} mo`}`
              : ""
          }
        />
        <Kpi
          title="Last month Net Operating"
          value={last ? `${fmt(last._calc.netOp)} ${currency}` : "—"}
          sub={last ? `DSCR: ${last._calc.dscr == null ? "—" : last._calc.dscr.toFixed(2)}` : ""}
        />
        <Kpi
          title="3-mo avg (NetOp / DSCR)"
          value={
            last3.netOp == null
              ? "—"
              : `${fmt(last3.netOp)} ${currency} · DSCR ${last3.dscr == null ? "—" : last3.dscr.toFixed(2)}`
          }
          sub={
            last3.cashFlow == null ? "" : `3-mo avg cashflow: ${fmt(last3.cashFlow)} ${currency}`
          }
        />
      </div>

      {/* SHARE TOKEN (admin only) */}
      {!isPublicPath && (
        <div className="mt-4 rounded-2xl bg-white border p-4">
          <h2 className="font-semibold">Public share link (token)</h2>
          <div className="text-xs text-gray-500 mt-1">
            Сгенерируй токен на диапазон месяцев. Ссылка будет работать без логина.
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-3">
            <Field label="From (YYYY-MM)" value={shareFrom} onChange={setShareFrom} />
            <Field label="To (YYYY-MM)" value={shareTo} onChange={setShareTo} />
            <Field label="TTL hours" value={ttlHours} onChange={setTtlHours} />
            <div className="flex items-end">
              <button onClick={makeShare} className="w-full px-3 py-2 rounded-lg bg-gray-900 text-white">
                Generate link
              </button>
            </div>
          </div>

          {shareUrl && (
            <div className="mt-3 rounded-xl border bg-gray-50 p-3">
              <div className="text-xs text-gray-600">Share URL</div>
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                <input
                  readOnly
                  value={shareUrl}
                  className="flex-1 min-w-[260px] px-3 py-2 rounded-lg border bg-white font-mono text-xs"
                />
                <button
                  onClick={() => navigator.clipboard.writeText(shareUrl)}
                  className="px-3 py-2 rounded-lg bg-white border"
                >
                  Copy
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TABLE */}
      <div className="mt-4 rounded-2xl bg-white border p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-semibold">Months</h2>
          <div className="text-xs text-gray-500">
            Формулы: GP=revenue−cogs · NetOp=GP−opex · CF=NetOp−loan−capex · DSCR=NetOp/loan · Runway=cash_end/(opex+loan)
          </div>
        </div>

        <div className="mt-3 overflow-auto">
          <table className="min-w-[1200px] w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600">
                <th className="py-2 pr-2">Month</th>
                <th className="py-2 pr-2">Revenue</th>
                <th className="py-2 pr-2">COGS</th>
                <th className="py-2 pr-2">OPEX</th>
                <th className="py-2 pr-2">CAPEX</th>
                <th className="py-2 pr-2">Loan</th>
                <th className="py-2 pr-2">NetOp</th>
                <th className="py-2 pr-2">CF</th>
                <th className="py-2 pr-2">DSCR</th>
                <th className="py-2 pr-2">Cash end</th>
                <th className="py-2 pr-2">Runway</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const c = m._calc;
                return (
                  <tr key={String(m.month)} className="border-t">
                    <td className="py-2 pr-2 font-mono text-xs">{monthKey(m.month)}</td>
                    <td className="py-2 pr-2">{fmt(c.revenue)} {currency}</td>
                    <td className="py-2 pr-2">{fmt(c.cogs)} {currency}</td>
                    <td className="py-2 pr-2">{fmt(c.opex)} {currency}</td>
                    <td className="py-2 pr-2">{fmt(c.capex)} {currency}</td>
                    <td className="py-2 pr-2">{fmt(c.loan)} {currency}</td>
                    <td className={`py-2 pr-2 ${c.netOp >= 0 ? "text-green-700" : "text-red-700"}`}>
                      {fmt(c.netOp)} {currency}
                    </td>
                    <td className={`py-2 pr-2 ${c.cashFlow >= 0 ? "text-green-700" : "text-red-700"}`}>
                      {fmt(c.cashFlow)} {currency}
                    </td>
                    <td className="py-2 pr-2">{c.dscr == null ? "—" : c.dscr.toFixed(2)}</td>
                    <td className="py-2 pr-2">{fmt(c.cashEnd)} {currency}</td>
                    <td className="py-2 pr-2">{c.runway == null ? "—" : `${c.runway.toFixed(1)} mo`}</td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td className="py-4 text-gray-500" colSpan={11}>
                    Нет данных
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {settings && (
          <div className="mt-3 text-xs text-gray-500">
            cash_start: <b>{fmt(settings.cash_start)} {currency}</b>
            {settings?.reserve_target_months ? (
              <span className="ml-2">
                · reserve_target_months: <b>{settings.reserve_target_months}</b>
              </span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange }) {
  return (
    <label className="text-sm">
      <div className="text-gray-600 mb-1">{label}</div>
      <input
        value={value ?? ""}
        onChange={(e) => onChange?.(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border"
      />
    </label>
  );
}

function Kpi({ title, value, sub }) {
  return (
    <div className="rounded-2xl bg-white border p-4">
      <div className="text-xs text-gray-600">{title}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sub ? <div className="text-xs text-gray-500 mt-1">{sub}</div> : null}
    </div>
  );
}
