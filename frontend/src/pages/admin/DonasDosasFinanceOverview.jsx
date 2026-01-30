// frontend/src/pages/admin/DonasDosasFinanceOverview.jsx

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPut } from "../../api";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n) {
  const v = Math.round(toNum(n));
  return v.toLocaleString("ru-RU");
}

function isLockedNotes(notes) {
  return String(notes || "").toLowerCase().includes("#locked");
}

function MonthRow({ row, onChange, onSave, saving }) {
  const locked = isLockedNotes(row?.notes);

  const revenue = toNum(row?.revenue);
  const cogs = toNum(row?.cogs);
  const opex = toNum(row?.opex);
  const capex = toNum(row?.capex);
  const loanPaid = toNum(row?.loan_paid);
  const cashEnd = toNum(row?.cash_end);

  const gross = revenue - cogs;
  const netOp = gross - opex;
  const cf = netOp - capex - loanPaid;

  return (
    <tr className="border-t border-black/5">
      <td className="py-2 px-3 whitespace-nowrap">
        <div className="font-medium">{row.month}</div>
        {locked && <div className="text-[11px] text-orange-600">locked</div>}
      </td>

      <td className="py-2 px-3">
        <input
          className="w-28 rounded-lg border border-black/10 px-2 py-1 text-sm"
          value={row.revenue ?? 0}
          inputMode="numeric"
          onChange={(e) => onChange(row.month, "revenue", e.target.value)}
        />
      </td>

      <td className="py-2 px-3">
        <input
          className="w-28 rounded-lg border border-black/10 px-2 py-1 text-sm"
          value={row.cogs ?? 0}
          inputMode="numeric"
          onChange={(e) => onChange(row.month, "cogs", e.target.value)}
        />
      </td>

      <td className="py-2 px-3 whitespace-nowrap font-medium">{fmt(gross)}</td>

      <td className="py-2 px-3">
        <input
          className="w-28 rounded-lg border border-black/10 px-2 py-1 text-sm"
          value={row.opex ?? 0}
          inputMode="numeric"
          onChange={(e) => onChange(row.month, "opex", e.target.value)}
        />
      </td>

      <td className="py-2 px-3 whitespace-nowrap font-medium">{fmt(netOp)}</td>

      <td className="py-2 px-3">
        <input
          className="w-24 rounded-lg border border-black/10 px-2 py-1 text-sm"
          value={row.capex ?? 0}
          inputMode="numeric"
          onChange={(e) => onChange(row.month, "capex", e.target.value)}
        />
      </td>

      <td className="py-2 px-3">
        <input
          className="w-20 rounded-lg border border-black/10 px-2 py-1 text-sm"
          value={row.loan_paid ?? 0}
          inputMode="numeric"
          onChange={(e) => onChange(row.month, "loan_paid", e.target.value)}
        />
      </td>

      <td className="py-2 px-3 whitespace-nowrap">{fmt(cf)}</td>

      <td className="py-2 px-3 whitespace-nowrap">
        <div className="font-semibold">{fmt(cashEnd)}</div>
        {!locked && <div className="text-[11px] text-black/40">auto</div>}
      </td>

      <td className="py-2 px-3">
        <input
          className="w-[260px] rounded-lg border border-black/10 px-2 py-1 text-sm"
          value={row.notes ?? ""}
          onChange={(e) => onChange(row.month, "notes", e.target.value)}
          placeholder="например: #locked ..."
        />
      </td>

      <td className="py-2 px-3">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="px-3 py-1.5 rounded-full text-sm bg-black text-white disabled:opacity-50"
        >
          {saving ? "…" : "Save"}
        </button>
      </td>
    </tr>
  );
}

