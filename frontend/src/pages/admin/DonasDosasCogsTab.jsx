// frontend/src/pages/admin/DonasDosasCogsTab.jsx

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../../api";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function money(n) {
  return Math.round(toNum(n)).toLocaleString("ru-RU");
}

function Sparkline({ values }) {
  const w = 260;
  const h = 60;
  const pad = 4;

  if (!values || values.length < 2) {
    return <div className="text-xs text-gray-500">История: нет данных</div>;
  }

  const vmin = Math.min(...values);
  const vmax = Math.max(...values);
  const rng = Math.max(1e-9, vmax - vmin);

  const pts = values
    .slice()
    .reverse()
    .map((v, i) => {
      const x = pad + (i * (w - pad * 2)) / (values.length - 1);
      const y = pad + (h - pad * 2) * (1 - (v - vmin) / rng);
      return `${x},${y}`;
    })
    .join(" ");

  const last = values[0];
  const prev = values[1];
  const delta = last - prev;

  return (
    <div className="space-y-1">
      <svg width={w} height={h} className="block">
        <polyline points={pts} fill="none" stroke="black" strokeWidth="2" />
      </svg>
      <div className="text-xs text-gray-600 flex items-center justify-between">
        <span>Последний: <b>{money(last)}</b></span>
        <span>Δ: <b>{money(delta)}</b></span>
      </div>
    </div>
  );
}

export default function DonasDosasCogsTab() {
  const [menuItems, setMenuItems] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [recipe, setRecipe] = useState([]);

  const [menuItemId, setMenuItemId] = useState("");
  const [loading, setLoading] = useState(false);

  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    (async () => {
      const m = await apiGet("/api/admin/donas/menu-items");
      setMenuItems(m?.items || []);

      const i = await apiGet("/api/admin/donas/ingredients?includeArchived=true");
      setIngredients(i?.items || []);
    })();
  }, []);

  async function loadHistory(mid) {
    if (!mid) {
      setHistory([]);
      return;
    }
    setHistoryLoading(true);
    try {
      const r = await apiGet(`/api/admin/donas/cogs?menu_item_id=${mid}&limit=30`);
      setHistory(Array.isArray(r?.items) ? r.items : []);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (!menuItemId) {
      setRecipe([]);
      setHistory([]);
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

    loadHistory(menuItemId).catch(() => {});
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
        ing && ing.pack_size ? toNum(ing.pack_price) / toNum(ing.pack_size) : 0;

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

  const totalCost = useMemo(() => rows.reduce((s, r) => s + r.cost, 0), [rows]);

  const historyValues = useMemo(
    () => history.map((x) => toNum(x.total_cost)),
    [history]
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

    setSavedMsg("COGS сохранён ✅");
    setTimeout(() => setSavedMsg(""), 2500);

    await loadHistory(menuItemId);
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Dona’s Dosas — Себестоимость</h1>
        <p className="text-sm text-gray-500">
          Автоматический расчёт себестоимости блюда по рецепту
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow p-4 space-y-4">
        <div className="space-y-2">
          <div className="text-sm font-medium">Выбери блюдо</div>
          <select
            className="w-full border rounded-xl px-3 py-2"
            value={menuItemId}
            onChange={(e) => setMenuItemId(e.target.value)}
          >
            <option value="">—</option>
            {menuItems.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        {menuItemId && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border rounded-2xl p-3">
              <div className="font-semibold mb-2">История COGS</div>
              {historyLoading ? (
                <div className="text-sm text-gray-600">Загрузка истории...</div>
              ) : (
                <Sparkline values={historyValues} />
              )}
            </div>

            <div className="border rounded-2xl p-3 flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-600">Текущий расчёт</div>
                <div className="text-2xl font-semibold">{money(totalCost)}</div>
                {savedMsg && <div className="text-sm text-green-700 mt-1">{savedMsg}</div>}
              </div>
              <button
                onClick={saveSnapshot}
                className="rounded-xl bg-black text-white px-4 py-2 hover:opacity-90"
              >
                Сохранить COGS
              </button>
            </div>
          </div>
        )}

        <div className="border rounded-2xl p-3">
          <div className="font-semibold mb-2">Состав</div>

          {loading ? (
            <div className="text-sm text-gray-600">Загрузка рецепта...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-gray-700 border-b">
                  <tr>
                    <th className="text-left py-2">Ингредиент</th>
                    <th className="text-right py-2">Кол-во</th>
                    <th className="text-right py-2">Цена / ед</th>
                    <th className="text-right py-2">Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={`${r.ingredient_id}-${idx}`} className="border-b">
                      <td className="py-2">{r.name}</td>
                      <td className="py-2 text-right">
                        {toNum(r.qty).toFixed(3)} {r.unit}
                      </td>
                      <td className="py-2 text-right">{money(r.ppu)}</td>
                      <td className="py-2 text-right">{money(r.cost)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-4 text-gray-500">
                        Нет рецепта — добавь рецепт в Menu items → Recipe
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end pt-3">
            <div className="text-right">
              <div className="text-sm text-gray-600">Итого:</div>
              <div className="text-2xl font-semibold">{money(totalCost)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
