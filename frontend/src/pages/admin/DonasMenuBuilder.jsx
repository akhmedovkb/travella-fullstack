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
  return toNum(mi?.sell_price ?? mi?.price ?? 0);
}
function calcPpu(ing) {
  const packSize = toNum(ing?.pack_size);
  const packPrice = toNum(ing?.pack_price);
  if (!packSize) return 0;
  return packPrice / packSize;
}
function marginBadge(m) {
  if (!Number.isFinite(m)) return { cls: "bg-gray-100 text-gray-700", label: "—" };
  if (m < 40) return { cls: "bg-red-50 text-red-700", label: `${m.toFixed(1)}%` };
  if (m < 60) return { cls: "bg-yellow-50 text-yellow-800", label: `${m.toFixed(1)}%` };
  return { cls: "bg-emerald-50 text-emerald-700", label: `${m.toFixed(1)}%` };
}

export default function DonasMenuBuilder() {
  const [menuItems, setMenuItems] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [recipesByItem, setRecipesByItem] = useState({});
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState("");
  const [pctAdjust, setPctAdjust] = useState("10");
  const [savingId, setSavingId] = useState(null);

  const ingredientsById = useMemo(() => {
    const m = new Map();
    ingredients.forEach((i) => m.set(Number(i.id), i));
    return m;
  }, [ingredients]);

  async function loadAll() {
    setLoading(true);
    try {
      const m = await apiGet("/api/admin/donas/menu-items?includeArchived=1");
      const i = await apiGet("/api/admin/donas/ingredients?includeArchived=1");
      setMenuItems(m?.items || []);
      setIngredients(i?.items || []);

      const recPairs = await Promise.all(
        (m?.items || []).map(async (it) => {
          try {
            const r = await apiGet(`/api/admin/donas/menu-items/${it.id}/recipe`);
            return [it.id, r?.recipe || []];
          } catch {
            return [it.id, []];
          }
        })
      );
      const map = {};
      recPairs.forEach(([id, r]) => (map[id] = r));
      setRecipesByItem(map);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const computed = useMemo(() => {
    return menuItems
      .filter((x) => x.name.toLowerCase().includes(q.toLowerCase()))
      .map((mi) => {
        const recipe = recipesByItem[mi.id] || [];
        let cogs = 0;
        let valid = false;

        recipe.forEach((r) => {
          const ing = ingredientsById.get(Number(r.ingredient_id));
          if (!ing) return;
          const ppu = calcPpu(ing);
          const qty = toNum(r.qty);
          if (!ppu || !qty) return;
          valid = true;
          cogs += ppu * qty;
        });

        const price = getSellPrice(mi);
        const finalCogs = recipe.length && valid ? cogs : null;
        const profit = finalCogs === null ? null : price - finalCogs;
        const margin = finalCogs === null || price <= 0 ? NaN : (profit / price) * 100;

        return { ...mi, _price: price, _cogs: finalCogs, _profit: profit, _margin: margin };
      });
  }, [menuItems, recipesByItem, ingredientsById, q]);

  async function updatePrice(id, next) {
    const price = Math.round(toNum(next));
    setSavingId(id);
    try {
      await apiPut(`/api/admin/donas/menu-items/${id}`, { price, sell_price: price });
      setMenuItems((p) => p.map((x) => (x.id === id ? { ...x, price, sell_price: price } : x)));
    } finally {
      setSavingId(null);
    }
  }

  function applyPct(mi) {
    const p = clamp(toNum(pctAdjust), -90, 300);
    const next = Math.round(getSellPrice(mi) * (1 + p / 100));
    updatePrice(mi.id, next);
  }

  const menuBase = import.meta.env.VITE_API_BASE_URL.replace(/\/$/, "");

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
      {/* HEADER */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dona’s Dosas — Menu Builder</h1>
          <p className="text-sm text-gray-600">Цена • COGS • Маржа</p>
        </div>

        <div className="flex gap-2">
        <a
          href={`${menuBase}/menu/donas-dosas`}
          target="_blank"
          className="px-3 py-2 rounded-xl border hover:bg-gray-50 text-sm"
        >
          Меню (HTML)
        </a>
        
        <a
          href={`${menuBase}/menu/donas-dosas.pdf`}
          target="_blank"
          className="px-3 py-2 rounded-xl border hover:bg-gray-50 text-sm"
        >
          PDF
        </a>
        
        <a
          href={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(
            `${menuBase}/menu/donas-dosas`
          )}`}
          target="_blank"
          className="px-3 py-2 rounded-xl border hover:bg-gray-50 text-sm"
        >
          QR
        </a>

          <button
            onClick={loadAll}
            disabled={loading}
            className="px-3 py-2 rounded-xl border hover:bg-gray-50 text-sm"
          >
            Обновить
          </button>
        </div>
      </div>

      {/* CONTROLS */}
      <div className="bg-white rounded-2xl shadow p-4 flex gap-4 items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="border rounded-xl px-3 py-2 text-sm flex-1"
          placeholder="Поиск по названию…"
        />

        <input
          value={pctAdjust}
          onChange={(e) => setPctAdjust(e.target.value)}
          className="border rounded-xl px-3 py-2 text-sm w-24 text-right"
        />

        <span className="text-sm text-gray-600">% → Enter по строке</span>
      </div>

      {/* TABLE */}
      <div className="bg-white rounded-2xl shadow overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-2">Блюдо</th>
              <th className="text-right px-4 py-2">Цена</th>
              <th className="text-right px-4 py-2">COGS</th>
              <th className="text-right px-4 py-2">Прибыль</th>
              <th className="text-center px-4 py-2">Маржа</th>
              <th className="text-right px-4 py-2">Действия</th>
            </tr>
          </thead>
          <tbody>
            {computed.map((mi) => {
              const badge = marginBadge(mi._margin);
              return (
                <tr key={mi.id} className="border-t">
                  <td className="px-4 py-3 font-medium">{mi.name}</td>
                  <td className="px-4 py-3 text-right">
                    <input
                      className="border rounded-xl px-2 py-1 w-28 text-right"
                      defaultValue={mi._price}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") updatePrice(mi.id, e.currentTarget.value);
                      }}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {mi._cogs === null ? "—" : fmtMoney(mi._cogs)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {mi._profit === null ? "—" : fmtMoney(mi._profit)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-1 rounded-full text-xs ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => applyPct(mi)}
                      disabled={savingId === mi.id}
                      className="px-3 py-1.5 rounded-xl border hover:bg-gray-50 text-sm"
                    >
                      Применить %
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
