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

function pct(actual, plan) {
  const a = toNum(actual);
  const p = toNum(plan);
  if (!p) return null;
  return ((a - p) / p) * 100;
}

function isLockedNotes(notes) {
  return String(notes || "").toLowerCase().includes("#locked");
}

function addLockedTag(notes) {
  const s = String(notes || "").trim();
  if (!s) return "#locked";
  if (isLockedNotes(s)) return s;
  return `${s} | #locked`;
}

function removeLockedTag(notes) {
  const s = String(notes || "");
  // убираем #locked и лишние разделители
  return s
    .replace(/(\|\s*)?#locked\b/gi, "")
    .replace(/\s*\|\s*\|\s*/g, " | ")
    .replace(/^\s*\|\s*/g, "")
    .replace(/\s*\|\s*$/g, "")
    .trim();
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

// cash_end chain: cash_end = prev_cash + (NetOp - loan_paid - capex)
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

function toMonthStartISO(s) {
  if (!s || typeof s !== "string") return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonthsUTC(d, n) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

function isSameMonthUTC(a, b) {
  return (
    a &&
    b &&
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth()
  );
}

function normalizeToISOMonthStart(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const monthStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  return monthStart.toISOString().slice(0, 10);
}

function makeEmptyMonthRow(iso) {
  return {
    slug: "donas-dosas",
    month: iso,
    revenue: 0,
    cogs: 0,
    opex: 0,
    capex: 0,
    loan_paid: 0,
    cash_end: 0,
    notes: "",
  };
}

function computePlan(settings, scenario) {
  if (!settings) return null;

  const avgCheckBase = toNum(settings.avg_check);
  const cogsUnitBase = toNum(settings.cogs_per_unit);
  const unitsDay = toNum(settings.units_per_day);
  const days = toNum(settings.days_per_month) || 26;

  const fixedOpexBase = toNum(settings.fixed_opex_month);
  const varOpexBase = toNum(settings.variable_opex_month);
  const loan = toNum(settings.loan_payment_month);

  const avgCheck = avgCheckBase * (scenario?.avgCheckMul ?? 1);
  const cogsUnit = cogsUnitBase * (scenario?.cogsUnitMul ?? 1);
  const fixedOpex = fixedOpexBase + (scenario?.fixedOpexAdd ?? 0);
  const varOpex = varOpexBase;

  const unitMargin = Math.max(0, avgCheck - cogsUnit);
  const revenuePlan = avgCheck * unitsDay * days;
  const cogsPlan = cogsUnit * unitsDay * days;

  const grossMonthPlan = revenuePlan - cogsPlan;
  const opexPlan = fixedOpex + varOpex;
  const netOpPlan = grossMonthPlan - opexPlan;

  const dscrPlan = loan > 0 ? netOpPlan / loan : null;
  const breakevenPerDay =
    unitMargin > 0 ? (opexPlan + loan) / unitMargin / days : null;

  const cashStart = toNum(settings.cash_start);
  const burn = Math.max(0, -netOpPlan);
  const runwayPlan = burn > 0 ? cashStart / burn : null;

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
    cashStart,
    runwayPlan,
  };
}

// Scenarios (also used for per-month preview)
const SCENARIOS = [
  { id: "bad20", label: "Bad month −20% revenue", revenueMul: 0.8, plan: { avgCheckMul: 0.8 } },
  { id: "price10", label: "Price +10%", revenueMul: 1.1, plan: { avgCheckMul: 1.1 } },
  { id: "cogs10", label: "COGS +10%", cogsMul: 1.1, plan: { cogsUnitMul: 1.1 } },
  { id: "opex2m", label: "OPEX +2 000 000", opexAdd: 2_000_000, plan: { fixedOpexAdd: 2_000_000 } },
];

function getScenarioById(id) {
  if (!id || id === "base") return null;
  return SCENARIOS.find((s) => s.id === id) || null;
}

// Apply scenario to a month row calc (preview only)
function applyMonthScenario(row, scenario) {
  const revenue = toNum(row.revenue) * (scenario?.revenueMul ?? 1);
  const cogs = toNum(row.cogs) * (scenario?.cogsMul ?? 1);
  const opex = toNum(row.opex) + (scenario?.opexAdd ?? 0);
  const capex = toNum(row.capex);
  const loan = toNum(row.loan_paid);

  const gross = revenue - cogs;
  const netOp = gross - opex;
  const cashFlow = netOp - loan - capex;

  const dscr = loan > 0 ? netOp / loan : null;

  return { revenue, cogs, opex, capex, loan, gross, netOp, cashFlow, dscr };
}

function runwayTargetStatus(cashEnd, opex, loanPaid, reserveMonths) {
  const rm = Math.max(0, Math.floor(toNum(reserveMonths || 0)));
  const need = (toNum(opex) + toNum(loanPaid)) * rm;
  const ok = toNum(cashEnd) >= need && rm > 0;
  return { ok, need, rm };
}

export default function DonasDosasFinance() {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(null);
  const [months, setMonths] = useState([]);
  const [err, setErr] = useState("");

  // Save all state
  const [savingAll, setSavingAll] = useState(false);
  const [saveAllProgress, setSaveAllProgress] = useState(null); // { i, total, month }

  // Scenario state (Plan KPI only)
  const [scenarioId, setScenarioId] = useState("base");

  // Per-month scenario preview map: { [month]: scenarioId }
  const [monthScenario, setMonthScenario] = useState({});

  // Plan → Month behavior
  const [planFillOnlyEmpty, setPlanFillOnlyEmpty] = useState(true);

  // Bulk lock
  const [lockUpToMonth, setLockUpToMonth] = useState("");
  // cash_end preview
  const [cashPreview, setCashPreview] = useState(null);

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

  useEffect(() => {
    // default: last month in table
    if (!lockUpToMonth && monthsWithCash.length) {
      setLockUpToMonth(monthsWithCash[monthsWithCash.length - 1].month);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthsWithCash.length]);
  
  const scenarioPlan = useMemo(() => {
    if (scenarioId === "base") return null;
    return getScenarioById(scenarioId)?.plan || null;
  }, [scenarioId]);

  const planBase = useMemo(() => computePlan(settings, null), [settings]);
  const planScenario = useMemo(() => computePlan(settings, scenarioPlan), [settings, scenarioPlan]);

  // sorted months (raw)
  const sortedMonths = useMemo(() => {
    return [...months].sort((a, b) => String(a.month).localeCompare(String(b.month)));
  }, [months]);

  // LIVE monthsWithCash derived from months + cash_start
  const monthsWithCash = useMemo(() => {
    if (!settings) return sortedMonths;
    return recalcCashChain(sortedMonths, settings.cash_start);
  }, [sortedMonths, settings]);

  // With prev cash for each row (for what-if cash end)
  const monthsWithPrevCash = useMemo(() => {
    const arr = monthsWithCash || [];
    const cashStart = toNum(settings?.cash_start);
    let prev = cashStart;
    return arr.map((m) => {
      const out = { ...m, _prev_cash: prev };
      prev = toNum(m.cash_end);
      return out;
    });
  }, [monthsWithCash, settings]);

  const lastMonth = monthsWithCash.length ? monthsWithCash[monthsWithCash.length - 1] : null;
  const reserveMonths = toNum(settings?.reserve_target_months || 0);

  const lastTarget = useMemo(() => {
    if (!lastMonth) return null;
    return runwayTargetStatus(lastMonth.cash_end, lastMonth.opex, lastMonth.loan_paid, reserveMonths);
  }, [lastMonth, reserveMonths]);

  // GAP CHECK
  const gaps = useMemo(() => {
    const rows = monthsWithCash || [];
    const result = [];
    for (let i = 1; i < rows.length; i++) {
      const prev = toMonthStartISO(rows[i - 1]?.month);
      const cur = toMonthStartISO(rows[i]?.month);
      if (!prev || !cur) continue;

      const expected = addMonthsUTC(prev, 1);
      if (!isSameMonthUTC(expected, cur)) {
        const missing = [];
        let t = expected;
        let guard = 0;
        while (t < cur && guard < 120) {
          missing.push(t.toISOString().slice(0, 10));
          t = addMonthsUTC(t, 1);
          guard++;
        }
        result.push({
          afterMonth: rows[i - 1]?.month,
          beforeMonth: rows[i]?.month,
          missing,
          highlightMonth: rows[i]?.month,
        });
      }
    }
    return result;
  }, [monthsWithCash]);

  const highlightMonths = useMemo(() => {
    const set = new Set();
    for (const g of gaps) {
      if (g?.highlightMonth) set.add(String(g.highlightMonth));
    }
    return set;
  }, [gaps]);

  const onSaveSettings = async () => {
    setErr("");
    try {
      const s = await apiPut("/api/admin/donas/finance/settings", settings, "provider");
      setSettings(s);
    } catch (e) {
      setErr(e?.message || "Failed to save settings");
    }
  };

  // LIVE update row in months state (no API)
  const onChangeRow = (patch) => {
    const key = String(patch?.month || "");
    if (!key) return;

    setMonths((prev) => {
      const map = new Map(prev.map((x) => [String(x.month), x]));
      const cur = map.get(key) || { slug: "donas-dosas", month: key };
      const next = { ...cur, ...patch };
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
      const saved = await apiPut(`/api/admin/donas/finance/months/${month}`, row, "provider");

      setMonths((prev) => {
        const map = new Map(prev.map((x) => [String(x.month), x]));
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
    setMonths((prev) => [...prev, makeEmptyMonthRow(iso)]);
  };

  // Fill missing months
  const fillMissingMonths = () => {
    setMonths((prev) => {
      const sorted = [...prev].sort((a, b) =>
        String(a.month).localeCompare(String(b.month))
      );

      const existing = new Set(sorted.map((x) => String(x.month)));
      const additions = [];

      for (let i = 1; i < sorted.length; i++) {
        const prevD = toMonthStartISO(sorted[i - 1]?.month);
        const curD = toMonthStartISO(sorted[i]?.month);
        if (!prevD || !curD) continue;

        let t = addMonthsUTC(prevD, 1);
        let guard = 0;
        while (t < curD && guard < 120) {
          const iso = t.toISOString().slice(0, 10);
          if (!existing.has(iso)) {
            existing.add(iso);
            additions.push(makeEmptyMonthRow(iso));
          }
          t = addMonthsUTC(t, 1);
          guard++;
        }
      }

      if (!additions.length) return sorted;

      return [...sorted, ...additions].sort((a, b) =>
        String(a.month).localeCompare(String(b.month))
      );
    });
  };

  // Normalize months to YYYY-MM-01 + merge duplicates
  const normalizeMonths = () => {
    setErr("");
    setMonths((prev) => {
      const byMonth = new Map();

      for (const row of prev) {
        const norm = normalizeToISOMonthStart(row.month);
        if (!norm) {
          const key = String(row.month);
          byMonth.set(key, { ...row });
          continue;
        }

        const existing = byMonth.get(norm);
        if (!existing) {
          byMonth.set(norm, {
            ...row,
            month: norm,
            slug: row.slug ?? "donas-dosas",
            revenue: toNum(row.revenue),
            cogs: toNum(row.cogs),
            opex: toNum(row.opex),
            capex: toNum(row.capex),
            loan_paid: toNum(row.loan_paid),
            notes: row.notes ?? "",
          });
        } else {
          byMonth.set(norm, {
            ...existing,
            revenue: toNum(existing.revenue) + toNum(row.revenue),
            cogs: toNum(existing.cogs) + toNum(row.cogs),
            opex: toNum(existing.opex) + toNum(row.opex),
            capex: toNum(existing.capex) + toNum(row.capex),
            loan_paid: toNum(existing.loan_paid) + toNum(row.loan_paid),
            notes: [existing.notes, row.notes].filter(Boolean).join(" | "),
          });
        }
      }

      return Array.from(byMonth.values()).sort((a, b) =>
        String(a.month).localeCompare(String(b.month))
      );
    });
  };

  const monthLeq = (a, b) => {
    // both expected YYYY-MM-01
    const aa = String(a || "");
    const bb = String(b || "");
    if (!aa || !bb) return false;
    return aa.localeCompare(bb) <= 0;
  };

  const lockAllUpToSelected = () => {
    if (!lockUpToMonth) return;
    setMonths((prev) =>
      prev.map((m) => {
        if (!monthLeq(m.month, lockUpToMonth)) return m;
        const nextNotes = addLockedTag(m.notes);
        return { ...m, notes: nextNotes };
      })
    );
  };

  const unlockAllUpToSelected = () => {
    if (!lockUpToMonth) return;
    setMonths((prev) =>
      prev.map((m) => {
        if (!monthLeq(m.month, lockUpToMonth)) return m;
        const nextNotes = removeLockedTag(m.notes);
        return { ...m, notes: nextNotes };
      })
    );
  };
  
  const autofillFromPlan = () => {
  if (!settings) return;

  const avgCheck = toNum(settings.avg_check);
  const cogsUnit = toNum(settings.cogs_per_unit);
  const unitsDay = toNum(settings.units_per_day);
  const days = toNum(settings.days_per_month) || 26;

  const fixedOpex = toNum(settings.fixed_opex_month);
  const varOpex = toNum(settings.variable_opex_month);
  const loan = toNum(settings.loan_payment_month);

  const revenuePlan = avgCheck * unitsDay * days;
  const cogsPlan = cogsUnit * unitsDay * days;
  const opexPlan = fixedOpex + varOpex;

  setMonths((prev) =>
    prev.map((m) => ({
      ...m,
      revenue: revenuePlan,
      cogs: cogsPlan,
      opex: opexPlan,
      loan_paid: loan,
      // capex не трогаем
      notes: m.notes
        ? `${m.notes} | auto: plan`
        : "auto: plan",
    }))
  );
};


  // Recalculate cash_end (preview) — does NOT save and does NOT mutate months (until Apply)
  const recalcCashPreview = () => {
    const cashStart = toNum(settings?.cash_start);
    const list = (monthsWithCash || []).slice().sort((a, b) =>
      String(a.month).localeCompare(String(b.month))
    );

    const recalced = recalcCashChain(
      list.map((m) => ({ ...m, cash_end: 0 })),
      cashStart
    );

    const byMonth = new Map();
    let changedCount = 0;

    for (const m of recalced) {
      byMonth.set(String(m.month), toNum(m.cash_end));
      const oldVal = toNum(list.find((x) => String(x.month) === String(m.month))?.cash_end);
      if (Math.round(oldVal) !== Math.round(toNum(m.cash_end))) changedCount++;
    }

    setCashPreview({ byMonth, changedCount, baseStart: cashStart });
  };

  const discardCashPreview = () => setCashPreview(null);

  // Apply preview to months state (still not saving to DB)
  const applyCashPreviewToTable = () => {
    if (!cashPreview?.byMonth) return;
    setMonths((prev) => {
      const map = new Map(prev.map((x) => [String(x.month), { ...x }]));
      for (const [month, cashEnd] of cashPreview.byMonth.entries()) {
        const cur = map.get(String(month));
        if (cur) map.set(String(month), { ...cur, cash_end: toNum(cashEnd) });
      }
      return Array.from(map.values()).sort((a, b) =>
        String(a.month).localeCompare(String(b.month))
      );
    });
    setCashPreview(null);
  };

  // Save all months sequentially (with computed cash_end from monthsWithCash)
  const saveAll = async () => {
    if (savingAll) return;
    setErr("");
    setSavingAll(true);
    setSaveAllProgress(null);

    try {
      const list = (monthsWithCash || []).slice().sort((a, b) =>
        String(a.month).localeCompare(String(b.month))
      );

      const total = list.length;
      for (let idx = 0; idx < total; idx++) {
        const m = list[idx];
        setSaveAllProgress({ i: idx + 1, total, month: m.month });

        const payload = {
          month: m.month,
          slug: m.slug ?? "donas-dosas",
          revenue: toNum(m.revenue),
          cogs: toNum(m.cogs),
          opex: toNum(m.opex),
          capex: toNum(m.capex),
          loan_paid: toNum(m.loan_paid),
          cash_end: toNum(m.cash_end),
          notes: m.notes ?? "",
        };

        // eslint-disable-next-line no-await-in-loop
        const saved = await apiPut(`/api/admin/donas/finance/months/${m.month}`, payload, "provider");

        setMonths((prev) => {
          const map = new Map(prev.map((x) => [String(x.month), x]));
          map.set(String(saved.month), saved);
          return Array.from(map.values()).sort((a, b) =>
            String(a.month).localeCompare(String(b.month))
          );
        });
      }

      setSaveAllProgress(null);
    } catch (e) {
      const p = saveAllProgress;
      const where = p?.month ? ` (month ${p.month})` : "";
      setErr((e?.message || "Failed to save all") + where);
    } finally {
      setSavingAll(false);
    }
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

  const activePlan = planScenario || planBase;
  const base = planBase;

  const deltaNet =
    base && activePlan ? toNum(activePlan.netOpPlan) - toNum(base.netOpPlan) : 0;

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
            <Field label="Avg check" value={settings?.avg_check} onChange={(v) => setSettings((s) => ({ ...s, avg_check: v }))} suffix={currency} />
            <Field label="COGS / unit" value={settings?.cogs_per_unit} onChange={(v) => setSettings((s) => ({ ...s, cogs_per_unit: v }))} suffix={currency} />
            <Field label="Units / day" value={settings?.units_per_day} onChange={(v) => setSettings((s) => ({ ...s, units_per_day: v }))} />
            <Field label="Days / month" value={settings?.days_per_month} onChange={(v) => setSettings((s) => ({ ...s, days_per_month: v }))} />
            <Field label="Fixed OPEX / month" value={settings?.fixed_opex_month} onChange={(v) => setSettings((s) => ({ ...s, fixed_opex_month: v }))} suffix={currency} />
            <Field label="Variable OPEX / month" value={settings?.variable_opex_month} onChange={(v) => setSettings((s) => ({ ...s, variable_opex_month: v }))} suffix={currency} />
            <Field label="Loan payment / month" value={settings?.loan_payment_month} onChange={(v) => setSettings((s) => ({ ...s, loan_payment_month: v }))} suffix={currency} />
            <Field label="Cash start" value={settings?.cash_start} onChange={(v) => setSettings((s) => ({ ...s, cash_start: v }))} suffix={currency} />
            <Field label="Reserve target (months)" value={settings?.reserve_target_months} onChange={(v) => setSettings((s) => ({ ...s, reserve_target_months: v }))} />
          </div>

          <div className="mt-3 flex gap-2">
            <button onClick={onSaveSettings} className="px-3 py-2 rounded-lg bg-orange-500 text-white">
              Save assumptions
            </button>
          </div>
        </div>

        <div className="rounded-2xl bg-white border p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="font-semibold">KPI (Plan)</h2>
              <div className="text-xs text-gray-500 mt-0.5">
                Сценарии — только preview (не сохраняют settings)
              </div>
            </div>

            <div className="flex flex-wrap gap-2 justify-end">
              <button
                onClick={() => setScenarioId("base")}
                className={`px-3 py-1.5 rounded-lg border text-sm ${
                  scenarioId === "base" ? "bg-gray-900 text-white border-gray-900" : "bg-white"
                }`}
              >
                Reset
              </button>

              {SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setScenarioId(s.id)}
                  className={`px-3 py-1.5 rounded-lg border text-sm ${
                    scenarioId === s.id ? "bg-gray-900 text-white border-gray-900" : "bg-white"
                  }`}
                  title={s.label}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {scenarioId !== "base" && base && activePlan && (
            <div className="mt-3 rounded-xl border bg-gray-50 p-3 text-sm text-gray-700">
              Active scenario: <b>{SCENARIOS.find((x) => x.id === scenarioId)?.label}</b>
              <span className="ml-2">
                · Net Operating Δ:{" "}
                <b className={deltaNet >= 0 ? "text-green-700" : "text-red-700"}>
                  {deltaNet >= 0 ? "+" : ""}
                  {fmt(deltaNet)} {currency}
                </b>
              </span>
            </div>
          )}

          {activePlan ? (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Kpi title="Revenue / month" value={`${fmt(activePlan.revenuePlan)} ${currency}`} />
              <Kpi title="COGS / month" value={`${fmt(activePlan.cogsPlan)} ${currency}`} />
              <Kpi title="Gross Profit" value={`${fmt(activePlan.grossMonthPlan)} ${currency}`} />
              <Kpi title="Net Operating" value={`${fmt(activePlan.netOpPlan)} ${currency}`} />
              <Kpi title="OPEX / month" value={`${fmt(activePlan.opexPlan)} ${currency}`} />
              <Kpi title="Loan / month" value={`${fmt(activePlan.loan)} ${currency}`} />
              <Kpi title="DSCR" value={activePlan.loan > 0 ? (activePlan.dscrPlan?.toFixed(2) ?? "0.00") : "—"} />
              <Kpi title="Breakeven units/day" value={activePlan.breakevenPerDay ? activePlan.breakevenPerDay.toFixed(1) : "—"} />
              <Kpi title="Cash start" value={`${fmt(activePlan.cashStart)} ${currency}`} />
              <Kpi title="Runway (plan, if loss)" value={activePlan.runwayPlan == null ? "—" : `${activePlan.runwayPlan.toFixed(1)} mo`} />
            </div>
          ) : (
            <div className="text-gray-500 text-sm mt-2">No data</div>
          )}
        </div>
      </div>

      {/* MONTHS */}
      <div className="mt-4 rounded-2xl bg-white border p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Months (Actuals)</h2>

          <div className="flex gap-2 flex-wrap justify-end">
            <button onClick={addNextMonth} className="px-3 py-2 rounded-lg bg-white border" disabled={savingAll}>
              + Add month
            </button>

          <div className="flex items-center gap-2">
            <select
              value={lockUpToMonth || ""}
              onChange={(e) => setLockUpToMonth(e.target.value)}
              className="px-3 py-2 rounded-lg border bg-white text-sm"
              disabled={savingAll || monthsWithCash.length === 0}
              title="Выбери месяц, до которого закрываем (включительно)"
            >
              {monthsWithCash.map((m) => (
                <option key={m.month} value={m.month}>
                  Lock up to: {monthKey(m.month)}
                </option>
              ))}
            </select>

            <button
              onClick={lockAllUpToSelected}
              disabled={savingAll || !lockUpToMonth || monthsWithCash.length === 0}
              className={`px-3 py-2 rounded-lg border ${
                savingAll || !lockUpToMonth || monthsWithCash.length === 0
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                  : "bg-white"
              }`}
              title="Добавит #locked всем месяцам до выбранного (включительно). Не сохраняет — потом Save/Save all."
            >
              Lock up to
            </button>

            <button
              onClick={unlockAllUpToSelected}
              disabled={savingAll || !lockUpToMonth || monthsWithCash.length === 0}
              className={`px-3 py-2 rounded-lg border ${
                savingAll || !lockUpToMonth || monthsWithCash.length === 0
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                  : "bg-white"
              }`}
              title="Уберёт #locked всем месяцам до выбранного (включительно). Не сохраняет — потом Save/Save all."
            >
              Unlock up to
            </button>
          </div>
          <button
            onClick={autofillFromPlan}
            disabled={savingAll || !settings || monthsWithCash.length === 0}
            className={`px-3 py-2 rounded-lg border ${
              savingAll || !settings || monthsWithCash.length === 0
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : "bg-white"
            }`}
            title="Заполнить фактические месяцы по Assumptions (Plan)"
          >
            Auto-fill from Plan
          </button>

            <button
              onClick={fillMissingMonths}
              disabled={gaps.length === 0 || savingAll}
              className={`px-3 py-2 rounded-lg border ${
                gaps.length === 0 || savingAll
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                  : "bg-white"
              }`}
            >
              + Fill missing months
            </button>

            <button
              onClick={normalizeMonths}
              disabled={savingAll || monthsWithCash.length === 0}
              className={`px-3 py-2 rounded-lg border ${
                savingAll || monthsWithCash.length === 0
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                  : "bg-white"
              }`}
            >
              Normalize months
            </button>

            <button
              onClick={recalcCashPreview}
              disabled={savingAll || monthsWithCash.length === 0}
              className={`px-3 py-2 rounded-lg border ${
                savingAll || monthsWithCash.length === 0
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                  : "bg-white"
              }`}
              title="Recalculate cash_end for all months (preview only)"
            >
              Recalculate cash_end (preview)
            </button>

            <button
              onClick={saveAll}
              disabled={savingAll || monthsWithCash.length === 0}
              className={`px-3 py-2 rounded-lg ${
                savingAll || monthsWithCash.length === 0
                  ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                  : "bg-gray-900 text-white"
              }`}
            >
              {savingAll ? "Saving all…" : "Save all"}
            </button>
          </div>
        </div>

        {/* RUNWAY TARGET SUMMARY */}
        {lastMonth && lastTarget && reserveMonths > 0 && (
          <div className="mt-3 rounded-xl border bg-gray-50 p-3 text-sm">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <div className="font-semibold">Runway target (last month: {monthKey(lastMonth.month)})</div>
                <div className="text-gray-700 mt-1">
                  cash_end: <b>{fmt(lastMonth.cash_end)} {currency}</b>{" "}
                  · target: <b>{fmt(lastTarget.need)} {currency}</b>{" "}
                  <span className="text-gray-500">
                    ({lastTarget.rm} months × (opex + loan_paid))
                  </span>
                </div>
              </div>

              <div
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${
                  lastTarget.ok
                    ? "bg-green-50 text-green-800 border-green-200"
                    : "bg-red-50 text-red-800 border-red-200"
                }`}
              >
                {lastTarget.ok ? "OK" : "LOW"}
              </div>
            </div>
          </div>
        )}

        {cashPreview && (
          <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-blue-900 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold">💡 cash_end recalculated (preview)</div>
                <div className="mt-1">
                  Changed months: <b>{cashPreview.changedCount}</b>
                </div>
                <div className="text-xs mt-1 text-blue-800">
                  Это preview. Чтобы записать значения в таблицу (перед Save all), нажми Apply.
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={applyCashPreviewToTable}
                  className="px-3 py-2 rounded-lg bg-gray-900 text-white"
                  disabled={savingAll}
                >
                  Apply preview to table
                </button>
                <button
                  onClick={() => setCashPreview(null)}
                  className="px-3 py-2 rounded-lg bg-white border"
                  disabled={savingAll}
                >
                  Discard
                </button>
              </div>
            </div>
          </div>
        )}

        {saveAllProgress && (
          <div className="mt-3 rounded-xl border bg-gray-50 p-3 text-sm text-gray-700">
            Saving {saveAllProgress.i}/{saveAllProgress.total}…{" "}
            <span className="font-mono">{saveAllProgress.month}</span>
          </div>
        )}

        {gaps.length > 0 && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
            <div className="font-semibold">⚠️ Пропуски месяцев</div>
            <div className="mt-1 space-y-1">
              {gaps.map((g, idx) => (
                <div key={idx}>
                  Между <b>{monthKey(g.afterMonth)}</b> и <b>{monthKey(g.beforeMonth)}</b> отсутствуют:{" "}
                  <span className="font-mono text-xs">
                    {g.missing.map((x) => monthKey(x)).join(", ")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-3 overflow-auto">
          <table className="min-w-[1400px] w-full text-sm">
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
              {monthsWithPrevCash.map((m) => (
                <MonthRow
                  key={m.month}
                  row={m}
                  plan={planBase}
                  currency={currency}
                  reserveMonths={reserveMonths}
                  onChangeRow={onChangeRow}
                  onSave={upsertMonth}
                  highlight={highlightMonths.has(String(m.month))}
                  savingAll={savingAll}
                  planFillOnlyEmpty={planFillOnlyEmpty}
                  setPlanFillOnlyEmpty={setPlanFillOnlyEmpty}
                  scenarioId={monthScenario[String(m.month)] || "base"}
                  onScenarioChange={(sid) =>
                    setMonthScenario((prev) => ({ ...prev, [String(m.month)]: sid }))
                  }
                />
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-2 text-xs text-gray-500">
          Формулы: GP = revenue−cogs · NetOp = GP−opex · CF = NetOp−loan_paid−capex · DSCR = NetOp/loan_paid
          (если loan_paid&gt;0) · Runway = cash_end/(opex+loan_paid) · Target cash = (opex+loan_paid)*reserve_target_months
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

function MonthRow({
  row,
  plan,
  currency,
  reserveMonths,
  onChangeRow,
  onSave,
  highlight,
  savingAll,
  planFillOnlyEmpty,
  setPlanFillOnlyEmpty,
  scenarioId,
  onScenarioChange,
}) {
  const [r, setR] = useState(row);

  useEffect(() => {
    setR(row);
  }, [row]);

  const locked = isLockedNotes(r.notes);
  // baseline row calc
  const gross = toNum(r.revenue) - toNum(r.cogs);
  const netOp = gross - toNum(r.opex);
  const cashFlow = netOp - toNum(r.loan_paid) - toNum(r.capex);
  const cashEnd = toNum(r.cash_end);

  const dscr = toNum(r.loan_paid) > 0 ? netOp / toNum(r.loan_paid) : null;
  const denom = toNum(r.opex) + toNum(r.loan_paid);
  const runway = denom > 0 ? cashEnd / denom : null;

  const target = runwayTargetStatus(cashEnd, r.opex, r.loan_paid, reserveMonths);

  // Plan vs Fact (from Assumptions)
  const planRevenue = toNum(plan?.revenuePlan);
  const planCogs = toNum(plan?.cogsPlan);
  const planOpex = toNum(plan?.opexPlan);
  const planLoan = toNum(plan?.loan);
  const planGross = planRevenue - planCogs;
  const planNetOp = planGross - planOpex;
  const planCF = planNetOp - planLoan; // capex в плане не учитываем

  const revDelta = pct(r.revenue, planRevenue);
  const netDelta = pct(netOp, planNetOp);
  const cfDelta = pct(cashFlow, planCF);
  const isEmpty = (v) => {
    const n = toNum(v);
    return !n; // 0, NaN, empty => считаем пустым
  };

  const applyPlanToThis = () => {
    const next = { ...r };

    const shouldSet = (key) => {
      if (!planFillOnlyEmpty) return true;
      return isEmpty(next[key]);
    };

    if (shouldSet("revenue")) next.revenue = planRevenue;
    if (shouldSet("cogs")) next.cogs = planCogs;
    if (shouldSet("opex")) next.opex = planOpex;
    if (shouldSet("loan_paid")) next.loan_paid = planLoan;
    // capex не трогаем

    next.notes = next.notes
      ? `${next.notes} | plan→month`
      : "plan→month";

    // обновляем локально + пробрасываем наверх (live cash chain пересчитается)
    setR(next);
    onChangeRow?.({
      month: next.month,
      slug: next.slug ?? "donas-dosas",
      revenue: next.revenue,
      cogs: next.cogs,
      opex: next.opex,
      capex: next.capex,
      loan_paid: next.loan_paid,
      cash_end: next.cash_end,
      notes: next.notes ?? "",
    });
  };

  const status =
    target.rm > 0 && !target.ok
      ? "red"
      : netOp >= 0
      ? "green"
      : "yellow";
  // scenario preview
  const sc = getScenarioById(scenarioId);
  const scCalc = sc ? applyMonthScenario(r, sc) : null;

  const prevCash = toNum(r._prev_cash); // provided by parent
  const scCashEnd = scCalc ? prevCash + toNum(scCalc.cashFlow) : null;
  const scRunway =
    scCalc && (toNum(scCalc.opex) + toNum(scCalc.loan)) > 0
      ? scCashEnd / (toNum(scCalc.opex) + toNum(scCalc.loan))
      : null;

  const patch = (k, v) => {
    setR((prev) => {
      const next = { ...prev, [k]: v };
      onChangeRow?.({
        month: next.month,
        slug: next.slug ?? "donas-dosas",
        revenue: next.revenue,
        cogs: next.cogs,
        opex: next.opex,
        capex: next.capex,
        loan_paid: next.loan_paid,
        notes: next.notes ?? "",
        cash_end: next.cash_end,
      });
      return next;
    });
  };

  return (
    <tr className={`border-t align-top ${highlight ? "bg-amber-50" : ""}`}>
      <td className="py-2 pr-2 w-[120px]">
        <input
          value={r.month}
          onChange={(e) => patch("month", e.target.value)}
          className="w-full px-2 py-1 rounded border"
          disabled={savingAll || locked}
        />

        {/* Scenario per month */}
        <div className="mt-2">
          <select
            value={scenarioId || "base"}
            onChange={(e) => onScenarioChange?.(e.target.value)}
            className="w-full px-2 py-1 rounded border text-xs bg-white"
            disabled={savingAll || locked}
            title="Scenario preview for this month (no save)"
          >
            <option value="base">Scenario: Base</option>
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </td>

      {["revenue", "cogs", "opex", "capex", "loan_paid"].map((k) => (
        <td key={k} className="py-2 pr-2">
          <input
            value={r[k] ?? 0}
            onChange={(e) => patch(k, e.target.value)}
            className="w-full px-2 py-1 rounded border"
            disabled={savingAll || locked}
          />
        </td>
      ))}

      <td className="py-2 pr-2 whitespace-nowrap">
        {fmt(cashEnd)} {currency}
        {scCalc && (
          <div className="mt-1 text-xs text-gray-700">
            <span className="text-gray-500">what-if:</span>{" "}
            <b>
              {fmt(scCashEnd)} {currency}
            </b>
          </div>
        )}
      </td>

      <td className="py-2 pr-2 min-w-[280px]">
        <input
          value={r.notes ?? ""}
          onChange={(e) => patch("notes", e.target.value)}
          className="w-full px-2 py-1 rounded border"
          placeholder="notes…"
          disabled={savingAll || locked}
        />

        <div className="mt-2 text-xs text-gray-600">
          <div>
            Base → GP: {fmt(gross)} {currency} · Net: {fmt(netOp)} {currency} · CF: {fmt(cashFlow)} {currency}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span>
              Base → DSCR: {dscr == null ? "—" : dscr.toFixed(2)} · Runway: {runway == null ? "—" : runway.toFixed(1)} m
            </span>

            {target.rm > 0 && (
              <span
                className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${
                  target.ok
                    ? "bg-green-50 text-green-800 border-green-200"
                    : "bg-red-50 text-red-800 border-red-200"
                }`}
                title={`Target cash: ${(toNum(r.opex) + toNum(r.loan_paid)).toLocaleString("ru-RU")} × ${target.rm} = ${fmt(target.need)} ${currency}`}
              >
                {target.ok ? "OK" : "LOW"} (target)
              </span>
            )}

            <span
              className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${
                status === "green"
                  ? "bg-green-50 text-green-800 border-green-200"
                  : status === "yellow"
                  ? "bg-amber-50 text-amber-800 border-amber-200"
                  : "bg-red-50 text-red-800 border-red-200"
              }`}
              title="Traffic-light: 🟢 netOp>=0 & target OK · 🟡 netOp<0 but target OK · 🔴 target LOW"
            >
              {status === "green" ? "🟢 OK" : status === "yellow" ? "🟡 RISK" : "🔴 LOW"}
            </span>
          </div>

          <div className="mt-1 text-[11px] text-gray-700">
            Plan vs Fact:{" "}
            <span className={revDelta != null && revDelta < 0 ? "text-red-700" : "text-green-700"}>
              Rev {revDelta == null ? "—" : `${revDelta.toFixed(1)}%`}
            </span>
            {" · "}
            <span className={netDelta != null && netDelta < 0 ? "text-red-700" : "text-green-700"}>
              NetOp {netDelta == null ? "—" : `${netDelta.toFixed(1)}%`}
            </span>
            {" · "}
            <span className={cfDelta != null && cfDelta < 0 ? "text-red-700" : "text-green-700"}>
              CF {cfDelta == null ? "—" : `${cfDelta.toFixed(1)}%`}
            </span>
          </div>
          {scCalc && (
            <div className="mt-2 rounded-lg border bg-white/70 p-2">
              <div className="font-semibold text-gray-800">
                Scenario → GP: {fmt(scCalc.gross)} {currency} · Net: {fmt(scCalc.netOp)} {currency} · CF: {fmt(scCalc.cashFlow)} {currency}
              </div>
              <div className="text-gray-700">
                Scenario → DSCR: {scCalc.dscr == null ? "—" : scCalc.dscr.toFixed(2)} · Runway:{" "}
                {scRunway == null ? "—" : scRunway.toFixed(1)} m
              </div>
              <div className="text-gray-500 mt-1">
                prev cash: {fmt(prevCash)} {currency} → what-if cash end: {fmt(scCashEnd)} {currency}
              </div>
            </div>
          )}
        </div>
      </td>

      <td className="py-2 pr-2">
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-xs text-gray-700 select-none">
            <input
              type="checkbox"
              checked={!!planFillOnlyEmpty}
              onChange={(e) => setPlanFillOnlyEmpty?.(e.target.checked)}
              disabled={savingAll || locked}
            />
            only empty
          </label>

          <button
            onClick={applyPlanToThis}
            className={`px-3 py-1.5 rounded-lg border ${
              savingAll || locked ? "bg-gray-100 text-gray-400 cursor-not-allowed" : "bg-white"
            }`}
            disabled={savingAll || locked}
            title="Скопировать Plan (Assumptions) в этот месяц"
          >
            Plan → This
          </button>

          <button
            onClick={() => {
              const nextNotes = locked ? removeLockedTag(r.notes) : addLockedTag(r.notes);
              const next = { ...r, notes: nextNotes };
              setR(next);
              onChangeRow?.({
                month: next.month,
                slug: next.slug ?? "donas-dosas",
                revenue: next.revenue,
                cogs: next.cogs,
                opex: next.opex,
                capex: next.capex,
                loan_paid: next.loan_paid,
                cash_end: next.cash_end,
                notes: nextNotes ?? "",
              });
            }}
            className={`px-3 py-1.5 rounded-lg border ${
              locked
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white"
            } ${savingAll ? "opacity-50 cursor-not-allowed" : ""}`}
            disabled={savingAll}
            title={locked ? "Разморозить месяц" : "Заморозить месяц (#locked в notes)"}
          >
            {locked ? "Unlock" : "Lock"}
          </button>
          <button
            onClick={() =>
              onSave({
                ...row,
                month: r.month,
                slug: r.slug ?? "donas-dosas",
                revenue: toNum(r.revenue),
                cogs: toNum(r.cogs),
                opex: toNum(r.opex),
                capex: toNum(r.capex),
                loan_paid: toNum(r.loan_paid),
                cash_end: cashEnd,
                notes: r.notes ?? "",
              })
            }
            className={`px-3 py-1.5 rounded-lg ${
              savingAll || locked
                ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                : "bg-gray-900 text-white"
            }`}
            disabled={savingAll || locked}
          >
            Save
          </button>
        </div>
      </td>
    </tr>
  );
}
