// frontend/src/pages/admin/DonasDosasFinanceOverview.jsx

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPut } from "../../api";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n) {
  const v = Math.round(toNum(n));
  return v.toLocaleString("ru-RU");
}

/**
 * ✅ FIX: robust YM extractor
 * supports: "YYYY-MM", "YYYY-MM-DD", ISO strings, Date objects, timestamps
 * never throws; returns "" only if truly cannot determine
 */
function ymFromDateLike(x) {
  if (!x && x !== 0) return "";

  if (x instanceof Date && !Number.isNaN(x.getTime())) {
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }

  if (typeof x === "number" && Number.isFinite(x)) {
    const d = new Date(x);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      return `${y}-${m}`;
    }
  }

  const s = String(x || "").trim();
  if (!s) return "";

  if (/^\d{4}-\d{2}$/.test(s)) return s;

  if (s.includes("T")) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      return `${y}-${m}`;
    }
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(0, 7);

  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }

  return "";
}

function isLockedNotes(notes) {
  return String(notes || "").toLowerCase().includes("#locked");
}

function money(n) {
  return Math.round(toNum(n)).toLocaleString("ru-RU");
}

function Kpi({ title, value }) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-black/10 p-3">
      <div className="text-xs text-black/50">{title}</div>
      <div className="text-lg font-semibold">{value}</div>
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

