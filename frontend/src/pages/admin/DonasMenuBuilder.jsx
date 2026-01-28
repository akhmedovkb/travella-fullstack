// frontend/src/pages/admin/DonasMenuBuilder.jsx

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPut } from "../../api";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function money(n) {
  return Math.round(toNum(n)).toLocaleString("ru-RU");
}
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function calcPpu(ing) {
  const packSize = toNum(ing?.pack_size);
  const packPrice = toNum(ing?.pack_price);
  if (!packSize) return 0;
  return packPrice / packSize;
}

function getSellPrice(mi) {
  // поддержим разные поля на всякий случай
  const p =
    mi?.sell_price ??
    mi?.price ??
    mi?.sale_price ??
    mi?.menu_price ??
    0;
  return toNum(p);
}

function marginColor(m) {
  // m в % (0..100)
  if (!Number.isFinite(m)) return "bg-white/10 text-white/70 border-white/10";
  if (m < 40) return "bg-red-500/15 text-red-100 border-red-500/20";
  if (m < 55) return "bg-yellow-500/15 text-yellow-100 border-yellow-500/20";
  return "bg-emerald-500/15 text-emerald-100 border-emerald-500/20";
}

export default function DonasMenuBuilder() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const [menuItems, setMenuItems] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [recipesByItem, setRecipesByItem] = useState({}); // { [id]: recipe[] }

  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("margin"); // margin | profit | price | cogs | name
  const [sortDir, setSortDir] = useState("desc"); // asc|desc

  // quick % adjust
  const [pctAdjust, setPctAdjust] = useState("10"); // default +10%
  const [savingId, setSavingId] = useState(null);

  async function loadAll() {
    setLoading(true);
    setErr("");
    setOkMsg("");
    try {
      const m = await apiGet("/api/admin/donas/menu-items");
      const items = m?.items || [];
      setMenuItems(items);

      // ingredients
      let ingRes;
      try {
        ingRes = await apiGet("/api/admin/donas/ingredients?include_archived=1");
      } catch {
        ingRes = await apiGet("/api/admin/donas/ingredients?includeArchived=true");
      }
      const ings = ingRes?.items || [];
      setIngredients(ings);

      // recipes for all items (parallel)
      const pairs = await Promise.all(
        items.map(async (it) => {
          try {
            const r = await apiGet(`/api/admin/donas/menu-items/${it.id}/recipe`);
            return [String(it.id), r?.recipe || []];
          } catch {
            return [String(it.id), []];
          }
        })
      );
      const map = {};
      for (const [id, rec] of pairs) map[id] = rec;
      setRecipesByItem(map);
    } catch (e) {
      setErr(e?.response?.data?.error || e?.message || "Failed to load menu builder");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ingredientsById = useMemo(() => {
    const m = new Map();
    ingredients.forEach((x) => m.set(x.id, x));
    return m;
  }, [ingredients]);

  const computed = useMemo(() => {
    const list = (menuItems || []).map((mi) => {
      const recipe = recipesByItem[String(mi.id)] || [];

      const cogs = recipe.reduce((sum, r) => {
        const ing = ingredientsById.get(r.ingredient_id);
        const ppu = calcPpu(ing);
        return sum + ppu * toNum(r.qty);
      }, 0);

      const price = getSellPrice(mi);
      const profit = price - cogs;
      const margin = price > 0 ? (profit / price) * 100 : NaN;

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
      else if (sortKey === "cogs") { va = a._cogs; vb = b._cogs; }
      else if (sortKey === "profit") { va = a._profit; vb = b._profit; }
      else { va = a._margin; vb = b._margin; } // margin

      // NaN to bottom
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
    const sumCogs = computed.reduce((s, x) => s + toNum(x._cogs), 0);
    const sumProfit = computed.reduce((s, x) => s + toNum(x._profit), 0);
    const avgMargin = sumPrice > 0 ? (sumProfit / sumPrice) * 100 : NaN;
    return { n, sumPrice, sumCogs, sumProfit, avgMargin };
  }, [computed]);

  async function applyPct(mi) {
    const p = clamp(toNum(pctAdjust), -90, 300); // защита от дурных значений
    const current = getSellPrice(mi);
    const next = Math.round(current * (1 + p / 100));

    setSavingId(mi.id);
    setErr("");
    setOkMsg("");

    try {
      await apiPut(`/api/admin/donas/menu-items/${mi.id}`, {
        sell_price: next,
        price: next,
      });

      setMenuItems((prev) =>
        prev.map((x) =>
          x.id === mi.id ? { ...x, sell_price: next, price: next } : x
        )
      );

      setOkMsg(`Обновлено: ${mi.name} → ${money(next)}`);
    } catch (e) {
      setErr(e?.response?.data?.error || e?.message || "Failed to update price");
    } finally {
      setSavingId(null);
    }
  }

  async function setExactPrice(mi, value) {
    const next = Math.max(0, Math.round(toNum(value)));
    setSavingId(mi.id);
    setErr("");
    setOkMsg("");
    try {
      await apiPut(`/api/admin/donas/menu-items/${mi.id}`, {
        sell_price: next,
        price: next,
      });
      setMenuItems((prev) =>
        prev.map((x) =>
          x.id === mi.id ? { ...x, sell_price: next, price: next } : x
        )
      );
      setOkMsg(`Цена сохранена: ${mi.name}`);
    } catch (e) {
      setErr(e?.response?.data?.error || e?.message || "Failed to save price");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Dona’s Dosas — Menu Builder</h1>
          <p className="text-sm text-white/60 mt-1">
            Управление ценами + маржа по каждому блюду
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadAll}
            disabled={loading}
            className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-sm"
          >
            Обновить
          </button>
        </div>
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

      {/* controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-3">
          <div>
            <div className="text-xs text-white/60 mb-2">Поиск по названию</div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-white/25"
              placeholder="Напр. dosa / paneer / masala…"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-xs text-white/60 mb-2">Сортировка</div>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none"
              >
                <option value="margin">Маржа %</option>
                <option value="profit">Прибыль</option>
                <option value="price">Цена</option>
                <option value="cogs">COGS</option>
                <option value="name">Название</option>
              </select>
            </div>

            <div>
              <div className="text-xs text-white/60 mb-2">Направление</div>
              <select
                value={sortDir}
                onChange={(e) => setSortDir(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none"
              >
                <option value="desc">По убыванию</option>
                <option value="asc">По возрастанию</option>
              </select>
            </div>
          </div>

          <div>
            <div className="text-xs text-white/60 mb-2">
              Быстро изменить цену на %
            </div>
            <div className="flex items-center gap-2">
              <input
                value={pctAdjust}
                onChange={(e) => setPctAdjust(e.target.value)}
                className="w-28 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none"
                inputMode="decimal"
              />
              <div className="text-xs text-white/50">
                напр. <span className="text-white/70">10</span> = +10%
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 rounded-2xl bg-white/5 border border-white/10 p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl bg-white/5 border border-white/10 p-3">
              <div className="text-xs text-white/60">Позиции</div>
              <div className="text-xl font-semibold mt-1">{totals.n}</div>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/10 p-3">
              <div className="text-xs text-white/60">Сумма цен</div>
              <div className="text-xl font-semibold mt-1">{money(totals.sumPrice)}</div>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/10 p-3">
              <div className="text-xs text-white/60">Сумма COGS</div>
              <div className="text-xl font-semibold mt-1">{money(totals.sumCogs)}</div>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/10 p-3">
              <div className="text-xs text-white/60">Средняя маржа</div>
              <div className="text-xl font-semibold mt-1">
                {Number.isFinite(totals.avgMargin) ? `${totals.avgMargin.toFixed(1)}%` : "—"}
              </div>
            </div>
          </div>

          <div className="text-xs text-white/50 mt-3">
            * Это “средняя маржа меню” по формуле: (Σprofit / Σprice) × 100
          </div>
        </div>
      </div>

      {/* table */}
      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="min-w-full text-sm">
          <thead className="text-white/60 border-b border-white/10">
            <tr>
              <th className="text-left font-medium px-4 py-3">Блюдо</th>
              <th className="text-right font-medium px-4 py-3">Цена</th>
              <th className="text-right font-medium px-4 py-3">COGS</th>
              <th className="text-right font-medium px-4 py-3">Прибыль</th>
              <th className="text-right font-medium px-4 py-3">Маржа</th>
              <th className="text-right font-medium px-4 py-3">Рецепт</th>
              <th className="text-right font-medium px-4 py-3">Действия</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-white/10">
            {computed.map((mi) => (
              <Row
                key={mi.id}
                mi={mi}
                saving={savingId === mi.id}
                onApplyPct={() => applyPct(mi)}
                onSaveExact={(v) => setExactPrice(mi, v)}
              />
            ))}

            {!computed.length && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-white/50">
                  Ничего не найдено
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {loading && (
        <div className="text-sm text-white/50">Загрузка…</div>
      )}
    </div>
  );
}

function Row({ mi, saving, onApplyPct, onSaveExact }) {
  const [edit, setEdit] = useState(false);
  const [value, setValue] = useState(String(mi._price ?? ""));

  useEffect(() => {
    setValue(String(mi._price ?? ""));
  }, [mi._price]);

  const marginCls = marginColor(mi._margin);

  return (
    <tr>
      <td className="px-4 py-3">
        <div className="font-medium text-white">{mi.name}</div>
        <div className="text-xs text-white/40">#{mi.id}</div>
      </td>

      <td className="px-4 py-3 text-right">
        {edit ? (
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-28 text-right bg-white/5 border border-white/10 rounded-xl px-2 py-1 text-sm outline-none focus:border-white/25"
            inputMode="decimal"
          />
        ) : (
          <span className="text-white">{money(mi._price)}</span>
        )}
      </td>

      <td className="px-4 py-3 text-right text-white/80">{money(mi._cogs)}</td>
      <td className="px-4 py-3 text-right text-white/80">{money(mi._profit)}</td>

      <td className="px-4 py-3 text-right">
        <span className={`inline-flex items-center px-2 py-1 rounded-lg border text-xs ${marginCls}`}>
          {Number.isFinite(mi._margin) ? `${mi._margin.toFixed(1)}%` : "—"}
        </span>
      </td>

      <td className="px-4 py-3 text-right text-white/60">
        {mi._recipeCount || 0}
      </td>

      <td className="px-4 py-3 text-right">
        <div className="inline-flex items-center gap-2">
          <button
            onClick={onApplyPct}
            disabled={saving}
            className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs"
          >
            {saving ? "…" : "Применить %"}
          </button>

          {!edit ? (
            <button
              onClick={() => setEdit(true)}
              className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs"
            >
              Цена
            </button>
          ) : (
            <>
              <button
                onClick={async () => {
                  await onSaveExact(value);
                  setEdit(false);
                }}
                disabled={saving}
                className="px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/25 border border-emerald-500/25 text-emerald-100 text-xs"
              >
                Сохранить
              </button>
              <button
                onClick={() => {
                  setValue(String(mi._price ?? ""));
                  setEdit(false);
                }}
                className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs"
              >
                Отмена
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
