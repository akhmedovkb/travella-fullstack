// frontend/src/pages/admin/DonasMenuItems.jsx

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

export default function DonasMenuItems() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const [showArchived, setShowArchived] = useState(false);

  // форма создания/редактирования
  const [editing, setEditing] = useState(null); // item or null
  const [name, setName] = useState("");
  const [category, setCategory] = useState("dosa");
  const [isActive, setIsActive] = useState(true);

  // рецепт (пока упрощённо: ingredient_id + qty + unit)
  // Ингредиенты подключим следующим шагом, пока id вводим руками.
  const [recipe, setRecipe] = useState([{ ingredient_id: "", qty: "", unit: "g" }]);
  const [recipeOpen, setRecipeOpen] = useState(false);

  const title = useMemo(() => "Позиции меню", []);

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

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

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
          ? r.recipe.map((x) => ({
              ingredient_id: String(x.ingredient_id ?? ""),
              qty: String(x.qty ?? ""),
              unit: String(x.unit ?? "g"),
            }))
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

      // сохранить рецепт сразу после создания
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

          <div className="mt-3 divide-y">
            {items.map((it) => (
              <div key={it.id} className="py-3 flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">
                    {it.name}{" "}
                    {!it.is_active && (
                      <span className="text-xs text-gray-500">(архив)</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500">
                    Категория: {it.category || "dosa"}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => startEdit(it)}
                    className="px-3 py-1.5 rounded-lg border text-sm"
                  >
                    Редактировать
                  </button>
                  {it.is_active && (
                    <button
                      onClick={() => archive(it)}
                      className="px-3 py-1.5 rounded-lg border text-sm text-red-600"
                    >
                      Архивировать
                    </button>
                  )}
                </div>
              </div>
            ))}

            {!items.length && !loading && (
              <div className="py-6 text-sm text-gray-500">
                Пока нет позиций меню. Нажми “Добавить позицию”.
              </div>
            )}
          </div>
        </div>

        {/* FORM */}
        <div className="rounded-2xl border bg-white p-4">
          <div className="font-medium">
            {editing ? `Редактирование #${editing.id}` : "Новая позиция"}
          </div>

          <form onSubmit={saveItem} className="mt-3 space-y-4">
            <div className="space-y-2">
              <label className="text-sm text-gray-600">Название</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border rounded-xl px-3 py-2"
                placeholder="Напр. Masala Dosa"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm text-gray-600">Категория</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full border rounded-xl px-3 py-2"
                >
                  {CATS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm text-gray-600">Активна</label>
                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                  />
                  <span className="text-sm text-gray-700">
                    {isActive ? "Да" : "Нет"}
                  </span>
                </div>
              </div>
            </div>

            <div className="border rounded-2xl p-3">
              <div className="flex items-center justify-between">
                <div className="font-medium">Рецепт</div>
                <button
                  type="button"
                  onClick={() => setRecipeOpen((v) => !v)}
                  className="text-sm underline"
                >
                  {recipeOpen ? "Свернуть" : "Развернуть"}
                </button>
              </div>

              {recipeOpen && (
                <div className="mt-3 space-y-2">
                  <div className="text-xs text-gray-500">
                    Пока без справочника ингредиентов: вводи <b>ingredient_id</b> руками.
                    Следующим шагом подключим “Ингредиенты” с поиском/селектом.
                  </div>

                  {recipe.map((r, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                      <input
                        className="col-span-4 border rounded-xl px-3 py-2 text-sm"
                        placeholder="ingredient_id"
                        value={r.ingredient_id}
                        onChange={(e) =>
                          updateRecipeRow(idx, { ingredient_id: e.target.value })
                        }
                      />
                      <input
                        className="col-span-4 border rounded-xl px-3 py-2 text-sm"
                        placeholder="qty"
                        value={r.qty}
                        onChange={(e) => updateRecipeRow(idx, { qty: e.target.value })}
                      />
                      <input
                        className="col-span-3 border rounded-xl px-3 py-2 text-sm"
                        placeholder="unit (g/ml/pcs)"
                        value={r.unit}
                        onChange={(e) => updateRecipeRow(idx, { unit: e.target.value })}
                      />
                      <button
                        type="button"
                        onClick={() => removeRecipeRow(idx)}
                        className={cls(
                          "col-span-1 rounded-lg border px-2 py-2 text-sm",
                          "hover:bg-gray-50"
                        )}
                        title="Удалить строку"
                      >
                        ✕
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={addRecipeRow}
                    className="px-3 py-2 rounded-lg border text-sm"
                  >
                    + Добавить ингредиент
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-black text-white text-sm"
              >
                {editing ? "Сохранить" : "Создать"}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 rounded-xl border text-sm"
              >
                Сброс
              </button>
            </div>

            <div className="text-xs text-gray-500">
              Удаление = <b>архивирование</b>, чтобы не ломать историю.
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
