// frontend/src/pages/admin/AdminHotelForm.jsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Link } from "react-router-dom";

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
// --- чтение роли из JWT (без внешних либ) ---
function decodeJwtPayload(token) {
  try {
    const base = token.split(".")[1] || "";
    const b64 = base.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(b64)
        .split("")
        .map((c) => `%${("00" + c.charCodeAt(0).toString(16)).slice(-2)}`)
        .join("")
    );
    return JSON.parse(json);
  } catch { return {}; }
}
function getUserFromToken() {
  const t =
    localStorage.getItem("providerToken") ||
    localStorage.getItem("token") ||
    localStorage.getItem("clientToken") ||
    null;
  return t ? decodeJwtPayload(t) : {};
}
function isAdminLikeUser(u = {}) {
  const roles = []
    .concat(u.role || u.type || [])
    .concat(Array.isArray(u.roles) ? u.roles : [])
    .map((r) => String(r).toLowerCase());
  const flag = u.is_admin === true || String(u.is_admin).toLowerCase() === "true";
  return flag || roles.includes("admin") || roles.includes("moderator");
}
function isProviderLikeUser(u = {}) {
  const roles = []
    .concat(u.role || u.type || [])
    .concat(Array.isArray(u.roles) ? u.roles : [])
    .map((r) => String(r).toLowerCase());
  return roles.includes("provider") || roles.includes("hotel") || roles.includes("supplier") || roles.includes("tour_agent") || roles.includes("agency");
}

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

