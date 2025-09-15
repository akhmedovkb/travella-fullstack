// frontend/src/pages/admin/AdminHotelForm.jsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Select from "react-select";
import AsyncSelect from "react-select/async";
import AsyncCreatableSelect from "react-select/async-creatable";
import axios from "axios";
import {
  createHotel,
  searchHotels,
  getHotel,
  updateHotel,
} from "../../api/hotels";
import GeoNamesStatusBadge from "../../components/GeoNamesStatusBadge";
import { tSuccess, tError } from "../../shared/toast";

/* ---------- Room types ---------- */
const DEFAULT_ROOM_TYPES = [
  { id: "single", name: "Single", builtin: true },
  { id: "double", name: "Double", builtin: true },
  { id: "triple", name: "Triple", builtin: true },
  { id: "quadruple", name: "Quadruple", builtin: true },
  { id: "suite", name: "Suite", builtin: true },
  { id: "family", name: "Family", builtin: true },
];

const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const numOrNull = (v) =>
  v === "" || v === null || v === undefined ? null : Number(v);

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
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (ctrlRef.current) ctrlRef.current.abort?.();
    },
    []
  );
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
    const nav = (
      typeof navigator !== "undefined"
        ? navigator.languages || [navigator.language]
        : []
    )
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
  const { id: editId } = useParams();
  const isEdit = !!editId;

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
  const [pendingGeo, setPendingGeo] = useState(null); // отложить проставление пока не загрузим options

  // Удобства/услуги
  const [amenities, setAmenities] = useState([]);
  const [services, setServices] = useState([]);

  // Наборы питания: BB, HB, FB, AI, UAI
  const MEAL_PLANS = ["BB", "HB", "FB", "AI", "UAI"];
  const makeMealSet = () => ({ BB: "", HB: "", FB: "", AI: "", UAI: "" });

  // для обратной совместимости (если в БД старый формат)
  const ensureMealSet = (v) => {
    if (v == null) return { BB: "", HB: "", FB: "", AI: "", UAI: "" };
    if (typeof v === "number" || typeof v === "string") {
      const s = String(v);
      return { BB: s, HB: s, FB: s, AI: s, UAI: s };
    }
    return {
      BB: v.BB ?? "",
      HB: v.HB ?? "",
      FB: v.FB ?? "",
      AI: v.AI ?? "",
      UAI: v.UAI ?? "",
    };
  };

  // стили для ячеек по сезону
  const tdCls = (season, extra = "") =>
    `px-2 py-1 ${season === "high" ? "bg-gray-50" : "bg-white"} ${extra}`;
  const inputCls = (season) =>
    `w-24 border rounded px-2 py-1 ${
      season === "high" ? "bg-gray-50" : "bg-white"
    }`;

  // Номера + сезонные цены
  const blankRow = (base) => ({
    ...base,
    count: "",
    prices: {
      low: { resident: makeMealSet(), nonResident: makeMealSet() },
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
  const [touristResident, setTouristResident] = useState(""); // /чел/ночь
  const [touristNonResident, setTouristNonResident] = useState(""); // /чел/ночь

  /* ---------- Страны ---------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const username = import.meta.env.VITE_GEONAMES_USERNAME;
        let list = [];
        if (username) {
          const { data } = await axios.get(
            "https://secure.geonames.org/countryInfoJSON",
            { params: { lang: geoLang, username } }
          );
          list = (data?.geonames || []).map((c) => ({
            value: c.countryCode,
            code: c.countryCode,
            label: c.countryName,
          }));
        }
        if (!list.length) {
          const res = await axios.get(
            "https://restcountries.com/v3.1/all?fields=name,cca2,translations"
          );
          list = (res.data || []).map((c) => {
            const code = c.cca2;
            const label =
              (geoLang === "ru" &&
                (c.translations?.rus?.common || c.name?.common)) ||
              (geoLang === "uz" &&
                (c.translations?.uzb?.common || c.name?.common)) ||
              c.name?.common ||
              code;
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
        console.error("countries load error", e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [geoLang]);

  // Проставляем страну/город, когда подтянулись options
  useEffect(() => {
    if (!pendingGeo || !countryOptions.length) return;
    const c = pendingGeo.country;
    const found = countryOptions.find(
      (o) =>
        o.label?.toLowerCase() === String(c || "").toLowerCase() ||
        o.code?.toLowerCase() === String(c || "").toLowerCase()
    );
    setCountryOpt(
      found || (c ? { value: c, code: String(c), label: String(c) } : null)
    );
    setCityOpt(
      pendingGeo.city
        ? { value: pendingGeo.city, label: pendingGeo.city }
        : null
    );
    setPendingGeo(null);
  }, [pendingGeo, countryOptions]);

  /* ---------- Префетч городов для выбранной страны ---------- */
  useEffect(() => {
    const username = import.meta.env.VITE_GEONAMES_USERNAME;
    if (!username || !countryOpt?.code) {
      setCityDefaultOptions([]);
      return;
    }
    const ctrl = new AbortController();
    axios
      .get("https://secure.geonames.org/searchJSON", {
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
        const opts = (data?.geonames || []).map((g) => ({
          value: g.name,
          label: g.name,
        }));
        setCityDefaultOptions(opts);
      })
      .catch((e) => {
        if (e?.code !== "ERR_CANCELED")
          console.warn("prefetch cities error", e);
      });
    return () => ctrl.abort();
  }, [countryOpt?.code, geoLang]);

  /* ---------- Поиск городов (внутри страны) ---------- */
  const loadCitiesRaw = useCallback(
    async (inputValue, signal) => {
      if (!countryOpt?.code) return [];
      const username = import.meta.env.VITE_GEONAMES_USERNAME;
      if (!username) return [];
      try {
        const { data } = await axios.get(
          "https://secure.geonames.org/searchJSON",
          {
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
          }
        );
        return (data?.geonames || []).map((g) => ({
          value: g.name,
          label: g.name,
        }));
      } catch (e) {
        if (e?.code === "ERR_CANCELED") return [];
        console.error("load cities error:", e);
        return [];
      }
    },
    [countryOpt?.code, geoLang]
  );

  const loadCities = useDebouncedLoader(loadCitiesRaw, 400);
  const ASYNC_I18N = makeAsyncSelectI18n(t);
  const ASYNC_MENU_PORTAL = {
    menuPortalTarget:
      typeof document !== "undefined" ? document.body : null,
    styles: { menuPortal: (base) => ({ ...base, zIndex: 9999 }) },
  };

  /* ---------- Поиск названия отеля ---------- */
  const loadHotelOptionsRaw = useCallback(
    async (inputValue /*, signal */) => {
      const items = await searchHotels({
        name: inputValue || "",
        city: cityOpt?.label || "",
        country: countryOpt?.code || "",
        limit: 50,
      });
      return (items || []).map((x) => {
        const title = x.label || x.name || String(x);
        const cityDual =
          x.city_en && x.city_local
            ? ` (${composeDualLabel(x.city_local, x.city_en)})`
            : x.city
            ? ` (${x.city})`
            : "";
        return { value: title, label: `${title}${cityDual}` };
      });
    },
    [cityOpt?.label, countryOpt?.code]
  );

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
    Promise.all(readers).then((list) =>
      setImages((prev) => [...prev, ...list])
    );
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
    setRoomRows((rows) => [
      ...rows,
      blankRow({ id, name: title, builtin: false }),
    ]);
    setNewTypeName("");
  };
  const removeRow = (id) =>
    setRoomRows((rows) => rows.filter((r) => r.id !== id));
  const updateRow = (id, patch) =>
    setRoomRows((rows) =>
      rows.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
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

  /* ---------- Загрузка данных при редактировании ---------- */
  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const data = await getHotel(editId);

        setName(data.name || "");
        setAddress(data.address || "");
        setCurrency(data.currency || "UZS");
        setAmenities(Array.isArray(data.amenities) ? data.amenities : []);
        setServices(Array.isArray(data.services) ? data.services : []);
        setImages(Array.isArray(data.images) ? data.images : []);
        setExtraBedPrice(
          data.extra_bed_price ?? data.extraBedPrice ?? ""
        );

        const taxes = data.taxes || {};
        setVatIncluded(!!taxes.vatIncluded);
        setVatRate(taxes.vatRate ?? "");
        setTouristResident(
          taxes.touristTax?.residentPerNight ?? ""
        );
        setTouristNonResident(
          taxes.touristTax?.nonResidentPerNight ?? ""
        );

        // проставим после загрузки опций стран/городов
        setPendingGeo({ country: data.country || null, city: data.city || null });

        // нормализация rows
        const normalizeRoom = (r) => ({
          id:
            slugify(r.type || r.name || "") ||
            `custom-${Math.random().toString(36).slice(2)}`,
          name: r.type || r.name || "",
          builtin: DEFAULT_ROOM_TYPES.some(
            (d) =>
              d.name.toLowerCase() ===
              String(r.type || r.name || "").toLowerCase()
          ),
          count: String(r.count ?? ""),
          prices: {
            low: {
              resident: ensureMealSet(r.prices?.low?.resident),
              nonResident: ensureMealSet(
                r.prices?.low?.nonResident
              ),
            },
            high: {
              resident: ensureMealSet(r.prices?.high?.resident),
              nonResident: ensureMealSet(
                r.prices?.high?.nonResident
              ),
            },
          },
        });

        const byName = new Map();
        for (const d of DEFAULT_ROOM_TYPES)
          byName.set(d.name.toLowerCase(), blankRow(d));
        for (const r of data.rooms || []) {
          const nr = normalizeRoom(r);
          byName.set(nr.name.toLowerCase(), nr);
        }
        setRoomRows(Array.from(byName.values()));
      } catch (e) {
        console.error(e);
        tError("Не удалось загрузить отель");
      }
    })();
  }, [isEdit, editId]);

  /* ---------- Submit ---------- */
  const submit = async () => {
    if (!name.trim())
      return tError(t("enter_hotel_name") || "Введите название");
    if (!countryOpt)
      return tError(t("select_country") || "Укажите страну");
    if (!address.trim())
      return tError(t("enter_address") || "Укажите адрес");

    const normalizeMealSet = (set) =>
      MEAL_PLANS.reduce(
        (acc, mp) => ({ ...acc, [mp]: numOrNull(set?.[mp]) }),
        {}
      );

    const rooms = roomRows
      .map((r) => ({
        type: r.name,
        count: Number(r.count || 0),
        prices: {
          low: {
            resident: normalizeMealSet(r.prices.low.resident),
            nonResident: normalizeMealSet(
              r.prices.low.nonResident
            ),
          },
          high: {
            resident: normalizeMealSet(r.prices.high.resident),
            nonResident: normalizeMealSet(
              r.prices.high.nonResident
            ),
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
          residentPerNight: numOrNull(touristResident),
          nonResidentPerNight: numOrNull(touristNonResident),
        },
      },
      amenities,
      services,
      images,
    };

    try {
      if (isEdit) {
        await updateHotel(editId, payload);
        tSuccess("Изменения сохранены");
        navigate(`/hotels/${editId}`);
      } else {
        const created = await createHotel(payload);
        tSuccess(t("hotel_saved") || "Отель сохранён");
        navigate(`/hotels/${created?.id || ""}`);
      }
    } catch (e) {
      console.error(e);
      tError(t("hotel_save_error") || "Ошибка сохранения отеля");
    }
  };

  /* ==================== UI ==================== */
  return (
    <div className="max-w-3xl mx-auto bg-white rounded-xl border shadow-sm p-5">
      <div className="mb-3">
        <GeoNamesStatusBadge />
      </div>

      <h1 className="text-2xl font-bold mb-4">
        {isEdit
          ? t("admin.edit_hotel_title", {
              defaultValue: "Редактирование отеля",
            })
          : t("admin.new_hotel_title", { defaultValue: "Новый отель" })}
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
            placeholder={t("hotel.search_placeholder", {
              defaultValue: "Найдите отель или введите свой вариант…",
            })}
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
            placeholder={t("select_country", {
              defaultValue: "Выберите страну",
            })}
            isClearable
         
