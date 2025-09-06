//frontend/src/pages/Dashboard.jsx

import React, { useEffect, useState, useRef, useMemo } from "react";
import Select from "react-select";
import AsyncSelect from "react-select/async";
import AsyncCreatableSelect from "react-select/async-creatable";
import axios from "axios";
import { useTranslation } from "react-i18next";
import ProviderStatsHeader from "../components/ProviderStatsHeader";
import ProviderReviews from "../components/ProviderReviews";
import { tSuccess, tError, tInfo, tWarn } from "../shared/toast";
import ProviderCalendar from "../components/ProviderCalendar";


/** ================= Helpers ================= */

// --- money helpers ---
const hasVal = (v) => v !== undefined && v !== null && String(v).trim?.() !== "";

function MoneyField({ label, value, onChange, placeholder }) {
  return (
        <div className="mb-2">
          {label ? <label className="block font-medium mb-1">{label}</label> : null}
          <input
            inputMode="decimal"
            pattern="[0-9,.\s-]*"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full border px-3 py-2 rounded"
          />
        </div>
      );
    }
const parseMoneySafe = (v) => {
  if (!hasVal(v)) return NaN;
  const s = String(v).replace(/\s+/g, "").replace(",", ".");
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
};

// Только цифры, пробел, точка, запятая, минус. Любая буква/символ — ошибка ввода.
const hasInvalidMoneyChars = (v) => hasVal(v) && /[^\d.,\s-]/.test(String(v));
const pick = (...vals) => vals.find((v) => hasVal(v));

const extractPrices = (details) => {
  // Поддерживаем возможные варианты имен полей
  const netRaw = pick(
    details?.netPrice,
    details?.netto,
    details?.net,
    details?.priceNet,
    details?.price_net
  );
  const grossRaw = pick(
    details?.bruttoPrice,
    details?.grossPrice,
    details?.clientPrice,
    details?.priceBrut,
    details?.price_brutto,
    details?.brutto
  );
  const net = parseMoneySafe(netRaw);
  const gross = parseMoneySafe(grossRaw);
  return { netRaw, grossRaw, net, gross };
};

const validateNetGross = (details, t) => {
  const { netRaw, grossRaw, net, gross } = extractPrices(details || {});
    // недопустимые символы — ловим и показываем точную причину
  if (hasInvalidMoneyChars(netRaw)) {
    tError(t("validation.net_invalid_chars", { defaultValue: "Цена нетто: допустимы только цифры, точка или запятая" }));
    return false;
  }
  if (hasInvalidMoneyChars(grossRaw)) {
    tError(t("validation.gross_invalid_chars", { defaultValue: "Цена брутто: допустимы только цифры, точка или запятая" }));
    return false;
  }

  if (!hasVal(netRaw) || Number.isNaN(net)) {
    tError(t("validation.net_required", { defaultValue: "Укажите корректную цену нетто" }));
    return false;
  }
  if (net <= 0) {
    tError(t("validation.net_positive", { defaultValue: "Цена нетто должна быть больше 0" }));
    return false;
  }
  if (!hasVal(grossRaw) || Number.isNaN(gross)) {
    tError(t("validation.gross_required", { defaultValue: "Укажите корректную цену для клиента (брутто)" }));
    return false;
  }
  if (gross <= 0) {
    tError(t("validation.gross_positive", { defaultValue: "Цена для клиента (брутто) должна быть больше 0" }));
    return false;
  }
  if (gross < net) {
    tError(t("validation.gross_ge_net", { defaultValue: "Брутто не может быть меньше нетто" }));
    return false;
  }
  // Мягкое предупреждение на «слишком большую» наценку (опционально)
  if (gross > net * 2) {
    tWarn(t("validation.gross_high", { defaultValue: "Брутто сильно больше нетто — проверьте наценку" }));
  }
  return true;
};


function HotelSelect({ value, onChange, loadOptions, t }) {
  return (
    <AsyncCreatableSelect
      cacheOptions
      defaultOptions
      loadOptions={loadOptions}
      isClearable
      placeholder={t("hotel.search_placeholder") || "Найдите отель или введите свой вариант…"}
      value={value ? { value, label: value } : null}
      onChange={(opt) => onChange(opt?.value || "")}
      onCreateOption={(inputValue) => onChange(inputValue)}
      formatCreateLabel={(inputValue) =>
        `${t("common.add_hotel") || "Добавить"}: "${inputValue}"`
      }
      noOptionsMessage={() => t("hotel.no_options") || "Ничего не найдено"}
      styles={{
        menuPortal: (base) => ({ ...base, zIndex: 9999 }),
      }}
      menuPortalTarget={typeof document !== "undefined" ? document.body : null}
    />
  );
}