// <-- ДОБАВЛЕНО: обновление
async function httpPut(path, body = {}, role) {
  try {
    const res = await axios.put(apiURL(path), body, {
      withCredentials: true,
      headers: { "Content-Type": "application/json", ...authHeaders(role) },
    });
    return res.data;
  } catch (e) { throw normErr(e); }
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

async function apiAttachHotelOffer(hotelId, payload) {
  return httpPost(`/api/hotels/${encodeURIComponent(hotelId)}/offers`, payload, "provider");
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
const SEASONS = ["low", "shoulder", "high"];
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

/* ——— альфанумерическая очистка для поля «Контакт» ——— */
function sanitizeAlnumContact(v) {
  // Разрешаем: буквы/цифры (любой локали), пробел, @ + ( ) . , ; : / \ _ | # и дефис
  return String(v || "")
    .replace(
      /[^\p{L}\p{N}\s@+().,;:\/\\_|#-]/gu,
      ""
    )
    .slice(0, 300);
}


export default function AdminHotelForm({ hotelIdProp, onSaved } = {}) {
  const { t, i18n } = useTranslation();
  const geoLang = useGeoLang(i18n);
  const navigate = useNavigate();
  const { id: rawId } = useParams();
  const routedId = !rawId || rawId === "new" ? null : rawId;
  const effId    = hotelIdProp === "new" ? null : (hotelIdProp ?? routedId);
  const isNew    = !effId;
  const hotelId  = effId || null;
  const userInfo = useMemo(() => getUserFromToken(), []);
  const isAdminLike = useMemo(() => isAdminLikeUser(userInfo), [userInfo]);
  const isProviderLike = useMemo(() => isProviderLikeUser(userInfo), [userInfo]);
  const [selectedExistingHotel, setSelectedExistingHotel] = useState(null);
  // проставляем значения из записи отеля
  const fillFromHotel = (h) => {
    setName(h?.name || "");
    setAddress(h?.address || "");
    setContact(sanitizeAlnumContact(h?.contact ?? ""));
    setCurrency(h?.currency || "UZS");
    setImages(Array.isArray(h?.images) ? h.images : []);
    setStars(h?.stars ?? ""); // ← добавлено
    setProviderId(h?.provider_id ?? h?.providerId ?? "");
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
          shoulder: {
            resident: toMealSet(r?.prices?.shoulder?.resident),
            nonResident: toMealSet(r?.prices?.shoulder?.nonResident),
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

  // при наличии :id грузим карточку (режим правки)
  useEffect(() => {
    if (isNew) return;
    (async () => {
      try {
        const data = await httpGet(`/api/hotels/${encodeURIComponent(hotelId)}`, { role: "provider" });
        fillFromHotel(data);
      } catch (e) {
        tError(t("load_error") || "Не удалось загрузить отель");
      }
    })();
  }, [hotelId, isNew]);

  // Основные поля
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [contact, setContact] = useState("");
  const [images, setImages] = useState([]);
  // владелец
  const [providerId, setProviderId] = useState("");
    // Категория отеля (звёзды)
  const [stars, setStars] = useState("");

  // ограничитель 1..7 (или null)
  const clampStars = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.min(7, Math.max(1, Math.trunc(n)));
  };

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
  
  // Номера + сезонные цены
  const blankRow = (base) => ({
    ...base,
    count: "",
    prices: {
      low: { resident: makeMealSet(), nonResident: makeMealSet() },
      shoulder: { resident: makeMealSet(), nonResident: makeMealSet() },
      high: { resident: makeMealSet(), nonResident: makeMealSet() },
    },
  });

  const [roomRows, setRoomRows] = useState(
    DEFAULT_ROOM_TYPES.map((r) => blankRow(r))
  );
  const [newTypeName, setNewTypeName] = useState("");

  // --- валидатор строк с ценами ---
const isFilled = (v) => !(v === "" || v === null || v === undefined);

const rowHasAnyPrice = (row) => {
  if (!row?.prices) return false;
  const seasons = ["low", "shoulder", "high"];
  const persons = ["resident", "nonResident"];
  for (const season of seasons) {
    for (const person of persons) {
      for (const mp of MEAL_PLANS) {
        if (isFilled(row?.prices?.[season]?.[person]?.[mp])) return true;
      }
    }
  }
  return false;
};
  
// id строк с ценами, но без указания количества
const invalidRowIds = useMemo(
  () =>
    roomRows
      .filter((r) => Number(r.count || 0) === 0 && rowHasAnyPrice(r))
      .map((r) => r.id),
  [roomRows]
);


  // стили для ячеек по сезону (LR белый, HR бледно-серый)
const tdCls = (season, extra = "") =>
  `px-2 py-1 ${
    season === "high"
      ? "bg-gray-100"
      : season === "shoulder"
      ? "bg-slate-50"
      : "bg-white"
  } ${extra}`;

const inputCls = (season) =>
  `w-28 border rounded px-2 py-1 ${
    season === "high"
      ? "bg-gray-100"
      : season === "shoulder"
      ? "bg-slate-50"
      : "bg-white"
  }`;

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
      country: countryOpt?.label || "",
      limit: 50,
    });
    return (items || []).map((x) => {
      const title = x.label || x.name || String(x);
      const cityDual = x.city_en && x.city_local
        ? ` (${composeDualLabel(x.city_local, x.city_en)})`
        : x.city ? ` (${x.city})` : "";
      return {
        value: x.provider === "local" && x.id ? `hotel:${x.id}` : title,
        label: `${x.provider === "local" ? "В базе · " : ""}${title}${cityDual}`,
        hotelId: x.provider === "local" ? x.id : null,
        hotelName: title,
        city: x.city || x.city_local || "",
        country: x.country || "",
        source: x.provider || "external",
      };
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
    // фильтры: ≤ 3 МБ, максимум 10 изображений всего
    const MAX_MB = 3;
    const MAX_FILES = 10;
    const available = Math.max(0, MAX_FILES - images.length);
    if (available === 0) {
      tError(t("images_limit_reached", { defaultValue: "Достигнут лимит: максимум 10 изображений" }));
      e.target.value = "";
      return;
    }
    const picked = files.slice(0, available);
    const oversized = picked.filter(f => f.size > MAX_MB * 1024 * 1024);
    if (oversized.length) {
      tError(
        t("images_too_large", {
          defaultValue: "Некоторые файлы больше 3 МБ и были пропущены",
        })
      );
    }
    const accepted = picked.filter(f => f.size <= MAX_MB * 1024 * 1024);
    if (!accepted.length) { e.target.value = ""; return; }

    const readers = accepted.map(
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
    if (isNew && !isAdminLike && selectedExistingHotel?.hotelId) {
      try {
        const rawType = String(userInfo?.type || userInfo?.provider_type || "").toLowerCase();
        const supplierType = rawType === "hotel" ? "hotel"
          : ["tour_operator", "dmc", "agency", "supplier"].includes(rawType) ? rawType : "agency";
        await apiAttachHotelOffer(selectedExistingHotel.hotelId, {
          supplier_type: supplierType,
          is_direct: false,
          currency,
          title: "Предложение поставщика",
        });
        tSuccess("Существующий отель добавлен в ваши предложения");
        navigate(`/provider/hotels/${selectedExistingHotel.hotelId}/offer`);
      } catch (e) {
        console.error(e);
        tError(e?.message || "Не удалось добавить отель в ваши предложения");
      }
      return;
    }
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
            resident: normalizeMealSet(r.prices.low.resident),
            nonResident: normalizeMealSet(r.prices.low.nonResident),
          },
          shoulder: {
            resident: normalizeMealSet(r.prices.shoulder.resident),
            nonResident: normalizeMealSet(r.prices.shoulder.nonResident),
          },
          high: {
            resident: normalizeMealSet(r.prices.high.resident),
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
      stars: clampStars(stars),
      contact: contact.trim() || null,
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
         // Владелец может менять только админ — для провайдера не шлём это поле
    if (isAdminLike) {
      payload.provider_id = numOrNull(providerId);
    }

    try {
      if (!isNew && hotelId) {
        await httpPut(`/api/hotels/${encodeURIComponent(hotelId)}`, payload, "provider");
        tSuccess(t("hotel_saved") || "Изменения сохранены");
        if (typeof onSaved === "function") onSaved(hotelId);
        else navigate(isAdminLike ? `/admin/hotels/${hotelId}/edit` : `/provider/hotels/${hotelId}/offer`);
      } else {
        const created = await apiCreateHotel(payload);
        tSuccess(t("hotel_saved") || "Отель сохранён");
        const id = created?.id || "";
        if (typeof onSaved === "function") onSaved(id);
        else navigate(isAdminLike ? `/admin/hotels/${id}/edit` : `/provider/hotels/${id}/offer`);
      }
    } catch (e) {
      console.error(e);
      tError(t("hotel_save_error") || "Ошибка сохранения отеля");
    }
  };


  const [activeTab, setActiveTab] = useState("main");
  const completionItems = [
    { label: t("name", { defaultValue: "Название" }), done: !!name.trim() },
    { label: t("country", { defaultValue: "Страна" }), done: !!countryOpt },
    { label: t("city", { defaultValue: "Город" }), done: !!cityOpt },
    { label: t("address", { defaultValue: "Адрес" }), done: !!address.trim() },
    { label: t("images", { defaultValue: "Изображения" }), done: images.length > 0 },
  ];
  const completedCount = completionItems.filter((x) => x.done).length;

  const tabs = [
    { id: "main", label: t("admin.hotels.tab_main", { defaultValue: "Основное" }) },
    { id: "taxes", label: t("admin.hotels.tab_taxes", { defaultValue: "Налоги" }) },
    { id: "amenities", label: t("admin.hotels.tab_amenities", { defaultValue: "Удобства" }) },
    { id: "media", label: t("admin.hotels.tab_media", { defaultValue: "Фото" }) },
  ];

  const formInputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100";
  const formLabelClass = "mb-1.5 block text-xs font-black uppercase tracking-[0.08em] text-slate-500";

  /* ==================== UI ==================== */
  return (
    <div className="mx-auto max-w-7xl rounded-3xl border border-slate-200 bg-slate-50/60 p-4 shadow-sm lg:p-6">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <GeoNamesStatusBadge />
            <span className="inline-flex items-center rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-600 ring-1 ring-slate-200">
              {completedCount}/{completionItems.length} заполнено
            </span>
          </div>
          <h1 className="mt-3 text-2xl font-black tracking-[-0.03em] text-slate-950">
            {isNew
              ? t("admin.new_hotel_title", { defaultValue: "Новый отель" })
              : t("admin.edit_hotel_title", { defaultValue: "Редактирование отеля" })}
          </h1>
          <p className="mt-1 max-w-3xl text-sm font-medium leading-6 text-slate-600">
            {t("admin.hotels.form_hint", {
              defaultValue:
                "Заполните карточку отеля. Номерной фонд, квоты и тарифы настраиваются отдельно после сохранения.",
            })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={isAdminLike ? "/admin/hotels" : "/dashboard/hotels"}
            className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            ← {t("back", { defaultValue: "Назад" })}
          </Link>
          {hotelId && (
            <Link
              to={isAdminLike
                ? `/admin/hotels/${encodeURIComponent(hotelId)}/offers`
                : `/provider/hotels/${encodeURIComponent(hotelId)}/offer`}
              className="inline-flex items-center justify-center rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-bold text-orange-700 shadow-sm transition hover:bg-orange-100"
            >
              Фонд и тарифы
            </Link>
          )}
          <button
            type="button"
            onClick={submit}
            className="inline-flex items-center justify-center rounded-xl bg-orange-600 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-orange-700"
          >
            {t("save", { defaultValue: "Сохранить" })}
          </button>
        </div>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {completionItems.map((item) => (
          <div
            key={item.label}
            className={`rounded-2xl border px-3 py-2 text-xs font-bold ${
              item.done
                ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-white text-slate-500"
            }`}
          >
            <span className="mr-1">{item.done ? "✓" : "○"}</span>
            {item.label}
          </div>
        ))}
      </div>

      <div className="sticky top-[72px] z-20 mb-5 rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-sm backdrop-blur">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-black transition ${
                activeTab === tab.id
                  ? "bg-slate-950 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm lg:p-6">
        {activeTab === "main" && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <div className="lg:col-span-6">
                <label className={formLabelClass}>{t("name", { defaultValue: "Название" })}</label>
                <AsyncCreatableSelect
                  cacheOptions
                  defaultOptions
                  {...ASYNC_MENU_PORTAL}
                  loadOptions={loadHotelOptions}
                  noOptionsMessage={ASYNC_I18N.noOptionsMessage}
                  loadingMessage={ASYNC_I18N.loadingMessage}
                  placeholder={t("hotel.search_placeholder", { defaultValue: "Найдите отель или введите свой вариант…" })}
                  value={name ? { value: selectedExistingHotel?.hotelId ? `hotel:${selectedExistingHotel.hotelId}` : name, label: name } : null}
                  onChange={async (opt) => {
                    if (opt?.hotelId) {
                      setSelectedExistingHotel(opt);
                      setName(opt.hotelName || opt.label || "");
                      try {
                        const existing = await httpGet(`/api/hotels/${encodeURIComponent(opt.hotelId)}`, { role: "provider" });
                        fillFromHotel(existing);
                      } catch (e) {
                        console.error(e);
                        tError("Отель найден, но не удалось загрузить данные карточки");
                      }
                    } else {
                      setSelectedExistingHotel(null);
                      setName(opt?.hotelName || opt?.value || "");
                    }
                  }}
                  onCreateOption={(input) => { setSelectedExistingHotel(null); setName(input); }}
                  isClearable
                />
                {selectedExistingHotel?.hotelId ? <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">Найден в базе: #{selectedExistingHotel.hotelId} · {selectedExistingHotel.city || "город не указан"}. При сохранении будет создано ваше предложение без дублирования карточки.</div> : null}
              </div>

              <div className="lg:col-span-3">
                <label className={formLabelClass}>{t("contact", { defaultValue: "Контакт" })}</label>
                <input
                  className={formInputClass}
                  value={contact}
                  onChange={(e) => setContact(sanitizeAlnumContact(e.target.value))}
                  inputMode="text"
                  autoComplete="off"
                  placeholder="+998..., email, https://..."
                  maxLength={300}
                />
              </div>

              <div className="lg:col-span-1">
                <label className={formLabelClass}>{t("stars", { defaultValue: "Звёзды" })}</label>
                <input
                  type="number"
                  min={1}
                  max={7}
                  step={1}
                  className={formInputClass}
                  placeholder="1–7"
                  value={stars ?? ""}
                  onChange={(e) => setStars(e.target.value)}
                />
              </div>

              <div className="lg:col-span-2">
                <label className={formLabelClass}>provider_id</label>
                {isAdminLike ? (
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className={formInputClass}
                    placeholder="id владельца"
                    value={providerId ?? ""}
                    onChange={(e) => setProviderId(e.target.value)}
                  />
                ) : (
                  <input className={`${formInputClass} bg-slate-50 text-slate-600`} value={providerId ?? ""} readOnly disabled />
                )}
                <div className="mt-1 text-[11px] font-medium text-slate-500">
                  {isAdminLike ? "Админ может изменить владельца" : "Только админ может менять владельца"}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <div className="lg:col-span-4">
                <label className={formLabelClass}>{t("country", { defaultValue: "Страна" })}</label>
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

              <div className="lg:col-span-4">
                <label className={formLabelClass}>{t("city", { defaultValue: "Город" })}</label>
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
                  <div className="mt-1 text-xs font-medium text-slate-500">
                    Автодополнение городов недоступно: не задан VITE_GEONAMES_USERNAME
                  </div>
                )}
              </div>

              <div className="lg:col-span-2">
                <label className={formLabelClass}>{t("currency", { defaultValue: "Валюта" })}</label>
                <select className={formInputClass} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  <option value="UZS">UZS</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>

              <div className="lg:col-span-12">
                <label className={formLabelClass}>{t("address", { defaultValue: "Адрес" })}</label>
                <input className={formInputClass} value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {activeTab === "taxes" && (
          <div className="space-y-5">
            <h2 className="text-xl font-black tracking-[-0.02em] text-slate-950">
              {t("taxes_fees", { defaultValue: "Налоги и сборы" })}
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">
                <input type="checkbox" checked={vatIncluded} onChange={(e) => setVatIncluded(e.target.checked)} />
                {t("vat_included", { defaultValue: "Цены включают НДС" })}
              </label>
              <div>
                <label className={formLabelClass}>{t("vat_percent", { defaultValue: "НДС, %" })}</label>
                <input type="number" min={0} step="0.1" className={formInputClass} placeholder="%" value={vatRate} onChange={(e) => setVatRate(e.target.value)} />
              </div>
              <div />
              <div>
                <label className={formLabelClass}>
                  {t("tourism_fee_resident", { defaultValue: "Туристический сбор (резидент), /чел/ночь" })} ({currency})
                </label>
                <input type="number" min={0} step="0.01" className={formInputClass} placeholder={currency} value={touristResident} onChange={(e) => setTouristResident(e.target.value)} />
              </div>
              <div>
                <label className={formLabelClass}>
                  {t("tourism_fee_nonresident", { defaultValue: "Туристический сбор (нерезидент), /чел/ночь" })} ({currency})
                </label>
                <input type="number" min={0} step="0.01" className={formInputClass} placeholder={currency} value={touristNonResident} onChange={(e) => setTouristNonResident(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {activeTab === "amenities" && (
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h2 className="text-xl font-black tracking-[-0.02em] text-slate-950">{t("amenities", { defaultValue: "Удобства" })}</h2>
              <form onSubmit={handleAmenityAdd} className="mt-3 flex gap-2">
                <input name="amen" className={formInputClass} placeholder={t("add_amenity", { defaultValue: "Добавить удобство…" })} />
                <button className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white">{t("add", { defaultValue: "Добавить" })}</button>
              </form>
              <div className="mt-3 flex flex-wrap gap-2">
                {amenities.map((a, i) => (
                  <span key={i} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700">
                    {a} <button type="button" className="ml-1 text-slate-400 hover:text-red-600" onClick={() => setAmenities((p) => p.filter((_, idx) => idx !== i))}>×</button>
                  </span>
                ))}
              </div>
            </div>

            <div>
              <h2 className="text-xl font-black tracking-[-0.02em] text-slate-950">{t("services", { defaultValue: "Услуги" })}</h2>
              <form onSubmit={handleServiceAdd} className="mt-3 flex gap-2">
                <input name="serv" className={formInputClass} placeholder={t("add_service", { defaultValue: "Добавить услугу…" })} />
                <button className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white">{t("add", { defaultValue: "Добавить" })}</button>
              </form>
              <div className="mt-3 flex flex-wrap gap-2">
                {services.map((s, i) => (
                  <span key={i} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700">
                    {s} <button type="button" className="ml-1 text-slate-400 hover:text-red-600" onClick={() => setServices((p) => p.filter((_, idx) => idx !== i))}>×</button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "media" && (
          <div className="space-y-4">
            <h2 className="text-xl font-black tracking-[-0.02em] text-slate-950">{t("images", { defaultValue: "Изображения" })}</h2>
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <input id="imagesInput" type="file" accept="image/*" multiple onChange={onImagePick} className="sr-only" />
                <label htmlFor="imagesInput" className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white transition hover:bg-slate-800">
                  {t("choose_files", { defaultValue: "Выбрать файлы" })}
                </label>
                <span className="text-sm font-bold text-slate-600">
                  {images.length > 0
                    ? `${t("file_chosen", { defaultValue: "Файлы выбраны" })}: ${images.length}`
                    : t("no_files_selected", { defaultValue: "Файлы не выбраны" })}
                </span>
              </div>
              <div className="mt-2 text-xs font-medium text-slate-500">
                {t("images_hint", { defaultValue: "До 10 изображений, ≤ 3 МБ каждое" })}
              </div>
            </div>
            {images.length > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
                {images.map((src, i) => (
                  <div key={i} className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <img src={src} alt="" className="h-32 w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setImages((p) => p.filter((_, idx) => idx !== i))}
                      className="absolute right-2 top-2 rounded-full bg-white/95 px-2 py-1 text-xs font-black text-slate-600 shadow-sm transition hover:text-red-600"
                    >
                      ×
                    </button>
                    {i === 0 && (
                      <div className="absolute bottom-2 left-2 rounded-full bg-white/95 px-2 py-1 text-[10px] font-black text-orange-700 shadow-sm">
                        {t("cover", { defaultValue: "Обложка" })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sticky bottom-4 z-20 mt-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm font-bold text-slate-600">
          {isNew ? "Создание новой карточки отеля" : `Отель #${hotelId}`} · {completedCount}/{completionItems.length} заполнено
        </div>
        <div className="flex gap-2">
          {hotelId ? (
            <Link
              to={isAdminLike
                ? `/admin/hotels/${encodeURIComponent(hotelId)}/offers`
                : `/provider/hotels/${encodeURIComponent(hotelId)}/offer`}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-50"
            >
              Фонд и тарифы
            </Link>
          ) : (
            <span className="hidden text-xs font-bold text-slate-500 sm:inline">
              Сначала сохраните карточку, затем настройте фонд и тарифы
            </span>
          )}
          <button onClick={submit} className="rounded-xl bg-orange-600 px-5 py-2 text-sm font-black text-white shadow-sm transition hover:bg-orange-700">
            {t("save", { defaultValue: "Сохранить" })}
          </button>
        </div>
      </div>
    </div>
  );
}
