// frontend/src/pages/admin/DonasProfit.jsx

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPut } from "../../api";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function money(n) {
  return Math.round(toNum(n)).toLocaleString("ru-RU");
}
function pct(n) {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function calcPpu(ing) {
  const packSize = toNum(ing?.pack_size);
  const packPrice = toNum(ing?.pack_price);
  if (!packSize) return 0;
  return packPrice / packSize;
}

export default function DonasProfit() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const [menuItems, setMenuItems] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [menuItemId, setMenuItemId] = useState("");

  const [recipe, setRecipe] = useState([]);
  const [sellPrice, setSellPrice] = useState("");

  // загрузка справочников
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErr("");
        const m = await apiGet("/api/admin/donas/menu-items");
        setMenuItems(m?.items || []);

        let i;
        try {
          i = await apiGet("/api/admin/donas/ingredients?include_archived=1");
        } catch {
          i = await apiGet("/api/admin/donas/ingredients?includeArchived=true");
        }
        setIngredients(i?.items || []);
      } catch (e) {
        setErr(e?.response?.data?.error || e?.message || "Failed to load data");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const ingredientsById = useMemo(() => {
    const m = new Map();
    ingredients.forEach((x) => m.set(x.id, x));
    return m;
  }, [ingredients]);

  const selectedItem = useMemo(() => {
    const id = Number(menuItemId);
    return menuItems.find((x) => Number(x.id) === id) || null;
  }, [menuItems, menuItemId]);

  // загрузка рецепта для выбранного блюда
  useEffect(() => {
    if (!menuItemId) {
      setRecipe([]);
      setSellPrice("");
      setOkMsg("");
      setErr("");
      return;
    }

    (async () => {
      try {
        setLoading(true);
        setErr("");
        setOkMsg("");

        const r = await apiGet(`/api/admin/donas/menu-items/${menuItemId}/recipe`);
        setRecipe(r?.recipe || []);

        const p =
          selectedItem?.sell_price ??
          selectedItem?.price ??
          selectedItem?.sale_price ??
          selectedItem?.menu_price ??
          "";
        setSellPrice(String(p ?? ""));
      } catch (e) {
        setErr(e?.response?.data?.error || e?.message || "Failed to load recipe");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuItemId]);

  const rows = useMemo(() => {
    return (recipe || []).map((r) => {
      const ing = ingredientsById.get(r.ingredient_id);
      const ppu = calcPpu(ing);
      const qty = toNum(r.qty);
      const cost = ppu * qty;

      return {
        ingredient_id: r.ingredient_id,
        qty: r.qty,
        unit: r.unit,
        name: ing?.name || "—",
        ppu,
        cost,
      };
    });
  }, [recipe, ingredientsById]);

  const cogs = useMemo(() => rows.reduce((s, r) => s + toNum(r.cost), 0), [rows]);
  const price = toNum(sellPrice);
  const profit = price - cogs;
  const margin = price > 0 ? (profit / price) * 100 : NaN;

  async function savePrice() {
    if (!menuItemId) return;

    try {
      setLoading(true);
      setErr("");
      setOkMsg("");

      const payload = {
        sell_price: toNum(sellPrice),
        price: toNum(sellPrice),
      };

      await apiPut(`/api/admin/donas/menu-items/${menuItemId}`, payload);

      setMenuItems((prev) =>
        prev.map((x) =>
          Number(x.id) === Number(menuItemId)
            ? { ...x, sell_price: toNum(sellPrice), price: toNum(sellPrice) }
            : x
        )
      );

      setOkMsg("Цена продажи сохранена");
    } catch (e) {
      setErr(e?.response?.data?.error || e?.message || "Failed to save price");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            Dona’s Dosas — Profit / Margin
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Цена продажи, себестоимость и маржа по рецепту
          </p>
        </div>

        <button
          className="px-3 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm text-gray-800 disabled:opacity-60"
          onClick={() => window.location.reload()}
          disabled={loading}
        >
          Обновить
        </button>
      </div>

      {(err || okMsg) && (
        <div className="space-y-2">
          {err && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
              {err}
            </div>
          )}
          {okMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">
              {okMsg}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* selector */}
        <div className="rounded-2xl bg-white border border-gray-200 p-4 shadow-sm">
          <label className="block text-xs text-gray-600 mb-2">Блюдо</label>
          <select
            value={menuItemId}
            onChange={(e) => setMenuItemId(e.target.value)}
            className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-gray-400"
          >
            <option value="">— выбери —</option>
            {menuItems.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>

          {selectedItem && (
            <div className="mt-4 text-xs text-gray-500">
              ID: <span className="text-gray-800 font-medium">#{selectedItem.id}</span>
            </div>
          )}
        </div>

        {/* summary */}
        <div className="lg:col-span-2 rounded-2xl bg-white border border-gray-200 p-4 shadow-sm relative">
          {loading && (
            <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px] flex items-center justify-center rounded-2xl z-10">
              <div className="text-sm text-gray-700">Загрузка…</div>
            </div>
          )}

          {!menuItemId ? (
            <div className="text-gray-600 text-sm">Выбери блюдо слева.</div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="text-lg font-semibold text-gray-900">
                  {selectedItem?.name || "Блюдо"}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                <div className="rounded-xl bg-white border border-gray-200 p-3">
                  <div className="text-xs text-gray-600">Цена продажи</div>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      value={sellPrice}
                      onChange={(e) => setSellPrice(e.target.value)}
                      className="flex-1 bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-gray-400"
                      placeholder="Напр. 65000"
                      inputMode="decimal"
                    />
                    <button
                      onClick={savePrice}
                      disabled={loading}
                      className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm disabled:opacity-60"
                    >
                      Сохранить
                    </button>
                  </div>
                </div>

                <div className="rounded-xl bg-white border border-gray-200 p-3">
                  <div className="text-xs text-gray-600">COGS (себестоимость)</div>
                  <div className="text-2xl font-semibold mt-2 text-gray-900">
                    {money(cogs)}
                  </div>
                </div>

                <div className="rounded-xl bg-white border border-gray-200 p-3">
                  <div className="text-xs text-gray-600">Прибыль (Price − COGS)</div>
                  <div className="text-2xl font-semibold mt-2 text-gray-900">
                    {money(profit)}
                  </div>
                </div>

                <div className="rounded-xl bg-white border border-gray-200 p-3">
                  <div className="text-xs text-gray-600">Маржа</div>
                  <div className="text-2xl font-semibold mt-2 text-gray-900">
                    {pct(margin)}
                  </div>
                </div>
              </div>

              {/* breakdown */}
              <div className="mt-5">
                <div className="text-sm text-gray-800 font-medium mb-2">
                  Разбор по ингредиентам
                </div>

                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="min-w-full text-sm">
                    <thead className="text-gray-600 border-b border-gray-200 bg-gray-50">
                      <tr>
                        <th className="text-left font-medium px-4 py-3">Ингредиент</th>
                        <th className="text-right font-medium px-4 py-3">Кол-во</th>
                        <th className="text-right font-medium px-4 py-3">Цена / ед</th>
                        <th className="text-right font-medium px-4 py-3">Сумма</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {rows.map((r, idx) => (
                        <tr key={idx} className="bg-white">
                          <td className="px-4 py-3 text-gray-900">{r.name}</td>
                          <td className="px-4 py-3 text-right text-gray-700">
                            {r.qty} {r.unit}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-700">
                            {r.ppu ? money(r.ppu) : "—"}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-900 font-medium">
                            {money(r.cost)}
                          </td>
                        </tr>
                      ))}

                      {!rows.length && (
                        <tr>
                          <td colSpan={4} className="px-4 py-10 text-center text-gray-500">
                            Рецепт пустой — добавь ингредиенты в рецепте блюда
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="text-xs text-gray-500 mt-2">
                  COGS считается из: (pack_price / pack_size) × qty
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
