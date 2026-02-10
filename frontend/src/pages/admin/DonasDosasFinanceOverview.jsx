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
function ymFromDateLike(x) {
  const s = String(x || "");
  if (!s) return "";
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  return s;
}

export default function DonasDosasFinanceOverview() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [settings, setSettings] = useState(null);
  const [months, setMonths] = useState([]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const s = await apiGet("/api/admin/donas/finance/settings", "admin");
      setSettings(s || null);

      const m = await apiGet(`/api/admin/donas/finance/months?ts=${Date.now()}`, "admin");
      const arr = Array.isArray(m) ? m : Array.isArray(m?.months) ? m.months : [];
      setMonths(arr);
    } catch (e) {
      console.error("[FinanceOverview] load error:", e);
      setError(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currency = String(settings?.currency || "UZS").toUpperCase();

  const cashStartComputed = useMemo(() => {
    const owner = toNum(settings?.owner_capital);
    const bank = toNum(settings?.bank_loan);
    // если оба 0, но в базе уже есть cash_start — показываем его (не ломаем старые данные)
    const legacy = toNum(settings?.cash_start);
    return owner || bank ? owner + bank : legacy;
  }, [settings]);

  const lastRows = useMemo(() => {
    const arr = Array.isArray(months) ? [...months] : [];
    arr.sort((a, b) => String(a.month).localeCompare(String(b.month)));
    return arr.slice(Math.max(0, arr.length - 6));
  }, [months]);

async function saveSettings() {
  setSaving(true);
  setError("");
  try {
    const payload = {
      currency: (settings?.currency || "UZS").toUpperCase(),
      owner_capital: toNum(settings?.owner_capital),
      bank_loan: toNum(settings?.bank_loan),
      reserve_target_months: toNum(settings?.reserve_target_months || 0),
    };

    const r = await apiPut("/api/admin/donas/finance/settings", payload, "admin");
    setSettings(r || null);

    await load(); // этого достаточно
  } catch (e) {
    console.error("[FinanceOverview] saveSettings error:", e);
    setError(e?.message || "Failed to save");
  } finally {
    setSaving(false);
  }
}

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-2xl border bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div>
        <div className="text-sm text-gray-500">Admin</div>
        <div className="text-2xl font-bold">Dona’s Dosas — Finance</div>
        <div className="text-sm text-gray-500">
          Overview: реальные итоги по Months (snapshots) + демо-сценарии через Cash Start
        </div>
      </div>

      {/* Settings */}
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">Settings</div>
            <div className="text-sm text-gray-500">
              Cash Start = Owner capital + Bank loan. Это влияет на cash_end, runway и визуализацию для инвестора.
            </div>
          </div>
          <button
            className="rounded-full bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
            onClick={saveSettings}
            disabled={saving || loading}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div>
            <div className="text-xs text-gray-500">Currency</div>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={settings?.currency || "UZS"}
              onChange={(e) => setSettings((s) => ({ ...(s || {}), currency: e.target.value }))}
            />
          </div>

          <div>
            <div className="text-xs text-gray-500">Cash Start (Owner + Bank)</div>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 bg-gray-50"
              value={cashStartComputed}
              disabled
            />
          </div>

          <div>
            <div className="text-xs text-gray-500">Owner capital (added to Cash Start)</div>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={settings?.owner_capital ?? 0}
              onChange={(e) => setSettings((s) => ({ ...(s || {}), owner_capital: e.target.value }))}
            />
          </div>

          <div>
            <div className="text-xs text-gray-500">Bank loan (added to Cash Start)</div>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={settings?.bank_loan ?? 0}
              onChange={(e) => setSettings((s) => ({ ...(s || {}), bank_loan: e.target.value }))}
            />
          </div>
        </div>
      </div>

      {/* Months preview */}
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
                    <td className="py-2 pr-4">
                      {fmt(toNum(m.revenue) - toNum(m.cogs) - toNum(m.opex) - toNum(m.capex) - toNum(m.loan_paid))}
                    </td>
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
