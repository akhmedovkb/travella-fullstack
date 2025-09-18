// frontend/src/pages/TourBuilder.jsx
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import AsyncSelect from "react-select/async";
import CreatableSelect from "react-select/creatable";

// ====== Локальные мок-справочники (самодостаточно) ======
const DEMO_TRANSPORTS = [
  { id: "bus20", name: "Микроавтобус (до 20 пax)", price_per_day: 180, currency: "USD" },
  { id: "sedan", name: "Седан", price_per_day: 70, currency: "USD" },
  { id: "coach40", name: "Большой автобус (40)", price_per_day: 320, currency: "USD" },
];
const DEMO_GUIDES = [
  { id: "ru-en", name: "Гид RU/EN", price_per_day: 90, currency: "USD" },
  { id: "uz-ru", name: "Гид UZ/RU", price_per_day: 70, currency: "USD" },
];

const DEMO_ENTRY_FEES = [
  // Пример: цены «за человека». В расчетах умножаются на ADT/CHD.
  { id: "registan", name: "Площадь «Регистан» — Самарканд", currency: "USD",
    wk_nrs_adult: 6, wk_nrs_child: 3, we_nrs_adult: 6, we_nrs_child: 3, hd_nrs_adult: 6, hd_nrs_child: 3,
    wk_res_adult: 4, wk_res_child: 2, we_res_adult: 4, we_res_child: 2, hd_res_adult: 4, hd_res_child: 2,
  },
  { id: "bukhara_ark", name: "Цитадель Арк — Бухара", currency: "USD",
    wk_nrs_adult: 5, wk_nrs_child: 2, we_nrs_adult: 5, we_nrs_child: 2, hd_nrs_adult: 5, hd_nrs_child: 2,
    wk_res_adult: 3, wk_res_child: 1, we_res_adult: 3, we_res_child: 1, hd_res_adult: 3, hd_res_child: 1,
  },
  { id: "khiva_itchan", name: "Ичан-Кала — Хива", currency: "USD",
    wk_nrs_adult: 7, wk_nrs_child: 3, we_nrs_adult: 7, we_nrs_child: 3, hd_nrs_adult: 7, hd_nrs_child: 3,
    wk_res_adult: 5, wk_res_child: 2, we_res_adult: 5, we_res_child: 2, hd_res_adult: 5, hd_res_child: 2,
  },
];

// ====== Утилиты ======
const INPUT = "h-9 px-3 py-1.5 border rounded w-full focus:outline-none focus:ring-2 focus:ring-orange-400";
const toNum = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const dayKey = (d) => {
  const date = new Date(d);
  const w = date.getDay();
  // 0-вс, 6-сб
  const kind = w === 0 || w === 6 ? "we" : "wk";
  // Для примера праздники не задаем — можно расширить.
  return kind;
};
const efCell = (row, kind, resident, paxKind) => {
  const k = `${kind}_${resident}_${paxKind}`; // wk_nrs_adult
  return toNum(row?.[k], 0);
};

