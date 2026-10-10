// frontend/src/components/ProviderServicesCard.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { tSuccess, tError, tInfo } from "../shared/toast";

const CATEGORY_LABELS = {
  // guide
  city_tour_guide: "Тур по городу (гид)",
  mountain_tour_guide: "Тур в горы (гид)",
  desert_tour_guide: "Пустынный тур (гид)",
  safari_tour_guide: "Сафари-тур (гид)",
  meet: "Встреча (гид)",
  seeoff: "Провод (гид)",
  translation: "Перевод (гид)",
  // transport
  city_tour_transport: "Тур по городу (транспорт)",
  mountain_tour_transport: "Тур в горы (транспорт)",
  desert_tour_transport: "Пустынный тур (транспорт)",
  safari_tour_transport: "Сафари-тур (транспорт)",
  one_way_transfer: "Трансфер в одну сторону",
  dinner_transfer: "Трансфер на ужин",
  border_transfer: "Междугородний/погран. трансфер",
};

// подписи для «гид+транспорт»
const GUIDE_TRANSPORT_LABELS = {
  city_tour_transport: "Тур по городу (гид+транспорт)",
  mountain_tour_transport: "Тур в горы (гид+транспорт)",
  desert_tour_transport: "Пустынный тур (гид+транспорт)",
  safari_tour_transport: "Сафари-тур (гид+транспорт)",
  one_way_transfer: "Трансфер в одну сторону (гид+транспорт)",
  dinner_transfer: "Трансфер на ужин (гид+транспорт)",
  border_transfer: "Междугородний/погран. трансфер (гид+транспорт)",
};

const GUIDE_ALLOWED = [
  "city_tour_guide",
  "mountain_tour_guide",
  "desert_tour_guide",
  "safari_tour_guide",
  "meet",
  "seeoff",
  "translation",
];

