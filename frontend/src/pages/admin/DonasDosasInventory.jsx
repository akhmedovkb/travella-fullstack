// frontend/src/pages/admin/DonasDosasInventory.jsx
import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut } from "../../api";
import { tError, tSuccess } from "../../shared/toast";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

const TABS = [
  { key: "items", label: "Items" },
  { key: "purchases", label: "Purchases" },
  { key: "stock", label: "Stock" },
];

export default function DonasDosasInventory() {
  const [tab, setTab] = useState("items");

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [items, setItems] = useState([]);
  const [stock, setStock] = useState([]);

  // create item form
  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState("kg");
  const [newMinQty, setNewMinQty] = useState("0");

  // purchase form
  const [purchasedAt, setPurchasedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [financeType, setFinanceType] = useState("opex");
  const [vendor, setVendor] = useState("");
  const [notes, setNotes] = useState("");

  const [purchaseLines, setPurchaseLines] = useState([
    { item_id: "", qty: "", unit_price: "" },
  ]);

  const tabsUi = useMemo(() => {
    return TABS.map((t) => (
      <button
        key={t.key}
        type="button"
        onClick={() => setTab(t.key)}
        className={[
          "px-3 py-1.5 rounded-full text-sm transition",
          tab === t.key ? "bg-black text-white" : "bg-white border border-black/10 hover:bg-black/5",
        ].join(" ")}
      >
        {t.label}
      </button>
    ));
  }, [tab]);

  async function loadItems() {
    const r = await apiGet("/api/admin/donas/inventory/items", "admin");
    setItems(Array.isArray(r?.items) ? r.items : []);
  }

  async function loadStock() {
    const r = await apiGet("/api/admin/donas/inventory/stock", "admin");
    setStock(Array.isArray(r?.stock) ? r.stock : []);
  }

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadItems(), loadStock()]);
    } catch (e) {
      setError(e?.message || "Failed to load inventory");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createItem(e) {
    e?.preventDefault?.();
    setBusy(true);
    try {
      const payload = {
        name: String(newName || "").trim(),
        unit: String(newUnit || "").trim() || "pcs",
        min_qty: toNum(newMinQty),
        is_active: true,
      };
      if (!payload.name) {
        tError("Name is required");
        return;
      }
      const r = await apiPost("/api/admin/donas/inventory/items", payload, "admin");
      if (r?.ok) {
        tSuccess("Item created");
        setNewName("");
        setNewMinQty("0");
        await loadItems();
        await loadStock();
        setTab("items");
      } else {
        tError("Failed to create item");
      }
    } catch (e2) {
      tError(e2?.message || "Failed to create item");
    } finally {
      setBusy(false);
    }
  }

  async function toggleItemActive(id, nextActive) {
    // если у тебя PUT уже сделан — отлично. Если нет, просто убери эту кнопку.
    setBusy(true);
    try {
      const r = await apiPut(`/api/admin/donas/inventory/items/${id}`, { is_active: !!nextActive }, "admin");
      if (r?.ok) {
        await loadItems();
        await loadStock();
      } else {
        tError("Failed to update item");
      }
    } catch (e) {
      tError(e?.message || "Failed to update item");
    } finally {
      setBusy(false);
    }
  }

  function updateLine(idx, patch) {
    setPurchaseLines((arr) => arr.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  }

  function addLine() {
    setPurchaseLines((arr) => [...arr, { item_id: "", qty: "", unit_price: "" }]);
  }

  function removeLine(idx) {
    setPurchaseLines((arr) => arr.filter((_, i) => i !== idx));
  }

  async function createPurchase(e) {
    e?.preventDefault?.();
    setBusy(true);
    try {
      const cleanLines = purchaseLines
        .map((l) => ({
          item_id: toNum(l.item_id),
          qty: toNum(l.qty),
          unit_price: toNum(l.unit_price),
        }))
        .filter((l) => l.item_id > 0 && l.qty > 0);

      if (!cleanLines.length) {
        tError("Add at least one line: item + qty");
        return;
      }

      const payload = {
        purchased_at: String(purchasedAt || "").slice(0, 10),
        finance_type: String(financeType || "opex"),
        vendor: String(vendor || "").trim(),
        notes: String(notes || "").trim(),
        items: cleanLines,
      };

      const r = await apiPost("/api/admin/donas/inventory/purchases", payload, "admin");
      if (r?.ok) {
        tSuccess("Purchase saved");
        setVendor("");
        setNotes("");
        setPurchaseLines([{ item_id: "", qty: "", unit_price: "" }]);
        await loadStock();
      } else {
        tError("Failed to save purchase");
      }
    } catch (e2) {
      tError(e2?.message || "Failed to save purchase");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-black/50">Admin</div>
          <h1 className="text-2xl font-semibold">Dona’s Dosas — Inventory</h1>
          <div className="text-sm text-black/60">
            Items → Purchases → Stock (on_hand). Purchases also go into Finance via donas_purchases.
          </div>
        </div>

        <button
          type="button"
          onClick={loadAll}
          disabled={loading || busy}
          className="px-3 py-2 rounded-full bg-white border border-black/10 hover:bg-black/5 text-sm disabled:opacity-60"
        >
          Refresh
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">{tabsUi}</div>

      {error && (
        <div className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-6 text-sm text-black/60">Loading…</div>
      ) : (
        <>
          {/* ITEMS */}
          {tab === "items" && (
            <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-black/10 bg-white p-4">
                <div className="flex items-center justify-between">
                  <div className="text-lg font-semibold">Create item</div>
                </div>

                <form className="mt-3 space-y-3" onSubmit={createItem}>
                  <div>
                    <div className="text-xs text-black/60 mb-1">Name</div>
                    <input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-black/10 focus:outline-none focus:ring-2 focus:ring-black/10"
                      placeholder="Rice flour"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-black/60 mb-1">Unit</div>
                      <input
                        value={newUnit}
                        onChange={(e) => setNewUnit(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-black/10 focus:outline-none focus:ring-2 focus:ring-black/10"
                        placeholder="kg"
                      />
                    </div>
                    <div>
                      <div className="text-xs text-black/60 mb-1">Min qty</div>
                      <input
                        value={newMinQty}
                        onChange={(e) => setNewMinQty(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-black/10 focus:outline-none focus:ring-2 focus:ring-black/10"
                        placeholder="5"
                        inputMode="decimal"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={busy}
                    className="px-4 py-2 rounded-full bg-black text-white text-sm disabled:opacity-60"
                  >
                    {busy ? "Saving…" : "Create"}
                  </button>
                </form>
              </div>

              <div className="rounded-2xl border border-black/10 bg-white p-4">
                <div className="text-lg font-semibold">Items</div>

                <div className="mt-3 overflow-auto">
                  <table className="min-w-[720px] w-full text-sm">
                    <thead className="text-black/60">
                      <tr className="border-b border-black/10">
                        <th className="text-left py-2 pr-3">Name</th>
                        <th className="text-left py-2 pr-3">Unit</th>
                        <th className="text-left py-2 pr-3">Min</th>
                        <th className="text-left py-2 pr-3">Active</th>
                        <th className="text-left py-2 pr-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(items || []).map((it) => (
                        <tr key={it.id} className="border-b border-black/5">
                          <td className="py-2 pr-3">{it.name}</td>
                          <td className="py-2 pr-3">{it.unit}</td>
                          <td className="py-2 pr-3">{it.min_qty}</td>
                          <td className="py-2 pr-3">{String(it.is_active) === "true" ? "Yes" : "No"}</td>
                          <td className="py-2 pr-3">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => toggleItemActive(it.id, String(it.is_active) !== "true")}
                              className="px-2.5 py-1 rounded-full bg-white border border-black/10 hover:bg-black/5 text-xs disabled:opacity-60"
                              title="Requires PUT /items/:id"
                            >
                              Toggle active
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!items?.length && (
                        <tr>
                          <td colSpan={5} className="py-3 text-black/50">
                            No items yet
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mt-2 text-xs text-black/50">
                  Если PUT /items/:id ещё не сделан — кнопку Toggle active можно временно убрать.
                </div>
              </div>
            </div>
          )}

          {/* PURCHASES */}
          {tab === "purchases" && (
            <div className="mt-6 rounded-2xl border border-black/10 bg-white p-4">
              <div className="text-lg font-semibold">New purchase</div>

              <form className="mt-3 space-y-3" onSubmit={createPurchase}>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <div className="text-xs text-black/60 mb-1">Date</div>
                    <input
                      type="date"
                      value={purchasedAt}
                      onChange={(e) => setPurchasedAt(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-black/10 focus:outline-none focus:ring-2 focus:ring-black/10"
                    />
                  </div>

                  <div>
                    <div className="text-xs text-black/60 mb-1">Finance type</div>
                    <select
                      value={financeType}
                      onChange={(e) => setFinanceType(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-black/10 focus:outline-none focus:ring-2 focus:ring-black/10 bg-white"
                    >
                      <option value="opex">opex</option>
                      <option value="capex">capex</option>
                    </select>
                  </div>

                  <div>
                    <div className="text-xs text-black/60 mb-1">Vendor</div>
                    <input
                      value={vendor}
                      onChange={(e) => setVendor(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-black/10 focus:outline-none focus:ring-2 focus:ring-black/10"
                      placeholder="Makro"
                    />
                  </div>

                  <div>
                    <div className="text-xs text-black/60 mb-1">Notes</div>
                    <input
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-black/10 focus:outline-none focus:ring-2 focus:ring-black/10"
                      placeholder="weekly supply"
                    />
                  </div>
                </div>

                <div className="mt-2 text-sm font-medium">Lines</div>

                <div className="space-y-2">
                  {purchaseLines.map((l, idx) => (
                    <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-2">
                      <div className="md:col-span-5">
                        <select
                          value={l.item_id}
                          onChange={(e) => updateLine(idx, { item_id: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-black/10 bg-white focus:outline-none focus:ring-2 focus:ring-black/10"
                        >
                          <option value="">Select item…</option>
                          {(items || []).map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.name} ({it.unit})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="md:col-span-2">
                        <input
                          value={l.qty}
                          onChange={(e) => updateLine(idx, { qty: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-black/10 focus:outline-none focus:ring-2 focus:ring-black/10"
                          placeholder="qty"
                          inputMode="decimal"
                        />
                      </div>

                      <div className="md:col-span-3">
                        <input
                          value={l.unit_price}
                          onChange={(e) => updateLine(idx, { unit_price: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-black/10 focus:outline-none focus:ring-2 focus:ring-black/10"
                          placeholder="unit price"
                          inputMode="numeric"
                        />
                      </div>

                      <div className="md:col-span-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          className="px-3 py-2 rounded-xl bg-white border border-black/10 hover:bg-black/5 text-sm"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    type="button"
                    onClick={addLine}
                    className="px-4 py-2 rounded-full bg-white border border-black/10 hover:bg-black/5 text-sm"
                  >
                    + Add line
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-4 py-2 rounded-full bg-black text-white text-sm disabled:opacity-60"
                  >
                    {busy ? "Saving…" : "Save purchase"}
                  </button>
                </div>
              </form>

              <div className="mt-3 text-xs text-black/50">
                После сохранения — stock обновится. Finance увидит это как OPEX/CAPEX по donas_purchases.
              </div>
            </div>
          )}

          {/* STOCK */}
          {tab === "stock" && (
            <div className="mt-6 rounded-2xl border border-black/10 bg-white p-4">
              <div className="text-lg font-semibold">Stock</div>
              <div className="mt-3 overflow-auto">
                <table className="min-w-[720px] w-full text-sm">
                  <thead className="text-black/60">
                    <tr className="border-b border-black/10">
                      <th className="text-left py-2 pr-3">Item</th>
                      <th className="text-left py-2 pr-3">Unit</th>
                      <th className="text-left py-2 pr-3">Min</th>
                      <th className="text-left py-2 pr-3">On hand</th>
                      <th className="text-left py-2 pr-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(stock || []).map((s) => {
                      const onHand = toNum(s.on_hand);
                      const min = toNum(s.min_qty);
                      const low = onHand <= min && min > 0;
                      return (
                        <tr key={s.id} className="border-b border-black/5">
                          <td className="py-2 pr-3">{s.name}</td>
                          <td className="py-2 pr-3">{s.unit}</td>
                          <td className="py-2 pr-3">{s.min_qty}</td>
                          <td className="py-2 pr-3 font-semibold">{onHand}</td>
                          <td className="py-2 pr-3">
                            {low ? (
                              <span className="px-2 py-1 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs">
                                LOW
                              </span>
                            ) : (
                              <span className="px-2 py-1 rounded-full bg-green-50 border border-green-200 text-green-700 text-xs">
                                OK
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {!stock?.length && (
                      <tr>
                        <td colSpan={5} className="py-3 text-black/50">
                          No stock data yet
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 text-xs text-black/50">
                Следующий шаг: “расход” со склада (production usage) — будет уменьшать on_hand и попадать в COGS.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
