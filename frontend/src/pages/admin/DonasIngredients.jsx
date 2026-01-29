// frontend/src/pages/admin/DonasIngredients.jsx

import { useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../../api";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function fmt(n) {
  const v = Math.round(toNum(n));
  return v.toLocaleString("ru-RU");
}

export default function DonasIngredients() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Margin impact (after ingredient change)
  const [marginThreshold, setMarginThreshold] = useState(40);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactResult, setImpactResult] = useState(null); // {threshold, below:[...]}

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
  const editItem = useMemo(
    () => items.find((x) => x.id === editingId) || null,
    [items, editingId]
  );
  const [editForm, setEditForm] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const q = includeArchived ? "?includeArchived=1" : "";
      const r = await apiGet(`/api/admin/donas/ingredients${q}`, true);
      setItems(Array.isArray(r?.items) ? r.items : []);
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
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(null);
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
    };

    if (!payload.name) return;

    setCreating(true);
    try {
      await apiPost("/api/admin/donas/ingredients", payload, true);
      setForm({
        name: "",
        unit: "g",
        pack_size: "",
        pack_price: "",
        supplier: "",
        notes: "",
      });
      await load();
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
    };

    if (!payload.name) return;
    await apiPut(`/api/admin/donas/ingredients/${editingId}`, payload, true);
    // ✅ проверяем, не “упала ли” маржа после изменения ингредиента
    await checkMarginImpact(editingId);

    cancelEdit();
    await load();
  }

  async function archive(id) {
    if (!id) return;
    await apiDelete(`/api/admin/donas/ingredients/${id}`, null, true);
    if (editingId === id) cancelEdit();
    await load();
  }
  
  async function checkMarginImpact(ingredientId) {
      setImpactLoading(true);
      try {
        const r = await apiGet(
          `/api/admin/donas/ingredients/${ingredientId}/margin-impact?threshold=${marginThreshold}`,
          true
        );
        setImpactResult(r || null);
      } finally {
        setImpactLoading(false);
      }
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
        <div className="flex items-center justify-between gap-3">
          <div className="font-semibold">Контроль маржи после изменения ингредиента</div>

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
          <div className="text-sm text-gray-600 mt-2">Проверяю влияние на маржу...</div>
        ) : impactResult?.below?.length ? (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3">
            <div className="font-semibold text-red-800">
              ⚠️ Маржа стала ниже {impactResult.threshold}% у {impactResult.below.length} блюд
            </div>
            <div className="text-sm text-red-900 mt-2 space-y-1">
              {impactResult.below.slice(0, 10).map((x) => (
                <div key={x.menu_item_id} className="flex items-center justify-between gap-3">
                  <span>
                    #{x.menu_item_id} — <b>{x.name}</b>
                  </span>
                  <span className="whitespace-nowrap">
                    маржа: <b>{Math.round(x.margin * 10) / 10}%</b> • COGS:{" "}
                    <b>{fmt(x.cogs)}</b> • цена: <b>{fmt(x.price)}</b>
                  </span>
                </div>
              ))}
              {impactResult.below.length > 10 && (
                <div className="text-xs text-red-800">
                  …и ещё {impactResult.below.length - 10}
                </div>
              )}
            </div>
          </div>
        ) : impactResult ? (
          <div className="mt-2 text-sm text-green-700">✅ Ни одно блюдо не упало ниже порога.</div>
        ) : (
          <div className="mt-2 text-sm text-gray-600">
            Сохраните изменение ингредиента — и тут появится отчёт.
          </div>
        )}
      </div>

      {/* List */}
      <div className="bg-white rounded-2xl shadow overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="font-semibold">Список ингредиентов</h2>
          <div className="text-sm text-gray-600">
            {loading ? "Загрузка..." : `Всего: ${items.length}`}
          </div>
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
                const archived = !!it.archived;

                return (
                  <tr key={it.id} className={`border-t ${archived ? "opacity-60" : ""}`}>
                    <td className="px-4 py-2">
                      {isEditing ? (
                        <input
                          className="border rounded-xl px-2 py-1 w-full"
                          value={editForm?.name ?? ""}
                          onChange={(e) =>
                            setEditForm((s) => ({ ...s, name: e.target.value }))
                          }
                        />
                      ) : (
                        <div className="font-medium">
                          {it.name}{" "}
                          {archived && (
                            <span className="ml-2 text-xs bg-gray-100 border px-2 py-0.5 rounded-full">
                              archived
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
                          onChange={(e) =>
                            setEditForm((s) => ({ ...s, unit: e.target.value }))
                          }
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
                          onChange={(e) =>
                            setEditForm((s) => ({ ...s, pack_size: e.target.value }))
                          }
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
                          onChange={(e) =>
                            setEditForm((s) => ({ ...s, pack_price: e.target.value }))
                          }
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
                          onChange={(e) =>
                            setEditForm((s) => ({ ...s, supplier: e.target.value }))
                          }
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
                          onChange={(e) =>
                            setEditForm((s) => ({ ...s, notes: e.target.value }))
                          }
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

      {/* Hint */}
      <div className="text-xs text-gray-500">
        Unit: g/ml/pcs. Pack size/price нужны для расчёта себестоимости (COGS) по рецепту.
      </div>
    </div>
  );
}

