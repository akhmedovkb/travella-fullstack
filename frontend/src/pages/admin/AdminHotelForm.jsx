// frontend/src/pages/admin/AdminHotelForm.jsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import Select from "react-select";
import AsyncSelect from "react-select/async";
import AsyncCreatableSelect from "react-select/async-creatable";
import { createHotel } from "../../api/hotels";
import { tSuccess, tError, tWarn } from "../../shared/toast";

/* ================= helpers ================= */
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

// язык для GeoNames (ru/uz/en)
const pickGeoLang = () => {
  const allowed = ["ru", "uz", "en"];
  const fromI18n = (typeof localStorage !== "undefined"
    ? (localStorage.getItem("i18nextLng") || "")
    : ""
  ).slice(0, 2).toLowerCase();
  if (allowed.includes(fromI18n)) return fromI18n;
  const nav = typeof navigator !== "undefined"
    ? (navigator.languages || [navigator.language])
    : [];
  const cand = nav.map(l => String(l).slice(0, 2).toLowerCase())
                  .find(l => allowed.includes(l));
  return cand || "en";
};

// i18n-подсказки для react-select без подключения i18next
const UI = {
  ru: {
    type_more: "Введите минимум 2 символа",
    loading: "Загрузка…",
    no_options: "Ничего не найдено",
    hotel_placeholder: "Найдите отель или введите свой вариант…",
    add: "Добавить",
    country_placeholder: "Выберите страну",
    city_placeholder: "Начните вводить город…",
  },
  uz: {
    type_more: "Kamida 2 ta belgi kiriting",
    loading: "Yuklanmoqda…",
    no_options: "Hech narsa topilmadi",
    hotel_placeholder: "Mehmonxonani qidiring yoki yozing…",
    add: "Qo‘shish",
    country_placeholder: "Mamlakatni tanlang",
    city_placeholder: "Shaharni yozishni boshlang…",
  },
  en: {
    type_more: "Type at least 2 characters",
    loading: "Loading…",
    no_options: "No options",
    hotel_placeholder: "Find a hotel or type your own…",
    add: "Add",
    country_placeholder: "Select a country",
    city_placeholder: "Start typing a city…",
  },
};
const ui = UI[pickGeoLang()];

function useDebouncedLoader(asyncFn, delay = 400) {
  const timerRef = useRef(null);
  const ctrlRef = useRef(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (ctrlRef.current) ctrlRef.current.abort();
  }, []);

  return useCallback((inputValue) => {
    return new Promise((resolve, reject) => {
      const text = (inputValue || "").trim();

      if (text.length < 2) {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (ctrlRef.current) ctrlRef.current.abort();
        resolve([]);
        return;
      }

      if (timerRef.current) clearTimeout(timerRef.current);
      if (ctrlRef.current) ctrlRef.current.abort();

      const controller = new AbortController();
      ctrlRef.current = controller;

      timerRef.current = setTimeout(async () => {
        try {
          const out = await asyncFn(text, controller.signal);
          resolve(out);
        } catch (e) {
          // тихо игнорируем отмену
          if (e?.name === "AbortError" || e?.code === "ERR_CANCELED") {
            resolve([]);
            return;
          }
          reject(e);
        }
      }, delay);
    });
  }, [asyncFn, delay]);
}

const ASYNC_I18N = {
  noOptionsMessage: ({ inputValue }) =>
    (inputValue || "").trim().length < 2 ? ui.type_more : ui.no_options,
  loadingMessage: () => ui.loading,
};
const ASYNC_MENU_PORTAL = {
  menuPortalTarget: typeof document !== "undefined" ? document.body : null,
  styles: { menuPortal: (base) => ({ ...base, zIndex: 9999 }) },
};

