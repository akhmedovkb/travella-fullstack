// frontend/src/pages/admin/DonasInvestor.jsx
import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../../api";

/**
 * Investor view:
 * - reads settings + months snapshot (already calculated on server)
 * - computes derived metrics: GP, EBITDA/NetOp, cashFlow, DSCR, runway
 * - supports public share token generation
 */

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n) {
  const v = Math.round(toNum(n));
  return v.toLocaleString("ru-RU");
}

function ymStr(x) {
  const s = String(x || "");
  if (!s) return "";
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  return s;
}

function clamp(n, a, b) {
  const x = toNum(n);
  return Math.min(b, Math.max(a, x));
}

function calcRow(m) {
  const revenue = toNum(m.revenue);
  const cogs = toNum(m.cogs);
  const opex = toNum(m.opex);
  const capex = toNum(m.capex);
  const loan = toNum(m.loan_paid);
  const cashEnd = toNum(m.cash_end);

  const gross = revenue - cogs;
  // EBITDA (упрощённо для Dona’s Dosas): Revenue - COGS - OPEX
  // (в этой модели это то же самое, что NetOp)
  const ebitda = gross - opex;
  const netOp = ebitda;
  const cashFlow = netOp - loan - capex;

  return {
    revenue,
    cogs,
    opex,
    capex,
    loan,
    cashEnd,
    gross,
    ebitda,
    netOp,
    cashFlow,
  };
}

function computeDerived(months, settings) {
  const currency = String(settings?.currency || "UZS").toUpperCase();
  const cashStart = toNum(settings?.cash_start);
  const reserveTarget = Math.max(0, toNum(settings?.reserve_target_months));
  const loanPaymentDefault = toNum(settings?.loan_payment_month);

  const rows = (Array.isArray(months) ? months : []).map((m) => ({ ...m }));

  // Attach calculations (DSCR, runway, etc.)
  for (const r of rows) {
    const c = calcRow(r);

    // DSCR: EBITDA / LoanPayment (if loan_paid==0, fallback to settings.loan_payment_month)
    const denom = c.loan > 0 ? c.loan : loanPaymentDefault > 0 ? loanPaymentDefault : 0;
    const dscr = denom > 0 ? c.netOp / denom : null;

    // Runway: how many months you can survive at avg burn rate (opex+loan or cashFlow)
    // In your UI: runway uses (opex+loan) average as burn basis
    const burn = Math.max(0, c.opex + (c.loan > 0 ? c.loan : loanPaymentDefault));
    const runway = burn > 0 ? c.cashEnd / burn : null;

    r._calc = {
      ...c,
      dscr,
      runway,
      denom,
      currency,
      cashStart,
      reserveTarget,
      loanPaymentDefault,
    };
  }

  // Alerts (simple)
  const alerts = [];
  const last = rows[rows.length - 1];

  if (last) {
    const { cashEnd, dscr, runway } = last._calc || {};

    if (toNum(cashEnd) <= 0) {
      alerts.push({
        title: "cash_end ≤ 0",
        text: "Денежный остаток не положительный — нужен план действий.",
      });
    }

    if (runway != null && reserveTarget > 0 && runway < reserveTarget) {
      alerts.push({
        title: "Runway ниже цели",
        text: `Runway=${(runway * 100).toFixed(1)}%, target=${reserveTarget}м.`,
      });
    }

    if (dscr != null && dscr < 1) {
      alerts.push({
        title: "DSCR < 1",
        text: `DSCR=${dscr.toFixed(2)}. Это значит EBITDA (операционная прибыль) не покрывает платёж по займу.`,
      });
    }
  }

  return { rows, alerts, currency };
}