export default function DonasDosasFinanceOverview() {
  const [loading, setLoading] = useState(true);

  const [settings, setSettings] = useState(null);
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const [months, setMonths] = useState([]);
  const [edited, setEdited] = useState(new Map()); // month -> row patch
  const [savingMonth, setSavingMonth] = useState(null);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [s, ms] = await Promise.all([
        apiGet("/api/admin/donas/finance/settings", "provider"),
        apiGet("/api/admin/donas/finance/months", "provider"),
      ]);
      setSettings(s || null);
      setSettingsDraft(s ? { ...s } : null);
      setMonths(Array.isArray(ms) ? ms : []);
      setEdited(new Map());
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

  const onRowChange = (month, key, value) => {
    setEdited((prev) => {
      const next = new Map(prev);
      const base = next.get(month) || months.find((x) => x.month === month) || { month };
      const patch = { ...base };

      if (key === "notes") {
        patch[key] = value;
      } else {
        patch[key] = toNum(value);
      }

      next.set(month, patch);
      return next;
    });
  };

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
      setSettings(r || payload);
      setSettingsDraft((d) => ({ ...(d || {}), ...(r || payload) }));
    } finally {
      setSavingSettings(false);
    }
  };

  const saveMonth = async (month) => {
    const row = edited.get(month);
    if (!row) return;

    setSavingMonth(month);
    try {
      const payload = {
        revenue: toNum(row.revenue),
        cogs: toNum(row.cogs),
        opex: toNum(row.opex),
        capex: toNum(row.capex),
        loan_paid: toNum(row.loan_paid),
        // cash_end можно передать, но backend пересчитает на GET (и зафиксирует если #locked)
        cash_end: toNum(row.cash_end),
        notes: row.notes ?? "",
      };

      await apiPut(`/api/admin/donas/finance/months/${encodeURIComponent(month)}`, payload, "provider");
      await loadAll();
    } finally {
      setSavingMonth(null);
    }
  };

  const addMonth = async () => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const exists = months.some((x) => x.month === ym);
    if (exists) return;

    setMonths((m) => [
      ...m,
      { month: ym, revenue: 0, cogs: 0, opex: 0, capex: 0, loan_paid: 0, cash_end: 0, notes: "" },
    ]);
    setEdited((prev) => {
      const next = new Map(prev);
      next.set(ym, { month: ym, revenue: 0, cogs: 0, opex: 0, capex: 0, loan_paid: 0, cash_end: 0, notes: "" });
      return next;
    });
  };

  if (loading) {
    return <div className="text-sm text-black/60">Loading…</div>;
  }

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi title="Revenue (last)" value={kpis ? fmt(kpis.revenue) : "—"} />
        <Kpi title="Gross Profit" value={kpis ? fmt(kpis.gross) : "—"} />
        <Kpi title="OPEX" value={kpis ? fmt(kpis.opex) : "—"} />
        <Kpi title="Net Op" value={kpis ? fmt(kpis.netOp) : "—"} />
        <Kpi title="Cash end" value={kpis ? fmt(kpis.cashEnd) : "—"} />
      </div>

      {/* Settings */}
      <div className="rounded-2xl bg-black/5 p-4 ring-1 ring-black/10">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Settings</div>
            <div className="text-xs text-black/50">
              Эти значения используются для подсказок/план-фрейма. Исторические месяцы редактируются ниже.
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

      {/* Months */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Months</div>
          <button
            type="button"
            onClick={addMonth}
            className="px-3 py-1.5 rounded-full text-sm bg-white ring-1 ring-black/10 hover:bg-black/5"
          >
            + Add month
          </button>
        </div>

        <div className="overflow-auto rounded-2xl ring-1 ring-black/10 bg-white">
          <table className="min-w-[1100px] w-full text-left">
            <thead className="bg-black/5 text-xs text-black/60">
              <tr>
                <th className="py-2 px-3">Month</th>
                <th className="py-2 px-3">Revenue</th>
                <th className="py-2 px-3">COGS</th>
                <th className="py-2 px-3">Gross</th>
                <th className="py-2 px-3">OPEX</th>
                <th className="py-2 px-3">NetOp</th>
                <th className="py-2 px-3">CAPEX</th>
                <th className="py-2 px-3">Loan</th>
                <th className="py-2 px-3">CF</th>
                <th className="py-2 px-3">Cash</th>
                <th className="py-2 px-3">Notes</th>
                <th className="py-2 px-3"></th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {months.map((m) => {
                const r = edited.get(m.month) || m;
                return (
                  <MonthRow
                    key={m.month}
                    row={r}
                    onChange={onRowChange}
                    onSave={() => saveMonth(m.month)}
                    saving={savingMonth === m.month}
                  />
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-black/50">
          Подсказка: если в Notes добавить <b>#locked</b>, cash_end для месяца фиксируется и цепочка расчёта идёт от него.
        </div>
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
        onChange={(e) => onChange(numeric ? e.target.value : e.target.value)}
      />
    </label>
  );
}

function Kpi({ title, value }) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-black/10 p-3">
      <div className="text-xs text-black/50">{title}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
