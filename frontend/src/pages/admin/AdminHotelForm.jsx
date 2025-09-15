// frontend/src/pages/admin/AdminHotelForm.jsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
async function httpPut(path, body = {}, role) {
  try {
    const res = await axios.put(apiURL(path), body, {
      withCredentials: true,
      headers: { "Content-Type": "application/json", ...authHeaders(role) },
    });
    return res.data;
  } catch (e) { throw normErr(e); }
}
import { useTranslation } from "react-i18next";
import Select from "react-select";
import AsyncSelect from "react-select/async";
import AsyncCreatableSelect from "react-select/async-creatable";
import axios from "axios";

/* ==========================
   Локальные утилиты/клиент API
   ========================== */
const API_BASE = (import.meta?.env?.VITE_API_BASE_URL || "").replace(/\/+$/, "");
const apiURL = (path) => `${API_BASE}${path}`;

function getToken(role) {
  if (role === "provider") {
    return (
      localStorage.getItem("providerToken") ||
      localStorage.getItem("token") ||
      null
    );
  }
  if (role === "client" || role === true) {
    return localStorage.getItem("clientToken") || null;
  }
  return (
    localStorage.getItem("providerToken") ||
    localStorage.getItem("token") ||
    localStorage.getItem("clientToken") ||
    null
  );
}
function authHeaders(role) {
  const t = getToken(role);
  return t ? { Authorization: `Bearer ${t}` } : {};
}
function normErr(e) {
  const status = e?.response?.status;
  const message =
    e?.response?.data?.error ||
    e?.response?.data?.message ||
    e?.message ||
    "Request failed";
  const err = new Error(message);
  err.status = status;
  err.data = e?.response?.data;
  return err;
}
async function httpGet(path, { params, role } = {}) {
  try {
    const res = await axios.get(apiURL(path), {
      params,
      withCredentials: true,
      headers: authHeaders(role),
    });
    return res.data;
  } catch (e) {
    throw normErr(e);
  }
}
async function httpPost(path, body = {}, role) {
  try {
    const res = await axios.post(apiURL(path), body, {
      withCredentials: true,
      headers: { "Content-Type": "application/json", ...authHeaders(role) },
    });
    return res.data;
  } catch (e) {
    throw normErr(e);
  }
}

/* Публичный поиск отелей (локальная реализация) */
async function apiSearchHotels({ name = "", city = "", country = "", page = 1, limit = 50 } = {}) {
  const params = {
    name: name || "",
    city: city || "",
    country: country || "",
    page: String(page),
    limit: String(limit),
  };
  return httpGet("/api/hotels/search", { params });
}

/* Создать отель (локальная реализация) */
async function apiCreateHotel(payload) {
  return httpPost("/api/hotels", payload, "provider");
}

/* Простые тосты (fallback на alert) */
function tSuccess(msg) {
  try {
    // если в проекте есть тосты, можно заменить здесь
    // eslint-disable-next-line no-console
    console.log("✅", msg);
    alert(`✅ ${msg}`);
  } catch {
    // no-op
  }
}
function tError(msg) {
  try {
    // eslint-disable-next-line no-console
    console.error("❌", msg);
    alert(`❌ ${msg}`);
  } catch {
    // no-op
  }
}

/* Мини-бейдж статуса GeoNames (встроенный) */
function GeoNamesStatusBadge() {
  const enabled = !!import.meta.env.VITE_GEONAMES_USERNAME;
  return (
    <span
      className={`inline-flex items-center gap-2 px-2 py-1 rounded text-xs ${
        enabled ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
      }`}
      title={enabled ? "GeoNames автодополнение включено" : "GeoNames не настроен"}
    >
      <span
        className={`inline-block w-2 h-2 rounded-full ${
          enabled ? "bg-green-600" : "bg-red-600"
        }`}
      />
      {enabled ? "GeoNames: ON" : "GeoNames: OFF"}
    </span>
  );
}

/* ==========================
   Форма
   ========================== */

/* ---------- Room types ---------- */
const DEFAULT_ROOM_TYPES = [
  { id: "single",    name: "Single",     builtin: true },
  { id: "double",    name: "Double",     builtin: true },
  { id: "triple",    name: "Triple",     builtin: true },
  { id: "quadruple", name: "Quadruple",  builtin: true },
  { id: "suite",     name: "Suite",      builtin: true },
  { id: "family",    name: "Family",     builtin: true },
];

