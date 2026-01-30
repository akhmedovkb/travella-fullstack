// frontend/src/pages/admin/DonasCapex.jsx

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut } from "../../api";

function ym(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function money(n) {
  const v = Math.round(toNum(n));
  return v.toLocaleString("ru-RU");
}

export default function DonasCapex() {
  const [month, setMonth] = useState(ym());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [rows, setRows] = useState([]);

  const [desc, setDesc] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState("");

  const [editId, setEditId] = useState(null);
  const [edit, setEdit] = useState({ date: "", ingredient: "", qty: "", price: "" });

  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      const list = await apiGet(`/api/admin/donas/purchases?month=${encodeURIComponent(month)}`);
      const only = (Array.isArray(list) ? list : []).filter((x) => String(x.type || "").toLowerCase() === "capex");
      setRows(only);
    } catch (e) {
      setErr(e?.response?.data?.error || e?.message || "Ошибка загрузки");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!alive) return;
      await load();
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const total = useMemo(() => {
    return rows.reduce((acc, r) => acc + toNum(r.qty) * toNum(r.price), 0);
  }, [rows]);

  const resetForm = () => {
    setDesc("");
    setQty("1");
    setPrice("");
    setDate("");
  };

  const add = async () => {
    if (!desc.trim()) return;
    const payload = {
      type: "capex",
      date: date || null,
      ingredient: desc.trim(), // используем это поле как описание CAPEX
      qty: toNum(qty) || 1,
      price: toNum(price) || 0,
    };
    try {
      setLoading(true);
      await apiPost("/api/admin/donas/purchases", payload);
      resetForm();
      await load();
    } catch (e) {
      setErr(e?.response?.data?.error || e?.message || "Ошибка сохранения");
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (r) => {
    setEditId(r.id);
    setEdit({
      date: r.date ? String(r.date).slice(0, 10) : "",
      ingredient: r.ingredient || "",
      qty: String(r.qty ?? ""),
      price: String(r.price ?? ""),
    });
  };

  const cancelEdit = () => {
    setEditId(null);
    setEdit({ date: "", ingredient: "", qty: "", price: "" });
  };

  const saveEdit = async () => {
    if (!editId) return;
    try {
      setLoading(true);
      await apiPut(`/api/admin/donas/purchases/${editId}`, {
        type: "capex",
        date: edit.date || null,
        ingredient: String(edit.ingredient || "").trim(),
        qty: toNum(edit.qty) || 1,
        price: toNum(edit.price) || 0,
      });
      cancelEdit();
      await load();
    } catch (e) {
      setErr(e?.response?.data?.error || e?.message || "Ошибка обновления");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">Donas — CAPEX</div>
          <div className="text-sm text-gray-500">Вложения / оборудование (через purchases type=capex)</div>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Month</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      {err && (
        <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>
      )}

      {/* Add form */}
      <div className="mt-4 rounded-xl border border-gray-200 p-4">
        <div className="text-sm font-semibold mb-3">Добавить CAPEX</div>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Описание (например: Gas griddle / Freezer / Generator)"
            className="md:col-span-6 border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="md:col-span-2 border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="Qty"
            className="md:col-span-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Price (UZS)"
            className="md:col-span-2 border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={add}
            disabled={loading}
            className="md:col-span-1 bg-black text-white rounded-lg px-4 py-2 text-sm hover:bg-black/90 disabled:opacity-50"
          >
            Добавить
          </button>
        </div>
      </div>

      {/* List */}
      <div className="mt-4 rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
          <div className="text-sm font-semibold">CAPEX список</div>
          <div className="text-sm text-gray-600">
            Total: <span className="font-semibold">{money(total)}</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-white border-b">
              <tr className="text-left">
                <th className="px-4 py-2">Дата</th>
                <th className="px-4 py-2">Описание</th>
                <th className="px-4 py-2">Qty</th>
                <th className="px-4 py-2">Price</th>
                <th className="px-4 py-2">Total</th>
                <th className="px-4 py-2 text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rowTotal = toNum(r.qty) * toNum(r.price);
                const isEdit = editId === r.id;
                return (
                  <tr key={r.id} className="border-t">
                    <td className="px-4 py-2 whitespace-nowrap">
                      {isEdit ? (
                        <input
                          type="date"
                          value={edit.date}
                          onChange={(e) => setEdit((s) => ({ ...s, date: e.target.value }))}
                          className="border border-gray-300 rounded-lg px-2 py-1 text-sm"
                        />
                      ) : (
                        (r.date ? String(r.date).slice(0, 10) : "—")
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {isEdit ? (
                        <input
                          value={edit.ingredient}
                          onChange={(e) => setEdit((s) => ({ ...s, ingredient: e.target.value }))}
                          className="w-full border border-gray-300 rounded-lg px-2 py-1 text-sm"
                        />
                      ) : (
                        r.ingredient
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {isEdit ? (
                        <input
                          value={edit.qty}
                          onChange={(e) => setEdit((s) => ({ ...s, qty: e.target.value }))}
                          className="w-20 border border-gray-300 rounded-lg px-2 py-1 text-sm"
                        />
                      ) : (
                        r.qty
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {isEdit ? (
                        <input
                          value={edit.price}
                          onChange={(e) => setEdit((s) => ({ ...s, price: e.target.value }))}
                          className="w-28 border border-gray-300 rounded-lg px-2 py-1 text-sm"
                        />
                      ) : (
                        money(r.price)
                      )}
                    </td>
                    <td className="px-4 py-2">{money(rowTotal)}</td>
                    <td className="px-4 py-2 text-right">
                      {!isEdit ? (
                        <button
                          onClick={() => startEdit(r)}
                          className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                        >
                          Edit
                        </button>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={saveEdit}
                            disabled={loading}
                            className="px-3 py-1.5 rounded-lg bg-black text-white hover:bg-black/90 disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}

              {!rows.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                    {loading ? "Загрузка…" : "Пока пусто"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-3 text-xs text-gray-500">
        Примечание: CAPEX хранится в purchases с <code>type=capex</code>. Total считается как qty × price.
      </div>
    </div>
  );
}
