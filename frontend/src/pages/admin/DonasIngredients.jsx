// frontend/src/pages/admin/DonasIngredients.jsx

import { useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../../api";
import { tSuccess, tError, tInfo, tWarn } from "../../shared/toast";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function fmt(n) {
  const v = Math.round(toNum(n));
  return v.toLocaleString("ru-RU");
}

// маленькая пауза, чтобы не долбить бэк слишком резко при bulk
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function DonasIngredients() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // Margin impact (after ingredient change)
  const [marginThreshold, setMarginThreshold] = useState(40);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactResult, setImpactResult] = useState(null); // { threshold, below:[...], mode?, checked? }

  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });

  const [includeArchived, setIncludeArchived] = useState(false);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    unit: "g",
    pack_size: "",
    pack_price: "",
    supplier: "",
    notes: "",
  });

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const q = includeArchived ? "?includeArchived=1" : "";
      const r = await apiGet(`/api/admin/donas/ingredients${q}`);
      setItems(Array.isArray(r?.items) ? r.items : []);
    } catch {
      tError("Не удалось загрузить ингредиенты");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeArchived]);

  function startEdit(id) {
    const it = items.find((x) => x.id === id);
    if (!it) return;
    setEditingId(id);
    setEditForm({
      name: it.name || "",
      unit: it.unit || "g",
      pack_size: it.pack_size ?? "",
      pack_price: it.pack_price ?? "",
      supplier: it.supplier || "",
      notes: it.notes || "",
      is_archived: !!it.is_archived,
      is_active: it.is_active !== false,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(null);
  }

  function warnIfPackSizeZero(packSize, name) {
    const ps = toNum(packSize);
    if (!ps || ps <= 0) {
      tWarn(`Pack size = 0 у "${name || "ингредиента"}" — COGS может считаться неверно`);
      return true;
    }
    return false;
  }

  async function createIngredient(e) {
    e.preventDefault();
    if (creating) return;

    const payload = {
      name: String(form.name || "").trim(),
      unit: String(form.unit || "").trim(),
      pack_size: form.pack_size === "" ? null : toNum(form.pack_size),
      pack_price: form.pack_price === "" ? null : toNum(form.pack_price),
      supplier: String(form.supplier || "").trim() || null,
      notes: String(form.notes || "").trim() || null,
      is_active: true,
    };

    if (!payload.name) {
      tError("Название обязательно");
      return;
    }

    // 🟡 авто-предупреждение при pack_size = 0
    warnIfPackSizeZero(payload.pack_size, payload.name);

    setCreating(true);
    try {
      await apiPost("/api/admin/donas/ingredients", payload);
      tSuccess("Ингредиент добавлен");
      setForm({
        name: "",
        unit: "g",
        pack_size: "",
        pack_price: "",
        supplier: "",
        notes: "",
      });
      await load();
    } catch {
      tError("Не удалось добавить ингредиент");
    } finally {
      setCreating(false);
    }
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!editingId || !editForm) return;

    const payload = {
      name: String(editForm.name || "").trim(),
      unit: String(editForm.unit || "").trim(),
      pack_size: editForm.pack_size === "" ? null : toNum(editForm.pack_size),
      pack_price: editForm.pack_price === "" ? null : toNum(editForm.pack_price),
      supplier: String(editForm.supplier || "").trim() || null,
      notes: String(editForm.notes || "").trim() || null,
      is_active: editForm.is_active !== false,
      is_archived: !!editForm.is_archived,
    };

    if (!payload.name) {
      tError("Название обязательно");
      return;
    }

    // 🟡 авто-предупреждение при pack_size = 0
    warnIfPackSizeZero(payload.pack_size, payload.name);

    try {
      await apiPut(`/api/admin/donas/ingredients/${editingId}`, payload);
      tSuccess(`Сохранено: ${payload.name}`);

      // ✅ проверяем влияние на маржу (но не ломаем сохранение, если отчёт упал)
      await checkMarginImpact(editingId);

      cancelEdit();
      await load();
    } catch {
      tError("Не удалось сохранить изменения");
    }
  }

  async function archive(id) {
    if (!id) return;
    try {
      await apiDelete(`/api/admin/donas/ingredients/${id}`);
      tSuccess("Перемещено в архив");
      if (editingId === id) cancelEdit();
      await load();
    } catch {
      tError("Не удалось архивировать");
    }
  }

  function normalizeBelow(list, ingredient) {
    const ingId = ingredient?.id ?? null;
    const ingName = ingredient?.name ?? "";
    return (Array.isArray(list) ? list : []).map((x) => ({
      ...x,
      ingredient_id: ingId,
      ingredient_name: ingName,
    }));
  }

  async function checkMarginImpact(ingredientId) {
    const ing = items.find((x) => x.id === ingredientId) || null;

    // 🔒 toast при старте
    tInfo("Маржа проверяется…");

    setImpactLoading(true);
    try {
      const r = await apiGet(
        `/api/admin/donas/ingredients/${ingredientId}/margin-impact?threshold=${marginThreshold}`
      );

      const below = normalizeBelow(r?.below, ing);
      setImpactResult({
        threshold: r?.threshold ?? marginThreshold,
        below,
        mode: "single",
        checked: ing ? [{ id: ing.id, name: ing.name }] : [],
      });
    } catch {
      setImpactResult(null);
      tWarn("COGS / маржа: отчёт не построился");
    } finally {
      setImpactLoading(false);
    }
  }

  async function recalcAll() {
    if (bulkRunning || impactLoading) return;

    const list = (items || []).filter((x) => !x?.is_archived);
    if (!list.length) {
      tInfo("Нет активных ингредиентов для пересчёта");
      return;
    }

    const ok = window.confirm(
      `Пересчитать маржу по всем активным ингредиентам (${list.length})?\nЭто может занять время.`
    );
    if (!ok) return;

    setBulkRunning(true);
    setImpactLoading(true);
    setBulkProgress({ done: 0, total: list.length });

    tInfo("Маржа проверяется…");

    try {
      let allBelow = [];
      for (let i = 0; i < list.length; i++) {
        const ing = list[i];
        try {
          const r = await apiGet(
            `/api/admin/donas/ingredients/${ing.id}/margin-impact?threshold=${marginThreshold}`
          );
          allBelow = allBelow.concat(normalizeBelow(r?.below, ing));
        } catch {
          // не валим весь bulk — просто продолжим
        }

        setBulkProgress({ done: i + 1, total: list.length });
        // небольшая пауза, чтобы не устроить DDOS
        await sleep(120);
      }

      // объединение дублей по блюду: если одно блюдо упало из-за разных ингредиентов,
      // показываем блюдо один раз, но с перечнем ингредиентов
      const byMenu = new Map();
      for (const row of allBelow) {
        const key = String(row.menu_item_id ?? "");
        if (!key) continue;

        const prev = byMenu.get(key);
        if (!prev) {
          byMenu.set(key, {
            ...row,
            ingredients: [
              { id: row.ingredient_id, name: row.ingredient_name || "" },
            ],
          });
        } else {
          const exists = (prev.ingredients || []).some((z) => z.id === row.ingredient_id);
          if (!exists) {
            prev.ingredients = (prev.ingredients || []).concat([
              { id: row.ingredient_id, name: row.ingredient_name || "" },
            ]);
          }
          // margin/cogs/price оставляем из первого ответа (они должны совпадать на блюдо)
          byMenu.set(key, prev);
        }
      }

      const merged = Array.from(byMenu.values()).sort((a, b) => {
        const am = toNum(a.margin);
        const bm = toNum(b.margin);
        return am - bm; // самые низкие сверху
      });

      setImpactResult({
        threshold: marginThreshold,
        below: merged,
        mode: "bulk",
        checked: list.map((x) => ({ id: x.id, name: x.name })),
      });

      if (!merged.length) tSuccess("✅ Ни одно блюдо не упало ниже порога.");
      else tWarn(`⚠️ Есть блюда ниже ${marginThreshold}% (см. отчёт)`);
    } finally {
      setImpactLoading(false);
      setBulkRunning(false);
    }
  }

  // ссылка в Recipe/COGS
  function cogsLink(menuItemId) {
    // если в DonasCogs есть поддержка query-параметра — отлично.
    // если нет — хотя бы откроется страница COGS, и ты быстро найдёшь #ID в списке.
    return `/admin/donas-dosas/cogs?menuItemId=${encodeURIComponent(menuItemId)}`;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dona’s Dosas — Ingredients</h1>
          <p className="text-sm text-gray-600">
            База ингредиентов (упаковка, цена, единица измерения) — используется в рецептах.
          </p>
        </div>

        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Показать архив
        </label>
      </div>

      {/* Create */}
      <div className="bg-white rounded-2xl shadow p-4">
        <h2 className="font-semibold mb-3">Добавить ингредиент</h2>

        <form onSubmit={createIngredient} className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <input
            className="border rounded-xl px-3 py-2 md:col-span-2"
            placeholder="Название (например: Rice flour)"
            value={form.name}
            onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
          />

          <select
            className="border rounded-xl px-3 py-2"
            value={form.unit}
            onChange={(e) => setForm((s) => ({ ...s, unit: e.target.value }))}
          >
            <option value="g">g</option>
            <option value="ml">ml</option>
            <option value="pcs">pcs</option>
          </select>

          <input
            className="border rounded-xl px-3 py-2"
            placeholder="Pack size"
            value={form.pack_size}
            onChange={(e) => setForm((s) => ({ ...s, pack_size: e.target.value }))}
          />

          <input
            className="border rounded-xl px-3 py-2"
            placeholder="Pack price (UZS)"
            value={form.pack_price}
            onChange={(e) => setForm((s) => ({ ...s, pack_price: e.target.value }))}
          />

          <button
            type="submit"
            disabled={creating}
            className="rounded-xl bg-black text-white px-4 py-2 hover:opacity-90 disabled:opacity-60"
          >
            Добавить
          </button>

          <input
            className="border rounded-xl px-3 py-2 md:col-span-2"
            placeholder="Поставщик (опционально)"
            value={form.supplier}
            onChange={(e) => setForm((s) => ({ ...s, supplier: e.target.value }))}
          />

          <input
            className="border rounded-xl px-3 py-2 md:col-span-4"
            placeholder="Заметки (опционально)"
            value={form.notes}
            onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
          />
        </form>
      </div>

      {/* Margin impact after ingredient change */}
      <div className="bg-white rounded-2xl shadow p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="font-semibold">Контроль маржи после изменения ингредиента</div>
            <button
              type="button"
              onClick={recalcAll}
              disabled={impactLoading || bulkRunning || loading || !items.length}
              className="px-3 py-1.5 rounded-xl border hover:bg-gray-50 disabled:opacity-60"
              title="Пересчитать отчёт по всем активным ингредиентам"
            >
              Пересчитать всё
            </button>

            {bulkRunning && (
              <div className="text-xs text-gray-600">
                {bulkProgress.done}/{bulkProgress.total}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-600">Порог, %</span>
            <input
              type="number"
              min="0"
              max="100"
              className="border rounded-xl px-2 py-1 w-20 text-right"
              value={marginThreshold}
              onChange={(e) => setMarginThreshold(Number(e.target.value || 0))}
            />
          </div>
        </div>

        {impactLoading ? (
          <div className="text-sm text-gray-600 mt-2">
            Проверяю влияние на маржу{bulkRunning ? `… (${bulkProgress.done}/${bulkProgress.total})` : "…"}
          </div>
        ) : impactResult?.below?.length ? (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3">
            <div className="font-semibold text-red-800">
              ⚠️ Маржа стала ниже {impactResult.threshold}% у {impactResult.below.length} блюд
            </div>

            <div className="text-sm text-red-900 mt-2 space-y-1">
              {impactResult.below.slice(0, 10).map((x) => (
                <div key={x.menu_item_id} className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <a
                      href={cogsLink(x.menu_item_id)}
                      className="underline hover:opacity-80"
                      title="Открыть в Recipe/COGS"
                    >
                      #{x.menu_item_id} — <b>{x.name}</b>
                    </a>

                    {/* 🧾 какие ингредиенты могли повлиять (bulk) */}
                    {Array.isArray(x.ingredients) && x.ingredients.length > 0 && (
                      <span className="text-xs bg-white/70 border px-2 py-0.5 rounded-full">
                        {x.ingredients
                          .slice(0, 3)
                          .map((z) => z?.name || `#${z?.id}`)
                          .filter(Boolean)
                          .join(", ")}
                        {x.ingredients.length > 3 ? ` +${x.ingredients.length - 3}` : ""}
                      </span>
                    )}

                    {/* single-mode: покажем ингредиент */}
                    {!x.ingredients && x.ingredient_name ? (
                      <span className="text-xs bg-white/70 border px-2 py-0.5 rounded-full">
                        {x.ingredient_name}
                      </span>
                    ) : null}
                  </div>

                  <div className="whitespace-nowrap">
                    маржа: <b>{Math.round(toNum(x.margin) * 10) / 10}%</b> • COGS:{" "}
                    <b>{fmt(x.cogs)}</b> • цена: <b>{fmt(x.price)}</b>
                  </div>
                </div>
              ))}

              {impactResult.below.length > 10 && (
                <div className="text-xs text-red-800">…и ещё {impactResult.below.length - 10}</div>
              )}
            </div>
          </div>
        ) : impactResult ? (
          <div className="mt-2 text-sm text-green-700">✅ Ни одно блюдо не упало ниже порога.</div>
        ) : (
          <div className="mt-2 text-sm text-gray-600">
            Сохраните изменение ингредиента — и тут появится отчёт. Или нажмите «Пересчитать всё».
          </div>
        )}
      </div>

      {/* List */}
      <div className="bg-white rounded-2xl shadow overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="font-semibold">Список ингредиентов</h2>
          <div className="text-sm text-gray-600">{loading ? "Загрузка..." : `Всего: ${items.length}`}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="text-left px-4 py-2">Название</th>
                <th className="text-left px-4 py-2">Unit</th>
                <th className="text-right px-4 py-2">Pack size</th>
                <th className="text-right px-4 py-2">Pack price</th>
                <th className="text-left px-4 py-2">Supplier</th>
                <th className="text-left px-4 py-2">Notes</th>
                <th className="text-right px-4 py-2">Действия</th>
              </tr>
            </thead>

            <tbody>
              {!loading && items.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-gray-500" colSpan={7}>
                    Пока пусто — добавь ингредиенты сверху.
                  </td>
                </tr>
              )}

              {items.map((it) => {
                const isEditing = editingId === it.id;
                const archived = !!it.is_archived;

                return (
                  <tr key={it.id} className={`border-t ${archived ? "opacity-60" : ""}`}>
                    <td className="px-4 py-2">
                      {isEditing ? (
                        <input
                          className="border rounded-xl px-2 py-1 w-full"
                          value={editForm?.name ?? ""}
                          onChange={(e) => setEditForm((s) => ({ ...s, name: e.target.value }))}
                        />
                      ) : (
                        <div className="font-medium">
                          {it.name}{" "}
                          {archived && (
                            <span className="ml-2 text-xs bg-gray-100 border px-2 py-0.5 rounded-full">
                              archived
                            </span>
                          )}
                          {/* 🟡 визуальный хинт если pack_size = 0 */}
                          {toNum(it.pack_size) <= 0 && (
                            <span className="ml-2 text-xs bg-yellow-50 border border-yellow-200 px-2 py-0.5 rounded-full text-yellow-800">
                              pack size = 0
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-2">
                      {isEditing ? (
                        <select
                          className="border rounded-xl px-2 py-1"
                          value={editForm?.unit ?? "g"}
                          onChange={(e) => setEditForm((s) => ({ ...s, unit: e.target.value }))}
                        >
                          <option value="g">g</option>
                          <option value="ml">ml</option>
                          <option value="pcs">pcs</option>
                        </select>
                      ) : (
                        it.unit || "—"
                      )}
                    </td>

                    <td className="px-4 py-2 text-right">
                      {isEditing ? (
                        <input
                          className="border rounded-xl px-2 py-1 w-28 text-right"
                          value={editForm?.pack_size ?? ""}
                          onChange={(e) => setEditForm((s) => ({ ...s, pack_size: e.target.value }))}
                        />
                      ) : (
                        it.pack_size ?? "—"
                      )}
                    </td>

                    <td className="px-4 py-2 text-right">
                      {isEditing ? (
                        <input
                          className="border rounded-xl px-2 py-1 w-32 text-right"
                          value={editForm?.pack_price ?? ""}
                          onChange={(e) => setEditForm((s) => ({ ...s, pack_price: e.target.value }))}
                        />
                      ) : (
                        it.pack_price != null ? fmt(it.pack_price) : "—"
                      )}
                    </td>

                    <td className="px-4 py-2">
                      {isEditing ? (
                        <input
                          className="border rounded-xl px-2 py-1 w-full"
                          value={editForm?.supplier ?? ""}
                          onChange={(e) => setEditForm((s) => ({ ...s, supplier: e.target.value }))}
                        />
                      ) : (
                        it.supplier || "—"
                      )}
                    </td>

                    <td className="px-4 py-2">
                      {isEditing ? (
                        <input
                          className="border rounded-xl px-2 py-1 w-full"
                          value={editForm?.notes ?? ""}
                          onChange={(e) => setEditForm((s) => ({ ...s, notes: e.target.value }))}
                        />
                      ) : (
                        it.notes || "—"
                      )}
                    </td>

                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {isEditing ? (
                        <form onSubmit={saveEdit} className="inline-flex gap-2">
                          <button
                            type="submit"
                            className="px-3 py-1.5 rounded-xl bg-black text-white hover:opacity-90"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="px-3 py-1.5 rounded-xl border hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <div className="inline-flex gap-2">
                          <button
                            onClick={() => startEdit(it.id)}
                            className="px-3 py-1.5 rounded-xl border hover:bg-gray-50"
                          >
                            Edit
                          </button>
                          {!archived && (
                            <button
                              onClick={() => archive(it.id)}
                              className="px-3 py-1.5 rounded-xl border border-red-200 text-red-700 hover:bg-red-50"
                            >
                              Archive
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-xs text-gray-500">
        Unit: g/ml/pcs. Pack size/price нужны для расчёта себестоимости (COGS) по рецепту.
      </div>
    </div>
  );
}
