//frontend/src/components/admin/DonasExpensesPanel.jsx

import { useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../../api";

function fmt(n) {
  return Math.round(Number(n || 0)).toLocaleString("ru-RU");
}

function getDefaultMonth() {
  const d = new Date();
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
      setErr(e?.message || "Failed to save expense");
    }
  };

  const remove = async (id) => {
    if (!window.confirm("Удалить расход?")) return;
    try {
      setErr("");
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
          <h2 className="font-semibold">Разовый расход (OPEX / CAPEX)</h2>
          <div className="text-xs text-gray-500 mt-0.5">
            Итого за {month}: <b>{fmt(total)}</b>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-sm text-gray-600">Месяц:</div>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="px-3 py-2 rounded-lg border"
          />
        </div>
      </div>

      {err && <div className="mt-2 text-sm text-red-600">{err}</div>}

      <div className="mt-3 grid grid-cols-1 md:grid-cols-5 gap-2">
        <input
          type="date"
          value={form.date}
          onChange={(e) => {
            const v = e.target.value;
            setForm((f) => ({ ...f, date: v }));
            if (v && v.length >= 7) setMonth(v.slice(0, 7)); // YYYY-MM
          }}
          className="px-3 py-2 rounded-lg border"
          placeholder="ДД.ММ.ГГГГ"
        />

        <input
          value={form.amount}
          onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          className="px-3 py-2 rounded-lg border"
          placeholder="Сумма"
        />

        <select
          value={form.kind}
          onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
          className="px-3 py-2 rounded-lg border bg-white"
        >
          <option value="opex">OPEX</option>
          <option value="capex">CAPEX</option>
        </select>

        <input
          value={form.category}
          onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
          className="px-3 py-2 rounded-lg border"
          placeholder="Категория"
        />

        <input
          value={form.note}
          onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          className="px-3 py-2 rounded-lg border"
          placeholder="Комментарий"
        />
      </div>

      <div className="mt-3">
        <button
          onClick={submit}
          className="px-3 py-2 rounded-lg bg-gray-900 text-white"
        >
          Add expense
        </button>
      </div>

      <div className="mt-4 overflow-auto">
        <table className="min-w-[900px] w-full text-sm">
          <thead>
            <tr className="text-left text-gray-600">
              <th className="py-2 pr-2">Date</th>
              <th className="py-2 pr-2">Kind</th>
              <th className="py-2 pr-2">Category</th>
              <th className="py-2 pr-2">Note</th>
              <th className="py-2 pr-2">Amount</th>
              <th className="py-2 pr-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="py-2 text-gray-500" colSpan={6}>Loading…</td></tr>
            ) : items.length ? (
              items.map((it) => (
                <tr key={it.id} className="border-t">
                  <td className="py-2 pr-2 whitespace-nowrap">{String(it.date).slice(0, 10)}</td>
                  <td className="py-2 pr-2">{String(it.kind || "").toUpperCase()}</td>
                  <td className="py-2 pr-2">{it.category || "—"}</td>
                  <td className="py-2 pr-2">{it.note || "—"}</td>
                  <td className="py-2 pr-2 whitespace-nowrap">{fmt(it.amount)}</td>
                  <td className="py-2 pr-2">
                    <button
                      onClick={() => remove(it.id)}
                      className="px-2 py-1 rounded border bg-white"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr><td className="py-2 text-gray-500" colSpan={6}>No expenses</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
