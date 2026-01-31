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
function isoFromYm(ym) {
  const m = ymFromDateLike(ym);
  return m ? `${m}-01` : "";
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
function cls(...a) {
  return a.filter(Boolean).join(" ");
}
function safeJson(x) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x ?? "");
  }
}
function fmtTime(ts) {
  const s = String(ts || "");
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("ru-RU");
}
function compactActor(it) {
  const a = it || {};
  const role = a.actor_role ? String(a.actor_role) : "";
  const email = a.actor_email ? String(a.actor_email) : "";
  const name = a.actor_name ? String(a.actor_name) : "";
  const id = a.actor_id != null ? String(a.actor_id) : "";
  const parts = [];
  if (name) parts.push(name);
  if (email) parts.push(email);
  if (role) parts.push(role);
  if (id) parts.push(`#${id}`);
  return parts.join(" • ") || "—";
}
function diffSummary(diff) {
  const d = diff && typeof diff === "object" ? diff : {};
  const keys = Object.keys(d || {});
  if (!keys.length) return "—";
  const order = ["revenue", "cogs", "opex", "capex", "loan_paid", "cash_end", "notes"];
  keys.sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia === -1 && ib === -1) return String(a).localeCompare(String(b));
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return keys.join(", ");
}

function Modal({ open, title, onClose, children, footer }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        role="button"
        tabIndex={0}
        aria-label="Close modal backdrop"
      />
      <div className="relative w-full sm:max-w-3xl mx-auto bg-white rounded-t-2xl sm:rounded-2xl shadow-xl border border-gray-200 max-h-[85vh] overflow-hidden">
        <div className="p-4 border-b border-gray-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{title}</div>
          </div>
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
            onClick={onClose}
          >
            Закрыть
          </button>
        </div>

        <div className="p-4 overflow-auto max-h-[60vh]">{children}</div>

        {footer ? <div className="p-4 border-t border-gray-200 bg-gray-50">{footer}</div> : null}
      </div>
    </div>
  );
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

  // preview state: lock / lock≤
  const [previewScope, setPreviewScope] = useState("single"); // single | upto
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // preview state: resnapshot ≤ (locked only)
  const [resnapPreview, setResnapPreview] = useState(null);
  const [resnapPreviewLoading, setResnapPreviewLoading] = useState(false);

  // audit
  const [auditFrom, setAuditFrom] = useState(""); // YYYY-MM
  const [auditTo, setAuditTo] = useState(""); // YYYY-MM
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditItems, setAuditItems] = useState([]);
  const [auditLimit, setAuditLimit] = useState(200);

  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [auditModalTitle, setAuditModalTitle] = useState("Audit");
  const [auditModalItem, setAuditModalItem] = useState(null);

  const [monthAuditOpen, setMonthAuditOpen] = useState(false);
  const [monthAuditItems, setMonthAuditItems] = useState([]);
  const [monthAuditLoading, setMonthAuditLoading] = useState(false);
  const [monthAuditSelected, setMonthAuditSelected] = useState(null);

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

  async function loadAudit() {
    setAuditLoading(true);
    setErr("");
    try {
      const params = new URLSearchParams();
      if (ymFromDateLike(auditFrom)) params.set("from", ymFromDateLike(auditFrom));
      if (ymFromDateLike(auditTo)) params.set("to", ymFromDateLike(auditTo));
      params.set("limit", String(Math.min(500, Math.max(1, Number(auditLimit || 200)))));

      const r = await apiGet(`/api/admin/donas/finance/audit?${params.toString()}`);
      setAuditItems(Array.isArray(r?.items) ? r.items : []);
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to load audit");
      setAuditItems([]);
    } finally {
      setAuditLoading(false);
    }
  }

  async function loadMonthAudit(ym) {
    const y = ymFromDateLike(ym);
    if (!y) return;

    setMonthAuditOpen(true);
    setMonthAuditSelected(y);
    setMonthAuditLoading(true);
    setErr("");
    try {
      const r = await apiGet(`/api/admin/donas/finance/months/${y}/audit?limit=200`);
      setMonthAuditItems(Array.isArray(r?.items) ? r.items : []);
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to load month audit");
      setMonthAuditItems([]);
    } finally {
      setMonthAuditLoading(false);
    }
  }

  useEffect(() => {
    load();
    loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setPreviewScope("single");
    setResnapPreview(null);

    setErr("");
    setOk("");
  }

  function stopEdit() {
    setEditYm("");
    setDraft(emptyDraft(""));
    setPreview(null);
    setPreviewScope("single");
    setResnapPreview(null);
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
      await loadAudit();
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
      await loadAudit();
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
      await loadAudit();
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
      await loadAudit();
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
      await loadAudit();
      stopEdit();
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to resnapshot month");
    } finally {
      setSaving(false);
    }
  }

  // bulk re-snapshot locked months <= editYm
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
      await loadAudit();
      stopEdit();
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to bulk resnapshot");
    } finally {
      setSaving(false);
    }
  }

  // lock preview
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

  // bulk resnapshot preview
  async function loadResnapshotUpToPreview() {
    if (!editYm) return;
    setResnapPreviewLoading(true);
    setErr("");
    setOk("");
    try {
      const r = await apiGet(
        `/api/admin/donas/finance/months/${editYm}/resnapshot-up-to-preview`
      );
      setResnapPreview(r || null);
      setPreview(null);
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to load resnapshot preview");
      setResnapPreview(null);
    } finally {
      setResnapPreviewLoading(false);
    }
  }

  async function saveDraft() {
    if (!editYm) return;

    if (isLocked(draft.notes)) {
      setErr("Locked месяц read-only. Сначала Unlock, либо используй Re-snapshot.");
      return;
    }

    if (String(draft.notes || "").toLowerCase().includes("#locked")) {
      setErr("Лочить через notes нельзя. Используй кнопку Lock month / Lock all ≤ this month.");
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
      await loadAudit();
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
      await loadAudit();
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

  const selectedRow = useMemo(() => {
    if (!editYm) return null;
    return (rows || []).find((r) => ymFromDateLike(r.month) === editYm) || null;
  }, [editYm, rows]);

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

          <button
            type="button"
            className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
            onClick={loadAudit}
            disabled={auditLoading || saving}
            title="Обновить Audit"
          >
            Audit
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

      {/* Audit */}
      <div className="rounded-2xl bg-white border border-gray-200 p-4 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Audit log</div>
            <div className="text-xs text-gray-500">
              Lock / Unlock / Re-snapshot / Bulk / Sync / Manual updates
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-gray-600">
              <div className="mb-1">From</div>
              <input
                type="month"
                className="border rounded-lg px-3 py-2 bg-white"
                value={auditFrom}
                onChange={(e) => setAuditFrom(e.target.value)}
              />
            </label>

            <label className="text-xs text-gray-600">
              <div className="mb-1">To</div>
              <input
                type="month"
                className="border rounded-lg px-3 py-2 bg-white"
                value={auditTo}
                onChange={(e) => setAuditTo(e.target.value)}
              />
            </label>

            <label className="text-xs text-gray-600">
              <div className="mb-1">Limit</div>
              <input
                className="border rounded-lg px-3 py-2 bg-white w-[110px]"
                value={auditLimit}
                onChange={(e) => setAuditLimit(e.target.value)}
                inputMode="numeric"
              />
            </label>

            <button
              type="button"
              className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50"
              onClick={loadAudit}
              disabled={auditLoading || saving}
            >
              {auditLoading ? "Loading…" : "Apply"}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-left text-gray-600 border-b">
                <th className="py-2 pr-3">Time</th>
                <th className="py-2 pr-3">YM</th>
                <th className="py-2 pr-3">Action</th>
                <th className="py-2 pr-3">Actor</th>
                <th className="py-2 pr-3">Diff keys</th>
                <th className="py-2 pr-2 text-right"> </th>
              </tr>
            </thead>
            <tbody>
              {(auditItems || []).map((it) => {
                const ym = ymFromDateLike(it.ym);
                return (
                  <tr key={`${it.id}`} className="border-b last:border-b-0">
                    <td className="py-2 pr-3 whitespace-nowrap">{fmtTime(it.created_at)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap font-medium">{ym || "—"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-full border bg-gray-50 text-gray-800">
                        {String(it.action || "—")}
                      </span>
                    </td>
                    <td className="py-2 pr-3 max-w-[420px]">
                      <div className="truncate" title={compactActor(it)}>
                        {compactActor(it)}
                      </div>
                    </td>
                    <td className="py-2 pr-3 max-w-[340px]">
                      <div className="truncate" title={diffSummary(it.diff)}>
                        {diffSummary(it.diff)}
                      </div>
                    </td>
                    <td className="py-2 pr-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
                        onClick={() => {
                          setAuditModalItem(it);
                          setAuditModalTitle(`Audit #${it.id} — ${ym || "all"} — ${String(it.action || "")}`);
                          setAuditModalOpen(true);
                        }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}

              {!auditLoading && !auditItems?.length && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-gray-500">
                    Нет audit событий по фильтру.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Months table */}
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
            Auto: OPEX/CAPEX из Purchases. Snapshot: #locked (read-only). Cashflow — server.
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
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-full border ${diffBadgeClass(
                              diffO
                            )}`}
                          >
                            O: {money(diffO)}
                          </span>
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-full border ${diffBadgeClass(
                              diffC
                            )}`}
                          >
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
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
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

                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
                    onClick={() => loadMonthAudit(editYm)}
                    disabled={saving || monthAuditLoading}
                    title="Показать audit для этого месяца"
                  >
                    Month audit
                  </button>

                  {selectedRow?.month ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full border bg-white text-gray-700">
                      {isoFromYm(editYm)}
                    </span>
                  ) : null}
                </div>

                <div className="text-xs text-gray-500">
                  {draftLocked
                    ? "Locked месяц нельзя менять через Save. Unlock или Re-snapshot."
                    : "Auto: OPEX/CAPEX берутся из Purchases, cash_end считается на сервере."}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap justify-end">
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
                      className="px-3 py-2 rounded-lg bg-black text-white hover:bg-gray-900 disabled:opacity-50"
                      onClick={lockMonth}
                      disabled={saving}
                      title="Сразу фиксирует месяц (без preview)"
                    >
                      Lock month
                    </button>

                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50"
                      onClick={lockUpTo}
                      disabled={saving}
                      title="Сразу фиксирует все месяцы <= выбранного (без preview)"
                    >
                      Lock all ≤ this month
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
                      onClick={() => {
                        setPreviewScope("single");
                        loadPreview("single");
                      }}
                      disabled={saving || previewLoading}
                      title="Покажет diff purchases vs snapshot"
                    >
                      {previewLoading ? "Preview…" : "Preview (lock)"}
                    </button>

                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
                      onClick={resnapshotMonth}
                      disabled={saving}
                    >
                      Re-snapshot
                    </button>

                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50"
                      onClick={loadResnapshotUpToPreview}
                      disabled={saving || resnapPreviewLoading}
                      title="Preview bulk resnapshot locked months ≤ this month"
                    >
                      {resnapPreviewLoading ? "Preview…" : "Preview Re-snapshot ≤"}
                    </button>

                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
                      onClick={resnapshotUpTo}
                      disabled={saving}
                      title="Обновит ВСЕ locked месяцы <= выбранного по Purchases (и cash_end цепочкой)"
                    >
                      Re-snapshot ≤
                    </button>

                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
                      onClick={unlockMonth}
                      disabled={saving}
                    >
                      Unlock month
                    </button>
                  </>
                )}

                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
                  onClick={stopEdit}
                  disabled={saving || previewLoading || resnapPreviewLoading}
                >
                  Закрыть
                </button>
              </div>
            </div>

            {/* Preview panel: Lock */}
            {preview?.ok && (
              <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold">
                    Preview: {preview.scope === "upto" ? "Lock all ≤ this month" : "Lock month"} (
                    {preview.targetYm})
                  </div>

                  <div className="text-xs text-gray-600">
                    Δ cash_end@target:{" "}
                    <span
                      className={`px-2 py-0.5 rounded-full border ${diffBadgeClass(
                        preview.summary?.deltaCashEndAtTarget
                      )}`}
                    >
                      {money(preview.summary?.deltaCashEndAtTarget)}
                    </span>
                  </div>
                </div>

                {preview.summary?.targetWasLocked && (
                  <div className="text-xs p-2 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-800">
                    Target месяц уже #locked → Lock не нужен. Если хочешь обновить снепшот по Purchases — жми
                    Re-snapshot (или Re-snapshot ≤).
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="text-gray-600 border-b">
                        <th className="py-2 pr-3 text-left">YM</th>
                        <th className="py-2 pr-3 text-right">Purch OPEX</th>
                        <th className="py-2 pr-3 text-right">Purch CAPEX</th>
                        <th className="py-2 pr-3 text-right">Snap OPEX</th>
                        <th className="py-2 pr-3 text-right">Snap CAPEX</th>
                        <th className="py-2 pr-3 text-right">Diff O</th>
                        <th className="py-2 pr-3 text-right">Diff C</th>
                        <th className="py-2 pr-3 text-right">Cash (cur)</th>
                        <th className="py-2 pr-3 text-right">Cash (plan)</th>
                        <th className="py-2 pr-2 text-left">State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(preview.items || []).map((it) => (
                        <tr key={it.ym} className="border-b last:border-b-0">
                          <td className="py-2 pr-3 font-medium">{it.ym}</td>
                          <td className="py-2 pr-3 text-right">{money(it.purchases?.opex)}</td>
                          <td className="py-2 pr-3 text-right">{money(it.purchases?.capex)}</td>
                          <td className="py-2 pr-3 text-right">{money(it.snapshot?.opex)}</td>
                          <td className="py-2 pr-3 text-right">{money(it.snapshot?.capex)}</td>
                          <td className="py-2 pr-3 text-right">
                            <span
                              className={`px-2 py-0.5 rounded-full border ${diffBadgeClass(
                                it.diff?.opex
                              )}`}
                            >
                              {money(it.diff?.opex)}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-right">
                            <span
                              className={`px-2 py-0.5 rounded-full border ${diffBadgeClass(
                                it.diff?.capex
                              )}`}
                            >
                              {money(it.diff?.capex)}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-right">{money(it.current?.cash_end)}</td>
                          <td className="py-2 pr-3 text-right">{money(it.planned?.cash_end)}</td>
                          <td className="py-2 pr-2">
                            <span className="text-[11px] px-2 py-0.5 rounded-full border bg-gray-50">
                              {it.current?.locked ? "locked" : "auto"} →{" "}
                              {it.planned?.locked ? "locked" : "auto"}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {!preview.items?.length && (
                        <tr>
                          <td colSpan={10} className="py-3 text-center text-gray-500">
                            Нет строк preview.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {!draftLocked && (
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
                      onClick={() => setPreview(null)}
                      disabled={saving}
                    >
                      Закрыть preview
                    </button>

                    {preview.scope === "upto" ? (
                      <button
                        type="button"
                        className="px-3 py-2 rounded-lg bg-black text-white hover:bg-gray-900 disabled:opacity-50"
                        onClick={lockUpTo}
                        disabled={saving}
                        title="Подтвердить фиксацию (Lock all ≤)"
                      >
                        Confirm Lock ≤
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="px-3 py-2 rounded-lg bg-black text-white hover:bg-gray-900 disabled:opacity-50"
                        onClick={lockMonth}
                        disabled={saving}
                        title="Подтвердить фиксацию (Lock month)"
                      >
                        Confirm Lock
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Preview panel: Bulk Re-snapshot ≤ */}
            {resnapPreview?.ok && (
              <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold">
                    Preview: Re-snapshot ≤ (locked only) ({resnapPreview.targetYm})
                  </div>

                  <div className="text-xs text-gray-600">
                    Δ cash_end@target:{" "}
                    <span
                      className={`px-2 py-0.5 rounded-full border ${diffBadgeClass(
                        resnapPreview.summary?.deltaCashEndAtTarget
                      )}`}
                    >
                      {money(resnapPreview.summary?.deltaCashEndAtTarget)}
                    </span>
                  </div>
                </div>

                <div className="text-xs text-gray-600">
                  affected locked:{" "}
                  <span className="px-2 py-0.5 rounded-full border bg-gray-50">
                    {toNum(resnapPreview.summary?.affectedLockedCount)}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="text-gray-600 border-b">
                        <th className="py-2 pr-3 text-left">YM</th>
                        <th className="py-2 pr-3 text-right">Purch OPEX</th>
                        <th className="py-2 pr-3 text-right">Purch CAPEX</th>
                        <th className="py-2 pr-3 text-right">Snap before O</th>
                        <th className="py-2 pr-3 text-right">Snap before C</th>
                        <th className="py-2 pr-3 text-right">Snap after O</th>
                        <th className="py-2 pr-3 text-right">Snap after C</th>
                        <th className="py-2 pr-3 text-right">Δ cash_end</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(resnapPreview.items || []).map((it) => (
                        <tr key={it.ym} className="border-b last:border-b-0">
                          <td className="py-2 pr-3 font-medium">{it.ym}</td>
                          <td className="py-2 pr-3 text-right">{money(it.purchases?.opex)}</td>
                          <td className="py-2 pr-3 text-right">{money(it.purchases?.capex)}</td>
                          <td className="py-2 pr-3 text-right">{money(it.snapshot_before?.opex)}</td>
                          <td className="py-2 pr-3 text-right">{money(it.snapshot_before?.capex)}</td>
                          <td className="py-2 pr-3 text-right">{money(it.snapshot_after?.opex)}</td>
                          <td className="py-2 pr-3 text-right">{money(it.snapshot_after?.capex)}</td>
                          <td className="py-2 pr-3 text-right">
                            <span
                              className={`px-2 py-0.5 rounded-full border ${diffBadgeClass(
                                it.delta_cash_end
                              )}`}
                            >
                              {money(it.delta_cash_end)}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {!resnapPreview.items?.length && (
                        <tr>
                          <td colSpan={8} className="py-3 text-center text-gray-500">
                            Нет строк preview.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
                    onClick={() => setResnapPreview(null)}
                    disabled={saving}
                  >
                    Закрыть preview
                  </button>

                  <button
                    type="button"
                    className="px-3 py-2 rounded-lg bg-black text-white hover:bg-gray-900 disabled:opacity-50"
                    onClick={resnapshotUpTo}
                    disabled={saving}
                    title="Подтвердить bulk resnapshot"
                  >
                    Confirm Re-snapshot ≤
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                ["revenue", "Revenue"],
                ["cogs", "COGS"],
                ["loan_paid", "Loan paid"],
              ].map(([k, label]) => (
                <label key={k} className="text-xs text-gray-600">
                  <div className="mb-1">{label}</div>
                  <input
                    className="w-full border rounded-lg px-3 py-2 bg-white"
                    value={draft[k]}
                    onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                    disabled={saving || draftLocked}
                    inputMode="numeric"
                    placeholder={currency}
                  />
                </label>
              ))}

              <label className="text-xs text-gray-600">
                <div className="mb-1">OPEX (computed)</div>
                <input
                  className="w-full border rounded-lg px-3 py-2 bg-white"
                  value={toNum(selectedRow?.opex)}
                  disabled
                />
              </label>

              <label className="text-xs text-gray-600">
                <div className="mb-1">CAPEX (computed)</div>
                <input
                  className="w-full border rounded-lg px-3 py-2 bg-white"
                  value={toNum(selectedRow?.capex)}
                  disabled
                />
              </label>

              <label className="text-xs text-gray-600">
                <div className="mb-1">Cash end (computed / snapshot)</div>
                <input
                  className="w-full border rounded-lg px-3 py-2 bg-white"
                  value={toNum(selectedRow?.cash_end)}
                  disabled
                />
              </label>

              <label className="text-xs text-gray-600 col-span-2 md:col-span-3">
                <div className="mb-1">Notes</div>
                <input
                  className="w-full border rounded-lg px-3 py-2 bg-white"
                  value={draft.notes}
                  onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                  disabled={saving || draftLocked}
                  placeholder="комментарий (без #locked)"
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="px-4 py-2 rounded-lg border bg-white hover:bg-gray-50"
                onClick={stopEdit}
                disabled={saving || previewLoading || resnapPreviewLoading}
              >
                Отмена
              </button>

              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-black text-white hover:bg-gray-900 disabled:opacity-50"
                onClick={saveDraft}
                disabled={saving || draftLocked}
                title={draftLocked ? "Locked месяц read-only. Unlock или Re-snapshot." : ""}
              >
                {saving ? "Сохраняю…" : "Сохранить"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal: Audit item */}
      <Modal
        open={auditModalOpen}
        title={auditModalTitle}
        onClose={() => {
          setAuditModalOpen(false);
          setAuditModalItem(null);
        }}
        footer={
          auditModalItem?.ym ? (
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-gray-600">
                Month: <span className="font-medium">{ymFromDateLike(auditModalItem.ym)}</span>
              </div>
              <button
                type="button"
                className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
                onClick={() => loadMonthAudit(ymFromDateLike(auditModalItem.ym))}
              >
                Open month audit
              </button>
            </div>
          ) : (
            <div className="text-xs text-gray-600"> </div>
          )
        }
      >
        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="p-3 rounded-xl border bg-gray-50">
              <div className="text-[11px] text-gray-500 mb-1">When</div>
              <div className="font-medium">{fmtTime(auditModalItem?.created_at)}</div>
            </div>
            <div className="p-3 rounded-xl border bg-gray-50">
              <div className="text-[11px] text-gray-500 mb-1">Actor</div>
              <div className="font-medium">{compactActor(auditModalItem)}</div>
            </div>
          </div>

          <div className="p-3 rounded-xl border">
            <div className="text-[11px] text-gray-500 mb-1">Diff</div>
            <pre className="text-[11px] whitespace-pre-wrap break-words">{safeJson(auditModalItem?.diff || {})}</pre>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="p-3 rounded-xl border">
              <div className="text-[11px] text-gray-500 mb-1">Prev</div>
              <pre className="text-[11px] whitespace-pre-wrap break-words">{safeJson(auditModalItem?.prev || null)}</pre>
            </div>
            <div className="p-3 rounded-xl border">
              <div className="text-[11px] text-gray-500 mb-1">Next</div>
              <pre className="text-[11px] whitespace-pre-wrap break-words">{safeJson(auditModalItem?.next || null)}</pre>
            </div>
          </div>

          <div className="p-3 rounded-xl border">
            <div className="text-[11px] text-gray-500 mb-1">Meta</div>
            <pre className="text-[11px] whitespace-pre-wrap break-words">{safeJson(auditModalItem?.meta || null)}</pre>
          </div>
        </div>
      </Modal>

      {/* Modal: Month audit */}
      <Modal
        open={monthAuditOpen}
        title={`Month audit — ${monthAuditSelected || ""}`}
        onClose={() => {
          setMonthAuditOpen(false);
          setMonthAuditItems([]);
          setMonthAuditSelected(null);
        }}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-gray-600">
              Month: <span className="font-medium">{monthAuditSelected || "—"}</span>
            </div>

            <button
              type="button"
              className={cls(
                "px-3 py-2 rounded-lg border bg-white hover:bg-gray-50",
                monthAuditLoading ? "opacity-50" : ""
              )}
              onClick={() => loadMonthAudit(monthAuditSelected)}
              disabled={monthAuditLoading}
            >
              {monthAuditLoading ? "Loading…" : "Refresh"}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left text-gray-600 border-b">
                  <th className="py-2 pr-3">Time</th>
                  <th className="py-2 pr-3">Action</th>
                  <th className="py-2 pr-3">Actor</th>
                  <th className="py-2 pr-3">Diff keys</th>
                  <th className="py-2 pr-2 text-right"> </th>
                </tr>
              </thead>
              <tbody>
                {(monthAuditItems || []).map((it) => (
                  <tr key={`${it.id}`} className="border-b last:border-b-0">
                    <td className="py-2 pr-3 whitespace-nowrap">{fmtTime(it.created_at)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-full border bg-gray-50 text-gray-800">
                        {String(it.action || "—")}
                      </span>
                    </td>
                    <td className="py-2 pr-3 max-w-[420px]">
                      <div className="truncate" title={compactActor(it)}>
                        {compactActor(it)}
                      </div>
                    </td>
                    <td className="py-2 pr-3 max-w-[340px]">
                      <div className="truncate" title={diffSummary(it.diff)}>
                        {diffSummary(it.diff)}
                      </div>
                    </td>
                    <td className="py-2 pr-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
                        onClick={() => {
                          setAuditModalItem(it);
                          setAuditModalTitle(
                            `Audit #${it.id} — ${monthAuditSelected || ""} — ${String(it.action || "")}`
                          );
                          setAuditModalOpen(true);
                        }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}

                {!monthAuditLoading && !monthAuditItems?.length && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-gray-500">
                      Нет audit событий для месяца.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    </div>
  );
}
