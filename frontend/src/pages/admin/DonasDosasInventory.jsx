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

const REASONS_OUT = [
  { value: "consume", label: "Списание (использовано/производство)" },
  { value: "waste", label: "Списание (порча/утиль)" },
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
  const [mReasonOut, setMReasonOut] = useState("consume");
  const [mNote, setMNote] = useState("");
  const [mDate, setMDate] = useState(todayISO());

  // для IN (закупка -> finance)
  const [mFinanceType, setMFinanceType] = useState("opex"); // opex|capex
  const [mVendor, setMVendor] = useState("");
  const [mUnitPrice, setMUnitPrice] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const r = await apiGet("/api/admin/donas/inventory/stock", "admin");
      const arr = Array.isArray(r?.stock) ? r.stock : [];
      setItems(arr);
    } catch (e) {
      console.error(e);
      setError("Не удалось загрузить остатки");
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
      arr = arr.filter((x) => String(x.name || "").toLowerCase().includes(s));
    }

    if (onlyLow) {
      arr = arr.filter((x) => toNum(x.on_hand) <= toNum(x.min_qty));
    }

    // low first, then by name
    arr.sort((a, b) => {
      const al = toNum(a.on_hand) <= toNum(a.min_qty) ? 0 : 1;
      const bl = toNum(b.on_hand) <= toNum(b.min_qty) ? 0 : 1;
      if (al !== bl) return al - bl;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });

    return arr;
  }, [items, q, onlyLow]);

  function openAdjust(item, nextMode) {
    setActiveItem(item);
    setMode(nextMode);
    setMQty("");
    setMReasonOut("consume");
    setMNote("");
    setMDate(todayISO());
    setMFinanceType("opex");
    setMVendor("");
    setMUnitPrice("");
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setActiveItem(null);
  }

  async function saveMinAndUnit(item, { min_qty, unit }) {
    setBusyId(item.id);
    try {
      const payload = {
        min_qty: toNum(min_qty),
        unit: String(unit || "").trim() || item.unit || "pcs",
      };
      const updated = await apiPut(`/api/admin/donas/inventory/items/${item.id}`, payload, "admin");
      const next = updated?.item || payload;
      setItems((prev) => prev.map((x) => (String(x.id) === String(item.id) ? { ...x, ...next } : x)));
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

    setBusyId(item.id);
    try {
      if (mode === "in") {
        // Приход оформляем как закупку (пишет в ledger + в donas_purchases для Months)
        await apiPost(
          "/api/admin/donas/inventory/purchases",
          {
            purchased_at: mDate,
            finance_type: mFinanceType,
            vendor: mVendor,
            notes: mNote,
            items: [
              {
                item_id: item.id,
                qty,
                unit_price: toNum(mUnitPrice),
              },
            ],
          },
          "admin"
        );
        tSuccess("Поступление учтено");
      } else {
        // Расход (не пишет в finance; это будет считаться через COGS/recipes)
        await apiPost(
          "/api/admin/donas/inventory/consume",
          {
            date: mDate,
            reason: mReasonOut,
            notes: mNote,
            items: [{ item_id: item.id, qty }],
          },
          "admin"
        );
        tSuccess("Списание учтено");
      }

      closeModal();
      await load();
    } catch (e) {
      console.error(e);
      const msg =
        e?.response?.data?.error ||
        e?.message ||
        (mode === "out" ? "Не удалось списать" : "Не удалось учесть поступление");
      tError(msg);
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
            Остатки (ledger) • <span className="font-mono">/api/admin/donas/inventory</span>
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
          placeholder="Поиск: ингредиент…"
          className="w-full md:w-[420px] px-3 py-2 rounded-xl border bg-white"
        />
        <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border bg-white text-sm">
          <input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} />
          Только ниже минимума
        </label>

        <div className="text-sm text-gray-600 md:ml-auto">
          Позиции: <span className="font-semibold">{filtered.length}</span>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700">{error}</div>
      )}

      <div className="bg-white border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="text-left p-3">Ингредиент</th>
                <th className="text-left p-3">Ед.</th>
                <th className="text-right p-3">Остаток</th>
                <th className="text-right p-3">Мин.</th>
                <th className="text-right p-3">Действия</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td className="p-4 text-gray-500" colSpan={5}>
                    Загрузка…
                  </td>
                </tr>
              )}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td className="p-4 text-gray-500" colSpan={5}>
                    Ничего не найдено
                  </td>
                </tr>
              )}

              {!loading &&
                filtered.map((it) => {
                  const name = it.name || `#${it.id}`;
                  const unit = it.unit || "pcs";
                  const qty = toNum(it.on_hand);
                  const min = toNum(it.min_qty);
                  const low = qty <= min;

                  return (
                    <Row
                      key={it.id}
                      item={it}
                      name={name}
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
                <span className="text-gray-800">{activeItem.name}</span>
              </div>
              <div className="text-sm text-gray-600">
                Текущий остаток: <span className="font-semibold">{fmt(activeItem.on_hand)}</span> {activeItem.unit}
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
                      {activeItem.unit || "unit"}
                    </div>
                  </div>
                </div>
              </div>

              {mode === "out" ? (
                <div>
                  <div className="text-xs text-gray-500 mb-1">Причина</div>
                  <select
                    value={mReasonOut}
                    onChange={(e) => setMReasonOut(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border bg-white"
                  >
                    {REASONS_OUT.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Тип (Finance)</div>
                    <select
                      value={mFinanceType}
                      onChange={(e) => setMFinanceType(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border bg-white"
                    >
                      <option value="opex">OPEX</option>
                      <option value="capex">CAPEX</option>
                    </select>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Цена за ед. (опц.)</div>
                    <input
                      inputMode="decimal"
                      value={mUnitPrice}
                      onChange={(e) => setMUnitPrice(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border"
                      placeholder="0"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <div className="text-xs text-gray-500 mb-1">Поставщик (опц.)</div>
                    <input
                      value={mVendor}
                      onChange={(e) => setMVendor(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border"
                      placeholder="Напр: Makro / поставщик X"
                    />
                  </div>
                </div>
              )}

              <div>
                <div className="text-xs text-gray-500 mb-1">Комментарий (опционально)</div>
                <textarea
                  value={mNote}
                  onChange={(e) => setMNote(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border"
                  rows={3}
                  placeholder={mode === "in" ? "Напр: чек №…" : "Напр: списание по смене…"}
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

function Row({ item, name, unit, qty, min, low, busy, onIn, onOut, onSaveMeta }) {
  const [editMin, setEditMin] = useState(String(item.min_qty ?? ""));
  const [editUnit, setEditUnit] = useState(String(item.unit ?? "pcs"));

  useEffect(() => {
    setEditMin(String(item.min_qty ?? ""));
    setEditUnit(String(item.unit ?? "pcs"));
  }, [item?.id, item?.min_qty, item?.unit]);

  return (
    <tr className={low ? "bg-rose-50/50" : ""}>
      <td className="p-3">
        <div className="font-semibold text-gray-900">{name}</div>
        {!item.is_active && <div className="text-xs text-gray-500">inactive</div>}
      </td>

      <td className="p-3">
        <input
          value={editUnit}
          onChange={(e) => setEditUnit(e.target.value)}
          className="w-24 px-2 py-1 rounded-lg border bg-white text-gray-800"
          placeholder="pcs/kg/l…"
        />
      </td>

      <td className="p-3 text-right">
        <span className={low ? "font-bold text-rose-700" : "font-semibold text-gray-900"}>{fmt(qty)}</span>{" "}
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
            onClick={() => onSaveMeta(item, { min_qty: editMin, unit: editUnit })}
            className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-60"
          >
            Save
          </button>
        </div>
      </td>
    </tr>
  );
}
