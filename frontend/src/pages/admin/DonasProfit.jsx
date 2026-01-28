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

  // price editing
  const [sellPrice, setSellPrice] = useState("");

  // загрузка справочников
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErr("");
        const m = await apiGet("/api/admin/donas/menu-items");
        setMenuItems(m?.items || []);

        // у тебя в ингредиентах есть include_archived / includeArchived — поддержим оба
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

        // рецепт
        const r = await apiGet(`/api/admin/donas/menu-items/${menuItemId}/recipe`);
        setRecipe(r?.recipe || []);

        // price из menuItem (поддержим разные названия поля)
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
    // важно: selectedItem меняется вместе с menuItemId
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

      // сохраняем цену в menu item
      // (в бэке может быть sell_price или price — отправим оба, чтобы точно попало)
      const payload = {
        sell_price: toNum(sellPrice),
        price: toNum(sellPrice),
      };

      await apiPut(`/api/admin/donas/menu-items/${menuItemId}`, payload);

      // обновим список menuItems локально
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
          <h1 className="text-2xl font-semibold">Dona’s Dosas — Profit / Margin</h1>
          <p className="text-sm text-white/60 mt-1">
            Цена продажи, себестоимость и маржа по рецепту
          </p>
        </div>

        <button
          className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-sm"
          onClick={() => window.location.reload()}
          disabled={loading}
        >
          Обновить
        </button>
      </div>

      {(err || okMsg) && (
        <div className="space-y-2">
          {err && (
            <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/25 text-red-200 text-sm">
              {err}
            </div>
          )}
          {okMsg && (
            <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/25 text-emerald-200 text-sm">
              {okMsg}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* selector */}
        <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
          <label className="block text-xs text-white/60 mb-2">Блюдо</label>
          <select
            value={menuItemId}
            onChange={(e) => setMenuItemId(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-white/25"
          >
            <option value="">— выбери —</option>
            {menuItems.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>

          {selectedItem && (
            <div className="mt-4 text-xs text-white/50">
              ID: <span className="text-white/70">#{selectedItem.id}</span>
            </div>
          )}
        </div>

        {/* summary */}
        <div className="lg:col-span-2 rounded-2xl bg-white/5 border border-white/10 p-4">
          {!menuItemId ? (
            <div className="text-white/60 text-sm">Выбери блюдо слева.</div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="text-lg font-semibold">
                  {selectedItem?.name || "Блюдо"}
                </div>
                {loading && <div className="text-sm text-white/50">загрузка…</div>}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                  <div className="text-xs text-white/60">Цена продажи</div>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      value={sellPrice}
                      onChange={(e) => setSellPrice(e.target.value)}
                      className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-white/25"
                      placeholder="Напр. 65000"
                      inputMode="decimal"
                    />
                    <button
                      onClick={savePrice}
                      disabled={loading}
                      className="px-3 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/25 text-emerald-100 border border-emerald-500/25 text-sm"
                    >
                      Сохранить
                    </button>
                  </div>
                </div>

                <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                  <div className="text-xs text-white/60">COGS (себестоимость)</div>
                  <div className="text-2xl font-semibold mt-2">{money(cogs)}</div>
                </div>

                <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                  <div className="text-xs text-white/60">Прибыль (Price − COGS)</div>
                  <div className="text-2xl font-semibold mt-2">
                    {money(profit)}
                  </div>
                </div>

                <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                  <div className="text-xs text-white/60">Маржа</div>
                  <div className="text-2xl font-semibold mt-2">{pct(margin)}</div>
                </div>
              </div>

              {/* breakdown */}
              <div className="mt-5">
                <div className="text-sm text-white/80 mb-2">Разбор по ингредиентам</div>

                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="min-w-full text-sm">
                    <thead className="text-white/60 border-b border-white/10">
                      <tr>
                        <th className="text-left font-medium px-4 py-3">Ингредиент</th>
                        <th className="text-right font-medium px-4 py-3">Кол-во</th>
                        <th className="text-right font-medium px-4 py-3">Цена / ед</th>
                        <th className="text-right font-medium px-4 py-3">Сумма</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {rows.map((r, idx) => (
                        <tr key={idx}>
                          <td className="px-4 py-3 text-white">{r.name}</td>
                          <td className="px-4 py-3 text-right text-white/80">
                            {r.qty} {r.unit}
                          </td>
                          <td className="px-4 py-3 text-right text-white/80">
                            {r.ppu ? money(r.ppu) : "—"}
                          </td>
                          <td className="px-4 py-3 text-right text-white/80">
                            {money(r.cost)}
                          </td>
                        </tr>
                      ))}

                      {!rows.length && (
                        <tr>
                          <td colSpan={4} className="px-4 py-10 text-center text-white/50">
                            Рецепт пустой — добавь ингредиенты в рецепте блюда
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="text-xs text-white/50 mt-2">
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
