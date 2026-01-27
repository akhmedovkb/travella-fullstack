//frontend/src/components/admin/DonasExpensesPanel.jsx

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "../../api";

function fmt(n) {
  return Math.round(Number(n || 0)).toLocaleString("ru-RU");
}

export default function DonasExpensesPanel({ onChanged }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [form, setForm] = useState({
    date: "",
    amount: "",
    kind: "opex",
    category: "",
    note: "",
  });

  const load = async () => {
    setLoading(true);
    try {
      const r = await apiGet("/api/admin/donas/expenses", "provider");
      setItems(r || []);
    } catch (e) {
      setErr(e.message || "Failed to load expenses");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async () => {
    setErr("");
    try {
      await apiPost("/api/admin/donas/expenses", form, "provider");
      setForm({ date: "", amount: "", kind: "opex", category: "", note: "" });
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e.message || "Failed to save expense");
    }
  };

  const remove = async (id) => {
    if (!window.confirm("Удалить расход?")) return;
    await apiDelete(`/api/admin/donas/expenses/${id}`, null, "provider");
    await load();
    onChanged?.();
  };

  return (
    <div className="mt-4 rounded-2xl bg-white border p-4">
      <h2 className="font-semibold mb-3">Разовый расход (OPEX / CAPEX)</h2>

      {err && <div className="mb-2 text-sm text-red-600">{err}</div>}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
        <input
          type="date"
          value={form.date}
          onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          className="px-3 py-2 rounded-lg border"
        />
        <input
          placeholder="Сумма"
          value={form.amount}
          onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          className="px-3 py-2 rounded-lg border"
        />
        <select
          value={form.kind}
          onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
          className="px-3 py-2 rounded-lg border"
        >
          <option value="opex">OPEX</option>
          <option value="capex">CAPEX</option>
        </select>
        <input
          placeholder="Категория"
          value={form.category}
          onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
          className="px-3 py-2 rounded-lg border"
        />
        <input
          placeholder="Комментарий"
          value={form.note}
          onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          className="px-3 py-2 rounded-lg border"
        />
      </div>

      <button
        onClick={submit}
        className="mt-3 px-4 py-2 rounded-lg bg-gray-900 text-white"
      >
        Add expense
      </button>

      <div className="mt-4 overflow-auto">
        {loading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-gray-500">
              <tr>
                <th>Date</th>
                <th>Kind</th>
                <th>Category</th>
                <th>Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.id} className="border-t">
                  <td>{x.date}</td>
                  <td>{x.kind.toUpperCase()}</td>
                  <td>{x.category}</td>
                  <td>{fmt(x.amount)}</td>
                  <td>
                    <button
                      onClick={() => remove(x.id)}
                      className="text-red-600 text-xs"
                    >
                      delete
                    </button>
                  </td>
                </tr>
              ))}
              {!items.length && (
                <tr>
                  <td colSpan={5} className="text-center text-gray-400 py-3">
                    No expenses
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
