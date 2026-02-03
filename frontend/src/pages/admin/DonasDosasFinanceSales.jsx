// frontend/src/pages/admin/DonasDosasFinanceSales.jsx
import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "../../api";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n) {
  const v = Math.round(toNum(n));
  return v.toLocaleString("ru-RU");
}

function ymNow() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function dateISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export default function DonasDosasFinanceSales() {
  const [month, setMonth] = useState(ymNow());
  const [rows, setRows] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null); // row or null

  const [form, setForm] = useState({
    sold_at: dateISO(new Date()),
    menu_item_id: "",
    qty: 1,
    unit_price: 0,
    channel: "cash",
    notes: "",
  });

  const profitTotal = useMemo(() => {
    return rows.reduce((acc, r) => acc + (toNum(r.revenue_total) - toNum(r.cogs_total)), 0);
  }, [rows]);

  async function loadMenuItems() {
    // если у тебя есть endpoint меню — отлично.
    // В проекте чаще всего он есть: GET /api/admin/donas/menu-items
    try {
      const items = await apiGet("/api/admin/donas/menu-items");
      if (Array.isArray(items)) setMenuItems(items);
    } catch {
      // если эндпоинта нет — просто оставим пустым, можно вводить ID вручную
      setMenuItems([]);
    }
  }

  async function load() {
    setErr("");
    setLoading(true);
    try {
      const data = await apiGet(`/api/admin/donas/sales?month=${encodeURIComponent(month)}`);
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setRows([]);
      setErr(e?.message || "Failed to load sales");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMenuItems();
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  function openAdd() {
    setEditing(null);
    setForm({
      sold_at: `${month}-01`,
      menu_item_id: "",
      qty: 1,
      unit_price: 0,
      channel: "cash",
      notes: "",
    });
    setOpen(true);
  }

  function openEdit(r) {
    setEditing(r);
    setForm({
      sold_at: String(r.sold_at || "").slice(0, 10) || `${month}-01`,
      menu_item_id: String(r.menu_item_id ?? ""),
      qty: toNum(r.qty),
      unit_price: toNum(r.unit_price),
      channel: String(r.channel || "cash"),
      notes: r.notes == null ? "" : String(r.notes),
    });
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
    setEditing(null);
  }

  async function save() {
    setErr("");
    const payload = {
      sold_at: form.sold_at,
      menu_item_id: Number(form.menu_item_id),
      qty: toNum(form.qty),
      unit_price: toNum(form.unit_price),
      channel: String(form.channel || "cash"),
      notes: form.notes ? String(form.notes) : null,
    };

    if (!payload.sold_at) return setErr("sold_at required");
    if (!payload.menu_item_id) return setErr("menu_item_id required");

    setLoading(true);
    try {
      if (editing?.id) {
        await apiPut(`/api/admin/donas/sales/${editing.id}`, payload);
      } else {
        await apiPost(`/api/admin/donas/sales`, payload);
      }
      closeModal();
      await load();
    } catch (e) {
      setErr(e?.message || "Save failed");
    } finally {
      setLoading(false);
    }
  }

  async function remove(id) {
    if (!id) return;
    if (!confirm("Delete this sale?")) return;

    setErr("");
    setLoading(true);
    try {
      await apiDelete(`/api/admin/donas/sales/${id}`);
      await load();
    } catch (e) {
      setErr(e?.message || "Delete failed");
    } finally {
      setLoading(false);
    }
  }

  const totals = useMemo(() => {
    const revenue = rows.reduce((acc, r) => acc + toNum(r.revenue_total), 0);
    const cogs = rows.reduce((acc, r) => acc + toNum(r.cogs_total), 0);
    const profit = revenue - cogs;
    const margin = revenue > 0 ? (profit / revenue) * 100 : null;
    return { revenue, cogs, profit, margin };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <div className="text-xs text-gray-500 mb-1">Month (YYYY-MM)</div>
            <input
              className="border rounded-lg px-3 py-2 text-sm w-[140px]"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              placeholder="2026-02"
            />
          </div>

          <button
            className="px-3 py-2 rounded-lg bg-black text-white text-sm"
            onClick={openAdd}
            disabled={loading}
          >
            Add sale
          </button>

          <button
            className="px-3 py-2 rounded-lg border text-sm"
            onClick={load}
            disabled={loading}
          >
            Refresh
          </button>
        </div>

        <div className="text-sm text-gray-600">
          <span className="mr-4">Revenue: <b>{fmt(totals.revenue)}</b></span>
          <span className="mr-4">COGS: <b>{fmt(totals.cogs)}</b></span>
          <span className="mr-4">Profit: <b>{fmt(totals.profit)}</b></span>
          <span>
            Margin: <b>{totals.margin == null ? "—" : `${totals.margin.toFixed(1)}%`}</b>
          </span>
        </div>
      </div>

      {err ? (
        <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">
          {err}
        </div>
      ) : null}

      <div className="rounded-2xl border bg-white overflow-auto">
        <table className="min-w-[1100px] w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left">
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">Price</th>
              <th className="px-3 py-2">Revenue</th>
              <th className="px-3 py-2">COGS</th>
              <th className="px-3 py-2">Profit</th>
              <th className="px-3 py-2">Margin</th>
              <th className="px-3 py-2">Channel</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-gray-500" colSpan={10}>
                  {loading ? "Loading..." : "No sales"}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const revenue = toNum(r.revenue_total);
                const cogs = toNum(r.cogs_total);
                const profit = revenue - cogs;
                const margin = revenue > 0 ? (profit / revenue) * 100 : null;

                return (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {String(r.sold_at || "").slice(0, 10)}
                    </td>

                    <td className="px-3 py-2">
                      <div className="font-medium">{r.menu_item_name || `#${r.menu_item_id}`}</div>
                      <div className="text-xs text-gray-500">id: {r.id} / item: {r.menu_item_id}</div>
                    </td>

                    <td className="px-3 py-2">{toNum(r.qty)}</td>
                    <td className="px-3 py-2">{fmt(r.unit_price)}</td>

                    <td className="px-3 py-2 font-medium">{fmt(revenue)}</td>
                    <td className="px-3 py-2">{fmt(cogs)}</td>

                    <td className="px-3 py-2 font-medium">{fmt(profit)}</td>
                    <td className="px-3 py-2">{margin == null ? "—" : `${margin.toFixed(1)}%`}</td>

                    <td className="px-3 py-2">{r.channel || "cash"}</td>

                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        className="px-2 py-1 rounded-lg border text-xs mr-2"
                        onClick={() => openEdit(r)}
                        disabled={loading}
                      >
                        Edit
                      </button>
                      <button
                        className="px-2 py-1 rounded-lg border text-xs text-red-600"
                        onClick={() => remove(r.id)}
                        disabled={loading}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>

          <tfoot className="bg-gray-50 border-t">
            <tr>
              <td className="px-3 py-2 font-medium" colSpan={4}>Total</td>
              <td className="px-3 py-2 font-medium">{fmt(totals.revenue)}</td>
              <td className="px-3 py-2 font-medium">{fmt(totals.cogs)}</td>
              <td className="px-3 py-2 font-medium">{fmt(totals.profit)}</td>
              <td className="px-3 py-2 font-medium">{totals.margin == null ? "—" : `${totals.margin.toFixed(1)}%`}</td>
              <td className="px-3 py-2" colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Modal */}
      {open ? (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-xl rounded-2xl bg-white border shadow-lg">
            <div className="p-4 border-b flex items-center justify-between">
              <div className="font-semibold">
                {editing ? `Edit sale #${editing.id}` : "Add sale"}
              </div>
              <button className="text-sm px-2 py-1 rounded-lg border" onClick={closeModal}>
                Close
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-gray-500 mb-1">sold_at</div>
                  <input
                    type="date"
                    className="border rounded-lg px-3 py-2 text-sm w-full"
                    value={form.sold_at}
                    onChange={(e) => setForm((s) => ({ ...s, sold_at: e.target.value }))}
                  />
                </div>

                <div>
                  <div className="text-xs text-gray-500 mb-1">channel</div>
                  <select
                    className="border rounded-lg px-3 py-2 text-sm w-full"
                    value={form.channel}
                    onChange={(e) => setForm((s) => ({ ...s, channel: e.target.value }))}
                  >
                    <option value="cash">cash</option>
                    <option value="card">card</option>
                    <option value="click">click</option>
                    <option value="payme">payme</option>
                    <option value="other">other</option>
                  </select>
                </div>

                <div className="col-span-2">
                  <div className="text-xs text-gray-500 mb-1">menu_item</div>
                  {menuItems.length ? (
                    <select
                      className="border rounded-lg px-3 py-2 text-sm w-full"
                      value={form.menu_item_id}
                      onChange={(e) => setForm((s) => ({ ...s, menu_item_id: e.target.value }))}
                    >
                      <option value="">Choose item…</option>
                      {menuItems.map((mi) => (
                        <option key={mi.id} value={mi.id}>
                          #{mi.id} — {mi.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="border rounded-lg px-3 py-2 text-sm w-full"
                      value={form.menu_item_id}
                      onChange={(e) => setForm((s) => ({ ...s, menu_item_id: e.target.value }))}
                      placeholder="menu_item_id (number)"
                    />
                  )}
                </div>

                <div>
                  <div className="text-xs text-gray-500 mb-1">qty</div>
                  <input
                    type="number"
                    className="border rounded-lg px-3 py-2 text-sm w-full"
                    value={form.qty}
                    onChange={(e) => setForm((s) => ({ ...s, qty: e.target.value }))}
                  />
                </div>

                <div>
                  <div className="text-xs text-gray-500 mb-1">unit_price</div>
                  <input
                    type="number"
                    className="border rounded-lg px-3 py-2 text-sm w-full"
                    value={form.unit_price}
                    onChange={(e) => setForm((s) => ({ ...s, unit_price: e.target.value }))}
                  />
                </div>

                <div className="col-span-2">
                  <div className="text-xs text-gray-500 mb-1">notes</div>
                  <textarea
                    className="border rounded-lg px-3 py-2 text-sm w-full"
                    rows={3}
                    value={form.notes}
                    onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
                    placeholder="optional"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button className="px-3 py-2 rounded-lg border text-sm" onClick={closeModal}>
                  Cancel
                </button>
                <button
                  className="px-3 py-2 rounded-lg bg-black text-white text-sm"
                  onClick={save}
                  disabled={loading}
                >
                  Save
                </button>
              </div>

              <div className="text-xs text-gray-500">
                * If month is <b>#locked</b> backend will return 409 (edit/delete/add disabled).
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
