import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPut } from "../../api";
import DonasExpensesPanel from "../../components/admin/DonasExpensesPanel";

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

function hasClosedAt(notes) {
  return /\bclosed_at:\s*\d{4}-\d{2}-\d{2}\b/i.test(String(notes || ""));
}

function addClosedAt(notes, dateISO) {
  const s = String(notes || "").trim();
  if (hasClosedAt(s)) return s;
  const tag = `closed_at: ${dateISO}`;
  if (!s) return tag;
  return `${s} | ${tag}`;
}

function todayISO() {
  const d = new Date();
  // local date yyyy-mm-dd
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

// Scenarios
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
  const [autoLockAfterSaveAll, setAutoLockAfterSaveAll] = useState(true);

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

  const scenarioPlan = useMemo(() => {
    if (scenarioId === "base") return null;
    return getScenarioById(scenarioId)?.plan || null;
  }, [scenarioId]);

  const planBase = useMemo(() => computePlan(settings, null), [settings]);
  const planScenario = useMemo(
    () => computePlan(settings, scenarioPlan),
    [settings, scenarioPlan]
  );

  // sorted months (raw)
  const sortedMonths = useMemo(() => {
    return [...months].sort((a, b) => String(a.month).localeCompare(String(b.month)));
  }, [months]);

  // LIVE monthsWithCash derived from months + cash_start
  const monthsWithCash = useMemo(() => {
    if (!settings) return sortedMonths;
    return recalcCashChain(sortedMonths, settings.cash_start);
  }, [sortedMonths, settings]);

  // default lock selector
  useEffect(() => {
    if (!lockUpToMonth && monthsWithCash.length) {
      setLockUpToMonth(monthsWithCash[monthsWithCash.length - 1].month);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthsWithCash.length]);

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
    return runwayTargetStatus(
      lastMonth.cash_end,
      lastMonth.opex,
      lastMonth.loan_paid,
      reserveMonths
    );
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
      const sorted = [...prev].sort((a, b) => String(a.month).localeCompare(String(b.month)));

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

      return Array.from(byMonth.values()).sort((a, b) => String(a.month).localeCompare(String(b.month)));
    });
  };

  const monthLeq = (a, b) => {
    const aa = String(a || "");
    const bb = String(b || "");
    if (!aa || !bb) return false;
    return aa.localeCompare(bb) <= 0;
  };

  const lockAllUpToSelected = () => {
    if (!lockUpToMonth) return;
    const d = todayISO();
    setMonths((prev) =>
      prev.map((m) => {
        if (!monthLeq(m.month, lockUpToMonth)) return m;
        let nextNotes = addLockedTag(m.notes);
        nextNotes = addClosedAt(nextNotes, d);
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

  const getCurrentMonthISO = () => {
    const now = new Date();
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return d.toISOString().slice(0, 10); // YYYY-MM-01
  };

  const lockAllBeforeCurrentMonth = () => {
    const cur = getCurrentMonthISO();
    const d = todayISO();
    setMonths((prev) =>
      prev.map((m) => {
        const mm = String(m.month || "");
        if (!mm) return m;
        if (mm.localeCompare(cur) >= 0) return m;
        let nextNotes = addLockedTag(m.notes);
        nextNotes = addClosedAt(nextNotes, d);
        return { ...m, notes: nextNotes };
      })
    );
  };

  const unlockAllBeforeCurrentMonth = () => {
    const cur = getCurrentMonthISO();
    setMonths((prev) =>
      prev.map((m) => {
        const mm = String(m.month || "");
        if (!mm) return m;
        if (mm.localeCompare(cur) >= 0) return m;
        return { ...m, notes: removeLockedTag(m.notes) };
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
      prev.map((m) => {
        if (isLockedNotes(m.notes)) return m; // ✅ skip locked months
        return {
          ...m,
          revenue: revenuePlan,
          cogs: cogsPlan,
          opex: opexPlan,
          loan_paid: loan,
          notes: m.notes ? `${m.notes} | auto: plan` : "auto: plan",
        };
      })
    );
  };

  // Recalculate cash_end (preview)
  const recalcCashPreview = () => {
    const cashStart = toNum(settings?.cash_start);
    const list = (monthsWithCash || []).slice().sort((a, b) => String(a.month).localeCompare(String(b.month)));

    const recalced = recalcCashChain(
      list.map((m) => ({ ...m, cash_end: 0 })),
      cashStart
    );

    const byMonth = new Map();
    let changedCount = 0;
    let lockedCount = 0;

    for (const m of recalced) {
      byMonth.set(String(m.month), toNum(m.cash_end));
      const oldVal = toNum(list.find((x) => String(x.month) === String(m.month))?.cash_end);
      if (Math.round(oldVal) !== Math.round(toNum(m.cash_end))) changedCount++;
    }

    for (const x of list) {
      if (isLockedNotes(x.notes)) lockedCount++;
    }

    setCashPreview({ byMonth, changedCount, lockedCount, baseStart: cashStart });
  };

  // Apply preview to months state (still not saving to DB)
  const applyCashPreviewToTable = () => {
    if (!cashPreview?.byMonth) return;
    setMonths((prev) => {
      const map = new Map(prev.map((x) => [String(x.month), { ...x }]));
      for (const [month, cashEnd] of cashPreview.byMonth.entries()) {
        const cur = map.get(String(month));
        if (cur) {
          if (isLockedNotes(cur.notes)) continue; // ✅ skip locked months
          map.set(String(month), { ...cur, cash_end: toNum(cashEnd) });
        }
      }
      return Array.from(map.values()).sort((a, b) => String(a.month).localeCompare(String(b.month)));
    });
    setCashPreview(null);
  };

  // Save all months sequentially
  const saveAll = async () => {
    if (savingAll) return;
    setErr("");
    setSavingAll(true);
    setSaveAllProgress(null);

    try {
      const list = (monthsWithCash || []).slice().sort((a, b) => String(a.month).localeCompare(String(b.month)));

      const total = list.length;
      let lastSavedMonth = null;

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
        lastSavedMonth = saved?.month || m.month;

        setMonths((prev) => {
          const map = new Map(prev.map((x) => [String(x.month), x]));
          map.set(String(saved.month), saved);
          return Array.from(map.values()).sort((a, b) => String(a.month).localeCompare(String(b.month)));
        });
      }

      // ✅ Auto-lock after successful Save all (optional)
      if (autoLockAfterSaveAll && lastSavedMonth) {
        const d = todayISO();
        setMonths((prev) =>
          prev.map((m) => {
            const mm = String(m.month || "");
            if (!mm) return m;
            if (mm.localeCompare(String(lastSavedMonth)) <= 0) {
              let nextNotes = addLockedTag(m.notes);
              nextNotes = addClosedAt(nextNotes, d);
              return { ...m, notes: nextNotes };
            }
            return m;
          })
        );
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
            <Field label="Reserve target (months)" value={settings?.reserve_target_months} onChange={(v) => setSettings((s) => ({ ...s,
