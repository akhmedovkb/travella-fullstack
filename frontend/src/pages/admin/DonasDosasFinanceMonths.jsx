// frontend/src/pages/admin/DonasDosasFinanceMonths.jsx

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut } from "../../api";

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
    _diff: null,
  };
}
function diffBadgeClass(v) {
  const n = toNum(v);
  if (n > 0) return "bg-red-50 text-red-700 border-red-200";
  if (n < 0) return "bg-green-50 text-green-700 border-green-200";
  return "bg-gray-50 text-gray-700 border-gray-200";
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

  // lock preview
  const [previewScope, setPreviewScope] = useState("single"); // single | upto
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // resnapshot ≤ preview (locked only)
  const [resnapPreview, setResnapPreview] = useState(null);
  const [resnapPreviewLoading, setResnapPreviewLoading] = useState(false);

  // audit modal
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditItems, setAuditItems] = useState([]);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const s = await apiGet("/api/admin/donas/finance/settings");
      setSettings(s || null);

      const m = await apiGet("/api/admin/donas/finance/months");
      setRows(Array.isArray(m) ? m : []);
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to load months");
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
      _diff: r?._diff || null,
    });

    setPreview(null);
    setResnapPreview(null);
    setPreviewScope("single");
    setErr("");
    setOk("");
    setAuditOpen(false);
    setAuditItems([]);
  }

  function stopEdit() {
    setEditYm("");
    setDraft(emptyDraft(""));
    setPreview(null);
    setResnapPreview(null);
    setPreviewScope("single");
    setAuditOpen(false);
    setAuditItems([]);
  }

  async function syncFromPurchases() {
    setSaving(true);
    setErr("");
    setOk("");
    try {
      await apiPost("/api/admin/donas/finance/months/sync", {});
      setOk("Sync ✅ диапазон месяцев обновлён.");
      setTimeout(() => setOk(""), 2500);
      await load();
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to sync months");
    } finally {
      setSaving(false);
    }
  }

  async function lockMonth() {
    if (!editYm) return;
    setSaving(true);
    setErr("");
    setOk("");
    try {
      await apiPost(`/api/admin/donas/finance/months/${editYm}/lock`, {});
      setOk("Locked ✅ Месяц зафиксирован (snapshot).");
      setTimeout(() => setOk(""), 2500);
      await load();
      stopEdit();
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to lock month");
    } finally {
      setSaving(false);
    }
  }

  async function lockUpTo() {
    if (!editYm) return;
    setSaving(true);
    setErr("");
    setOk("");
    try {
      const r = await apiPost(`/api/admin/donas/finance/months/${editYm}/lock-up-to`, {});
      const cnt = r?.lockedCount ?? 0;
      setOk(`Locked ✅ Закрыто месяцев: ${cnt}`);
      setTimeout(() => setOk(""), 2600);
      await load();
      stopEdit();
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to lock months up to selected");
    } finally {
      setSaving(false);
    }
  }

  async function unlockMonth() {
    if (!editYm) return;
    setSaving(true);
    setErr("");
    setOk("");
    try {
      await apiPost(`/api/admin/donas/finance/months/${editYm}/unlock`, {});
      setOk("Unlocked ✅ Теперь месяц снова auto.");
      setTimeout(() => setOk(""), 2500);
      await load();
      stopEdit();
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to unlock month");
    } finally {
      setSaving(false);
    }
  }

  async function resnapshotMonth() {
    if (!editYm) return;
    setSaving(true);
    setErr("");
    setOk("");
    try {
      await apiPost(`/api/admin/donas/finance/months/${editYm}/resnapshot`, {});
      setOk("Re-snapshot ✅ Снапшот обновлён.");
      setTimeout(() => setOk(""), 2600);
      await load();
      stopEdit();
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to resnapshot month");
    } finally {
      setSaving(false);
    }
  }

  async function resnapshotUpTo() {
    if (!editYm) return;
    setSaving(true);
    setErr("");
    setOk("");
    try {
      const r = await apiPost(`/api/admin/donas/finance/months/${editYm}/resnapshot-up-to`, {});
      const cnt = r?.updatedCount ?? 0;
      setOk(`Re-snapshot ≤ ✅ обновлено locked месяцев: ${cnt}`);
      setTimeout(() => setOk(""), 2800);
      await load();
      stopEdit();
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to bulk resnapshot");
    } finally {
      setSaving(false);
    }
  }

  async function loadPreview(scope) {
    if (!editYm) return;
    setPreviewLoading(true);
    setErr("");
    setOk("");
    try {
      const r = await apiGet(
        `/api/admin/donas/finance/months/${editYm}/lock-preview?scope=${encodeURIComponent(scope)}`
      );
      setPreview(r || null);
      setResnapPreview(null);
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to load preview");
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function loadResnapPreview() {
    if (!editYm) return;
    setResnapPreviewLoading(true);
    setErr("");
    setOk("");
    try {
      const r = await apiGet(`/api/admin/donas/finance/months/${editYm}/resnapshot-up-to-preview`);
      setResnapPreview(r || null);
      setPreview(null);
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to load resnapshot preview");
      setResnapPreview(null);
    } finally {
      setResnapPreviewLoading(false);
    }
  }

  async function openAudit() {
    if (!editYm) return;
    setAuditOpen(true);
    setAuditLoading(true);
    setErr("");
    try {
      const r = await apiGet(`/api/admin/donas/finance/months/${editYm}/audit?limit=200`);
      setAuditItems(Array.isArray(r?.items) ? r.items : []);
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to load audit");
      setAuditItems([]);
    } finally {
      setAuditLoading(false);
    }
  }

  function closeAudit() {
    setAuditOpen(false);
    setAuditItems([]);
    setAuditLoading(false);
  }

  async function saveDraft() {
    if (!editYm) return;

    if (isLocked(draft.notes)) {
      setErr("Locked месяц read-only. Сначала Unlock, либо используй Re-snapshot.");
      return;
    }

    if (String(draft.notes || "").toLowerCase().includes("#locked")) {
      setErr("Лочить через notes нельзя. Используй кнопки Lock / Lock ≤.");
      return;
    }

    setSaving(true);
    setErr("");
    setOk("");
    try {
      const payload = {
        revenue: toNum(draft.revenue),
        cogs: toNum(draft.cogs),
        loan_paid: toNum(draft.loan_paid),
        notes: String(draft.notes || ""),
      };

      await apiPut(`/api/admin/donas/finance/months/${editYm}`, payload);

      setOk("Сохранено ✅");
      setTimeout(() => setOk(""), 2000);

      await load();
      stopEdit();
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to save month");
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
      setErr(e?.data?.error || e?.message || "Failed to add month");
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

  const draftLocked = isLocked(draft.notes);

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Dona’s Dosas — Months</h1>
          <p className="text-sm text-gray-600">
            План/факт по месяцам и цепочка cash_end (валюта: {currency})
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
            onClick={syncFromPurchases}
            disabled={loading || saving}
            title="Создаёт недостающие месяцы по диапазону donas_purchases"
          >
            Sync
          </button>

          <button
            type="button"
            className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
            onClick={load}
            disabled={loading || saving}
          >
            Обновить
          </button>
        </div>
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
            Auto: OPEX/CAPEX из Purchases. Snapshot: #locked (read-only).
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
                <th className="py-2 pr-4 text-right">
                  Diff (P−S)
                  <div className="text-[11px] text-gray-400">locked only</div>
                </th>
                <th className="py-2 pr-4">Notes</th>
                <th className="py-2 pr-2 text-right"> </th>
              </tr>
            </thead>

            <tbody>
              {viewRows.map((r) => {
                const locked = r._locked;
                const diffO = toNum(r?._diff?.opex);
                const diffC = toNum(r?._diff?.capex);

                return (
                  <tr key={`${r.slug || "donas"}-${r._ym}`} className="border-b last:border-b-0">
                    <td className="py-2 pr-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r._ym || "—"}</span>
                        {locked ? (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 border border-gray-200">
                            snapshot
                          </span>
                        ) : (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                            auto
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

                    <td className="py-2 pr-4 text-right whitespace-nowrap">
                      {locked ? (
                        <div className="inline-flex flex-col items-end gap-1">
                          <span className={`text-[11px] px-2 py-0.5 rounded-full border ${diffBadgeClass(diffO)}`}>
                            O: {money(diffO)}
                          </span>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full border ${diffBadgeClass(diffC)}`}>
                            C: {money(diffC)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>

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
                );
              })}

              {!loading && viewRows.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-6 text-center text-gray-500">
                    Нет месяцев. Добавь первый месяц сверху или нажми Sync.
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
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold">Редактирование: {editYm}</div>
                  {draftLocked ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 border border-gray-200">
                      snapshot (read-only)
                    </span>
                  ) : (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                      auto
                    </span>
                  )}
                </div>

                <div className="text-xs text-gray-500">
                  {draftLocked
                    ? "Locked месяц нельзя менять через Save. Unlock или Re-snapshot."
                    : "Auto: OPEX/CAPEX берутся из Purchases, cash_end считается на сервере."}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50"
                  onClick={openAudit}
                  disabled={saving || auditLoading}
                  title="История действий"
                >
                  {auditLoading && auditOpen ? "Audit…" : "Audit"}
                </button>

                {!draftLocked ? (
                  <>
                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50"
                      onClick={() => {
                        setPreviewScope("single");
                        loadPreview("single");
                      }}
                      disabled={saving || previewLoading}
                      title="Покажет что будет при Lock month"
                    >
                      {previewLoading && previewScope === "single" ? "Preview…" : "Preview Lock"}
                    </button>

                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50"
                      onClick={() => {
                        setPreviewScope("upto");
                        loadPreview("upto");
                      }}
                      disabled={saving || previewLoading}
                      title="Покажет что будет при Lock all ≤ this month"
                    >
                      {previewLoading && previewScope === "upto" ? "Preview…" : "Preview Lock ≤"}
                    </button>

                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50"
                      onClick={lockMonth}
                      disabled={saving}
                      title="Зафиксировать (snapshot) этот месяц"
                    >
                      Lock month
                    </button>

                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50"
                      onClick={lockUpTo}
                      disabled={saving}
                      title="Зафиксировать (snapshot) все месяцы ≤ этого"
                    >
                      Lock all ≤
                    </button>

                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg bg-black text-white hover:bg-gray-900 disabled:opacity-50"
                      onClick={saveDraft}
                      disabled={saving}
                    >
                      Save
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50"
                      onClick={loadResnapPreview}
                      disabled={saving || resnapPreviewLoading}
                      title="Preview bulk re-snapshot ≤"
                    >
                      {resnapPreviewLoading ? "Preview…" : "Preview Re-snapshot ≤"}
                    </button>

                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50"
                      onClick={resnapshotMonth}
                      disabled={saving}
                    >
                      Re-snapshot
                    </button>

                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50"
                      onClick={resnapshotUpTo}
                      disabled={saving}
                      title="Обновить snapshot-значения у locked месяцев ≤ этого"
                    >
                      Re-snapshot ≤
                    </button>

                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50"
                      onClick={unlockMonth}
                      disabled={saving}
                    >
                      Unlock
                    </button>
                  </>
                )}

                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50"
                  onClick={stopEdit}
                  disabled={saving || previewLoading || resnapPreviewLoading || auditLoading}
                >
                  Close
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-gray-600 mb-1">Revenue</div>
                <input
                  type="number"
                  className="w-full border rounded-lg px-3 py-2"
                  value={draft.revenue}
                  onChange={(e) => setDraft((p) => ({ ...p, revenue: e.target.value }))}
                  disabled={draftLocked || saving}
                />
              </div>

              <div>
                <div className="text-xs text-gray-600 mb-1">COGS</div>
                <input
                  type="number"
                  className="w-full border rounded-lg px-3 py-2"
                  value={draft.cogs}
                  onChange={(e) => setDraft((p) => ({ ...p, cogs: e.target.value }))}
                  disabled={draftLocked || saving}
                />
              </div>

              <div>
                <div className="text-xs text-gray-600 mb-1">Loan paid</div>
                <input
                  type="number"
                  className="w-full border rounded-lg px-3 py-2"
                  value={draft.loan_paid}
                  onChange={(e) => setDraft((p) => ({ ...p, loan_paid: e.target.value }))}
                  disabled={draftLocked || saving}
                />
              </div>

              <div>
                <div className="text-xs text-gray-600 mb-1">Notes</div>
                <input
                  type="text"
                  className="w-full border rounded-lg px-3 py-2"
                  value={draft.notes}
                  onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))}
                  disabled={draftLocked || saving}
                />
              </div>
            </div>

            {preview && (
              <div className="rounded-2xl border border-gray-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">
                    Preview ({preview.scope}) → target: {preview.targetYm}
                  </div>
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
                    onClick={() => setPreview(null)}
                  >
                    Hide
                  </button>
                </div>

                <div className="mt-2 text-xs text-gray-600">
                  Δ cash_end at target:{" "}
                  <span className="font-semibold">{money(preview?.summary?.deltaCashEndAtTarget)}</span>{" "}
                  (current {money(preview?.summary?.currentCashEndAtTarget)} → planned{" "}
                  {money(preview?.summary?.plannedCashEndAtTarget)})
                </div>

                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-600 border-b">
                        <th className="py-2 pr-3">YM</th>
                        <th className="py-2 pr-3 text-right">Purch OPEX</th>
                        <th className="py-2 pr-3 text-right">Snap OPEX</th>
                        <th className="py-2 pr-3 text-right">Δ OPEX</th>
                        <th className="py-2 pr-3 text-right">Purch CAPEX</th>
                        <th className="py-2 pr-3 text-right">Snap CAPEX</th>
                        <th className="py-2 pr-3 text-right">Δ CAPEX</th>
                        <th className="py-2 pr-3 text-right">Cash end (planned)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(preview.items || []).map((it) => (
                        <tr key={it.ym} className="border-b last:border-b-0">
                          <td className="py-2 pr-3 font-medium">{it.ym}</td>
                          <td className="py-2 pr-3 text-right">{money(it.purchases?.opex)}</td>
                          <td className="py-2 pr-3 text-right">{money(it.snapshot?.opex)}</td>
                          <td className="py-2 pr-3 text-right">{money(it.diff?.opex)}</td>
                          <td className="py-2 pr-3 text-right">{money(it.purchases?.capex)}</td>
                          <td className="py-2 pr-3 text-right">{money(it.snapshot?.capex)}</td>
                          <td className="py-2 pr-3 text-right">{money(it.diff?.capex)}</td>
                          <td className="py-2 pr-3 text-right">{money(it.planned?.cash_end)}</td>
                        </tr>
                      ))}
                      {(preview.items || []).length === 0 && (
                        <tr>
                          <td colSpan={8} className="py-4 text-center text-gray-500">
                            Нет строк.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {resnapPreview && (
              <div className="rounded-2xl border border-gray-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">
                    Preview Re-snapshot ≤ → target: {resnapPreview.targetYm}
                  </div>
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
                    onClick={() => setResnapPreview(null)}
                  >
                    Hide
                  </button>
                </div>

                <div className="mt-2 text-xs text-gray-600">
                  affected locked months:{" "}
                  <span className="font-semibold">{resnapPreview?.summary?.affectedLockedCount ?? 0}</span>
                  {" · "}
                  Δ cash_end at target:{" "}
                  <span className="font-semibold">{money(resnapPreview?.summary?.deltaCashEndAtTarget)}</span>
                  {" (current "}
                  {money(resnapPreview?.summary?.currentCashEndAtTarget)}
                  {" → planned "}
                  {money(resnapPreview?.summary?.plannedCashEndAtTarget)}
                  {")"}
                </div>

                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-600 border-b">
                        <th className="py-2 pr-3">YM</th>
                        <th className="py-2 pr-3 text-right">Purch O</th>
                        <th className="py-2 pr-3 text-right">Snap O (before)</th>
                        <th className="py-2 pr-3 text-right">Snap O (after)</th>
                        <th className="py-2 pr-3 text-right">Purch C</th>
                        <th className="py-2 pr-3 text-right">Snap C (before)</th>
                        <th className="py-2 pr-3 text-right">Snap C (after)</th>
                        <th className="py-2 pr-3 text-right">Δ cash_end</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(resnapPreview.items || []).map((it) => (
                        <tr key={it.ym} className="border-b last:border-b-0">
                          <td className="py-2 pr-3 font-medium">{it.ym}</td>
                          <td className="py-2 pr-3 text-right">{money(it.purchases?.opex)}</td>
                          <td className="py-2 pr-3 text-right">{money(it.snapshot_before?.opex)}</td>
                          <td className="py-2 pr-3 text-right">{money(it.snapshot_after?.opex)}</td>
                          <td className="py-2 pr-3 text-right">{money(it.purchases?.capex)}</td>
                          <td className="py-2 pr-3 text-right">{money(it.snapshot_before?.capex)}</td>
                          <td className="py-2 pr-3 text-right">{money(it.snapshot_after?.capex)}</td>
                          <td className="py-2 pr-3 text-right">{money(it.delta_cash_end)}</td>
                        </tr>
                      ))}
                      {(resnapPreview.items || []).length === 0 && (
                        <tr>
                          <td colSpan={8} className="py-4 text-center text-gray-500">
                            Нет locked месяцев ≤ target.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {auditOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={closeAudit} />
          <div className="relative w-full max-w-4xl rounded-2xl bg-white border border-gray-200 shadow-xl">
            <div className="flex items-start justify-between gap-3 p-4 border-b">
              <div>
                <div className="text-sm font-semibold">Audit: {editYm}</div>
                <div className="text-xs text-gray-500">Последние 200 событий</div>
              </div>
              <button
                type="button"
                className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
                onClick={closeAudit}
              >
                Закрыть
              </button>
            </div>

            <div className="p-4 max-h-[70vh] overflow-auto">
              {auditItems.length === 0 ? (
                <div className="text-sm text-gray-500">Пусто.</div>
              ) : (
                <div className="space-y-3">
                  {auditItems.map((it) => (
                    <div key={it.id} className="rounded-xl border border-gray-200 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 border border-gray-200">
                            {it.action}
                          </span>
                          <span className="text-xs text-gray-500">
                            {new Date(it.created_at).toLocaleString("ru-RU")}
                          </span>
                        </div>

                        <div className="text-xs text-gray-600">
                          {it.actor_name || it.actor_email || (it.actor_role ? `(${it.actor_role})` : "")}
                        </div>
                      </div>

                      {it.meta && (
                        <pre className="mt-2 text-[11px] bg-gray-50 border border-gray-200 rounded-lg p-2 overflow-auto">
{JSON.stringify(it.meta, null, 2)}
                        </pre>
                      )}

                      {it.diff && Object.keys(it.diff || {}).length > 0 && (
                        <pre className="mt-2 text-[11px] bg-white border border-gray-200 rounded-lg p-2 overflow-auto">
{JSON.stringify(it.diff, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
