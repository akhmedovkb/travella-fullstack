// frontend/src/pages/admin/DonasInvestor.jsx
import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../../api";
import { tSuccess, tError, tInfo } from "../../shared/toast";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function money(n) {
  return Math.round(toNum(n)).toLocaleString("ru-RU");
}
function isYm(s) {
  return /^\d{4}-\d{2}$/.test(String(s || "").trim());
}
function ymToIsoMonthStart(ym) {
  const v = String(ym || "").trim();
  return isYm(v) ? `${v}-01` : "";
}
function clamp(n, a, b) {
  const v = toNum(n);
  return Math.min(b, Math.max(a, v));
}

export default function DonasInvestor() {
  const [months, setMonths] = useState([]);
  const [settings, setSettings] = useState(null);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [fromYm, setFromYm] = useState("2025-12");
  const [toYm, setToYm] = useState("2026-03");
  const [ttlHours, setTtlHours] = useState(168);
  const [error, setError] = useState("");
  const [publicToken, setPublicToken] = useState("");
  const [publicLink, setPublicLink] = useState("");

  const tokenFromUrl = useMemo(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      return String(sp.get("t") || "").trim();
    } catch {
      return "";
    }
  }, []);

  const isPublicView = useMemo(() => {
    const p = String(window.location.pathname || "");
    return Boolean(tokenFromUrl) || p.startsWith("/public/");
  }, [tokenFromUrl]);

  async function load() {
    setLoading(true);
    setError("");

    try {
      if (isPublicView) {
        if (!tokenFromUrl) {
          setMonths([]);
          setSettings(null);
          setError("Нет токена доступа (t)");
          return;
        }

        const r = await apiGet(
          `/api/public/donas/summary-range-token?t=${encodeURIComponent(tokenFromUrl)}`
        );

        const s = r?.settings || r?.data?.settings || null;
        const m = r?.months || r?.data?.months || [];
        setSettings(s);
        setMonths(Array.isArray(m) ? m : []);
        return;
      }

      // admin view
      const r = await apiGet("/api/admin/donas/finance/investor");
      const s =
        r?.settings ||
        r?.data?.settings ||
        r?.settings_row ||
        r?.data?.settings_row ||
        null;
      const m = r?.months || r?.data?.months || [];
      setSettings(s);
      setMonths(Array.isArray(m) ? m : []);
    } catch (e) {
      console.error("Investor load error:", e);
      setMonths([]);
      setSettings(null);
      const msg = isPublicView
        ? "Не удалось загрузить данные по публичной ссылке"
        : "Не удалось загрузить данные Investor";
      setError(msg);
      tError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generatePublicLink() {
    setBusy(true);
    setError("");

    try {
      const fromIso = ymToIsoMonthStart(fromYm);
      const toIso = ymToIsoMonthStart(toYm);

      if (!fromIso || !toIso) {
        setError("Неверный формат месяца. Используй YYYY-MM (например 2026-02)");
        tInfo("Проверь From/To: формат должен быть YYYY-MM");
        return;
      }

      const payload = {
        from: fromIso,
        to: toIso,
        ttl_hours: clamp(ttlHours, 1, 24 * 365),
      };

      // backend/routes/donasShareRoutes.js
      // POST /api/admin/donas/share-token
      const r = await apiPost("/api/admin/donas/share-token", payload);

      const token = r?.token || r?.data?.token || "";
      const url = r?.url || r?.data?.url || "";

      if (!token) throw new Error("token not returned");

      setPublicToken(token);
      setPublicLink(
        url || `${window.location.origin}/public/donas/investor?t=${encodeURIComponent(token)}`
      );

      tSuccess("Ссылка сгенерирована");
    } catch (e) {
      console.error("generatePublicLink error:", e);
      setError("Не удалось сгенерировать ссылку");
      tError("Не удалось сгенерировать ссылку");
    } finally {
      setBusy(false);
    }
  }

  const fmt0 = (n) => money(n);

  const last = useMemo(() => {
    const a = Array.isArray(months) ? months : [];
    if (!a.length) return null;
    return a[a.length - 1];
  }, [months]);

  const avg3 = useMemo(() => {
    const a = Array.isArray(months) ? months : [];
    if (!a.length) return { avg_cf: 0, avg_opex_loan: 0 };
    const last3 = a.slice(-3);
    const avg_cf = last3.reduce((s, x) => s + toNum(x.cf), 0) / Math.max(1, last3.length);
    const avg_opex_loan =
      last3.reduce((s, x) => s + (toNum(x.opex) + toNum(x.loan)), 0) / Math.max(1, last3.length);
    return { avg_cf, avg_opex_loan };
  }, [months]);

  const targetMonths = toNum(settings?.reserve_target_months) || 6;

  const runwayLabel = useMemo(() => {
    const cashEnd = toNum(last?.cash_end);
    const denom = toNum(avg3.avg_opex_loan);
    if (denom <= 0) return "—";
    return `${(cashEnd / denom).toFixed(1)} mo`;
  }, [last, avg3]);

  const dscrLabel = useMemo(() => {
    const ebitda = toNum(last?.ebitda);
    const loan = toNum(last?.loan);
    if (loan <= 0) return "—";
    return `${(ebitda / loan).toFixed(2)}`;
  }, [last]);

  const forecast = useMemo(() => {
    const cashEnd0 = toNum(last?.cash_end);
    const avgCf = toNum(avg3.avg_cf);
    const arr = [];
    for (let i = 1; i <= targetMonths; i++) {
      arr.push({ m: i, cash_end: cashEnd0 + avgCf * i });
    }
    return arr;
  }, [last, avg3, targetMonths]);

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Dona’s Dosas — Investor</h1>
          <p className="text-sm text-gray-600">
            {isPublicView
              ? "Public read-only view (по токену)"
              : "Admin view: DSCR / runway / cash_end · plan/fact на базе actuals"}
          </p>
        </div>

        <button
          type="button"
          className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50"
          onClick={load}
          disabled={loading || busy}
        >
          Refresh
        </button>
      </div>

      {/* Alerts */}
      {toNum(last?.cash_end) <= 0 && last ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-xl border bg-red-50 p-4 text-sm text-red-700">
            <div className="font-semibold">cash_end ≤ 0</div>
            Денежный остаток не положительный — нужен план действий.
          </div>
          <div className="rounded-xl border bg-red-50 p-4 text-sm text-red-700">
            <div className="font-semibold">Runway ниже цели</div>
            Runway={runwayLabel}, target={targetMonths}m.
          </div>
        </div>
      ) : null}

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs text-gray-500">Last month cash_end</div>
          <div className="text-lg font-semibold">{fmt0(last?.cash_end)} UZS</div>
          <div className="text-xs text-gray-500 mt-1">Runway: {runwayLabel}</div>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs text-gray-500">Last month EBITDA</div>
          <div className="text-lg font-semibold">{fmt0(last?.ebitda)} UZS</div>
          <div className="text-xs text-gray-500 mt-1">DSCR: {dscrLabel}</div>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs text-gray-500">3-mo avg (cashflow / DSCR median)</div>
          <div className="text-lg font-semibold">{fmt0(avg3.avg_cf)} UZS</div>
          <div className="text-xs text-gray-500 mt-1">
            avg(opex+loan): {fmt0(avg3.avg_opex_loan)} UZS
          </div>
        </div>
      </div>

      {/* Forecast */}
      <div className="rounded-2xl border bg-white p-4 space-y-3">
        <div>
          <div className="text-sm font-semibold">Auto-forecast runway</div>
          <div className="text-xs text-gray-500">
            Если CF = avg(последние 3 месяца) · прогноз на {targetMonths} месяцев вперед
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl border p-3">
            <div className="text-xs text-gray-500">avg cashflow / month</div>
            <div className="text-base font-semibold">{fmt0(avg3.avg_cf)} UZS</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-gray-500">avg (opex+loan) / month</div>
            <div className="text-base font-semibold">{fmt0(avg3.avg_opex_loan)} UZS</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-gray-500">months to zero (если CF&lt;0)</div>
            <div className="text-base font-semibold">
              {avg3.avg_cf < 0
                ? (toNum(last?.cash_end) / Math.abs(toNum(avg3.avg_cf))).toFixed(1)
                : "—"}{" "}
              mo
            </div>
          </div>
        </div>

        <div className="text-xs text-gray-500">
          Target runway: {targetMonths} mo · est. months to drop below target:{" "}
          {avg3.avg_cf < 0
            ? (
                (toNum(last?.cash_end) - toNum(avg3.avg_opex_loan) * targetMonths) /
                Math.abs(toNum(avg3.avg_cf))
              ).toFixed(1)
            : "—"}{" "}
          mo
        </div>

        <div className="overflow-auto border rounded-xl">
          <table className="min-w-[700px] w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-3 py-2">+month</th>
                <th className="text-right px-3 py-2">Cash end</th>
                <th className="text-right px-3 py-2">Runway</th>
              </tr>
            </thead>
            <tbody>
              {forecast.map((r) => (
                <tr key={r.m} className="border-t">
                  <td className="px-3 py-2">+{r.m}</td>
                  <td className="px-3 py-2 text-right">{fmt0(r.cash_end)} UZS</td>
                  <td className="px-3 py-2 text-right">
                    {toNum(avg3.avg_opex_loan) > 0
                      ? (r.cash_end / toNum(avg3.avg_opex_loan)).toFixed(1)
                      : "—"}{" "}
                    mo
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Public link generator (ADMIN ONLY) */}
      {!isPublicView && (
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-sm font-semibold">Public share link (token)</div>
          <div className="text-xs text-gray-500">
            Сгенерируй токен на диапазон месяцев. Ссылка будет работать без логина.
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
            <label className="text-xs text-gray-600">
              <div className="mb-1">From (YYYY-MM)</div>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={fromYm}
                onChange={(e) => setFromYm(e.target.value)}
                placeholder="2025-12"
                disabled={busy}
              />
            </label>

            <label className="text-xs text-gray-600">
              <div className="mb-1">To (YYYY-MM)</div>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={toYm}
                onChange={(e) => setToYm(e.target.value)}
                placeholder="2026-03"
                disabled={busy}
              />
            </label>

            <label className="text-xs text-gray-600">
              <div className="mb-1">TTL_hours</div>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={ttlHours}
                onChange={(e) => setTtlHours(e.target.value)}
                inputMode="numeric"
                disabled={busy}
              />
            </label>

            <div className="flex items-end">
              <button
                type="button"
                className="w-full px-4 py-2 rounded-lg bg-black text-white hover:bg-gray-900 disabled:opacity-50"
                onClick={generatePublicLink}
                disabled={busy}
              >
                {busy ? "..." : "Generate link"}
              </button>
            </div>
          </div>

          {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}

          {publicLink ? (
            <div className="mt-4 rounded-xl border bg-gray-50 p-3">
              <div className="text-xs text-gray-500">Link</div>
              <div className="break-all text-sm">{publicLink}</div>
              {publicToken ? (
                <div className="mt-2 text-[11px] text-gray-500">token: {publicToken}</div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {/* Errors (public/admin) */}
      {isPublicView && error ? (
        <div className="rounded-xl border bg-red-50 p-3 text-sm text-red-700">{error}</div>
      ) : null}

      {/* Months table */}
      <div className="rounded-2xl border bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Months</div>
            <div className="text-xs text-gray-500">
              формулы: GP=revenue-cogs · EBITDA=GP-opex · CF=EBITDA-loan-capex · DSCR=EBITDA/loan · Runway=cash_end/(opex+loan)
            </div>
          </div>
        </div>

        <div className="overflow-auto mt-3 border rounded-xl">
          <table className="min-w-[1100px] w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-3 py-2">Month</th>
                <th className="text-right px-3 py-2">Revenue</th>
                <th className="text-right px-3 py-2">COGS</th>
                <th className="text-right px-3 py-2">OPEX</th>
                <th className="text-right px-3 py-2">CAPEX</th>
                <th className="text-right px-3 py-2">Loan</th>
                <th className="text-right px-3 py-2">EBITDA</th>
                <th className="text-right px-3 py-2">CF</th>
                <th className="text-right px-3 py-2">DSCR</th>
                <th className="text-right px-3 py-2">Cash end</th>
              </tr>
            </thead>
            <tbody>
              {(months || []).map((m) => (
                <tr key={m.month} className="border-t">
                  <td className="px-3 py-2">{m.month}</td>
                  <td className="px-3 py-2 text-right">{fmt0(m.revenue)} UZS</td>
                  <td className="px-3 py-2 text-right">{fmt0(m.cogs)} UZS</td>
                  <td className="px-3 py-2 text-right">{fmt0(m.opex)} UZS</td>
                  <td className="px-3 py-2 text-right">{fmt0(m.capex)} UZS</td>
                  <td className="px-3 py-2 text-right">{fmt0(m.loan)} UZS</td>
                  <td
                    className={`px-3 py-2 text-right ${
                      toNum(m.ebitda) < 0 ? "text-red-600" : "text-green-700"
                    }`}
                  >
                    {fmt0(m.ebitda)} UZS
                  </td>
                  <td
                    className={`px-3 py-2 text-right ${
                      toNum(m.cf) < 0 ? "text-red-600" : "text-green-700"
                    }`}
                  >
                    {fmt0(m.cf)} UZS
                  </td>
                  <td className="px-3 py-2 text-right">{m.dscr == null ? "—" : m.dscr}</td>
                  <td
                    className={`px-3 py-2 text-right font-semibold ${
                      toNum(m.cash_end) < 0 ? "text-red-700" : ""
                    }`}
                  >
                    {fmt0(m.cash_end)} UZS
                  </td>
                </tr>
              ))}

              {loading && (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              )}

              {!loading && (!months || !months.length) && (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-gray-400">
                    Нет данных
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
