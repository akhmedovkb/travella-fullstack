// frontend/src/pages/admin/DonasProfit.jsx

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut } from "../../api";

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

function fmtQty(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return String(x ?? "");
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

function calcPpu(ing) {
  const packSize = toNum(ing?.pack_size);
  const packPrice = toNum(ing?.pack_price);
  if (!packSize) return 0;
  return packPrice / packSize;
}

function SparklinePct({ values }) {
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
    .reverse() // слева “старое”, справа “новое”
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
      <svg width={w} height={h} className="block" role="img" aria-label="Margin history">
        <polyline points={pts} fill="none" stroke="black" strokeWidth="2" />
      </svg>
      <div className="text-xs text-gray-600 flex items-center justify-between">
        <span>
          Последний: <b>{pct(last)}</b>
        </span>
        <span>
          Δ: <b>{pct(delta)}</b>
        </span>
      </div>
    </div>
  );
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

  // COGS snapshots (history)
  const [cogsHistory, setCogsHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

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
          i = await apiGet("/api/admin/donas/ingredients?includeArchived=1");
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
    ingredients.forEach((x) => m.set(Number(x.id), x));
    return m;
  }, [ingredients]);

  const selectedItem = useMemo(() => {
    const id = Number(menuItemId);
    return menuItems.find((x) => Number(x.id) === id) || null;
  }, [menuItems, menuItemId]);

  useEffect(() => {
    if (!menuItemId) {
      setRecipe([]);
      setSellPrice("");
      setCogsHistory([]);
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

        setHistoryLoading(true);
        try {
          const h = await apiGet(`/api/admin/donas/cogs?menu_item_id=${menuItemId}&limit=30`);
          setCogsHistory(Array.isArray(h?.items) ? h.items : []);
        } finally {
          setHistoryLoading(false);
        }

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
      const ing = ingredientsById.get(Number(r.ingredient_id));
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

  const marginHistoryValues = useMemo(() => {
    const vals = (cogsHistory || [])
      .map((h) => {
        const m = Number(h?.margin);
        if (Number.isFinite(m)) return m;
        const sp = toNum(h?.sell_price);
        const tc = toNum(h?.total_cost);
        if (sp > 0) return ((sp - tc) / sp) * 100;
        return NaN;
      })
      .filter((v) => Number.isFinite(v));
    return vals;
  }, [cogsHistory]);

  async function savePrice() {
    if (!menuItemId) return;

    try {
      setLoading(true);
      setErr("");
      setOkMsg("");

      const payload = { sell_price: toNum(sellPrice), price: toNum(sellPrice) };
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

  async function saveCogsSnapshot() {
    if (!menuItemId) return;
    try {
      setLoading(true);
      setErr("");
      setOkMsg("");

      await apiPost("/api/admin/donas/cogs", {
        menu_item_id: menuItemId,
        total_cost: cogs,
        sell_price: price,
        margin: Number.isFinite(margin) ? margin : null,
        breakdown: rows.map((r) => ({
          ingredient_id: r.ingredient_id,
          qty: toNum(r.qty),
          unit: r.unit,
          cost: toNum(r.cost),
        })),
      });

      setOkMsg("COGS сохранён");

      const h = await apiGet(`/api/admin/donas/cogs?menu_item_id=${menuItemId}&limit=30`);
      setCogsHistory(Array.isArray(h?.items) ? h.items : []);
    } catch (e) {
      setErr(e?.response?.data?.error || e?.message || "Failed to save COGS");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Dona’s Dosas — Profit / Margin</h1>
          <p className="text-sm text-gray-600">Цена продажи, себестоимость и маржа по рецепту</p>
        </div>
        <button
          type="button"
          className="px-4 py-2 rounded-lg border bg-white hover:bg-gray-50"
          onClick={() => window.location.reload()}
        >
          Обновить
        </button>
      </div>

      {(err || okMsg) && (
        <div className="space-y-2">
          {err && (
            <div className="p-3 rounded-xl bg-red-50 text-red-700 border border-red-200">{err}</div>
          )}
          {okMsg && (
            <div className="p-3 rounded-xl bg-green-50 text-green-700 border border-green-200">{okMsg}</div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="rounded-2xl bg-white border border-gray-200 p-4">
          <div className="text-sm font-medium mb-2">Блюдо</div>
          <select
            className="w-full border rounded-lg px-3 py-2"
            value={menuItemId}
            onChange={(e) => setMenuItemId(e.target.value)}
          >
            <option value="">Выбери блюдо</option>
            {menuItems.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>

          {menuItemId && <div className="text-xs text-gray-500 mt-2">ID: #{menuItemId}</div>}
        </div>

        <div className="lg:col-span-2 rounded-2xl bg-white border border-gray-200 p-4">
          <div className="text-sm font-semibold text-gray-900">{selectedItem?.name || "—"}</div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div className="rounded-xl bg-white border border-gray-200 p-3">
              <div className="text-xs text-gray-600">Цена продажи</div>
              <div className="flex items-center gap-2 mt-2">
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  value={sellPrice}
                  onChange={(e) => setSellPrice(e.target.value)}
                  placeholder="UZS"
                />
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700"
                  onClick={savePrice}
                  disabled={loading || !menuItemId}
                >
                  Сохранить
                </button>
              </div>
            </div>

            <div className="rounded-xl bg-white border border-gray-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-gray-600">COGS (себестоимость)</div>
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg bg-black text-white hover:bg-gray-900 disabled:opacity-50"
                  onClick={saveCogsSnapshot}
                  disabled={loading || !menuItemId}
                  title="Сохранит текущий расчёт COGS в историю"
                >
                  Сохранить COGS
                </button>
              </div>
              <div className="text-2xl font-semibold mt-2 text-gray-900">{money(cogs)}</div>
            </div>

            <div className="rounded-xl bg-white border border-gray-200 p-3">
              <div className="text-xs text-gray-600">Прибыль (Price - COGS)</div>
              <div className="text-2xl font-semibold mt-2 text-gray-900">{money(profit)}</div>
            </div>

            <div className="rounded-xl bg-white border border-gray-200 p-3">
              <div className="text-xs text-gray-600">Маржа</div>
              <div className="text-2xl font-semibold mt-2 text-gray-900">{pct(margin)}</div>
            </div>
          </div>

          <div className="mt-5 rounded-2xl bg-white border border-gray-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-gray-900">История (COGS / Маржа)</div>
              {historyLoading && <div className="text-xs text-gray-500">Загрузка…</div>}
            </div>

            {!menuItemId ? (
              <div className="text-sm text-gray-500 mt-2">Выберите блюдо.</div>
            ) : (cogsHistory || []).length === 0 ? (
              <div className="text-sm text-gray-500 mt-2">История: нет данных.</div>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="border rounded-xl p-3">
                  <div className="text-xs text-gray-600 mb-2">Маржа (sparkline)</div>
                  <SparklinePct values={marginHistoryValues} />
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-600">
                        <th className="py-2 pr-4">Дата</th>
                        <th className="py-2 pr-4 text-right">Цена</th>
                        <th className="py-2 pr-4 text-right">COGS</th>
                        <th className="py-2 pr-4 text-right">Маржа</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cogsHistory.slice(0, 10).map((h) => (
                        <tr key={h.id} className="border-t">
                          <td className="py-2 pr-4">
                            {h.created_at ? new Date(h.created_at).toLocaleString("ru-RU") : "—"}
                          </td>
                          <td className="py-2 pr-4 text-right">
                            {h.sell_price == null ? "—" : money(h.sell_price)}
                          </td>
                          <td className="py-2 pr-4 text-right">{money(h.total_cost)}</td>
                          <td
                            className="py-2 pr-4 text-right"
                            title={(() => {
                              const sp = toNum(h.sell_price);
                              const tc = toNum(h.total_cost);
                              if (!sp) return "";
                              const p = sp - tc;
                              const m = Number.isFinite(Number(h?.margin))
                                ? Number(h?.margin)
                                : ((sp - tc) / sp) * 100;
                              return `Прибыль: ${money(p)} | Маржа: ${pct(m)}`;
                            })()}
                          >
                            {(() => {
                              const m = Number(h?.margin);
                              if (Number.isFinite(m)) return pct(m);
                              const sp = toNum(h.sell_price);
                              const tc = toNum(h.total_cost);
                              if (sp > 0) return pct(((sp - tc) / sp) * 100);
                              return "—";
                            })()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div className="mt-5 rounded-2xl bg-white border border-gray-200 p-4">
            <div className="text-sm font-medium text-gray-900 mb-2">Разбор по ингредиентам</div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="py-2 pr-4">Ингредиент</th>
                    <th className="py-2 pr-4 text-right">Кол-во</th>
                    <th className="py-2 pr-4 text-right">Цена / ед</th>
                    <th className="py-2 pr-4 text-right">Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="py-2 pr-4">{r.name}</td>
                      <td className="py-2 pr-4 text-right">
                        {fmtQty(r.qty)} {r.unit}
                      </td>
                      <td className="py-2 pr-4 text-right">{money(r.ppu)}</td>
                      <td className="py-2 pr-4 text-right">{money(r.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="text-xs text-gray-500 mt-2">COGS считается из: (pack_price / pack_size) × qty</div>
          </div>
        </div>
      </div>
    </div>
  );
}
