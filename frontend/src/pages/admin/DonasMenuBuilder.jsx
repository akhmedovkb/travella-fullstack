// frontend/src/pages/admin/DonasMenuBuilder.jsx

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPut } from "../../api";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function fmtMoney(n) {
  const v = Math.round(toNum(n));
  return v.toLocaleString("ru-RU");
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function getSellPrice(mi) {
  // поддержим разные поля (на случай старых данных)
  const p =
    mi?.sell_price ??
    mi?.price ??
    mi?.sale_price ??
    mi?.menu_price ??
    0;
  return toNum(p);
}

function calcPpu(ing) {
  // price per unit = pack_price / pack_size
  const packSize = toNum(ing?.pack_size);
  const packPrice = toNum(ing?.pack_price);
  if (!packSize) return 0;
  return packPrice / packSize;
}

function marginBadge(marginPct) {
  if (!Number.isFinite(marginPct)) {
    return { cls: "bg-gray-100 text-gray-700 border-gray-200", label: "—" };
  }
  if (marginPct < 40) return { cls: "bg-red-50 text-red-700 border-red-200", label: `${marginPct.toFixed(1)}%` };
  if (marginPct < 60) return { cls: "bg-yellow-50 text-yellow-800 border-yellow-200", label: `${marginPct.toFixed(1)}%` };
  return { cls: "bg-emerald-50 text-emerald-700 border-emerald-200", label: `${marginPct.toFixed(1)}%` };
}

export default function DonasMenuBuilder() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const [menuItems, setMenuItems] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [recipesByItem, setRecipesByItem] = useState({}); // { [id]: recipe[] }
  const [recipeMetaByItem, setRecipeMetaByItem] = useState({}); // { [id]: { missingCount, unitMismatchCount } }

  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("name"); // name | price | cogs | profit | margin
  const [sortDir, setSortDir] = useState("asc"); // asc | desc

  const [pctAdjust, setPctAdjust] = useState("10"); // quick %
  const [savingId, setSavingId] = useState(null);
  const [bulkSaving, setBulkSaving] = useState(false);

  // recipe modal
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [recipeItemId, setRecipeItemId] = useState(null);
  const [recipeRows, setRecipeRows] = useState([]);
  const [recipeSaving, setRecipeSaving] = useState(false);
  const [copyFromId, setCopyFromId] = useState("");

  const ingredientsById = useMemo(() => {
    const m = new Map();
    for (const it of ingredients) m.set(Number(it.id), it);
    return m;
  }, [ingredients]);

  async function loadAll() {
    setLoading(true);
    setErr("");
    setOk("");
    try {
      // ✅ menu items
      // includeArchived=1 — если хочешь показывать архивные, добавим позже чекбокс.
      const m = await apiGet("/api/admin/donas/menu-items?includeArchived=1");
      const items = Array.isArray(m?.items) ? m.items : [];
      setMenuItems(items);

      // ✅ ingredients
      const ing = await apiGet("/api/admin/donas/ingredients?includeArchived=1");
      const ings = Array.isArray(ing?.items) ? ing.items : [];
      setIngredients(ings);

      // ✅ recipes for all items (parallel)
      const pairs = await Promise.all(
        items.map(async (it) => {
          try {
            const r = await apiGet(`/api/admin/donas/menu-items/${it.id}/recipe`);
            return [String(it.id), Array.isArray(r?.recipe) ? r.recipe : []];
          } catch {
            return [String(it.id), []];
          }
        })
      );

      const map = {};
      const meta = {};
      for (const [id, rec] of pairs) {
        map[id] = rec;

        let missingCount = 0;
        let unitMismatchCount = 0;

        for (const row of rec) {
          const ingRow = ings.find((x) => Number(x.id) === Number(row.ingredient_id));
          if (!ingRow) {
            missingCount += 1;
            continue;
          }
          const ingUnit = String(ingRow.unit || "").trim();
          const rUnit = String(row.unit || "").trim();
          // если unit пустой — не считаем mismatch, просто считаем как "как есть"
          if (ingUnit && rUnit && ingUnit !== rUnit) unitMismatchCount += 1;
        }

        meta[id] = { missingCount, unitMismatchCount };
      }

      setRecipesByItem(map);
      setRecipeMetaByItem(meta);
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to load Menu Builder");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const computed = useMemo(() => {
    const list = (menuItems || []).map((mi) => {
      const recipe = recipesByItem[String(mi.id)] || [];

      // если нет рецепта — COGS считаем как null (а не 0)
      let cogs = 0;
      let hasRecipe = recipe.length > 0;
      let hasAnyValid = false;

      if (!hasRecipe) {
        cogs = null;
      } else {
        cogs = recipe.reduce((sum, r) => {
          const ing = ingredientsById.get(Number(r.ingredient_id));
          if (!ing) return sum; // ingredient missing => skip
          const ppu = calcPpu(ing);
          const qty = toNum(r.qty);
          if (!ppu || !qty) return sum;
          hasAnyValid = true;
          return sum + ppu * qty;
        }, 0);

        // если рецепт есть, но все qty/ppu нулевые → считаем как null (чтобы не показывать 100%)
        if (!hasAnyValid) cogs = null;
      }

      const price = getSellPrice(mi);
      const profit = cogs === null ? null : price - cogs;
      const margin = cogs === null || price <= 0 ? NaN : (profit / price) * 100;

      return {
        ...mi,
        _price: price,
        _cogs: cogs,
        _profit: profit,
        _margin: margin,
        _recipeCount: recipe.length,
      };
    });

    // filter
    const qq = String(q || "").trim().toLowerCase();
    const filtered = qq
      ? list.filter((x) => String(x.name || "").toLowerCase().includes(qq))
      : list;

    // sort
    const dir = sortDir === "asc" ? 1 : -1;
    const sorted = [...filtered].sort((a, b) => {
      let va, vb;

      if (sortKey === "name") {
        va = String(a.name || "");
        vb = String(b.name || "");
        return va.localeCompare(vb) * dir;
      }

      if (sortKey === "price") { va = a._price; vb = b._price; }
      else if (sortKey === "cogs") { va = a._cogs ?? -1; vb = b._cogs ?? -1; }
      else if (sortKey === "profit") { va = a._profit ?? -1; vb = b._profit ?? -1; }
      else { va = a._margin; vb = b._margin; }

      const aBad = !Number.isFinite(va);
      const bBad = !Number.isFinite(vb);
      if (aBad && bBad) return 0;
      if (aBad) return 1;
      if (bBad) return -1;

      return (va - vb) * dir;
    });

    return sorted;
  }, [menuItems, recipesByItem, ingredientsById, q, sortKey, sortDir]);

  const totals = useMemo(() => {
    const n = computed.length;
    const sumPrice = computed.reduce((s, x) => s + toNum(x._price), 0);

    // COGS/Profit суммируем только там, где они есть (не null)
    const sumCogs = computed.reduce((s, x) => (x._cogs === null ? s : s + toNum(x._cogs)), 0);
    const sumProfit = computed.reduce((s, x) => (x._profit === null ? s : s + toNum(x._profit)), 0);

    const avgMargin = sumPrice > 0 ? (sumProfit / sumPrice) * 100 : NaN;
    return { n, sumPrice, sumCogs, sumProfit, avgMargin };
  }, [computed]);

  async function updatePrice(miId, next) {
    const id = Number(miId);
    const price = Math.max(0, Math.round(toNum(next)));

    setSavingId(id);
    setErr("");
    setOk("");

    try {
      await apiPut(`/api/admin/donas/menu-items/${id}`, { sell_price: price, price });
      setMenuItems((prev) => prev.map((x) => (x.id === id ? { ...x, sell_price: price, price } : x)));
      setOk("Цена сохранена");
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to update price");
    } finally {
      setSavingId(null);
    }
  }

  async function applyPctToOne(mi) {
    const p = clamp(toNum(pctAdjust), -90, 300);
    const current = getSellPrice(mi);
    const next = Math.round(current * (1 + p / 100));
    await updatePrice(mi.id, next);
  }

  async function applyPctToFiltered() {
    const p = clamp(toNum(pctAdjust), -90, 300);
    if (!computed.length) return;

    setBulkSaving(true);
    setErr("");
    setOk("");

    try {
      // массово: только по отфильтрованным
      const updates = computed.map((mi) => {
        const current = getSellPrice(mi);
        const next = Math.round(current * (1 + p / 100));
        return { id: mi.id, next };
      });

      // делаем параллельно, но аккуратно
      await Promise.all(
        updates.map((u) =>
          apiPut(`/api/admin/donas/menu-items/${u.id}`, { sell_price: u.next, price: u.next })
        )
      );

      setMenuItems((prev) =>
        prev.map((x) => {
          const found = updates.find((u) => u.id === x.id);
          if (!found) return x;
          return { ...x, sell_price: found.next, price: found.next };
        })
      );

      setOk("Готово: цены обновлены по фильтру");
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to apply bulk change");
    } finally {
      setBulkSaving(false);
    }
  }

  function openRecipeModal(miId) {
    const id = Number(miId);
    const rec = recipesByItem[String(id)] || [];
    setRecipeItemId(id);
    // клонируем
    setRecipeRows(rec.map((r) => ({ ...r })));
    setCopyFromId("");
    setRecipeOpen(true);
    setErr("");
    setOk("");
  }

  function closeRecipeModal() {
    setRecipeOpen(false);
    setRecipeItemId(null);
    setRecipeRows([]);
    setCopyFromId("");
  }

  function addRecipeRow() {
    setRecipeRows((rows) => [
      ...rows,
      { id: null, ingredient_id: "", qty: "", unit: "g" },
    ]);
  }

  function updateRecipeRow(idx, patch) {
    setRecipeRows((rows) => {
      const next = [...rows];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  function removeRecipeRow(idx) {
    setRecipeRows((rows) => rows.filter((_, i) => i !== idx));
  }

  function onSelectIngredient(idx, ingredientId) {
    const ing = ingredientsById.get(Number(ingredientId));
    updateRecipeRow(idx, {
      ingredient_id: ingredientId,
      unit: ing?.unit || "g",
    });
  }

  async function saveRecipe() {
    if (!recipeItemId) return;
    if (recipeSaving) return;

    setRecipeSaving(true);
    setErr("");
    setOk("");

    try {
      const cleaned = recipeRows
        .map((row) => ({
          ingredient_id: row.ingredient_id === "" ? null : Number(row.ingredient_id),
          qty: row.qty === "" ? 0 : toNum(row.qty),
          unit: String(row.unit || "").trim() || "g",
        }))
        .filter((r) => Number.isFinite(r.ingredient_id) && r.ingredient_id > 0);

      const r = await apiPut(`/api/admin/donas/menu-items/${recipeItemId}/recipe`, { recipe: cleaned });
      const nextRecipe = Array.isArray(r?.recipe) ? r.recipe : [];

      setRecipesByItem((prev) => ({ ...prev, [String(recipeItemId)]: nextRecipe }));

      // meta refresh for this item
      let missingCount = 0;
      let unitMismatchCount = 0;

      for (const row of nextRecipe) {
        const ingRow = ingredients.find((x) => Number(x.id) === Number(row.ingredient_id));
        if (!ingRow) {
          missingCount += 1;
          continue;
        }
        const ingUnit = String(ingRow.unit || "").trim();
        const rUnit = String(row.unit || "").trim();
        if (ingUnit && rUnit && ingUnit !== rUnit) unitMismatchCount += 1;
      }

      setRecipeMetaByItem((prev) => ({
        ...prev,
        [String(recipeItemId)]: { missingCount, unitMismatchCount },
      }));

      setOk("Рецепт сохранён");
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Failed to save recipe");
    } finally {
      setRecipeSaving(false);
    }
  }

  function copyRecipeFrom() {
    if (!copyFromId || !recipeItemId) return;
    const src = recipesByItem[String(copyFromId)] || [];
    setRecipeRows(src.map((r) => ({ ...r, id: null }))); // id null, чтобы было понятно что новые
  }

  const recipeItem = useMemo(() => {
    if (!recipeItemId) return null;
    return menuItems.find((x) => x.id === recipeItemId) || null;
  }, [menuItems, recipeItemId]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Dona’s Dosas — Menu Builder</h1>
          <p className="text-sm text-gray-600 mt-1">
            Цены + себестоимость (COGS) по рецепту + маржа/прибыль
          </p>
        </div>

        <button
          onClick={loadAll}
          disabled={loading}
          className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 text-sm disabled:opacity-60"
        >
          Обновить
        </button>
      </div>

      {(err || ok) && (
        <div className="space-y-2">
          {err && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
              {err}
            </div>
          )}
          {ok && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">
              {ok}
            </div>
          )}
        </div>
      )}

      {/* Top controls + stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl shadow p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-gray-500 mb-1">Поиск по названию</div>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="w-full border rounded-xl px-3 py-2 text-sm"
                placeholder="Напр. dosa / paneer / masala..."
              />
            </div>

            <div>
              <div className="text-xs text-gray-500 mb-1">Сортировка</div>
              <div className="flex gap-2">
                <select
                  className="border rounded-xl px-3 py-2 text-sm w-full"
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value)}
                >
                  <option value="name">Название</option>
                  <option value="price">Цена</option>
                  <option value="cogs">COGS</option>
                  <option value="profit">Прибыль</option>
                  <option value="margin">Маржа %</option>
                </select>

                <select
                  className="border rounded-xl px-3 py-2 text-sm"
                  value={sortDir}
                  onChange={(e) => setSortDir(e.target.value)}
                >
                  <option value="asc">↑</option>
                  <option value="desc">↓</option>
                </select>
              </div>
            </div>
          </div>

          <div className="border-t pt-3">
            <div className="text-xs text-gray-500 mb-1">Быстро изменить цену на %</div>
            <div className="flex gap-2 items-center">
              <input
                value={pctAdjust}
                onChange={(e) => setPctAdjust(e.target.value)}
                className="border rounded-xl px-3 py-2 text-sm w-28 text-right"
                placeholder="10"
              />
              <div className="text-sm text-gray-600">
                напр. <b>10</b> = +10%, <b>-5</b> = -5%
              </div>

              <div className="flex-1" />

              <button
                onClick={applyPctToFiltered}
                disabled={bulkSaving || loading || computed.length === 0}
                className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 text-sm disabled:opacity-60"
              >
                Применить к фильтру
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow p-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl border p-3">
            <div className="text-xs text-gray-500">Позиций</div>
            <div className="text-xl font-semibold">{loading ? "…" : totals.n}</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-gray-500">Сумма цен</div>
            <div className="text-xl font-semibold">{loading ? "…" : fmtMoney(totals.sumPrice)}</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-gray-500">Сумма COGS</div>
            <div className="text-xl font-semibold">{loading ? "…" : fmtMoney(totals.sumCogs)}</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-gray-500">Средняя маржа</div>
            <div className="text-xl font-semibold">
              {loading || !Number.isFinite(totals.avgMargin) ? "—" : `${totals.avgMargin.toFixed(1)}%`}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow p-4 space-y-2">
          <div className="text-sm font-semibold">Подсказки</div>
          <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
            <li>Если у блюда <b>нет рецепта</b>, COGS/маржа показываются как <b>—</b>.</li>
            <li>COGS считается из ингредиентов: <b>pack_price / pack_size × qty</b>.</li>
            <li>Маржа подсвечивается: 🔴 &lt;40% | 🟡 40–60% | 🟢 &gt;60%</li>
          </ul>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="font-semibold">Блюда</div>
          <div className="text-sm text-gray-600">{loading ? "Загрузка..." : `Показано: ${computed.length}`}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="text-left px-4 py-2">Блюдо</th>
                <th className="text-right px-4 py-2">Цена</th>
                <th className="text-right px-4 py-2">COGS</th>
                <th className="text-right px-4 py-2">Прибыль</th>
                <th className="text-center px-4 py-2">Маржа</th>
                <th className="text-center px-4 py-2">Рецепт</th>
                <th className="text-right px-4 py-2">Действия</th>
              </tr>
            </thead>

            <tbody>
              {!loading && computed.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-gray-500">
                    Ничего не найдено.
                  </td>
                </tr>
              )}

              {computed.map((mi) => {
                const price = mi._price;
                const cogs = mi._cogs;
                const profit = mi._profit;
                const margin = mi._margin;

                const badge = marginBadge(margin);
                const meta = recipeMetaByItem[String(mi.id)] || { missingCount: 0, unitMismatchCount: 0 };

                return (
                  <tr key={mi.id} className="border-t">
                    <td className="px-4 py-3">
                      <div className="font-medium">{mi.name}</div>
                      <div className="text-xs text-gray-500">#{mi.id}</div>

                      {(mi._recipeCount === 0) && (
                        <div className="mt-1 inline-flex items-center gap-2 text-xs">
                          <span className="px-2 py-0.5 rounded-full bg-gray-100 border border-gray-200 text-gray-700">
                            Нет рецепта
                          </span>
                        </div>
                      )}

                      {(meta.missingCount > 0) && (
                        <div className="mt-1 inline-flex items-center gap-2 text-xs">
                          <span className="px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-700">
                            Не найдено ингредиентов: {meta.missingCount}
                          </span>
                        </div>
                      )}

                      {(meta.unitMismatchCount > 0) && (
                        <div className="mt-1 inline-flex items-center gap-2 text-xs">
                          <span className="px-2 py-0.5 rounded-full bg-yellow-50 border border-yellow-200 text-yellow-800">
                            Unit mismatch: {meta.unitMismatchCount}
                          </span>
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 text-right">
                      <div className="font-medium">{fmtMoney(price)}</div>
                      <div className="mt-2 flex justify-end">
                        <input
                          className="border rounded-xl px-2 py-1 w-28 text-right"
                          defaultValue={price}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              updatePrice(mi.id, e.currentTarget.value);
                            }
                          }}
                        />
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Enter = сохранить
                      </div>
                    </td>

                    <td className="px-4 py-3 text-right">
                      {cogs === null ? "—" : fmtMoney(cogs)}
                    </td>

                    <td className="px-4 py-3 text-right">
                      {profit === null ? "—" : fmtMoney(profit)}
                    </td>

                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-2 py-1 rounded-full border text-xs ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-center">
                      <button
                        className="px-3 py-1.5 rounded-xl border hover:bg-gray-50"
                        onClick={() => openRecipeModal(mi.id)}
                      >
                        Рецепт ({mi._recipeCount})
                      </button>
                    </td>

                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex gap-2 justify-end">
                        <button
                          onClick={() => applyPctToOne(mi)}
                          disabled={savingId === mi.id || bulkSaving}
                          className="px-3 py-1.5 rounded-xl border hover:bg-gray-50 disabled:opacity-60"
                        >
                          {savingId === mi.id ? "..." : "Применить %"}
                        </button>

                        <button
                          onClick={() => updatePrice(mi.id, getSellPrice(mi))}
                          disabled={savingId === mi.id || bulkSaving}
                          className="px-3 py-1.5 rounded-xl border hover:bg-gray-50 disabled:opacity-60"
                          title="Сохранить текущую цену ещё раз (иногда удобно после ручного ввода)"
                        >
                          Цена
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
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-3">
          <div className="w-full max-w-5xl bg-white rounded-2xl shadow-lg overflow-hidden">
            <div className="px-4 py-3 border-b flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold">Рецепт</div>
                <div className="text-xs text-gray-600">
                  {recipeItem ? (
                    <>
                      <span className="font-medium">{recipeItem.name}</span> <span className="text-gray-400">#{recipeItem.id}</span>
                    </>
                  ) : "—"}
                </div>
              </div>

              <button
                onClick={closeRecipeModal}
                className="px-3 py-1.5 rounded-xl border hover:bg-gray-50"
              >
                Закрыть
              </button>
            </div>

            <div className="p-4 space-y-3">
              {/* Copy from */}
              <div className="flex flex-wrap gap-2 items-center">
                <div className="text-sm text-gray-700">Скопировать рецепт из:</div>
                <select
                  className="border rounded-xl px-3 py-2 text-sm"
                  value={copyFromId}
                  onChange={(e) => setCopyFromId(e.target.value)}
                >
                  <option value="">— выбрать блюдо —</option>
                  {menuItems
                    .filter((x) => x.id !== recipeItemId)
                    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        #{x.id} — {x.name}
                      </option>
                    ))}
                </select>

                <button
                  onClick={copyRecipeFrom}
                  disabled={!copyFromId}
                  className="px-3 py-2 rounded-xl border hover:bg-gray-50 disabled:opacity-60"
                >
                  Скопировать
                </button>

                <div className="flex-1" />

                <button
                  onClick={addRecipeRow}
                  className="px-3 py-2 rounded-xl border hover:bg-gray-50"
                >
                  + Добавить строку
                </button>

                <button
                  onClick={saveRecipe}
                  disabled={recipeSaving}
                  className="px-4 py-2 rounded-xl bg-black text-white hover:opacity-90 disabled:opacity-60"
                >
                  {recipeSaving ? "Сохранение..." : "Сохранить рецепт"}
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-700">
                    <tr>
                      <th className="text-left px-3 py-2">Ингредиент</th>
                      <th className="text-right px-3 py-2">Qty</th>
                      <th className="text-left px-3 py-2">Unit</th>
                      <th className="text-right px-3 py-2">Удалить</th>
                    </tr>
                  </thead>

                  <tbody>
                    {recipeRows.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-gray-500">
                          Рецепт пустой — добавь строки или скопируй из другого блюда.
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
                            <option value="">— выбрать ингредиент —</option>
                            {ingredients
                              .slice()
                              .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
                              .map((ing) => (
                                <option key={ing.id} value={ing.id}>
                                  #{ing.id} — {ing.name} (unit: {ing.unit || "g"}, pack: {ing.pack_size || "?"}, price: {fmtMoney(ing.pack_price || 0)})
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
                            onClick={() => removeRecipeRow(idx)}
                            className="px-3 py-1.5 rounded-xl border border-red-200 text-red-700 hover:bg-red-50"
                          >
                            Удалить
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="text-xs text-gray-500">
                COGS считается по формуле: <b>(pack_price / pack_size) × qty</b>.
                Следи, чтобы qty был в той же единице, что и ингредиент.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
