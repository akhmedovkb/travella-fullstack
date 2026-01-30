// frontend/src/pages/admin/DonasDosasFinanceOverview.jsx

import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../api";

function ym(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function money(n) {
  const v = Math.round(toNum(n));
  return v.toLocaleString("ru-RU");
}

function sum(arr, pick) {
  return (arr || []).reduce((acc, it) => acc + toNum(pick(it)), 0);
}

export default function DonasDosasFinanceOverview() {
  const [month, setMonth] = useState(ym());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [shifts, setShifts] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [opex, setOpex] = useState([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const [s, p, o] = await Promise.all([
          apiGet(`/api/admin/donas/shifts?month=${encodeURIComponent(month)}`),
          apiGet(`/api/admin/donas/purchases?month=${encodeURIComponent(month)}`),
          apiGet(`/api/admin/donas/opex?month=${encodeURIComponent(month)}`),
        ]);

        if (!alive) return;

        setShifts(Array.isArray(s) ? s : []);
        setPurchases(Array.isArray(p) ? p : []);
        setOpex(Array.isArray(o) ? o : []);
      } catch (e) {
        if (!alive) return;
        setErr(e?.response?.data?.error || e?.message || "Ошибка загрузки");
        setShifts([]);
        setPurchases([]);
        setOpex([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [month]);

  const kpi = useMemo(() => {
    const revenue = sum(shifts, (x) => x.revenue);
    const payroll = sum(shifts, (x) => x.total_pay);

    const cogs = sum(
      purchases.filter((x) => String(x.type || "purchase").toLowerCase() === "purchase"),
      (x) => toNum(x.qty) * toNum(x.price)
    );

    const capex = sum(
      purchases.filter((x) => String(x.type || "").toLowerCase() === "capex"),
      (x) => toNum(x.qty) * toNum(x.price)
    );

    const opexSum = sum(opex, (x) => x.amount);

    const gpFromShift = sum(shifts, (x) => x.gross_profit);
    const hasGp = shifts.some((x) => x.gross_profit != null);
    const grossProfit = hasGp ? gpFromShift : revenue - cogs;

    const net = revenue - cogs - opexSum - capex;

    return {
      revenue,
      cogs,
      grossProfit,
      opex: opexSum,
      capex,
      payroll,
      net,
    };
  }, [shifts, purchases, opex]);

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">Overview</div>
          <div className="text-sm text-gray-500">Сводка по месяцу (факт из Shifts / Purchases / OPEX)</div>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Month</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      {err && (
        <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {err}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
        <KpiCard title="Revenue" value={money(kpi.revenue)} loading={loading} />
        <KpiCard title="COGS" value={money(kpi.cogs)} loading={loading} />
        <KpiCard title="Gross profit" value={money(kpi.grossProfit)} loading={loading} />
        <KpiCard title="OPEX" value={money(kpi.opex)} loading={loading} />
        <KpiCard title="CAPEX" value={money(kpi.capex)} loading={loading} />
        <KpiCard title="Net" value={money(kpi.net)} loading={loading} accent />
      </div>

      <div className="mt-4 text-sm text-gray-600">
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <span>Shifts: {shifts.length}</span>
          <span>Purchases: {purchases.length}</span>
          <span>OPEX rows: {opex.length}</span>
          <span>Payroll: {money(kpi.payroll)}</span>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ title, value, loading, accent }) {
  return (
    <div className={["rounded-xl border p-3", accent ? "border-orange-200 bg-orange-50" : "border-gray-200"].join(" ")}>
      <div className="text-xs text-gray-500">{title}</div>
      <div className="text-lg font-semibold">{loading ? "…" : value}</div>
    </div>
  );
}
