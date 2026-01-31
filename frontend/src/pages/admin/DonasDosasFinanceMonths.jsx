// frontend/src/pages/admin/DonasDosasFinanceMonths.jsx

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPut } from "../../api";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function money(n) {
  return Math.round(toNum(n)).toLocaleString("ru-RU");
}

function ymFromDateLike(x) {
  const s = String(x || "");
  if (!s) return "";
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  return "";
}

function isLocked(notes) {
  return String(notes || "").toLowerCase().includes("#locked");
}

function emptyDraft(ym) {
  return {
    month: ym,
    revenue: 0,
    cogs: 0,
    opex: 0,
    capex: 0,
    loan_paid: 0,
    cash_end: 0,
    notes: "",
  };
}

export default function DonasDosasFinanceMonths() {
  const [settings, setSettings] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const [newMonth, setNewMonth] = useState(""); // YYYY-MM
  const [editYm, setEditYm] = useState("");
  const [draft, setDraft] = useState(emptyDraft(""));

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const s = await apiGet("/api/admin/donas/finance/settings");
      setSettings(s || null);

      const m = await apiGet("/api/admin/donas/finance/months");
      setRows(Array.isArray(m) ? m : []);
    } catch (e) {
      setErr(e?.response?.data?.error || e?.message || "Failed to load months");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const currency = settings?.currency || "UZS";

  const sorted = useMemo(() => {
    const arr = [...(rows || [])];
    arr.sort((a, b) => String(a.month || "").localeCompare(String(b.month || "")));
    return arr;
  }, [rows]);

  function startEdit(r) {
    const monthYm = ymFromDateLike(r?.month);
    setEditYm(monthYm);

    setDraft({
      month: monthYm,
      revenue: toNum(r?.revenue),
      cogs: toNum(r?.cogs),
      opex: toNum(r?.opex),
      capex: toNum(r?.capex),
      loan_paid: toNum(r?.loan_paid),
      cash_end: toNum(r?.cash_end),
      notes: String(r?.notes || ""),
    });

    setErr("");
    setOk("");
  }

  function stopEdit() {
    setEditYm("");
    setDraft(emptyDraft(""));
  }

  async function saveDraft() {
    if (!editYm) return;

    setSaving(true);
    setErr("");
    setOk("");
    try {
      const payload = {
        revenue: toNum(draft.revenue),
        cogs: toNum(draft.cogs),
        opex: toNum(draft.opex),
        capex: toNum(draft.capex),
        loan_paid: toNum(draft.loan_paid),
        cash_end: toNum(draft.cash_end),
        notes: String(draft.notes || ""),
      };

      await apiPut(`/api/admin/donas/finance/months/${editYm}`, payload);

      setOk("Сохранено ✅");
      setTimeout(() => setOk(""), 2000);

      await load();
      stopEdit();
    } catch (e) {
      setErr(e?.response?.data?.error || e?.message || "Failed to save month");
    } finally {
      setSaving(false);
    }
  }

  async function addMonth() {
    const m = ymFromDateLike(newMonth);
    if (!m) return;

    const existing = (rows || []).find((r) => ymFromDateLike(r.month) === m);
    if (existing) {
      startEdit(existing);
      return;
    }

    setSaving(true);
    setErr("");
    setOk("");
    try {
      await apiPut(`/api/admin/donas/finance/months/${m}`, emptyDraft(m));
      setNewMonth("");
      setOk("Месяц добавлен ✅");
      setTimeout(() => setOk(""), 2000);
      await load();
    } catch (e) {
      setErr(e?.response?.data?.error || e?.message || "Failed to add month");
    } finally {
      setSaving(false);
    }
  }

  const viewRows = useMemo(() => {
    return sorted.map((r) => {
      const revenue = toNum(r.revenue);
      const cogs = toNum(r.cogs);
      const opex = toNum(r.opex);
      const capex = toNum(r.capex);
      const loan_paid = toNum(r.loan_paid);

      const gp = revenue - cogs;
      const netOp = gp - opex;
      const cf = netOp - loan_paid - capex;

      return {
        ...r,
        _ym: ymFromDateLike(r.month),
        _locked: isLocked(r.notes),
        _calc: { gp, netOp, cf },
      };
    });
  }, [sorted]);

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Dona’s Dosas — Months</h1>
          <p className="text-sm text-gray-600">
            План/факт по месяцам и цепочка cash_end (валюта: {currency})
          </p>
        </div>

        <button
          type="button"
          className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
          onClick={load}
          disabled={loading || saving}
        >
          Обновить
        </button>
      </div>

      {(err || ok) && (
        <div className="space-y-2">
          {err && (
            <div className="p-3 rounded-xl bg-red-50 text-red-700 border border-red-200">
              {err}
            </div>
          )}
          {ok && (
            <div className="p-3 rounded-xl bg-green-50 text-green-700 border border-green-200">
              {ok}
            </div>
          )}
        </div>
      )}

      <div className="rounded-2xl bg-white border border-gray-200 p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px]">
            <div className="text-xs text-gray-600 mb-1">Добавить месяц</div>
            <input
              type="month"
              className="w-full border rounded-lg px-3 py-2"
              value={newMonth}
              onChange={(e) => setNewMonth(e.target.value)}
            />
          </div>

          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-black text-white hover:bg-gray-900 disabled:opacity-50"
            onClick={addMonth}
            disabled={saving || loading || !ymFromDateLike(newMonth)}
          >
            Добавить
          </button>

          <div className="text-xs text-gray-500">
            Чтобы “зафиксировать” месяц: добавь <b>#locked</b> в notes.
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600 border-b">
                <th className="py-2 pr-4">Месяц</th>
                <th className="py-2 pr-4 text-right">Revenue</th>
                <th className="py-2 pr-4 text-right">COGS</th>
                <th className="py-2 pr-4 text-right">OPEX</th>
                <th className="py-2 pr-4 text-right">CAPEX</th>
                <th className="py-2 pr-4 text-right">Loan paid</th>
                <th className="py-2 pr-4 text-right">CF</th>
                <th className="py-2 pr-4 text-right">Cash end</th>
                <th className="py-2 pr-4">Notes</th>
                <th className="py-2 pr-2 text-right"> </th>
              </tr>
            </thead>

            <tbody>
              {viewRows.map((r) => (
                <tr key={`${r.slug || "donas"}-${r._ym}`} className="border-b last:border-b-0">
                  <td className="py-2 pr-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{r._ym || "—"}</span>
                      {r._locked && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 border border-gray-200">
                          locked
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="py-2 pr-4 text-right">{money(r.revenue)}</td>
                  <td className="py-2 pr-4 text-right">{money(r.cogs)}</td>
                  <td className="py-2 pr-4 text-right">{money(r.opex)}</td>
                  <td className="py-2 pr-4 text-right">{money(r.capex)}</td>
                  <td className="py-2 pr-4 text-right">{money(r.loan_paid)}</td>
                  <td
                    className="py-2 pr-4 text-right"
                    title={`GP: ${money(r._calc?.gp)} | NetOp: ${money(r._calc?.netOp)}`}
                  >
                    {money(r._calc?.cf)}
                  </td>
                  <td className="py-2 pr-4 text-right">{money(r.cash_end)}</td>

                  <td className="py-2 pr-4 max-w-[320px]">
                    <div className="truncate" title={String(r.notes || "")}>
                      {String(r.notes || "") || "—"}
                    </div>
                  </td>

                  <td className="py-2 pr-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
                      onClick={() => startEdit(r)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}

              {!loading && viewRows.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-6 text-center text-gray-500">
                    Нет месяцев. Добавь первый месяц сверху.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {editYm && (
          <div className="mt-4 rounded-2xl border border-gray-200 p-4 bg-gray-50 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">Редактирование: {editYm}</div>
                <div className="text-xs text-gray-500">
                  {isLocked(draft.notes)
                    ? "locked: cash_end можно править (снапшот)."
                    : "cash_end считается цепочкой на сервере (после сохранения обнови список)."}
                </div>
              </div>
              <button
                type="button"
                className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
                onClick={stopEdit}
                disabled={saving}
              >
                Закрыть
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                ["revenue", "Revenue"],
                ["cogs", "COGS"],
                ["opex", "OPEX"],
                ["capex", "CAPEX"],
                ["loan_paid", "Loan paid"],
              ].map(([k, label]) => (
                <label key={k} className="text-xs text-gray-600">
                  <div className="mb-1">{label}</div>
                  <input
                    className="w-full border rounded-lg px-3 py-2 bg-white"
                    value={draft[k]}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        [k]: e.target.value,
                      }))
                    }
                    disabled={saving || isLocked(draft.notes)}
                    inputMode="numeric"
                    placeholder={currency}
                  />
                </label>
              ))}

              <label className="text-xs text-gray-600">
                <div className="mb-1">Cash end (manual for locked)</div>
                <input
                  className="w-full border rounded-lg px-3 py-2 bg-white"
                  value={draft.cash_end}
                  onChange={(e) => setDraft((d) => ({ ...d, cash_end: e.target.value }))}
                  disabled={saving || !isLocked(draft.notes)}
                  inputMode="numeric"
                  placeholder={currency}
                />
              </label>

              <label className="text-xs text-gray-600 col-span-2 md:col-span-3">
                <div className="mb-1">Notes</div>
                <input
                  className="w-full border rounded-lg px-3 py-2 bg-white"
                  value={draft.notes}
                  onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                  disabled={saving}
                  placeholder="например: #locked, комментарий..."
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="px-4 py-2 rounded-lg border bg-white hover:bg-gray-50"
                onClick={stopEdit}
                disabled={saving}
              >
                Отмена
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-black text-white hover:bg-gray-900 disabled:opacity-50"
                onClick={saveDraft}
                disabled={saving}
              >
                {saving ? "Сохраняю…" : "Сохранить"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
