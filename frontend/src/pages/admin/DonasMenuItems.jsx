// frontend/src/pages/admin/DonasMenuItems.jsx

import { useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../../api";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function fmt(n) {
  const v = Math.round(toNum(n));
  return v.toLocaleString("ru-RU");
}

const emptyForm = {
  name: "",
  category: "",
  price: "",
  is_active: true,
  description: "",
};

function calcPpu(ing) {
  const packSize = toNum(ing?.pack_size);
  const packPrice = toNum(ing?.pack_price);
  if (!packSize) return 0;
  return packPrice / packSize;
}

export default function DonasMenuItems() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const editItem = useMemo(
    () => items.find((x) => x.id === editingId) || null,
    [items, editingId]
  );

  // ✅ INGREDIENTS (for recipe)
  const [ingredients, setIngredients] = useState([]);
  const ingredientsById = useMemo(() => {
    const m = new Map();
    for (const it of ingredients) m.set(Number(it.id), it);
    return m;
  }, [ingredients]);

  // Recipe modal / panel
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [recipeItem, setRecipeItem] = useState(null);
  const [recipeLoading, setRecipeLoading] = useState(false);
  const [recipeSaving, setRecipeSaving] = useState(false);
  const [recipeRows, setRecipeRows] = useState([]);

  // COGS snapshots / warning
  const [cogsLast, setCogsLast] = useState(null); // { total_cost, created_at, ... } if exists
  const [cogsHistory, setCogsHistory] = useState([]); // optional if endpoint exists
  const [cogsWarn, setCogsWarn] = useState(null); // string

  async function loadMenuItems() {
    setLoading(true);
    try {
      const r = await apiGet("/api/admin/donas/menu-items?includeArchived=1", true);
      setItems(Array.isArray(r?.items) ? r.items : []);
    } finally {
      setLoading(false);
    }
  }

  async function loadIngredients() {
    const r = await apiGet("/api/admin/donas/ingredients", true);
    setIngredients(Array.isArray(r?.items) ? r.items : []);
  }

  useEffect(() => {
    loadMenuItems();
    loadIngredients().catch(() => {});
  }, []);

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
  }

  function startEdit(id) {
    const it = items.find((x) => x.id === id);
    if (!it) return;
    setEditingId(id);
    setForm({
      name: it.name || "",
      category: it.category || "",
      price: it.sell_price ?? it.price ?? "",
      is_active: !!it.is_active,
      description: it.description || "",
    });
  }

  async function save(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const payload = {
        name: String(form.name || "").trim(),
        category: String(form.category || "").trim() || null,
        // поддержим несколько имён полей (в разных версиях БД/кода)
        price: form.price === "" ? null : toNum(form.price),
        sell_price: form.price === "" ? null : toNum(form.price),
        is_active: !!form.is_active,
        description: String(form.description || "").trim() || null,
      };

      if (!payload.name) return;

      if (editingId) {
        await apiPut(`/api/admin/donas/menu-items/${editingId}`, payload, true);
      } else {
        await apiPost("/api/admin/donas/menu-items", payload, true);
      }

      await loadMenuItems();
      if (!editingId) setForm(emptyForm);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    await apiDelete(`/api/admin/donas/menu-items/${id}`, null, true);
    if (editingId === id) startCreate();
    await loadMenuItems();
  }

  // ---------- COGS calc (live) ----------
  const recipeRowsComputed = useMemo(() => {
    return (recipeRows || []).map((r) => {
      const ing = ingredientsById.get(Number(r.ingredient_id));
      const ppu = calcPpu(ing);
      const qty = toNum(r.qty);
      const cost = ppu * qty;

      return {
        ...r,
        _ingName: ing?.name || "—",
        _ppu: ppu,
        _cost: cost,
      };
    });
  }, [recipeRows, ingredientsById]);

  const recipeTotalCost = useMemo(() => {
    return recipeRowsComputed.reduce((s, r) => s + toNum(r._cost), 0);
  }, [recipeRowsComputed]);

  const sellPrice = toNum(recipeItem?.sell_price ?? recipeItem?.price);
  const profit = sellPrice - recipeTotalCost;
  const margin = sellPrice > 0 ? (profit / sellPrice) * 100 : 0;

  async function tryLoadCogsForItem(menuItemId) {
    setCogsLast(null);
    setCogsHistory([]);
    setCogsWarn(null);

    // 1) Latest snapshot (если есть эндпоинт)
    try {
      const last = await apiGet(
        `/api/admin/donas/cogs/latest?menu_item_id=${encodeURIComponent(menuItemId)}`,
        true
      );
      if (last && typeof last === "object") setCogsLast(last);
    } catch {
      // если эндпоинта нет — просто молча
    }

    // 2) History (если есть эндпоинт)
    try {
      const hist = await apiGet(
        `/api/admin/donas/cogs?menu_item_id=${encodeURIComponent(menuItemId)}&limit=10`,
        true
      );
      const arr = Array.isArray(hist?.items) ? hist.items : Array.isArray(hist) ? hist : [];
      setCogsHistory(arr);
    } catch {
      // тоже молча
    }
  }

  async function openRecipe(item) {
    const fresh = items.find((x) => x.id === item.id) || item;
    setRecipeItem(fresh);

    setRecipeOpen(true);
    setRecipeLoading(true);
    setRecipeRows([]);
    setCogsLast(null);
    setCogsHistory([]);
    setCogsWarn(null);

    try {
      const r = await apiGet(`/api/admin/donas/menu-items/${fresh.id}/recipe`, true);
      setRecipeRows(Array.isArray(r?.recipe) ? r.recipe : []);
      await loadIngredients();
      await tryLoadCogsForItem(fresh.id);
    } finally {
      setRecipeLoading(false);
    }
  }

  function closeRecipe() {
    setRecipeOpen(false);
    setRecipeRows([]);
    setRecipeItem(null);
    setCogsLast(null);
    setCogsHistory([]);
    setCogsWarn(null);
  }

  function addRecipeRow() {
    setRecipeRows((rows) => [
      ...rows,
      {
        id: null,
        ingredient_id: "",
        qty: "",
        unit: "g",
      },
    ]);
  }

  function updateRecipeRow(idx, patch) {
    setRecipeRows((rows) => {
      const next = [...rows];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  function onSelectIngredient(idx, ingredientId) {
    const idNum = Number(ingredientId);
    const ing = ingredientsById.get(idNum);
    updateRecipeRow(idx, {
      ingredient_id: ingredientId,
      unit: ing?.unit || "g",
    });
  }

  async function saveCogsSnapshot(menuItemId) {
    // Snapshot контракт как в DonasCogs.jsx :contentReference[oaicite:1]{index=1}
    const breakdown = recipeRowsComputed
      .filter((r) => Number(toNum(r.ingredient_id)) > 0)
      .map((r) => ({
        ingredient_id: Number(r.ingredient_id),
        qty: toNum(r.qty),
        unit: String(r.unit || "").trim() || "g",
        cost: toNum(r._cost),
      }));

    await apiPost(
      "/api/admin/donas/cogs",
      {
        menu_item_id: menuItemId,
        total_cost: recipeTotalCost,
        breakdown,
      },
      true
    );
  }

  async function saveRecipe(menuItemId) {
    if (recipeSaving) return;
    setRecipeSaving(true);
    try {
      const cleaned = recipeRows
        .map((row) => ({
          ingredient_id: row.ingredient_id === "" ? null : Number(row.ingredient_id),
          qty: row.qty === "" ? 0 : toNum(row.qty),
          unit: String(row.unit || "").trim() || "g",
        }))
        .filter((r) => Number.isFinite(r.ingredient_id) && r.ingredient_id > 0);

      const r = await apiPut(
        `/api/admin/donas/menu-items/${menuItemId}/recipe`,
        { recipe: cleaned },
        true
      );

      setRecipeRows(Array.isArray(r?.recipe) ? r.recipe : []);

      // ✅ Сохраняем snapshot COGS сразу после сохранения рецепта
      try {
        await saveCogsSnapshot(menuItemId);
        await tryLoadCogsForItem(menuItemId);
      } catch {
        // snapshot не должен ломать сохранение рецепта
      }
    } finally {
      setRecipeSaving(false);
    }
  }

  function deleteRecipeRow(row) {
    setRecipeRows((rows) => rows.filter((r) => r !== row));
  }

  // Auto-warning: если есть last snapshot — сравним с текущим COGS
  useEffect(() => {
    if (!recipeOpen || !recipeItem?.id) return;
    if (!cogsLast || cogsLast.total_cost == null) return;

    const prev = toNum(cogsLast.total_cost);
    const cur = toNum(recipeTotalCost);

    if (prev <= 0 || cur <= 0) {
      setCogsWarn(null);
      return;
    }

    const diffPct = ((cur - prev) / prev) * 100;

    // Порог: +5% вверх = warn (можешь поменять)
    if (diffPct >= 5) {
      setCogsWarn(
        `⚠️ Себестоимость выросла на ${diffPct.toFixed(1)}% по сравнению с последним сохранённым COGS (${fmt(
          prev
        )} → ${fmt(cur)} UZS). Проверь цены ингредиентов.`
      );
    } else {
      setCogsWarn(null);
    }
  }, [recipeOpen, recipeItem?.id, cogsLast, recipeTotalCost]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dona’s Dosas — Menu items</h1>
        <p className="text-sm text-gray-600">
          Создание/редактирование блюд (позиций меню) и рецептов.
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow p-4">
        <h2 className="font-semibold mb-3">{editingId ? "Редактировать блюдо" : "Добавить блюдо"}</h2>

        <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <input
            className="border rounded-xl px-3 py-2 md:col-span-2"
            placeholder="Название"
            value={form.name}
            onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
          />

          <input
            className="border rounded-xl px-3 py-2"
            placeholder="Категория"
            value={form.category}
            onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))}
          />

          <input
            className="border rounded-xl px-3 py-2"
            placeholder="Цена (UZS)"
            value={form.price}
            onChange={(e) => setForm((s) => ({ ...s, price: e.target.value }))}
          />

          <label className="inline-flex items-center gap-2 text-sm px-2">
            <input
              type="checkbox"
              checked={!!form.is_active}
              onChange={(e) => setForm((s) => ({ ...s, is_active: e.target.checked }))}
            />
            Активно
          </label>

          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-black text-white px-4 py-2 hover:opacity-90 disabled:opacity-60"
          >
            {editingId ? "Сохранить" : "Добавить"}
          </button>

          <textarea
            className="border rounded-xl px-3 py-2 md:col-span-6"
            placeholder="Описание (опционально)"
            value={form.description}
            onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
            rows={2}
          />

          {editingId && (
            <div className="md:col-span-6 flex gap-2">
              <button
                type="button"
                onClick={startCreate}
                className="px-3 py-2 rounded-xl border hover:bg-gray-50"
              >
                Отмена
              </button>

              {/* ✅ FIX: openRecipe ждёт item, не id */}
              <button
                type="button"
                onClick={() => editItem && openRecipe(editItem)}
                disabled={!editItem}
                className="px-3 py-2 rounded-xl border hover:bg-gray-50 disabled:opacity-60"
              >
                Рецепт / COGS
              </button>
            </div>
          )}
        </form>
      </div>

      <div className="bg-white rounded-2xl shadow overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="font-semibold">Список блюд</h2>
          <div className="text-sm text-gray-600">
            {loading ? "Загрузка..." : `Всего: ${items.length}`}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="text-left px-4 py-2">Название</th>
                <th className="text-left px-4 py-2">Категория</th>
                <th className="text-right px-4 py-2">Цена</th>
                <th className="text-left px-4 py-2">Статус</th>
                <th className="text-right px-4 py-2">Действия</th>
              </tr>
            </thead>

            <tbody>
              {!loading && items.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-gray-500" colSpan={5}>
                    Пока пусто — добавь позиции сверху.
                  </td>
                </tr>
              )}

              {items.map((it) => (
                <tr key={it.id} className="border-t">
                  <td className="px-4 py-2 font-medium">{it.name}</td>
                  <td className="px-4 py-2">{it.category || "—"}</td>
                  <td className="px-4 py-2 text-right">
                    {it.sell_price != null || it.price != null ? fmt(it.sell_price ?? it.price) : "—"}
                  </td>
                  <td className="px-4 py-2">{it.is_active ? "active" : "inactive"}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <div className="inline-flex gap-2">
                      <button
                        onClick={() => startEdit(it.id)}
                        className="px-3 py-1.5 rounded-xl border hover:bg-gray-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => openRecipe(it)}
                        className="px-3 py-1.5 rounded-xl border hover:bg-gray-50"
                      >
                        Recipe
                      </button>
                      <button
                        onClick={() => remove(it.id)}
                        className="px-3 py-1.5 rounded-xl border border-red-200 text-red-700 hover:bg-red-50"
                      >
                        Archive
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recipe drawer/modal */}
      {recipeOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end md:items-center justify-center p-3">
          <div className="w-full max-w-4xl bg-white rounded-2xl shadow-lg overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div>
                <div className="font-semibold">Рецепт / COGS</div>
                <div className="text-xs text-gray-600">
                  {recipeItem ? `Блюдо: ${recipeItem.name} (#${recipeItem.id})` : ""}
                </div>
              </div>
              <button onClick={closeRecipe} className="px-3 py-1.5 rounded-xl border hover:bg-gray-50">
                Close
              </button>
            </div>

            <div className="p-4 space-y-3">
              {recipeLoading ? (
                <div className="text-sm text-gray-600">Загрузка рецепта...</div>
              ) : (
                <>
                  {/* Summary + warning */}
                  {recipeItem && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                        <div className="border rounded-xl p-3">
                          <div className="text-gray-500 text-xs">Цена</div>
                          <div className="font-semibold">{fmt(sellPrice)} UZS</div>
                        </div>

                        <div className="border rounded-xl p-3">
                          <div className="text-gray-500 text-xs">COGS</div>
                          <div className="font-semibold">{fmt(recipeTotalCost)} UZS</div>
                        </div>

                        <div className="border rounded-xl p-3">
                          <div className="text-gray-500 text-xs">Прибыль</div>
                          <div className="font-semibold">{fmt(profit)} UZS</div>
                        </div>

                        <div
                          className={`border rounded-xl p-3 ${
                            margin < 60
                              ? "border-red-300 bg-red-50"
                              : margin < 70
                              ? "border-yellow-300 bg-yellow-50"
                              : "border-green-300 bg-green-50"
                          }`}
                        >
                          <div className="text-gray-500 text-xs">Маржа</div>
                          <div className="font-semibold">
                            {Number.isFinite(margin) ? `${margin.toFixed(1)}%` : "—"}
                            {margin < 60 && <span className="ml-2 text-red-700">⚠️</span>}
                          </div>
                        </div>
                      </div>

                      {cogsWarn && (
                        <div className="border border-amber-200 bg-amber-50 text-amber-900 rounded-xl p-3 text-sm">
                          {cogsWarn}
                        </div>
                      )}

                      {cogsLast?.total_cost != null && (
                        <div className="text-xs text-gray-500">
                          Последний сохранённый COGS: <b>{fmt(cogsLast.total_cost)} UZS</b>
                          {cogsLast.created_at ? ` • ${String(cogsLast.created_at)}` : ""}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={addRecipeRow}
                      className="px-3 py-2 rounded-xl border hover:bg-gray-50"
                    >
                      + Add row
                    </button>

                    <div className="flex gap-2">
                      <button
                        onClick={() => saveRecipe(recipeItem?.id)}
                        disabled={recipeSaving || !recipeItem?.id}
                        className="px-4 py-2 rounded-xl bg-black text-white hover:opacity-90 disabled:opacity-60"
                      >
                        Save
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50 text-gray-700">
                        <tr>
                          <th className="text-left px-3 py-2">Ingredient</th>
                          <th className="text-right px-3 py-2">Qty</th>
                          <th className="text-left px-3 py-2">Unit</th>
                          <th className="text-right px-3 py-2">Price / unit</th>
                          <th className="text-right px-3 py-2">Cost</th>
                          <th className="text-right px-3 py-2">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recipeRowsComputed.length === 0 && (
                          <tr>
                            <td className="px-3 py-5 text-gray-500" colSpan={6}>
                              Рецепт пустой — добавь строки.
                            </td>
                          </tr>
                        )}

                        {recipeRowsComputed.map((row, idx) => {
                          return (
                            <tr key={row.id ?? `new-${idx}`} className="border-t">
                              <td className="px-3 py-2">
                                <select
                                  className="border rounded-xl px-2 py-1 w-full"
                                  value={row.ingredient_id ?? ""}
                                  onChange={(e) => onSelectIngredient(idx, e.target.value)}
                                >
                                  <option value="">— choose ingredient —</option>
                                  {ingredients.map((ing) => (
                                    <option key={ing.id} value={ing.id}>
                                      #{ing.id} — {ing.name} ({ing.unit || "g"})
                                    </option>
                                  ))}
                                </select>
                              </td>

                              <td className="px-3 py-2 text-right">
                                <input
                                  className="border rounded-xl px-2 py-1 w-28 text-right"
                                  value={row.qty ?? ""}
                                  onChange={(e) => updateRecipeRow(idx, { qty: e.target.value })}
                                />
                              </td>

                              <td className="px-3 py-2">
                                <select
                                  className="border rounded-xl px-2 py-1"
                                  value={row.unit ?? "g"}
                                  onChange={(e) => updateRecipeRow(idx, { unit: e.target.value })}
                                >
                                  <option value="g">g</option>
                                  <option value="ml">ml</option>
                                  <option value="pcs">pcs</option>
                                </select>
                              </td>

                              <td className="px-3 py-2 text-right text-gray-700">
                                {row._ppu ? fmt(row._ppu) : "—"}
                              </td>

                              <td className="px-3 py-2 text-right font-medium">
                                {row._cost ? fmt(row._cost) : "—"}
                              </td>

                              <td className="px-3 py-2 text-right">
                                <button
                                  onClick={() => deleteRecipeRow(row)}
                                  className="px-3 py-1.5 rounded-xl border border-red-200 text-red-700 hover:bg-red-50"
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          );
                        })}

                        {recipeRowsComputed.length > 0 && (
                          <tr className="border-t bg-gray-50">
                            <td className="px-3 py-3 font-semibold" colSpan={4}>
                              Итого COGS
                            </td>
                            <td className="px-3 py-3 text-right font-semibold">
                              {fmt(recipeTotalCost)}
                            </td>
                            <td className="px-3 py-3" />
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* History (если эндпоинт есть) */}
                  {cogsHistory?.length > 0 && (
                    <div className="mt-2">
                      <div className="text-sm font-medium text-gray-800 mb-2">
                        История COGS (последние)
                      </div>
                      <div className="overflow-x-auto rounded-xl border">
                        <table className="min-w-full text-sm">
                          <thead className="bg-gray-50 text-gray-700">
                            <tr>
                              <th className="text-left px-3 py-2">Дата</th>
                              <th className="text-right px-3 py-2">COGS</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cogsHistory.map((h, i) => (
                              <tr key={h.id ?? i} className="border-t">
                                <td className="px-3 py-2 text-gray-700">
                                  {h.created_at ? String(h.created_at) : "—"}
                                </td>
                                <td className="px-3 py-2 text-right font-medium">
                                  {h.total_cost != null ? fmt(h.total_cost) : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="text-xs text-gray-500 mt-2">
                        История показывается только если на бэке есть GET /api/admin/donas/cogs*.
                      </div>
                    </div>
                  )}

                  <div className="text-xs text-gray-500">
                    Ингредиенты берутся из <b>Dona’s Dosas — Ingredients</b>. Unit подставляется автоматически.
                    <br />
                    COGS считается из: <b>(pack_price / pack_size) × qty</b>.
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
