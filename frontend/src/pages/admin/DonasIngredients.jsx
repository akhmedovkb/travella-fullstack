// frontend/src/pages/admin/DonasIngredients.jsx

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "../../api";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function fmt(n) {
  const v = toNum(n);
  return v.toLocaleString("ru-RU");
}

const UNITS = [
  { value: "g", label: "g" },
  { value: "ml", label: "ml" },
  { value: "pcs", label: "pcs" },
];

export default function DonasIngredients() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const [showArchived, setShowArchived] = useState(false);

  const [editing, setEditing] = useState(null);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("g");
  const [packSize, setPackSize] = useState("");
  const [packPrice, setPackPrice] = useState("");
  const [isActive, setIsActive] = useState(true);

  const title = useMemo(() => "Ингредиенты (сырьё)", []);

  async function load() {
    setLoading(true);
    try {
      const q = showArchived ? "?includeArchived=true" : "";
      const r = await apiGet(`/api/admin/donas/ingredients${q}`);
      setItems(r?.items || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  function resetForm() {
    setEditing(null);
    setName("");
    setUnit("g");
    setPackSize("");
    setPackPrice("");
    setIsActive(true);
  }

  function startEdit(x) {
    setEditing(x);
    setName(x.name || "");
    setUnit(x.unit || "g");
    setPackSize(String(x.pack_size ?? ""));
    setPackPrice(String(x.pack_price ?? ""));
    setIsActive(!!x.is_active && !x.is_archived);
  }

  const pricePerUnit = useMemo(() => {
    const size = toNum(packSize);
    const price = toNum(packPrice);
    if (!size) return 0;
    return price / size;
  }, [packSize, packPrice]);

  async function save(e) {
    e?.preventDefault?.();

    const payload = {
      name: String(name || "").trim(),
      unit,
      pack_size: toNum(packSize),
      pack_price: toNum(packPrice),
      is_active: !!isActive,
    };

    if (!payload.name) return alert("Название обязательно");

    if (editing?.id) {
      await apiPut(`/api/admin/donas/ingredients/${editing.id}`, {
        ...payload,
        is_archived: false,
      });
    } else {
      await apiPost(`/api/admin/donas/ingredients`, payload);
    }

    resetForm();
    await load();
  }

  async function archive(x) {
    if (!confirm(`Архивировать "${x.name}"?`)) return;
    await apiDelete(`/api/admin/donas/ingredients/${x.id}`);
    await load();
  }

  async function restore(x) {
    await apiPut(`/api/admin/donas/ingredients/${x.id}`, {
      name: x.name,
      unit: x.unit,
      pack_size: x.pack_size,
      pack_price: x.pack_price,
      is_active: true,
      is_archived: false,
    });
    await load();
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold">{title}</h1>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-black"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Показать архив
        </label>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* FORM */}
        <div className="bg-white rounded-2xl shadow p-4">
          <div className="font-semibold mb-3">
            {editing ? `Редактирование #${editing.id}` : "Новый ингредиент"}
          </div>

          <form onSubmit={save} className="space-y-3">
            <div>
              <div className="text-xs text-gray-500 mb-1">Название</div>
              <input
                className="w-full border rounded-xl px-3 py-2"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Напр.: Rice flour"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-1">
                <div className="text-xs text-gray-500 mb-1">Unit</div>
                <select
                  className="w-full border rounded-xl px-3 py-2"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                >
                  {UNITS.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-1">
                <div className="text-xs text-gray-500 mb-1">Pack size</div>
                <input
                  className="w-full border rounded-xl px-3 py-2"
                  value={packSize}
                  onChange={(e) => setPackSize(e.target.value)}
                  placeholder="1000"
                />
              </div>

              <div className="col-span-1">
                <div className="text-xs text-gray-500 mb-1">Pack price</div>
                <input
                  className="w-full border rounded-xl px-3 py-2"
                  value={packPrice}
                  onChange={(e) => setPackPrice(e.target.value)}
                  placeholder="45000"
                />
              </div>
            </div>

            <div className="text-sm text-gray-700">
              Price per unit: <b>{fmt(pricePerUnit)}</b>
              <span className="text-gray-500"> / {unit}</span>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-black"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Активный
            </label>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-black text-white"
              >
                {editing ? "Сохранить" : "Создать"}
              </button>

              <button
                type="button"
                className="px-4 py-2 rounded-xl border"
                onClick={resetForm}
              >
                Сброс
              </button>
            </div>
          </form>
        </div>

        {/* LIST */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold">Список</div>
            {loading ? <div className="text-sm text-gray-500">Загрузка…</div> : null}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-2">#</th>
                  <th>Название</th>
                  <th>Unit</th>
                  <th>Pack</th>
                  <th>Цена/ед.</th>
                  <th>Статус</th>
                  <th className="text-right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {items.map((x) => {
                  const ppu = toNum(x.price_per_unit);
                  const archived = !!x.is_archived;
                  return (
                    <tr key={x.id} className="border-t">
                      <td className="py-2">{x.id}</td>
                      <td className={archived ? "text-gray-400 line-through" : ""}>
                        {x.name}
                      </td>
                      <td>{x.unit}</td>
                      <td>
                        {fmt(x.pack_size)} / {fmt(x.pack_price)}
                      </td>
                      <td>
                        {fmt(ppu)} / {x.unit}
                      </td>
                      <td>
                        {archived ? (
                          <span className="text-gray-500">архив</span>
                        ) : x.is_active ? (
                          <span className="text-green-700">активен</span>
                        ) : (
                          <span className="text-gray-500">не активен</span>
                        )}
                      </td>
                      <td className="text-right">
                        <div className="flex justify-end gap-2">
                          {archived ? (
                            <button
                              className="px-3 py-1 rounded-lg border"
                              onClick={() => restore(x)}
                            >
                              Восстановить
                            </button>
                          ) : (
                            <>
                              <button
                                className="px-3 py-1 rounded-lg border"
                                onClick={() => startEdit(x)}
                              >
                                Редактировать
                              </button>
                              <button
                                className="px-3 py-1 rounded-lg border border-red-300 text-red-700"
                                onClick={() => archive(x)}
                              >
                                В архив
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {!items.length ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-gray-500">
                      Пока пусто
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
