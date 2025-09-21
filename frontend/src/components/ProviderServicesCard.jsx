// frontend/src/components/ProviderServicesCard.jsx
import React, { useEffect, useMemo, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

const CATEGORY_LABELS = {
  city_tour_guide: "Тур по городу (гид)",
  mountain_tour_guide: "Тур в горы (гид)",
  meet: "Встреча",
  seeoff: "Провод",
  translation: "Перевод",
  city_tour_transport: "Тур по городу (транспорт)",
  mountain_tour_transport: "Тур в горы (транспорт)",
  one_way_transfer: "Трансфер в одну сторону",
  dinner_transfer: "Трансфер на ужин",
  border_transfer: "Междугородний/пограничный трансфер",
};

const GUIDE_ALLOWED = [
  "city_tour_guide","mountain_tour_guide","meet","seeoff","translation",
];
const TRANSPORT_ALLOWED = [
  "city_tour_transport","mountain_tour_transport","one_way_transfer","dinner_transfer","border_transfer",
];

const fetchJSON = async (url, opts = {}) => {
  const tok =
    (typeof localStorage !== "undefined" && (localStorage.getItem("token") || localStorage.getItem("providerToken"))) || "";
  const r = await fetch(url, {
    ...opts,
    credentials: "include", // cookie, если используются
    headers: {
      "Content-Type": "application/json",
      ...(tok ? { Authorization: `Bearer ${tok}` } : {}), // ⬅️ Bearer, если есть
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.status === 204 ? null : r.json();
};


export default function ProviderServicesCard({ providerId, providerType = "guide", currencyDefault = "USD" }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ category: "", title: "", price: "", currency: currencyDefault, is_active: true });
  const [saving, setSaving] = useState(false);

  const allowedCats = useMemo(
    () => (providerType === "guide" ? GUIDE_ALLOWED : TRANSPORT_ALLOWED),
    [providerType]
  );

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchJSON(`${API_BASE}/api/providers/${providerId}/services`);
      setList(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (providerId) load(); }, [providerId]);

  const onSave = async (e) => {
    e.preventDefault();
    if (!form.category) return;
    setSaving(true);
    try {
      await fetchJSON(`${API_BASE}/api/providers/${providerId}/services`, {
        method: "POST",
        body: JSON.stringify({
          category: form.category,
          title: form.title || null,
          price: Number(form.price) || 0,
          currency: form.currency || currencyDefault,
          is_active: !!form.is_active,
        }),
      });
      setForm({ category: "", title: "", price: "", currency: currencyDefault, is_active: true });
      await load();
    } finally { setSaving(false); }
  };

  const toggleActive = async (row) => {
    await fetchJSON(`${API_BASE}/api/providers/${providerId}/services/${row.id}`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: !row.is_active }),
    });
    await load();
  };

  const updatePrice = async (row, v) => {
    await fetchJSON(`${API_BASE}/api/providers/${providerId}/services/${row.id}`, {
      method: "PATCH",
      body: JSON.stringify({ price: Number(v) || 0 }),
    });
    await load();
  };

  return (
    <div className="border rounded-xl p-4 space-y-4">
      <div className="text-lg font-semibold">Services</div>

      {/* form add */}
      <form onSubmit={onSave} className="grid md:grid-cols-5 gap-2 items-end">
        <label className="md:col-span-2">
          <div className="text-xs mb-1">Категория</div>
          <select
            className="w-full border rounded h-9 px-2"
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
          >
            <option value="">— выберите категорию —</option>
            {allowedCats.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </label>

        <label className="md:col-span-1">
          <div className="text-xs mb-1">Название (опц.)</div>
          <input
            className="w-full border rounded h-9 px-2"
            placeholder="например, 4 часа"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
        </label>

        <label>
          <div className="text-xs mb-1">Цена</div>
          <input
            type="number" min="0" step="0.01"
            className="w-full border rounded h-9 px-2"
            value={form.price}
            onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
          />
        </label>

        <div className="flex gap-2">
          <select
            className="border rounded h-9 px-2"
            value={form.currency}
            onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
          >
            <option>USD</option>
            <option>UZS</option>
            <option>EUR</option>
          </select>
          <button
            className="h-9 px-4 rounded bg-blue-600 text-white disabled:opacity-50"
            disabled={saving || !form.category}
          >
            {saving ? "Сохраняю…" : "Добавить"}
          </button>
        </div>
      </form>

      {/* table */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2 pr-3">Категория</th>
              <th className="py-2 pr-3">Название</th>
              <th className="py-2 pr-3">Цена</th>
              <th className="py-2 pr-3">Валюта</th>
              <th className="py-2 pr-3">Статус</th>
              <th className="py-2 pr-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="py-3" colSpan={6}>Загрузка…</td></tr>
            ) : list.length === 0 ? (
              <tr><td className="py-3" colSpan={6}>Пока нет услуг</td></tr>
            ) : (
              list.map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="py-2 pr-3">{CATEGORY_LABELS[row.category] || row.category}</td>
                  <td className="py-2 pr-3">{row.title || "—"}</td>
                  <td className="py-2 pr-3">
                    <input
                      type="number" min="0" step="0.01"
                      defaultValue={row.price}
                      className="border rounded h-8 px-2 w-28"
                      onBlur={(e) => e.target.value !== String(row.price) && updatePrice(row, e.target.value)}
                    />
                  </td>
                  <td className="py-2 pr-3">{row.currency}</td>
                  <td className="py-2 pr-3">{row.is_active ? "Активна" : "Выключена"}</td>
                  <td className="py-2 pr-3">
                    <button
                      className="px-3 py-1 border rounded"
                      onClick={() => toggleActive(row)}
                    >
                      {row.is_active ? "Disable" : "Enable"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500">
        Подсказка: услуги с ценой <b>0</b> TourBuilder не показывает. Заполните цены — и они сразу появятся в конструкторе.
      </p>
    </div>
  );
}
