// frontend/src/pages/admin/DonasDosasInventory.jsx
import { useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../../api";
import { tError, tSuccess } from "../../shared/toast";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function fmtQty(n) {
  const v = Math.round(toNum(n) * 1000) / 1000;
  return v.toLocaleString("ru-RU");
}
function fmtMoney(n) {
  const v = Math.round(toNum(n));
  return v.toLocaleString("ru-RU");
}
function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function isISODate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

const REASONS_OUT = [
  { value: "consume", label: "Списание (использовано/производство)" },
  { value: "waste", label: "Списание (порча/утиль)" },
  { value: "correction", label: "Корректировка" },
  { value: "other", label: "Другое" },
];

export default function DonasDosasInventory() {
  const [tab, setTab] = useState("stock"); // stock | purchases

  // Stock
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);

  // Create item
  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState("pcs");
  const [newMin, setNewMin] = useState("");
  const [newActive, setNewActive] = useState(true);
  const [creating, setCreating] = useState(false);

  // IN/OUT modal
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState("in"); // in|out
  const [activeItem, setActiveItem] = useState(null);

  const [mQty, setMQty] = useState("");
  const [mReasonOut, setMReasonOut] = useState("consume");
  const [mNote, setMNote] = useState("");
  const [mDate, setMDate] = useState(todayISO());

  // Для IN (закупка -> finance)
  const [mFinanceType, setMFinanceType] = useState("opex"); // opex|capex
  const [mVendor, setMVendor] = useState("");
  const [mUnitPrice, setMUnitPrice] = useState("");

  // Purchases tab
  const [pLoading, setPLoading] = useState(false);
  const [pError, setPError] = useState("");
  const [purchases, setPurchases] = useState([]);
  const [pOffset, setPOffset] = useState(0);
  const [pLimit] = useState(50);
  const [pHasMore, setPHasMore] = useState(true);

  // Purchase details modal
  const [pModalOpen, setPModalOpen] = useState(false);
  const [pActive, setPActive] = useState(null);
  const [pLines, setPLines] = useState([]);
  const [pBusy, setPBusy] = useState(false);

  async function loadStock() {
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

  async function loadPurchasesPage(offset, { append } = { append: false }) {
    setPLoading(true);
    setPError("");
    try {
      const r = await apiGet(
        `/api/admin/donas/inventory/purchases?limit=${encodeURIComponent(pLimit)}&offset=${encodeURIComponent(
          offset
        )}`,
        "admin"
      );
      const arr = Array.isArray(r?.purchases) ? r.purchases : [];
      setPurchases((prev) => (append ? prev.concat(arr) : arr));
      setPOffset(offset);
      setPHasMore(arr.length >= pLimit);
    } catch (e) {
      console.error(e);
      setPError("Не удалось загрузить закупки");
      if (!append) setPurchases([]);
      setPHasMore(false);
    } finally {
      setPLoading(false);
    }
  }

  async function refreshTab(nextTab = tab) {
    if (nextTab === "stock") return loadStock();
    if (nextTab === "purchases") return loadPurchasesPage(0, { append: false });
  }

  useEffect(() => {
    refreshTab("stock");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const s = String(q || "").trim().toLowerCase();
    let arr = items.slice();

    if (s) arr = arr.filter((x) => String(x.name || "").toLowerCase().includes(s));
    if (onlyLow) arr = arr.filter((x) => toNum(x.on_hand) <= toNum(x.min_qty));

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

  async function createItem() {
    const name = String(newName || "").trim();
    if (!name) return tError("Укажи название");

    setCreating(true);
    try {
      await apiPost(
        "/api/admin/donas/inventory/items",
        {
          name,
          unit: String(newUnit || "").trim() || "pcs",
          min_qty: toNum(newMin),
          is_active: !!newActive,
        },
        "admin"
      );
      tSuccess("Позиция добавлена");
      setNewName("");
      setNewUnit("pcs");
      setNewMin("");
      setNewActive(true);
      await loadStock();
    } catch (e) {
      console.error(e);
      const msg = e?.response?.data?.error || e?.message || "Не удалось добавить позицию";
      tError(msg);
    } finally {
      setCreating(false);
    }
  }

  async function setItemActive(item, is_active) {
    setBusyId(item.id);
    try {
      const r = await apiPut(
        `/api/admin/donas/inventory/items/${item.id}`,
        { is_active: !!is_active },
        "admin"
      );
      const next = r?.item || { ...item, is_active: !!is_active };
      setItems((prev) => prev.map((x) => (String(x.id) === String(item.id) ? { ...x, ...next } : x)));
      tSuccess("Сохранено");
    } catch (e) {
      console.error(e);
      tError("Не удалось обновить");
    } finally {
      setBusyId(null);
    }
  }

  async function renameItem(item, name) {
    const nm = String(name || "").trim();
    if (!nm) return tError("Название не может быть пустым");

    setBusyId(item.id);
    try {
      const r = await apiPut(`/api/admin/donas/inventory/items/${item.id}`, { name: nm }, "admin");
      const next = r?.item || { ...item, name: nm };
      setItems((prev) => prev.map((x) => (String(x.id) === String(item.id) ? { ...x, ...next } : x)));
      tSuccess("Сохранено");
    } catch (e) {
      console.error(e);
      const msg = e?.response?.data?.error || e?.message || "Не удалось сохранить";
      tError(msg);
    } finally {
      setBusyId(null);
    }
  }

  async function deactivateItem(item) {
    if (!item) return;
    const ok = window.confirm(`Деактивировать позицию “${item.name}”? История останется.`);
    if (!ok) return;

    setBusyId(item.id);
    try {
      await apiDelete(`/api/admin/donas/inventory/items/${item.id}`, "admin");
      tSuccess("Деактивировано");
      await loadStock();
    } catch (e) {
      console.error(e);
      const msg = e?.response?.data?.error || e?.message || "Не удалось деактивировать";
      tError(msg);
    } finally {
      setBusyId(null);
    }
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
    if (!(qty > 0)) return tError("Укажи количество > 0");
    if (!isISODate(mDate)) return tError("Дата должна быть YYYY-MM-DD");

    setBusyId(item.id);
    try {
      if (mode === "in") {
        await apiPost(
          "/api/admin/donas/inventory/purchases",
          {
            purchased_at: mDate,
            finance_type: mFinanceType,
            vendor: mVendor,
            notes: mNote,
            items: [{ item_id: item.id, qty, unit_price: toNum(mUnitPrice) }],
          },
          "admin"
        );
        tSuccess("Поступление учтено");
      } else {
        await apiPost(
          "/api/admin/donas/inventory/consume",
          { date: mDate, reason: mReasonOut, notes: mNote, items: [{ item_id: item.id, qty }] },
          "admin"
        );
        tSuccess("Списание учтено");
      }

      closeModal();
      await loadStock();
      if (tab === "purchases") await loadPurchasesPage(0, { append: false });
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

  async function openPurchase(p) {
    if (!p?.id) return;
    setPBusy(true);
    setPActive(null);
    setPLines([]);
    setPModalOpen(true);
    try {
      const r = await apiGet(`/api/admin/donas/inventory/purchases/${p.id}`, "admin");
      setPActive(r?.purchase || null);
      setPLines(Array.isArray(r?.items) ? r.items : []);
    } catch (e) {
      console.error(e);
      tError("Не удалось открыть закупку");
      setPModalOpen(false);
    } finally {
      setPBusy(false);
    }
  }

  function closePurchaseModal() {
    setPModalOpen(false);
    setPActive(null);
    setPLines([]);
  }

  function TabBtn({ id, label }) {
    const active = tab === id;
    return (
      <button
        type="button"
        onClick={() => {
          setTab(id);
          refreshTab(id);
        }}
        className={`px-3 py-2 rounded-xl border text-sm ${
          active ? "bg-black text-white border-black" : "bg-white hover:bg-gray-50 text-gray-800"
        }`}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="text-xs text-gray-500">Admin • Dona’s Dosas</div>
          <h1 className="text-2xl font-semibold">Inventory</h1>
          <div className="text-sm text-gray-600">
            Склад (ledger) • <span className="font-mono">/api/admin/donas/inventory</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <TabBtn id="stock" label="Stock" />
          <TabBtn id="purchases" label="Purchases" />
          <button
            type="button"
            onClick={() => refreshTab(tab)}
            className="px-3 py-2 rounded-xl border bg-white text-gray-800 hover:bg-gray-50"
            disabled={tab === "stock" ? loading : pLoading}
          >
            {tab === "stock" ? (loading ? "Обновляю…" : "Обновить") : pLoading ? "Обновляю…" : "Обновить"}
          </button>
        </div>
      </div>

      {tab === "stock" && (
        <>
          {/* Create item */}
          <div className="bg-white border rounded-2xl p-4">
            <div className="flex flex-col md:flex-row md:items-end gap-3">
              <div className="flex-1">
                <div className="text-xs text-gray-500 mb-1">Новая позиция</div>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Напр: Rice flour"
                  className="w-full px-3 py-2 rounded-xl border bg-white"
                />
              </div>

              <div>
                <div className="text-xs text-gray-500 mb-1">Ед.</div>
                <input
                  value={newUnit}
                  onChange={(e) => setNewUnit(e.target.value)}
                  className="w-28 px-3 py-2 rounded-xl border bg-white"
                  placeholder="pcs/kg/l"
                />
              </div>

              <div>
                <div className="text-xs text-gray-500 mb-1">Мин.</div>
                <input
                  inputMode="decimal"
                  value={newMin}
                  onChange={(e) => setNewMin(e.target.value)}
                  className="w-28 px-3 py-2 rounded-xl border bg-white"
                  placeholder="0"
                />
              </div>

              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border bg-white text-sm">
                <input type="checkbox" checked={newActive} onChange={(e) => setNewActive(e.target.checked)} />
                Active
              </label>

              <button
                type="button"
                onClick={createItem}
                disabled={creating}
                className="px-4 py-2 rounded-xl bg-black text-white hover:bg-gray-900 disabled:opacity-60"
              >
                {creating ? "Добавляю…" : "Добавить"}
              </button>
            </div>
          </div>

          {/* Filters */}
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

          {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700">{error}</div>}

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
                          onRename={(nm) => renameItem(it, nm)}
                          onToggleActive={(v) => setItemActive(it, v)}
                          onDeactivate={() => deactivateItem(it)}
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

          {/* IN/OUT Modal */}
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
                    Текущий остаток: <span className="font-semibold">{fmtQty(activeItem.on_hand)}</span>{" "}
                    {activeItem.unit}
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
                    disabled={!!busyId}
                  >
                    Сохранить
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "purchases" && (
        <>
          {pError && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700">{pError}</div>}

          <div className="bg-white border rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-700">
                  <tr>
                    <th className="text-left p-3">Дата</th>
                    <th className="text-left p-3">Vendor</th>
                    <th className="text-left p-3">Type</th>
                    <th className="text-right p-3">Lines</th>
                    <th className="text-right p-3">Total</th>
                    <th className="text-left p-3">Notes</th>
                    <th className="text-right p-3">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {pLoading && purchases.length === 0 && (
                    <tr>
                      <td className="p-4 text-gray-500" colSpan={7}>
                        Загрузка…
                      </td>
                    </tr>
                  )}

                  {!pLoading && purchases.length === 0 && (
                    <tr>
                      <td className="p-4 text-gray-500" colSpan={7}>
                        Закупок пока нет
                      </td>
                    </tr>
                  )}

                  {purchases.map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="p-3 whitespace-nowrap">{String(p.purchased_at || "").slice(0, 10)}</td>
                      <td className="p-3">{p.vendor || <span className="text-gray-400">—</span>}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-1 rounded-lg text-xs border ${
                            String(p.finance_type || "").toLowerCase() === "capex"
                              ? "bg-blue-50 border-blue-200 text-blue-700"
                              : "bg-emerald-50 border-emerald-200 text-emerald-700"
                          }`}
                        >
                          {(p.finance_type || "opex").toUpperCase()}
                        </span>
                      </td>
                      <td className="p-3 text-right">{p.lines}</td>
                      <td className="p-3 text-right font-semibold">{fmtMoney(p.total_sum)}</td>
                      <td className="p-3 max-w-[320px]">
                        <div className="truncate">{p.notes || <span className="text-gray-400">—</span>}</div>
                      </td>
                      <td className="p-3 text-right">
                        <button
                          type="button"
                          onClick={() => openPurchase(p)}
                          className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-3 border-t flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Показано: <span className="font-semibold">{purchases.length}</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={pLoading || pOffset === 0}
                  onClick={() => loadPurchasesPage(0, { append: false })}
                  className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 disabled:opacity-60"
                >
                  В начало
                </button>
                <button
                  type="button"
                  disabled={pLoading || !pHasMore}
                  onClick={() => loadPurchasesPage(pOffset + pLimit, { append: true })}
                  className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 disabled:opacity-60"
                >
                  {pLoading ? "Загрузка…" : pHasMore ? "Показать ещё" : "Конец"}
                </button>
              </div>
            </div>
          </div>

          {/* Purchase details modal */}
          {pModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
              <div className="absolute inset-0 bg-black/40" onClick={closePurchaseModal} />
              <div className="relative w-full max-w-3xl bg-white rounded-2xl border shadow-xl overflow-hidden">
                <div className="p-4 border-b bg-gray-50 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-gray-500">Purchase details</div>
                    <div className="text-lg font-semibold">
                      {pActive?.id ? (
                        <>
                          #{pActive.id} • {String(pActive.purchased_at || "").slice(0, 10)} •{" "}
                          {(pActive.finance_type || "opex").toUpperCase()}
                        </>
                      ) : (
                        "Загрузка…"
                      )}
                    </div>
                    <div className="text-sm text-gray-600">
                      Vendor: <span className="font-semibold">{pActive?.vendor || "—"}</span>
                      {pActive?.notes ? (
                        <>
                          {" "}
                          • Notes: <span className="font-semibold">{pActive.notes}</span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={closePurchaseModal}
                    className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50"
                  >
                    Закрыть
                  </button>
                </div>

                <div className="p-4">
                  {pBusy && <div className="p-3 rounded-xl bg-gray-50 border text-gray-600">Загрузка…</div>}

                  {!pBusy && (
                    <div className="bg-white border rounded-2xl overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <thead className="bg-gray-50 text-gray-700">
                            <tr>
                              <th className="text-left p-3">Item</th>
                              <th className="text-left p-3">Unit</th>
                              <th className="text-right p-3">Qty</th>
                              <th className="text-right p-3">Unit price</th>
                              <th className="text-right p-3">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pLines.length === 0 && (
                              <tr>
                                <td className="p-4 text-gray-500" colSpan={5}>
                                  Нет строк
                                </td>
                              </tr>
                            )}

                            {pLines.map((ln) => (
                              <tr key={ln.id} className="border-t">
                                <td className="p-3">{ln.name || `#${ln.item_id}`}</td>
                                <td className="p-3">{ln.unit || "—"}</td>
                                <td className="p-3 text-right">{fmtQty(ln.qty)}</td>
                                <td className="p-3 text-right">{fmtMoney(ln.unit_price)}</td>
                                <td className="p-3 text-right font-semibold">{fmtMoney(ln.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Row({
  item,
  name,
  unit,
  qty,
  min,
  low,
  busy,
  onRename,
  onToggleActive,
  onDeactivate,
  onIn,
  onOut,
  onSaveMeta,
}) {
  const [editName, setEditName] = useState(String(name || ""));
  const [editMin, setEditMin] = useState(String(item.min_qty ?? ""));
  const [editUnit, setEditUnit] = useState(String(item.unit ?? "pcs"));

  useEffect(() => {
    setEditName(String(item.name || ""));
    setEditMin(String(item.min_qty ?? ""));
    setEditUnit(String(item.unit ?? "pcs"));
  }, [item?.id, item?.name, item?.min_qty, item?.unit]);

  const isActive = item?.is_active !== false;

  return (
    <tr className={low ? "bg-rose-50/50" : ""}>
      <td className="p-3">
        <div className="flex flex-col gap-2">
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="w-full px-2 py-1 rounded-lg border bg-white text-gray-900 font-semibold"
          />
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <label className="inline-flex items-center gap-2 px-2 py-1 rounded-lg border bg-white">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => onToggleActive?.(e.target.checked)}
                disabled={busy}
              />
              Active
            </label>

            <button
              type="button"
              onClick={() => onRename?.(editName)}
              disabled={busy}
              className="px-2 py-1 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-60"
            >
              Save name
            </button>

            <button
              type="button"
              onClick={onDeactivate}
              disabled={busy}
              className="px-2 py-1 rounded-lg border bg-white hover:bg-gray-50 text-rose-700 disabled:opacity-60"
            >
              Deactivate
            </button>
          </div>
        </div>
      </td>

      <td className="p-3">
        <input
          value={editUnit}
          onChange={(e) => setEditUnit(e.target.value)}
          className="w-24 px-2 py-1 rounded-lg border bg-white text-gray-800"
          placeholder="pcs/kg/l…"
          disabled={busy}
        />
      </td>

      <td className="p-3 text-right">
        <span className={low ? "font-bold text-rose-700" : "font-semibold text-gray-900"}>
          {fmtQty(qty)}
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
          disabled={busy}
        />
      </td>

      <td className="p-3">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onIn}
            disabled={busy || !isActive}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
            title={!isActive ? "Inactive item" : ""}
          >
            IN
          </button>
          <button
            type="button"
            onClick={onOut}
            disabled={busy || !isActive}
            className="px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60"
            title={!isActive ? "Inactive item" : ""}
          >
            OUT
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onSaveMeta?.(item, { min_qty: editMin, unit: editUnit })}
            className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-60"
          >
            Save meta
          </button>
        </div>
      </td>
    </tr>
  );
}
