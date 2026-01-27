//frontend/src/components/admin/DonasExpensesPanel.jsx

import { useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../../api";

function fmt(n) {
  return Math.round(Number(n || 0)).toLocaleString("ru-RU");
}

function getDefaultMonth() {
  // UX: по умолчанию показываем предыдущий месяц (последний "закрытый" месяц),
  // чтобы "last month" не выглядел как будущий и чтобы сразу были данные.
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  d.setMonth(d.getMonth() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`; // YYYY-MM
}

export default function DonasExpensesPanel({ onChanged, initialMonth }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [month, setMonth] = useState(() => initialMonth || getDefaultMonth());

  const [form, setForm] = useState({
    date: "",
    amount: "",
    kind: "opex",
    category: "",
    note: "",
  });

  // если parent передал initialMonth и он поменялся — синхронизируем
  useEffect(() => {
    if (initialMonth && initialMonth !== month) setMonth(initialMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMonth]);

  const total = useMemo(() => {
    return (items || []).reduce((sum, it) => sum + Number(it.amount || 0), 0);
  }, [items]);

  const load = async (m = month) => {
    setLoading(true);
    setErr("");
    try {
      const r = await apiGet(
        `/api/admin/donas/ops/expenses?month=${encodeURIComponent(m)}`,
        "provider"
      );
      setItems(Array.isArray(r) ? r : []);
    } catch (e) {
      setErr(e?.message || "Failed to load expenses");
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const submit = async () => {
    setErr("");
    try {
      if (!form.date) throw new Error("date required");
      if (!form.kind) throw new Error("kind required");
      const amount = Number(form.amount || 0);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("amount must be > 0");

      await apiPost(
        "/api/admin/donas/ops/expenses",
        {
          date: form.date,
          amount,
          kind: form.kind,
          category: form.category || null,
          note: form.note || null,
        },
        "provider"
      );

      setForm({ date: "", amount: "", kind: "opex", category: "", note: "" });

      await load(month);
      onChanged?.();
    } catch (e) {
      setErr(e?.message || "Failed to create expense");
    }
  };

  const del = async (id) => {
    setErr("");
    try {
      await apiDelete(`/api/admin/donas/ops/expenses/${id}`, null, "provider");
      await load(month);
      onChanged?.();
    } catch (e) {
      setErr(e?.message || "Failed to delete expense");
    }
  };

  return (
    <div className="mt-4 rounded-2xl bg-white border p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold">OPEX / CAPEX events</h2>
          <div className="text-xs text-gray-500 mt-0.5">
            Эти события автоматически попадают в Months (Actuals).
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-700">Month</label>
          <input
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="px-3 py-2 rounded-lg border"
            placeholder="YYYY-MM"
          />
          <button onClick={() => load(month)} className="px-3 py-2 rounded-lg bg-white border">
            Refresh
          </button>
        </div>
      </div>

      {err && (
        <div className="mt-3 p-3 rounded-lg bg-red-50 text-red-700 border border-red-200">
          {err}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-5 gap-2">
        <input
          type="date"
          value={form.date}
          onChange={(e) => setForm((s) => ({ ...s, date: e.target.value }))}
          className="px-3 py-2 rounded-lg border"
        />
        <input
          value={form.amount}
          onChange={(e) => setForm((s) => ({ ...s, amount: e.target.value }))}
          className="px-3 py-2 rounded-lg border"
          placeholder="Amount"
        />
        <select
          value={form.kind}
          onChange={(e) => setForm((s) => ({ ...s, kind: e.target.value }))}
          className="px-3 py-2 rounded-lg border bg-white"
        >
          <option value="opex">OPEX</option>
          <option value="capex">CAPEX</option>
        </select>
        <input
          value={form.category}
          onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))}
          className="px-3 py-2 rounded-lg border"
          placeholder="Category (optional)"
        />
        <div className="flex gap-2">
          <input
            value={form.note}
            onChange={(e) => setForm((s) => ({ ...s, note: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border"
            placeholder="Note (optional)"
          />
          <button onClick={submit} className="px-3 py-2 rounded-lg bg-gray-900 text-white">
            Add
          </button>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm">
        <div className="text-gray-700">
          Total for {month}: <b>{fmt(total)}</b>
        </div>
        {loading && <div className="text-gray-500">Loading…</div>}
      </div>

      <div className="mt-3 overflow-auto">
        <table className="min-w-[900px] w-full text-sm">
          <thead>
            <tr className="text-left text-gray-600">
              <th className="py-2 pr-2">Date</th>
              <th className="py-2 pr-2">Kind</th>
              <th className="py-2 pr-2">Category</th>
              <th className="py-2 pr-2">Note</th>
              <th className="py-2 pr-2">Amount</th>
              <th className="py-2 pr-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(items || []).map((it) => (
              <tr key={it.id} className="border-t">
                <td className="py-2 pr-2">{String(it.date).slice(0, 10)}</td>
                <td className="py-2 pr-2">{String(it.kind || "").toUpperCase()}</td>
                <td className="py-2 pr-2">{it.category || "—"}</td>
                <td className="py-2 pr-2">{it.note || "—"}</td>
                <td className="py-2 pr-2 whitespace-nowrap">{fmt(it.amount)}</td>
                <td className="py-2 pr-2">
                  <button
                    onClick={() => del(it.id)}
                    className="px-3 py-1.5 rounded-lg border bg-white"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}

            {(!items || items.length === 0) && !loading && (
              <tr className="border-t">
                <td className="py-3 text-gray-500" colSpan={6}>
                  No expenses for this month.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