// ====== Основной компонент ======
export default function TourBuilder() {
  const { t } = useTranslation();

  // PAX, валюта и налоги
  const [adt, setAdt] = useState(2);
  const [chd, setChd] = useState(0);
  const [inf, setInf] = useState(0);
  const payingPax = useMemo(() => Math.max(1, toNum(adt, 0) + toNum(chd, 0)), [adt, chd]);

  const [currency, setCurrency] = useState("USD");
  const [markupPct, setMarkupPct] = useState(0);
  const [vatPct, setVatPct] = useState(0);
  const [touristFeePerNight, setTouristFeePerNight] = useState(0);
  const [residentType, setResidentType] = useState("nrs"); // nrs | res

  // ====== Дни тура ======
  const [days, setDays] = useState([]); // [{id, date, services: {...}}]

  const addDay = () => {
    const id = crypto.randomUUID?.() || Math.random().toString(36).slice(2);
    setDays((p) => [
      ...p,
      {
        id,
        date: "",
        services: {
          transport: { enabled: false, itemId: null, customNet: 0 },
          guide: { enabled: false, itemId: null, customNet: 0 },
          meals: { breakfast: false, lunch: false, dinner: false, netPerPax: 0 }, // за человека в день
          entryFees: [], // [{value,label,raw}]
          extras: [], // произвольные айтемы [{id,label,net}]
          hotelNet: 0, // если хотите учитывать ночь этой даты
        },
      },
    ]);
  };

  const removeDay = (id) => setDays((p) => p.filter((d) => d.id !== id));

  const setDay = (id, updater) =>
    setDays((prev) => prev.map((d) => (d.id === id ? updater(d) : d)));

  // ====== источники для селектов (локально) ======
  const loadTransports = (input, cb) => {
    const q = (input || "").toLowerCase();
    const opts = DEMO_TRANSPORTS
      .filter((x) => x.name.toLowerCase().includes(q))
      .map((x) => ({ value: x.id, label: `${x.name} — ${x.price_per_day} ${x.currency}/day`, raw: x }));
    cb(opts);
  };
  const loadGuides = (input, cb) => {
    const q = (input || "").toLowerCase();
    const opts = DEMO_GUIDES
      .filter((x) => x.name.toLowerCase().includes(q))
      .map((x) => ({ value: x.id, label: `${x.name} — ${x.price_per_day} ${x.currency}/day`, raw: x }));
    cb(opts);
  };
  const loadEntryFees = (input, cb) => {
    const q = (input || "").toLowerCase();
    const opts = DEMO_ENTRY_FEES
      .filter((x) => x.name.toLowerCase().includes(q))
      .map((x) => ({ value: x.id, label: `${x.name} (${x.currency})`, raw: x }));
    cb(opts);
  };

  // ====== Расчет стоимостей ======
  const calcDayNet = (d) => {
    const { services, date } = d;
    let sum = 0;

    // Transport (фикс в день)
    if (services.transport.enabled) {
      if (services.transport.itemId) {
        const r = DEMO_TRANSPORTS.find((x) => x.id === services.transport.itemId);
        sum += toNum(r?.price_per_day, 0);
      }
      sum += toNum(services.transport.customNet, 0);
    }

    // Guide (фикс в день)
    if (services.guide.enabled) {
      if (services.guide.itemId) {
        const r = DEMO_GUIDES.find((x) => x.id === services.guide.itemId);
        sum += toNum(r?.price_per_day, 0);
      }
      sum += toNum(services.guide.customNet, 0);
    }

    // Meals (перс/день)
    if (services.meals.netPerPax > 0) {
      const perPax = toNum(services.meals.netPerPax, 0);
      const mealsCount =
        (services.meals.breakfast ? 1 : 0) +
        (services.meals.lunch ? 1 : 0) +
        (services.meals.dinner ? 1 : 0);
      sum += perPax * mealsCount * payingPax;
    }

    // Entry fees (перс/день)
    if (services.entryFees?.length) {
      const ad = toNum(adt, 0);
      const ch = toNum(chd, 0);
      const kind = dayKey(date || new Date());
      services.entryFees.forEach((opt) => {
        const r = opt.raw;
        sum += ad * efCell(r, kind, residentType, "adult");
        sum += ch * efCell(r, kind, residentType, "child");
      });
    }

    // Доп. услуги (фикс)
    if (services.extras?.length) {
      services.extras.forEach((x) => (sum += toNum(x.net, 0)));
    }

    // Отель (если учитываете)
    sum += toNum(services.hotelNet, 0);

    return sum;
  };

  const netTotal = useMemo(
    () => days.reduce((acc, d) => acc + calcDayNet(d), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [days, adt, chd, residentType]
  );
  const grossBeforeVat = useMemo(() => netTotal * (1 + toNum(markupPct, 0) / 100), [netTotal, markupPct]);
  const vatAmount = useMemo(() => grossBeforeVat * (toNum(vatPct, 0) / 100), [grossBeforeVat, vatPct]);
  const touristFees = useMemo(() => toNum(touristFeePerNight, 0) * Math.max(0, days.length), [touristFeePerNight, days.length]);
  const grandTotal = useMemo(() => grossBeforeVat + vatAmount + touristFees, [grossBeforeVat, vatAmount, touristFees]);
  const pricePerPax = useMemo(() => grandTotal / payingPax, [grandTotal, payingPax]);

  // ====== Рендер ======
  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto bg-white rounded-xl shadow border p-4 md:p-6 space-y-6">

        {/* Header / Actions */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-bold">
            {t("tourBuilder.title", { defaultValue: "Конструктор тура (по дням)" })}
          </h1>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={addDay} className="px-3 py-2 rounded bg-gray-800 text-white hover:bg-gray-900">
              {t("tb.add_day", { defaultValue: "Добавить день" })}
            </button>
          </div>
        </div>

        {/* PAX / currency */}
        <div className="grid md:grid-cols-5 gap-3">
          <div className="bg-gray-50 border rounded p-3">
            <div className="text-sm font-medium mb-2">{t("tb.pax", { defaultValue: "Гости (PAX)" })}</div>
            <div className="grid grid-cols-3 gap-2">
              <label className="text-sm flex flex-col gap-1">
                <span>ADT</span>
                <input className={INPUT} type="number" min={0} value={adt} onChange={(e) => setAdt(e.target.value)} />
              </label>
              <label className="text-sm flex flex-col gap-1">
                <span>CHD</span>
                <input className={INPUT} type="number" min={0} value={chd} onChange={(e) => setChd(e.target.value)} />
              </label>
              <label className="text-sm flex flex-col gap-1">
                <span>INF</span>
                <input className={INPUT} type="number" min={0} value={inf} onChange={(e) => setInf(e.target.value)} />
              </label>
            </div>
            <div className="flex items-center gap-3 text-sm mt-3">
              <span className="text-gray-600">{t("tb.tariff_for", { defaultValue: "Тарифы для:" })}</span>
              <label className="inline-flex items-center gap-1">
                <input type="radio" name="resident_type" value="nrs" checked={residentType === "nrs"} onChange={() => setResidentType("nrs")} />
                <span>{t("tb.nonresidents", { defaultValue: "Нерезиденты" })}</span>
              </label>
              <label className="inline-flex items-center gap-1">
                <input type="radio" name="resident_type" value="res" checked={residentType === "res"} onChange={() => setResidentType("res")} />
                <span>{t("tb.residents", { defaultValue: "Резиденты" })}</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">{t("tb.currency", { defaultValue: "Валюта" })}</label>
            <select className={INPUT} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="USD">USD</option>
              <option value="UZS">UZS</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("tb.markup", { defaultValue: "Наценка, %" })}</label>
            <input className={INPUT} type="number" min={0} value={markupPct} onChange={(e) => setMarkupPct(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">VAT, %</label>
            <input className={INPUT} type="number" min={0} value={vatPct} onChange={(e) => setVatPct(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("tb.tourist_fee", { defaultValue: "Туристический сбор / ночь" })}</label>
            <input className={INPUT} type="number" min={0} value={touristFeePerNight} onChange={(e) => setTouristFeePerNight(e.target.value)} />
          </div>
        </div>

        {/* Список дней */}
        <div className="space-y-4">
          {days.map((d, idx) => (
            <div key={d.id} className="border rounded-lg p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-lg font-semibold">D{idx + 1}</div>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    className={INPUT}
                    value={d.date || ""}
                    onChange={(e) => setDay(d.id, (cur) => ({ ...cur, date: e.target.value }))}
                  />
                  <button onClick={() => removeDay(d.id)} className="px-3 py-2 text-sm rounded border hover:bg-gray-50">
                    {t("common.remove", { defaultValue: "Удалить день" })}
                  </button>
                </div>
              </div>

              {/* Сервисы дня */}
              <div className="grid md:grid-cols-2 gap-4 mt-3">

                {/* Transport */}
                <div className="border rounded p-3">
                  <label className="inline-flex items-center gap-2 font-medium">
                    <input
                      type="checkbox"
                      checked={d.services.transport.enabled}
                      onChange={(e) =>
                        setDay(d.id, (cur) => ({
                          ...cur,
                          services: { ...cur.services, transport: { ...cur.services.transport, enabled: e.target.checked } },
                        }))
                      }
                    />
                    <span>{t("tourBuilder.transport", { defaultValue: "Транспорт" })}</span>
                  </label>
                  {d.services.transport.enabled && (
                    <div className="mt-2 space-y-2">
                      <AsyncSelect
                        cacheOptions
                        defaultOptions
                        loadOptions={loadTransports}
                        classNamePrefix="select"
                        placeholder={t("tb.pick_transport", { defaultValue: "Выберите транспорт" })}
                        value={
                          d.services.transport.itemId
                            ? {
                                value: d.services.transport.itemId,
                                label:
                                  DEMO_TRANSPORTS.find((x) => x.id === d.services.transport.itemId)?.name || "",
                              }
                            : null
                        }
                        onChange={(opt) =>
                          setDay(d.id, (cur) => ({
                            ...cur,
                            services: { ...cur.services, transport: { ...cur.services.transport, itemId: opt?.value || null } },
                          }))
                        }
                      />
                      <div className="grid grid-cols-[1fr_120px] gap-2 items-center">
                        <span className="text-sm text-gray-600">{t("tb.extra", { defaultValue: "Доплата (нетто/день)" })}</span>
                        <input
                          className={INPUT}
                          type="number"
                          min={0}
                          value={d.services.transport.customNet}
                          onChange={(e) =>
                            setDay(d.id, (cur) => ({
                              ...cur,
                              services: { ...cur.services, transport: { ...cur.services.transport, customNet: e.target.value } },
                            }))
                          }
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Guide */}
                <div className="border rounded p-3">
                  <label className="inline-flex items-center gap-2 font-medium">
                    <input
                      type="checkbox"
                      checked={d.services.guide.enabled}
                      onChange={(e) =>
                        setDay(d.id, (cur) => ({
                          ...cur,
                          services: { ...cur.services, guide: { ...cur.services.guide, enabled: e.target.checked } },
                        }))
                      }
                    />
                    <span>{t("tourBuilder.guide", { defaultValue: "Гид" })}</span>
                  </label>
                  {d.services.guide.enabled && (
                    <div className="mt-2 space-y-2">
                      <AsyncSelect
                        cacheOptions
                        defaultOptions
                        loadOptions={loadGuides}
                        classNamePrefix="select"
                        placeholder={t("tb.pick_guide", { defaultValue: "Выберите гида" })}
                        value={
                          d.services.guide.itemId
                            ? {
                                value: d.services.guide.itemId,
                                label: DEMO_GUIDES.find((x) => x.id === d.services.guide.itemId)?.name || "",
                              }
                            : null
                        }
                        onChange={(opt) =>
                          setDay(d.id, (cur) => ({
                            ...cur,
                            services: { ...cur.services, guide: { ...cur.services.guide, itemId: opt?.value || null } },
                          }))
                        }
                      />
                      <div className="grid grid-cols-[1fr_120px] gap-2 items-center">
                        <span className="text-sm text-gray-600">{t("tb.extra", { defaultValue: "Доплата (нетто/день)" })}</span>
                        <input
                          className={INPUT}
                          type="number"
                          min={0}
                          value={d.services.guide.customNet}
                          onChange={(e) =>
                            setDay(d.id, (cur) => ({
                              ...cur,
                              services: { ...cur.services, guide: { ...cur.services.guide, customNet: e.target.value } },
                            }))
                          }
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Meals */}
                <div className="border rounded p-3">
                  <div className="font-medium mb-2">{t("tb.meals", { defaultValue: "Питание" })}</div>
                  <div className="flex flex-wrap gap-4">
                    {["breakfast", "lunch", "dinner"].map((k) => (
                      <label key={k} className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!!d.services.meals[k]}
                          onChange={(e) =>
                            setDay(d.id, (cur) => ({
                              ...cur,
                              services: { ...cur.services, meals: { ...cur.services.meals, [k]: e.target.checked } },
                            }))
                          }
                        />
                        <span>
                          {k === "breakfast" ? t("tb.breakfast", { defaultValue: "Завтрак" }) :
                           k === "lunch" ? t("tb.lunch", { defaultValue: "Обед" }) :
                           t("tb.dinner", { defaultValue: "Ужин" })}
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="grid grid-cols-[1fr_160px] gap-2 items-center mt-2">
                    <span className="text-sm text-gray-600">
                      {t("tb.meals_price", { defaultValue: "Нетто на 1 pax за прием" })}
                    </span>
                    <input
                      className={INPUT}
                      type="number"
                      min={0}
                      value={d.services.meals.netPerPax}
                      onChange={(e) =>
                        setDay(d.id, (cur) => ({
                          ...cur,
                          services: { ...cur.services, meals: { ...cur.services.meals, netPerPax: e.target.value } },
                        }))
                      }
                    />
                  </div>
                </div>

                {/* Entry fees */}
                <div className="border rounded p-3">
                  <div className="font-medium mb-2">{t("tourBuilder.monuments", { defaultValue: "Входные билеты (объекты)" })}</div>
                  <AsyncSelect
                    isMulti
                    cacheOptions
                    defaultOptions
                    loadOptions={loadEntryFees}
                    classNamePrefix="select"
                    placeholder={t("tourBuilder.monuments_ph", { defaultValue: "Начните вводить объект…" })}
                    value={d.services.entryFees}
                    onChange={(vals) =>
                      setDay(d.id, (cur) => ({
                        ...cur,
                        services: { ...cur.services, entryFees: vals || [] },
                      }))
                    }
                    noOptionsMessage={() => t("common.nothing_found", { defaultValue: "Ничего не найдено" })}
                  />
                  <div className="text-xs text-gray-500 mt-2">
                    {t("tb.ef_hint", {
                      defaultValue:
                        "Цены считаются за человека на выбранный день с учетом ADT/CHD и статуса резидент/нерезидент.",
                    })}
                  </div>
                </div>

                {/* Доп. услуги */}
                <div className="border rounded p-3 md:col-span-2">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{t("tb.extras", { defaultValue: "Дополнительные услуги" })}</div>
                    <button
                      className="px-2 py-1 text-sm rounded border hover:bg-gray-50"
                      onClick={() =>
                        setDay(d.id, (cur) => ({
                          ...cur,
                          services: {
                            ...cur.services,
                            extras: [
                              ...(cur.services.extras || []),
                              {
                                id: crypto.randomUUID?.() || Math.random().toString(36).slice(2),
                                label: "",
                                net: 0,
                              },
                            ],
                          },
                        }))
                      }
                    >
                      {t("common.add", { defaultValue: "Добавить" })}
                    </button>
                  </div>

                  {(d.services.extras || []).length === 0 ? (
                    <div className="text-sm text-gray-500 mt-2">
                      {t("tb.no_extras", { defaultValue: "Нет позиций" })}
                    </div>
                  ) : (
                    <div className="space-y-2 mt-2">
                      {d.services.extras.map((x) => (
                        <div key={x.id} className="grid grid-cols-[1fr_140px_40px] gap-2">
                          <input
                            className={INPUT}
                            placeholder={t("tb.extra_name", { defaultValue: "Название" })}
                            value={x.label}
                            onChange={(e) =>
                              setDay(d.id, (cur) => ({
                                ...cur,
                                services: {
                                  ...cur.services,
                                  extras: cur.services.extras.map((y) =>
                                    y.id === x.id ? { ...y, label: e.target.value } : y
                                  ),
                                },
                              }))
                            }
                          />
                          <input
                            className={INPUT}
                            type="number"
                            min={0}
                            placeholder="0"
                            value={x.net}
                            onChange={(e) =>
                              setDay(d.id, (cur) => ({
                                ...cur,
                                services: {
                                  ...cur.services,
                                  extras: cur.services.extras.map((y) =>
                                    y.id === x.id ? { ...y, net: e.target.value } : y
                                  ),
                                },
                              }))
                            }
                          />
                          <button
                            className="border rounded hover:bg-gray-50"
                            onClick={() =>
                              setDay(d.id, (cur) => ({
                                ...cur,
                                services: {
                                  ...cur.services,
                                  extras: cur.services.extras.filter((y) => y.id !== x.id),
                                },
                              }))
                            }
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Итого за день */}
              <div className="mt-3 text-sm text-gray-700">
                <span className="font-medium">{t("tb.day_total", { defaultValue: "Итого за день" })}:</span>{" "}
                {calcDayNet(d).toFixed(2)} {currency}
              </div>
            </div>
          ))}
        </div>

        {/* Ценообразование / итог */}
        <div className="border rounded p-3">
          <h2 className="text-lg font-semibold mb-3">
            {t("tb.pricing", { defaultValue: "Ценообразование" })}
          </h2>

          <div className="grid md:grid-cols-5 gap-4 text-sm">
            <div className="bg-gray-50 rounded p-3 border">
              <div className="font-medium mb-2">{t("tb.pax", { defaultValue: "Гости (PAX)" })}</div>
              <div>ADT: {adt} • CHD: {chd} • INF: {inf}</div>
            </div>
            <div className="bg-gray-50 rounded p-3 border">
              <div className="font-medium mb-2">{t("tb.net", { defaultValue: "NET" })}</div>
              <div>{netTotal.toFixed(2)} {currency}</div>
            </div>
            <div className="bg-gray-50 rounded p-3 border">
              <div className="font-medium mb-2">{t("tb.subtotal", { defaultValue: "Subtotal (+Markup)" })}</div>
              <div>{grossBeforeVat.toFixed(2)} {currency}</div>
            </div>
            <div className="bg-gray-50 rounded p-3 border">
              <div className="font-medium mb-2">VAT</div>
              <div>{vatAmount.toFixed(2)} {currency}</div>
            </div>
            <div className="bg-gray-50 rounded p-3 border">
              <div className="font-medium mb-2">{t("tb.tourist_fees", { defaultValue: "Tourist fees" })}</div>
              <div>{touristFees.toFixed(2)} {currency}</div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4 mt-4 text-sm">
            <div className="bg-gray-100 rounded p-3 border flex justify-between">
              <span className="font-semibold">GRAND</span>
              <span className="font-semibold">{grandTotal.toFixed(2)} {currency}</span>
            </div>
            <div className="bg-gray-100 rounded p-3 border flex justify-between">
              <span>/ pax</span>
              <span>{pricePerPax.toFixed(2)} {currency}</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
