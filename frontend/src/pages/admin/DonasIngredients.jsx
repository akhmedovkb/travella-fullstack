// frontend/src/pages/admin/DonasIngredients.jsx

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "../../api";

const UNITS = [
  { value: "pcs", label: "pcs" },
  { value: "g", label: "g" },
  { value: "kg", label: "kg" },
  { value: "ml", label: "ml" },
  { value: "l", label: "l" },
];

function cls(...xs) {
  return xs.filter(Boolean).join(" ");
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function money(n) {
  const v = Math.round(toNum(n));
  return v.toLocaleString("ru-RU");
}

function round4(n) {
  const x = toNum(n);
  return Math.round(x * 10000) / 10000;
}

function calcPricePerUnit(unit, packSize, packPrice) {
  const size = toNum(packSize);
  const price = toNum(packPrice);
  if (!size) return 0;
  // price per same unit as pack
  return price / size;
}

export default function DonasIngredients() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const [items, setItems] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [q, setQ] = useState("");

  // form
  const [editingId, setEditingId] = useState(null);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [packSize, setPackSize] = useState("");
  const [packPrice, setPackPrice] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isArchived, setIsArchived] = useState(false);

  function resetForm() {
    setEditingId(null);
    setName("");
    setUnit("pcs");
    setPackSize("");
    setPackPrice("");
    setIsActive(true);
    setIsArchived(false);
  }

  async function load() {
    setLoading(true);
    setErr("");
    setOkMsg("");
    try {
      const url = `/api/admin/donas/ingredients?include_archived=${showArchived ? 1 : 0}`;
      const r = await apiGet(url);
      const list = r?.items || r?.rows || r?.data?.items || r?.data?.rows || [];
      // apiGet у тебя возвращает обычно r.data, но на всякий — страхуемся
      setItems(Array.isArray(list) ? list : []);
    } catch (e) {
      setErr(e?.response?.data?.error || e?.message || "Failed to load ingredients");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  const filtered = useMemo(() => {
    const s = String(q || "").trim().toLowerCase();
    if (!s) return items;
    return items.filter((x) => {
      const nm = String(x.name || "").toLowerCase();
      const un = String(x.unit || "").toLowerCase();
      return nm.includes(s) || un.includes(s);
    });
  }, [items, q]);

  const formPpu = useMemo(() => {
    return calcPricePerUnit(unit, packSize, packPrice);
  }, [unit, packSize, packPrice]);

  async function onSave(e) {
    e?.preventDefault?.();
    setErr("");
    setOkMsg("");

    const payload = {
      name: String(name || "").trim(),
      unit: String(unit || "").trim(),
      pack_size: toNum(packSize),
      pack_price: toNum(packPrice),
      is_active: !!isActive,
      is_archived: !!isArchived,
    };

    if (!payload.name) {
      setErr("Название обязательно");
      return;
    }
    if (!payload.unit) {
      setErr("Unit обязателен");
      return;
    }

    try {
      setLoading(true);
      if (editingId) {
        await apiPut(`/api/admin/donas/ingredients/${editingId}`, payload);
        setOkMsg("Ингредиент обновлён");
      } else {
        await apiPost(`/api/admin/donas/ingredients`, payload);
        setOkMsg("Ингредиент создан");
      }
      resetForm();
      await load();
    } catch (e2) {
      setErr(e2?.response?.data?.error || e2?.message || "Failed to save ingredient");
    } finally {
      setLoading(false);
    }
  }

  function onEditRow(x) {
    setOkMsg("");
    setErr("");
    setEditingId(x.id);
    setName(x.name || "");
    setUnit(x.unit || "pcs");
    setPackSize(String(x.pack_size ?? ""));
    setPackPrice(String(x.pack_price ?? ""));
    setIsActive(x.is_active !== false);
    setIsArchived(x.is_archived === true);
  }

  async function onArchiveRow(x) {
    setErr("");
    setOkMsg("");
    if (!x?.id) return;

    try {
      setLoading(true);
      // у тебя DELETE делает soft-delete (архив)
      await apiDelete(`/api/admin/donas/ingredients/${x.id}`);
      setOkMsg("Перемещено в архив");
      // если сейчас редактируем этот же — сбросим
      if (editingId === x.id) resetForm();
      await load();
    } catch (e) {
      setErr(e?.response?.data?.error || e?.message || "Failed to archive ingredient");
    } finally {
      setLoading(false);
    }
  }

  async function onRestoreRow(x) {
    setErr("");
    setOkMsg("");
    if (!x?.id) return;
    try {
      setLoading(true);
      await apiPut(`/api/admin/donas/ingredients/${x.id}`, { is_archived: false });
      setOkMsg("Восстановлено из архива");
      await load();
    } catch (e) {
      setErr(e?.response?.data?.error || e?.message || "Failed to restore ingredient");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Dona’s Dosas — Ingredients</h1>
          <p className="text-white/60 text-sm mt-1">
            Справочник ингредиентов для рецептов и расчёта себестоимости.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              className="accent-white"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Показать архив
          </label>

          <button
            onClick={() => load()}
            className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-sm"
            disabled={loading}
          >
            Обновить
          </button>
        </div>
      </div>

      {(err || okMsg) && (
        <div className="mb-4 space-y-2">
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
        {/* left: list */}
        <div className="lg:col-span-2 rounded-2xl bg-white/5 border border-white/10 overflow-hidden">
          <div className="p-4 border-b border-white/10 flex items-center justify-between gap-3">
            <div className="text-sm text-white/80">
              Всего: <span className="text-white">{filtered.length}</span>
              {loading && <span className="ml-2 text-white/50">• загрузка…</span>}
            </div>

            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск (название / unit)"
              className="w-64 max-w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-white/25"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-white/60 border-b border-white/10">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Название</th>
                  <th className="text-left font-medium px-4 py-3">Unit</th>
                  <th className="text-right font-medium px-4 py-3">Pack</th>
                  <th className="text-right font-medium px-4 py-3">Pack price</th>
                  <th className="text-right font-medium px-4 py-3">Price / unit</th>
                  <th className="text-right font-medium px-4 py-3">Статус</th>
                  <th className="text-right font-medium px-4 py-3">Действия</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-white/10">
                {filtered.map((x) => {
                  const ppu = calcPricePerUnit(x.unit, x.pack_size, x.pack_price);
                  const isRowArchived = x.is_archived === true;
                  const active = x.is_active !== false;

                  return (
                    <tr key={x.id} className={cls(isRowArchived && "opacity-60")}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{x.name}</div>
                        <div className="text-xs text-white/50 mt-0.5">
                          #{x.id}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-white/80">{x.unit}</td>
                      <td className="px-4 py-3 text-right text-white/80">
                        {toNum(x.pack_size) ? money(x.pack_size) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-white/80">
                        {toNum(x.pack_price) ? money(x.pack_price) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-white/80">
                        {ppu ? money(ppu) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={cls(
                            "inline-flex items-center px-2 py-1 rounded-lg text-xs border",
                            isRowArchived
                              ? "bg-white/5 border-white/10 text-white/60"
                              : active
                              ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-200"
                              : "bg-yellow-500/10 border-yellow-500/25 text-yellow-200"
                          )}
                        >
                          {isRowArchived ? "архив" : active ? "активен" : "выключен"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
                            onClick={() => onEditRow(x)}
                            disabled={loading}
                          >
                            Редактировать
                          </button>

                          {isRowArchived ? (
                            <button
                              className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
                              onClick={() => onRestoreRow(x)}
                              disabled={loading}
                            >
                              Восстановить
                            </button>
                          ) : (
                            <button
                              className="px-2.5 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/20 text-red-200 text-xs"
                              onClick={() => onArchiveRow(x)}
                              disabled={loading}
                            >
                              В архив
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {!filtered.length && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-white/50">
                      Ничего не найдено
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* right: form */}
        <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <div className="text-lg font-semibold">
                {editingId ? "Редактирование" : "Новый ингредиент"}
              </div>
              <div className="text-xs text-white/50 mt-1">
                Pack size + Pack price нужны для расчёта себестоимости
              </div>
            </div>

            {editingId && (
              <button
                onClick={resetForm}
                className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs"
                disabled={loading}
              >
                Отменить
              </button>
            )}
          </div>

          <form onSubmit={onSave} className="space-y-3">
            <div>
              <label className="block text-xs text-white/60 mb-1">Название</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-white/25"
                placeholder="Напр. Potato, Paneer, Masala…"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-white/60 mb-1">Unit</label>
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-white/25"
                >
                  {UNITS.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end">
                <label className="inline-flex items-center gap-2 text-sm text-white/80">
                  <input
                    type="checkbox"
                    className="accent-white"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                  />
                  Активен
                </label>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-white/60 mb-1">Pack size</label>
                <input
                  value={packSize}
                  onChange={(e) => setPackSize(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-white/25"
                  placeholder="Напр. 1000"
                  inputMode="decimal"
                />
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">Pack price</label>
                <input
                  value={packPrice}
                  onChange={(e) => setPackPrice(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-white/25"
                  placeholder="Напр. 45000"
                  inputMode="decimal"
                />
              </div>
            </div>

            <div className="p-3 rounded-xl bg-white/5 border border-white/10">
              <div className="text-xs text-white/60">Price / unit (расчёт)</div>
              <div className="text-lg font-semibold mt-1">
                {formPpu ? money(formPpu) : "—"}
                {formPpu ? (
                  <span className="text-white/50 text-sm font-normal ml-2">
                    за 1 {unit}
                  </span>
                ) : null}
              </div>
              {formPpu ? (
                <div className="text-xs text-white/50 mt-1">
                  {money(packPrice || 0)} / {money(packSize || 0)} = {money(round4(formPpu))}
                </div>
              ) : (
                <div className="text-xs text-white/50 mt-1">
                  Заполни Pack size и Pack price
                </div>
              )}
            </div>

            {editingId && (
              <label className="inline-flex items-center gap-2 text-sm text-white/80">
                <input
                  type="checkbox"
                  className="accent-white"
                  checked={isArchived}
                  onChange={(e) => setIsArchived(e.target.checked)}
                />
                В архиве
              </label>
            )}

            <div className="pt-2 flex items-center gap-2">
              <button
                type="submit"
                className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/25 text-emerald-100 border border-emerald-500/25"
                disabled={loading}
              >
                {editingId ? "Сохранить" : "Создать"}
              </button>

              <button
                type="button"
                className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15"
                onClick={resetForm}
                disabled={loading}
              >
                Очистить
              </button>
            </div>

            <div className="text-xs text-white/50">
              API: <span className="text-white/70">/api/admin/donas/ingredients</span>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