/* ================ component ================ */
export default function AdminHotelForm() {
  const navigate = useNavigate();

  // базовые поля
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [amenities, setAmenities] = useState([]);
  const [services, setServices] = useState([]);
  const [images, setImages] = useState([]);

  // номерной фонд
  const [roomRows, setRoomRows] = useState(
    DEFAULT_ROOM_TYPES.map((r) => ({ ...r, count: "", pricePerNight: "" }))
  );
  const [newTypeName, setNewTypeName] = useState("");

  // ===== География (страна/город) =====
  const [countryOptions, setCountryOptions] = useState([]);
  const [selectedCountry, setSelectedCountry] = useState(null); // { value: ISO2, code, label }
  const [selectedCity, setSelectedCity] = useState(null);

  // загрузка стран (GeoNames → restcountries fallback)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const username = import.meta.env.VITE_GEONAMES_USERNAME;
        let list = [];
        // GeoNames
        try {
          const { data } = await axios.get(
            "https://secure.geonames.org/countryInfoJSON",
            { params: { lang: pickGeoLang(), username } }
          );
          list = (data?.geonames || []).map((c) => ({
            value: c.countryCode,
            code: c.countryCode,
            label: c.countryName,
          }));
        } catch {}
        // restcountries fallback
        if (!list.length) {
          const { data } = await axios.get(
            "https://restcountries.com/v3.1/all?fields=name,cca2,translations"
          );
          list = (data || []).map((c) => ({
            value: c.cca2,
            code: c.cca2,
            label:
              (pickGeoLang() === "ru"
                ? c.translations?.rus?.common
                : null) || c.name?.common || c.cca2,
          }));
        }
        if (!alive) return;
        setCountryOptions(list.sort((a, b) =>
          a.label.localeCompare(b.label, pickGeoLang())
        ));
      } catch (e) {
        console.error("Не удалось загрузить страны", e);
      }
    })();
    return () => { alive = false; };
  }, []);

  // поиск городов в GeoNames (учитывает выбранную страну)
  const loadCitiesRaw = useCallback(
    async (inputValue, signal) => {
      const params = {
        name_startsWith: inputValue,
        q: inputValue,
        featureClass: "P",
        maxRows: 10,
        fuzzy: 0.9,
        style: "FULL",
        lang: pickGeoLang(),
        username: import.meta.env.VITE_GEONAMES_USERNAME,
      };
      if (selectedCountry?.code) params.country = selectedCountry.code;
      try {
        const { data } = await axios.get(
          "https://secure.geonames.org/searchJSON",
          { params, signal }
        );
        return (data.geonames || []).map((c) => ({
          value: c.name,
          label: c.name,
        }));
      } catch (err) {
        if (err?.code !== "ERR_CANCELED") {
          console.error("Ошибка загрузки городов:", err);
        }
        return [];
      }
    },
    [selectedCountry]
  );
  const loadCities = useDebouncedLoader(loadCitiesRaw, 400);

  // ===== Поиск отеля (как в Dashboard) =====
  const API_BASE = import.meta.env.VITE_API_BASE_URL;
  const token =
    (typeof localStorage !== "undefined" &&
      (localStorage.getItem("token") || localStorage.getItem("providerToken"))) ||
    "";
  const auth = token ? { headers: { Authorization: `Bearer ${token}` } } : {};

  const loadHotelsRaw = useCallback(
    async (inputValue, signal) => {
      try {
        const res = await axios.get(`${API_BASE}/api/hotels/search`, {
          params: { query: inputValue || "" },
          signal,
          ...auth,
        });
        return (res.data || []).map((x) => ({
          value: x.label || x.name || x,
          label: x.label || x.name || x,
        }));
      } catch (err) {
        if (err?.code === "ERR_CANCELED") return [];
        console.error("Ошибка загрузки отелей:", err);
        return [];
      }
    },
    [API_BASE, auth]
  );
  const loadHotelOptions = useDebouncedLoader(loadHotelsRaw, 400);

  /* ===== Удобства/услуги/изображения ===== */
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
  const removeFrom = (arrSetter, idx) =>
    arrSetter((p) => p.filter((_, i) => i !== idx));

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

  /* ===== Кастомные типы ===== */
  const addCustomType = () => {
    const title = newTypeName.trim();
    if (!title) return;
    const idBase = slugify(title) || `custom-${Date.now()}`;
    let id = idBase, i = 2;
    while (roomRows.some((r) => r.id === id)) id = `${idBase}-${i++}`;
    setRoomRows((rows) => [
      ...rows,
      { id, name: title, builtin: false, count: "", pricePerNight: "" },
    ]);
    setNewTypeName("");
  };
  const removeRow = (id) =>
    setRoomRows((rows) => rows.filter((r) => r.id !== id));
  const updateRow = (id, patch) =>
    setRoomRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  /* ===== Submit ===== */
  const submit = async () => {
    if (!name.trim())    return tError("Введите название отеля");
    if (!country.trim()) return tError("Укажите страну");
    if (!address.trim()) return tError("Укажите адрес");

    const rooms = roomRows
      .map((r) => ({
        type: r.name,
        count: Number(r.count || 0),
        pricePerNight:
          r.pricePerNight !== "" ? Number(r.pricePerNight) : null,
      }))
      .filter((x) => x.count > 0);

    const payload = {
      name: name.trim(),
      country: country.trim(),           // строка для бэка
      city: city.trim() || null,
      address: address.trim(),
      rooms,
      amenities,
      services,
      images,
    };

    try {
      const created = await createHotel(payload);
      tSuccess("Отель сохранён");
      navigate(`/hotels/${created?.id || ""}`);
    } catch {
      tError("Ошибка сохранения отеля");
    }
  };

  /* ================ render ================ */
  return (
    <div className="max-w-3xl mx-auto bg-white rounded-xl border shadow-sm p-5">
      <h1 className="text-2xl font-bold mb-4">Новый отель</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Название отеля (AsyncCreatableSelect) */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-1">Название</label>
          <AsyncCreatableSelect
            cacheOptions
            defaultOptions
            {...ASYNC_MENU_PORTAL}
            loadOptions={loadHotelOptions}
            value={name ? { value: name, label: name } : null}
            onChange={(opt) => setName(opt?.value || "")}
            onCreateOption={(val) => setName(val || "")}
            placeholder={ui.hotel_placeholder}
            noOptionsMessage={ASYNC_I18N.noOptionsMessage}
            loadingMessage={ASYNC_I18N.loadingMessage}
          />
        </div>

        {/* Страна (Select) */}
        <div>
          <label className="block text-sm font-medium mb-1">Страна</label>
          <Select
            options={countryOptions}
            value={selectedCountry}
            onChange={(opt) => {
              setSelectedCountry(opt);
              setCountry(opt?.label || "");
              // сбрасываем город при смене страны
              setSelectedCity(null);
              setCity("");
            }}
            placeholder={ui.country_placeholder}
            {...ASYNC_MENU_PORTAL}
          />
        </div>

        {/* Город (AsyncSelect) */}
        <div>
          <label className="block text-sm font-medium mb-1">Город</label>
          <AsyncSelect
            cacheOptions
            defaultOptions
            {...ASYNC_MENU_PORTAL}
            loadOptions={loadCities}
            value={selectedCity}
            onChange={(opt) => {
              setSelectedCity(opt);
              setCity(opt?.value || "");
            }}
            placeholder={ui.city_placeholder}
            noOptionsMessage={ASYNC_I18N.noOptionsMessage}
            loadingMessage={ASYNC_I18N.loadingMessage}
            isDisabled={!selectedCountry}
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-1">Адрес</label>
          <input
            className="w-full border rounded px-3 py-2"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Улица, дом, ориентир"
          />
        </div>
      </div>

      {/* Номерной фонд + цены */}
      <h2 className="text-xl font-semibold mt-6 mb-2">Номерной фонд и цены</h2>
      <div className="overflow-auto border rounded">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2">Тип</th>
              <th className="text-left px-3 py-2">Кол-во</th>
              <th className="text-left px-3 py-2">Цена/ночь</th>
              <th className="w-[1%] px-3 py-2"></th>
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
                      placeholder="Название типа"
                    />
                  )}
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    className="w-28 border rounded px-2 py-1"
                    value={row.count}
                    onChange={(e) => updateRow(row.id, { count: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="USD"
                    className="w-36 border rounded px-2 py-1"
                    value={row.pricePerNight}
                    onChange={(e) => updateRow(row.id, { pricePerNight: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  {!row.builtin && (
                    <button
                      type="button"
                      className="text-gray-500 hover:text-red-600"
                      onClick={() => removeRow(row.id)}
                      title="Удалить тип"
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

      {/* Добавление собственного типа */}
      <div className="flex items-center gap-2 mt-3">
        <input
          className="border rounded px-3 py-2 flex-1"
          placeholder="Добавить свой тип номера (например, Deluxe, Superior, King…) "
          value={newTypeName}
          onChange={(e) => setNewTypeName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustomType())}
        />
        <button type="button" onClick={addCustomType} className="px-3 py-2 rounded bg-gray-800 text-white">
          {ui.add}
        </button>
      </div>

      {/* Удобства */}
      <h2 className="text-xl font-semibold mt-6 mb-2">Удобства</h2>
      <form onSubmit={handleAmenityAdd} className="flex gap-2 mb-2">
        <input name="amen" className="flex-1 border rounded px-3 py-2" placeholder="Добавить удобство…" />
        <button className="px-3 py-2 rounded bg-gray-800 text-white">Добавить</button>
      </form>
      <div className="flex flex-wrap gap-2">
        {amenities.map((a, i) => (
          <span key={i} className="text-xs px-2 py-1 bg-gray-100 rounded-full">
            {a}{" "}
            <button className="ml-1 text-gray-500" onClick={() => removeFrom(setAmenities, i)}>×</button>
          </span>
        ))}
      </div>

      {/* Услуги */}
      <h2 className="text-xl font-semibold mt-6 mb-2">Услуги</h2>
      <form onSubmit={handleServiceAdd} className="flex gap-2 mb-2">
        <input name="serv" className="flex-1 border rounded px-3 py-2" placeholder="Добавить услугу…" />
        <button className="px-3 py-2 rounded bg-gray-800 text-white">Добавить</button>
      </form>
      <div className="flex flex-wrap gap-2">
        {services.map((s, i) => (
          <span key={i} className="text-xs px-2 py-1 bg-gray-100 rounded-full">
            {s}{" "}
            <button className="ml-1 text-gray-500" onClick={() => removeFrom(setServices, i)}>×</button>
          </span>
        ))}
      </div>

      {/* Изображения */}
      <h2 className="text-xl font-semibold mt-6 mb-2">Изображения</h2>
      <input type="file" accept="image/*" multiple onChange={onImagePick} />
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
                <div className="absolute bottom-1 left-1 text-[10px] bg-white/90 px-1 rounded">Обложка</div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 flex gap-2">
        <button onClick={submit} className="bg-orange-600 text-white font-semibold px-4 py-2 rounded">
          Сохранить
        </button>
      </div>
    </div>
  );
}
