// frontend/src/pages/admin/DonasCogs.jsx

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../../api";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function money(n) {
  return Math.round(toNum(n)).toLocaleString("ru-RU");
}

export default function DonasCogs() {
  const [menuItems, setMenuItems] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [recipe, setRecipe] = useState([]);

  const [menuItemId, setMenuItemId] = useState("");
  const [loading, setLoading] = useState(false);

  // загрузка меню + ингредиентов
  useEffect(() => {
    (async () => {
      const m = await apiGet("/api/admin/donas/menu-items");
      setMenuItems(m?.items || []);

      const i = await apiGet("/api/admin/donas/ingredients?includeArchived=true");
      setIngredients(i?.items || []);
    })();
  }, []);

  // загрузка рецепта блюда
  useEffect(() => {
    if (!menuItemId) {
      setRecipe([]);
      return;
    }

    (async () => {
      setLoading(true);
      try {
        const r = await apiGet(`/api/admin/donas/menu-items/${menuItemId}/recipe`);
        setRecipe(r?.recipe || []);
      } finally {
        setLoading(false);
      }
    })();
  }, [menuItemId]);

  const ingredientsById = useMemo(() => {
    const m = new Map();
    ingredients.forEach((i) => m.set(i.id, i));
    return m;
  }, [ingredients]);

  const rows = useMemo(() => {
    return recipe.map((r) => {
      const ing = ingredientsById.get(r.ingredient_id);
      const ppu =
        ing && ing.pack_size
          ? toNum(ing.pack_price) / toNum(ing.pack_size)
          : 0;

      const cost = ppu * toNum(r.qty);

      return {
        ...r,
        name: ing?.name || "—",
        unit: r.unit,
        ppu,
        cost,
      };
    });
  }, [recipe, ingredientsById]);

  const totalCost = useMemo(
    () => rows.reduce((s, r) => s + r.cost, 0),
    [rows]
  );

  async function saveSnapshot() {
    if (!menuItemId) return;

    await apiPost("/api/admin/donas/cogs", {
      menu_item_id: menuItemId,
      total_cost: totalCost,
      breakdown: rows.map((r) => ({
        ingredient_id: r.ingredient_id,
        qty: r.qty,
        unit: r.unit,
        cost: r.cost,
      })),
    });

    alert("COGS сохранён");
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Dona’s Dosas — Себестоимость</h1>
        <p className="text-sm text-gray-500">
          Автоматический расчёт себестоимости блюда по рецепту
        </p>
      </div>

      {/* selector */}
      <div className="bg-white rounded-2xl border p-4">
        <label className="text-sm text-gray-600 block mb-2">
          Выбери блюдо
        </label>
        <select
          value={menuItemId}
          onChange={(e) => setMenuItemId(e.target.value)}
          className="w-full border rounded-xl px-3 py-2"
        >
          <option value="">— выбери —</option>
          {menuItems.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      {/* table */}
      {menuItemId && (
        <div className="bg-white rounded-2xl border p-4">
          <div className="font-medium mb-3">Состав</div>

          {loading ? (
            <div className="text-sm text-gray-500">Загрузка…</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr>
                  <th className="text-left py-2">Ингредиент</th>
                  <th className="text-right py-2">Кол-во</th>
                  <th className="text-right py-2">Цена / ед</th>
                  <th className="text-right py-2">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2">{r.name}</td>
                    <td className="py-2 text-right">
                      {r.qty} {r.unit}
                    </td>
                    <td className="py-2 text-right">
                      {money(r.ppu)}
                    </td>
                    <td className="py-2 text-right font-medium">
                      {money(r.cost)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="pt-3 text-right font-semibold">
                    Итого:
                  </td>
                  <td className="pt-3 text-right text-lg font-bold">
                    {money(totalCost)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}

          <div className="mt-4 flex justify-end">
            <button
              onClick={saveSnapshot}
              className="px-4 py-2 rounded-xl bg-black text-white"
            >
              Сохранить COGS
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
