// frontend/src/pages/admin/DonasDosasInventory.jsx
import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut } from "../../api";
import { tError, tSuccess } from "../../shared/toast";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function fmt(n) {
  const v = Math.round(toNum(n) * 1000) / 1000;
  return v.toLocaleString("ru-RU");
}
function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const REASONS = [
  { value: "purchase", label: "Поступление (закупка)" },
  { value: "waste", label: "Списание (порча/утиль)" },
  { value: "production", label: "Производство (использовано)" },
  { value: "correction", label: "Корректировка" },
  { value: "other", label: "Другое" },
];

export default function DonasDosasInventory() {
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);

  // modal
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState("in"); // in|out
  const [activeItem, setActiveItem] = useState(null);

  const [mQty, setMQty] = useState("");
  const [mReason, setMReason] = useState("purchase");
  const [mNote, setMNote] = useState("");
  const [mDate, setMDate] = useState(todayISO());

  async function load() {
    setLoading(true);
    setError("");
    try {
      // ожидаем, что ингредиенты уже существуют (и inventory "живёт" на них)
      // желательно, чтобы бэк отдавал stock_qty, stock_unit, stock_min
      const list = await apiGet("/api/admin/donas/ingredients", "admin");
      const arr = Array.isArray(list) ? list : list?.items || [];
      setItems(arr);
    } catch (e) {
      console.error(e);
      setError("Не удалось загрузить ингредиенты");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const s = String(q || "").trim().toLowerCase();
    let arr = items.slice();

    if (s) {
      arr = arr.filter((x) => {
        const name = String(x.name || x.title || x.ingredient || "").toLowerCase();
        const cat = String(x.category || "").toLowerCase();
        return name.includes(s) || cat.includes(s);
      });
    }

    if (onlyLow) {
      arr = arr.filter((x) => toNum(x.stock_qty) <= toNum(x.stock_min));
    }

    // low first, then by name
    arr.sort((a, b) => {
      const al = toNum(a.stock_qty) <= toNum(a.stock_min) ? 0 : 1;
      const bl = toNum(b.stock_qty) <= toNum(b.stock_min) ? 0 : 1;
      if (al !== bl) return al - bl;
      const an = String(a.name || a.title || "").localeCompare(String(b.name || b.title || ""));
      return an;
    });

    return arr;
  }, [items, q, onlyLow]);

  function openAdjust(item, nextMode) {
    setActiveItem(item);
    setMode(nextMode);
    setMQty("");
    setMReason(nextMode === "in" ? "purchase" : "production");
    setMNote("");
    setMDate(todayISO());
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setActiveItem(null);
  }

  async function tryInventoryAdjust({ ingredient_id, delta, reason, note, date }) {
    // 1) предпочитаем специализированный endpoint (если у тебя он уже есть/будет)
    try {
      return await apiPost("/api/admin/donas/inventory/adjust", { ingredient_id, delta, reason, note, date }, "admin");
    } catch (e) {
      // 2) fallback: просто правим stock_qty на ингредиенте
      const item = items.find((x) => String(x.id) === String(ingredient_id));
      if (!item) throw e;

      const nextQty = toNum(item.stock_qty) + toNum(delta);
      const patch = {
        ...item,
        stock_qty: nextQty,
      };

      // отправляем только то, что обычно есть у ингредиента, чтобы не сломать валидацию на бэке
      const payload = {
        name: item.name,
        category: item.category ?? "",
        unit: item.unit ?? item.stock_unit ?? "",
        stock_qty: nextQty,
        stock_min: item.stock_min ?? 0,
        // если у тебя другие поля — бэк их просто проигнорит (если сделано аккуратно)
      };

      const updated = await apiPut(`/api/admin/donas/ingredients/${ingredient_id}`, payload, "admin");
      return updated;
    }
  }

  async function saveMinAndUnit(item, { stock_min, stock_unit }) {
    setBusyId(item.id);
    try {
      const payload = {
        name: item.name,
        category: item.category ?? "",
        unit: item.unit ?? stock_unit ?? "",
        stock_qty: toNum(item.stock_qty),
        stock_min: toNum(stock_min),
        stock_unit: stock_unit ?? item.stock_unit ?? item.unit ?? "",
      };
      const updated = await apiPut(`/api/admin/donas/ingredients/${item.id}`, payload, "admin");

      setItems((prev) =>
        prev.map((x) => (String(x.id) === String(item.id) ? { ...x, ...(updated || payload) } : x))
      );
      tSuccess("Сохранено");
    } catch (e) {
      console.error(e);
      tError("Не удалось сохранить");
    } finally {
      setBusyId(null);
    }
  }

  async function submitAdjust() {
    const item = activeItem;
    if (!item) return;

    const qty = toNum(mQty);
    if (qty <= 0) {
      tError("Укажи количество > 0");
      return;
    }

    const delta = mode === "in" ? qty : -qty;
    setBusyId(item.id);

    try {
      await tryInventoryAdjust({
        ingredient_id: item.id,
        delta,
        reason: mReason,
        note: mNote,
        date: mDate,
      });

      // локально обновим (если endpoint вернул не список — всё равно актуализируем просто пересчётом)
      setItems((prev) =>
        prev.map((x) =>
          String(x.id) === String(item.id)
            ? { ...x, stock_qty: toNum(x.stock_qty) + delta }
            : x
        )
      );

      tSuccess(mode === "in" ? "Поступление учтено" : "Списание учтено");
      closeModal();
    } catch (e) {
      console.error(e);
      tError("Не удалось выполнить операцию");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="text-xs text-gray-500">Admin • Dona’s Dosas</div>
          <h1 className="text-2xl font-semibold">Inventory</h1>
          <div className="text-sm text-gray-600">
            Остатки по ингредиентам (привязано к <span className="font-mono">donas_ingredients</span>)
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            className="px-3 py-2 rounded-xl border bg-white text-gray-800 hover:bg-gray-50"
            disabled={loading}
          >
            {loading ? "Обновляю…" : "Обновить"}
          </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск: ингредиент / категория…"
          className="w-full md:w-[420px] px-3 py-2 rounded-xl border bg-white"
        />
        <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border bg-white text-sm">
          <input
            type="checkbox"
            checked={onlyLow}
            onChange={(e) => setOnlyLow(e.target.checked)}
          />
          Только ниже минимума
        </label>

        <div className="text-sm text-gray-600 md:ml-auto">
          Позиции: <span className="font-semibold">{filtered.length}</span>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="text-left p-3">Ингредиент</th>
                <th className="text-left p-3">Категория</th>
                <th className="text-left p-3">Ед.</th>
                <th className="text-right p-3">Остаток</th>
                <th className="text-right p-3">Мин.</th>
                <th className="text-right p-3">Действия</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td className="p-4 text-gray-500" colSpan={6}>
                    Загрузка…
                  </td>
                </tr>
              )}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td className="p-4 text-gray-500" colSpan={6}>
                    Ничего не найдено
                  </td>
                </tr>
              )}

              {!loading &&
                filtered.map((it) => {
                  const name = it.name || it.title || it.ingredient || `#${it.id}`;
                  const cat = it.category || "—";
                  const unit = it.stock_unit || it.unit || "—";
                  const qty = toNum(it.stock_qty);
                  const min = toNum(it.stock_min);
                  const low = qty <= min;

                  return (
                    <Row
                      key={it.id}
                      item={it}
                      name={name}
                      cat={cat}
                      unit={unit}
                      qty={qty}
                      min={min}
                      low={low}
                      busy={String(busyId) === String(it.id)}
                      onIn={() => openAdjust(it, "in")}
                      onOut={() => openAdjust(it, "out")}
                      onSaveMeta={saveMinAndUnit}
                    />
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {modalOpen && activeItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
          <div className="absolute inset-0 bg-black/40" onClick={closeModal} />
          <div className="relative w-full max-w-lg bg-white rounded-2xl border shadow-xl overflow-hidden">
            <div className="p-4 border-b bg-gray-50">
              <div className="text-xs text-gray-500">Inventory</div>
              <div className="text-lg font-semibold">
                {mode === "in" ? "Поступление" : "Списание"} —{" "}
                <span className="text-gray-800">{activeItem.name || activeItem.title}</span>
              </div>
              <div className="text-sm text-gray-600">
                Текущий остаток: <span className="font-semibold">{fmt(activeItem.stock_qty)}</span>{" "}
                {activeItem.stock_unit || activeItem.unit || ""}
              </div>
            </div>

            <div className="p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-gray-500 mb-1">Дата</div>
                  <input
                    type="date"
                    value={mDate}
                    onChange={(e) => setMDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border"
                  />
                </div>

                <div>
                  <div className="text-xs text-gray-500 mb-1">Количество</div>
                  <div className="flex gap-2">
                    <input
                      inputMode="decimal"
                      value={mQty}
                      onChange={(e) => setMQty(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border"
                      placeholder="Напр. 2.5"
                    />
                    <div className="px-3 py-2 rounded-xl border bg-gray-50 text-gray-700 whitespace-nowrap">
                      {activeItem.stock_unit || activeItem.unit || "unit"}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <div className="text-xs text-gray-500 mb-1">Причина</div>
                <select
                  value={mReason}
                  onChange={(e) => setMReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border bg-white"
                >
                  {REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="text-xs text-gray-500 mb-1">Комментарий (опционально)</div>
                <textarea
                  value={mNote}
                  onChange={(e) => setMNote(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border"
                  rows={3}
                  placeholder="Напр: закупка у поставщика X, чек №…"
                />
              </div>
            </div>

            <div className="p-4 border-t flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={submitAdjust}
                className={`px-4 py-2 rounded-xl text-white ${
                  mode === "in" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"
                }`}
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ item, name, cat, unit, qty, min, low, busy, onIn, onOut, onSaveMeta }) {
  const [editMin, setEditMin] = useState(String(item.stock_min ?? ""));
  const [editUnit, setEditUnit] = useState(String(item.stock_unit ?? item.unit ?? ""));

  useEffect(() => {
    setEditMin(String(item.stock_min ?? ""));
    setEditUnit(String(item.stock_unit ?? item.unit ?? ""));
  }, [item?.id]);

  return (
    <tr className={low ? "bg-rose-50/50" : ""}>
      <td className="p-3">
        <div className="font-semibold text-gray-900">{name}</div>
      </td>

      <td className="p-3 text-gray-700">{cat}</td>

      <td className="p-3">
        <input
          value={editUnit}
          onChange={(e) => setEditUnit(e.target.value)}
          className="w-24 px-2 py-1 rounded-lg border bg-white text-gray-800"
          placeholder="шт/кг/л…"
        />
      </td>

      <td className="p-3 text-right">
        <span className={low ? "font-bold text-rose-700" : "font-semibold text-gray-900"}>
          {fmt(qty)}
        </span>{" "}
        <span className="text-gray-500">{unit}</span>
      </td>

      <td className="p-3 text-right">
        <input
          inputMode="decimal"
          value={editMin}
          onChange={(e) => setEditMin(e.target.value)}
          className="w-24 px-2 py-1 rounded-lg border bg-white text-right"
          placeholder="0"
        />
      </td>

      <td className="p-3">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onIn}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            IN
          </button>
          <button
            type="button"
            onClick={onOut}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60"
          >
            OUT
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onSaveMeta(item, { stock_min: editMin, stock_unit: editUnit })}
            className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-60"
          >
            Save
          </button>
        </div>
      </td>
    </tr>
  );
}
