// frontend/src/pages/admin/DonasInvestor.jsx

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { apiGet, apiPost } from "../../api";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

// ВАЖНО: для KPI/median/avg нам иногда нужно "null", а не 0
function numOrNull(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
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

  // dscr должен быть null, если loan=0
  const dscr = loan > 0 ? netOp / loan : null;

  const denom = opex + loan;
  const runway = denom > 0 ? cashEnd / denom : null;

  return {
    revenue,
    cogs,
    opex,
    capex,
    loan,
    cashEnd,
    gross,
    netOp,
    cashFlow,
    dscr,
    runway,
    denom,
  };
}

function avg(list, pick) {
  const arr = (list || [])
    .map((x) => numOrNull(pick(x)))
    .filter((x) => x != null);
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function median(list, pick) {
  const arr = (list || [])
    .map((x) => numOrNull(pick(x)))
    .filter((x) => x != null)
    .sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function buildForecast({ lastCashEnd, avgCashFlow, avgDenom, months = 6 }) {
  const out = [];
  let cash = toNum(lastCashEnd);
  for (let i = 1; i <= months; i++) {
    cash = cash + toNum(avgCashFlow);
    const runway = avgDenom > 0 ? cash / avgDenom : null;
    out.push({ step: i, cashEnd: cash, runway });
  }
  return out;
}

function badgeCls(kind) {
  if (kind === "red") return "bg-red-50 text-red-800 border-red-200";
  if (kind === "amber") return "bg-amber-50 text-amber-800 border-amber-200";
  if (kind === "green") return "bg-green-50 text-green-800 border-green-200";
  return "bg-gray-50 text-gray-800 border-gray-200";
}

function SparkLine({ points, height = 44 }) {
  const w = 220;
  const h = height;

  // ВАЖНО: игнорируем null/NaN, не превращаем в 0
  const safe = Array.isArray(points) ? points.map((p) => numOrNull(p)).filter((x) => x != null) : [];

  if (!safe.length) {
    return (
      <div className="h-[44px] w-[220px] rounded-lg border bg-gray-50 flex items-center justify-center text-xs text-gray-500">
        —
      </div>
    );
  }

  const min = Math.min(...safe);
  const max = Math.max(...safe);
  const pad = 6;

  const scaleX = (i) => {
    if (safe.length === 1) return w / 2;
    return pad + (i * (w - pad * 2)) / (safe.length - 1);
  };

  const scaleY = (v) => {
    if (max === min) return h / 2;
    const t = (v - min) / (max - min);
    return h - pad - t * (h - pad * 2);
  };

  const d = safe.map((v, i) => `${scaleX(i)},${scaleY(v)}`).join(" ");

  return (
    <svg width={w} height={h} className="rounded-lg border bg-white">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        points={d}
        className="text-gray-900"
      />
      <circle
        cx={scaleX(safe.length - 1)}
        cy={scaleY(safe[safe.length - 1])}
        r="3"
        className="fill-gray-900"
      />
    </svg>
  );
}

function normalizeMonths(resp) {
  if (Array.isArray(resp)) return resp;
  if (Array.isArray(resp?.months)) return resp.months;
  return [];
}

function normalizeSettings(resp) {
  // иногда apiGet может вернуть {settings:{...}} или просто {...}
  return (resp && (resp.settings || resp)) || null;
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
  const targetMonths = toNum(settings?.reserve_target_months || 0);

  const loadAdmin = async () => {
    setErr("");
    setLoading(true);
    try {
      const s = await apiGet("/api/admin/donas/finance/settings", "provider");
      const m = await apiGet("/api/admin/donas/finance/months", "provider");
      setSettings(normalizeSettings(s));
      setMonths(normalizeMonths(m));
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
      setMeta(r?.meta || null);
      setSettings(normalizeSettings(r?.settings));
      setMonths(normalizeMonths(r));
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

  const last3Tail = useMemo(() => rows.slice(Math.max(0, rows.length - 3)), [rows]);

  const last3 = useMemo(() => {
    const tail = last3Tail.map((x) => x._calc);
    return {
      netOp_avg: avg(tail, (x) => x.netOp),
      cashFlow_avg: avg(tail, (x) => x.cashFlow),
      denom_avg: avg(tail, (x) => x.denom), // opex + loan
      dscr_med: median(tail, (x) => x.dscr),
    };
  }, [last3Tail]);

  const alerts = useMemo(() => {
    const out = [];
    if (!last) return out;

    const dscr = last._calc.dscr;
    const runway = last._calc.runway;

    if (dscr != null && dscr < 1) {
      out.push({
        kind: "red",
        title: "DSCR ниже 1",
        text: `DSCR=${dscr.toFixed(2)}. Это значит NetOp не покрывает платёж по займу.`,
      });
    } else if (dscr != null && dscr < 1.2) {
      out.push({
        kind: "amber",
        title: "DSCR на грани",
        text: `DSCR=${dscr.toFixed(2)}. Лучше держать запас.`,
      });
    }

    if (targetMonths > 0 && runway != null && runway < targetMonths) {
      out.push({
        kind: "red",
        title: "Runway ниже цели",
        text: `Runway=${runway.toFixed(1)}м, target=${targetMonths}м.`,
      });
    }

    if (last._calc.cashEnd <= 0) {
      out.push({
        kind: "red",
        title: "cash_end ≤ 0",
        text: "Денежный остаток не положительный — нужен план действий.",
      });
    }

    if (!out.length) {
      out.push({
        kind: "green",
        title: "ОК",
        text: "Критических алертов нет (DSCR и runway в норме по текущим данным).",
      });
    }

    return out;
  }, [last, targetMonths]);

  // ВАЖНО: series не должны превращать null в 0
  const cashSeries = useMemo(() => rows.map((x) => numOrNull(x._calc.cashEnd)), [rows]);
  const runwaySeries = useMemo(() => rows.map((x) => numOrNull(x._calc.runway)), [rows]);

  const forecast = useMemo(() => {
    if (!last) return null;
    const avgCF = last3.cashFlow_avg;
    const avgDenom = last3.denom_avg;

    if (avgCF == null || avgDenom == null || avgDenom <= 0) return null;

    const proj = buildForecast({
      lastCashEnd: last._calc.cashEnd,
      avgCashFlow: avgCF,
      avgDenom,
      months: 6,
    });

    let monthsToZero = null;
    if (avgCF < 0) {
      const m = last._calc.cashEnd / Math.abs(avgCF);
      monthsToZero = Number.isFinite(m) ? m : null;
    }

    let monthsToTarget = null;
    if (targetMonths > 0) {
      const targetCash = avgDenom * targetMonths;
      if (avgCF < 0) {
        const m = (last._calc.cashEnd - targetCash) / Math.abs(avgCF);
        monthsToTarget = Number.isFinite(m) ? m : null;
      }
    }

    return {
      avgCF,
      avgDenom,
      proj,
      monthsToZero,
      monthsToTarget,
    };
  }, [last, last3, targetMonths]);

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
            {isPublicPath ? "Public view (tokenized)" : "Admin view"} · DSCR / runway / cash_end ·
            plan/fact на базе actuals
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

      {/* ALERTS */}
      <div className="mt-4 rounded-2xl bg-white border p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-semibold">Alerts</h2>
          <div className="text-xs text-gray-500">Правила: DSCR&lt;1 · runway&lt;target · cash_end≤0</div>
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          {alerts.map((a, idx) => (
            <div key={idx} className={`rounded-xl border p-3 ${badgeCls(a.kind)}`}>
              <div className="font-semibold">{a.title}</div>
              <div className="text-sm mt-1">{a.text}</div>
            </div>
          ))}
        </div>
      </div>

      {/* TOP KPI + CHARTS */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Kpi
          title={`Last month cash_end (${last ? monthKey(last.month) : "—"})`}
          value={last ? `${fmt(last._calc.cashEnd)} ${currency}` : "—"}
          sub={
            last
              ? `Runway: ${last._calc.runway == null ? "—" : `${last._calc.runway.toFixed(1)} mo`}`
              : ""
          }
          right={<SparkLine points={cashSeries} />}
        />
        <Kpi
          title="Last month Net Operating"
          value={last ? `${fmt(last._calc.netOp)} ${currency}` : "—"}
          sub={last ? `DSCR: ${last._calc.dscr == null ? "—" : last._calc.dscr.toFixed(2)}` : ""}
          right={
            <div className="h-[44px] w-[220px] rounded-lg border bg-gray-50 flex items-center justify-center text-xs text-gray-500">
              NetOp
            </div>
          }
        />
        <Kpi
          title="3-mo avg (cashflow / DSCR median)"
          value={
            last3.cashFlow_avg == null
              ? "—"
              : `${fmt(last3.cashFlow_avg)} ${currency} · DSCR ${
                  last3.dscr_med == null ? "—" : last3.dscr_med.toFixed(2)
                }`
          }
          sub={last3.denom_avg == null ? "" : `avg(opex+loan): ${fmt(last3.denom_avg)} ${currency}`}
          right={<SparkLine points={runwaySeries} />}
        />
      </div>

      {/* FORECAST */}
      <div className="mt-4 rounded-2xl bg-white border p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-semibold">Auto-forecast runway</h2>
          <div className="text-xs text-gray-500">
            Если CF = avg(последние 3 месяца) · прогноз на 6 месяцев вперёд
          </div>
        </div>

        {!forecast ? (
          <div className="mt-3 text-sm text-gray-500">
            Недостаточно данных для прогноза (нужны последние 3 месяца).
          </div>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
              <MiniKpi title="avg cashflow / month" value={`${fmt(forecast.avgCF)} ${currency}`} />
              <MiniKpi title="avg (opex+loan) / month" value={`${fmt(forecast.avgDenom)} ${currency}`} />
              <MiniKpi
                title="months to zero (если CF<0)"
                value={forecast.monthsToZero == null ? "—" : `${forecast.monthsToZero.toFixed(1)} mo`}
              />
            </div>

            {targetMonths > 0 && (
              <div className="mt-3 text-sm text-gray-700">
                Target runway: <b>{targetMonths} mo</b> · est. months to drop below target:{" "}
                <b>{forecast.monthsToTarget == null ? "—" : `${forecast.monthsToTarget.toFixed(1)} mo`}</b>
              </div>
            )}

            <div className="mt-3 overflow-auto">
              <table className="min-w-[700px] w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="py-2 pr-2">+month</th>
                    <th className="py-2 pr-2">Cash end</th>
                    <th className="py-2 pr-2">Runway</th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.proj.map((p) => (
                    <tr key={p.step} className="border-t">
                      <td className="py-2 pr-2">+{p.step}</td>
                      <td className="py-2 pr-2">
                        {fmt(p.cashEnd)} {currency}
                      </td>
                      <td className="py-2 pr-2">{p.runway == null ? "—" : `${p.runway.toFixed(1)} mo`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
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

function Kpi({ title, value, sub, right }) {
  return (
    <div className="rounded-2xl bg-white border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-gray-600">{title}</div>
          <div className="text-2xl font-semibold mt-1">{value}</div>
          {sub ? <div className="text-xs text-gray-500 mt-1">{sub}</div> : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
    </div>
  );
}

function MiniKpi({ title, value }) {
  return (
    <div className="rounded-xl border bg-gray-50 p-3">
      <div className="text-xs text-gray-600">{title}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
    </div>
  );
}