export default function DonasDosasFinanceOverview() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);

  const [settings, setSettings] = useState(null);
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const [months, setMonths] = useState([]);
  const [err, setErr] = useState("");

  const loadAll = async () => {
    setLoading(true);
    setErr("");
    try {
      const [s, ms] = await Promise.all([
        apiGet("/api/admin/donas/finance/settings", "provider"),
        apiGet("/api/admin/donas/finance/months", "provider"),
      ]);

      const settingsObj = (s && (s.settings || s)) || null;
      setSettings(settingsObj);
      setSettingsDraft(settingsObj ? { ...settingsObj } : null);

      const arr = Array.isArray(ms) ? ms : Array.isArray(ms?.months) ? ms.months : [];
      setMonths(arr);
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to load finance overview");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currency = settingsDraft?.currency || settings?.currency || "UZS";

  const sorted = useMemo(() => {
    const a = Array.isArray(months) ? months.slice() : [];
    // ✅ FIX: sort by normalized YM (not by raw month)
    a.sort((x, y) => {
      const ax = ymFromDateLike(x?.month);
      const ay = ymFromDateLike(y?.month);
      return String(ax).localeCompare(String(ay));
    });
    // ✅ Safety: drop rows where ym can't be determined
    return a.filter((m) => !!ymFromDateLike(m?.month));
  }, [months]);

  const last = useMemo(() => {
    if (!sorted.length) return null;
    return sorted[sorted.length - 1];
  }, [sorted]);

  const kpis = useMemo(() => {
    if (!last) return null;
    const revenue = toNum(last.revenue);
    const cogs = toNum(last.cogs);
    const opex = toNum(last.opex);
    const capex = toNum(last.capex);
    const loan = toNum(last.loan_paid);

    const gp = revenue - cogs;
    const netOp = gp - opex;
    const cf = netOp - loan - capex;

    return {
      revenue,
      cogs,
      opex,
      capex,
      loan,
      gp,
      netOp,
      cf,
      cashEnd: toNum(last.cash_end),
    };
  }, [last]);

  const saveSettings = async () => {
    if (!settingsDraft) return;
    setSavingSettings(true);
    setErr("");
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
      const next = r || payload;

      setSettings(next);
      setSettingsDraft((d) => ({ ...(d || {}), ...next }));
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to save settings");
    } finally {
      setSavingSettings(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-black/60">Loading…</div>;
  }

  return (
    <div className="space-y-4">
      {err && (
        <div className="p-3 rounded-xl bg-red-50 text-red-700 border border-red-200">
          {err}
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi title="Revenue (last)" value={kpis ? fmt(kpis.revenue) : "—"} />
        <Kpi title="Gross Profit" value={kpis ? fmt(kpis.gp) : "—"} />
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
              Эти значения используются для подсказок/план-фрейма. Месяцы (revenue/cogs/opex/capex)
              считаются автоматически из Sales + Purchases. Ручное редактирование месяцев — во вкладке Months.
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
            onChange={(v) =>
              setSettingsDraft((s) => ({ ...(s || {}), reserve_target_months: v }))
            }
            numeric
          />
          <Field
            label="Fixed OPEX / month"
            value={settingsDraft?.fixed_opex_month ?? 0}
            onChange={(v) =>
              setSettingsDraft((s) => ({ ...(s || {}), fixed_opex_month: v }))
            }
            numeric
          />
          <Field
            label="Variable OPEX / month"
            value={settingsDraft?.variable_opex_month ?? 0}
            onChange={(v) =>
              setSettingsDraft((s) => ({ ...(s || {}), variable_opex_month: v }))
            }
            numeric
          />
          <Field
            label="Loan payment / month"
            value={settingsDraft?.loan_payment_month ?? 0}
            onChange={(v) =>
              setSettingsDraft((s) => ({ ...(s || {}), loan_payment_month: v }))
            }
            numeric
          />
        </div>
      </div>

      {/* Months (read-only preview) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Months</div>
            <div className="text-xs text-black/50">
              Валюта: {currency}. Для Lock/Unlock/Preview/Audit и редактирования loan_paid/notes — открой Months.
            </div>
          </div>

          <button
            type="button"
            onClick={() => nav("/admin/donas-dosas/finance/months")}
            className="px-3 py-1.5 rounded-full text-sm bg-white ring-1 ring-black/10 hover:bg-black/5"
          >
            Open Months →
          </button>
        </div>

        <div className="overflow-auto rounded-2xl ring-1 ring-black/10 bg-white">
          <table className="min-w-[1100px] w-full text-left">
            <thead className="bg-black/5 text-xs text-black/60">
              <tr>
                <th className="py-2 px-3">Month</th>
                <th className="py-2 px-3 text-right">Revenue</th>
                <th className="py-2 px-3 text-right">COGS</th>
                <th className="py-2 px-3 text-right">OPEX</th>
                <th className="py-2 px-3 text-right">CAPEX</th>
                <th className="py-2 px-3 text-right">Loan</th>
                <th className="py-2 px-3 text-right">CF</th>
                <th className="py-2 px-3 text-right">Cash end</th>
                <th className="py-2 px-3">Notes</th>
              </tr>
            </thead>

            <tbody className="text-sm">
              {sorted.map((m) => {
                const ym = ymFromDateLike(m.month);
                const locked = isLockedNotes(m.notes);

                const revenue = toNum(m.revenue);
                const cogs = toNum(m.cogs);
                const opex = toNum(m.opex);
                const capex = toNum(m.capex);
                const loan = toNum(m.loan_paid);

                const gp = revenue - cogs;
                const netOp = gp - opex;
                const cf = netOp - loan - capex;

                return (
                  <tr
                    key={ym} // ✅ robust key
                    className={["border-t border-black/5", locked ? "bg-black/[0.02]" : ""].join(" ")}
                  >
                    <td className="py-2 px-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="font-medium">{ym}</div>
                        {locked && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full border bg-white">
                            locked
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-2 px-3 text-right">{money(revenue)}</td>
                    <td className="py-2 px-3 text-right">{money(cogs)}</td>
                    <td className="py-2 px-3 text-right">{money(opex)}</td>
                    <td className="py-2 px-3 text-right">{money(capex)}</td>
                    <td className="py-2 px-3 text-right">{money(loan)}</td>
                    <td className="py-2 px-3 text-right">{money(cf)}</td>
                    <td className="py-2 px-3 text-right font-semibold">{money(m.cash_end)}</td>
                    <td className="py-2 px-3 text-xs text-black/60 max-w-[320px] truncate">
                      {String(m.notes || "")}
                    </td>
                  </tr>
                );
              })}

              {!sorted.length && (
                <tr>
                  <td colSpan={9} className="py-6 px-3 text-center text-black/50">
                    Нет месяцев. Открой Months и нажми Sync или Add month.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-black/50">
          Подсказка: фиксация месяца делается кнопкой Lock во вкладке Months (а не ручным вводом #locked).
        </div>
      </div>
    </div>
  );
}
