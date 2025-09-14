// frontend/src/pages/admin/AdminHotelForm.jsx

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Select from "react-select";
import AsyncSelect from "react-select/async";
import AsyncCreatableSelect from "react-select/async-creatable";
import axios from "axios";
import { createHotel } from "../../api/hotels";
import { tSuccess, tError, tWarn } from "../../shared/toast";

/* ---------- Room types (как у вас) ---------- */
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

/* ---------- I18N helpers, debounce loader ---------- */
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

  return useCallback((inputValue) => {
    return new Promise((resolve, reject) => {
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
    });
  }, [asyncFn, delay]);
}

/* ---------- RU|UZ|EN выбор языка для гео ---------- */
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

/* ---------- Комбинируем подписи: локальный / English ---------- */
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

  const [name, setName] = useState("");
  const [country, setCountry] = useState(""); // храним локализованное название (например, Oʻzbekiston)
  const [city, setCity] = useState("");       // локализованное название (например, Toshkent)
  const [address, setAddress] = useState("");
  const [amenities, setAmenities] = useState([]);
  const [services, setServices] = useState([]);
  const [images, setImages] = useState([]);

  // для Select'ов нужны объекты-значения
  const [countryOpt, setCountryOpt] = useState(null); // {value: ISO2, label:"Oʻzbekiston / Uzbekistan", local:"Oʻzbekiston", en:"Uzbekistan"}
  const [cityOpt, setCityOpt] = useState(null);       // {value:"Toshkent", label:"Toshkent / Tashkent", local:"Toshkent", en:"Tashkent"}
  const [countryOptions, setCountryOptions] = useState([]);

  // таблица номерного фонда (включая кастомные)
  const [roomRows, setRoomRows] = useState(
    DEFAULT_ROOM_TYPES.map((r) => ({ ...r, count: "", pricePerNight: "" }))
  );
  const [newTypeName, setNewTypeName] = useState("");

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
    setRoomRows((rows) => [...rows, { id, name: title, builtin: false, count: "", pricePerNight: "" }]);
    setNewTypeName("");
  };
  const removeRow = (id) => setRoomRows((rows) => rows.filter((r) => r.id !== id));
  const updateRow = (id, patch) => setRoomRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  /* ---------- Словари: страны ---------- */
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        // 1) пробуем GeoNames локально + по-английски и склеиваем подписи
        const username = import.meta.env.VITE_GEONAMES_USERNAME;
        let list = [];

        if (username) {
          const [loc, eng] = await Promise.all([
            axios.get("https://secure.geonames.org/countryInfoJSON", {
              params: { lang: geoLang, username },
            }),
            axios.get("https://secure.geonames.org/countryInfoJSON", {
              params: { lang: "en", username },
            }),
          ]);

          const byCodeEn = Object.fromEntries(
            (eng.data?.geonames || []).map((c) => [c.countryCode, c.countryName])
          );

          list = (loc.data?.geonames || []).map((c) => {
            const local = c.countryName;
            const en = byCodeEn[c.countryCode] || local;
            return {
              value: c.countryCode, // ISO2
              code: c.countryCode,
              label: composeDualLabel(local, en),
              local,
              en,
            };
          });
        }

        // 2) fallback на restcountries (если GeoNames недоступен)
        if (!list.length) {
          const res = await axios.get("https://restcountries.com/v3.1/all?fields=name,cca2,translations");
          list = (res.data || []).map((c) => {
            const code = c.cca2;
            // локальное имя
            const local =
              (geoLang === "ru" && (c.translations?.rus?.common || c.name?.common)) ||
              (geoLang === "uz" && (c.translations?.uzb?.common || c.name?.common)) ||
              c.name?.common;
            const en = c.name?.common || local;
            return {
              value: code,
              code,
              label: composeDualLabel(local, en),
              local,
              en,
            };
          });
        }

        if (!alive) return;
        setCountryOptions(list.sort((a, b) => a.label.localeCompare(b.label, geoLang)));
        // подставить выбранный ранее, если есть
        if (countryOpt) {
          const found = list.find((x) => x.code === countryOpt.code);
          if (found) setCountryOpt(found);
        }
      } catch (e) {
        console.error("Не удалось загрузить список стран", e);
      }
    })();

    return () => { alive = false; };
  }, [geoLang]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Города (асинхронно, с локализацией + EN в подписи) ---------- */
  const loadCitiesRaw = useCallback(async (inputValue, signal) => {
    try {
      const username = import.meta.env.VITE_GEONAMES_USERNAME;
      if (!username) return [];

      const { data } = await axios.get("https://secure.geonames.org/searchJSON", {
        params: {
          country: countryOpt?.code || undefined,
          name_startsWith: inputValue,
          q: inputValue,
          featureClass: "P",
          maxRows: 10,
          fuzzy: 0.9,
          style: "FULL",             // чтобы пришли alternateNames
          lang: geoLang,             // локальный язык
          username,
        },
        signal,
      });

      const list = (data?.geonames || []).map((city) => {
        const local = city.name; // уже локализовано по lang
        const enAlt = (city.alternateNames || []).find((a) => a.lang === "en")?.name
          || city.toponymName || city.asciiName || local;
        return {
          value: local,                           // в поле "city" сохраняем локальное
          label: composeDualLabel(local, enAlt),  // показываем local / English
          local,
          en: enAlt,
        };
      });

      return list;
    } catch (e) {
      if (e?.code === "ERR_CANCELED") return [];
      console.error("Ошибка загрузки городов:", e);
      return [];
    }
  }, [countryOpt?.code, geoLang]);

  const loadCities = useDebouncedLoader(loadCitiesRaw, 400);
  const ASYNC_I18N = makeAsyncSelectI18n(t);
  const ASYNC_MENU_PORTAL = {
    menuPortalTarget: typeof document !== "undefined" ? document.body : null,
    styles: { menuPortal: (base) => ({ ...base, zIndex: 9999 }) },
  };

  /* ---------- Поиск названия отеля (как в Dashboard) ---------- */
  const API_BASE = import.meta.env.VITE_API_BASE_URL;
  const loadHotelOptionsRaw = useCallback(async (inputValue, signal) => {
    try {
      const res = await axios.get(`${API_BASE}/api/hotels/search`, {
        params: { query: inputValue || "" },
        signal,
      });
      const items = Array.isArray(res.data) ? res.data : (res.data?.items || []);
      return (items || []).map((x) => {
        const title = x.label || x.name || String(x);
        // если в ответе есть город — тоже показываем dual, чтобы искалось по обеим формам
        const cityDual = x.city_en && x.city_local
          ? ` (${composeDualLabel(x.city_local, x.city_en)})`
          : x.city ? ` (${x.city})` : "";
        return { value: title, label: `${title}${cityDual}` };
      });
    } catch (err) {
      if (err?.code === "ERR_CANCELED") return [];
      console.error("Ошибка загрузки отелей:", err);
      return [];
    }
  }, [API_BASE]);

  const loadHotelOptions = useDebouncedLoader(loadHotelOptionsRaw, 400);

  /* ---------- Списки “удобств/услуг” ---------- */
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

  /* ---------- Submit ---------- */
  const submit = async () => {
    if (!name.trim())    return tError(t("enter_hotel_name") || "Введите название");
    if (!countryOpt)     return tError(t("select_country") || "Укажите страну");
    if (!address.trim()) return tError(t("enter_address") || "Укажите адрес");

    const rooms = roomRows
      .map((r) => ({
        type: r.name,
        count: Number(r.count || 0),
        pricePerNight: r.pricePerNight !== "" ? Number(r.pricePerNight) : null,
      }))
      .filter((x) => x.count > 0);

    const payload = {
      // сохраняем локализованные строки (как вы просили)
      name: name.trim(),
      country: countryOpt.local || countryOpt.en || country,
      city: cityOpt?.local || city || null,
      address: address.trim(),
      rooms,
      amenities,
      services,
      images,
    };

    try {
      const created = await createHotel(payload);
      tSuccess(t("hotel_saved") || "Отель сохранён");
      navigate(`/hotels/${created?.id || ""}`);
    } catch {
      tError(t("hotel_save_error") || "Ошибка сохранения отеля");
    }
  };

  /* ==================== RENDER ==================== */
  return (
    <div className="max-w-3xl mx-auto bg-white rounded-xl border shadow-sm p-5">
      <h1 className="text-2xl font-bold mb-4">{t("admin.new_hotel_title", { defaultValue: "Новый отель" })}</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Название — с подсказками + создание нового */}
        <div className="col-span-2">
          <label className="block text-sm font-medium mb-1">{t("hotel_name", { defaultValue: "Название" })}</label>
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

        {/* Страна (локализовано; в лейбле local / English) */}
        <div>
          <label className="block text-sm font-medium mb-1">{t("country", { defaultValue: "Страна" })}</label>
          <Select
            options={countryOptions}
            value={countryOpt}
            onChange={(opt) => {
              setCountryOpt(opt || null);
              setCountry(opt?.local || "");
              // очистим город при смене страны
              setCityOpt(null);
              setCity("");
            }}
            placeholder={t("select_country", { defaultValue: "Выберите страну" })}
            {...ASYNC_MENU_PORTAL}
          />
        </div>

        {/* Город (асинхронное автодополнение; лейбл local / English) */}
        <div>
          <label className="block text-sm font-medium mb-1">{t("city", { defaultValue: "Город" })}</label>
          <AsyncSelect
            isDisabled={!countryOpt}
            cacheOptions
            defaultOptions
            {...ASYNC_MENU_PORTAL}
            loadOptions={loadCities}
            noOptionsMessage={ASYNC_I18N.noOptionsMessage}
            loadingMessage={ASYNC_I18N.loadingMessage}
            placeholder={t("select_city", { defaultValue: "Выберите город" })}
            value={cityOpt || (city ? { value: city, label: city } : null)}
            onChange={(opt) => {
              setCityOpt(opt || null);
              setCity(opt?.local || opt?.value || "");
            }}
            isClearable
          />
        </div>

        <div className="col-span-2">
          <label className="block text-sm font-medium mb-1">{t("address", { defaultValue: "Адрес" })}</label>
          <input className="w-full border rounded px-3 py-2" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
      </div>

      {/* Номерной фонд + цены — как было, только с кнопкой удаления у кастомных типов */}
      <h2 className="text-xl font-semibold mt-6 mb-2">{t("rooms_and_prices", { defaultValue: "Номерной фонд и цены" })}</h2>
      <div className="overflow-auto border rounded">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2">{t("type", { defaultValue: "Тип" })}</th>
              <th className="text-left px-3 py-2">{t("count_short", { defaultValue: "Кол-во" })}</th>
              <th className="text-left px-3 py-2">{t("price_per_night", { defaultValue: "Цена/ночь" })}</th>
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
                      placeholder={t("room_type_name", { defaultValue: "Название типа" })}
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

      {/* Удобства */}
      <h2 className="text-xl font-semibold mt-6 mb-2">{t("amenities", { defaultValue: "Удобства" })}</h2>
      <form onSubmit={handleAmenityAdd} className="flex gap-2 mb-2">
        <input name="amen" className="flex-1 border rounded px-3 py-2" placeholder={t("add_amenity", { defaultValue: "Добавить удобство…" })} />
        <button className="px-3 py-2 rounded bg-gray-800 text-white">{t("add", { defaultValue: "Добавить" })}</button>
      </form>
      <div className="flex flex-wrap gap-2">
        {amenities.map((a, i) => (
          <span key={i} className="text-xs px-2 py-1 bg-gray-100 rounded-full">
            {a} <button className="ml-1 text-gray-500" onClick={() => removeFrom(setAmenities, i)}>×</button>
          </span>
        ))}
      </div>

      {/* Услуги */}
      <h2 className="text-xl font-semibold mt-6 mb-2">{t("services", { defaultValue: "Услуги" })}</h2>
      <form onSubmit={handleServiceAdd} className="flex gap-2 mb-2">
        <input name="serv" className="flex-1 border rounded px-3 py-2" placeholder={t("add_service", { defaultValue: "Добавить услугу…" })} />
        <button className="px-3 py-2 rounded bg-gray-800 text-white">{t("add", { defaultValue: "Добавить" })}</button>
      </form>
      <div className="flex flex-wrap gap-2">
        {services.map((s, i) => (
          <span key={i} className="text-xs px-2 py-1 bg-gray-100 rounded-full">
            {s} <button className="ml-1 text-gray-500" onClick={() => removeFrom(setServices, i)}>×</button>
          </span>
        ))}
      </div>

      {/* Изображения */}
      <h2 className="text-xl font-semibold mt-6 mb-2">{t("images", { defaultValue: "Изображения" })}</h2>
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
                <div className="absolute bottom-1 left-1 text-[10px] bg-white/90 px-1 rounded">{t("cover", { defaultValue: "Обложка" })}</div>
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
