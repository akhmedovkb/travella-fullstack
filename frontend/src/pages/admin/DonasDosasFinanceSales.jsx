// frontend/src/pages/admin/DonasDosasFinanceSales.jsx
import { useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../../api";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function money(n) {
  return Math.round(toNum(n)).toLocaleString("ru-RU");
}
function pct(n) {
  const v = toNum(n);
  // 2 знака, но без лишнего мусора
  return (Math.round(v * 100) / 100).toLocaleString("ru-RU");
}
function isYm(s) {
  return /^\d{4}-\d{2}$/.test(String(s || ""));
}
function ymFromDateLike(x) {
  const s = String(x || "");
  if (!s) return "";
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  return "";
}
function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function DonasDosasFinanceSales() {
  const [rows, setRows] = useState([]);
  const [month, setMonth] = useState(() => {
    // default: текущий месяц
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  });

  const [menuItems, setMenuItems] = useState([]); // id, name
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const [editingId, setEditingId] = useState(null);

  const [draft, setDraft] = useState({
    sold_at: todayIso(),
    menu_item_id: "",
    qty: 1,
    unit_price: 0,
    channel: "cash",
    notes: "",
  });

  async function loadMenuItems() {
    // если у тебя другой endpoint — поменяй здесь (я оставил максимально мягко)
    // 1) пробуем /api/admin/donas/menu-items
    // 2) если 404 — просто оставим пусто (можно вводить id руками, но UI скрывает)
    try {
      const r = await apiGet("/api/admin/donas/menu-items");
      const arr = Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : [];
      setMenuItems(arr.map((x) => ({ id: x.id, name: x.name })));
    } catch {
      setMenuItems([]);
    }
  }

  async function loadSales() {
    if (month && !isYm(month)) {
      setErr("Месяц должен быть в формате YYYY-MM");
      return;
    }
    setLoading(true);
    setErr("");
    try {
      const q = month ? `?month=${encodeURIComponent(month)}` : "";
      const r = await apiGet(`/api/admin/donas/sales${q}`);
      setRows(Array.isArray(r) ? r : []);
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to load sales");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMenuItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadSales();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const sorted = useMemo(() => {
    const a = Array.isArray(rows) ? rows.slice() : [];
    a.sort((x, y) => String(y.sold_at || "").localeCompare(String(x.sold_at || "")));
    return a;
  }, [rows]);

  const totals = useMemo(() => {
    const t = { revenue: 0, cogs: 0, profit: 0 };
    for (const r of rows || []) {
      t.revenue += toNum(r.revenue_total);
      t.cogs += toNum(r.cogs_total);
      t.profit += toNum(r.profit_total);
    }
    const margin = t.revenue === 0 ? 0 : (t.profit / t.revenue) * 100;
    return { ...t, margin };
  }, [rows]);

  function resetDraft() {
    setEditingId(null);
    setDraft({
      sold_at: todayIso(),
      menu_item_id: "",
      qty: 1,
      unit_price: 0,
      channel: "cash",
      notes: "",
    });
  }

  function startEdit(r) {
    setErr("");
    setOk("");
    setEditingId(r.id);

    setDraft({
      sold_at: String(r.sold_at || "").slice(0, 10) || todayIso(),
      menu_item_id: r.menu_item_id ?? "",
      qty: r.qty ?? 1,
      unit_price: r.unit_price ?? 0,
      channel: r.channel || "cash",
      notes: r.notes || "",
    });
  }

  async function save() {
    // validations
    const sold_at = String(draft.sold_at || "").trim();
    const menu_item_id = Number(draft.menu_item_id);
    const qty = toNum(draft.qty);
    const unit_price = toNum(draft.unit_price);
    const channel = String(draft.channel || "cash").trim() || "cash";
    const notes = draft.notes == null ? null : String(draft.notes);

    if (!sold_at) return setErr("sold_at обязателен");
    if (!Number.isFinite(menu_item_id) || menu_item_id <= 0) return setErr("Выбери блюдо (menu_item)");
    if (qty <= 0) return setErr("qty должно быть > 0");

    try {
      setSaving(true);
      setErr("");

      if (editingId) {
        await apiPut(`/api/admin/donas/sales/${editingId}`, {
          sold_at,
          menu_item_id,
          qty,
          unit_price,
          channel,
          notes,
        });
        setOk("Сохранено ✅");
      } else {
        await apiPost(`/api/admin/donas/sales`, {
          sold_at,
          menu_item_id,
          qty,
          unit_price,
          channel,
          notes,
        });
        setOk("Добавлено ✅");
      }

      setTimeout(() => setOk(""), 1500);
      resetDraft();
      await loadSales();
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to save sale");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    if (!id) return;
    if (!confirm("Удалить продажу?")) return;

    try {
      setSaving(true);
      setErr("");
      await apiDelete(`/api/admin/donas/sales/${id}`);
      setOk("Удалено ✅");
      setTimeout(() => setOk(""), 1500);
      if (editingId === id) resetDraft();
      await loadSales();
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to delete sale");
    } finally {
      setSaving(false);
    }
  }

  async function recalcCogsMonth() {
    if (!month || !isYm(month)) {
      setErr("Укажи месяц YYYY-MM для Recalc COGS");
      return;
    }
    if (!confirm(`Recalc COGS для ${month}? Это обновит COGS/Profit/Margin у продаж месяца.`)) return;

    try {
      setSaving(true);
      setErr("");
      const r = await apiPost(`/api/admin/donas/sales/recalc-cogs?month=${encodeURIComponent(month)}`, {});
      const updated = r?.updated ?? r?.data?.updated ?? 0;
      setOk(`Recalc COGS ✅ updated: ${updated}`);
      setTimeout(() => setOk(""), 2000);
      await loadSales();
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to recalc cogs");
    } finally {
      setSaving(false);
    }
  }

  const menuNameById = useMemo(() => {
    const m = new Map();
    for (const it of menuItems || []) m.set(Number(it.id), it.name);
    return m;
  }, [menuItems]);

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Dona’s Dosas — Sales</h1>
          <p className="text-sm text-gray-600">
            Продажи по дате. Revenue/COGS/Profit/Margin считаются на сервере. Месяц #locked блокирует изменения.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50"
            onClick={recalcCogsMonth}
            disabled={loading || saving}
            title="Пересчитать COGS/Profit/Margin у продаж месяца по последнему donas_cogs"
          >
            Recalc COGS (month)
          </button>

          <button
            type="button"
            className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
            onClick={loadSales}
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

      {/* Filter + totals */}
      <div className="border rounded-2xl bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-end gap-3">
            <label className="text-xs text-gray-600">
              <div className="mb-1">Month (YYYY-MM)</div>
              <input
                className="border rounded-lg px-3 py-2 bg-white"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                placeholder="2026-02"
                disabled={saving}
              />
            </label>

            <button
              type="button"
              className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
              onClick={() => setMonth("")}
              disabled={saving}
              title="Показать все месяцы"
            >
              All
            </button>
          </div>

          <div className="text-sm text-gray-700 flex flex-wrap gap-4">
            <div>
              <span className="text-gray-500">Revenue:</span> <b>{money(totals.revenue)}</b>
            </div>
            <div>
              <span className="text-gray-500">COGS:</span> <b>{money(totals.cogs)}</b>
            </div>
            <div>
              <span className="text-gray-500">Profit:</span> <b>{money(totals.profit)}</b>
            </div>
            <div>
              <span className="text-gray-500">Margin:</span> <b>{pct(totals.margin)}%</b>
            </div>
          </div>
        </div>

        {/* Add/Edit form */}
        <div className="border rounded-2xl p-4 bg-white space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">
                {editingId ? `Edit sale #${editingId}` : "Add sale"}
              </div>
              <div className="text-xs text-gray-500">
                При сохранении сервер возьмёт COGS из последнего donas_cogs и посчитает Profit/Margin.
              </div>
            </div>

            {editingId && (
              <button
                type="button"
                className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
                onClick={resetDraft}
                disabled={saving}
              >
                Cancel edit
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <label className="text-xs text-gray-600 md:col-span-1">
              <div className="mb-1">Sold at</div>
              <input
                type="date"
                className="w-full border rounded-lg px-3 py-2 bg-white"
                value={draft.sold_at}
                onChange={(e) => setDraft((d) => ({ ...d, sold_at: e.target.value }))}
                disabled={saving}
              />
            </label>

            <label className="text-xs text-gray-600 md:col-span-2">
              <div className="mb-1">Menu item</div>
              <select
                className="w-full border rounded-lg px-3 py-2 bg-white"
                value={draft.menu_item_id}
                onChange={(e) => setDraft((d) => ({ ...d, menu_item_id: e.target.value }))}
                disabled={saving}
              >
                <option value="">— select —</option>
                {(menuItems || []).map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </select>
              {!menuItems.length && (
                <div className="mt-1 text-[11px] text-gray-400">
                  menu-items endpoint не найден → добавь его или скажи мне какой у тебя путь.
                </div>
              )}
            </label>

            <label className="text-xs text-gray-600">
              <div className="mb-1">Qty</div>
              <input
                className="w-full border rounded-lg px-3 py-2 bg-white"
                value={draft.qty}
                onChange={(e) => setDraft((d) => ({ ...d, qty: e.target.value }))}
                inputMode="numeric"
                disabled={saving}
              />
            </label>

            <label className="text-xs text-gray-600">
              <div className="mb-1">Unit price</div>
              <input
                className="w-full border rounded-lg px-3 py-2 bg-white"
                value={draft.unit_price}
                onChange={(e) => setDraft((d) => ({ ...d, unit_price: e.target.value }))}
                inputMode="numeric"
                disabled={saving}
              />
            </label>

            <label className="text-xs text-gray-600">
              <div className="mb-1">Channel</div>
              <select
                className="w-full border rounded-lg px-3 py-2 bg-white"
                value={draft.channel}
                onChange={(e) => setDraft((d) => ({ ...d, channel: e.target.value }))}
                disabled={saving}
              >
                <option value="cash">cash</option>
                <option value="card">card</option>
                <option value="delivery">delivery</option>
                <option value="online">online</option>
              </select>
            </label>

            <label className="text-xs text-gray-600 col-span-2 md:col-span-6">
              <div className="mb-1">Notes</div>
              <input
                className="w-full border rounded-lg px-3 py-2 bg-white"
                value={draft.notes || ""}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                disabled={saving}
              />
            </label>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className="px-4 py-2 rounded-lg bg-black text-white hover:bg-gray-900 disabled:opacity-50"
              onClick={save}
              disabled={saving}
            >
              {saving ? "Saving…" : editingId ? "Save" : "Add"}
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-auto border rounded-xl">
          <table className="min-w-[1200px] w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-3 py-2">Sold at</th>
                <th className="text-left px-3 py-2">Item</th>
                <th className="text-right px-3 py-2">Qty</th>
                <th className="text-right px-3 py-2">Unit</th>
                <th className="text-right px-3 py-2">Revenue</th>
                <th className="text-right px-3 py-2">COGS</th>
                <th className="text-right px-3 py-2">Profit</th>
                <th className="text-right px-3 py-2">Margin %</th>
                <th className="text-left px-3 py-2">Channel</th>
                <th className="text-left px-3 py-2">Notes</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const sold = String(r.sold_at || "").replace("T", " ").slice(0, 19);
                const name = r.menu_item_name || menuNameById.get(Number(r.menu_item_id)) || `#${r.menu_item_id}`;
                const ym = ymFromDateLike(r.sold_at);

                return (
                  <tr key={r.id} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span>{sold.slice(0, 10)}</span>
                        {ym && <span className="text-[10px] px-2 py-0.5 rounded-full border bg-white">{ym}</span>}
                      </div>
                    </td>

                    <td className="px-3 py-2 font-medium">{name}</td>
                    <td className="px-3 py-2 text-right">{toNum(r.qty)}</td>
                    <td className="px-3 py-2 text-right">{money(r.unit_price)}</td>
                    <td className="px-3 py-2 text-right">{money(r.revenue_total)}</td>
                    <td className="px-3 py-2 text-right">{money(r.cogs_total)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{money(r.profit_total)}</td>
                    <td className="px-3 py-2 text-right">{pct(r.margin_pct)}%</td>
                    <td className="px-3 py-2">{r.channel || "-"}</td>
                    <td className="px-3 py-2 text-xs text-gray-600 max-w-[260px] truncate">
                      {String(r.notes || "")}
                    </td>

                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
                          onClick={() => startEdit(r)}
                          disabled={saving}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
                          onClick={() => remove(r.id)}
                          disabled={saving}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {loading && (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              )}

              {!loading && !sorted.length && (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-gray-500">
                    Нет продаж за выбранный период.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-gray-500">
          Подсказка: если у тебя менялись рецепты/COGS, нажми <b>Recalc COGS (month)</b> для месяца —
          тогда Profit/Margin в Sales и агрегаты в Months станут консистентными.
        </div>
      </div>
    </div>
  );
}