const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const numOrNull = (v) => (v === "" || v === null || v === undefined ? null : Number(v));

/* ---------- AsyncSelect i18n + debounce ---------- */
const makeAsyncSelectI18n = (t) => ({
  noOptionsMessage: ({ inputValue }) =>
    (inputValue || "").trim().length < 2
      ? t("select.type_more", { defaultValue: "Введите минимум 2 символа" })
      : t("select.no_options", { defaultValue: "Ничего не найдено" }),
  loadingMessage: () => t("select.loading", { defaultValue: "Загрузка…" }),
});

function useDebouncedLoader(asyncFn, delay = 400) {
  const timerRef = useRef(null);
  const ctrlRef = useRef(null);
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (ctrlRef.current) ctrlRef.current.abort?.();
  }, []);
  return useCallback(
    (inputValue) =>
      new Promise((resolve, reject) => {
        const text = (inputValue || "").trim();
        if (text.length < 2) {
          if (timerRef.current) clearTimeout(timerRef.current);
          if (ctrlRef.current) ctrlRef.current.abort?.();
          resolve([]);
          return;
        }
        if (timerRef.current) clearTimeout(timerRef.current);
        if (ctrlRef.current) ctrlRef.current.abort?.();
        const controller = new AbortController();
        ctrlRef.current = controller;
        timerRef.current = setTimeout(async () => {
          try {
            const out = await asyncFn(text, controller.signal);
            resolve(out);
          } catch (e) {
            if (e?.name === "AbortError" || e?.code === "ERR_CANCELED") {
              resolve([]);
              return;
            }
            reject(e);
          }
        }, delay);
      }),
    [asyncFn, delay]
  );
}

/* ---------- RU|UZ|EN язык для гео ---------- */
function useGeoLang(i18n) {
  return useMemo(() => {
    const allowed = ["ru", "uz", "en"];
    const fromI18n = (i18n?.language || "").slice(0, 2).toLowerCase();
    if (allowed.includes(fromI18n)) return fromI18n;
    const nav = (typeof navigator !== "undefined" ? (navigator.languages || [navigator.language]) : [])
      .filter(Boolean)
      .map((l) => String(l).slice(0, 2).toLowerCase());
    return nav.find((l) => allowed.includes(l)) || "en";
  }, [i18n?.language]);
}

/* ---------- dual label для подсказок отелей ---------- */
const composeDualLabel = (local, en) => {
  if (!local && !en) return "";
  if (!local) return en;
  if (!en) return local;
  return local.toLowerCase() === en.toLowerCase() ? local : `${local} / ${en}`;
};

