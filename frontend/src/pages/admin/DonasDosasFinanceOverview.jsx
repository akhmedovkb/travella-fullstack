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

function Kpi({ title, value }) {
  return (
    <div className="rounded-2xl border bg-white px-4 py-3 shadow-sm">
      <div className="text-xs text-gray-500">{title}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

function ymFromDateLike(x) {
  const s = String(x || "");
  if (!s) return "";
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  return "";
}

export default function DonasDosasFinanceOverview() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [settings, setSettings] = useState(null);
  const [months, setMonths] = useState([]);

  const currency = (settings?.currency || "UZS").toUpperCase();

  async function load() {
    setLoading(true);
    try {
      const s = await apiGet("/api/admin/donas/finance/settings");
      setSettings(s || null);

      const ms = await apiGet("/api/admin/donas/finance/months");
      setMonths(Array.isArray(ms) ? ms : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kpis = useMemo(() => {
    if (!months?.length) return null;
    const last = months[months.length - 1] || {};
    const revenue = toNum(last.revenue);
    const cogs = toNum(last.cogs);
    const opex = toNum(last.opex);
    const cash_end = toNum(last.cash_end);

    const gross = revenue - cogs;
    const netOp = gross - opex;

    return {
      revenue,
      gross,
      opex,
      netOp,
      cash_end,
    };
  }, [months]);

  async function saveSettings() {
    setSaving(true);
    try {
      const payload = {
        currency: (settings?.currency || "UZS").toUpperCase(),
        cash_start: toNum(settings?.cash_start),
        reserve_target_months: toNum(settings?.reserve_target_months),
        fixed_opex_month: toNum(settings?.fixed_opex_month),
        variable_opex_month: toNum(settings?.variable_opex_month),
        loan_payment_month: toNum(settings?.loan_payment_month),
      };
      await apiPut("/api/admin/donas/finance/settings", payload);
      await load();
    } finally {
      setSaving(false);
    }
  }

  const lastRows = useMemo(() => {
    const a = Array.isArray(months) ? months : [];
    return a.slice(Math.max(0, a.length - 4));
  }, [months]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-gray-500">Admin</div>
          <div className="text-2xl font-bold">Dona’s Dosas — Finance</div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <Kpi title="Revenue (last)" value={kpis ? fmt(kpis.revenue) : "—"} />
        <Kpi title="Gross Profit" value={kpis ? fmt(kpis.gross) : "—"} />
        <Kpi title="OPEX" value={kpis ? fmt(kpis.opex) : "—"} />
        <Kpi title="EBITDA (Net Op)" value={kpis ? fmt(kpis.netOp) : "—"} />
        <Kpi title="Cash end" value={kpis ? fmt(kpis.cash_end) : "—"} />
      </div>

      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-lg font-semibold">Settings</div>
            <div className="text-sm text-gray-500">
              Эти значения используются для подсказок/план-фрейма. Месяцы (revenue/cogs/opex/capex) считаются автоматически
              из Sales + Purchases. Ручное редактирование месяцев — во вкладке Months.
            </div>
          </div>
          <button
            onClick={saveSettings}
            disabled={saving || loading}
            className="rounded-full bg-black px-5 py-2 text-white disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div>
            <div className="text-xs text-gray-500">Currency</div>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={settings?.currency || "UZS"}
              onChange={(e) => setSettings((s) => ({ ...(s || {}), currency: e.target.value }))}
            />
          </div>
          <div>
            <div className="text-xs text-gray-500">Cash start</div>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={settings?.cash_start ?? 0}
              onChange={(e) => setSettings((s) => ({ ...(s || {}), cash_start: e.target.value }))}
            />
          </div>
          <div>
            <div className="text-xs text-gray-500">Reserve target (months)</div>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={settings?.reserve_target_months ?? 6}
              onChange={(e) => setSettings((s) => ({ ...(s || {}), reserve_target_months: e.target.value }))}
            />
          </div>

          <div>
            <div className="text-xs text-gray-500">Fixed OPEX / month</div>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={settings?.fixed_opex_month ?? 0}
              onChange={(e) => setSettings((s) => ({ ...(s || {}), fixed_opex_month: e.target.value }))}
            />
          </div>
          <div>
            <div className="text-xs text-gray-500">Variable OPEX / month</div>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={settings?.variable_opex_month ?? 0}
              onChange={(e) => setSettings((s) => ({ ...(s || {}), variable_opex_month: e.target.value }))}
            />
          </div>
          <div>
            <div className="text-xs text-gray-500">Loan payment / month</div>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={settings?.loan_payment_month ?? 0}
              onChange={(e) => setSettings((s) => ({ ...(s || {}), loan_payment_month: e.target.value }))}
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">Months</div>
            <div className="text-sm text-gray-500">
              Валюта: {currency}. Для Lock/Unlock/Preview/Audit и редактирования loan_paid/notes — открой Months.
            </div>
          </div>
          <a
            href="/admin/donas-dosas/finance/months"
            className="rounded-full border px-4 py-2 text-sm hover:bg-gray-50"
          >
            Open Months →
          </a>
        </div>

        <div className="mt-4 overflow-auto">
          <table className="min-w-[900px] w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-2 pr-4">Month</th>
                <th className="py-2 pr-4">Revenue</th>
                <th className="py-2 pr-4">COGS</th>
                <th className="py-2 pr-4">OPEX</th>
                <th className="py-2 pr-4">CAPEX</th>
                <th className="py-2 pr-4">Loan</th>
                <th className="py-2 pr-4">CF</th>
                <th className="py-2 pr-4">Cash end</th>
                <th className="py-2 pr-4">Notes</th>
              </tr>
            </thead>
            <tbody>
              {lastRows.map((m) => {
                const month = ymFromDateLike(m.month) || String(m.month || "");
                return (
                  <tr key={month} className="border-t">
                    <td className="py-2 pr-4">{month}</td>
                    <td className="py-2 pr-4">{fmt(m.revenue)}</td>
                    <td className="py-2 pr-4">{fmt(m.cogs)}</td>
                    <td className="py-2 pr-4">{fmt(m.opex)}</td>
                    <td className="py-2 pr-4">{fmt(m.capex)}</td>
                    <td className="py-2 pr-4">{fmt(m.loan_paid)}</td>
                    <td className="py-2 pr-4">{fmt(m.cash_flow)}</td>
                    <td className="py-2 pr-4 font-semibold">{fmt(m.cash_end)}</td>
                    <td className="py-2 pr-4">{String(m.notes || "")}</td>
                  </tr>
                );
              })}
              {!lastRows.length && (
                <tr>
                  <td className="py-4 text-gray-500" colSpan={9}>
                    {loading ? "Loading..." : "No data"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 text-xs text-gray-400">
          Подсказка: фиксация месяца делается кнопкой Lock во вкладке Months (а не ручным вводом #locked).
        </div>
      </div>
    </div>
  );
}