// Жёстко приводим к нужным W×H (по умолчанию 1600×1000 ≈ 16:10)
function resizeImageFile(file, targetW = 1600, targetH = 1000, quality = 0.86, mime = "image/jpeg") {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const srcW = img.width, srcH = img.height;
        const targetAR = targetW / targetH;
        const srcAR = srcW / srcH;

        // cover-кроп по центру под целевой аспект
        let sx, sy, sw, sh;
        if (srcAR > targetAR) {
          // источник шире — режем по ширине
          sh = srcH;
          sw = sh * targetAR;
          sx = Math.max(0, (srcW - sw) / 2);
          sy = 0;
        } else {
          // источник уже — режем по высоте
          sw = srcW;
          sh = sw / targetAR;
          sx = 0;
          sy = Math.max(0, (srcH - sh) / 2);
        }

        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
        resolve(canvas.toDataURL(mime, quality));
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/* ===== Доп. полезные хелперы для очистки и «От кого» ===== */
const firstNonEmpty = (...vals) => {
  for (const v of vals) {
    if (v === 0) return 0;
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return null;
};

// NEW: локализованный “первый подходящий перевод”
function makeTr(t) {
return function tr(keys, fallback = "") {
  for (const k of Array.isArray(keys) ? keys : [keys]) {
    const v = t(k, { defaultValue: "" });
    if (v) return v;           // найден перевод
  }
  return fallback;             // дефолт
};
}

// NEW: извлекаем сообщение сервера (если есть)
const pickServerMessage = (err) =>
err?.response?.data?.message || err?.message || "";

// NEW: единая обертка для ошибок API
function toastApiError(t, err, keys, fallback) {
const tr = makeTr(t);
const msg = pickServerMessage(err) || tr(keys, fallback);
tError(msg);
}

// NEW: сахара для success/info/warn
function toastSuccessT(t, keys, fallback) { tSuccess(makeTr(t)(keys, fallback)); }
function toastInfoT(t, keys, fallback)    { tInfo(makeTr(t)(keys, fallback)); }
function toastWarnT(t, keys, fallback)    { tWarn(makeTr(t)(keys, fallback)); }

// Универсально достаём текст ошибки из разных форматов
const extractApiErrorText = (err) => {
  const d = err?.response?.data;
  if (!d) return "";
  if (typeof d === "string") return d;

  const msgs = [];
  if (d.message) msgs.push(String(d.message));
  if (typeof d.error === "string") msgs.push(d.error);

  // express-validator / кастомные массивы
  if (Array.isArray(d.errors)) {
    msgs.push(
      ...d.errors
        .map(e =>
          e?.message || e?.msg || e?.error ||
          (e?.field ? `${e.field}: ${e?.reason || e?.error || "invalid"}` : "")
        )
        .filter(Boolean)
    );
  }

  // Joi/Zod style
  if (Array.isArray(d?.error?.details)) {
    msgs.push(...d.error.details.map(x => x?.message || `${x?.path?.join?.(".")}: ${x?.message || ""}`));
  }
  if (Array.isArray(d.details)) {
    msgs.push(...d.details.map(x => x?.message || String(x)));
  }
  return msgs.filter(Boolean).join("\n");
};


function resolveExpireAtFromService(service) {
  const s = service || {};
  const d = s.details || {};
  const cand = firstNonEmpty(
    s.expires_at, s.expire_at, s.expireAt, s.expiration, s.expiration_at, s.expirationAt,
    d.expires_at, d.expire_at, d.expiresAt, d.expiration, d.expiration_at, d.expirationAt,
    d.expiration_ts, d.expirationTs
  );
  if (cand) {
    const ts = typeof cand === "number" ? (cand > 1e12 ? cand : cand * 1000) : Date.parse(String(cand));
    if (Number.isFinite(ts)) return ts;
  }
  // fallback по датам услуги (отели/перелёты/мероприятия)
  const dates = [
    d.hotel_check_out, d.endFlightDate, d.returnDate, d.end_flight_date,
    s.hotel_check_out, s.endFlightDate, s.returnDate, s.end_flight_date,
  ].filter(Boolean);
  for (const v of dates) {
    const ts = Date.parse(v);
    if (!Number.isNaN(ts)) return ts;
  }
  // TTL (часы) от created_at
  const ttl = d.ttl_hours ?? d.ttlHours ?? s.ttl_hours ?? s.ttlHours;
  if (ttl) {
    const created = Date.parse(d.created_at || s.created_at || s.createdAt);
    if (!Number.isNaN(created)) return created + Number(ttl) * 3600 * 1000;
  }
  return null;
}
function resolveExpireAtFromRequest(req) {
  const cand = firstNonEmpty(
    req?.expires_at, req?.expire_at, req?.expireAt, req?.expiration, req?.expiration_at, req?.expirationAt
  );
  if (cand) {
    const ts = typeof cand === "number" ? (cand > 1e12 ? cand : cand * 1000) : Date.parse(String(cand));
    if (Number.isFinite(ts)) return ts;
  }
  return resolveExpireAtFromService(req?.service);
}
const isExpiredRequest = (req, now = Date.now()) => {
  const ts = resolveExpireAtFromRequest(req);
  return ts ? now > ts : false;
};

/** Редактор изображений (DnD сортировка, удалить, очистить, обложка) */
function ImagesEditor({
  images,
  onUpload,
  onRemove,
  onReorder,
  onClear,
  dragItem,
  dragOverItem,
  onMakeCover,
  t,
}) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-semibold">
          {t("service_images", { defaultValue: "Фото услуги" })}
        </h4>
        {!!images?.length && (
          <button
            type="button"
            className="text-sm text-red-600 hover:underline"
            onClick={() => {
              if (confirm(t("clear_all_images_confirm", { defaultValue: "Удалить все изображения?" }))) {
                onClear?.();
              }
            }}
          >
            {t("clear_all", { defaultValue: "Очистить всё" })}
          </button>
        )}
      </div>

      {images?.length ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {images.map((src, idx) => (
            <div
              key={idx}
              className="relative group border rounded overflow-hidden bg-gray-50"
              draggable
              onDragStart={() => (dragItem.current = idx)}
              onDragEnter={() => (dragOverItem.current = idx)}
              onDragEnd={onReorder}
              onDragOver={(e) => e.preventDefault()}
              title={t("drag_to_reorder", { defaultValue: "Перетащите, чтобы поменять порядок" })}
            >
              <img src={src} alt="" className="w-full h-32 object-cover" />
              <div className="absolute top-1 right-1 flex gap-1">
                {onMakeCover && (
                  <button
                    type="button"
                    className="bg-white/90 border rounded px-2 py-0.5 text-xs shadow hidden group-hover:block"
                    onClick={() => onMakeCover(idx)}
                    title={t("make_cover", { defaultValue: "Сделать обложкой" })}
                  >
                    ★
                  </button>
                )}
                <button
                  type="button"
                  className="bg-white/90 border rounded px-2 py-0.5 text-xs shadow hidden group-hover:block"
                  onClick={() => onRemove(idx)}
                >
                  {t("delete", { defaultValue: "Удалить" })}
                </button>
              </div>
              {idx === 0 && (
                <div className="absolute bottom-1 left-1 text-[10px] px-1.5 py-0.5 bg-white/90 rounded shadow">
                  {t("cover", { defaultValue: "Обложка" })}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-gray-500 mb-2">
          {t("no_images_yet", { defaultValue: "Изображений пока нет" })}
        </div>
      )}

      <div className="mt-3">
        <label className="inline-flex items-center gap-2 bg-orange-500 text-white px-4 py-2 rounded cursor-pointer">
          <input type="file" accept="image/*" multiple onChange={onUpload} className="hidden" />
          {t("choose_files", { defaultValue: "Выбрать файлы" })}
        </label>
        <div className="text-xs text-gray-500 mt-1">
          {t("images_hint", { defaultValue: "До 10 изображений, ≤ 3 МБ каждое" })}
        </div>
      </div>
    </div>
  );
}

// --- min для date / datetime-local (локальное время, без UTC-смещения)
const pad = (n) => String(n).padStart(2, "0");
const todayLocalDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
};
const todayLocalDateTime = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// === Languages dictionaries ===
const LANGUAGE_OPTIONS = [
  { value: "uz", label: "O‘zbekcha" },
  { value: "ru", label: "Русский" },
  { value: "en", label: "English" },
  { value: "tr", label: "Türkçe" },
  { value: "de", label: "Deutsch" },
  { value: "ar", label: "العربية" },
];

const LEVEL_OPTIONS = [
  { value: "basic",        label: "A2 — Basic" },
  { value: "intermediate", label: "B1/B2 — Intermediate" },
  { value: "advanced",     label: "C1/C2 — Advanced" },
  { value: "native",       label: "Native" },
];


/** ================= Main ================= */
const Dashboard = () => {
  const { t } = useTranslation();

  // Profile
  const [profile, setProfile] = useState({});
  const [isEditing, setIsEditing] = useState(false);
  const [newPhoto, setNewPhoto] = useState(null);
  const [newCertificate, setNewCertificate] = useState(null);
  const [newAddress, setNewAddress] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [newSocial, setNewSocial] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [stats, setStats] = useState(null);
  const [langs, setLangs] = useState([]);

  //review
  const providerIdRaw =
  profile?.id ?? localStorage.getItem("provider_id") ?? localStorage.getItem("id");
  const providerId = providerIdRaw != null ? Number(providerIdRaw) : null;
  const hasProviderId = Number.isFinite(providerId) && providerId > 0;

  // TG deep-link для провайдера
  const botUser = import.meta.env.VITE_TG_BOT_USERNAME || "";
  const isTgLinked = Boolean(profile?.telegram_chat_id || profile?.tg_chat_id); // поле придёт из backend профиля
  
  const tgDeepLink = useMemo(() => {
    if (!botUser || !hasProviderId) return null;
    return `https://t.me/${botUser}?start=p_${providerId}`;
  }, [botUser, hasProviderId, providerId]);


  // Services
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState(null);

  // Common fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [availability, setAvailability] = useState([]); // Date[]
  const [images, setImages] = useState([]); // string[] (dataURL/URL)

  const dragItem = useRef(null);
  const dragOverItem = useRef(null);

  // Delete service modal
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [serviceToDelete, setServiceToDelete] = useState(null);

  // Geography
  const [countryOptions, setCountryOptions] = useState([]);
  const [selectedCountry, setSelectedCountry] = useState(null); // {value,label,code}
  const [departureCity, setDepartureCity] = useState(null);
  const [cityOptionsFrom, setCityOptionsFrom] = useState([]);
  const [cityOptionsTo, setCityOptionsTo] = useState([]);

  // Details for agent categories
  const DEFAULT_DETAILS = {
    grossPrice: "",
    direction: "",
    directionCountry: "",
    directionFrom: "",
    directionTo: "",
    startDate: "",
    endDate: "",
    hotel: "",
    accommodation: "",
    accommodationCategory: "",
    adt: "",
    chd: "",
    inf: "",
    food: "",
    halal: false,
    transfer: "",
    changeable: false,
    visaIncluded: false,
    netPrice: "",
    expiration: "",
    isActive: true,
    // flight
    flightType: "one_way",
    oneWay: true,
    airline: "",
    returnDate: "",
    startFlightDate: "",
    endFlightDate: "",
    flightDetails: "",
    flightDetailsText: "",
    // event
    location: "",
    eventName: "",
    eventCategory: "",
    ticketDetails: "",
    // visa
    description: "",
    visaCountry: "",
  };
  const [details, setDetails] = useState(DEFAULT_DETAILS);

  // === Provider Inbox / Bookings ===

  const token = localStorage.getItem("token");
  const config = { headers: { Authorization: `Bearer ${token}` } };

  /** ===== Utils ===== */
    
  const isServiceInactive = (s) => {
    const disabled = s?.details?.isActive === false;
    const ts = resolveExpireAtFromService(s);
    const expired = ts ? Date.now() > ts : false;
    return disabled || expired;
  };

  const toDate = (v) => (v ? (v instanceof Date ? v : new Date(v)) : undefined);

  /** ===== API helpers ===== */
  const API_BASE = import.meta.env.VITE_API_BASE_URL;

  const loadHotelOptions = async (inputValue) => {
    try {
      const res = await axios.get(
        `${API_BASE}/api/hotels/search?query=${encodeURIComponent(inputValue || "")}`
      );
      return (res.data || []).map((x) => ({ value: x.label || x.name || x, label: x.label || x.name || x }));
    } catch (err) {
      console.error("Ошибка загрузки отелей:", err);
      tError(t("hotels_load_error") || "Не удалось загрузить отели");
      return [];
    }
  };

  const loadDepartureCities = async (inputValue) => {
    if (!inputValue) return [];
    try {
      const response = await axios.get("https://secure.geonames.org/searchJSON", {
        params: {
          name_startsWith: inputValue,
          featureClass: "P",
          maxRows: 10,
          username: import.meta.env.VITE_GEONAMES_USERNAME,
        },
      });
      return response.data.geonames.map((city) => ({
        value: city.name,
        label: `${city.name}, ${city.countryName}`,
      }));
    } catch (error) {
      console.error("Ошибка загрузки городов:", error);
      return [];
    }
  };

  const loadCitiesFromInput = async (inputValue) => {
    if (!inputValue) return [];
    try {
      const response = await axios.get("https://secure.geonames.org/searchJSON", {
        params: {
          name_startsWith: inputValue,
          featureClass: "P",
          maxRows: 10,
          username: import.meta.env.VITE_GEONAMES_USERNAME,
        },
      });
      return response.data.geonames.map((city) => ({
        value: city.name,
        label: `${city.name}, ${city.countryName}`,
      }));
    } catch (error) {
      console.error("Ошибка загрузки городов:", error);
      return [];
    }
  };

  /** ===== Images handlers ===== */
  const MAX_FILE_SIZE = 3 * 1024 * 1024; // 3 MB

  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
  
    const freeSlots = Math.max(0, 10 - images.length);
    const toProcess = files.slice(0, freeSlots);
  
    const processed = [];
    for (const f of toProcess) {
      try {
        const dataUrl = await resizeImageFile(f, 1600, 1000, 0.85, "image/jpeg");
        // оценка размера после сжатия
        const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
        const approxBytes = Math.ceil((base64.length * 3) / 4);
        if (approxBytes > MAX_FILE_SIZE) {
          tWarn(t("image_too_big", { defaultValue: `Файл "${f.name}" после сжатия > 3 МБ — пропущен` }));
          continue;
        }
        processed.push(dataUrl);
      } catch {
        // ignore
      }
    }
  
    if (processed.length) setImages((prev) => [...prev, ...processed]);
    e.target.value = "";
  };


  const handleRemoveImage = (index) => setImages((prev) => prev.filter((_, i) => i !== index));

  const handleReorderImages = () => {
    if (dragItem.current == null || dragOverItem.current == null) return;
    setImages((prev) => {
      const copy = [...prev];
      const [m] = copy.splice(dragItem.current, 1);
      copy.splice(dragOverItem.current, 0, m);
      return copy;
    });
    dragItem.current = dragOverItem.current = null;
  };

  const handleClearImages = () => setImages([]);

  const makeCover = (idx) => {
    setImages((prev) => {
      const copy = [...prev];
      const [cover] = copy.splice(idx, 1);
      copy.unshift(cover);
      return copy;
    });
  };

  
  /** ===== Delete service modal ===== */
  const confirmDeleteService = (id) => {
    setServiceToDelete(id);
    setDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = () => {
    if (!serviceToDelete) return;
    axios
      .delete(`${API_BASE}/api/providers/services/${serviceToDelete}`, config)
      .then(() => {
        setServices((prev) => prev.filter((s) => s.id !== serviceToDelete));
        if (selectedService?.id === serviceToDelete) setSelectedService(null);
        tSuccess(t("service_deleted", { defaultValue: "Услуга удалена" }));
      })
      .catch((err) => {
        console.error("Ошибка удаления услуги", err);
        tError(t("delete_error", { defaultValue: "Ошибка удаления услуги" }));
      })
      .finally(() => {
        setDeleteConfirmOpen(false);
        setServiceToDelete(null);
      });
  };

  /** ===== Load dictionaries ===== */
  useEffect(() => {
    const fetchCountries = async () => {
      try {
        const response = await axios.get("https://restcountries.com/v3.1/all?fields=name,cca2");
        const countries = response.data.map((country) => ({
          value: country.name.common,
          label: country.name.common,
          code: country.cca2,
        }));
        setCountryOptions(countries.sort((a, b) => a.label.localeCompare(b.label)));
      } catch (error) {
        console.error("Ошибка загрузки стран:", error);
      }
    };
    fetchCountries();
  }, []);

  // Departure cities (top by population)
  useEffect(() => {
    const fetchCities = async () => {
      try {
        const response = await axios.get("https://secure.geonames.org/searchJSON", {
          params: {
            featureClass: "P",
            maxRows: 100,
            orderby: "population",
            username: import.meta.env.VITE_GEONAMES_USERNAME,
          },
        });
        const cities = response.data.geonames.map((city) => ({
          value: city.name,
          label: city.name,
        }));
        setCityOptionsFrom(cities);
      } catch (error) {
        console.error("Ошибка загрузки городов отправления:", error);
      }
    };
    fetchCities();
  }, []);

  // Arrival cities based on selected country
  useEffect(() => {
    if (!selectedCountry?.code) return;
    const fetchCities = async () => {
      try {
        const response = await axios.get("https://secure.geonames.org/searchJSON", {
          params: {
            country: selectedCountry.code,
            featureClass: "P",
            maxRows: 100,
            username: import.meta.env.VITE_GEONAMES_USERNAME,
          },
        });
        const cities = response.data.geonames.map((city) => ({
          value: city.name,
          label: city.name,
        }));
        setCityOptionsTo(cities);
      } catch (error) {
        console.error("Ошибка загрузки городов прибытия:", error);
      }
    };
    fetchCities();
  }, [selectedCountry]);

      /** ===== Load profile + services + stats ===== */
useEffect(() => {
  // Profile
  axios
    .get(`${API_BASE}/api/providers/profile`, config)
    .then(async (res) => {
      setProfile(res.data || {});
      setLangs(Array.isArray(res.data?.languages) ? res.data.languages : []);
      setNewLocation(res.data?.location || "");
      setNewSocial(res.data?.social || "");
      setNewPhone(res.data?.phone || "");
      setNewAddress(res.data?.address || "");

     })
    .catch((err) => {
      console.error("Ошибка загрузки профиля", err);
      tError(t("profile_load_error") || "Не удалось загрузить профиль");
    });

  // Services
  axios
    .get(`${API_BASE}/api/providers/services`, config)
    .then((res) => setServices(Array.isArray(res.data) ? res.data : []))
    .catch((err) => {
      console.error("Ошибка загрузки услуг", err);
      tError(t("services_load_error") || "Не удалось загрузить услуги");
    });

  // Stats
  axios
    .get(`${API_BASE}/api/providers/stats`, config)
    .then((res) => setStats(res.data || {}))
    .catch(() => setStats({}));
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

  useEffect(() => {
  if (!selectedService) return;
  const d = selectedService.details || {};

  const valCountry = d.directionCountry || d.direction; // что есть
  const co = countryOptions.find(c => c.value === valCountry);
  if (co) setSelectedCountry(co);

  if (d.directionFrom) {
    setDepartureCity({ value: d.directionFrom, label: d.directionFrom });
  }
}, [selectedService, countryOptions]);




  useEffect(() => {
      if (profile?.id) {
        localStorage.setItem("provider_id", String(profile.id));
      }
    }, [profile?.id]);

  
  /** ===== Profile handlers ===== */
 
  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setNewPhoto(reader.result);
    reader.readAsDataURL(file);
  };

  const handleCertificateChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setNewCertificate(reader.result);
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = () => {
    const updated = {};
    if (newLocation !== profile.location) updated.location = newLocation;
    if (newSocial !== profile.social) updated.social = newSocial;
    if (newPhone !== profile.phone) updated.phone = newPhone;
    if (newAddress !== profile.address) updated.address = newAddress;
    if (newPhoto) updated.photo = newPhoto;
    if (newCertificate) updated.certificate = newCertificate;

    const sanitizedLangs = (langs || [])
      .filter(x => x?.code && x?.level)
      .map(x => ({ code: x.code, level: x.level }));
    if (JSON.stringify(sanitizedLangs) !== JSON.stringify(profile.languages || [])) {
      updated.languages = sanitizedLangs;
    }

    if (Object.keys(updated).length === 0) {
      tInfo(t("no_changes") || "Изменений нет");
      return;
    }

    axios
      .put(`${API_BASE}/api/providers/profile`, updated, config)
      .then(() => {
        setProfile((prev) => ({ ...prev, ...updated }));
        setIsEditing(false);
        tSuccess(t("profile_updated") || "Профиль обновлён");
      })
      .catch((err) => {
        console.error("Ошибка обновления профиля", err);
        tError(extractApiErrorText(err) || t("update_error") || "Ошибка обновления профиля");
      });
  };

   const handleChangePassword = () => {
       if (!oldPassword) {
         tWarn(t("enter_current_password") || "Введите текущий пароль");
         return;
       }
       if (!newPassword || newPassword.length < 6) {
         tWarn(t("password_too_short") || "Минимум 6 символов");
         return;
       }
       axios
         .put(`${API_BASE}/api/providers/password`, { oldPassword, newPassword }, config)
         .then(() => {
           setOldPassword("");
           setNewPassword("");
           tSuccess(t("password_changed") || "Пароль обновлён");
         })
         .catch((err) => {
           console.error("Ошибка смены пароля", err);
           // если хочешь показывать серверное сообщение:
           // toastApiError(t, err, ["password_error"], "Ошибка смены пароля");
           tError(extractApiErrorText(err) || t("password_error") || "Ошибка смены пароля");
         });
     };


  /** ===== Service helpers ===== */
  const resetServiceForm = () => {
    setSelectedService(null);
    setTitle("");
    setDescription("");
    setPrice("");
    setCategory("");
    setAvailability([]);
    setImages([]);
    setSelectedCountry(null);     
    setDepartureCity(null); 
    setDetails(DEFAULT_DETAILS);
  };

  const loadServiceToEdit = (service) => {
    setSelectedService(service);
    setCategory(service.category || "");
    setTitle(service.title || "");
    setImages(Array.isArray(service.images) ? service.images : []);
    if (
      ["refused_tour", "author_tour", "refused_hotel", "refused_flight", "refused_event_ticket", "visa_support"].includes(
        service.category
      )
    ) {
      const d = (service && service.details && typeof service.details === "object") ? service.details : {};
      setDetails({
        grossPrice: d.grossPrice ?? "",
        direction: d.direction || "",
        directionCountry: d.directionCountry || "",
        directionFrom: d.directionFrom || "",
        directionTo: d.directionTo || "",
        startDate: d.startDate || "",
        endDate: d.endDate || "",
        hotel: d.hotel || "",
        accommodation: d.accommodation || "",
        accommodationCategory: d.accommodationCategory || "",
        adt: d.adt || "",
        chd: d.chd || "",
        inf: d.inf || "",
        food: d.food || "",
        halal: d.halal || false,
        transfer: d.transfer || "",
        changeable: d.changeable || false,
        visaIncluded: d.visaIncluded || false,
        netPrice: d.netPrice ?? "",
        expiration: d.expiration || "",
        isActive: d.isActive ?? true,
        flightType: d.flightType || "one_way",
        oneWay: d.oneWay ?? (d.flightType !== "round_trip"),
        airline: d.airline || "",
        returnDate: d.returnDate || "",
        startFlightDate: d.startFlightDate || "",
        endFlightDate: d.endFlightDate || "",
        flightDetails: d.flightDetails || "",
        flightDetailsText: d.flightDetailsText || "",
        location: d.location || "",
        eventName: d.eventName || "",
        eventCategory: d.eventCategory || "",
        ticketDetails: d.ticketDetails || "",
        description: d.description || "",
        visaCountry: d.visaCountry || "",
      });
    } else {
      setDescription(service.description || "");
      setPrice(service.price || "");
      const sd = (service && service.details && typeof service.details === "object") ? service.details : {};
      setDetails({ ...DEFAULT_DETAILS, ...sd });
      setAvailability(
        Array.isArray(service.availability)
          ? service.availability.map(toDate)
          : []
      );
    }
  };

  /** ===== Save service (create/update) ===== */
  const handleSaveService = () => {
    const requiredFieldsByCategory = {
      refused_tour: ["title", "details.directionFrom", "details.directionTo", "details.netPrice"],
      author_tour: ["title", "details.directionFrom", "details.directionTo", "details.netPrice"],
      refused_hotel: ["title", "details.direction", "details.directionTo", "details.startDate", "details.endDate", "details.netPrice"],
      refused_flight: ["title", "details.directionFrom", "details.directionTo", "details.startDate", "details.netPrice", "details.airline"],
      refused_event_ticket: ["title", "details.location", "details.startDate", "details.netPrice"],
      visa_support: ["title", "details.description", "details.netPrice"],
    };
    const isExtendedCategory = category in requiredFieldsByCategory;
    const requiredFields = requiredFieldsByCategory[category] || ["title", "description", "category", "price"];

    const getFieldValue = (path) =>
      path.split(".").reduce((obj, key) => obj?.[key], { title, description, category, price, details });

    const hasEmpty = requiredFields.some((field) => {
      const value = getFieldValue(field);
      return value === "" || value === undefined || value === null;
    });

    const needsReturnDate =
      category === "refused_flight" &&
      details.flightType === "round_trip" &&
      (!details.returnDate || details.returnDate === "");

    if (hasEmpty || needsReturnDate) {
      tWarn(t("fill_all_fields") || "Заполните все обязательные поля");
      return;
          }
    if (!isExtendedCategory) {
           const p = parseMoneySafe(price);
           if (!Number.isFinite(p) || p <= 0) {
             tError(t("validation.gross_positive", { defaultValue: "Цена должна быть больше 0" }));
             return;
           }
         }

    // Validate net/gross prices for extended categories
    if (isExtendedCategory) {
      // предпочитаем актуальное состояние формы; если его нет — берем из selectedService
      const detailsToCheck = (details && Object.keys(details).length) ? details : (selectedService?.details || {});
      if (!validateNetGross(detailsToCheck, t)) return;
    }

    const compact = (obj) =>
      Object.fromEntries(
        Object.entries(obj).filter(([_, v]) => {
          if (v === undefined || v === null) return false;
          if (Array.isArray(v)) return v.length > 0;
          if (typeof v === "object") return Object.keys(v).length > 0;
          return true;
        })
      );

    const __grossNum = (() => {
      const g = details?.grossPrice;
      if (!hasVal(g)) return undefined;
      const n = parseMoneySafe(g); // поддерживает "1 200,50"
      return Number.isFinite(n) ? n : undefined;
    })();

    const __netNum = (() => {
      const n = parseMoneySafe(details?.netPrice);
      return Number.isFinite(n) ? n : undefined;
    })();

     const __expTs = (() => {
       if (!hasVal(details?.expiration)) return undefined;
       const d = new Date(details.expiration);
       return Number.isFinite(d.getTime()) ? d.getTime() : undefined;
     })();


    const raw = {
      title,
      category,
      images,
      price: isExtendedCategory ? undefined : price,
      description: isExtendedCategory ? undefined : description,
      availability: isExtendedCategory ? undefined : availability,
      details: isExtendedCategory
      ? {
          ...details,
          ...(__grossNum !== undefined ? { grossPrice: __grossNum } : {}),
          ...(__netNum   !== undefined ? { netPrice:  __netNum   } : {}),
          ...(__expTs   !== undefined ? { expiration_ts: __expTs } : {}),
        }
      : (__grossNum !== undefined ? { grossPrice: __grossNum } : undefined),
    
        };

    const data = compact(raw);

    const req = selectedService
      ? axios.put(
          `${API_BASE}/api/providers/services/${selectedService.id}`,
          data,
          config
        )
      : axios.post(`${API_BASE}/api/providers/services`, data, config);

    req
      .then((res) => {
        if (selectedService) {
          setServices((prev) => prev.map((s) => (s.id === selectedService.id ? res.data : s)));
          tSuccess(t("service_updated") || "Услуга обновлена");
        } else {
          setServices((prev) => [...prev, res.data]);
          tSuccess(t("service_added") || "Услуга добавлена");
        }
        resetServiceForm();
      })
      .catch((err) => {
        console.error(selectedService ? "Ошибка обновления услуги" : "Ошибка добавления услуги", err);
        const text = extractApiErrorText(err);
        const fallback = t(selectedService ? "update_error" : "add_error") || "Ошибка";
        tError(text || fallback);
      });
  };

  /** ===== Render ===== */
  return (
    <>
      <div className="flex flex-col md:flex-row gap-6 p-6 bg-gray-50 min-h-screen">
        {/* Левый блок: профиль */}
        <div className="w-full md:w-1/2 bg-white p-6 rounded-xl shadow-md flex flex-col">
          <div className="flex gap-4">
            <div className="flex flex-col items-center w-1/2">
              {/* Фото */}
              <div className="relative flex flex-col items-center">
                <img
                  src={newPhoto || profile.photo || "https://via.placehold.co/96x96"}
                  className="w-24 h-24 rounded-full object-cover mb-2"
                  alt="Фото"
                />
                {isEditing && (
                  <>
                    <label className="inline-block bg-orange-500 text-white px-4 py-2 rounded cursor-pointer text-sm">
                      {t("choose_files")}
                      <input type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
                    </label>
                    <div className="text-sm text-gray-600 mt-1">
                      {newPhoto ? t("file_chosen") : t("no_files_selected")}
                    </div>
                  </>
                )}
              </div>

              {/* Телефон */}
              <h3 className="font-semibold text-lg mt-6 mb-2">{t("phone")}</h3>
              {isEditing ? (
                <input
                  type="text"
                  placeholder={t("phone")}
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="border px-3 py-2 mb-2 rounded w-full"
                />
              ) : (
                <div className="border px-3 py-2 mb-2 rounded bg-gray-100 w-full text-center">
                  {profile.phone || t("not_specified")}
                </div>
              )}

              {/* Адрес */}
              <h3 className="font-semibold text-lg mb-2">{t("address")}</h3>
              {isEditing ? (
                <input
                  type="text"
                  placeholder={t("address")}
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  className="border px-3 py-2 mb-2 rounded w-full"
                />
              ) : (
                <div className="border px-3 py-2 mb-2 rounded bg-gray-100 w-full text-center">
                  {profile.address || t("not_specified")}
                </div>
              )}

              {/* Карта */}
              {profile.address && !isEditing && (
                <div className="w-full mb-4">
                  <iframe
                    title="provider-map"
                    width="100%"
                    height="200"
                    frameBorder="0"
                    scrolling="no"
                    marginHeight="0"
                    marginWidth="0"
                    className="rounded"
                    src={`https://www.google.com/maps?q=${encodeURIComponent(profile.address)}&output=embed`}
                  />
                </div>
              )}

              {/* Выйти */}
              <button
                onClick={() => {
                  localStorage.removeItem("token");
                  localStorage.removeItem("provider_id");
                  window.location.href = "/login";
                }}
                className="mt-4 bg-red-600 text-white px-4 py-2 rounded font-semibold w-full"
              >
                {t("logout")}
              </button>
            </div>

            {/* Правая часть профиля */}
            <div className="w-1/2 space-y-3">
              <div>
                <label className="block font-medium">{t("name")}</label>
                <div className="border px-3 py-2 rounded bg-gray-100">{profile.name}</div>
              </div>
              <div>
                <label className="block font-medium">{t("type")}</label>
                <div className="border px-3 py-2 rounded bg-gray-100">{t(profile.type)}</div>
              </div>
              <div>
                <label className="block font-medium">{t("location")}</label>
                {isEditing ? (
                  <input
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value)}
                    className="border px-3 py-2 rounded w-full"
                  />
                ) : (
                  <div className="border px-3 py-2 rounded bg-gray-100">{profile.location}</div>
                )}
              </div>
              <div>
                    <label className="block font-medium">{t("social")}</label>
                    {isEditing ? (
                      <>
                        <input
                          value={newSocial}
                          onChange={(e) => setNewSocial(e.target.value)}
                          className="w-full border px-3 py-2 rounded"
                        />
                        {!isTgLinked && tgDeepLink && (
                          <div className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900 ring-1 ring-blue-200">
                            <div className="font-medium mb-1">
                              {t("tg.title", { defaultValue: "Уведомления в Telegram" })}
                            </div>
                            <div className="mb-2">
                              {t("tg.subtitle", {
                                defaultValue:
                                  "Нажмите, чтобы связать Telegram и получать уведомления о заявках и бронированиях.",
                              })}
                            </div>
                            <a
                              href={tgDeepLink}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 font-semibold text-white hover:bg-blue-700"
                            >
                              {t("tg.connect", { defaultValue: "Подключить Telegram" })}
                            </a>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="border px-3 py-2 rounded bg-gray-100">
                        {profile.social || t("not_specified")}
                      </div>
                    )}
                  </div>
                                        {/* Владение языками */}
                          <div>
                            <label className="block font-medium">Языки</label>
                          
                            {isEditing ? (
                              <>
                                {langs.map((row, idx) => (
                                  <div key={idx} className="flex items-center gap-2 mb-2">
                                    <Select
                                      className="flex-1"
                                      options={LANGUAGE_OPTIONS}
                                      value={LANGUAGE_OPTIONS.find(o => o.value === row.code) || null}
                                      onChange={(opt) =>
                                        setLangs(prev => prev.map((x,i) => i === idx ? { ...x, code: opt?.value || "" } : x))
                                      }
                                      placeholder="Язык"
                                    />
                                    <Select
                                      className="flex-1"
                                      options={LEVEL_OPTIONS}
                                      value={LEVEL_OPTIONS.find(o => o.value === row.level) || null}
                                      onChange={(opt) =>
                                        setLangs(prev => prev.map((x,i) => i === idx ? { ...x, level: opt?.value || "" } : x))
                                      }
                                      placeholder="Уровень"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setLangs(prev => prev.filter((_,i) => i !== idx))}
                                      className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300"
                                      title="Удалить"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                ))}
                          
                                <button
                                  type="button"
                                  onClick={() => setLangs(prev => [...prev, { code: "", level: "" }])}
                                  className="mt-1 text-sm text-orange-600 underline"
                                >
                                  + Добавить язык
                                </button>
                              </>
                            ) : (
                              <>
                                {Array.isArray(langs) && langs.length ? (
                                  <ul className="list-disc ml-5 text-sm">
                                    {langs.map((l, i) => {
                                      const langLabel = LANGUAGE_OPTIONS.find(o => o.value === l.code)?.label || l.code;
                                      const levelLabel = LEVEL_OPTIONS.find(o => o.value === l.level)?.label || l.level;
                                      return <li key={i}>{langLabel} — {levelLabel}</li>;
                                    })}
                                  </ul>
                                ) : (
                                  <div className="border px-3 py-2 rounded bg-gray-100">{t("not_specified")}</div>
                                )}
                              </>
                            )}
                          </div>                     

              {/* Сертификат */}
              <div>
                <label className="block font-medium">{t("certificate")}</label>
                {isEditing ? (
                  <div className="flex flex-col gap-2">
                    <label className="inline-block bg-orange-500 text-white px-4 py-2 rounded cursor-pointer text-sm w-fit">
                      {t("choose_files")}
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleCertificateChange} className="hidden" />
                    </label>
                    {newCertificate ? (
                      newCertificate.startsWith("data:image") ? (
                        <img src={newCertificate} alt="Certificate preview" className="w-32 h-32 object-cover border rounded" />
                      ) : (
                        <div className="text-sm text-gray-600">📄 {t("file_chosen")}</div>
                      )
                    ) : (
                      <div className="text-sm text-gray-600">{t("no_files_selected")}</div>
                    )}
                  </div>
                ) : profile.certificate ? (
                  <a href={profile.certificate} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                    {t("view_certificate")}
                  </a>
                ) : (
                  <div className="text-gray-500">{t("not_specified")}</div>
                )}
              </div>

              {/* Кнопка сохранить/редактировать */}
              <button
                onClick={isEditing ? handleSaveProfile : () => setIsEditing(true)}
                className="w-full bg-orange-500 text-white py-2 rounded font-bold mt-2"
              >
                {isEditing ? t("save") : t("edit")}
              </button>

              {/* Смена пароля */}
              <div className="mt-4">
                <h3 className="font-semibold text-lg mb-2">{t("change_password")}</h3>
                <input
                  type="password"
                  placeholder={t("current_password") || "Текущий пароль"}
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  className="border px-3 py-2 mb-2 rounded w-full"
                />
                <input
                  type="password"
                  placeholder={t("new_password")}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="border px-3 py-2 mb-2 rounded w-full"
                />
                <button onClick={handleChangePassword} className="w-full bg-orange-500 text-white py-2 rounded font-bold">
                  {t("change")}
                </button>
              </div>
            </div>
          </div>
          
          {/* Статистика поставщика под двумя колонками */}
          <div className="px-6 mt-6">
            <ProviderStatsHeader
              rating={Number(profile?.rating) || 0}
              stats={{
                requests_total:  Number(stats?.requests_total)  || 0,
                requests_active: Number(stats?.requests_active) || 0,
                bookings_total:  Number(stats?.bookings_total)  || 0,
                completed:       Number(stats?.completed)       || 0,
                cancelled:       Number(stats?.cancelled)       || 0,
                points:          Number(stats?.points) || Number(stats?.completed) || 0,
              }}
              bonusTarget={500}
              t={t}
            />
          </div>

          {/* Отзывы клиентов о провайдере */}
          <div className="px-6 mt-6">
            {hasProviderId ? <ProviderReviews providerId={providerId} t={t} /> : null}
          </div>
        </div>
       
        {/* Правый блок: услуги + входящие/брони */}
        <div className="w-full md:w-1/2 bg-white p-6 rounded-xl shadow-md">
          <div className="mb-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold">{t("services")}</h2>
              {selectedService && (
                <button
                  onClick={resetServiceForm}
                  className="text-sm text-orange-500 underline"
                >
                  {t("back")}
                </button>
              )}
            </div>

            {/* Список услуг */}
            {!selectedService && (
              <div className="mt-4 space-y-2">
                {services.map((s) => (
                  <div
                    key={s.id}
                    className="border rounded-lg p-4 bg-gray-50 cursor-pointer hover:bg-gray-100 transition"
                    onClick={() => loadServiceToEdit(s)}
                  >
                    <div className="flex items-center gap-3">
                      {s.images?.length ? (
                        <img
                          src={s.images[0]}
                          alt=""
                          className="w-12 h-12 object-cover rounded"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded bg-gray-200" />
                      )}
                      <div className="flex-1">
                        <div className="font-bold text-lg">{s.title}</div>
                        <div className="text-sm text-gray-600">{t(`category.${s.category}`)}</div>
                        {isServiceInactive(s) && (
                          <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded bg-gray-200 text-gray-700">
                          {t("not_actual", { defaultValue: "неактуально" })}
                          </span>
                          )}
                        {s.details?.netPrice != null ? (
                          <div className="text-sm text-gray-800">
                            {t("net_price")}: {s.details.netPrice} USD
                          </div>
                        ) : s.price != null ? (
                          <div className="text-sm text-gray-800">
                            {t("price")}: {s.price} USD
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Форма редактирования/создания */}
          {selectedService ? (
            /* ====== Edit form (by category) ====== */
            <>
              <h3 className="text-xl font-semibold mb-2">{t("edit_service")}</h3>

              {/* Общие поля для названия */}
              <div className="mb-2">
                <label className="block font-medium mb-1">{t("title")}</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("title")}
                  className="w-full border px-3 py-2 rounded mb-2"
                />
              </div>

              {/* ----- CATEGORY-SPECIFIC ----- */}
              {["refused_tour", "author_tour"].includes(category) && profile.type === "agent" && (
                <>
                  <div className="flex gap-4 mb-2">
                    <Select
                      options={countryOptions}
                      value={countryOptions.find(c => c.value === details.directionCountry) || null}
                      onChange={(val) => {
                        setSelectedCountry(val);
                        setDetails(d => ({ ...d, directionCountry: val?.value || "" }));
                      }}
                      placeholder={t("direction_country")}
                      noOptionsMessage={() => t("country_not_chosen")}
                      className="w-1/3"
                    />

                    <AsyncSelect
                        cacheOptions
                        defaultOptions
                        loadOptions={loadDepartureCities}
                        value={
                          departureCity
                            || (details.directionFrom
                                  ? { value: details.directionFrom, label: details.directionFrom }
                                  : null)
                        }
                        onChange={(selected) => {
                          setDepartureCity(selected);
                          setDetails((prev) => ({ ...prev, directionFrom: selected?.value || "" }));
                        }}
                        placeholder={t("direction_from")}
                        noOptionsMessage={() => t("direction_from_not_chosen")}
                        className="w-1/3"
                      />

                    <Select
                      options={cityOptionsTo}
                      value={cityOptionsTo.find((opt) => opt.value === details.directionTo) || null}
                      onChange={(value) => setDetails((prev) => ({ ...prev, directionTo: value?.value || "" }))}
                      placeholder={t("direction_to")}
                      noOptionsMessage={() => t("direction_to_not_chosen")}
                      className="w-1/3"
                    />
                  
                    </div>
                    

                  <div className="flex gap-4 mb-2">
                    <div className="w-1/2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t("start_flight_date")}</label>
                      <input
                        type="date"
                        min={todayLocalDate()}
                        value={details.startFlightDate || ""}
                        onChange={(e) => setDetails({ ...details, startFlightDate: e.target.value })}
                        className="w-full border px-3 py-2 rounded"
                      />
                    </div>
                    <div className="w-1/2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t("end_flight_date")}</label>
                      <input
                        type="date"
                        min={details.startFlightDate || todayLocalDate()}   // конец не раньше начала
                        value={details.endFlightDate || ""}
                        onChange={(e) => setDetails({ ...details, endFlightDate: e.target.value })}
                        className="w-full border px-3 py-2 rounded"
                      />
                    </div>
                  </div>

                  <div className="mb-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t("flight_details")}</label>
                    <textarea
                      value={details.flightDetails || ""}
                      onChange={(e) => setDetails({ ...details, flightDetails: e.target.value })}
                      placeholder={t("enter_flight_details")}
                      className="w-full border px-3 py-2 rounded"
                    />
                  </div>

                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("hotel")}</label>
                   
                  <HotelSelect
                     t={t}
                     loadOptions={loadHotelOptions}
                     value={details.hotel}
                     onChange={(hotel) => setDetails((d) => ({ ...d, hotel }))}
                   />

                  <div className="mb-4">
                    <label className="block text-sm font-medium mb-1">{t("accommodation_category")}</label>
                    <input
                      type="text"
                      value={details.accommodationCategory || ""}
                      onChange={(e) => setDetails({ ...details, accommodationCategory: e.target.value })}
                      className="w-full border px-3 py-2 rounded mb-2"
                      placeholder={t("enter_category")}
                    />
                    <label className="block text-sm font-medium mb-1">{t("accommodation")}</label>
                    <input
                      type="text"
                      value={details.accommodation || ""}
                      onChange={(e) => setDetails({ ...details, accommodation: e.target.value })}
                      className="w-full border px-3 py-2 rounded mb-2"
                      placeholder={t("enter_accommodation")}
                    />
                  </div>

                  <div className="mb-2">
                    <label className="block font-medium mb-1">{t("food")}</label>
                    <select
                      value={details.food || ""}
                      onChange={(e) => setDetails({ ...details, food: e.target.value })}
                      className="w-full border px-3 py-2 rounded"
                    >
                      <option value="">{t("food_options.select")}</option>
                      <option value="BB">BB - {t("food_options.bb")}</option>
                      <option value="HB">HB - {t("food_options.hb")}</option>
                      <option value="FB">FB - {t("food_options.fb")}</option>
                      <option value="AI">AI - {t("food_options.ai")}</option>
                      <option value="UAI">UAI - {t("food_options.uai")}</option>
                    </select>
                    <label className="inline-flex items-center mt-2">
                      <input
                        type="checkbox"
                        checked={details.halal || false}
                        onChange={(e) => setDetails({ ...details, halal: e.target.checked })}
                        className="mr-2"
                      />
                      {t("food_options.halal")}
                    </label>
                  </div>

                  <div className="mb-2">
                    <label className="block font-medium mb-1">{t("transfer")}</label>
                    <select
                      value={details.transfer || ""}
                      onChange={(e) => setDetails({ ...details, transfer: e.target.value })}
                      className="w-full border px-3 py-2 rounded"
                    >
                      <option value="">{t("transfer_options.select")}</option>
                      <option value="individual">{t("transfer_options.individual")}</option>
                      <option value="group">{t("transfer_options.group")}</option>
                      <option value="none">{t("transfer_options.none")}</option>
                    </select>
                  </div>

                  <label className="inline-flex items-center mb-2">
                    <input
                      type="checkbox"
                      checked={details.visaIncluded || false}
                      onChange={(e) => setDetails({ ...details, visaIncluded: e.target.checked })}
                      className="mr-2"
                    />
                    {t("visa_included")}
                  </label>
                  <br />
                  <label className="inline-flex items-center mb-2">
                    <input
                      type="checkbox"
                      checked={details.changeable || false}
                      onChange={(e) => setDetails({ ...details, changeable: e.target.checked })}
                      className="mr-2"
                    />
                    {t("changeable")}
                  </label>

                   <MoneyField
                     label={null}
                     value={details.netPrice}
                     onChange={(v) => setDetails({ ...details, netPrice: v })}
                     placeholder={t("net_price")}
                   />
                  
                   <MoneyField
                     value={details.grossPrice}
                     onChange={(v) => setDetails({ ...details, grossPrice: v })}
                     placeholder={t("gross_price")}
                   />
                  
    <label className="block font-medium mt-2 mb-1">{t("expiration_timer")}</label>
                  <input
                    type="datetime-local"
                    step="60"
                    min={todayLocalDateTime()}
                    value={details.expiration || ""}
                    onChange={(e) => setDetails({ ...details, expiration: e.target.value })}
                    className="w-full border px-3 py-2 rounded mb-2"
                  />
                  <label className="inline-flex items-center mb-4">
                    <input
                      type="checkbox"
                      checked={details.isActive || false}
                      onChange={(e) => setDetails({ ...details, isActive: e.target.checked })}
                      className="mr-2"
                    />
                    {t("is_active")}
                  </label>
                </>
              )}

              {category === "refused_hotel" && profile.type === "agent" && (
                <>
                  <div className="mb-2">
                    <label className="block font-medium mb-1">{t("direction_country")}</label>
                    <Select
                      options={countryOptions}
                      value={countryOptions.find((c) => c.value === details.direction)}
                      onChange={(selected) =>
                        setDetails({ ...details, direction: selected?.value || "" })
                      }
                      placeholder={t("direction_country")}
                    />
                  </div>

                  <div className="mb-2">
                    <label className="block font-medium mb-1">{t("refused_hotel_city")}</label>
                    <AsyncSelect
                      cacheOptions
                      loadOptions={loadCitiesFromInput}
                      defaultOptions
                      value={details.directionTo ? { label: details.directionTo, value: details.directionTo } : null}
                      onChange={(selected) =>
                        setDetails({ ...details, directionTo: selected?.value || "" })
                      }
                      placeholder={t("select_city")}
                    />
                  </div>

                  <div className="mb-2">
                    <label className="block font-medium mb-1">{t("refused_hotel_name")}</label>
                      <HotelSelect
                       t={t}
                       loadOptions={loadHotelOptions}
                       value={details.hotel}
                       onChange={(hotel) => setDetails((d) => ({ ...d, hotel }))}
                     />
                  </div>

                  <div className="flex gap-4 mb-2">
                    <div className="w-1/2">
                      <label className="block font-medium mb-1">{t("hotel_check_in")}</label>
                      <input
                        type="date"
                        min={todayLocalDate()}
                        value={details.startDate}
                        onChange={(e) => setDetails({ ...details, startDate: e.target.value })}
                        className="w-full border px-3 py-2 rounded"
                      />
                    </div>
                    <div className="w-1/2">
                      <label className="block font-medium mb-1">{t("hotel_check_out")}</label>
                      <input
                        type="date"
                        min={details.startDate || todayLocalDate()}
                        value={details.endDate}
                        onChange={(e) => setDetails({ ...details, endDate: e.target.value })}
                        className="w-full border px-3 py-2 rounded"
                      />
                    </div>
                  </div>

                  <div className="mb-2">
                    <label className="block font-medium mb-1">{t("accommodation_category")}</label>
                    <input
                      type="text"
                      value={details.accommodationCategory || ""}
                      onChange={(e) => setDetails({ ...details, accommodationCategory: e.target.value })}
                      className="w-full border px-3 py-2 rounded"
                    />
                  </div>

                  <div className="mb-2">
                    <label className="block font-medium mb-1">{t("accommodation")}</label>
                    <input
                      type="text"
                      value={details.accommodation || ""}
                      onChange={(e) => setDetails({ ...details, accommodation: e.target.value })}
                      className="w-full border px-3 py-2 rounded"
                    />
                  </div>

                  <div className="mb-2">
                    <label className="block font-medium mb-1">{t("food")}</label>
                    <select
                      value={details.food || ""}
                      onChange={(e) => setDetails({ ...details, food: e.target.value })}
                      className="w-full border px-3 py-2 rounded"
                    >
                      <option value="">{t("food_options.select")}</option>
                      <option value="BB">{t("food_options.bb")}</option>
                      <option value="HB">{t("food_options.hb")}</option>
                      <option value="FB">{t("food_options.fb")}</option>
                      <option value="AI">{t("food_options.ai")}</option>
                      <option value="UAI">{t("food_options.uai")}</option>
                    </select>
                    <label className="inline-flex items-center mt-2">
                      <input
                        type="checkbox"
                        checked={details.halal || false}
                        onChange={(e) => setDetails({ ...details, halal: e.target.checked })}
                        className="mr-2"
                      />
                      {t("food_options.halal")}
                    </label>
                  </div>

                  <div className="mb-2">
                    <label className="block font-medium mb-1">{t("transfer")}</label>
                    <select
                      value={details.transfer || ""}
                      onChange={(e) => setDetails({ ...details, transfer: e.target.value })}
                      className="w-full border px-3 py-2 rounded"
                    >
                      <option value="">{t("transfer_options.select")}</option>
                      <option value="individual">{t("transfer_options.individual")}</option>
                      <option value="group">{t("transfer_options.group")}</option>
                      <option value="none">{t("transfer_options.none")}</option>
                    </select>
                  </div>

                  <div className="mb-2 flex items-center">
                    <input
                      type="checkbox"
                      checked={details.changeable || false}
                      onChange={(e) => setDetails({ ...details, changeable: e.target.checked })}
                      className="mr-2"
                    />
                    <label>{t("changeable")}</label>
                  </div>

                  <div className="mb-2">
                     <MoneyField
                       label={null}
                       value={details.netPrice}
                       onChange={(v) => setDetails({ ...details, netPrice: v })}
                       placeholder={t("net_price")}
                     />              
                     <MoneyField
                       value={details.grossPrice}
                       onChange={(v) => setDetails({ ...details, grossPrice: v })}
                       placeholder={t("gross_price")}
                     />
                  </div>

                  <div className="mb-2">
                    <label className="block font-medium mb-1">{t("expiration_timer")}</label>
                    <input
                      type="datetime-local"
                      step="60"
                      min={todayLocalDateTime()}
                      value={details.expiration || ""}
                      onChange={(e) => setDetails({ ...details, expiration: e.target.value })}
                      className="w-full border px-3 py-2 rounded"
                    />
                  </div>

                  <div className="mb-4 flex items-center">
                    <input
                      type="checkbox"
                      checked={details.isActive || false}
                      onChange={(e) => setDetails({ ...details, isActive: e.target.checked })}
                      className="mr-2"
                    />
                    <label>{t("is_active")}</label>
                  </div>
                </>
              )}

              {category === "refused_flight" && profile.type === "agent" && (
                <>
                       <div className="flex gap-4 mb-2">
                        <Select
                          options={countryOptions}
                          value={countryOptions.find(c => c.value === details.directionCountry) || null}
                          onChange={(value) => {
                            setSelectedCountry(value);
                            setDetails((prev) => ({
                              ...prev,
                              directionCountry: value?.value || "",
                              direction: `${value?.label || ""} — ${departureCity?.label || ""} → ${details.directionTo || ""}`,
                            }));
                          }}
                          placeholder={t("direction_country")}
                          noOptionsMessage={() => t("country_not_found")}
                          className="w-1/3"
                        />
                        <AsyncSelect
                          cacheOptions
                          defaultOptions
                          loadOptions={loadDepartureCities}
                          value={
                            departureCity
                              || (details.directionFrom
                                    ? { value: details.directionFrom, label: details.directionFrom }
                                    : null)
                          }
                          onChange={(selected) => {
                            setDepartureCity(selected);
                            setDetails((prev) => ({ ...prev, directionFrom: selected?.value || "" }));
                          }}
                          placeholder={t("direction_from")}
                          noOptionsMessage={() => t("direction_from_not_chosen")}
                          className="w-1/3"
                        />

                        <Select
                          options={cityOptionsTo}
                          value={cityOptionsTo.find((opt) => opt.value === details.directionTo) || null}
                          onChange={(value) => {
                            setDetails((prev) => ({
                              ...prev,
                              directionTo: value?.value || "",
                              direction: `${selectedCountry?.label || ""} — ${departureCity?.label || ""} → ${value?.label || ""}`,
                            }));
                          }}
                          placeholder={t("direction_to")}
                          noOptionsMessage={() => t("direction_to_not_found")}
                          className="w-1/3"
                        />
                      </div>

                      <div className="mb-3">
                        <label className="block text-sm font-medium mb-1">{t("flight_type")}</label>
                        <div className="flex gap-4">
                          <label className="inline-flex items-center">
                            <input
                              type="radio"
                              checked={details.flightType === "one_way"}
                              onChange={() =>
                                setDetails({ ...details, flightType: "one_way", oneWay: true, returnDate: "" })
                              }
                              className="mr-2"
                            />
                            {t("one_way")}
                          </label>
                          <label className="inline-flex items-center">
                            <input
                              type="radio"
                              checked={details.flightType === "round_trip"}
                              onChange={() =>
                                setDetails({ ...details, flightType: "round_trip", oneWay: false })
                              }
                              className="mr-2"
                            />
                            {t("round_trip")}
                          </label>
                        </div>
                      </div>

                      <div className="flex gap-4 mb-3">
                        <div className="w-1/2">
                          <label className="block text-sm font-medium mb-1">{t("departure_date")}</label>
                          <input
                            type="date"
                            min={todayLocalDate()}
                            value={details.startDate || ""}
                            onChange={(e) => setDetails({ ...details, startDate: e.target.value })}
                            className="w-full border px-3 py-2 rounded"
                          />
                        </div>
                        {!details.oneWay && (
                          <div className="w-1/2">
                            <label className="block text-sm font-medium mb-1">{t("return_date")}</label>
                            <input
                              type="date"
                              min={details.startDate || todayLocalDate()}
                              value={details.returnDate || ""}
                              onChange={(e) => setDetails({ ...details, returnDate: e.target.value })}
                              className="w-full border px-3 py-2 rounded"
                            />
                          </div>
                        )}
                      </div>

                      <div className="mb-2">
                        <label className="block text-sm font-medium mb-1">{t("airline")}</label>
                        <input
                          type="text"
                          value={details.airline || ""}
                          onChange={(e) => setDetails({ ...details, airline: e.target.value })}
                          placeholder={t("enter_airline")}
                          className="w-full border px-3 py-2 rounded"
                        />
                      </div>

                      <div className="mb-2">
                        <label className="block text-sm font-medium mb-1">{t("flight_details")}</label>
                        <textarea
                          value={details.flightDetails || ""}
                          onChange={(e) => setDetails({ ...details, flightDetails: e.target.value })}
                          placeholder={t("enter_flight_details")}
                          className="w-full border px-3 py-2 rounded"
                        />
                      </div>

                       <MoneyField
                          label={null}
                          value={details.netPrice}
                          onChange={(v) => setDetails({ ...details, netPrice: v })}
                          placeholder={t("net_price")}
                        />                      
                       <MoneyField
                         value={details.grossPrice}
                         onChange={(v) => setDetails({ ...details, grossPrice: v })}
                         placeholder={t("gross_price")}
                       />
                  <div className="mb-3">
                        <label className="block text-sm font-medium mb-1">{t("expiration_timer")}</label>
                        <input
                          type="datetime-local"
                          step="60"
                          min={todayLocalDateTime()}
                          value={details.expiration || ""}
                          onChange={(e) => setDetails({ ...details, expiration: e.target.value })}
                          className="w-full border px-3 py-2 rounded"
                        />
                      </div>

                      <label className="inline-flex items-center mb-4">
                        <input
                          type="checkbox"
                          checked={details.isActive || false}
                          onChange={(e) => setDetails({ ...details, isActive: e.target.checked })}
                          className="mr-2"
                        />
                        {t("is_active")}
                      </label>
                </>
              )}

              {category === "refused_event_ticket" && profile.type === "agent" && (
                <>
                   <Select
                    options={[
                      { value: "concert", label: t("event_category_concert") },
                      { value: "exhibition", label: t("event_category_exhibition") },
                      { value: "show", label: t("event_category_show") },
                      { value: "masterclass", label: t("event_category_masterclass") },
                      { value: "football", label: t("event_category_football") },
                      { value: "fight", label: t("event_category_fight") },
                    ]}
                    value={
                      [
                        { value: "concert", label: t("event_category_concert") },
                        { value: "exhibition", label: t("event_category_exhibition") },
                        { value: "show", label: t("event_category_show") },
                        { value: "masterclass", label: t("event_category_masterclass") },
                        { value: "football", label: t("event_category_football") },
                        { value: "fight", label: t("event_category_fight") },
                      ].find((opt) => opt.value === details.eventCategory) || null
                    }
                    onChange={(selected) => setDetails({ ...details, eventCategory: selected.value })}
                    placeholder={t("select_event_category")}
                    className="mb-2"
                  />

                  <input
                    type="text"
                    value={details.location || ""}
                    onChange={(e) => setDetails({ ...details, location: e.target.value })}
                    placeholder={t("location")}
                    className="w-full border px-3 py-2 rounded mb-2"
                  />

                  <input
                    type="date"
                    min={todayLocalDate()}
                    value={details.startDate || ""}
                    onChange={(e) => setDetails({ ...details, startDate: e.target.value })}
                    placeholder={t("event_date")}
                    className="w-full border px-3 py-2 rounded mb-2"
                  />

                  <input
                    type="text"
                    value={details.ticketDetails || ""}
                    onChange={(e) => setDetails({ ...details, ticketDetails: e.target.value })}
                    placeholder={t("ticket_details")}
                    className="w-full border px-3 py-2 rounded mb-2"
                  />

                   <MoneyField
                          label={null}
                          value={details.netPrice}
                          onChange={(v) => setDetails({ ...details, netPrice: v })}
                          placeholder={t("net_price")}
                    />   
                    <MoneyField
                       value={details.grossPrice}
                       onChange={(v) => setDetails({ ...details, grossPrice: v })}
                       placeholder={t("gross_price")}
                     />
    <label className="inline-flex items-center mb-2">
                    <input
                      type="checkbox"
                      checked={details.isActive || false}
                      onChange={(e) => setDetails({ ...details, isActive: e.target.checked })}
                      className="mr-2"
                    />
                    {t("is_active")}
                  </label>

                  <input
                    type="datetime-local"
                    step="60"
                    min={todayLocalDateTime()}
                    value={details.expiration || ""}
                    onChange={(e) => setDetails({ ...details, expiration: e.target.value })}
                    placeholder={t("expiration_timer")}
                    className="w-full border px-3 py-2 rounded mb-4"
                  />
                </>
              )}

              {category === "visa_support" && profile.type === "agent" && (
                <>
                  <Select
                    options={countryOptions}
                    value={countryOptions.find((option) => option.value === details.visaCountry) || null}
                    onChange={(selected) => setDetails({ ...details, visaCountry: selected?.value })}
                    placeholder={t("select_country")}
                    noOptionsMessage={() => t("country_not_chosen")}
                    className="mb-2"
                  />

                  <textarea
                    value={details.description}
                    onChange={(e) => setDetails({ ...details, description: e.target.value })}
                    placeholder={t("description")}
                    className="w-full border px-3 py-2 rounded mb-2"
                  />

                   <MoneyField
                     label={null}
                     value={details.netPrice}
                     onChange={(v) => setDetails({ ...details, netPrice: v })}
                     placeholder={t("net_price")}
                   />

                  
                   <MoneyField
                     value={details.grossPrice}
                     onChange={(v) => setDetails({ ...details, grossPrice: v })}
                     placeholder={t("gross_price")}
                   />
    <label className="flex items-center space-x-2 mb-2">
                    <input
                      type="checkbox"
                      checked={details.isActive}
                      onChange={(e) => setDetails({ ...details, isActive: e.target.checked })}
                    />
                    <span>{t("is_active")}</span>
                  </label>
                </>
              )}
              {/* Fallback для простых категорий (guide/transport/hotel) в режиме редактирования */}
                {!(
                  ["refused_tour","author_tour","refused_hotel","refused_flight","refused_event_ticket","visa_support"].includes(category)
                  && profile.type === "agent"
                ) && (
                  <>
                    <div className="mb-2">
                      <label className="block font-medium mb-1">{t("description")}</label>
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder={t("description")}
                        className="w-full border px-3 py-2 rounded"
                      />
                    </div>
                
                    <div className="mb-2">
                      <label className="block font-medium mb-1">{t("price")}</label>
                      <MoneyField
                        label={t("price")}
                        value={price}
                        onChange={setPrice}
                        placeholder={t("price")}
                      />
                    </div>
                
                    <div className="mb-2">
                      <label className="block font-medium mb-1">{t("gross_price")}</label>
                      <MoneyField
                        label={t("gross_price")}
                        value={details.grossPrice || ""}
                        onChange={(v) => setDetails({ ...details, grossPrice: v })}
                        placeholder={t("gross_price")}
                      />
                    </div>
                  </>
                )}


              {/* Блок изображений + действия */}
              <ImagesEditor
                images={images}
                onUpload={handleImageUpload}
                onRemove={handleRemoveImage}
                onReorder={handleReorderImages}
                onClear={handleClearImages}
                onMakeCover={makeCover}
                dragItem={dragItem}
                dragOverItem={dragOverItem}
                t={t}
              />

              <button className="w-full bg-orange-500 text-white py-2 rounded font-bold mt-2" onClick={handleSaveService}>
                {t("save_service")}
              </button>
              <button
                className="w-full bg-red-600 text-white py-2 rounded font-bold mt-2 disabled:opacity-60"
                onClick={() => confirmDeleteService(selectedService.id)}
                disabled={!selectedService?.id}
              >
                {t("delete")}
              </button>
            </>
          ) : (
            /* ====== Create form ====== */
            <>
              <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 p-4 rounded mb-4">
                {t("new_service_tip")}
              </div>

              {/* Выбор категории */}
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setSelectedCountry(null);
                  setDepartureCity(null);
                  setTitle("");
                  setDescription("");
                  setPrice("");
                  setAvailability([]);
                  setImages([]);
                  setDetails(DEFAULT_DETAILS);
                }}
                className="w-full border px-3 py-2 rounded mb-4 bg-white"
              >
                <option value="">{t("select_category")}</option>
                {profile.type === "guide" && (
                  <>
                    <option value="city_tour_guide">{t("category.city_tour_guide")}</option>
                    <option value="mountain_tour_guide">{t("category.mountain_tour_guide")}</option>
                  </>
                )}
                {profile.type === "transport" && (
                  <>
                    <option value="city_tour_transport">{t("category.city_tour_transport")}</option>
                    <option value="mountain_tour_transport">{t("category.mountain_tour_transport")}</option>
                    <option value="one_way_transfer">{t("category.one_way_transfer")}</option>
                    <option value="dinner_transfer">{t("category.dinner_transfer")}</option>
                    <option value="border_transfer">{t("category.border_transfer")}</option>
                  </>
                )}
                {profile.type === "agent" && (
                  <>
                    <option value="refused_tour">{t("category.refused_tour")}</option>
                    <option value="refused_hotel">{t("category.refused_hotel")}</option>
                    <option value="refused_flight">{t("category.refused_flight")}</option>
                    <option value="refused_event_ticket">{t("category.refused_event_ticket")}</option>
                    <option value="visa_support">{t("category.visa_support")}</option>
                    <option value="author_tour">{t("category.author_tour")}</option>
                  </>
                )}
                {profile.type === "hotel" && (
                  <>
                    <option value="hotel_room">{t("category.hotel_room")}</option>
                    <option value="hotel_transfer">{t("category.hotel_transfer")}</option>
                    <option value="hall_rent">{t("category.hall_rent")}</option>
                  </>
                )}
              </select>

              {/* Форма для выбранной категории */}
              {category && (
                <>
                  {/* Agent categories */}
                  {(category === "refused_tour" || category === "author_tour") && profile.type === "agent" ? (
                    <>
                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={t("title")}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />

                      <div className="flex gap-4 mb-2">
                        <Select
                          options={countryOptions}
                          value={countryOptions.find(c => c.value === details.directionCountry) || null}
                          onChange={(val) => {
                            setSelectedCountry(val);
                            setDetails(d => ({ ...d, directionCountry: val?.value || "" }));
                          }}
                          placeholder={t("direction_country")}
                          noOptionsMessage={() => t("country_not_chosen")}
                          className="w-1/3"
                        />


                        <AsyncSelect
                          cacheOptions
                          defaultOptions
                          loadOptions={loadDepartureCities}
                          value={
                            departureCity
                              || (details.directionFrom
                                    ? { value: details.directionFrom, label: details.directionFrom }
                                    : null)
                          }
                          onChange={(selected) => {
                            setDepartureCity(selected);
                            setDetails((prev) => ({ ...prev, directionFrom: selected?.value || "" }));
                          }}
                          placeholder={t("direction_from")}
                          noOptionsMessage={() => t("direction_from_not_chosen")}
                          className="w-1/3"
                        />


                        <Select
                          options={cityOptionsTo}
                          value={cityOptionsTo.find((opt) => opt.value === details.directionTo) || null}
                          onChange={(value) => setDetails((prev) => ({ ...prev, directionTo: value?.value || "" }))}
                          placeholder={t("direction_to")}
                          noOptionsMessage={() => t("direction_to_not_chosen")}
                          className="w-1/3"
                        />
                        </div>


                      <div className="flex gap-4 mb-2">
                        <div className="w-1/2">
                          <label className="block text-sm font-medium text-gray-700 mb-1">{t("start_flight_date")}</label>
                          <input
                            type="date"
                            min={todayLocalDate()}
                            value={details.startFlightDate || ""}
                            onChange={(e) => setDetails({ ...details, startFlightDate: e.target.value })}
                            className="w-full border px-3 py-2 rounded"
                          />
                        </div>
                        <div className="w-1/2">
                          <label className="block text-sm font-medium text-gray-700 mb-1">{t("end_flight_date")}</label>
                          <input
                            type="date"
                            min={details.startFlightDate || todayLocalDate()}   // конец не раньше начала
                            value={details.endFlightDate || ""}
                            onChange={(e) => setDetails({ ...details, endFlightDate: e.target.value })}
                            className="w-full border px-3 py-2 rounded"
                          />
                        </div>
                      </div>

                      <div className="mb-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t("flight_details")}</label>
                        <textarea
                          value={details.flightDetails || ""}
                          onChange={(e) => setDetails({ ...details, flightDetails: e.target.value })}
                          placeholder={t("enter_flight_details")}
                          className="w-full border px-3 py-2 rounded"
                        />
                      </div>

                      <label className="block text-sm font-medium text-gray-700 mb-1">{t("hotel")}</label>
                        <HotelSelect
                           t={t}
                           loadOptions={loadHotelOptions}
                           value={details.hotel}
                           onChange={(hotel) => setDetails((d) => ({ ...d, hotel }))}
                         />

                      <div className="mb-4">
                        <label className="block text-sm font-medium mb-1">{t("accommodation_category")}</label>
                        <input
                          type="text"
                          value={details.accommodationCategory || ""}
                          onChange={(e) => setDetails({ ...details, accommodationCategory: e.target.value })}
                          className="w-full border px-3 py-2 rounded mb-2"
                          placeholder={t("enter_category")}
                        />
                        <label className="block text-sm font-medium mb-1">{t("accommodation")}</label>
                        <input
                          type="text"
                          value={details.accommodation || ""}
                          onChange={(e) => setDetails({ ...details, accommodation: e.target.value })}
                          className="w-full border px-3 py-2 rounded mb-2"
                          placeholder={t("enter_accommodation")}
                        />
                      </div>

                      <div className="mb-2">
                        <label className="block font-medium mb-1">{t("food")}</label>
                        <select
                          value={details.food || ""}
                          onChange={(e) => setDetails({ ...details, food: e.target.value })}
                          className="w-full border px-3 py-2 rounded"
                        >
                          <option value="">{t("food_options.select")}</option>
                          <option value="BB">BB - {t("food_options.bb")}</option>
                          <option value="HB">HB - {t("food_options.hb")}</option>
                          <option value="FB">FB - {t("food_options.fb")}</option>
                          <option value="AI">AI - {t("food_options.ai")}</option>
                          <option value="UAI">UAI - {t("food_options.uai")}</option>
                        </select>
                        <label className="inline-flex items-center mt-2">
                          <input
                            type="checkbox"
                            checked={details.halal || false}
                            onChange={(e) => setDetails({ ...details, halal: e.target.checked })}
                            className="mr-2"
                          />
                          {t("food_options.halal")}
                        </label>
                      </div>

                      <div className="mb-2">
                        <label className="block font-medium mb-1">{t("transfer")}</label>
                        <select
                          value={details.transfer || ""}
                          onChange={(e) => setDetails({ ...details, transfer: e.target.value })}
                          className="w-full border px-3 py-2 rounded"
                        >
                          <option value="">{t("transfer_options.select")}</option>
                          <option value="individual">{t("transfer_options.individual")}</option>
                          <option value="group">{t("transfer_options.group")}</option>
                          <option value="none">{t("transfer_options.none")}</option>
                        </select>
                      </div>

                      <label className="inline-flex items-center mb-2">
                        <input
                          type="checkbox"
                          checked={details.visaIncluded || false}
                          onChange={(e) => setDetails({ ...details, visaIncluded: e.target.checked })}
                          className="mr-2"
                        />
                        {t("visa_included")}
                      </label>
                      <br />
                      <label className="inline-flex items-center mb-2">
                        <input
                          type="checkbox"
                          checked={details.changeable || false}
                          onChange={(e) => setDetails({ ...details, changeable: e.target.checked })}
                          className="mr-2"
                        />
                        {t("changeable")}
                      </label>

                       <MoneyField
                         label={null}
                         value={details.netPrice}
                         onChange={(v) => setDetails({ ...details, netPrice: v })}
                         placeholder={t("net_price")}
                       />
                      
                       <MoneyField
                         value={details.grossPrice}
                         onChange={(v) => setDetails({ ...details, grossPrice: v })}
                         placeholder={t("gross_price")}
                       />
    <label className="block font-medium mt-2 mb-1">{t("expiration_timer")}</label>
                      <input
                        type="datetime-local"
                        step="60"
                        min={todayLocalDateTime()}
                        value={details.expiration || ""}
                        onChange={(e) => setDetails({ ...details, expiration: e.target.value })}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />
                      <label className="inline-flex items-center mb-4">
                        <input
                          type="checkbox"
                          checked={details.isActive || false}
                          onChange={(e) => setDetails({ ...details, isActive: e.target.checked })}
                          className="mr-2"
                        />
                        {t("is_active")}
                      </label>
                    </>
                  ) : category === "refused_hotel" && profile.type === "agent" ? (
                    <>
                      <h3 className="text-xl font-semibold mb-2">{t("new_refused_hotel")}</h3>
                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={t("title")}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />

                      <div className="mb-2">
                        <label className="block font-medium mb-1">{t("direction_country")}</label>
                        <Select
                          options={countryOptions}
                          value={countryOptions.find((c) => c.value === details.direction) || null}
                          onChange={(selected) => setDetails({ ...details, direction: selected?.value || "" })}
                          placeholder={t("direction_country")}
                        />
                      </div>

                      <div className="mb-2">
                        <label className="block font-medium mb-1">{t("refused_hotel_city")}</label>
                        <AsyncSelect
                          cacheOptions
                          loadOptions={loadCitiesFromInput}
                          defaultOptions
                          onChange={(selected) => setDetails({ ...details, directionTo: selected?.value || "" })}
                          placeholder={t("refused_hotel_select_city")}
                        />
                      </div>

                      <div className="mb-2">
                       <label className="block font-medium mb-1">{t("refused_hotel_name")}</label>
                          <HotelSelect
                             t={t}
                             loadOptions={loadHotelOptions}
                             value={details.hotel}
                             onChange={(hotel) => setDetails((d) => ({ ...d, hotel }))}
                           />
                      </div>

                      <div className="flex gap-4 mb-2">
                        <div className="w-1/2">
                          <label className="block font-medium mb-1">{t("hotel_check_in")}</label>
                          <input
                            type="date"
                            min={todayLocalDate()}
                            value={details.startDate}
                            onChange={(e) => setDetails({ ...details, startDate: e.target.value })}
                            className="w-full border px-3 py-2 rounded"
                          />
                        </div>
                        <div className="w-1/2">
                          <label className="block font-medium mb-1">{t("hotel_check_out")}</label>
                          <input
                            type="date"
                            min={details.startDate || todayLocalDate()}
                            value={details.endDate}
                            onChange={(e) => setDetails({ ...details, endDate: e.target.value })}
                            className="w-full border px-3 py-2 rounded"
                          />
                        </div>
                      </div>

                      <div className="mb-2">
                        <label className="block font-medium mb-1">{t("accommodation_category")}</label>
                        <input
                          type="text"
                          value={details.accommodationCategory || ""}
                          onChange={(e) => setDetails({ ...details, accommodationCategory: e.target.value })}
                          className="w-full border px-3 py-2 rounded"
                        />
                      </div>

                      <div className="mb-2">
                        <label className="block font-medium mb-1">{t("accommodation")}</label>
                        <input
                          type="text"
                          value={details.accommodation || ""}
                          onChange={(e) => setDetails({ ...details, accommodation: e.target.value })}
                          className="w-full border px-3 py-2 rounded"
                        />
                      </div>

                      <div className="mb-2">
                        <label className="block font-medium mb-1">{t("food")}</label>
                        <select
                          value={details.food || ""}
                          onChange={(e) => setDetails({ ...details, food: e.target.value })}
                          className="w-full border px-3 py-2 rounded"
                        >
                          <option value="">{t("food_options.select")}</option>
                          <option value="BB">{t("food_options.bb")}</option>
                          <option value="HB">{t("food_options.hb")}</option>
                          <option value="FB">{t("food_options.fb")}</option>
                          <option value="AI">{t("food_options.ai")}</option>
                          <option value="UAI">{t("food_options.uai")}</option>
                        </select>
                        <label className="inline-flex items-center mt-2">
                          <input
                            type="checkbox"
                            checked={details.halal || false}
                            onChange={(e) => setDetails({ ...details, halal: e.target.checked })}
                            className="mr-2"
                          />
                          {t("food_options.halal")}
                        </label>
                      </div>

                      <div className="mb-2">
                        <label className="block font-medium mb-1">{t("transfer")}</label>
                        <select
                          value={details.transfer || ""}
                          onChange={(e) => setDetails({ ...details, transfer: e.target.value })}
                          className="w-full border px-3 py-2 rounded"
                        >
                          <option value="">{t("transfer_options.select")}</option>
                          <option value="individual">{t("transfer_options.individual")}</option>
                          <option value="group">{t("transfer_options.group")}</option>
                          <option value="none">{t("transfer_options.none")}</option>
                        </select>
                      </div>

                      <div className="mb-2 flex items-center">
                        <input
                          type="checkbox"
                          checked={details.changeable || false}
                          onChange={(e) => setDetails({ ...details, changeable: e.target.checked })}
                          className="mr-2"
                        />
                        <label>{t("changeable")}</label>
                      </div>

                    <div className="mb-2">
                        
                        <MoneyField
                          label={null}
                          value={details.netPrice}
                          onChange={(v) => setDetails({ ...details, netPrice: v })}
                          placeholder={t("net_price")}
                        />
                         
                        <MoneyField
                           value={details.grossPrice}
                           onChange={(v) => setDetails({ ...details, grossPrice: v })}
                           placeholder={t("gross_price")}
                         />
                      </div>

                      <div className="mb-2">
                        <label className="block font-medium mb-1">{t("expiration_timer")}</label>
                        <input
                          type="datetime-local"
                          step="60"
                          min={todayLocalDateTime()}
                          value={details.expiration || ""}
                          onChange={(e) => setDetails({ ...details, expiration: e.target.value })}
                          className="w-full border px-3 py-2 rounded"
                        />
                      </div>

                      <div className="mb-4 flex items-center">
                        <input
                          type="checkbox"
                          checked={details.isActive || false}
                          onChange={(e) => setDetails({ ...details, isActive: e.target.checked })}
                          className="mr-2"
                        />
                        <label>{t("is_active")}</label>
                      </div>
                    </>
                  ) : category === "refused_flight" && profile.type === "agent" ? (
                    <>
                      <h3 className="text-xl font-semibold mb-2">{t("new_refused_airtkt")}</h3>

                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={t("title")}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />

                      <div className="flex gap-4 mb-2">
                        <Select
                          options={countryOptions}
                          value={countryOptions.find(c => c.value === details.directionCountry) || null}
                          onChange={(value) => {
                            setSelectedCountry(value);
                            setDetails((prev) => ({
                              ...prev,
                              directionCountry: value?.value || "",
                              direction: `${value?.label || ""} — ${departureCity?.label || ""} → ${details.directionTo || ""}`,
                            }));
                          }}
                          placeholder={t("direction_country")}
                          noOptionsMessage={() => t("country_not_found")}
                          className="w-1/3"
                        />

                        <AsyncSelect
                          cacheOptions
                          defaultOptions
                          loadOptions={loadDepartureCities}
                          value={
                            departureCity
                              || (details.directionFrom
                                    ? { value: details.directionFrom, label: details.directionFrom }
                                    : null)
                          }
                          onChange={(selected) => {
                            setDepartureCity(selected);
                            setDetails((prev) => ({
                              ...prev,
                              directionFrom: selected?.value || "",
                              direction: `${selectedCountry?.label || ""} — ${selected?.label || ""} → ${details.directionTo || ""}`,
                            }));
                          }}
                          placeholder={t("direction_from")}
                          noOptionsMessage={() => t("direction_from_not_found")}
                          className="w-1/3"
                        />
                        <Select
                          options={cityOptionsTo}
                          value={cityOptionsTo.find((opt) => opt.value === details.directionTo) || null}
                          onChange={(value) => {
                            setDetails((prev) => ({
                              ...prev,
                              directionTo: value?.value || "",
                              direction: `${selectedCountry?.label || ""} — ${departureCity?.label || ""} → ${value?.label || ""}`,
                            }));
                          }}
                          placeholder={t("direction_to")}
                          noOptionsMessage={() => t("direction_to_not_found")}
                          className="w-1/3"
                        />
                      </div>

                      <div className="mb-3">
                        <label className="block text-sm font-medium mb-1">{t("flight_type")}</label>
                        <div className="flex gap-4">
                          <label className="inline-flex items-center">
                            <input
                              type="radio"
                              checked={details.flightType === "one_way"}
                              onChange={() =>
                                setDetails({ ...details, flightType: "one_way", oneWay: true, returnDate: "" })
                              }
                              className="mr-2"
                            />
                            {t("one_way")}
                          </label>
                          <label className="inline-flex items-center">
                            <input
                              type="radio"
                              checked={details.flightType === "round_trip"}
                              onChange={() =>
                                setDetails({ ...details, flightType: "round_trip", oneWay: false })
                              }
                              className="mr-2"
                            />
                            {t("round_trip")}
                          </label>
                        </div>
                      </div>

                      <div className="flex gap-4 mb-3">
                        <div className="w-1/2">
                          <label className="block text-sm font-medium mb-1">{t("departure_date")}</label>
                          <input
                            type="date"
                            value={details.startDate || ""}
                            onChange={(e) => setDetails({ ...details, startDate: e.target.value })}
                            className="w-full border px-3 py-2 rounded"
                          />
                        </div>
                        {!details.oneWay && (
                          <div className="w-1/2">
                            <label className="block text-sm font-medium mb-1">{t("return_date")}</label>
                            <input
                              type="date"
                              min={details.startDate || todayLocalDate()}
                              value={details.returnDate || ""}
                              onChange={(e) => setDetails({ ...details, returnDate: e.target.value })}
                              className="w-full border px-3 py-2 rounded"
                            />
                          </div>
                        )}
                      </div>

                      <div className="mb-2">
                        <label className="block text-sm font-medium mb-1">{t("airline")}</label>
                        <input
                          type="text"
                          value={details.airline || ""}
                          onChange={(e) => setDetails({ ...details, airline: e.target.value })}
                          placeholder={t("enter_airline")}
                          className="w-full border px-3 py-2 rounded"
                        />
                      </div>

                      <div className="mb-2">
                        <label className="block text-sm font-medium mb-1">{t("flight_details")}</label>
                        <textarea
                          value={details.flightDetails || ""}
                          onChange={(e) => setDetails({ ...details, flightDetails: e.target.value })}
                          placeholder={t("enter_flight_details")}
                          className="w-full border px-3 py-2 rounded"
                        />
                      </div>

                       <MoneyField
                          label={null}
                          value={details.netPrice}
                          onChange={(v) => setDetails({ ...details, netPrice: v })}
                          placeholder={t("net_price")}
                        />

                      
                       <MoneyField
                           value={details.grossPrice}
                           onChange={(v) => setDetails({ ...details, grossPrice: v })}
                           placeholder={t("gross_price")}
                         />
    <div className="mb-3">
                        <label className="block text-sm font-medium mb-1">{t("expiration_timer")}</label>
                        <input
                          type="datetime-local"
                          step="60"
                          min={todayLocalDateTime()}
                          value={details.expiration || ""}
                          onChange={(e) => setDetails({ ...details, expiration: e.target.value })}
                          className="w-full border px-3 py-2 rounded"
                        />
                      </div>

                      <label className="inline-flex items-center mb-4">
                        <input
                          type="checkbox"
                          checked={details.isActive || false}
                          onChange={(e) => setDetails({ ...details, isActive: e.target.checked })}
                          className="mr-2"
                        />
                        {t("is_active")}
                      </label>
                    </>
                  ) : category === "refused_event_ticket" && profile.type === "agent" ? (
                    <>
                      <h3 className="text-xl font-semibold mb-2">{t("new_refused_event_ticket")}</h3>

                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={t("event_name")}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />

                      <Select
                        options={[
                          { value: "concert", label: t("event_category_concert") },
                          { value: "exhibition", label: t("event_category_exhibition") },
                          { value: "show", label: t("event_category_show") },
                          { value: "masterclass", label: t("event_category_masterclass") },
                          { value: "football", label: t("event_category_football") },
                          { value: "fight", label: t("event_category_fight") },
                        ]}
                        value={
                          [
                            { value: "concert", label: t("event_category_concert") },
                            { value: "exhibition", label: t("event_category_exhibition") },
                            { value: "show", label: t("event_category_show") },
                            { value: "masterclass", label: t("event_category_masterclass") },
                            { value: "football", label: t("event_category_football") },
                            { value: "fight", label: t("event_category_fight") },
                          ].find((opt) => opt.value === details.eventCategory) || null
                        }
                        onChange={(selected) => setDetails({ ...details, eventCategory: selected.value })}
                        placeholder={t("select_event_category")}
                        className="mb-2"
                      />

                      <input
                        type="text"
                        value={details.location || ""}
                        onChange={(e) => setDetails({ ...details, location: e.target.value })}
                        placeholder={t("location")}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />

                      <input
                        type="date"
                        value={details.startDate || ""}
                        onChange={(e) => setDetails({ ...details, startDate: e.target.value })}
                        placeholder={t("event_date")}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />

                       <MoneyField
                         label={null}
                         value={details.netPrice}
                         onChange={(v) => setDetails({ ...details, netPrice: v })}
                         placeholder={t("net_price")}
                       />

                       <MoneyField
                           value={details.grossPrice}
                           onChange={(v) => setDetails({ ...details, grossPrice: v })}
                           placeholder={t("gross_price")}
                        />

                      
                      
    <label className="inline-flex items-center mb-2">
                        <input
                          type="checkbox"
                          checked={details.isActive || false}
                          onChange={(e) => setDetails({ ...details, isActive: e.target.checked })}
                          className="mr-2"
                        />
                        {t("is_active")}
                      </label>

                      <input
                        type="datetime-local"
                        step="60"
                        min={todayLocalDateTime()}
                        value={details.expiration || ""}
                        onChange={(e) => setDetails({ ...details, expiration: e.target.value })}
                        placeholder={t("expiration_timer")}
                        className="w-full border px-3 py-2 rounded mb-4"
                      />
                    </>
                  ) : category === "visa_support" && profile.type === "agent" ? (
                    <>
                      <h3 className="text-xl font-bold text-orange-600 mb-4">{t("new_visa_support")}</h3>

                      <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={t("title")}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />

                      <Select
                        options={countryOptions}
                        value={countryOptions.find((option) => option.value === details.visaCountry) || null}
                        onChange={(selected) => setDetails({ ...details, visaCountry: selected?.value })}
                        placeholder={t("select_country")}
                        noOptionsMessage={() => t("country_not_chosen")}
                        className="mb-2"
                      />

                      <textarea
                        value={details.description}
                        onChange={(e) => setDetails({ ...details, description: e.target.value })}
                        placeholder={t("description")}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />

                      <MoneyField
                         label={null}
                         value={details.netPrice}
                         onChange={(v) => setDetails({ ...details, netPrice: v })}
                         placeholder={t("net_price")}
                       />

                       <MoneyField
                           value={details.grossPrice}
                           onChange={(v) => setDetails({ ...details, grossPrice: v })}
                           placeholder={t("gross_price")}
                        />
    <label className="flex items-center space-x-2 mb-2">
                        <input
                          type="checkbox"
                          checked={details.isActive}
                          onChange={(e) => setDetails({ ...details, isActive: e.target.checked })}
                        />
                        <span>{t("is_active")}</span>
                      </label>
                    </>
                  ) : (
                    /* Simple/other categories (guide/transport/hotel) */
                    <>
                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={t("title")}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder={t("description")}
                        className="w-full border px-3 py-2 rounded mb-2"
                      />
                      <MoneyField
                        label={null}
                        value={price}
                        onChange={setPrice}
                        placeholder={t("price")}
                      />
                    
                      <MoneyField
                        label={null}
                        value={details.grossPrice || ""}
                        onChange={(v) => setDetails({ ...details, grossPrice: v })}
                        placeholder={t("gross_price")}
                      />
    </>
                  )}

                  {/* Блок изображений */}
                  <ImagesEditor
                    images={images}
                    onUpload={handleImageUpload}
                    onRemove={handleRemoveImage}
                    onReorder={handleReorderImages}
                    onClear={handleClearImages}
                    onMakeCover={makeCover}
                    dragItem={dragItem}
                    dragOverItem={dragOverItem}
                    t={t}
                  />

                  <div className="flex gap-4">
                    <button className="w-full bg-orange-500 text-white py-2 rounded font-bold" onClick={handleSaveService}>
                      {t("save_service")}
                    </button>
                    {selectedService?.id && (
                      <button
                        className="w-full bg-red-600 text-white py-2 rounded font-bold"
                        onClick={() => confirmDeleteService(selectedService.id)}
                      >
                        {t("delete")}
                      </button>
                    )}
                  </div>
                </>
              )}
            </>
          )}

         
        </div>
      </div>

      {/* МОДАЛКА УДАЛЕНИЯ УСЛУГИ */}
      {deleteConfirmOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 shadow-xl w-[90%] max-w-sm">
            <h2 className="text-lg font-bold mb-4">
              {t("confirm_delete", { defaultValue: "Удалить услугу?" })}
            </h2>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmOpen(false)}
                className="px-4 py-2 rounded-md bg-gray-200 hover:bg-gray-300"
              >
                {t("cancel", { defaultValue: "Отмена" })}
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-700"
              >
                {t("ok", { defaultValue: "Удалить" })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Календарь блокировок (guide/transport) */}
      {(profile.type === "guide" || profile.type === "transport") && (
        <div className="px-6 pb-10">
          <div className="mt-10 bg-white p-6 rounded shadow border max-w-3xl mx-auto">
            <ProviderCalendar token={token} />
          </div>
        </div>
      )}
    </>
  );
};

export default Dashboard;
