// frontend/src/components/ProviderServicesCard.jsx
import React, { useEffect, useMemo, useState } from "react";

const CATEGORY_LABELS = {
  // guide
  city_tour_guide: "Тур по городу (гид)",
  mountain_tour_guide: "Тур в горы (гид)",
  meet: "Встреча (гид)",
  seeoff: "Провод (гид)",
  translation: "Перевод (гид)",
  // transport (для перевозчиков)
  city_tour_transport: "Тур по городу (транспорт)",
  mountain_tour_transport: "Тур в горы (транспорт)",
  one_way_transfer: "Трансфер в одну сторону",
  dinner_transfer: "Трансфер на ужин",
  border_transfer: "Междугородний/погран. трансфер",
};

// подписи для гида с авто («гид+транспорт»)
const GUIDE_TRANSPORT_LABELS = {
  city_tour_transport: "Тур по городу (гид+транспорт)",
  mountain_tour_transport: "Тур в горы (гид+транспорт)",
  one_way_transfer: "Трансфер в одну сторону (гид+транспорт)",
  dinner_transfer: "Трансфер на ужин (гид+транспорт)",
  border_transfer: "Междугородний/погран. трансфер (гид+транспорт)",
};

const GUIDE_ALLOWED = [
  "city_tour_guide",
  "mountain_tour_guide",
  "meet",
  "seeoff",
  "translation",
];

const TRANSPORT_ALLOWED = [
  "city_tour_transport",
  "mountain_tour_transport",
  "one_way_transfer",
  "dinner_transfer",
  "border_transfer",
];

const isTransportCategory = (cat) => TRANSPORT_ALLOWED.includes(cat);