function Kpi({ title, value, sub, right }) {
  return (
    <div className="rounded-2xl border bg-white px-4 py-3 shadow-sm flex items-center justify-between gap-4">
      <div>
        <div className="text-xs text-gray-500">{title}</div>
        <div className="text-xl font-semibold">{value}</div>
        {sub ? <div className="mt-1 text-xs text-gray-500">{sub}</div> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

export default function DonasInvestor() {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [error, setError] = useState("");

  const [settings, setSettings] = useState(null);
  const [months, setMonths] = useState([]);

  const [fromYm, setFromYm] = useState("2025-12");
  const [toYm, setToYm] = useState("2026-03");
  const [ttlHours, setTtlHours] = useState(168);
  const [publicLink, setPublicLink] = useState("");

  const shareToken =
    (typeof window !== "undefined" && window.location
      ? new URLSearchParams(window.location.search).get("t")
      : null) || null;

  const isPublic = !!shareToken;

  async function load() {
    setLoading(true);
    setError("");
    try {
      if (isPublic) {
        const r = await apiGet(
          `/api/public/donas/summary-range-token?t=${encodeURIComponent(shareToken)}`,
          false
        );

        setSettings(r?.settings || null);
        setMonths(Array.isArray(r?.months) ? r.months : []);
        return;
      }

      // admin mode
      const s = await apiGet("/api/admin/donas/finance/settings", "admin");
      setSettings(s || null);

      const ms = await apiGet("/api/admin/donas/finance/months", "admin");
      const arr = Array.isArray(ms) ? ms : Array.isArray(ms?.months) ? ms.months : [];
      setMonths(arr);
    } catch (e) {
      console.error("[DonasInvestor] load error:", e);
      setError(e?.message || "Не удалось загрузить данные Investor");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { rows, alerts, currency } = useMemo(
    () => computeDerived(months, settings),
    [months, settings]
  );

  const last = rows?.length ? rows[rows.length - 1] : null;

  // Auto-forecast runway (simple): based on avg cashFlow (last 3 months) or avg burn (opex+loan)
  const forecast = useMemo(() => {
    if (!rows?.length) return null;

    const last3 = rows.slice(Math.max(0, rows.length - 3));
    const avgCf =
      last3.reduce((acc, r) => acc + toNum(r._calc?.cashFlow), 0) /
      Math.max(1, last3.length);

    const avgBurn =
      last3.reduce((acc, r) => {
        const c = r._calc || {};
        const loan = toNum(c.loan) > 0 ? toNum(c.loan) : toNum(c.loanPaymentDefault);
        return acc + Math.max(0, toNum(c.opex) + loan);
      }, 0) / Math.max(1, last3.length);

    const cashEnd = toNum(last?._calc?.cashEnd);

    const monthsToZero = avgCf < 0 ? cashEnd / Math.abs(avgCf) : null;

    const target = Math.max(0, toNum(settings?.reserve_target_months));
    const targetDrop = avgBurn > 0 ? (cashEnd - target * avgBurn) / avgBurn : null;

    // Build projection next 6 months: cash_end + avgCf
    const proj = [];
    let cur = cashEnd;
    for (let i = 1; i <= 6; i++) {
      cur = cur + avgCf;
      proj.push({ i, cash: cur, runway: avgBurn > 0 ? cur / avgBurn : null });
    }

    return {
      avgCf,
      avgBurn,
      monthsToZero,
      target,
      targetDrop,
      proj,
    };
  }, [rows, settings, last]);

async function generatePublicLink() {
  setBusy(true);
  try {
    const payload = {
      // backend ждёт ISO-даты, поэтому добавляем "-01"
      from: `${ymStr(fromYm)}-01`,
      to: `${ymStr(toYm)}-01`,
      ttl_hours: clamp(ttlHours, 1, 24 * 60), // до 60 дней (как в backend)
      slug: "donas-dosas",
    };

    // ✅ правильный endpoint в твоём backend
    const r = await apiPost("/api/admin/donas/share-token", payload, "admin");

    const token = r?.token || "";
    const base =
      (typeof window !== "undefined" && window.location ? window.location.origin : "") || "";

    // backend уже может вернуть готовую ссылку (url)
    const link = r?.url
      ? r.url
      : token
      ? `${base}/public/donas/investor?t=${encodeURIComponent(token)}`
      : "";

    setPublicLink(link);
  } catch (e) {
    console.error("[DonasInvestor] generate link error:", e);
    setError(e?.message || "Не удалось сгенерировать ссылку");
  } finally {
    setBusy(false);
  }
}

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-2xl border bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div>
        <div className="text-sm text-gray-500">Admin</div>
        <div className="text-2xl font-bold">Dona’s Dosas — Investor</div>
        <div className="text-sm text-gray-500">
          Admin view: DSCR / runway / cash_end · plan/fact на базе actuals
        </div>
      </div>

      {/* Alerts */}
      {alerts?.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {alerts.map((a, idx) => (
            <div key={idx} className="rounded-2xl border bg-red-50 px-4 py-3">
              <div className="font-semibold text-red-700">{a.title}</div>
              <div className="text-sm text-red-700">{a.text}</div>
            </div>
          ))}
        </div>
      ) : null}

      {/* KPIs */}
      <div className="grid gap-3 md:grid-cols-3">
        <Kpi
          title="Last month cash_end"
          value={last ? `${fmt(last._calc.cashEnd)} ${currency}` : "—"}
          sub={
            last && last._calc.runway != null
              ? `Runway: ${last._calc.runway.toFixed(1)} mo`
              : last
              ? "Runway: —"
              : ""
          }
          right={
            <div className="h-[44px] w-[220px] rounded-lg border bg-white px-2 py-1 text-[11px] text-gray-500 flex items-center">
              runway ~ cash_end / (opex + loan)
            </div>
          }
        />

        <Kpi
          title="Last month EBITDA"
          value={last ? `${fmt(last._calc.ebitda)} ${currency}` : "—"}
          sub={last ? `DSCR: ${last._calc.dscr == null ? "—" : last._calc.dscr.toFixed(2)}` : ""}
          right={
            <div className="h-[44px] w-[220px] rounded-lg border bg-white px-2 py-1 text-[11px] text-gray-500 flex items-center">
              EBITDA = revenue − cogs − opex
            </div>
          }
        />

        <Kpi
          title="3-mo avg (cashflow / DSCR median)"
          value={
            forecast
              ? `${fmt(forecast.avgCf)} ${currency} · DSCR ${(() => {
                  const ds = rows
                    .slice(Math.max(0, rows.length - 3))
                    .map((r) => r._calc?.dscr)
                    .filter((x) => x != null)
                    .sort((a, b) => a - b);
                  if (!ds.length) return "—";
                  const mid = Math.floor(ds.length / 2);
                  return ds.length % 2
                    ? ds[mid].toFixed(2)
                    : ((ds[mid - 1] + ds[mid]) / 2).toFixed(2);
                })()}`
              : "—"
          }
          sub={
            forecast && forecast.monthsToZero != null
              ? `months to zero (если CF<0): ${forecast.monthsToZero.toFixed(1)} mo`
              : "months to zero (если CF<0): —"
          }
          right={
            <div className="h-[44px] w-[220px] rounded-lg border bg-white px-2 py-1 text-[11px] text-gray-500 flex items-center">
              avg(opex+loan): {forecast ? `${fmt(forecast.avgBurn)} ${currency}` : "—"}
            </div>
          }
        />
      </div>

      {/* Forecast table */}
      {forecast ? (
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="text-lg font-semibold">Auto-forecast runway</div>
          <div className="text-sm text-gray-500">
            Если CF = avg(последние 3 месяца) · прогноз на 6 месяцев вперёд
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border bg-white px-4 py-3">
              <div className="text-xs text-gray-500">avg cashflow / month</div>
              <div className="text-xl font-semibold">
                {fmt(forecast.avgCf)} {currency}
              </div>
            </div>
            <div className="rounded-2xl border bg-white px-4 py-3">
              <div className="text-xs text-gray-500">avg (opex+loan) / month</div>
              <div className="text-xl font-semibold">
                {fmt(forecast.avgBurn)} {currency}
              </div>
            </div>
            <div className="rounded-2xl border bg-white px-4 py-3">
              <div className="text-xs text-gray-500">months to zero (если CF&lt;0)</div>
              <div className="text-xl font-semibold">
                {forecast.monthsToZero == null ? "—" : `${forecast.monthsToZero.toFixed(1)} mo`}
              </div>
            </div>
          </div>

          <div className="mt-4 text-sm text-gray-500">
            Target runway: {forecast.target} mo · est. months to drop below target:{" "}
            {forecast.targetDrop == null ? "—" : `${forecast.targetDrop.toFixed(1)} mo`}
          </div>

          <div className="mt-3 overflow-auto">
            <table className="min-w-[720px] w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-2 pr-4">+month</th>
                  <th className="py-2 pr-4">Cash end</th>
                  <th className="py-2 pr-4">Runway</th>
                </tr>
              </thead>
              <tbody>
                {forecast.proj.map((p) => (
                  <tr key={p.i} className="border-t">
                    <td className="py-2 pr-4">+{p.i}</td>
                    <td className="py-2 pr-4">
                      {fmt(p.cash)} {currency}
                    </td>
                    <td className="py-2 pr-4">
                      {p.runway == null ? "—" : `${p.runway.toFixed(1)} mo`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Public link */}
      {!isPublic ? (
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="text-lg font-semibold">Public share link (token)</div>
          <div className="text-sm text-gray-500">
            Сгенерируй токен на диапазон месяцев. Ссылка будет работать без логина.
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <div>
              <div className="text-xs text-gray-500">From (YYYY-MM)</div>
              <input
                className="mt-1 w-full rounded-xl border px-3 py-2"
                value={fromYm}
                onChange={(e) => setFromYm(e.target.value)}
              />
            </div>
            <div>
              <div className="text-xs text-gray-500">To (YYYY-MM)</div>
              <input
                className="mt-1 w-full rounded-xl border px-3 py-2"
                value={toYm}
                onChange={(e) => setToYm(e.target.value)}
              />
            </div>
            <div>
              <div className="text-xs text-gray-500">TTL_hours</div>
              <input
                className="mt-1 w-full rounded-xl border px-3 py-2"
                value={ttlHours}
                onChange={(e) => setTtlHours(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <button
                className="w-full rounded-xl bg-black px-4 py-2 text-white disabled:opacity-50"
                onClick={generatePublicLink}
                disabled={busy || loading}
              >
                {busy ? "Generating..." : "Generate link"}
              </button>
            </div>
          </div>

          {publicLink ? (
            <div className="mt-4 rounded-xl border bg-gray-50 p-3">
              <div className="text-xs text-gray-500">Link</div>
              <div className="break-all text-sm">{publicLink}</div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Months */}
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">Months</div>
          <button
            className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            onClick={load}
            disabled={loading}
          >
            Refresh
          </button>
        </div>

        <div className="mt-2 text-xs text-gray-500">
          Формулы: GP=revenue−cogs · EBITDA=GP−opex · CF=EBITDA−loan−capex · DSCR=EBITDA/loan · Runway=cash_end/(opex+loan)
        </div>

        <div className="mt-4 overflow-auto">
          <table className="min-w-[1100px] w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-2 pr-4">Month</th>
                <th className="py-2 pr-4">Revenue</th>
                <th className="py-2 pr-4">COGS</th>
                <th className="py-2 pr-4">OPEX</th>
                <th className="py-2 pr-4">CAPEX</th>
                <th className="py-2 pr-4">Loan</th>
                <th className="py-2 pr-4">EBITDA</th>
                <th className="py-2 pr-4">CF</th>
                <th className="py-2 pr-4">DSCR</th>
                <th className="py-2 pr-4">Cash end</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const month = ymStr(m.month);
                const c = m._calc || {};
                return (
                  <tr key={month} className="border-t">
                    <td className="py-2 pr-4">{month}</td>
                    <td className="py-2 pr-4">
                      {fmt(c.revenue)} {currency}
                    </td>
                    <td className="py-2 pr-4">
                      {fmt(c.cogs)} {currency}
                    </td>
                    <td className="py-2 pr-4">
                      {fmt(c.opex)} {currency}
                    </td>
                    <td className="py-2 pr-4">
                      {fmt(c.capex)} {currency}
                    </td>
                    <td className="py-2 pr-4">
                      {fmt(c.loan)} {currency}
                    </td>
                    <td
                      className={`py-2 pr-4 ${
                        toNum(c.ebitda) >= 0 ? "text-green-700" : "text-red-700"
                      }`}
                    >
                      {fmt(c.ebitda)} {currency}
                    </td>
                    <td
                      className={`py-2 pr-4 ${
                        toNum(c.cashFlow) >= 0 ? "text-green-700" : "text-red-700"
                      }`}
                    >
                      {fmt(c.cashFlow)} {currency}
                    </td>
                    <td className="py-2 pr-4">
                      {c.dscr == null ? "—" : c.dscr.toFixed(2)}
                    </td>
                    <td className="py-2 pr-4 font-semibold">
                      {fmt(c.cashEnd)} {currency}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td className="py-4 text-gray-500" colSpan={10}>
                    {loading ? "Loading..." : "No months"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 text-xs text-gray-400">
          cash_start: {fmt(settings?.cash_start)} {currency} · reserve_target_months:{" "}
          {toNum(settings?.reserve_target_months)}
        </div>
      </div>
    </div>
  );
}
