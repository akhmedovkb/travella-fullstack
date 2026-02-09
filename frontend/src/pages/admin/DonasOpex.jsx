// frontend/src/pages/admin/DonasOpex.jsx

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiDelete } from "../../api";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function money(n) {
  return Math.round(toNum(n)).toLocaleString("ru-RU");
}

function monthRange(ym) {
  // ym: "YYYY-MM"
  const y = Number(String(ym).slice(0, 4));
  const m = Number(String(ym).slice(5, 7)); // 1..12
  const from = `${ym}-01`;
  // last day of month: day 0 of next month
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${ym}-${String(last).padStart(2, "0")}`;
  return { from, to };
}

const CATS = [
  "Rent",
  "Fuel",
  "Gas/Electricity",
  "Staff",
  "Internet",
  "Cleaning",
  "Repairs",
  "Other",
];

export default function DonasOpex() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  // form
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Rent");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  async function load() {
    setLoading(true);
    try {
      const { from, to } = monthRange(month);

      // ВАЖНО: backend понимает from/to/type (month=... игнорируется)
      const r = await apiGet(
        `/api/admin/donas/purchases?from=${encodeURIComponent(from)}&to=${encodeURIComponent(
          to
        )}&type=opex`
      );

      // backend отвечает { rows: [...] }
      setItems(Array.isArray(r?.rows) ? r.rows : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const total = useMemo(() => {
    return items.reduce((s, x) => s + toNum(x.total), 0);
  }, [items]);

  async function add() {
    const a = toNum(amount);
    if (!title.trim() || !a) return;

    // OPEX — месячный расход: ставим дату = 1 число выбранного месяца
    const date = `${month}-01`;

    await apiPost(
      "/api/admin/donas/purchases",
      {
        date,
        ingredient: title.trim(),
        qty: 1,
        price: a,
        type: "opex",
        category,
        notes: notes.trim() || null,
      },
      "admin"
    );

    setTitle("");
    setCategory("Rent");
    setAmount("");
    setNotes("");

    await load();
  }

async function del(id) {
  // оптимистично убираем из списка сразу
  setItems((prev) => (Array.isArray(prev) ? prev.filter((x) => x.id !== id) : prev));

  try {
    await apiDelete(`/api/admin/donas/purchases/${id}`);
  } catch (e) {
    // если ошибка — вернём актуальный список
    load();
    alert(e?.data?.error || e?.message || "Не удалось удалить");
  }

  // можно обновить с сервера, но не блокировать UI
  load(); // без await
}

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Donas — OPEX</h1>
          <div className="text-sm text-gray-500">Ежемесячные операционные расходы</div>
        </div>

        <div className="text-sm">
          Итого за месяц: <b>{money(total)}</b>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow p-4 space-y-4">
        <div className="flex gap-3 items-end">
          <div>
            <div className="text-xs text-gray-600 mb-1">Месяц</div>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="border rounded-xl px-3 py-2"
            />
          </div>

          {loading && <div className="text-sm text-gray-500">Загрузка…</div>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          <div className="md:col-span-2">
            <div className="text-xs text-gray-600 mb-1">Название</div>
            <input
              className="w-full border rounded-xl px-3 py-2"
              placeholder="Например: Аренда"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div>
            <div className="text-xs text-gray-600 mb-1">Категория</div>
            <select
              className="w-full border rounded-xl px-3 py-2"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="text-xs text-gray-600 mb-1">Сумма</div>
            <input
              className="w-full border rounded-xl px-3 py-2"
              placeholder="UZS"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="flex items-end">
            <button
              className="w-full rounded-xl bg-black text-white px-4 py-2 hover:opacity-90"
              onClick={add}
              disabled={!title.trim() || !toNum(amount)}
            >
              Добавить
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1">
          <div className="text-xs text-gray-600 mb-1">Заметки (опционально)</div>
          <input
            className="w-full border rounded-xl px-3 py-2"
            placeholder="Например: оплатили наличными"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 text-sm font-medium flex items-center justify-between">
            <span>Список OPEX</span>
            <span className="text-gray-600">Total: {money(total)}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-gray-600 border-b">
                <tr>
                  <th className="text-left py-2 px-4">Название</th>
                  <th className="text-left py-2 px-4">Категория</th>
                  <th className="text-left py-2 px-4">Заметки</th>
                  <th className="text-right py-2 px-4">Сумма</th>
                  <th className="py-2 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((x) => (
                  <tr key={x.id} className="border-b">
                    <td className="py-2 px-4">{x.ingredient || "—"}</td>
                    <td className="py-2 px-4">{x.category || "—"}</td>
                    <td className="py-2 px-4 text-gray-600">{x.notes || "—"}</td>
                    <td className="py-2 px-4 text-right">{money(x.total)}</td>
                    <td className="py-2 px-4 text-right">
                      <button className="text-red-600 hover:underline" onClick={() => del(x.id)}>
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}

                {items.length === 0 && !loading && (
                  <tr>
                    <td colSpan={5} className="py-6 px-4 text-gray-500">
                      Пока пусто
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 text-xs text-gray-500">
            Примечание: OPEX хранится в <code>donas_purchases</code> с <code>type='opex'</code>,
            сумма считается как <code>qty × price</code> (здесь qty=1).
          </div>
        </div>
      </div>
    </div>
  );
}
