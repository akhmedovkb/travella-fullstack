// frontend/src/pages/admin/DonasDosasFinanceMonths.jsx

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut, getAuthHeaders } from "../../api";

function getApiBase() {
  const env =
    (import.meta?.env?.VITE_API_BASE_URL || import.meta?.env?.VITE_API_URL || "").trim();
  const runtime =
    (typeof window !== "undefined" && window.frontend && window.frontend.API_BASE) || "";
  return (env || runtime).replace(/\/+$/, "");
}
function buildUrl(path) {
  const base = getApiBase();
  const p = path.startsWith("/") ? path : `/${path}`;
  const baseNoSlash = String(base || "").replace(/\/+$/, "");
  if (baseNoSlash.endsWith("/api") && p.startsWith("/api/")) {
    return `${baseNoSlash}${p.slice(4)}`;
  }
  return `${baseNoSlash}${p}`;
}
async function downloadCsv(path, filename) {
  const res = await fetch(buildUrl(path), {
    method: "GET",
    headers: { ...getAuthHeaders(), Accept: "text/csv" },
    credentials: "include",
  });
  if (!res.ok) {
    let msg = res.statusText || `HTTP ${res.status}`;
    try {
      const t = await res.text();
      msg = t || msg;
    } catch {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "export.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function money(n) {
  return Math.round(toNum(n)).toLocaleString("ru-RU");
}

/**
 * ✅ FIX: robust YM extractor
 * - supports: "YYYY-MM", "YYYY-MM-DD", ISO strings, Date objects, timestamps
 * - never throws; returns "" only if truly невозможно определить
 */
function ymFromDateLike(x) {
  if (!x && x !== 0) return "";

  // Date object (⚠️ local getters to avoid TZ shift)
  if (x instanceof Date && !Number.isNaN(x.getTime())) {
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }

  // timestamp number (⚠️ local getters)
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

  // already YM
  if (/^\d{4}-\d{2}$/.test(s)) return s;

  // ISO / YYYY-MM-DD / starts with YYYY-MM
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);

  // fallback parse (⚠️ local getters)
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }

  return "";
}