// --- fetch helper с токеном
async function fetchJSON(path, init = {}) {
  const base = import.meta.env.VITE_API_BASE_URL || "";
  const url = new URL(path, base);
  const token =
    (typeof localStorage !== "undefined" && localStorage.getItem("token")) || "";
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.headers || {}),
  };
  const res = await fetch(url.toString(), { ...init, headers });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${txt || res.statusText}`);
  }
  return res.status === 204 ? null : res.json();
}

const toMoney = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const TitleCaseCity = (s) =>
  String(s || "")
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");

export default function ProviderServicesCard({
  providerId,
  providerType, // 'guide' | 'transport'
  currencyDefault = "USD",
}) {
  const pid = Number(providerId);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // профиль нужен, чтобы понять есть ли авто у гида
  const [profile, setProfile] = useState(null);
  const hasFleet = useMemo(
    () =>
      Array.isArray(profile?.car_fleet) &&
      profile.car_fleet.some((c) => c && c.is_active !== false),
    [profile]
  );

  // add form
  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState(currencyDefault || "USD");
  const [seats, setSeats] = useState("");

  // bulk
  const [bulkBusy, setBulkBusy] = useState(false);

  // подгружаем профиль один раз (для определения hasFleet)
  useEffect(() => {
    (async () => {
      try {
        const me = await fetchJSON(`/api/providers/profile`);
        setProfile(me || {});
      } catch {
        // молча
      }
    })();
  }, []);

  const labelForCategory = useMemo(() => {
    const isGuide = providerType === "guide";
    return (cat) => {
      if (isGuide && isTransportCategory(cat)) {
        return GUIDE_TRANSPORT_LABELS[cat] || CATEGORY_LABELS[cat] || cat;
      }
      return CATEGORY_LABELS[cat] || cat;
    };
  }, [providerType]);

  const categories = useMemo(() => {
    const base = [{ label: "— выберите категорию —", value: "" }];

    const guide = [
      { label: "ГИД", value: "_sep1", disabled: true },
      ...GUIDE_ALLOWED.map((v) => ({ value: v, label: CATEGORY_LABELS[v] })),
    ];

    // если гид БЕЗ авто — не показываем транспортные опции вообще
    const guideTransport =
      providerType === "guide" && hasFleet
        ? [
            { label: "ГИД+ТРАНСПОРТ", value: "_sep2", disabled: true },
            ...TRANSPORT_ALLOWED.map((v) => ({
              value: v,
              label: GUIDE_TRANSPORT_LABELS[v] || CATEGORY_LABELS[v],
            })),
          ]
        : [];

    const transportSection =
      providerType === "transport"
        ? [
            { label: "ТРАНСПОРТ", value: "_sep3", disabled: true },
            ...TRANSPORT_ALLOWED.map((v) => ({
              value: v,
              label: CATEGORY_LABELS[v],
            })),
          ]
        : [];

    if (providerType === "guide") return [...base, ...guide, ...guideTransport];
    if (providerType === "transport") return [...base, ...transportSection];
    // на всякий случай для других: всё
    return [...base, ...guide, ...guideTransport, ...transportSection];
  }, [providerType, hasFleet]);

  useEffect(() => setCurrency(currencyDefault || "USD"), [currencyDefault]);

  async function load() {
    if (!pid) return;
    setLoading(true);
    setErr("");
    try {
      const list = await fetchJSON(`/api/providers/${pid}/services`);
      setRows(Array.isArray(list) ? list : []);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  async function addOne() {
    if (!category) return;
    try {
      const body = {
        category,
        title: title || null,
        price: toMoney(price),
        currency: currency || currencyDefault || "USD",
      };
      if (isTransportCategory(category)) {
        const n = Number(seats);
        if (Number.isInteger(n) && n > 0) body.details = { seats: n };
      }
      const created = await fetchJSON(`/api/providers/${pid}/services`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setRows((m) => [created, ...m]);
      setTitle("");
      setPrice("");
      if (isTransportCategory(category)) setSeats("");
    } catch (e) {
      alert("Ошибка добавления: " + e.message);
    }
  }

  async function patchRow(id, patch) {
    try {
      const updated = await fetchJSON(`/api/providers/${pid}/services/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    setRows((m) => m.map((r) => (r.id === id ? updated : r)));
    } catch (e) {
      alert("Не удалось сохранить: " + e.message);
      load();
    }
  }

  async function toggleActive(row) {
    await patchRow(row.id, { is_active: !row.is_active });
  }

  async function removeRow(id) {
    if (!confirm("Удалить услугу?")) return;
    try {
      await fetchJSON(`/api/providers/${pid}/services/${id}`, { method: "DELETE" });
      setRows((m) => m.filter((r) => r.id !== id));
    } catch (e) {
      alert("Не удалось удалить: " + e.message);
    }
  }

  async function bulkGenerateFromProfile() {
    setBulkBusy(true);
    try {
      const me = await fetchJSON(`/api/providers/profile`);
      const cities = Array.isArray(me?.city_slugs) ? me.city_slugs : [];
      const fleet = Array.isArray(me?.car_fleet) ? me.car_fleet : [];

      if (!cities.length) {
        alert('Сначала заполните "Регион деятельности" в профиле.');
        setBulkBusy(false);
        return;
      }

      const guideItems = cities.map((slug) => ({
        category: "city_tour_guide",
        title: `Тур по городу ${TitleCaseCity(slug)} (гид)`,
        price: 0,
        currency: currencyDefault || "USD",
        details: { city_slug: slug },
      }));

      const transportItems = [];
      for (const car of fleet.filter((c) => c && c.is_active !== false)) {
        const n = Number(car.seats);
        const seatsOk = Number.isInteger(n) && n > 0;
        const model = String(car.model || "").trim();
        for (const slug of cities) {
          transportItems.push({
            category: "city_tour_transport",
            title: `Тур по городу ${TitleCaseCity(
              slug
            )} (гид+транспорт ${seatsOk ? `${n}-местный ` : ""}${model})`,
            price: 0,
            currency: currencyDefault || "USD",
                        details: {
              ...(seatsOk ? { seats: n } : {}),
              city_slug: slug,
            },
          });
        }
      }

      const items =
        providerType === "transport"
          ? transportItems
          : [...guideItems, ...transportItems];

      if (!items.length) {
        alert("Не из чего генерировать: добавьте города и/или автомобили в профиле.");
        setBulkBusy(false);
        return;
      }

      if (
        !confirm(
          `Будут добавлены ${items.length} услуг(и). Цены = 0 — заполните после создания. Продолжить?`
        )
      ) {
        setBulkBusy(false);
        return;
      }

      const res = await fetchJSON(`/api/providers/${pid}/services/bulk`, {
        method: "POST",
        body: JSON.stringify({ items }),
      });
      const created = Array.isArray(res?.items) ? res.items : [];
      if (created.length) setRows((m) => [...created, ...m]);
      await load();
    } catch (e) {
      alert("Bulk ошибка: " + e.message);
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="rounded-xl border bg-white shadow-sm">
      <div className="p-4 border-b flex items-center justify-between">
        <h2 className="text-lg font-semibold">Services</h2>
        <div className="flex items-center gap-2">
          <button
            className="h-9 px-3 rounded border text-sm hover:bg-gray-50"
            onClick={load}
            disabled={loading}
          >
            Обновить
          </button>
          <button
            className="h-9 px-3 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-60"
            onClick={bulkGenerateFromProfile}
            disabled={bulkBusy}
            title="Автогенерация по городам и авто из профиля"
          >
            {bulkBusy ? "Генерируем…" : "Сгенерировать из профиля"}
          </button>
        </div>
      </div>

      {/* add form */}
      <div className="p-4 grid gap-3 md:grid-cols-[minmax(220px,270px)_minmax(180px,1fr)_140px_110px_auto] items-center">
        <div>
          <label className="block text-xs text-gray-600 mb-1">Категория</label>
          <select
            className="w-full h-9 border rounded px-2 text-sm"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c.value} value={c.value} disabled={c.disabled}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">
            Название (опц.)
          </label>
          <input
            className="w-full h-9 border rounded px-2 text-sm"
            placeholder="например, 4 часа или модель авто"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">Мест</label>
          <input
            className="w-full h-9 border rounded px-2 text-sm disabled:bg-gray-50"
            type="number"
            min={0}
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
            disabled={!isTransportCategory(category)}
          />
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Цена</label>
            <input
              className="w-full h-9 border rounded px-2 text-sm"
              placeholder="100, 120.50 …"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Валюта</label>
            <select
              className="h-9 border rounded px-2 text-sm"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              <option>USD</option>
              <option>UZS</option>
              <option>EUR</option>
            </select>
          </div>
        </div>

        <div className="pt-5">
          <button
            onClick={addOne}
            className="h-9 px-4 rounded bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-60"
            disabled={!category}
          >
            Добавить
          </button>
        </div>
      </div>

      {/* table */}
      <div className="px-4 pb-4">
        {err && <div className="text-sm text-red-600 mb-2">Ошибка: {err}</div>}

        <div className="overflow-x-auto">
          <table className="w-full text-sm border rounded">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="text-left p-2 border-b">Категория</th>
                <th className="text-left p-2 border-b">Название</th>
                <th className="text-left p-2 border-b">Мест</th>
                <th className="text-left p-2 border-b">Цена</th>
                <th className="text-left p-2 border-b">Валюта</th>
                <th className="text-left p-2 border-b">Статус</th>
                <th className="text-right p-2 border-b">Действия</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="p-3 text-gray-500" colSpan={7}>
                    Загружаем…
                  </td>
                </tr>
              ) : rows.length ? (
                rows.map((r) => {
                  const transport = isTransportCategory(r.category);
                  const seatsVal =
                    transport && r.details && Number(r.details.seats) > 0
                      ? Number(r.details.seats)
                      : "";

                  return (
                    <tr key={r.id} className="odd:bg-white even:bg-gray-50">
                      <td className="p-2 align-middle">
                        {labelForCategory(r.category)}
                      </td>

                      <td className="p-2">
                        <input
                          className="w-full h-8 border rounded px-2"
                          value={r.title || ""}
                          placeholder="Название…"
                          onChange={(e) =>
                            setRows((m) =>
                              m.map((x) =>
                                x.id === r.id ? { ...x, title: e.target.value } : x
                              )
                            )
                          }
                          onBlur={(e) => patchRow(r.id, { title: e.target.value || null })}
                        />
                      </td>

                      <td className="p-2">
                        <input
                          className="w-20 h-8 border rounded px-2 disabled:bg-gray-50"
                          type="number"
                          min={0}
                          value={seatsVal}
                          disabled={!transport}
                          onChange={(e) => {
                            const v = e.target.value;
                            setRows((m) =>
                              m.map((x) =>
                                x.id === r.id
                                  ? {
                                      ...x,
                                      details: {
                                        ...(x.details || {}),
                                        seats: v === "" ? undefined : Number(v),
                                      },
                                    }
                                  : x
                              )
                            );
                          }}
                          onBlur={(e) => {
                            const n = Number(e.target.value);
                            const patch =
                              transport && Number.isInteger(n) && n > 0
                                ? { details: { seats: n } }
                                : { details: {} }; // очистим seats
                            patchRow(r.id, patch);
                          }}
                        />
                      </td>

                      <td className="p-2">
                        <input
                          className="w-28 h-8 border rounded px-2"
                          value={r.price ?? ""}
                          onChange={(e) =>
                            setRows((m) =>
                              m.map((x) =>
                                x.id === r.id
                                  ? { ...x, price: e.target.value }
                                  : x
                              )
                            )
                          }
                          onBlur={(e) => patchRow(r.id, { price: toMoney(e.target.value) })}
                        />
                      </td>

                      <td className="p-2">
                        <select
                          className="h-8 border rounded px-2"
                          value={r.currency || currencyDefault || "USD"}
                          onChange={(e) =>
                            setRows((m) =>
                              m.map((x) =>
                                x.id === r.id
                                  ? { ...x, currency: e.target.value }
                                  : x
                              )
                            )
                          }
                          onBlur={(e) => patchRow(r.id, { currency: e.target.value })}
                        >
                          <option>USD</option>
                          <option>UZS</option>
                          <option>EUR</option>
                        </select>
                      </td>

                      <td className="p-2">
                        {r.is_active ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            ● Активна
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-gray-500">
                            ● Выключена
                          </span>
                        )}
                      </td>

                      <td className="p-2 text-right">
                        <button
                          className="h-8 px-3 rounded border text-xs mr-2"
                          onClick={() => toggleActive(r)}
                        >
                          {r.is_active ? "Disable" : "Enable"}
                        </button>
                        <button
                          className="h-8 px-3 rounded border text-xs text-red-600 border-red-300 hover:bg-red-50"
                          onClick={() => removeRow(r.id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="p-3 text-gray-500" colSpan={7}>
                    Услуги не найдены. Добавьте хотя бы одну.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-gray-500 mt-2">
          Подсказка: услуги с ценой 0 TourBuilder не показывает. Заполните цены — и
          они сразу появятся в конструкторе.
        </p>
      </div>
    </div>
  );
}
