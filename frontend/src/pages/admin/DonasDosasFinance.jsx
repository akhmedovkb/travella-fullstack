// frontend/src/pages/admin/DonasDosasFinance.jsx

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

function monthKey(d) {
  return String(d || "").slice(0, 7); // YYYY-MM
}

function downloadCSV(filename, rows) {
  const esc = (v) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ✅ cash_end chain: cash_end = prev_cash + (NetOp - loan_paid - capex)
function recalcCashChain(months, cashStart) {
  let cash = Number(cashStart || 0);

  return months.map((m) => {
    const revenue = toNum(m.revenue);
    const cogs = toNum(m.cogs);
    const opex = toNum(m.opex);
    const capex = toNum(m.capex);
    const loan = toNum(m.loan_paid);

    const gross = revenue - cogs;
    const netOp = gross - opex;
    const cashFlow = netOp - loan - capex;

    cash = cash + cashFlow;

    return {
      ...m,
      cash_end: cash,
      _calc: { gross, netOp, cashFlow },
    };
  });
}

export default function DonasDosasFinance() {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(null);
  const [months, setMonths] = useState([]);
  const [err, setErr] = useState("");

  const currency = settings?.currency || "UZS";

  const load = async () => {
    setErr("");
    setLoading(true);
    try {
      const s = await apiGet("/api/admin/donas/finance/settings", "provider");
      const m = await apiGet("/api/admin/donas/finance/months", "provider");
      setSettings(s);
      setMonths(Array.isArray(m) ? m : []);
    } catch (e) {
      setErr(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const derivedPlan = useMemo(() => {
    if (!settings) return null;

    const avgCheck = toNum(settings.avg_check);
    const cogsUnit = toNum(settings.cogs_per_unit);
    const unitsDay = toNum(settings.units_per_day);
    const days = toNum(settings.days_per_month) || 26;

    const fixedOpex = toNum(settings.fixed_opex_month);
    const varOpex = toNum(settings.variable_opex_month);

    const loan = toNum(settings.loan_payment_month);

    const unitMargin = Math.max(0, avgCheck - cogsUnit);
    const revenuePlan = avgCheck * unitsDay * days;
    const cogsPlan = cogsUnit * unitsDay * days;

    const grossMonthPlan = revenuePlan - cogsPlan;
    const opexPlan = fixedOpex + varOpex;
    const netOpPlan = grossMonthPlan - opexPlan;

    const dscrPlan = loan > 0 ? netOpPlan / loan : null;
    const breakevenPerDay =
      unitMargin > 0 ? (opexPlan + loan) / unitMargin / days : null;

    return {
      avgCheck,
      cogsUnit,
      unitsDay,
      days,
      fixedOpex,
      varOpex,
      opexPlan,
      loan,
      unitMargin,
      revenuePlan,
      cogsPlan,
      grossMonthPlan,
      netOpPlan,
      dscrPlan,
      breakevenPerDay,
    };
  }, [settings]);

  // ✅ LIVE: monthsWithCash всегда пересчитывается из текущих months + cash_start
  const monthsWithCash = useMemo(() => {
    if (!settings) return months;
    const sorted = [...months].sort((a, b) =>
      String(a.month).localeCompare(String(b.month))
    );
    return recalcCashChain(sorted, settings.cash_start);
  }, [months, settings]);

  const onSaveSettings = async () => {
    setErr("");
    try {
      const s = await apiPut(
        "/api/admin/donas/finance/settings",
        settings,
        "provider"
      );
      setSettings(s);
    } catch (e) {
      setErr(e?.message || "Failed to save settings");
    }
  };

  // ✅ LIVE update row in months state (no API)
  const onChangeRow = (patch) => {
    // patch должен содержать хотя бы { month: "YYYY-MM-01" }
    const key = String(patch?.month || "");
    if (!key) return;

    setMonths((prev) => {
      const map = new Map(prev.map((x) => [String(x.month), x]));
      const cur = map.get(key) || { slug: "donas-dosas", month: key };

      // IMPORTANT: не “перетираем” computed cash_end — его всё равно пересчитает monthsWithCash
      const next = {
        ...cur,
        ...patch,
      };

      map.set(String(next.month), next);
      return Array.from(map.values()).sort((a, b) =>
        String(a.month).localeCompare(String(b.month))
      );
    });
  };

  const upsertMonth = async (row) => {
    setErr("");
    try {
      const month = row.month; // YYYY-MM-01
      const saved = await apiPut(
        `/api/admin/donas/finance/months/${month}`,
        row,
        "provider"
      );

      setMonths((prev) => {
        const map = new Map(prev.map((x) => [String(x.month), x]));
        // сохраняем то, что вернул backend (включая cash_end)
        map.set(String(saved.month), saved);
        return Array.from(map.values()).sort((a, b) =>
          String(a.month).localeCompare(String(b.month))
        );
      });
    } catch (e) {
      setErr(e?.message || "Failed to save month");
    }
  };

  const addNextMonth = () => {
    const last = months.length ? months[months.length - 1].month : null;
    const base = last ? new Date(last) : new Date();
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1));
    const iso = d.toISOString().slice(0, 10);

    setMonths((prev) => [
      ...prev,
      {
        slug: "donas-dosas",
        month: iso,
        revenue: 0,
        cogs: 0,
        opex: 0,
        capex: 0,
        loan_paid: 0,
        cash_end: 0, // будет пересчитано в monthsWithCash
        notes: "",
      },
    ]);
  };

  const exportCSV = () => {
    const rows = [
      ["month", "revenue", "cogs", "opex", "capex", "loan_paid", "cash_end", "notes"],
      ...monthsWithCash.map((m) => [
        monthKey(m.month),
        toNum(m.revenue),
        toNum(m.cogs),
        toNum(m.opex),
        toNum(m.capex),
        toNum(m.loan_paid),
        toNum(m.cash_end),
        m.notes || "",
      ]),
    ];
    downloadCSV("donas-dosas-finance.csv", rows);
  };

  if (loading) return <div className="p-4">Loading…</div>;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dona’s Dosas — Finance (Admin)</h1>
          <p className="text-sm text-gray-600">MVP управленки: CAPEX / OPEX / DSCR / Runway</p>
        </div>

        <div className="flex gap-2">
          <button onClick={exportCSV} className="px-3 py-2 rounded-lg bg-gray-900 text-white">
            Export CSV
          </button>
          <button onClick={load} className="px-3 py-2 rounded-lg bg-white border">
            Refresh
          </button>
        </div>
      </div>

      {err && (
        <div className="mt-3 p-3 rounded-lg bg-red-50 text-red-700 border border-red-200">
          {err}
        </div>
      )}

      {/* SETTINGS + KPI */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white border p-4">
          <h2 className="font-semibold mb-3">Assumptions</h2>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Avg check"
              value={settings?.avg_check}
              onChange={(v) => setSettings((s) => ({ ...s, avg_check: v }))}
              suffix={currency}
            />
            <Field
              label="COGS / unit"
              value={settings?.cogs_per_unit}
              onChange={(v) => setSettings((s) => ({ ...s, cogs_per_unit: v }))}
              suffix={currency}
            />
            <Field
              label="Units / day"
              value={settings?.units_per_day}
              onChange={(v) => setSettings((s) => ({ ...s, units_per_day: v }))}
            />
            <Field
              label="Days / month"
              value={settings?.days_per_month}
              onChange={(v) => setSettings((s) => ({ ...s, days_per_month: v }))}
            />
            <Field
              label="Fixed OPEX / month"
              value={settings?.fixed_opex_month}
              onChange={(v) => setSettings((s) => ({ ...s, fixed_opex_month: v }))}
              suffix={currency}
            />
            <Field
              label="Variable OPEX / month"
              value={settings?.variable_opex_month}
              onChange={(v) => setSettings((s) => ({ ...s, variable_opex_month: v }))}
              suffix={currency}
            />
            <Field
              label="Loan payment / month"
              value={settings?.loan_payment_month}
              onChange={(v) => setSettings((s) => ({ ...s, loan_payment_month: v }))}
              suffix={currency}
            />
            <Field
              label="Cash start"
              value={settings?.cash_start}
              onChange={(v) => setSettings((s) => ({ ...s, cash_start: v }))}
              suffix={currency}
            />
            <Field
              label="Reserve target (months)"
              value={settings?.reserve_target_months}
              onChange={(v) => setSettings((s) => ({ ...s, reserve_target_months: v }))}
            />
          </div>

          <div className="mt-3 flex gap-2">
            <button
              onClick={onSaveSettings}
              className="px-3 py-2 rounded-lg bg-orange-500 text-white"
            >
              Save assumptions
            </button>
          </div>
        </div>

        <div className="rounded-2xl bg-white border p-4">
          <h2 className="font-semibold mb-3">KPI (Plan)</h2>

          {derivedPlan ? (
            <div className="grid grid-cols-2 gap-3">
              <Kpi title="Revenue / month" value={`${fmt(derivedPlan.revenuePlan)} ${currency}`} />
              <Kpi title="COGS / month" value={`${fmt(derivedPlan.cogsPlan)} ${currency}`} />
              <Kpi title="Gross Profit" value={`${fmt(derivedPlan.grossMonthPlan)} ${currency}`} />
              <Kpi title="Net Operating" value={`${fmt(derivedPlan.netOpPlan)} ${currency}`} />
              <Kpi title="OPEX / month" value={`${fmt(derivedPlan.opexPlan)} ${currency}`} />
              <Kpi title="Loan / month" value={`${fmt(derivedPlan.loan)} ${currency}`} />
              <Kpi
                title="DSCR"
                value={derivedPlan.loan > 0 ? derivedPlan.dscrPlan?.toFixed(2) ?? "0.00" : "—"}
              />
              <Kpi
                title="Breakeven units/day"
                value={derivedPlan.breakevenPerDay ? derivedPlan.breakevenPerDay.toFixed(1) : "—"}
              />
            </div>
          ) : (
            <div className="text-gray-500 text-sm">No data</div>
          )}
        </div>
      </div>

      {/* MONTHS */}
      <div className="mt-4 rounded-2xl bg-white border p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Months (Actuals)</h2>
          <div className="flex gap-2">
            <button onClick={addNextMonth} className="px-3 py-2 rounded-lg bg-white border">
              + Add month
            </button>
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
                <th className="py-2 pr-2">Loan paid</th>
                <th className="py-2 pr-2">Cash end</th>
                <th className="py-2 pr-2">Notes</th>
                <th className="py-2 pr-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {monthsWithCash.map((m) => (
                <MonthRow
                  key={m.month}
                  row={m}
                  currency={currency}
                  onChangeRow={onChangeRow}
                  onSave={upsertMonth}
                />
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-2 text-xs text-gray-500">
          Формулы: GP = revenue−cogs · NetOp = GP−opex · CF = NetOp−loan_paid−capex · DSCR = NetOp/loan_paid
          (если loan_paid&gt;0) · Runway = cash_end/(opex+loan_paid) · Cash end = prev_cash_end + CF
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, suffix }) {
  return (
    <label className="text-sm">
      <div className="text-gray-600 mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <input
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border"
        />
        {suffix && <span className="text-xs text-gray-500">{suffix}</span>}
      </div>
    </label>
  );
}

function Kpi({ title, value }) {
  return (
    <div className="rounded-xl bg-gray-50 border p-3">
      <div className="text-xs text-gray-600">{title}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function MonthRow({ row, currency, onChangeRow, onSave }) {
  const [r, setR] = useState(row);

  useEffect(() => {
    setR(row);
  }, [row]);

  // derived for the row (row.cash_end already computed by monthsWithCash)
  const gross = toNum(r.revenue) - toNum(r.cogs);
  const netOp = gross - toNum(r.opex);
  const cashFlow = netOp - toNum(r.loan_paid) - toNum(r.capex);
  const cashEnd = toNum(r.cash_end);

  const dscr = toNum(r.loan_paid) > 0 ? netOp / toNum(r.loan_paid) : null;
  const runway =
    (toNum(r.opex) + toNum(r.loan_paid)) > 0
      ? cashEnd / (toNum(r.opex) + toNum(r.loan_paid))
      : null;

  const patch = (k, v) => {
    setR((prev) => {
      const next = { ...prev, [k]: v };
      // LIVE: пушим в parent months сразу (без API)
      onChangeRow?.({
        month: next.month,
        slug: next.slug ?? "donas-dosas",
        revenue: next.revenue,
        cogs: next.cogs,
        opex: next.opex,
        capex: next.capex,
        loan_paid: next.loan_paid,
        notes: next.notes ?? "",
      });
      return next;
    });
  };

  return (
    <tr className="border-t align-top">
      <td className="py-2 pr-2 w-[120px]">
        <input
          value={r.month}
          onChange={(e) => {
            const v = e.target.value;
            // month менять можно, но лучше аккуратно: сразу отправим patch с новым month
            setR((prev) => {
              const next = { ...prev, month: v };
              onChangeRow?.({
                month: next.month,
                slug: next.slug ?? "donas-dosas",
                revenue: next.revenue,
                cogs: next.cogs,
                opex: next.opex,
                capex: next.capex,
                loan_paid: next.loan_paid,
                notes: next.notes ?? "",
              });
              return next;
            });
          }}
          className="w-full px-2 py-1 rounded border"
        />
      </td>

      {["revenue", "cogs", "opex", "capex", "loan_paid"].map((k) => (
        <td key={k} className="py-2 pr-2">
          <input
            value={r[k] ?? 0}
            onChange={(e) => patch(k, e.target.value)}
            className="w-full px-2 py-1 rounded border"
          />
        </td>
      ))}

      {/* cash_end display-only (computed live) */}
      <td className="py-2 pr-2 whitespace-nowrap">
        {fmt(cashEnd)} {currency}
      </td>

      <td className="py-2 pr-2 min-w-[220px]">
        <input
          value={r.notes ?? ""}
          onChange={(e) => patch("notes", e.target.value)}
          className="w-full px-2 py-1 rounded border"
          placeholder="notes…"
        />
        <div className="mt-1 text-xs text-gray-600">
          GP: {fmt(gross)} {currency} · Net: {fmt(netOp)} {currency}
          <br />
          CF: {fmt(cashFlow)} {currency} · Cash end: {fmt(cashEnd)} {currency}
          <br />
          DSCR: {dscr == null ? "—" : dscr.toFixed(2)} · Runway:{" "}
          {runway == null ? "—" : runway.toFixed(1)} m
        </div>
      </td>

      <td className="py-2 pr-2">
        <button
          onClick={() =>
            onSave({
              ...row, // важно: сохраняем month как в строке списка
              month: r.month,
              slug: r.slug ?? "donas-dosas",
              revenue: toNum(r.revenue),
              cogs: toNum(r.cogs),
              opex: toNum(r.opex),
              capex: toNum(r.capex),
              loan_paid: toNum(r.loan_paid),
              cash_end: cashEnd, // ✅ computed
              notes: r.notes ?? "",
            })
          }
          className="px-3 py-1.5 rounded-lg bg-gray-900 text-white"
        >
          Save
        </button>
      </td>
    </tr>
  );
}