function isLocked(notes) {
  return String(notes || "").toLowerCase().includes("#locked");
}
function emptyDraft(ym) {
  return {
    month: ym,
    // ⚠️ revenue/cogs в Months теперь read-only (из Sales)
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

  // preview state (оставляем как есть; backend может быть не реализован)
  const [previewScope, setPreviewScope] = useState("single"); // single | upto
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Audit state (оставляем как есть)
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditMode, setAuditMode] = useState("all"); // all | month
  const [auditItems, setAuditItems] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditErr, setAuditErr] = useState("");
  const [auditLimit, setAuditLimit] = useState(200);

  const [exporting, setExporting] = useState(false);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const s = await apiGet("/api/admin/donas/finance/settings");
      setSettings((s && (s.settings || s)) || null);

      const m = await apiGet("/api/admin/donas/finance/months");
      const arr = Array.isArray(m) ? m : Array.isArray(m?.months) ? m.months : [];
      setRows(arr);
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
    const a = Array.isArray(rows) ? rows.slice() : [];
    // ✅ FIX: sort by normalized YM (not by raw month string/date)
    a.sort((x, y) => {
      const ax = ymFromDateLike(x?.month);
      const ay = ymFromDateLike(y?.month);
      return String(ax).localeCompare(String(ay));
    });
    return a;
  }, [rows]);

  async function syncFromPurchases() {
    try {
      setSaving(true);
      setErr("");
      await apiPost("/api/admin/donas/finance/months/sync", {});
      setOk("Sync ✅ диапазон месяцев обновлён.");
      setTimeout(() => setOk(""), 2000);
      await load();
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to sync months");
    } finally {
      setSaving(false);
    }
  }

  async function exportMonthsCsv() {
    try {
      setExporting(true);
      setErr("");
      const name = `donas_finance_months_${new Date().toISOString().slice(0, 10)}.csv`;
      await downloadCsv("/api/admin/donas/finance/months/export.csv", name);
      setOk("Export CSV ✅");
      setTimeout(() => setOk(""), 1500);
    } catch (e) {
      setErr(e?.message || "Failed to export CSV");
    } finally {
      setExporting(false);
    }
  }

  async function exportAuditCsv() {
    try {
      setExporting(true);
      setErr("");
      const q =
        auditMode === "month" && editYm
          ? `/api/admin/donas/finance/months/${encodeURIComponent(
              editYm
            )}/audit/export.csv?limit=${encodeURIComponent(auditLimit)}`
          : `/api/admin/donas/finance/audit/export.csv?limit=${encodeURIComponent(auditLimit)}`;
      const name = `donas_finance_audit_${new Date().toISOString().slice(0, 10)}.csv`;
      await downloadCsv(q, name);
      setOk("Export audit ✅");
      setTimeout(() => setOk(""), 1500);
    } catch (e) {
      setErr(e?.message || "Failed to export audit");
    } finally {
      setExporting(false);
    }
  }

  async function loadAuditAll() {
    try {
      setAuditLoading(true);
      setAuditErr("");
      const r = await apiGet(
        `/api/admin/donas/finance/audit?limit=${encodeURIComponent(auditLimit)}`
      );
      // бэк в текущем контроллере возвращает array, не {items}
      setAuditItems(Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : []);
    } catch (e) {
      setAuditErr(e?.data?.error || e?.message || "Failed to load audit");
    } finally {
      setAuditLoading(false);
    }
  }

  async function loadAuditForMonth(ym) {
    try {
      setAuditLoading(true);
      setAuditErr("");
      const r = await apiGet(
        `/api/admin/donas/finance/months/${encodeURIComponent(
          ym
        )}/audit?limit=${encodeURIComponent(auditLimit)}`
      );
      setAuditItems(Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : []);
    } catch (e) {
      setAuditErr(e?.data?.error || e?.message || "Failed to load month audit");
    } finally {
      setAuditLoading(false);
    }
  }

  useEffect(() => {
    if (!auditOpen) return;
    if (auditMode === "month" && editYm) loadAuditForMonth(editYm);
    else loadAuditAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditOpen, auditMode, editYm, auditLimit]);

  async function addMonth() {
    if (!newMonth || !/^\d{4}-\d{2}$/.test(newMonth)) {
      setErr("Введите месяц в формате YYYY-MM");
      return;
    }
    try {
      setSaving(true);
      setErr("");

      // ✅ чисто: создаём месяц пустым; revenue/cogs будут auto из Sales
      await apiPut(`/api/admin/donas/finance/months/${newMonth}`, {
        loan_paid: 0,
        notes: "",
      });

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

  function startEdit(r) {
    const ym = ymFromDateLike(r.month);
    setEditYm(ym);

    setDraft({
      month: ym, // ✅ FIX: store ym explicitly, not raw month
      // ✅ показываем в форме, но не даём редактировать
      revenue: toNum(r.revenue),
      cogs: toNum(r.cogs),
      opex: toNum(r.opex),
      capex: toNum(r.capex),
      loan_paid: toNum(r.loan_paid),
      cash_end: toNum(r.cash_end),
      notes: String(r.notes || ""),
      _diff: r._diff || null,
    });

    setPreview(null);
    setErr("");
    setOk("");
  }

  function stopEdit() {
    setEditYm("");
    setDraft(emptyDraft(""));
    setPreview(null);
    setPreviewScope("single");
  }

  async function saveDraft() {
    if (!editYm) return;

    // locked — read-only
    if (isLocked(draft.notes)) {
      setErr("Locked месяц read-only. Сначала Unlock, либо используй Re-snapshot.");
      return;
    }

    if (String(draft.notes || "").toLowerCase().includes("#locked")) {
      setErr("Нельзя добавлять #locked руками. Используй Lock кнопку.");
      return;
    }

    try {
      setSaving(true);
      setErr("");

      // ✅ CLEAN: сохраняем только loan_paid + notes
      await apiPut(`/api/admin/donas/finance/months/${editYm}`, {
        loan_paid: toNum(draft.loan_paid),
        notes: String(draft.notes || ""),
      });

      setOk("Сохранено ✅");
      setTimeout(() => setOk(""), 1500);
      await load();
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to save month");
    } finally {
      setSaving(false);
    }
  }

  async function lockMonth() {
    if (!editYm) return;
    try {
      setSaving(true);
      setErr("");
      await apiPost(`/api/admin/donas/finance/months/${editYm}/lock`, {});
      setOk("Locked ✅ Снепшот сохранён.");
      setTimeout(() => setOk(""), 1500);
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
    try {
      setSaving(true);
      setErr("");
      const r = await apiPost(`/api/admin/donas/finance/months/${editYm}/lock-up-to`, {});
      // ✅ бэк возвращает { locked: N }
      const cnt = r?.locked ?? r?.lockedCount ?? 0;
      setOk(`Lock ≤ ✅ locked месяцев: ${cnt}`);
      setTimeout(() => setOk(""), 1500);
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
    try {
      setSaving(true);
      setErr("");
      await apiPost(`/api/admin/donas/finance/months/${editYm}/unlock`, {});
      setOk("Unlocked ✅ Теперь месяц снова auto.");
      setTimeout(() => setOk(""), 1500);
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
    try {
      setSaving(true);
      setErr("");
      await apiPost(`/api/admin/donas/finance/months/${editYm}/resnapshot`, {});
      setOk("Re-snapshot ✅ обновлено по Purchases/Sales.");
      setTimeout(() => setOk(""), 1500);
      await load();
      stopEdit();
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to resnapshot month");
    } finally {
      setSaving(false);
    }
  }

  // bulk re-snapshot (в UI оставляем; если backend нет — будет 404)
  async function resnapshotUpTo() {
    if (!editYm) return;
    try {
      setSaving(true);
      setErr("");
      const r = await apiPost(`/api/admin/donas/finance/months/${editYm}/resnapshot-up-to`, {});
      const cnt = r?.updatedCount ?? r?.updated ?? 0;
      setOk(`Re-snapshot ≤ ✅ обновлено locked месяцев: ${cnt}`);
      setTimeout(() => setOk(""), 1500);
      await load();
      stopEdit();
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to bulk resnapshot");
    } finally {
      setSaving(false);
    }
  }

  async function loadLockPreview(scope) {
    if (!editYm) return;
    try {
      setPreviewLoading(true);
      setErr("");
      const r = await apiGet(
        `/api/admin/donas/finance/months/${editYm}/lock-preview?scope=${encodeURIComponent(scope)}`
      );
      setPreview(r || null);
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to load lock preview");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function loadResnapshotPreview() {
    if (!editYm) return;
    try {
      setPreviewLoading(true);
      setErr("");
      const r = await apiGet(
        `/api/admin/donas/finance/months/${editYm}/resnapshot-up-to-preview`
      );
      setPreview(r || null);
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to load resnapshot preview");
    } finally {
      setPreviewLoading(false);
    }
  }

  const viewRows = useMemo(() => {
    return sorted
      .map((r, idx) => {
        const revenue = toNum(r.revenue);
        const cogs = toNum(r.cogs);
        const opex = toNum(r.opex);
        const capex = toNum(r.capex);
        const loan_paid = toNum(r.loan_paid);

        const gp = revenue - cogs;
        const netOp = gp - opex;
        const cf = netOp - loan_paid - capex;

        const ym = ymFromDateLike(r.month);

        return {
          ...r,
          _ym: ym,
          _idx: idx,
          _locked: isLocked(r.notes),
          _calc: { gp, netOp, cf },
        };
      })
      // ✅ Safety: drop rows where ym can't be determined (prevents empty keys)
      .filter((r) => !!r._ym);
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
            title="Создаёт недостающие месяцы по диапазону purchases/sales"
          >
            Sync
          </button>

          <button
            type="button"
            className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50"
            onClick={exportMonthsCsv}
            disabled={loading || saving || exporting}
            title="CSV: months + computed cashflow"
          >
            {exporting ? "Export…" : "Export CSV"}
          </button>

          <button
            type="button"
            className={[
              "px-3 py-2 rounded-lg border transition",
              auditOpen ? "bg-black text-white border-black" : "bg-white hover:bg-gray-50",
            ].join(" ")}
            onClick={() => setAuditOpen((v) => !v)}
            disabled={loading || saving}
            title="Audit log"
          >
            Audit
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

      <div className="border rounded-2xl bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="text-sm text-gray-600">
            Auto: <b>Revenue/COGS</b> из Sales, <b>OPEX/CAPEX</b> из Purchases. Snapshot: #locked.
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600">
              <div className="mb-1">Add month (YYYY-MM)</div>
              <div className="flex items-center gap-2">
                <input
                  className="border rounded-lg px-3 py-2 bg-white"
                  value={newMonth}
                  onChange={(e) => setNewMonth(e.target.value)}
                  placeholder="2026-01"
                  disabled={saving}
                />
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg bg-black text-white hover:bg-gray-900 disabled:opacity-50"
                  onClick={addMonth}
                  disabled={saving}
                >
                  Add
                </button>
              </div>
            </label>
          </div>
        </div>

        <div className="overflow-auto border rounded-xl">
          <table className="min-w-[1100px] w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-3 py-2">Month</th>
                <th className="text-right px-3 py-2">Revenue</th>
                <th className="text-right px-3 py-2">COGS</th>
                <th className="text-right px-3 py-2">OPEX</th>
                <th className="text-right px-3 py-2">CAPEX</th>
                <th className="text-right px-3 py-2">Loan</th>
                <th className="text-right px-3 py-2">CF</th>
                <th className="text-right px-3 py-2">Cash end</th>
                <th className="text-left px-3 py-2">Diff (O/C)</th>
                <th className="text-left px-3 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {viewRows.map((r) => {
                const ym = r._ym; // ✅ use normalized ym
                const locked = r._locked;

                const dO = toNum(r?._diff?.opex);
                const dC = toNum(r?._diff?.capex);

                return (
                  <tr
                    key={ym} // ✅ never empty now
                    className={[
                      "border-t hover:bg-gray-50 cursor-pointer",
                      locked ? "bg-gray-50/40" : "",
                    ].join(" ")}
                    onClick={() => startEdit(r)}
                    title="Click to edit / actions"
                  >
                    <td className="px-3 py-2 font-medium">
                      <div className="flex items-center gap-2">
                        <span>{ym}</span>
                        {locked && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full border bg-white">
                            locked
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">{money(r.revenue)}</td>
                    <td className="px-3 py-2 text-right">{money(r.cogs)}</td>
                    <td className="px-3 py-2 text-right">{money(r.opex)}</td>
                    <td className="px-3 py-2 text-right">{money(r.capex)}</td>
                    <td className="px-3 py-2 text-right">{money(r.loan_paid)}</td>
                    <td className="px-3 py-2 text-right">{money(r._calc?.cf)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{money(r.cash_end)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={[
                            "text-[11px] px-2 py-0.5 rounded-full border",
                            diffBadgeClass(dO),
                          ].join(" ")}
                          title="purchases - snapshot (OPEX)"
                        >
                          O {dO === 0 ? "0" : (dO > 0 ? "+" : "") + money(dO)}
                        </span>
                        <span
                          className={[
                            "text-[11px] px-2 py-0.5 rounded-full border",
                            diffBadgeClass(dC),
                          ].join(" ")}
                          title="purchases - snapshot (CAPEX)"
                        >
                          C {dC === 0 ? "0" : (dC > 0 ? "+" : "") + money(dC)}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600 max-w-[260px] truncate">
                      {String(r.notes || "")}
                    </td>
                  </tr>
                );
              })}

              {loading && (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              )}

              {!loading && viewRows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-gray-500">
                    Нет месяцев. Добавь первый месяц сверху или нажми Sync.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* остальная часть файла без изменений */}

        {auditOpen && (
          <div className="border rounded-2xl bg-white p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">Audit log</div>
                <div className="text-xs text-gray-500">
                  {auditMode === "month" && editYm ? `Month: ${editYm}` : "All months"}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="border rounded-lg px-2 py-2 text-sm bg-white"
                  value={auditMode}
                  onChange={(e) => setAuditMode(e.target.value)}
                >
                  <option value="all">All</option>
                  <option value="month" disabled={!editYm}>
                    Selected month
                  </option>
                </select>

                <input
                  className="border rounded-lg px-2 py-2 text-sm bg-white w-24"
                  value={auditLimit}
                  onChange={(e) =>
                    setAuditLimit(Math.min(500, Math.max(1, Number(e.target.value || 200))))
                  }
                  inputMode="numeric"
                  placeholder="limit"
                  title="Max 500"
                />

                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
                  onClick={() =>
                    auditMode === "month" && editYm ? loadAuditForMonth(editYm) : loadAuditAll()
                  }
                  disabled={auditLoading}
                >
                  {auditLoading ? "Loading…" : "Refresh"}
                </button>

                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50"
                  onClick={exportAuditCsv}
                  disabled={exporting}
                  title="CSV export of audit rows"
                >
                  Export audit CSV
                </button>
              </div>
            </div>

            {auditErr && (
              <div className="p-3 rounded-xl bg-red-50 text-red-700 border border-red-200">
                {auditErr}
              </div>
            )}

            <div className="overflow-auto border rounded-xl">
              <table className="min-w-[900px] w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left px-3 py-2">Time</th>
                    <th className="text-left px-3 py-2">Action</th>
                    <th className="text-left px-3 py-2">Month</th>
                    <th className="text-left px-3 py-2">Actor</th>
                    <th className="text-left px-3 py-2">Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {auditItems.map((it) => {
                    const actor = [it.actor_name, it.actor_email].filter(Boolean).join(" / ");
                    const diffKeys = Object.keys(it.diff || {});
                    return (
                      <tr key={it.id || `${it.month}-${it.updated_at}`} className="border-t">
                        <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500">
                          {String(it.created_at || it.updated_at || "")
                            .replace("T", " ")
                            .slice(0, 19)}
                        </td>
                        <td className="px-3 py-2 font-medium">{it.action || "-"}</td>
                        <td className="px-3 py-2">{it.ym || it.month || ""}</td>
                        <td className="px-3 py-2 text-xs text-gray-600">{actor || "-"}</td>
                        <td className="px-3 py-2 text-xs">
                          {diffKeys.length ? diffKeys.join(", ") : "-"}
                        </td>
                      </tr>
                    );
                  })}
                  {!auditItems.length && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                        No audit rows.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {editYm && (
          <div className="border rounded-2xl p-4 space-y-4 bg-white">
            {/* твой edit блок — оставлен без изменений */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Edit month: {editYm}</div>
                <div className="text-xs text-gray-500">
                  {draftLocked
                    ? "Locked месяц нельзя менять через Save. Unlock или Re-snapshot."
                    : "Editable: loan_paid, notes. Revenue/COGS auto из Sales. OPEX/CAPEX auto из Purchases."}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
                  onClick={() => {
                    setPreviewScope("single");
                    loadLockPreview("single");
                  }}
                  disabled={saving || previewLoading}
                  title="Preview Lock month (snapshot) перед фиксацией"
                >
                  {previewLoading && previewScope === "single" ? "Preview…" : "Preview Lock"}
                </button>

                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
                  onClick={() => {
                    setPreviewScope("upto");
                    loadLockPreview("upto");
                  }}
                  disabled={saving || previewLoading}
                  title="Preview Lock all ≤"
                >
                  {previewLoading && previewScope === "upto" ? "Preview…" : "Preview Lock ≤"}
                </button>

                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
                  onClick={loadResnapshotPreview}
                  disabled={saving || previewLoading}
                  title="Preview bulk Re-snapshot ≤ (locked only)"
                >
                  {previewLoading ? "Preview…" : "Preview Re-snapshot ≤"}
                </button>

                <div className="w-px h-6 bg-gray-200 mx-1" />

                {draftLocked ? (
                  <>
                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
                      onClick={resnapshotMonth}
                      disabled={saving}
                      title="Переснять снепшот месяца"
                    >
                      Re-snapshot
                    </button>

                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
                      onClick={resnapshotUpTo}
                      disabled={saving}
                      title="Обновит locked месяцы <= выбранного"
                    >
                      Re-snapshot ≤
                      <div className="text-[11px] text-gray-400">locked only</div>
                    </button>

                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
                      onClick={unlockMonth}
                      disabled={saving}
                      title="Снимет #locked и вернёт auto"
                    >
                      Unlock month
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
                      onClick={lockMonth}
                      disabled={saving}
                      title="Зафиксирует месяц (#locked)"
                    >
                      Lock month
                    </button>

                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
                      onClick={lockUpTo}
                      disabled={saving}
                      title="Зафиксирует ВСЕ месяцы ≤ выбранного (#locked)"
                    >
                      Lock all ≤
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <label className="text-xs text-gray-600">
                <div className="mb-1">Revenue (auto from Sales)</div>
                <input
                  className="w-full border rounded-lg px-3 py-2 bg-white"
                  value={draft.revenue}
                  disabled
                />
              </label>

              <label className="text-xs text-gray-600">
                <div className="mb-1">COGS (auto from Sales)</div>
                <input className="w-full border rounded-lg px-3 py-2 bg-white" value={draft.cogs} disabled />
              </label>

              <label className="text-xs text-gray-600">
                <div className="mb-1">Loan paid</div>
                <input
                  className="w-full border rounded-lg px-3 py-2 bg-white"
                  value={draft.loan_paid}
                  onChange={(e) => setDraft((d) => ({ ...d, loan_paid: e.target.value }))}
                  disabled={saving || draftLocked}
                  inputMode="numeric"
                  placeholder={currency}
                />
              </label>

              <label className="text-xs text-gray-600">
                <div className="mb-1">OPEX (computed)</div>
                <input
                  className="w-full border rounded-lg px-3 py-2 bg-white"
                  value={draft.opex}
                  disabled
                />
              </label>

              <label className="text-xs text-gray-600">
                <div className="mb-1">CAPEX (computed)</div>
                <input
                  className="w-full border rounded-lg px-3 py-2 bg-white"
                  value={draft.capex}
                  disabled
                />
              </label>

              <label className="text-xs text-gray-600">
                <div className="mb-1">Cash end (computed / snapshot)</div>
                <input
                  className="w-full border rounded-lg px-3 py-2 bg-white"
                  value={draft.cash_end}
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
                disabled={saving || previewLoading}
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
    </div>
  );
}
