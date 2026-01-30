// frontend/src/pages/admin/DonasMenuItems.jsx

import { useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../../api";

/**
 * Tiny tooltip helper (no libs)
 */
function Tip({ text }) {
  return (
    <span className="relative inline-flex items-center group">
      <span className="ml-1 text-gray-400 cursor-help select-none">ⓘ</span>
      <span className="pointer-events-none absolute right-0 top-full mt-2 z-50 hidden w-72 rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-700 shadow-lg group-hover:block">
        {text}
      </span>
    </span>
  );
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n) {
  const v = Math.round(toNum(n));
  return v.toLocaleString("ru-RU");
}

function pct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}

function marginLevel(margin, threshold) {
  if (margin == null || !Number.isFinite(Number(margin))) return "none";
  const m = Number(margin);
  if (m < threshold) return "danger";
  if (m < threshold + 10) return "warn";
  return "ok";
}

const DEFAULT_MARGIN_THRESHOLD = 40;

const emptyForm = {
  name: "",
  category: "",
  price: "",
  is_active: true,
  description: "",
};

export default function DonasMenuItems() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState(null);

  // threshold (UI-only)
  const [marginThreshold, setMarginThreshold] = useState(DEFAULT_MARGIN_THRESHOLD);

  // flash highlight set (UI-only)
  const [flashIds, setFlashIds] = useState(new Set());

  // Ingredients for recipe select
  const [ingredients, setIngredients] = useState([]);
  const ingredientsById = useMemo(() => {
    const m = new Map();
    for (const it of ingredients) m.set(Number(it.id), it);
    return m;
  }, [ingredients]);

  // Recipe modal state
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [recipeItem, setRecipeItem] = useState(null);
  const [recipeLoading, setRecipeLoading] = useState(false);
  const [recipeSaving, setRecipeSaving] = useState(false);
  const [recipeRows, setRecipeRows] = useState([]);

  const editItem = useMemo(
    () => items.find((x) => x.id === editingId) || null,
    [items, editingId]
  );

  function flashRows(ids, duration = 1500) {
    const list = (ids || []).map((x) => Number(x)).filter((x) => Number.isFinite(x));
    if (!list.length) return;

    setFlashIds((prev) => {
      const next = new Set(prev);
      list.forEach((id) => next.add(id));
      return next;
    });

    setTimeout(() => {
      setFlashIds((prev) => {
        const next = new Set(prev);
        list.forEach((id) => next.delete(id));
        return next;
      });
    }, duration);
  }

  async function loadMenuItems() {
    setLoading(true);
    try {
      // Prefer finance endpoint (COGS/Profit/Margin). Fallback to plain list if absent.
      let r;
      try {
        r = await apiGet("/api/admin/donas/menu-items/finance?includeArchived=1", true);
      } catch {
        r = await apiGet("/api/admin/donas/menu-items?includeArchived=1", true);
      }
      setItems(Array.isArray(r?.items) ? r.items : []);
    } finally {
      setLoading(false);
    }
  }

  async function loadIngredients() {
    // Ingredients list for Recipe dropdown
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
      if (editingId) flashRows([editingId]);
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

  async function openRecipe(item) {
    const resolved =
      typeof item === "object" && item
        ? item
        : items.find((x) => x.id === Number(item)) || null;

    setRecipeItem(resolved);
    setRecipeOpen(true);
    setRecipeLoading(true);
    setRecipeRows([]);

    const itemId = resolved?.id ?? Number(item);
    if (!itemId) {
      setRecipeLoading(false);
      return;
    }

    try {
      const r = await apiGet(`/api/admin/donas/menu-items/${itemId}/recipe`, true);
      setRecipeRows(Array.isArray(r?.recipe) ? r.recipe : []);
      await loadIngredients();
    } finally {
      setRecipeLoading(false);
    }
  }

  function closeRecipe() {
    setRecipeOpen(false);
    setRecipeRows([]);
    setRecipeItem(null);
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

      // refresh finance + flash the updated row
      await loadMenuItems();
      flashRows([menuItemId]);
    } finally {
      setRecipeSaving(false);
    }
  }

  function deleteRecipeRow(row) {
    setRecipeRows((rows) => rows.filter((r) => r !== row));
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dona’s Dosas — Menu items</h1>
        <p className="text-sm text-gray-600">
          Создание/редактирование блюд и рецептов. COGS/Profit/Margin считаются на лету по ингредиентам и рецепту.
        </p>
      </div>

      {/* Create / Edit form */}
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
              <button
                type="button"
                onClick={() => openRecipe(editingId)}
                className="px-3 py-2 rounded-xl border hover:bg-gray-50"
              >
                Рецепт / COGS
              </button>
            </div>
          )}
        </form>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="font-semibold">Список блюд</h2>
          <div className="text-sm text-gray-600">{loading ? "Загрузка..." : `Всего: ${items.length}`}</div>
        </div>

        {/* Margin threshold control (UI-only) */}
        <div className="flex items-center gap-3 px-4 py-3 border-b bg-gray-50">
          <div className="text-sm text-gray-700 font-medium">⚠️ Margin threshold</div>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={marginThreshold}
            onChange={(e) => setMarginThreshold(Number(e.target.value) || 0)}
            className="w-20 border rounded-lg px-2 py-1 text-sm"
          />
          <span className="text-sm text-gray-500">%</span>
          <div className="text-xs text-gray-500">
            Красный: ниже порога. Жёлтый: порог…порог+10. Зелёный: выше.
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="text-left px-4 py-2">Название</th>
                <th className="text-left px-4 py-2">Категория</th>

                <th className="text-right px-4 py-2">Цена</th>

                <th className="text-right px-4 py-2">
                  <span className="inline-flex items-center justify-end w-full">
                    COGS
                    <Tip text="COGS считается на лету: Σ (pack_price / pack_size) × qty по рецепту (components). Цена за единицу берётся из Ingredients." />
                  </span>
                </th>

                <th className="text-right px-4 py-2">Прибыль</th>
                <th className="text-right px-4 py-2">Маржа</th>
                <th className="text-left px-4 py-2">Статус</th>
                <th className="text-right px-4 py-2">Действия</th>
              </tr>
            </thead>

            <tbody>
              {!loading && items.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-gray-500" colSpan={8}>
                    Пока пусто — добавь позиции сверху.
                  </td>
                </tr>
              )}

              {items.map((it) => {
                const level = marginLevel(it.margin, marginThreshold);
                const isFlash = flashIds.has(it.id);

                const rowBg =
                  level === "danger" ? "bg-red-50" : level === "warn" ? "bg-amber-50" : "";

                const flashCls = isFlash ? "bg-blue-50 outline outline-2 outline-blue-300" : "";

                const badgeClass =
                  "inline-flex items-center px-2 py-1 rounded-lg text-xs border " +
                  (it.margin == null
                    ? "border-gray-200 text-gray-700"
                    : level === "ok"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : level === "warn"
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "border-red-200 bg-red-50 text-red-700");

                return (
                  <tr
                    key={it.id}
                    className={"border-t transition-colors " + (flashCls || rowBg ? `${flashCls} ${rowBg}` : "")}
                  >
                    <td className="px-4 py-2 font-medium">{it.name}</td>
                    <td className="px-4 py-2">{it.category || "—"}</td>

                    <td className="px-4 py-2 text-right">
                      {it.sell_price != null || it.price != null ? fmt(it.sell_price ?? it.price) : "—"}
                    </td>

                    <td className="px-4 py-2 text-right">
                      {it.has_recipe ? (
                        <span className="inline-flex items-center justify-end gap-1">
                          {fmt(it.cogs)}
                          <Tip text="Формула: Σ (pack_price / pack_size) × qty. Открой Recipe, чтобы увидеть состав и вклад каждого ингредиента." />
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>

                    <td className="px-4 py-2 text-right">{it.has_recipe ? fmt(it.profit) : "—"}</td>

                    <td className="px-4 py-2 text-right">
                      {it.has_recipe ? (
                        <div className="flex items-center justify-end gap-1">
                          {level === "danger" && <span title="Маржа ниже порога">⚠️</span>}
                          <span className={badgeClass}>{pct(it.margin)}</span>
                        </div>
                      ) : (
                        "—"
                      )}
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
                          onClick={() => openRecipe(it.id)}
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
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recipe modal */}
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
                  <div className="flex items-center justify-between gap-2">
                    <button onClick={addRecipeRow} className="px-3 py-2 rounded-xl border hover:bg-gray-50">
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
                          <th className="text-right px-3 py-2">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recipeRows.length === 0 && (
                          <tr>
                            <td className="px-3 py-5 text-gray-500" colSpan={4}>
                              Рецепт пустой — добавь строки.
                            </td>
                          </tr>
                        )}

                        {recipeRows.map((row, idx) => (
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

                            <td className="px-3 py-2 text-right">
                              <button
                                onClick={() => deleteRecipeRow(row)}
                                className="px-3 py-1.5 rounded-xl border border-red-200 text-red-700 hover:bg-red-50"
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="text-xs text-gray-500">
                    Ингредиенты берутся из <b>Dona’s Dosas — Ingredients</b>. Unit подставляется автоматически.
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