export default function AdminHotelForm() {
  const { t, i18n } = useTranslation();
  const geoLang = useGeoLang(i18n);
  const navigate = useNavigate();
  const { id: hotelId } = useParams();

  // проставляем значения из записи отеля
  const fillFromHotel = (h) => {
    setName(h?.name || "");
    setAddress(h?.address || "");
    setCurrency(h?.currency || "UZS");
    setImages(Array.isArray(h?.images) ? h.images : []);
    setAmenities(Array.isArray(h?.amenities) ? h.amenities : []);
    setServices(Array.isArray(h?.services) ? h.services : []);
    setCountryOpt(h?.country ? { value: h.country, code: "", label: h.country } : null);
    setCityOpt(h?.city ? { value: h.city, label: h.city } : null);
    setExtraBedPrice(h?.extra_bed_price ?? h?.extraBedPrice ?? "");
    const taxes = h?.taxes || {};
    setVatIncluded(!!taxes.vatIncluded);
    setVatRate(taxes.vatRate ?? "");
    setTouristResident(taxes?.touristTax?.residentPerNight ?? "");
    setTouristNonResident(taxes?.touristTax?.nonResidentPerNight ?? "");

    const toMealSet = (s = {}) => ({
      BB: s.BB ?? "", HB: s.HB ?? "", FB: s.FB ?? "", AI: s.AI ?? "", UAI: s.UAI ?? "",
    });
    const byType = new Map();
    (Array.isArray(h?.rooms) ? h.rooms : []).forEach((r) => {
      const typeName = r?.type || "";
      const row = {
        id: slugify(typeName) || `custom-${Date.now()}`,
        name: typeName || "Room",
        builtin: !!DEFAULT_ROOM_TYPES.find(d => d.name === typeName),
        count: String(r?.count ?? ""),
        prices: {
          low: {
            resident: toMealSet(r?.prices?.low?.resident),
            nonResident: toMealSet(r?.prices?.low?.nonResident),
          },
          high: {
            resident: toMealSet(r?.prices?.high?.resident),
            nonResident: toMealSet(r?.prices?.high?.nonResident),
          },
        },
      };
      byType.set(row.id, row);
    });
    // сначала дефолтные, затем кастомные из БД
    const rows = DEFAULT_ROOM_TYPES.map(d => byType.get(d.id) || blankRow(d));
    for (const [k, v] of byType.entries()) {
      if (!rows.find(r => r.id === k)) rows.push(v);
    }
    setRoomRows(rows);
  };

  // при наличии :id грузим карточку
  useEffect(() => {
    if (!hotelId) return;
    (async () => {
      try {
        const data = await httpGet(`/api/hotels/${encodeURIComponent(hotelId)}`);
        fillFromHotel(data);
      } catch (e) {
        tError(t("load_error") || "Не удалось загрузить отель");
      }
    })();
  }, [hotelId]);

  // Основные поля
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [images, setImages] = useState([]);

  // Валюта единого прайса/сборов
  const [currency, setCurrency] = useState("UZS");

  // География
  const [countryOpt, setCountryOpt] = useState(null);
  const [cityOpt, setCityOpt] = useState(null);
  const [countryOptions, setCountryOptions] = useState([]);
  const [cityDefaultOptions, setCityDefaultOptions] = useState([]);

  // Удобства/услуги
  const [amenities, setAmenities] = useState([]);
  const [services, setServices] = useState([]);

  // Наборы питания: BB, HB, FB, AI, UAI
  const MEAL_PLANS = ["BB", "HB", "FB", "AI", "UAI"];
  const makeMealSet = () => ({ BB: "", HB: "", FB: "", AI: "", UAI: "" });

  // стили для ячеек по сезону (LR белый, HR бледно-серый)
  const tdCls = (season, extra = "") =>
    `px-2 py-1 ${season === "high" ? "bg-gray-50" : "bg-white"} ${extra}`;
  const inputCls = (season) =>
    `w-24 border rounded px-2 py-1 ${season === "high" ? "bg-gray-50" : "bg-white"}`;

  // Номера + сезонные цены
  const blankRow = (base) => ({
    ...base,
    count: "",
    prices: {
      low:  { resident: makeMealSet(), nonResident: makeMealSet() },
      high: { resident: makeMealSet(), nonResident: makeMealSet() },
    },
  });

  const [roomRows, setRoomRows] = useState(
    DEFAULT_ROOM_TYPES.map((r) => blankRow(r))
  );
  const [newTypeName, setNewTypeName] = useState("");

  // Доп. место
  const [extraBedPrice, setExtraBedPrice] = useState("");

  // Налоги и сборы
  const [vatIncluded, setVatIncluded] = useState(true);
  const [vatRate, setVatRate] = useState(""); // %
  const [touristResident, setTouristResident] = useState("");     // /чел/ночь
  const [touristNonResident, setTouristNonResident] = useState(""); // /чел/ночь

  /* ---------- Страны ---------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const username = import.meta.env.VITE_GEONAMES_USERNAME;
        let list = [];
        if (username) {
          const { data } = await axios.get("https://secure.geonames.org/countryInfoJSON", {
            params: { lang: geoLang, username }
          });
          list = (data?.geonames || []).map((c) => ({
            value: c.countryCode, code: c.countryCode, label: c.countryName,
          }));
        }
        if (!list.length) {
          const res = await axios.get("https://restcountries.com/v3.1/all?fields=name,cca2,translations");
          list = (res.data || []).map((c) => {
            const code = c.cca2;
            const label =
              (geoLang === "ru" && (c.translations?.rus?.common || c.name?.common)) ||
              (geoLang === "uz" && (c.translations?.uzb?.common || c.name?.common)) ||
              (c.name?.common || code);
            return { value: code, code, label };
          });
        }
        if (!alive) return;
        list.sort((a, b) => a.label.localeCompare(b.label, geoLang));
        setCountryOptions(list);
        if (countryOpt) {
          const found = list.find((x) => x.code === countryOpt.code);
          if (found) setCountryOpt(found);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("countries load error", e);
      }
    })();
    return () => { alive = false; };
  }, [geoLang]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Префетч городов для выбранной страны ---------- */
  useEffect(() => {
    const username = import.meta.env.VITE_GEONAMES_USERNAME;
    if (!username || !countryOpt?.code) { setCityDefaultOptions([]); return; }
    const ctrl = new AbortController();
    axios.get("https://secure.geonames.org/searchJSON", {
      params: {
        country: countryOpt.code,
        featureClass: "P",
        maxRows: 30,
        orderby: "population",
        lang: geoLang,
        username,
        style: "FULL",
      },
      signal: ctrl.signal,
    })
    .then(({ data }) => {
      const opts = (data?.geonames || []).map((g) => ({ value: g.name, label: g.name }));
      setCityDefaultOptions(opts);
    })
    .catch((e) => { if (e?.code !== "ERR_CANCELED") console.warn("prefetch cities error", e); });
    return () => ctrl.abort();
  }, [countryOpt?.code, geoLang]);

  /* ---------- Поиск городов (внутри страны) ---------- */
  const loadCitiesRaw = useCallback(async (inputValue, signal) => {
    if (!countryOpt?.code) return [];
    const username = import.meta.env.VITE_GEONAMES_USERNAME;
    if (!username) return [];
    try {
      const { data } = await axios.get("https://secure.geonames.org/searchJSON", {
        params: {
          country: countryOpt.code,
          featureClass: "P",
          name_startsWith: inputValue,
          q: inputValue,
          maxRows: 20,
          orderby: "population",
          fuzzy: 0.9,
          style: "FULL",
          lang: geoLang,
          username,
        },
        signal,
      });
      return (data?.geonames || []).map((g) => ({ value: g.name, label: g.name }));
    } catch (e) {
      if (e?.code === "ERR_CANCELED") return [];
      // eslint-disable-next-line no-console
      console.error("load cities error:", e);
      return [];
    }
  }, [countryOpt?.code, geoLang]);
  const loadCities = useDebouncedLoader(loadCitiesRaw, 400);

  const ASYNC_I18N = makeAsyncSelectI18n(t);
  const ASYNC_MENU_PORTAL = {
    menuPortalTarget: typeof document !== "undefined" ? document.body : null,
    styles: { menuPortal: (base) => ({ ...base, zIndex: 9999 }) },
  };

  /* ---------- Поиск названия отеля ---------- */
  const loadHotelOptionsRaw = useCallback(async (inputValue /*, signal */) => {
    const items = await apiSearchHotels({
      name: inputValue || "",
      city: cityOpt?.label || "",
      country: countryOpt?.code || "",
      limit: 50,
    });
    return (items || []).map((x) => {
      const title = x.label || x.name || String(x);
      const cityDual = x.city_en && x.city_local
        ? ` (${composeDualLabel(x.city_local, x.city_en)})`
        : x.city ? ` (${x.city})` : "";
      return { value: title, label: `${title}${cityDual}` };
    });
  }, [cityOpt?.label, countryOpt?.code]);
  const loadHotelOptions = useDebouncedLoader(loadHotelOptionsRaw, 400);

  /* ---------- Удобства/услуги ---------- */
  const handleAmenityAdd = (e) => {
    e.preventDefault();
    const val = e.target.elements.amen.value.trim();
    if (val && !amenities.includes(val)) setAmenities((p) => [...p, val]);
    e.target.reset();
  };
  const handleServiceAdd = (e) => {
    e.preventDefault();
    const val = e.target.elements.serv.value.trim();
    if (val && !services.includes(val)) setServices((p) => [...p, val]);
    e.target.reset();
  };
  const removeFrom = (arrSetter, idx) => arrSetter((p) => p.filter((_, i) => i !== idx));

  /* ---------- Фото ---------- */
  const onImagePick = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const readers = files.map(
      (f) =>
        new Promise((res) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.readAsDataURL(f);
        })
    );
    Promise.all(readers).then((list) => setImages((prev) => [...prev, ...list]));
    e.target.value = "";
  };

  /* ---------- Кастомные типы ---------- */
  const addCustomType = () => {
    const title = newTypeName.trim();
    if (!title) return;
    const idBase = slugify(title) || `custom-${Date.now()}`;
    let id = idBase;
    let i = 2;
    while (roomRows.some((r) => r.id === id)) id = `${idBase}-${i++}`;
    setRoomRows((rows) => [...rows, blankRow({ id, name: title, builtin: false })]);
    setNewTypeName("");
  };
  const removeRow = (id) => setRoomRows((rows) => rows.filter((r) => r.id !== id));
  const updateRow = (id, patch) =>
    setRoomRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const updateMealPrice = (id, season, personType, meal, value) =>
    setRoomRows((rows) =>
      rows.map((r) => {
        if (r.id !== id) return r;
        return {
          ...r,
          prices: {
            ...r.prices,
            [season]: {
              ...r.prices[season],
              [personType]: {
                ...r.prices[season][personType],
                [meal]: value,
              },
            },
          },
        };
      })
    );

  /* ---------- Submit ---------- */
  const submit = async () => {
    if (!name.trim())    return tError(t("enter_hotel_name") || "Введите название");
    if (!countryOpt)     return tError(t("select_country") || "Укажите страну");
    if (!address.trim()) return tError(t("enter_address") || "Укажите адрес");

    const normalizeMealSet = (set) =>
      MEAL_PLANS.reduce((acc, mp) => ({ ...acc, [mp]: numOrNull(set?.[mp]) }), {});

    const rooms = roomRows
      .map((r) => ({
        type: r.name,
        count: Number(r.count || 0),
        prices: {
          low: {
            resident:    normalizeMealSet(r.prices.low.resident),
            nonResident: normalizeMealSet(r.prices.low.nonResident),
          },
          high: {
            resident:    normalizeMealSet(r.prices.high.resident),
            nonResident: normalizeMealSet(r.prices.high.nonResident),
          },
        },
      }))
      .filter((x) => x.count > 0);

    const payload = {
      name: name.trim(),
      country: countryOpt?.label || "",
      city: cityOpt?.label || null,
      address: address.trim(),
      currency,
      rooms,
      extraBedPrice: numOrNull(extraBedPrice),
      taxes: {
        vatIncluded: !!vatIncluded,
        vatRate: numOrNull(vatRate), // %
        touristTax: {
          residentPerNight:    numOrNull(touristResident),
          nonResidentPerNight: numOrNull(touristNonResident),
        },
      },
      amenities,
      services,
      images,
    };

        try {
      if (hotelId) {
        await httpPut(`/api/hotels/${encodeURIComponent(hotelId)}`, payload, "provider");
        tSuccess(t("hotel_saved") || "Изменения сохранены");
        navigate(`/admin/hotels/${hotelId}/edit`);
      } else {
        const created = await apiCreateHotel(payload);
        tSuccess(t("hotel_saved") || "Отель сохранён");
        navigate(`/admin/hotels/${created?.id || ""}/edit`);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      tError(t("hotel_save_error") || "Ошибка сохранения отеля");
    }
  };

  /* ==================== UI ==================== */
  return (
    <div className="max-w-3xl mx-auto bg-white rounded-xl border shadow-sm p-5">
      <div className="mb-3"><GeoNamesStatusBadge /></div>
      <h1 className="text-2xl font-bold mb-4">
        {t("admin.new_hotel_title", { defaultValue: "Новый отель" })}
      </h1>

      {/* Базовая информация */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Название отеля */}
        <div className="col-span-2">
          <label className="block text-sm font-medium mb-1">
            {t("name", { defaultValue: "Название" })}
          </label>
          <AsyncCreatableSelect
            cacheOptions
            defaultOptions
            {...ASYNC_MENU_PORTAL}
            loadOptions={loadHotelOptions}
            noOptionsMessage={ASYNC_I18N.noOptionsMessage}
            loadingMessage={ASYNC_I18N.loadingMessage}
            placeholder={t("hotel.search_placeholder", { defaultValue: "Найдите отель или введите свой вариант…" })}
            value={name ? { value: name, label: name } : null}
            onChange={(opt) => setName(opt?.value || "")}
            onCreateOption={(input) => setName(input)}
            isClearable
          />
        </div>

        {/* Страна */}
        <div>
          <label className="block text-sm font-medium mb-1">
            {t("country", { defaultValue: "Страна" })}
          </label>
          <Select
            options={countryOptions}
            value={countryOpt}
            onChange={(opt) => {
              setCountryOpt(opt || null);
              setCityOpt(null);
              setCityDefaultOptions([]);
            }}
            placeholder={t("select_country", { defaultValue: "Выберите страну" })}
            isClearable
          />
        </div>

        {/* Город */}
        <div>
          <label className="block text-sm font-medium mb-1">
            {t("city", { defaultValue: "Город" })}
          </label>
          <AsyncSelect
            isDisabled={!countryOpt}
            cacheOptions
            defaultOptions={cityDefaultOptions}
            {...ASYNC_MENU_PORTAL}
            loadOptions={loadCities}
            noOptionsMessage={ASYNC_I18N.noOptionsMessage}
            loadingMessage={ASYNC_I18N.loadingMessage}
            placeholder={t("select_city", { defaultValue: "Выберите город" })}
            value={cityOpt}
            onChange={(opt) => setCityOpt(opt || null)}
            isClearable
          />
          {!import.meta.env.VITE_GEONAMES_USERNAME && (
            <div className="text-xs text-gray-500 mt-1">
              Автодополнение городов недоступно: не задан VITE_GEONAMES_USERNAME
            </div>
          )}
        </div>

        {/* Валюта + Адрес */}
        <div>
          <label className="block text-sm font-medium mb-1">
            {t("currency", { defaultValue: "Валюта" })}
          </label>
          <select
            className="w-full border rounded px-3 py-2 bg-white"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            <option value="UZS">UZS</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            {t("address", { defaultValue: "Адрес" })}
          </label>
          <input
            className="w-full border rounded px-3 py-2"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>
      </div>

      {/* Номерной фонд + сезонные цены */}
      <h2 className="text-xl font-semibold mt-6 mb-2">
        {t("rooms_and_prices", { defaultValue: "Номерной фонд и цены" })}
      </h2>

      <div className="overflow-auto border rounded">
        <table className="min-w-[1400px] text-sm align-top">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2">
                {t("room_category",{defaultValue:"Категория"})}
              </th>
              <th className="text-left px-3 py-2">
                {t("count_short",{defaultValue:"Кол-во"})}
              </th>
              <th className="px-3 py-2 text-center bg-white" colSpan={10}>
                {t("low_season",{defaultValue:"Низкий сезон"})}
              </th>
              <th className="px-3 py-2 text-center bg-gray-100 border-l border-gray-200" colSpan={10}>
                {t("high_season",{defaultValue:"Высокий сезон"})}
              </th>
              <th className="w-[1%] px-3 py-2"></th>
            </tr>
            <tr className="bg-gray-50">
              <th></th><th></th>
              <th className="text-center px-3 py-1 bg-white" colSpan={5}>{t("for_residents",{defaultValue:"Для резидентов"})}</th>
              <th className="text-center px-3 py-1 bg-white" colSpan={5}>{t("for_nonresidents",{defaultValue:"Для нерезидентов"})}</th>
              <th className="text-center px-3 py-1 bg-gray-100 border-l border-gray-200" colSpan={5}>{t("for_residents",{defaultValue:"Для резидентов"})}</th>
              <th className="text-center px-3 py-1 bg-gray-100" colSpan={5}>{t("for_nonresidents",{defaultValue:"Для нерезидентов"})}</th>
              <th></th>
            </tr>
            <tr className="bg-gray-50 text-xs">
              <th></th><th></th>
              {MEAL_PLANS.map((mp) => (<th key={`low-res-${mp}`} className="px-2 py-1 bg-white">{mp}</th>))}
              {MEAL_PLANS.map((mp) => (<th key={`low-non-${mp}`} className="px-2 py-1 bg-white">{mp}</th>))}
              {MEAL_PLANS.map((mp, i) => (
                <th key={`high-res-${mp}`} className={`px-2 py-1 bg-gray-100 ${i===0 ? "border-l border-gray-200" : ""}`}>{mp}</th>
              ))}
              {MEAL_PLANS.map((mp) => (<th key={`high-non-${mp}`} className="px-2 py-1 bg-gray-100">{mp}</th>))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {roomRows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-3 py-2">
                  {row.builtin ? (
                    row.name
                  ) : (
                    <input
                      className="border rounded px-2 py-1 w-44"
                      value={row.name}
                      onChange={(e) => updateRow(row.id, { name: e.target.value })}
                      placeholder={t("room_type_name", { defaultValue: "Название типа" })}
                    />
                  )}
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    className="w-24 border rounded px-2 py-1"
                    value={row.count}
                    onChange={(e) => updateRow(row.id, { count: e.target.value })}
                  />
                </td>

                {/* low / resident */}
                {MEAL_PLANS.map((mp) => (
                  <td className={tdCls("low")} key={`${row.id}-low-res-${mp}`}>
                    <input
                      type="number" min={0} step="0.01"
                      className={inputCls("low")}
                      placeholder={currency}
                      value={row.prices.low.resident[mp] ?? ""}
                      onChange={(e) => updateMealPrice(row.id, "low", "resident", mp, e.target.value)}
                    />
                  </td>
                ))}
                {/* low / nonresident */}
                {MEAL_PLANS.map((mp) => (
                  <td className={tdCls("low")} key={`${row.id}-low-non-${mp}`}>
                    <input
                      type="number" min={0} step="0.01"
                      className={inputCls("low")}
                      placeholder={currency}
                      value={row.prices.low.nonResident[mp] ?? ""}
                      onChange={(e) => updateMealPrice(row.id, "low", "nonResident", mp, e.target.value)}
                    />
                  </td>
                ))}
                {/* high / resident */}
                {MEAL_PLANS.map((mp, i) => (
                  <td className={tdCls("high", i===0 ? "border-l border-gray-200" : "")} key={`${row.id}-high-res-${mp}`}>
                    <input
                      type="number" min={0} step="0.01"
                      className={inputCls("high")}
                      placeholder={currency}
                      value={row.prices.high.resident[mp] ?? ""}
                      onChange={(e) => updateMealPrice(row.id, "high", "resident", mp, e.target.value)}
                    />
                  </td>
                ))}
                {/* high / nonresident */}
                {MEAL_PLANS.map((mp) => (
                  <td className={tdCls("high")} key={`${row.id}-high-non-${mp}`}>
                    <input
                      type="number" min={0} step="0.01"
                      className={inputCls("high")}
                      placeholder={currency}
                      value={row.prices.high.nonResident[mp] ?? ""}
                      onChange={(e) => updateMealPrice(row.id, "high", "nonResident", mp, e.target.value)}
                    />
                  </td>
                ))}
                <td className="px-3 py-2 text-right">
                  {!row.builtin && (
                    <button
                      type="button"
                      className="text-gray-500 hover:text-red-600"
                      onClick={() => removeRow(row.id)}
                      title={t("delete", { defaultValue: "Удалить" })}
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Добавить свой тип */}
      <div className="flex items-center gap-2 mt-3">
        <input
          className="border rounded px-3 py-2 flex-1"
          placeholder={t("add_custom_room_type_ph", { defaultValue: "Добавить свой тип номера (например, Deluxe…)" })}
          value={newTypeName}
          onChange={(e) => setNewTypeName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustomType())}
        />
        <button type="button" onClick={addCustomType} className="px-3 py-2 rounded bg-gray-800 text-white">
          {t("add_type", { defaultValue: "Добавить тип" })}
        </button>
      </div>

      {/* Доп. место */}
      <div className="mt-4">
        <label className="block text-sm font-medium mb-1">
          {t("extra_bed_cost", { defaultValue: "Стоимость доп. места (за человека/ночь)" })} ({currency})
        </label>
        <input
          type="number"
          min={0}
          step="0.01"
          className="w-64 border rounded px-3 py-2"
          placeholder={currency}
          value={extraBedPrice}
          onChange={(e) => setExtraBedPrice(e.target.value)}
        />
      </div>

      {/* Налоги и сборы */}
      <h2 className="text-xl font-semibold mt-6 mb-2">
        {t("taxes_fees", { defaultValue: "Налоги и сборы" })}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={vatIncluded}
            onChange={(e) => setVatIncluded(e.target.checked)}
          />
          {t("vat_included", { defaultValue: "Цены включают НДС" })}
        </label>
        <div>
          <label className="block text-sm font-medium mb-1">
            {t("vat_percent", { defaultValue: "НДС, %" })}
          </label>
          <input
            type="number"
            min={0}
            step="0.1"
            className="w-full border rounded px-3 py-2"
            placeholder="%"
            value={vatRate}
            onChange={(e) => setVatRate(e.target.value)}
          />
        </div>
        <div></div>
        <div>
          <label className="block text-sm font-medium mb-1">
            {t("tourism_fee_resident", { defaultValue: "Туристический сбор (резидент), /чел/ночь" })} ({currency})
          </label>
          <input
            type="number"
            min={0}
            step="0.01"
            className="w-full border rounded px-3 py-2"
            placeholder={currency}
            value={touristResident}
            onChange={(e) => setTouristResident(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            {t("tourism_fee_nonresident", { defaultValue: "Туристический сбор (нерезидент), /чел/ночь" })} ({currency})
          </label>
          <input
            type="number"
            min={0}
            step="0.01"
            className="w-full border rounded px-3 py-2"
            placeholder={currency}
            value={touristNonResident}
            onChange={(e) => setTouristNonResident(e.target.value)}
          />
        </div>
      </div>

      {/* Удобства */}
      <h2 className="text-xl font-semibold mt-6 mb-2">
        {t("amenities", { defaultValue: "Удобства" })}
      </h2>
      <form onSubmit={handleAmenityAdd} className="flex gap-2 mb-2">
        <input name="amen" className="flex-1 border rounded px-3 py-2" placeholder={t("add_amenity", { defaultValue: "Добавить удобство…" })} />
        <button className="px-3 py-2 rounded bg-gray-800 text-white">
          {t("add", { defaultValue: "Добавить" })}
        </button>
      </form>
      <div className="flex flex-wrap gap-2">
        {amenities.map((a, i) => (
          <span key={i} className="text-xs px-2 py-1 bg-gray-100 rounded-full">
            {a}{" "}
            <button className="ml-1 text-gray-500" onClick={() => setAmenities((p) => p.filter((_, idx) => idx !== i))}>×</button>
          </span>
        ))}
      </div>

      {/* Услуги */}
      <h2 className="text-xl font-semibold mt-6 mb-2">
        {t("services", { defaultValue: "Услуги" })}
      </h2>
      <form onSubmit={handleServiceAdd} className="flex gap-2 mb-2">
        <input name="serv" className="flex-1 border rounded px-3 py-2" placeholder={t("add_service", { defaultValue: "Добавить услугу…" })} />
        <button className="px-3 py-2 rounded bg-gray-800 text-white">
          {t("add", { defaultValue: "Добавить" })}
        </button>
      </form>
      <div className="flex flex-wrap gap-2">
        {services.map((s, i) => (
          <span key={i} className="text-xs px-2 py-1 bg-gray-100 rounded-full">
            {s}{" "}
            <button className="ml-1 text-gray-500" onClick={() => setServices((p) => p.filter((_, idx) => idx !== i))}>×</button>
          </span>
        ))}
      </div>

      {/* Изображения */}
      <h2 className="text-xl font-semibold mt-6 mb-2">
        {t("images", { defaultValue: "Изображения" })}
      </h2>
      <div className="flex items-center gap-3">
        <input
          id="imagesInput"
          type="file"
          accept="image/*"
          multiple
          onChange={onImagePick}
          className="sr-only"
        />
        <label
          htmlFor="imagesInput"
          className="inline-flex items-center justify-center px-3 py-2 rounded bg-gray-800 text-white cursor-pointer"
        >
          {t("choose_files", { defaultValue: "Выбрать файлы" })}
        </label>

        <span className="text-sm text-gray-600">
          {images.length > 0
            ? `${t("file_chosen", { defaultValue: "Файлы выбраны" })}: ${images.length}`
            : t("no_files_selected", { defaultValue: "Файлы не выбраны" })}
        </span>
      </div>
      {t("images_hint") && (
        <div className="text-xs text-gray-500 mt-1">
          {t("images_hint", { defaultValue: "До 10 изображений, ≤ 3 МБ каждое" })}
        </div>
      )}
      {images.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
          {images.map((src, i) => (
            <div key={i} className="relative">
              <img src={src} alt="" className="w-full h-28 object-cover rounded border" />
              <button
                type="button"
                onClick={() => setImages((p) => p.filter((_, idx) => idx !== i))}
                className="absolute top-1 right-1 bg-white/90 rounded px-1 text-xs"
              >
                ×
              </button>
              {i === 0 && (
                <div className="absolute bottom-1 left-1 text-[10px] bg-white/90 px-1 rounded">
                  {t("cover", { defaultValue: "Обложка" })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 flex gap-2">
        <button onClick={submit} className="bg-orange-600 text-white font-semibold px-4 py-2 rounded">
          {t("save", { defaultValue: "Сохранить" })}
        </button>
      </div>
    </div>
  );
}
