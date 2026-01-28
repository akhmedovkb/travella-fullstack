import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "../../api";

const CATS = [
  { value: "dosa", label: "Dosa" },
  { value: "drinks", label: "Drinks" },
  { value: "extras", label: "Extras" },
];

function cls(...xs) {
  return xs.filter(Boolean).join(" ");
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function fmtNum(n) {
  const v = toNum(n);
  // компактно, без лишних нулей
  if (!Number.isFinite(v)) return "0";
  if (Math.abs(v) >= 1) return String(Math.round(v));
  // для мелких цен за единицу — до 6 знаков, но без хвостов
  return String(v.toFixed(6)).replace(/\.?0+$/, "");
}

export default function DonasMenuItems() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const [showArchived, setShowArchived] = useState(false);

  // ✅ ingredients directory
  const [ingredients, setIngredients] = useState([]);
  const [ingredientsLoading, setIngredientsLoading] = useState(false);

  // форма создания/редактирования
  const [editing, setEditing] = useState(null); // item or null
  const [name, setName] = useState("");
  const [category, setCategory] = useState("dosa");
  const [isActive, setIsActive] = useState(true);

  // рецепт (ingredient_id + qty + unit)
  const [recipe, setRecipe] = useState([{ ingredient_id: "", qty: "", unit: "g" }]);
  const [recipeOpen, setRecipeOpen] = useState(false);

  const title = useMemo(() => "Позиции меню", []);

  const ingredientsById = useMemo(() => {
    const m = new Map();
    for (const it of ingredients || []) {
      m.set(String(it.id), it);
    }
    return m;
  }, [ingredients]);

  async function load() {
    setLoading(true);
    try {
      const q = showArchived ? "?includeArchived=true" : "";
      const r = await apiGet(`/api/admin/donas/menu-items${q}`);
      setItems(r?.items || []);
    } finally {
      setLoading(false);
    }
  }

  async function loadIngredients() {
    setIngredientsLoading(true);
    try {
      // по умолчанию берём только неархивные ингредиенты
      const r = await apiGet(`/api/admin/donas/ingredients`);
      setIngredients(r?.items || []);
    } catch {
      setIngredients([]);
    } finally {
      setIngredientsLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  useEffect(() => {
    loadIngredients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetForm() {
    setEditing(null);
    setName("");
    setCategory("dosa");
    setIsActive(true);
    setRecipe([{ ingredient_id: "", qty: "", unit: "g" }]);
    setRecipeOpen(false);
  }

  function startCreate() {
    resetForm();
    setIsActive(true);
  }

  async function startEdit(item) {
    setEditing(item);
    setName(item.name || "");
    setCategory(item.category || "dosa");
    setIsActive(!!item.is_active);

    // подтянуть рецепт
    try {
      const r = await apiGet(`/api/admin/donas/menu-items/${item.id}/recipe`);
      const rec =
        Array.isArray(r?.recipe) && r.recipe.length
          ? r.recipe.map((x) => {
              const idStr = String(x.ingredient_id ?? "");
              const ing = ingredientsById.get(idStr);
              return {
                ingredient_id: idStr,
                qty: String(x.qty ?? ""),
                unit: String(x.unit ?? (ing?.unit || "g")),
              };
            })
          : [{ ingredient_id: "", qty: "", unit: "g" }];
      setRecipe(rec);
    } catch {
      setRecipe([{ ingredient_id: "", qty: "", unit: "g" }]);
    }

    setRecipeOpen(true);
  }

  async function saveItem(e) {
    e?.preventDefault?.();

    const payload = {
      name: String(name || "").trim(),
      category,
      is_active: isActive,
    };

    if (!payload.name) return alert("Название обязательно");

    if (!editing) {
      const r = await apiPost("/api/admin/donas/menu-items", payload);
      const created = r?.item;
      if (!created?.id) {
        alert("Не удалось создать позицию");
        return;
      }

      await saveRecipe(created.id);

      await load();
      resetForm();
      return;
    }

    await apiPut(`/api/admin/donas/menu-items/${editing.id}`, payload);
    await saveRecipe(editing.id);

    await load();
    resetForm();
  }

  async function saveRecipe(menuItemId) {
    // фильтруем пустые строки
    const normalized = recipe
      .map((r) => ({
        ingredient_id: String(r.ingredient_id || "").trim(),
        qty: String(r.qty || "").trim(),
        unit: String(r.unit || "").trim(),
      }))
      .filter((r) => r.ingredient_id && r.unit);

    const payload = {
      recipe: normalized.map((r) => ({
        ingredient_id: Number(r.ingredient_id),
        qty: toNum(r.qty),
        unit: r.unit,
      })),
    };

    await apiPut(`/api/admin/donas/menu-items/${menuItemId}/recipe`, payload);
  }

  async function archive(item) {
    if (!confirm(`Архивировать позицию “${item.name}”?`)) return;
    await apiDelete(`/api/admin/donas/menu-items/${item.id}`);
    await load();
  }

  function updateRecipeRow(i, patch) {
    setRecipe((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function addRecipeRow() {
    setRecipe((prev) => [...prev, { ingredient_id: "", qty: "", unit: "g" }]);
  }

  function removeRecipeRow(i) {
    setRecipe((prev) => {
      const next = prev.filter((_, idx) => idx !== i);
      return next.length ? next : [{ ingredient_id: "", qty: "", unit: "g" }];
    });
  }

  function onSelectIngredient(rowIdx, ingredientIdStr) {
    const ing = ingredientsById.get(String(ingredientIdStr));
    // авто-юнит из справочника, если есть
    updateRecipeRow(rowIdx, {
      ingredient_id: String(ingredientIdStr || ""),
      unit: ing?.unit ? String(ing.unit) : "g",
    });
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-sm text-gray-500">
            Создавай, редактируй и архивируй позиции меню. Рецепт — это состав позиции.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Показать архив
          </label>

          <button
            onClick={startCreate}
            className="px-3 py-2 rounded-lg bg-black text-white text-sm"
          >
            + Добавить позицию
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* LIST */}
        <div className="rounded-2xl border bg-white p-4">
          <div className="flex items-center justify-between">
            <div className="font-medium">Список</div>
            {loading && <div className="text-sm text-gray-500">Загрузка…</div>}
          </div>

          <div className="mt-3 space-y-2">
            {items.length === 0 ? (
              <div className="text-sm text-gray-500">Пока пусто</div>
            ) : (
              items.map((it) => (
                <div
                  key={it.id}
                  className="p-3 rounded-xl border flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      #{it.id} • {it.name}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Категория: <span className="font-medium">{it.category}</span>{" "}
                      • Статус:{" "}
                      <span className={cls(it.is_active ? "text-green-700" : "text-gray-500")}>
                        {it.is_active ? "active" : "archived"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => startEdit(it)}
                      className="px-3 py-1.5 rounded-lg border text-sm hover:bg-gray-50"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => archive(it)}
                      className="px-3 py-1.5 rounded-lg border text-sm text-red-600 hover:bg-red-50"
                    >
                      Archive
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* FORM */}
        <div className="rounded-2xl border bg-white p-4">
          <div className="flex items-center justify-between">
            <div className="font-medium">
              {editing ? `Редактирование #${editing.id}` : "Создание"}
            </div>
            {(editing || name || recipeOpen) && (
              <button
                onClick={resetForm}
                className="text-sm text-gray-500 hover:text-black"
              >
                Reset
              </button>
            )}
          </div>

          <form onSubmit={saveItem} className="mt-3 space-y-3">
            <div>
              <label className="text-sm text-gray-600">Название</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-xl border px-3 py-2"
                placeholder="Например: Masala Dosa"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-gray-600">Категория</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                >
                  {CATS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                  />
                  Активно
                </label>
              </div>
            </div>

            <div className="pt-2 border-t">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setRecipeOpen((v) => !v)}
                  className="text-sm underline"
                >
                  {recipeOpen ? "Скрыть рецепт" : "Редактировать рецепт"}
                </button>

                <div className="text-xs text-gray-500">
                  {ingredientsLoading ? "Ингредиенты: загрузка…" : `Ингредиенты: ${ingredients.length}`}
                </div>
              </div>

              {recipeOpen && (
                <div className="mt-3 space-y-2">
                  {ingredients.length === 0 && (
                    <div className="text-xs text-red-600">
                      Нет ингредиентов. Сначала добавь их в справочник ингредиентов.
                    </div>
                  )}

                  {recipe.map((r, i) => {
                    const ing = ingredientsById.get(String(r.ingredient_id));
                    return (
                      <div key={i} className="grid grid-cols-12 gap-2 items-center">
                        {/* ingredient select */}
                        <div className="col-span-5">
                          <select
                            className="w-full rounded-xl border px-3 py-2 text-sm"
                            value={r.ingredient_id}
                            onChange={(e) => onSelectIngredient(i, e.target.value)}
                            disabled={ingredients.length === 0}
                          >
                            <option value="">
                              {ingredients.length ? "Выбери ингредиент" : "Ингредиенты не загружены"}
                            </option>
                            {ingredients.map((x) => (
                              <option key={x.id} value={String(x.id)}>
                                {x.name}
                              </option>
                            ))}
                          </select>

                          <div className="mt-1 text-[11px] text-gray-500">
                            {ing ? (
                              <>
                                unit: <span className="font-medium">{ing.unit}</span> • цена/ед:{" "}
                                <span className="font-medium">{fmtNum(ing.price_per_unit)}</span>
                              </>
                            ) : (
                              <span> </span>
                            )}
                          </div>
                        </div>

                        {/* qty */}
                        <input
                          className="col-span-4 rounded-xl border px-3 py-2 text-sm"
                          placeholder="qty"
                          value={r.qty}
                          onChange={(e) => updateRecipeRow(i, { qty: e.target.value })}
                        />

                        {/* unit (можно вручную поправить) */}
                        <input
                          className="col-span-2 rounded-xl border px-3 py-2 text-sm"
                          placeholder="unit"
                          value={r.unit}
                          onChange={(e) => updateRecipeRow(i, { unit: e.target.value })}
                        />

                        <button
                          type="button"
                          onClick={() => removeRecipeRow(i)}
                          className="col-span-1 text-red-600 text-sm"
                          title="Удалить"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}

                  <button
                    type="button"
                    onClick={addRecipeRow}
                    className="px-3 py-2 rounded-lg border text-sm"
                  >
                    + строка
                  </button>
                </div>
              )}
            </div>

            <div className="pt-2 flex gap-2">
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-black text-white text-sm"
              >
                {editing ? "Сохранить" : "Создать"}
              </button>

              {editing && (
                <button
                  type="button"
                  onClick={startCreate}
                  className="px-4 py-2 rounded-xl border text-sm"
                >
                  Новая позиция
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
