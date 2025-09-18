// frontend/src/pages/TourBuilder.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncSelect, { components as RS } from "react-select/async";
import CreatableSelect from "react-select/creatable";
import { useTranslation } from "react-i18next";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { ru as dfnsRu, enUS as dfnsEn, uz as dfnsUz } from "date-fns/locale";

/* =================== CONFIG =================== */
const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

/* =================== UTILS =================== */
const toNum = (v, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);
const pad2 = (n) => String(n).padStart(2, "0");
const toYMD = (d) =>
  d ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` : "";

const addDays = (d, n) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
};
const daysBetween = (a, b) => {
  if (!a || !b) return 0;
  const a0 = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const b0 = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.max(0, Math.round((b0 - a0) / 86400000) + 1); // включительно
};

const entryAuthHeaders = () => {
  const tok =
    localStorage.getItem("token") ||
    localStorage.getItem("providerToken") ||
    localStorage.getItem("clientToken");
  return tok ? { Authorization: `Bearer ${tok}` } : {};
};

const dkey = (d) => new Date(d).toISOString().slice(0, 10);
const HOLIDAYS = []; // заполняй при необходимости
const isWeekend = (d) => [0, 6].includes(new Date(d).getDay());
const isHoliday = (d) => HOLIDAYS.includes(dkey(d));
const dayKind = (d) => (isHoliday(d) ? "hd" : isWeekend(d) ? "we" : "wk");

/* =================== API HELPERS =================== */
const fetchJSON = async (path, params = {}) => {
  const base = API_BASE || window.frontend?.API_BASE || "";
  const u = new URL(path, base);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, v);
  });
  const r = await fetch(u.toString(), {
    credentials: "include",
    headers: { ...entryAuthHeaders() },
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
};
const safeItems = (x) =>
  Array.isArray(x?.items) ? x.items : Array.isArray(x) ? x : [];

/* --- cities (можешь заменить на свой источник) --- */
async function searchCities(q) {
  try {
    const d = await fetchJSON("/api/cities/search", { q, limit: 20 });
    return safeItems(d).map((c) => ({
      value: String(c.id ?? c.city_id ?? c._id ?? Math.random()),
      label: c.name_ru || c.name_en || c.title || c.name,
      cityId: c.id ?? c.city_id ?? c._id,
      country: c.country || c.country_name,
    }));
  } catch {}
  if (!q) return [];
  return [{ value: `fake_${q}`, label: q, cityId: `fake_${q}`, country: "" }];
}

/* --- providers: guide & transport из таблицы providers --- */
const providerToOption = (p) => ({
  value: String(p.id ?? p.provider_id ?? p._id ?? Math.random()),
  label: p.name || p.title || p.company || "—",
  raw: p,
  // цена дня
  price: toNum(p.price_per_day ?? p.day_price ?? p.price ?? p.rate_day ?? 0, 0),
  currency: p.currency || "USD",
  // чуть метаданных для превью
  meta: {
    type: p.type || p.kind, // guide|transport
    languages: p.languages || p.langs || p.language,
    vehicle: p.vehicle || p.car_class || p.transport,
    rating: p.rating,
    phone: p.phone || p.mobile,
    city: p.city || p.base_city,
    profile_url: p.profile_url || p.url || p.link,
    photo: p.photo || p.avatar,
  },
});

async function providersAvailable(type, dateYmd, cityId, q = "") {
  // 1) основной: /api/providers/available
  try {
    const d = await fetchJSON("/api/providers/available", {
      type,
      date: dateYmd,
      city_id: cityId,
      q,
      limit: 50,
    });
    return safeItems(d).map(providerToOption);
  } catch {}
  // 2) fallback: /api/providers/search?type=...&start_date=&end_date=&city_id=
  try {
    const d = await fetchJSON("/api/providers/search", {
      type,
      start_date: dateYmd,
      end_date: dateYmd,
      city_id: cityId,
      q,
      limit: 50,
    });
    return safeItems(d).map(providerToOption);
  } catch {}
  return [];
}

/* --- hotels & entry-fees --- */
async function searchHotels(dateYmd, cityId, q = "") {
  try {
    const d = await fetchJSON("/api/hotels/available", {
      date: dateYmd,
      city_id: cityId,
      q,
      limit: 50,
    });
    return safeItems(d).map((h) => ({
      value: String(h.id ?? h.hotel_id ?? h._id ?? Math.random()),
      label: `${h.name || h.title || "Hotel"}${h.city ? " — " + h.city : ""}`,
      raw: h,
      price: toNum(h.net ?? h.price ?? h.price_per_night ?? 0, 0),
      currency: h.currency || "USD",
    }));
  } catch {}
  return [];
}
async function searchEntryFees(q = "", cityId) {
  try {
    const d = await fetchJSON("/api/entry-fees", { q, city_id: cityId, limit: 50 });
    return safeItems(d).map((x) => ({
      value: x.id,
      label: `${x.name_ru || x.name_en || x.name_uz || "—"}${
        x.city ? " — " + x.city : ""
      } (${x.currency || "UZS"})`,
      raw: x,
    }));
  } catch {}
  return [];
}

/* --- memoized wrappers --- */
const memoizeAsync = (fn) => {
  const cache = new Map();
  return async (...args) => {
    const key = JSON.stringify(args);
    if (cache.has(key)) return cache.get(key);
    const p = fn(...args).catch((e) => {
      cache.delete(key);
      throw e;
    });
    cache.set(key, p);
    return p;
  };
};
const mSearchCities = memoizeAsync(searchCities);
const mProvidersAvailable = memoizeAsync(providersAvailable);
const mSearchHotels = memoizeAsync(searchHotels);
const mSearchEntryFees = memoizeAsync(searchEntryFees);

/* =================== HOVER PREVIEW (миникарточка) =================== */
function useHoverCard() {
  const [state, setState] = useState(null); // {x,y,content}
  const hide = () => setState(null);
  const show = (content, evt) => {
    const x = evt.clientX + 12;
    const y = evt.clientY + 12;
    setState({ x, y, content });
  };
  const Card = state ? (
    <div
      style={{
        position: "fixed",
        left: state.x,
        top: state.y,
        zIndex: 9999,
        maxWidth: 320,
      }}
      className="pointer-events-none bg-white border shadow-lg rounded-lg p-3 text-sm"
    >
      {state.content}
    </div>
  ) : null;
  return { Card, show, hide };
}

function ProviderOption({ data, innerProps, ...rest }) {
  // data.meta подготовлено в providerToOption
  const meta = data.meta || {};
  const preview = (
    <div>
      <div className="font-medium">{data.label}</div>
      <div className="text-xs text-gray-600">
        {meta.type ? `Тип: ${meta.type}` : ""}
        {meta.city ? ` • База: ${meta.city}` : ""}
      </div>
      {(meta.languages || meta.vehicle) && (
        <div className="text-xs mt-1">
          {meta.languages ? `Языки: ${Array.isArray(meta.languages) ? meta.languages.join(", ") : meta.languages}` : ""}
          {meta.languages && meta.vehicle ? " • " : ""}
          {meta.vehicle ? `Т/с: ${meta.vehicle}` : ""}
        </div>
      )}
      {(meta.rating || meta.phone) && (
        <div className="text-xs mt-1">
          {meta.rating ? `Рейтинг: ${meta.rating}` : ""}
          {meta.rating && meta.phone ? " • " : ""}
          {meta.phone ? `Тел: ${meta.phone}` : ""}
        </div>
      )}
      {typeof data.price === "number" && (
        <div className="mt-1 text-[13px]"><b>{data.price}</b> {data.currency || "USD"} / день</div>
      )}
      {meta.profile_url && (
        <div className="mt-2">
          <a href={meta.profile_url} target="_blank" rel="noreferrer" className="text-blue-600 underline">
            Открыть профиль
          </a>
        </div>
      )}
    </div>
  );

  // используем глобальный hover-card через контекст-поднятие (передадим show/hide через innerProps)
  const { onMouseEnter, onMouseLeave, ...restEvents } = innerProps;
  const show = rest.selectProps._hoverShow;
  const hide = rest.selectProps._hoverHide;

  return (
    <RS.Option
      {...rest}
      innerProps={{
        ...restEvents,
        onMouseEnter: (e) => {
          show && show(preview, e);
          onMouseEnter && onMouseEnter(e);
        },
        onMouseLeave: (e) => {
          hide && hide();
          onMouseLeave && onMouseLeave(e);
        },
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="truncate">{data.label}</div>
        <div className="flex items-center gap-2 text-xs shrink-0">
          {typeof data.price === "number" && (
            <span className="px-1.5 py-0.5 rounded bg-gray-100 border">
              {data.price} {data.currency || "USD"}
            </span>
          )}
          <span className="text-blue-600">ℹ</span>
        </div>
      </div>
    </RS.Option>
  );
}

/* =================== COMPONENT =================== */
export default function TourBuilder() {
  const { i18n, t } = useTranslation();
  const lang = (i18n.language || "ru").toLowerCase();
  const langBase = lang.startsWith("ru") ? "ru" : lang.startsWith("uz") ? "uz" : "en";
  const dfnsLocale = langBase === "ru" ? dfnsRu : langBase === "uz" ? dfnsUz : dfnsEn;

  /* ====== Даты тура ====== */
  const [range, setRange] = useState({ from: undefined, to: undefined });
  const dayCount = daysBetween(range.from, range.to);

  /* ====== PAX / резидент ====== */
  const [adt, setAdt] = useState(2);
  const [chd, setChd] = useState(0);
  const [inf, setInf] = useState(0);
  const [residentType, setResidentType] = useState("nrs");

  /* ====== Валюта/наценки ====== */
  const [currency, setCurrency] = useState("USD");
  const [markupPct, setMarkupPct] = useState(0);
  const [vatPct, setVatPct] = useState(0);
  const [touristFeePerNight, setTouristFeePerNight] = useState(0);

  /* ====== Дни ====== */
  const [daysData, setDaysData] = useState([]);

  useEffect(() => {
    if (!range.from || !range.to) {
      setDaysData([]);
      return;
    }
    const total = dayCount;
    const next = [];
    for (let i = 0; i < total; i++) {
      const date = addDays(range.from, i);
      const prev = daysData[i];
      next.push(
        prev && toYMD(new Date(prev.date)) === toYMD(date)
          ? prev
          : {
              id: `D${i + 1}`,
              date,
              city: null,
              transportEnabled: true,
              transportOption: null,
              transportSurcharge: 0,
              guideEnabled: true,
              guideOption: null,
              guideSurcharge: 0,
              mealBreakfast: false,
              mealLunch: false,
              mealDinner: false,
              mealPricePerPax: 0,
              entrySelected: [],
              hotelEnabled: true,
              hotelOption: null,
              hotelNet: 0,
              hotelNotes: "",
            }
      );
    }
    setDaysData(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, dayCount]);

  /* ====== loaders ====== */
  const loadCityOptions = useCallback(async (input, cb) => {
    const q = (input || "").trim();
    cb(q ? await mSearchCities(q) : []);
  }, []);

  const loadProviderOptionsFor = (day, type) => async (input, cb) => {
    const q = (input || "").trim();
    const cityId = day?.city?.cityId || day?.city?.value || "";
    const date = toYMD(day.date);
    const opts = await mProvidersAvailable(type, date, cityId, q);
    cb(opts);
  };

  const loadHotelOptionsFor = (day) => async (input, cb) => {
    const q = (input || "").trim();
    const cityId = day?.city?.cityId || day?.city?.value || "";
    const date = toYMD(day.date);
    cb(await mSearchHotels(date, cityId, q));
  };

  const loadEntryOptionsFor = (day) => async (input, cb) => {
    const q = (input || "").trim();
    const cityId = day?.city?.cityId || day?.city?.value || "";
    cb(await mSearchEntryFees(q, cityId));
  };

  const patchDay = (idx, patch) =>
    setDaysData((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));

  /* ====== расчёты ====== */
  const providersNet = useMemo(() => {
    let guide = 0;
    let transport = 0;
    daysData.forEach((d) => {
      if (d.guideEnabled && d.guideOption) guide += toNum(d.guideOption.price, 0) + toNum(d.guideSurcharge, 0);
      if (d.transportEnabled && d.transportOption)
        transport += toNum(d.transportOption.price, 0) + toNum(d.transportSurcharge, 0);
    });
    return { guide, transport, total: guide + transport };
  }, [daysData]);

  const mealsNet = useMemo(() => {
    const pax = Math.max(0, toNum(adt, 0) + toNum(chd, 0));
    let sum = 0;
    daysData.forEach((d) => {
      const count = (d.mealBreakfast ? 1 : 0) + (d.mealLunch ? 1 : 0) + (d.mealDinner ? 1 : 0);
      sum += count * toNum(d.mealPricePerPax, 0) * pax;
    });
    return sum;
  }, [daysData, adt, chd]);

  const entryCell = (raw, kind, paxType) => {
    const key = `${kind}_${residentType}_${paxType}`;
    const v = Number(raw?.[key] ?? 0);
    return Number.isFinite(v) ? v : 0;
  };
  const entryFeesNet = useMemo(() => {
    let sum = 0;
    const ad = toNum(adt, 0);
    const ch = toNum(chd, 0);
    daysData.forEach((d) => {
      if (!d.entrySelected?.length) return;
      const kind = dayKind(d.date);
      d.entrySelected.forEach((opt) => {
        const raw = opt.raw || {};
        sum += ad * entryCell(raw, kind, "adult");
        sum += ch * entryCell(raw, kind, "child");
      });
    });
    return sum;
  }, [daysData, adt, chd, residentType]);

  const hotelsNet = useMemo(
    () => daysData.reduce((acc, d) => acc + (d.hotelEnabled ? toNum(d.hotelNet, 0) : 0), 0),
    [daysData]
  );

  const netTotal = useMemo(
    () => providersNet.total + mealsNet + entryFeesNet + hotelsNet,
    [providersNet.total, mealsNet, entryFeesNet, hotelsNet]
  );
  const grossBeforeVat = useMemo(() => netTotal * (1 + toNum(markupPct, 0) / 100), [netTotal, markupPct]);
  const vatAmount = useMemo(() => grossBeforeVat * (toNum(vatPct, 0) / 100), [grossBeforeVat, vatPct]);
  const touristFees = useMemo(() => {
    const nights = daysData.filter((d) => d.hotelEnabled).length;
    return toNum(touristFeePerNight, 0) * Math.max(0, nights);
  }, [touristFeePerNight, daysData]);
  const grandTotal = useMemo(() => grossBeforeVat + vatAmount + touristFees, [grossBeforeVat, vatAmount, touristFees]);
  const payingPax = useMemo(() => Math.max(1, toNum(adt, 0) + toNum(chd, 0)), [adt, chd]);
  const pricePerPax = useMemo(() => grandTotal / payingPax, [grandTotal, payingPax]);

  /* ====== hover-card контент (один на страницу) ====== */
  const { Card: HoverCard, show: hoverShow, hide: hoverHide } = useHoverCard();

  /* =================== RENDER =================== */
  return (
    <div className="p-6">
      {HoverCard}
      <div className="max-w-7xl mx-auto bg-white rounded-xl shadow border p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-bold">{t("tourBuilder.title", { defaultValue: "Конструктор тура" })}</h1>
          <div className="flex gap-2 flex-wrap">
            <button className="px-3 py-2 rounded border" onClick={() => setDaysData([])}>
              {t("common.clear", { defaultValue: "Очистить" })}
            </button>
          </div>
        </div>

        {/* Даты тура */}
        <div>
          <label className="block text-sm font-medium mb-1">
            {t("tourBuilder.dates", { defaultValue: "Даты тура" })}
          </label>
          <div className="grid md:grid-cols-[1fr_auto] gap-4">
            <DayPicker
              mode="range"
              selected={range}
              onSelect={setRange}
              ISOWeek
              numberOfMonths={2}
              disabled={{ before: new Date() }}
              className="text-sm"
              locale={dfnsLocale}
            />
            <div className="text-sm space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <label className="flex items-center gap-2">
                  <span className="w-10">ADT</span>
                  <input className="border rounded px-2 py-1 h-9 w-full" type="number" min={0} value={adt} onChange={(e) => setAdt(e.target.value)} />
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-10">CHD</span>
                  <input className="border rounded px-2 py-1 h-9 w-full" type="number" min={0} value={chd} onChange={(e) => setChd(e.target.value)} />
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-10">INF</span>
                  <input className="border rounded px-2 py-1 h-9 w-full" type="number" min={0} value={inf} onChange={(e) => setInf(e.target.value)} />
                </label>
              </div>

              <div className="flex items-center gap-4">
                <span className="text-gray-700">{t("tb.tariff_for", { defaultValue: "Тарифы для:" })}</span>
                <label className="inline-flex items-center gap-1">
                  <input type="radio" name="resident_type" value="nrs" checked={residentType === "nrs"} onChange={() => setResidentType("nrs")} />
                  <span>{t("tb.nonresidents", { defaultValue: "Нерезиденты" })}</span>
                </label>
                <label className="inline-flex items-center gap-1">
                  <input type="radio" name="resident_type" value="res" checked={residentType === "res"} onChange={() => setResidentType("res")} />
                  <span>{t("tb.residents", { defaultValue: "Резиденты" })}</span>
                </label>
              </div>

              <p className="text-gray-500">
                {range.from && range.to
                  ? `${toYMD(range.from)} — ${toYMD(range.to)} • ${dayCount} ${t("days", { defaultValue: "дн." })}`
                  : t("pick_dates", { defaultValue: "Выберите даты начала и конца" })}
              </p>
            </div>
          </div>
        </div>

        {/* Дни */}
        <div className="space-y-4">
          {daysData.map((d, idx) => (
            <div key={d.id} className="rounded-xl border shadow-sm">
              {/* header day */}
              <div className="px-4 py-3 border-b flex items-center gap-3 flex-wrap">
                <div className="text-lg font-semibold min-w-[52px]">D{idx + 1}</div>

                <div className="min-w-[220px] flex-1">
                  <AsyncSelect
                    cacheOptions
                    defaultOptions
                    classNamePrefix="select"
                    placeholder={t("city", { defaultValue: "Город" })}
                    loadOptions={loadCityOptions}
                    value={d.city}
                    onChange={(opt) =>
                      patchDay(idx, {
                        city: opt,
                        transportOption: null,
                        guideOption: null,
                        hotelOption: null,
                      })
                    }
                  />
                </div>

                <input
                  type="date"
                  className="border rounded px-2 py-1 h-9"
                  value={toYMD(d.date)}
                  onChange={(e) => patchDay(idx, { date: new Date(e.target.value) })}
                />

                <button className="ml-auto text-red-600 hover:underline" onClick={() => setDaysData((prev) => prev.filter((_, i) => i !== idx))}>
                  {t("common.remove_day", { defaultValue: "Удалить день" })}
                </button>
              </div>

              {/* body */}
              <div className="grid lg:grid-cols-2 gap-4 p-4">
                {/* Транспорт (providers) */}
                <div className="border rounded">
                  <div className="px-3 py-2 border-b flex items-center gap-2">
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={d.transportEnabled} onChange={(e) => patchDay(idx, { transportEnabled: e.target.checked })} />
                      <span className="font-medium">{t("tourBuilder.transport", { defaultValue: "Транспорт" })}</span>
                    </label>
                  </div>
                  <div className="p-3 space-y-2">
                    <AsyncSelect
                      isDisabled={!d.transportEnabled}
                      cacheOptions
                      defaultOptions
                      classNamePrefix="select"
                      placeholder={t("select_transport", { defaultValue: "Выберите транспорт" })}
                      loadOptions={loadProviderOptionsFor(d, "transport")}
                      value={d.transportOption}
                      onChange={(opt) => patchDay(idx, { transportOption: opt })}
                      components={{ Option: ProviderOption }}
                      _hoverShow={hoverShow}
                      _hoverHide={hoverHide}
                    />
                    <label className="text-sm flex items-center gap-2">
                      <span className="whitespace-nowrap">{t("surcharge_day", { defaultValue: "Доплата (нетто/день)" })}</span>
                      <input
                        className="border rounded px-2 py-1 h-9 w-32"
                        type="number"
                        min={0}
                        value={d.transportSurcharge}
                        onChange={(e) => patchDay(idx, { transportSurcharge: e.target.value })}
                      />
                    </label>
                  </div>
                </div>

                {/* Гид (providers) */}
                <div className="border rounded">
                  <div className="px-3 py-2 border-b flex items-center gap-2">
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={d.guideEnabled} onChange={(e) => patchDay(idx, { guideEnabled: e.target.checked })} />
                      <span className="font-medium">{t("tourBuilder.guide", { defaultValue: "Гид" })}</span>
                    </label>
                  </div>
                  <div className="p-3 space-y-2">
                    <AsyncSelect
                      isDisabled={!d.guideEnabled}
                      cacheOptions
                      defaultOptions
                      classNamePrefix="select"
                      placeholder={t("select_guide", { defaultValue: "Выберите гида" })}
                      loadOptions={loadProviderOptionsFor(d, "guide")}
                      value={d.guideOption}
                      onChange={(opt) => patchDay(idx, { guideOption: opt })}
                      components={{ Option: ProviderOption }}
                      _hoverShow={hoverShow}
                      _hoverHide={hoverHide}
                    />
                    <label className="text-sm flex items-center gap-2">
                      <span className="whitespace-nowrap">{t("surcharge_day", { defaultValue: "Доплата (нетто/день)" })}</span>
                      <input
                        className="border rounded px-2 py-1 h-9 w-32"
                        type="number"
                        min={0}
                        value={d.guideSurcharge}
                        onChange={(e) => patchDay(idx, { guideSurcharge: e.target.value })}
                      />
                    </label>
                  </div>
                </div>

                {/* Питание */}
                <div className="border rounded">
                  <div className="px-3 py-2 border-b font-medium">{t("tourBuilder.meals", { defaultValue: "Питание" })}</div>
                  <div className="p-3 space-y-2">
                    <div className="flex items-center gap-6 text-sm">
                      <label className="inline-flex items-center gap-2">
                        <input type="checkbox" checked={d.mealBreakfast} onChange={(e) => patchDay(idx, { mealBreakfast: e.target.checked })} />
                        <span>{t("breakfast", { defaultValue: "Завтрак" })}</span>
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input type="checkbox" checked={d.mealLunch} onChange={(e) => patchDay(idx, { mealLunch: e.target.checked })} />
                        <span>{t("lunch", { defaultValue: "Обед" })}</span>
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input type="checkbox" checked={d.mealDinner} onChange={(e) => patchDay(idx, { mealDinner: e.target.checked })} />
                        <span>{t("dinner", { defaultValue: "Ужин" })}</span>
                      </label>
                    </div>
                    <label className="text-sm flex items-center gap-2">
                      <span className="whitespace-nowrap">{t("price_per_meal_pax", { defaultValue: "Нетто на 1 pax за приём" })}</span>
                      <input
                        className="border rounded px-2 py-1 h-9 w-32"
                        type="number"
                        min={0}
                        value={d.mealPricePerPax}
                        onChange={(e) => patchDay(idx, { mealPricePerPax: e.target.value })}
                      />
                    </label>
                  </div>
                </div>

                {/* Entry fees */}
                <div className="border rounded">
                  <div className="px-3 py-2 border-b font-medium">
                    {t("tourBuilder.monuments", { defaultValue: "Входные билеты (объекты)" })}
                  </div>
                  <div className="p-3 space-y-2">
                    <AsyncSelect
                      isMulti
                      cacheOptions
                      defaultOptions
                      classNamePrefix="select"
                      placeholder={t("tourBuilder.monuments_ph", { defaultValue: "Начните вводить объект/город…" })}
                      loadOptions={loadEntryOptionsFor(d)}
                      value={d.entrySelected}
                      onChange={(vals) => patchDay(idx, { entrySelected: vals || [] })}
                      noOptionsMessage={() => t("common.nothing_found", { defaultValue: "Ничего не найдено" })}
                    />
                    <div className="text-xs text-gray-500">
                      {t("entry_calc_hint", {
                        defaultValue:
                          "Цены считаются за человека на выбранный день с учётом ADT/CHD и статуса резидент/нерезидент.",
                      })}
                    </div>
                  </div>
                </div>

                {/* Отель */}
                <div className="border rounded lg:col-span-2">
                  <div className="px-3 py-2 border-b flex items-center gap-2">
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={d.hotelEnabled} onChange={(e) => patchDay(idx, { hotelEnabled: e.target.checked })} />
                      <span className="font-medium">{t("hotel", { defaultValue: "Отель" })}</span>
                    </label>
                    <span className="text-xs text-gray-500">
                      {t("hotel_note", { defaultValue: "Подтягивается по городу и дате. Цена — за ночь (нетто)." })}
                    </span>
                  </div>
                  <div className="p-3 grid md:grid-cols-3 gap-3">
                    <div className="md:col-span-2">
                      <AsyncSelect
                        isDisabled={!d.hotelEnabled}
                        cacheOptions
                        defaultOptions
                        classNamePrefix="select"
                        placeholder={t("select_hotel", { defaultValue: "Выберите отель" })}
                        loadOptions={loadHotelOptionsFor(d)}
                        value={d.hotelOption}
                        onChange={(opt) =>
                          patchDay(idx, {
                            hotelOption: opt,
                            hotelNet: opt?.price ?? d.hotelNet,
                          })
                        }
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm whitespace-nowrap">{t("tb.net", { defaultValue: "Нетто" })}</span>
                      <input
                        className="border rounded px-2 py-1 h-9 w-full"
                        type="number"
                        min={0}
                        value={d.hotelNet}
                        onChange={(e) => patchDay(idx, { hotelNet: e.target.value })}
                        disabled={!d.hotelEnabled}
                      />
                    </div>
                    <input
                      className="border rounded px-2 py-1 h-9 md:col-span-3"
                      type="text"
                      placeholder={t("tb.notes", { defaultValue: "Заметка" })}
                      value={d.hotelNotes}
                      onChange={(e) => patchDay(idx, { hotelNotes: e.target.value })}
                      disabled={!d.hotelEnabled}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Ценообразование */}
        <div className="border rounded p-3">
          <h2 className="text-lg font-semibold mb-3">{t("tb.pricing", { defaultValue: "Ценообразование" })}</h2>
          <div className="grid md:grid-cols-5 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">{t("tb.currency", { defaultValue: "Валюта" })}</label>
              <select className="border rounded px-2 py-2 w-full h-9" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option value="USD">USD</option>
                <option value="UZS">UZS</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("tb.markup", { defaultValue: "Наценка, %" })}</label>
              <input type="number" min={0} className="border rounded px-2 py-1 h-9 w-full" value={markupPct} onChange={(e) => setMarkupPct(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">VAT, %</label>
              <input type="number" min={0} className="border rounded px-2 py-1 h-9 w-full" value={vatPct} onChange={(e) => setVatPct(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                {t("tb.tourist_fee", { defaultValue: "Туристический сбор / ночь" })}
              </label>
              <input
                type="number"
                min={0}
                className="border rounded px-2 py-1 h-9 w-full"
                value={touristFeePerNight}
                onChange={(e) => setTouristFeePerNight(e.target.value)}
              />
            </div>
          </div>

          <div className="grid md:grid-cols-5 gap-4 mt-4 text-sm">
            <div className="bg-gray-50 rounded p-3 border">
              <div className="font-medium mb-2">{t("tb.pax", { defaultValue: "Гости (PAX)" })}</div>
              <div>ADT: {adt} • CHD: {chd} • INF: {inf}</div>
            </div>

            <div className="bg-gray-50 rounded p-3 border">
              <div className="font-medium mb-2">{t("tb.providers_cost", { defaultValue: "Гид/Транспорт (нетто)" })}</div>
              <div className="flex justify-between"><span>{t("tourBuilder.guide", { defaultValue: "Гид" })}</span><span>{providersNet.guide.toFixed(2)} {currency}</span></div>
              <div className="flex justify-between"><span>{t("tourBuilder.transport", { defaultValue: "Транспорт" })}</span><span>{providersNet.transport.toFixed(2)} {currency}</span></div>
            </div>

            <div className="bg-gray-50 rounded p-3 border">
              <div className="font-medium mb-2">{t("meals_net", { defaultValue: "Питание (нетто)" })}</div>
              <div>{mealsNet.toFixed(2)} {currency}</div>
            </div>

            <div className="bg-gray-50 rounded p-3 border">
              <div className="font-medium mb-2">{t("tb.entry_fees_net", { defaultValue: "Entry fees (нетто)" })}</div>
              <div>{entryFeesNet.toFixed(2)} {currency}</div>
            </div>

            <div className="bg-gray-50 rounded p-3 border">
              <div className="font-medium mb-2">{t("tb.hotels_cost", { defaultValue: "Отели (нетто)" })}</div>
              <div>{hotelsNet.toFixed(2)} {currency}</div>
            </div>

            <div className="bg-gray-50 rounded p-3 border md:col-span-5">
              <div className="font-medium mb-2">{t("tb.total", { defaultValue: "Суммарно" })}</div>
              <div className="flex flex-wrap gap-x-10 gap-y-1">
                <div>NET: <b>{netTotal.toFixed(2)} {currency}</b></div>
                <div>+ Markup ⇒ <b>{grossBeforeVat.toFixed(2)} {currency}</b></div>
                <div>+ VAT: <b>{vatAmount.toFixed(2)} {currency}</b></div>
                <div>+ Tourist fees: <b>{touristFees.toFixed(2)} {currency}</b></div>
                <div className="ml-auto">GRAND: <b>{grandTotal.toFixed(2)} {currency}</b></div>
                <div>/ pax: <b>{pricePerPax.toFixed(2)} {currency}</b></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
