//frontend/src/components/admin/DonasExpensesPanel.jsx

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiDelete } from "../../api";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n) {
  const v = Math.round(toNum(n));
  return v.toLocaleString("ru-RU");
}

function ymOfDate(d) {
  // d = "YYYY-MM-DD"
  if (!d) return "";
  return String(d).slice(0, 7);
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export default function DonasExpensesPanel({
  defaultMonth, // "YYYY-MM"
  onChanged,    // callback после add/delete чтобы перезагрузить summary-range/investor
}) {
  const [month, setMonth] = useState(defaultMonth || "");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [date, setDate] = useState(todayISO());
  const [kind, setKind] = useState("opex"); // opex | capex
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");

  const monthLabel = useMemo(() => {
    if (!month) return "—";
    return month;
  }, [month]);

  async function load(m) {
    const mm = m || month;
    if (!mm) return;
    setLoading(true);
    setErr("");
    try {
      const r = await apiGet(`/api/admin/donas/ops/expenses?month=${encodeURIComponent(mm)}`);
      setItems(Array.isArray(r) ? r : (r?.data || []));
    } catch (e) {
      console.error(e);
      setErr("Не удалось загрузить расходы");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // если месяц не задан — попробуем вывести из date
    if (!month && date) setMonth(ymOfDate(date));
  }, [date]); // eslint-disable-line

  useEffect(() => {
    if (month) load(month);
  }, [month]); // eslint-disable-line

  async function addExpense() {
    setErr("");
    const mm = month || ymOfDate(date);
    if (!mm) return setErr("Выберите месяц или дату");
    if (!date) return setErr("Укажите дату");
    if (!amount || toNum(amount) <= 0) return setErr("Укажите сумму > 0");

    try {
      await apiPost("/api/admin/donas/ops/expenses", {
        date,
        kind,
        amount: toNum(amount),
        category: category || null,
        note: note || null,
      });

      // очистим только часть полей
      setAmount("");
      setCategory("");
      setNote("");

      await load(mm);
      onChanged?.();
    } catch (e) {
      console.error(e);
      setErr("Не удалось сохранить расход");
    }
  }

  async function removeExpense(id) {
    if (!id) return;
    setErr("");
    try {
      await apiDelete(`/api/admin/donas/ops/expenses/${id}`);
      await load(month);
      onChanged?.();
    } catch (e) {
      console.error(e);
      setErr("Не удалось удалить расход");
    }
  }

  const totals = useMemo(() => {
    let opex = 0;
    let capex = 0;
    for (const it of items) {
      const a = toNum(it.amount);
      if (String(it.kind) === "capex") capex += a;
      else opex += a;
    }
    return { opex, capex };
  }, [items]);

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-lg font-semibold">Разовые расходы (OPEX / CAPEX)</div>
          <div className="text-sm text-slate-500">
            Месяц: <span className="font-medium text-slate-700">{monthLabel}</span> ·
            OPEX: <span className="font-medium">{fmt(totals.opex)}</span> ·
            CAPEX: <span className="font-medium">{fmt(totals.capex)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
          <button
            onClick={() => load(month)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
          >
            Обновить
          </button>
        </div>
      </div>

      {err ? (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {err}
        </div>
      ) : null}

      {/* Add form */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-12">
        <div className="sm:col-span-3">
          <div className="mb-1 text-xs text-slate-500">Дата</div>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
        </div>

        <div className="sm:col-span-2">
          <div className="mb-1 text-xs text-slate-500">Тип</div>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="opex">OPEX</option>
            <option value="capex">CAPEX</option>
          </select>
        </div>

        <div className="sm:col-span-3">
          <div className="mb-1 text-xs text-slate-500">Сумма</div>
          <input
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Напр. 18000000"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
        </div>

        <div className="sm:col-span-2">
          <div className="mb-1 text-xs text-slate-500">Категория</div>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="rent / ads / equip"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
        </div>

        <div className="sm:col-span-2">
          <div className="mb-1 text-xs text-slate-500">Комментарий</div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="кратко"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
        </div>

        <div className="sm:col-span-12 flex items-center justify-end">
          <button
            onClick={addExpense}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Добавить расход
          </button>
        </div>
      </div>

      {/* List */}
      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">Дата</th>
              <th className="px-3 py-2 text-left">Тип</th>
              <th className="px-3 py-2 text-left">Категория</th>
              <th className="px-3 py-2 text-right">Сумма</th>
              <th className="px-3 py-2 text-left">Комментарий</th>
              <th className="px-3 py-2 text-right"> </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-3 py-3 text-slate-500" colSpan={6}>
                  Загрузка…
                </td>
              </tr>
            ) : items.length ? (
              items.map((it) => (
                <tr key={it.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{String(it.date).slice(0, 10)}</td>
                  <td className="px-3 py-2">{String(it.kind).toUpperCase()}</td>
                  <td className="px-3 py-2">{it.category || "—"}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmt(it.amount)}</td>
                  <td className="px-3 py-2">{it.note || "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => removeExpense(it.id)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50"
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-3 py-3 text-slate-500" colSpan={6}>
                  Нет расходов за этот месяц
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-xs text-slate-500">
        Эти расходы автоматически попадут в summary-range / investor view (OPEX extra + CAPEX).
      </div>
    </div>
  );
}
