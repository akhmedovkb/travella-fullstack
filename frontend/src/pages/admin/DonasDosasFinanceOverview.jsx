// frontend/src/pages/admin/DonasDosasFinanceOverview.jsx

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPut } from "../../api";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n) {
  const v = Math.round(toNum(n));
  return v.toLocaleString("ru-RU");
}

export default function DonasDosasFinanceOverview() {
  const [loading, setLoading] = useState(true);

  const [settings, setSettings] = useState(null);
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const [months, setMonths] = useState([]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [s, ms] = await Promise.all([
        apiGet("/api/admin/donas/finance/settings", "provider"),
        apiGet("/api/admin/donas/finance/months", "provider"),
      ]);

      // settings: поддерживаем оба формата (settings или плоский объект)
      const st = (s && (s.settings || s)) || null;
      setSettings(st);
      setSettingsDraft(st ? { ...st } : null);

      // months: поддерживаем оба формата (array или {months:[]})
      const arr = Array.isArray(ms) ? ms : Array.isArray(ms?.months) ? ms.months : [];
      setMonths(arr);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const last = useMemo(() => {
    if (!months?.length) return null;
    return months[months.length - 1];
  }, [months]);

  const currency = (settings?.currency || "UZS").toString();

  const kpis = useMemo(() => {
    if (!last) return null;
    const revenue = toNum(last.revenue);
    const cogs = toNum(last.cogs);
    const opex = toNum(last.opex);
    const capex = toNum(last.capex);
    const loan = toNum(last.loan_paid);
    const gross = revenue - cogs;
    const netOp = gross - opex;
    const cf = netOp - capex - loan;
    return { revenue, cogs, opex, capex, loan, gross, netOp, cf, cashEnd: toNum(last.cash_end) };
  }, [last]);

  const saveSettings = async () => {
    if (!settingsDraft) return;
    setSavingSettings(true);
    try {
      const payload = {
        currency: settingsDraft.currency ?? "UZS",
        cash_start: toNum(settingsDraft.cash_start),
        fixed_opex_month: toNum(settingsDraft.fixed_opex_month),
        variable_opex_month: toNum(settingsDraft.variable_opex_month),
        loan_payment_month: toNum(settingsDraft.loan_payment_month),
        reserve_target_months: toNum(settingsDraft.reserve_target_months),
      };
      const r = await apiPut("/api/admin/donas/finance/settings", payload, "provider");
      const merged = (r && (r.settings || r)) || payload;
      setSettings(merged);
      setSettingsDraft((d) => ({ ...(d || {}), ...merged }));
    } finally {
      setSavingSettings(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-black/60">Loading…</div>;
  }

  return (
    <div className="space-y-4">
      {/* Top actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Dona’s Dosas — Finance</div>
          <div className="text-xs text-black/50">
            Overview (KPI + Settings). Управление месяцами и выручкой/COGS — в соответствующих вкладках.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/admin/donas-dosas/finance/months"
            className="px-3 py-1.5 rounded-full text-sm bg-black text-white hover:bg-black/90"
          >
            Open Months
          </Link>

          <Link
            to="/admin/donas-dosas/finance/sales"
            className="px-3 py-1.5 rounded-full text-sm bg-white ring-1 ring-black/10 hover:bg-black/5"
          >
            Open Sales
          </Link>

          <button
            type="button"
            onClick={loadAll}
            className="px-3 py-1.5 rounded-full text-sm bg-white ring-1 ring-black/10 hover:bg-black/5"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Kpi title="Revenue (last)" value={kpis ? fmt(kpis.revenue) : "—"} hint={currency} />
        <Kpi title="COGS (last)" value={kpis ? fmt(kpis.cogs) : "—"} hint={currency} />
        <Kpi title="Gross Profit" value={kpis ? fmt(kpis.gross) : "—"} hint={currency} />
        <Kpi title="OPEX (last)" value={kpis ? fmt(kpis.opex) : "—"} hint={currency} />
        <Kpi title="Net Op" value={kpis ? fmt(kpis.netOp) : "—"} hint={currency} />
        <Kpi title="Cash end (last)" value={kpis ? fmt(kpis.cashEnd) : "—"} hint={currency} />
      </div>

      {/* Settings */}
      <div className="rounded-2xl bg-black/5 p-4 ring-1 ring-black/10">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Settings</div>
            <div className="text-xs text-black/50">
              Эти значения используются для подсказок/план-фрейма. История по месяцам считается и
              фиксируется в Months (#locked).
            </div>
          </div>
          <button
            type="button"
            onClick={saveSettings}
            disabled={savingSettings}
            className="px-3 py-1.5 rounded-full text-sm bg-black text-white disabled:opacity-50"
          >
            {savingSettings ? "…" : "Save"}
          </button>
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field
            label="Currency"
            value={settingsDraft?.currency ?? "UZS"}
            onChange={(v) => setSettingsDraft((s) => ({ ...(s || {}), currency: v }))}
          />
          <Field
            label="Cash start"
            value={settingsDraft?.cash_start ?? 0}
            onChange={(v) => setSettingsDraft((s) => ({ ...(s || {}), cash_start: v }))}
            numeric
          />
          <Field
            label="Reserve target (months)"
            value={settingsDraft?.reserve_target_months ?? 0}
            onChange={(v) => setSettingsDraft((s) => ({ ...(s || {}), reserve_target_months: v }))}
            numeric
          />
          <Field
            label="Fixed OPEX / month"
            value={settingsDraft?.fixed_opex_month ?? 0}
            onChange={(v) => setSettingsDraft((s) => ({ ...(s || {}), fixed_opex_month: v }))}
            numeric
          />
          <Field
            label="Variable OPEX / month"
            value={settingsDraft?.variable_opex_month ?? 0}
            onChange={(v) => setSettingsDraft((s) => ({ ...(s || {}), variable_opex_month: v }))}
            numeric
          />
          <Field
            label="Loan payment / month"
            value={settingsDraft?.loan_payment_month ?? 0}
            onChange={(v) => setSettingsDraft((s) => ({ ...(s || {}), loan_payment_month: v }))}
            numeric
          />
        </div>
      </div>

      {/* Small info card */}
      <div className="rounded-2xl bg-white ring-1 ring-black/10 p-4">
        <div className="text-sm font-semibold">How it works now</div>
        <ul className="mt-2 text-sm text-black/60 space-y-1 list-disc pl-5">
          <li>
            <b>Sales</b> → считает <b>Revenue</b> и <b>COGS</b>
          </li>
          <li>
            <b>Purchases</b> → считает <b>OPEX</b> и <b>CAPEX</b>
          </li>
          <li>
            <b>Months</b> → строит цепочку <b>cash_end</b>, и умеет делать снепшоты через <b>#locked</b>
          </li>
        </ul>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, numeric }) {
  return (
    <label className="block">
      <div className="text-xs text-black/60 mb-1">{label}</div>
      <input
        className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
        value={value ?? ""}
        inputMode={numeric ? "numeric" : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Kpi({ title, value, hint }) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-black/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-black/50">{title}</div>
        {hint ? <div className="text-[11px] text-black/40">{hint}</div> : null}
      </div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