const TRANSPORT_ALLOWED = [
  "city_tour_transport",
  "mountain_tour_transport",
  "desert_tour_transport",
  "safari_tour_transport",
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
  providerType, // 'guide' | 'transport' | 'agent'
  currencyDefault = "USD",
}) {
  const { t, i18n } = useTranslation();
  const lang = (i18n?.language || "").toLowerCase();
  const isUZ = lang.startsWith("uz");
  const isEN = lang.startsWith("en");

  // валюта — только UZS
  const FORCE_CURRENCY = "UZS";

  // fallback, если ключей нет
  const F = (ru, uz, en) => (isUZ ? uz : isEN ? en : ru);
  const TT = (key, ru, uz, en, opts = {}) =>
    t(key, { defaultValue: F(ru, uz, en), ...opts });

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
  const [currency, setCurrency] = useState(FORCE_CURRENCY);
  const [seats, setSeats] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [pricingMode, setPricingMode] = useState("fixed");
  const [minimumHours, setMinimumHours] = useState("2");
  const [halfDayHours, setHalfDayHours] = useState("4");
  const [halfDayPrice, setHalfDayPrice] = useState("");
  const [fullDayHours, setFullDayHours] = useState("8");
  const [fullDayPrice, setFullDayPrice] = useState("");
  const [extraHourPrice, setExtraHourPrice] = useState("");

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
        return t(`category.${cat}`, {
          defaultValue:
            GUIDE_TRANSPORT_LABELS[cat] || CATEGORY_LABELS[cat] || cat,
        });
      }
      return t(`category.${cat}`, {
        defaultValue: CATEGORY_LABELS[cat] || cat,
      });
    };
  }, [providerType, t]);

  const categories = useMemo(() => {
    const base = [
      {
        label: TT(
          "ps.form.category_ph",
          "— выберите категорию —",
          "— toifa tanlang —",
          "— choose category —"
        ),
        value: "",
      },
    ];

    const guide = [
      { label: TT("ps.grp.guide", "ГИД", "GID", "Guide"), value: "_sep1", disabled: true },
      ...GUIDE_ALLOWED.map((v) => ({
        value: v,
        label: t(`category.${v}`, { defaultValue: CATEGORY_LABELS[v] }),
      })),
    ];

    const guideTransport =
      providerType === "guide" && hasFleet
        ? [
            {
              label: TT(
                "ps.grp.guide_transport",
                "ГИД+ТРАНСПОРТ",
                "GID+TRANSPORT",
                "Guide+Transport"
              ),
              value: "_sep2",
              disabled: true,
            },
            ...TRANSPORT_ALLOWED.map((v) => ({
              value: v,
              label: t(`category.${v}`, {
                defaultValue:
                  GUIDE_TRANSPORT_LABELS[v] || CATEGORY_LABELS[v],
              }),
            })),
          ]
        : [];

    const transportSection =
      providerType === "transport" || providerType === "agent"
        ? [
            {
              label: TT("ps.grp.transport", "ТРАНСПОРТ", "TRANSPORT", "Transport"),
              value: "_sep3",
              disabled: true,
            },
            ...TRANSPORT_ALLOWED.map((v) => ({
              value: v,
              label: t(`category.${v}`, { defaultValue: CATEGORY_LABELS[v] }),
            })),
          ]
        : [];

    if (providerType === "guide") return [...base, ...guide, ...guideTransport];
    if (providerType === "transport") return [...base, ...transportSection];
    return [...base, ...guide, ...guideTransport, ...transportSection];
  }, [providerType, hasFleet, t]);

  useEffect(() => setCurrency(FORCE_CURRENCY), [currencyDefault]);

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
    const basePrice = toMoney(price);
    if (!category) {
      setErr("Выберите категорию услуги");
      return;
    }
    if (pricingMode !== "packages" && basePrice <= 0) {
      setErr(pricingMode === "hourly" ? "Укажите стоимость одного часа" : "Укажите стоимость услуги");
      return;
    }
    if (pricingMode === "packages" && (toMoney(halfDayPrice) <= 0 || toMoney(fullDayPrice) <= 0)) {
      setErr("Укажите цены неполного и полного дня");
      return;
    }
    setErr("");
    if (!category) return;
    try {
      const citySlug =
        Array.isArray(profile?.city_slugs) && profile.city_slugs.length === 1
          ? profile.city_slugs[0]
          : undefined;

      const body = {
        category,
        title: title || null,
        price: toMoney(price),
        currency: currency || currencyDefault || "USD",
        vehicle_model: vehicleModel.trim() || null,
        details: {
          ...(citySlug ? { city_slug: citySlug } : {}),
          ...(Number(seats) > 0 ? { seats: Number(seats) } : {}),
          pricing_mode: pricingMode,
          minimum_hours: Math.max(1, Number(minimumHours) || 1),
          ...(pricingMode === "packages" ? {
            half_day_hours: Math.max(1, Number(halfDayHours) || 4),
            half_day_price: toMoney(halfDayPrice),
            full_day_hours: Math.max(1, Number(fullDayHours) || 8),
            full_day_price: toMoney(fullDayPrice),
            extra_hour_price: toMoney(extraHourPrice),
          } : {}),
        },
      };

      const created = await fetchJSON(`/api/providers/${pid}/services`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setRows((m) => [created, ...m]);
      setTitle("");
      setPrice("");
      setSeats("");
      setVehicleModel("");
      setPricingMode("fixed");
      setHalfDayPrice("");
      setFullDayPrice("");
      setExtraHourPrice("");
      tSuccess(
        TT("service_added", "Услуга добавлена", "Xizmat qo‘shildi", "Service added")
      );
    } catch (e) {
      tError(
        TT("add_error", "Ошибка добавления", "Qo‘shishda xatolik", "Add error") +
          ": " +
          e.message
      );
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
      tError(
        TT(
          "update_error",
          "Ошибка обновления",
          "Yangilashda xatolik",
          "Update error"
        ) + ": " + e.message
      );
      load();
    }
  }

  async function toggleActive(row) {
    await patchRow(row.id, { is_active: !row.is_active });
  }

  async function removeRow(id) {
    if (
      !confirm(
        TT(
          "ps.confirm.delete",
          "Удалить услугу?",
          "Xizmat o‘chirilsinmi?",
          "Delete this service?"
        )
      )
    )
      return;
    try {
      await fetchJSON(`/api/providers/${pid}/services/${id}`, {
        method: "DELETE",
      });
      setRows((m) => m.filter((r) => r.id !== id));
      tSuccess(
        TT(
          "service_deleted",
          "Услуга удалена",
          "Xizmat o‘chirildi",
          "Service deleted"
        )
      );
    } catch (e) {
      tError(
        TT(
          "delete_error",
          "Ошибка удаления",
          "O‘chirishda xatolik",
          "Delete error"
        ) + ": " + e.message
      );
    }
  }

  async function bulkGenerateFromProfile() {
    setBulkBusy(true);
    try {
      const me = await fetchJSON(`/api/providers/profile`);
      const cities = Array.isArray(me?.city_slugs) ? me.city_slugs : [];
      const fleet = Array.isArray(me?.car_fleet) ? me.car_fleet : [];

      if (!cities.length) {
        tError(
          TT(
            "ps.error.no_cities",
            'Сначала заполните "Регион деятельности" в профиле.',
            "Avval profilda “Faoliyat hududi”ni to‘ldiring.",
            "Please fill “Region of activity” in your profile first."
          )
        );
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
            vehicle_model: model || null,
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
        tInfo(
          TT(
            "ps.error.nothing_to_generate",
            "Не из чего генерировать: добавьте города и/или автомобили в профиле.",
            "Hech narsa yaratib bo‘lmaydi: profilga shaharlar va/yoki avtomobillar qo‘shing.",
            "Nothing to generate: add cities and/or cars in your profile."
          )
        );
        setBulkBusy(false);
        return;
      }

      if (
        !confirm(
          TT(
            "ps.confirm.bulk",
            `Будут добавлены ${items.length} услуг(и). Цены = 0 — заполните после создания. Продолжить?`,
            `${items.length} ta xizmat qo‘shiladi. Narxlar = 0 — keyin to‘ldiring. Davom etamizmi?`,
            `${items.length} services will be created. Prices = 0 — fill them after creation. Continue?`
          )
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
      tSuccess(
        TT(
          "ps.bulk_done",
          "Услуги сгенерированы",
          "Xizmatlar yaratildi",
          "Services generated"
        )
      );
    } catch (e) {
      tError(
        TT(
          "ps.error.bulk",
          "Ошибка пакетного создания",
          "Paket yaratish xatosi",
          "Bulk create error"
        ) + ": " + e.message
      );
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-x-hidden">
      <div className="p-4 border-b flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold flex-1 min-w-[240px] break-normal whitespace-normal [text-wrap:balance]">
          {TT("ps.title", "Услуги", "Xizmatlar", "Services")}
        </h2>

        {/* кнопки справа */}
        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
          <button
            className="h-9 px-3 rounded border text-sm hover:bg-gray-50"
            onClick={load}
            disabled={loading}
          >
            {TT("ps.btn.refresh", "Обновить", "Yangilash", "Refresh")}
          </button>
          <button
            className="h-9 px-3 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-60"
            onClick={bulkGenerateFromProfile}
            disabled={bulkBusy}
            title={TT(
              "ps.btn.generate_hint",
              "Автогенерация по городам и авто из профиля",
              "Profil shahar/autolari bo‘yicha avto-yaratish",
              "Autogenerate by profile cities & cars"
            )}
          >
            {bulkBusy
              ? TT("ps.btn.generating", "Генерируем…", "Yaratilmoqda…", "Generating…")
              : TT(
                  "ps.btn.generate_from_profile",
                  "Сгенерировать из профиля",
                  "Profil asosida yaratish",
                  "Generate from profile"
                )}
          </button>
        </div>
      </div>

      {/* add form */}
      <div
        className="p-4 grid gap-3 min-w-0
                      sm:grid-cols-2
                      md:grid-cols-[minmax(180px,240px)_minmax(160px,1fr)_minmax(90px,120px)_minmax(160px,240px)_minmax(180px,360px)_auto]
                      items-center"
      >
        <div>
          <label className="block text-xs text-gray-600 mb-1">
            {TT("ps.form.category", "Категория", "Toifa", "Category")}
          </label>
          <select
            className="w-full h-9 border rounded px-2 text-sm min-w-0"
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
            {TT("ps.form.name_opt", "Название (опц.)", "Nomi (ixtiyoriy)", "Name (opt.)")}
          </label>
          <input
            className="w-full h-9 border rounded px-2 text-sm min-w-0"
            placeholder={TT(
              "ps.form.name_optional_ph",
              "например, 4 часа или модель авто",
              "masalan, 4 soat yoki avtomobil modeli",
              "e.g., 4 hours or car model"
            )}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">
            {TT("ps.form.seats", "Мест", "Joylar", "Seats")}
          </label>
          <input
            className="w-full h-9 border rounded px-2 text-sm min-w-0"
            type="number"
            min={0}
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">
            {TT("ps.form.vehicle_model", "Модель авто", "Avtomobil modeli", "Vehicle model")}
          </label>
          <input
            className="w-full h-9 border rounded px-2 text-sm min-w-0"
            placeholder={TT(
              "ps.form.vehicle_model_ph",
              "напр., Hyundai Staria",
              "masalan, Hyundai Staria",
              "e.g., Hyundai Staria"
            )}
            value={vehicleModel}
            onChange={(e) => setVehicleModel(e.target.value)}
          />
        </div>

        {/* цены и валюта */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 min-w-0">
          <div>
            <label className="block text-xs text-gray-600 mb-1">
              {TT("ps.form.price", "Цена", "Narx", "Price")}
            </label>
            <input
              className="w-full h-9 border rounded px-2 text-sm min-w-0"
              placeholder={TT(
                "ps.form.price_ph",
                "100, 120.50 …",
                "100, 120.50 …",
                "100, 120.50 …"
              )}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">
              {TT("ps.form.currency", "Валюта", "Valyuta", "Currency")}
            </label>
            <select
              className="h-9 border rounded px-2 text-sm"
              value={FORCE_CURRENCY}
              onChange={() => setCurrency(FORCE_CURRENCY)}
            >
              <option value="UZS">UZS</option>
              <option value="USD" disabled>
                USD
              </option>
              <option value="EUR" disabled>
                EUR
              </option>
            </select>
          </div>
        </div>



      </div>

      <div className="mx-4 mb-4 border-t border-slate-200 pt-4">
        <div className="mb-3">
          <h3 className="text-sm font-bold text-slate-950">Тариф по продолжительности</h3>
          <p className="text-xs text-slate-500">Tour Builder рассчитает стоимость по времени выбранного события.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-semibold text-slate-600">Тип тарифа
            <select className="mt-1 h-9 w-full rounded border px-2 text-sm" value={pricingMode} onChange={(e) => setPricingMode(e.target.value)}>
              <option value="fixed">Фиксированная цена</option>
              <option value="hourly">Почасовой</option>
              <option value="packages">Неполный / полный день</option>
            </select>
          </label>
          {pricingMode !== "fixed" && (
            <label className="text-xs font-semibold text-slate-600">Минимум часов
              <input type="number" min="1" className="mt-1 h-9 w-full rounded border px-2 text-sm" value={minimumHours} onChange={(e) => setMinimumHours(e.target.value)} />
            </label>
          )}
          {pricingMode === "hourly" && <div className="self-end pb-2 text-xs text-slate-500">Поле «Цена» выше считается стоимостью одного часа.</div>}
        </div>
        {pricingMode === "packages" && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="text-xs font-semibold text-slate-600">Неполный день, часов<input type="number" min="1" className="mt-1 h-9 w-full rounded border px-2 text-sm" value={halfDayHours} onChange={(e) => setHalfDayHours(e.target.value)} /></label>
            <label className="text-xs font-semibold text-slate-600">Цена неполного дня<input inputMode="decimal" className="mt-1 h-9 w-full rounded border px-2 text-sm" value={halfDayPrice} onChange={(e) => setHalfDayPrice(e.target.value)} /></label>
            <label className="text-xs font-semibold text-slate-600">Полный день, часов<input type="number" min="1" className="mt-1 h-9 w-full rounded border px-2 text-sm" value={fullDayHours} onChange={(e) => setFullDayHours(e.target.value)} /></label>
            <label className="text-xs font-semibold text-slate-600">Цена полного дня<input inputMode="decimal" className="mt-1 h-9 w-full rounded border px-2 text-sm" value={fullDayPrice} onChange={(e) => setFullDayPrice(e.target.value)} /></label>
            <label className="text-xs font-semibold text-slate-600">Дополнительный час<input inputMode="decimal" className="mt-1 h-9 w-full rounded border px-2 text-sm" value={extraHourPrice} onChange={(e) => setExtraHourPrice(e.target.value)} /></label>
          </div>
        )}`r`n        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={addOne}
            className="h-10 rounded bg-orange-600 px-5 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-60"
            disabled={!category}
          >
            {TT("ps.form.add", "Добавить услугу", "Xizmat qo‘shish", "Add service")}
          </button>
        </div>
      </div>

      {/* table */}
      <div className="px-4 pb-4">
        {err && (
          <div className="text-sm text-red-600 mb-2">
            {TT(
              "errors.data_load",
              "Не удалось загрузить данные",
              "Ma’lumotlarni yuklab bo‘lmadi",
              "Failed to load data"
            )}
            {": " + err}
          </div>
        )}

        <div className="overflow-x-auto max-w-full">
          <table className="w-full text-sm border rounded">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="text-left p-2 border-b">
                  {TT("ps.table.category", "Категория", "Toifa", "Category")}
                </th>
                <th className="text-left p-2 border-b">
                  {TT("ps.table.name", "Название", "Nomi", "Name")}
                </th>
                <th className="text-left p-2 border-b">
                  {TT("ps.table.seats", "Мест", "Joylar", "Seats")}
                </th>
                <th className="text-left p-2 border-b">
                  {TT(
                    "ps.table.vehicle_model",
                    "Модель авто",
                    "Avtomobil modeli",
                    "Vehicle model"
                  )}
                </th>
                <th className="text-left p-2 border-b">
                  {TT("ps.table.price", "Цена", "Narx", "Price")}
                </th>
                <th className="text-left p-2 border-b">Тариф</th>
                <th className="text-left p-2 border-b">
                  {TT("ps.table.currency", "Валюта", "Valyuta", "Currency")}
                </th>
                <th className="text-left p-2 border-b">
                  {TT("ps.table.status", "Статус", "Holat", "Status")}
                </th>
                <th className="text-right p-2 border-b">
                  {TT("ps.table.actions", "Действия", "Amallar", "Actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="p-3 text-gray-500" colSpan={9}>
                    {TT(
                      "common.loading",
                      "Загрузка…",
                      "Yuklanmoqda…",
                      "Loading…"
                    )}
                  </td>
                </tr>
              ) : rows.length ? (
                rows.map((r) => {
                  const seatsVal =
                    r.details && Number(r.details.seats) > 0
                      ? Number(r.details.seats)
                      : "";
                  const modelVal = r.vehicle_model || "";

                  return (
                    <tr key={r.id} className="odd:bg-white even:bg-gray-50">
                      <td className="p-2 align-middle">
                        {labelForCategory(r.category)}
                      </td>

                      <td className="p-2">
                        <input
                          className="w-full h-8 border rounded px-2"
                          value={r.title || ""}
                          placeholder={TT(
                            "ps.row.name_ph",
                            "Название…",
                            "Nomi…",
                            "Name…"
                          )}
                          onChange={(e) =>
                            setRows((m) =>
                              m.map((x) =>
                                x.id === r.id
                                  ? { ...x, title: e.target.value }
                                  : x
                              )
                            )
                          }
                          onBlur={(e) =>
                            patchRow(r.id, { title: e.target.value || null })
                          }
                        />
                      </td>

                      <td className="p-2">
                        <input
                          className="w-20 h-8 border rounded px-2"
                          type="number"
                          min={0}
                          value={seatsVal}
                          onChange={(e) => {
                            const v = e.target.value;
                            setRows((m) =>
                              m.map((x) =>
                                x.id === r.id
                                  ? {
                                      ...x,
                                      details: {
                                        ...(x.details || {}),
                                        seats:
                                          v === "" ? undefined : Number(v),
                                      },
                                    }
                                  : x
                              )
                            );
                          }}
                          onBlur={(e) => {
                            const n = Number(e.target.value);
                            const patch =
                              Number.isInteger(n) && n > 0
                                ? {
                                    details: {
                                      ...(r.details || {}),
                                      seats: n,
                                    },
                                  }
                                : {
                                    details: {
                                      ...(r.details || {}),
                                      seats: null,
                                    },
                                  };
                            patchRow(r.id, patch);
                          }}
                        />
                      </td>

                      <td className="p-2">
                        <input
                          className="w-44 h-8 border rounded px-2"
                          value={modelVal}
                          placeholder={TT(
                            "ps.row.vehicle_model_ph",
                            "напр., Hyundai Staria",
                            "masalan, Hyundai Staria",
                            "e.g., Hyundai Staria"
                          )}
                          onChange={(e) => {
                            const v = e.target.value;
                            setRows((m) =>
                              m.map((x) =>
                                x.id === r.id
                                  ? { ...x, vehicle_model: v }
                                  : x
                              )
                            );
                          }}
                          onBlur={(e) =>
                            patchRow(r.id, {
                              vehicle_model: e.target.value.trim() || null,
                            })
                          }
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
                          onBlur={(e) =>
                            patchRow(r.id, { price: toMoney(e.target.value) })
                          }
                        />
                      </td>

                      <td className="p-2 text-xs text-slate-600">
                        {r.details?.pricing_mode === "hourly"
                          ? `${r.price || 0} / час, минимум ${r.details?.minimum_hours || 1} ч.`
                          : r.details?.pricing_mode === "packages"
                            ? `${r.details?.half_day_hours || 4} ч. — ${r.details?.half_day_price || 0}; ${r.details?.full_day_hours || 8} ч. — ${r.details?.full_day_price || 0}`
                            : "За услугу"}
                      </td>

                      <td className="p-2">
                        <select
                          className="h-8 border rounded px-2"
                          value={"UZS"}
                          onChange={() => {
                            setRows((m) =>
                              m.map((x) =>
                                x.id === r.id
                                  ? { ...x, currency: "UZS" }
                                  : x
                              )
                            );
                          }}
                          onBlur={() => patchRow(r.id, { currency: "UZS" })}
                        >
                          <option value="UZS">UZS</option>
                          <option value="USD" disabled>
                            USD
                          </option>
                          <option value="EUR" disabled>
                            EUR
                          </option>
                        </select>
                      </td>

                      <td className="p-2">
                        {r.is_active ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            ●{" "}
                            {TT(
                              "ps.status.enabled",
                              "Включена",
                              "Yoqilgan",
                              "Enabled"
                            )}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-gray-500">
                            ●{" "}
                            {TT(
                              "ps.status.disabled",
                              "Выключена",
                              "O‘chirilgan",
                              "Disabled"
                            )}
                          </span>
                        )}
                      </td>

                      <td className="p-2 text-right">
                        <button
                          className="h-8 px-3 rounded border text-xs mr-2"
                          onClick={() => toggleActive(r)}
                        >
                          {r.is_active
                            ? TT(
                                "ps.row.disable",
                                "Выключить",
                                "O‘chirish",
                                "Disable"
                              )
                            : TT(
                                "ps.row.enable",
                                "Включить",
                                "Yoqish",
                                "Enable"
                              )}
                        </button>
                        <button
                          className="h-8 px-3 rounded border text-xs text-red-600 border-red-300 hover:bg-red-50"
                          onClick={() => removeRow(r.id)}
                        >
                          {TT(
                            "ps.row.delete",
                            "Удалить",
                            "O‘chirish",
                            "Delete"
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="p-3 text-gray-500" colSpan={9}>
                    {TT(
                      "ps.empty",
                      "Услуги не найдены. Добавьте хотя бы одну.",
                      "Xizmatlar topilmadi. Hech bo‘lmaganda bittasini qo‘shing.",
                      "No services yet. Please add one."
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-gray-500 mt-2">
          {TT(
            "ps.hint.zero_price",
            "Подсказка: услуги с ценой 0 TourBuilder не показывает. Заполните цены — и они сразу появятся в конструкторе.",
            "Maslahat: narxi 0 bo‘lgan xizmatlar TourBuilder’da ko‘rinmaydi. Narxlarni kiriting — va ular darhol konstruktorda paydo bo‘ladi.",
            "Tip: services priced 0 are hidden in TourBuilder. Fill in prices — they will appear in the builder right away."
          )}
        </p>
      </div>
    </div>
  );
}
