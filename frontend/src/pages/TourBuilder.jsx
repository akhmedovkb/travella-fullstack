// frontend/src/pages/TourBuilder.jsx

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import { listTemplates, getTemplate, syncTemplates } from "../store/templates"; // [TPL]
import AsyncSelect from "react-select/async";
import { components as SelectComponents } from "react-select";
import { useTranslation } from "react-i18next";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { pickProviderService } from "../utils/pickProviderService";
import { enUS, ru as ruLocale, uz as uzLocale } from "date-fns/locale";
import BookingResultModal from "../components/tourbuilder/BookingResultModal";
import HotelQuoteConfirmModal from "../components/tourbuilder/HotelQuoteConfirmModal";
import TourDayTimeline, { normalizeScheduleItems } from "../components/tourbuilder/TourDayTimeline";
import TransportSegmentEditor from "../components/tourbuilder/TransportSegmentEditor";
import { ArrowRight, BedDouble, BusFront, Check, Circle, Landmark, MapPin, MoreHorizontal, ReceiptText, Sparkles, Utensils, UserRound } from "lucide-react";
import {
  GUIDE_CATEGORY_IDS,
  TRANSPORT_CATEGORY_IDS,
  PROVIDER_SERVICE_LABELS,
  TOUR_BUILDER_TYPES,
  TOUR_BUILDER_GROUPS,
  TRANSPORT_BUILDER_TYPES,
} from "../config/providerServiceCatalog";


const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const debounce = (fn, ms=300) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

/* ---------------- brand colors ---------------- */
const BRAND = {
  primary: "#FF5722",  // ключевой акцент
  accent:  "#FFAD7A",  // бордеры/hover
  sand:    "#FFEAD2",  // фон карточек дня
  gray:    "#F1F1F1",  // фон блоков итогов
};

/* ---------------- intercity transfer types ---------------- */
/* ---------------- per-day meals ---------------- */
const MEAL_TYPES = [
  { id: "lunch" },  // tb.meal_types.lunch
  { id: "dinner" }, // tb.meal_types.dinner
  { id: "gala" },   // tb.meal_types.gala
];

const TRANSPORT_SERVICE_TYPES = TRANSPORT_BUILDER_TYPES;

/* ---------------- react-select styles (белый фон выпадашки) --------------- */
const RS_STYLES = {
  menuPortal: (b) => ({ ...b, zIndex: 9999 }),
  // контейнер меню — без скролла, скроллим список внутри
  // меню не должно резать портированный тултип (он fixed и в body),
  // так что overflow можно не задавать
  menu: (b) => ({ ...b, backgroundColor: "#fff" }),
  // прокрутка списка опций
  menuList: (b) => ({
    ...b,
    backgroundColor: "#fff",
    maxHeight: 320,        // высота выпадашки ~ 320px
    overflowY: "auto",     // скроллим список
    paddingRight: 0,
  }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isFocused ? BRAND.sand : "#fff",
    color: "#111827",
  }),
  control: (b, s) => ({
    ...b,
    backgroundColor: "#fff",
    borderColor: s.isFocused ? BRAND.accent : `${BRAND.accent}66`,
    boxShadow: s.isFocused ? "0 0 0 2px rgba(255,173,122,.25)" : "none",
    ":hover": { borderColor: BRAND.accent },
  }),
};

/* ---------------- utils ---------------- */
const toNum = (v, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);
const ymd = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    const day = String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${day}`;
  };
const parseYmdLocal = (value) => {
  const [y, m, d] = String(value || "").split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(y, m - 1, d);
};
const timeFromFlightDateTime = (value) => {
  const match = String(value || "").match(/[T ](\d{2}:\d{2})/);
  return match?.[1] || "";
};
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays     = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysInclusive = (a, b) => {
  if (!a || !b) return 0;
  const from = startOfDay(a);
  const to   = startOfDay(b);
  return 1 + Math.max(0, Math.floor((to - from) / 86400000));
};

// Нормализованный пустой диапазон (чтобы состояние не становилось undefined)
const EMPTY_RANGE = { from: undefined, to: undefined };

/* --------- helpers для маршрута (from_city / to_city / legs[]) --------- */
const sortedDayKeys = (obj = {}) => Object.keys(obj || {}).sort();
const computeRouteCities = (stateByDay = {}) => {
  const keys = sortedDayKeys(stateByDay);
  if (!keys.length) return { from: "", to: "" };
  const first = keys[0], last = keys[keys.length - 1];
  const from = (stateByDay[first]?.city || "").trim();
  const to   = (stateByDay[last]?.city  || "").trim();
  return { from, to };
};
const buildLegsFromByDay = (stateByDay = {}) => {
  const keys = sortedDayKeys(stateByDay);
  const legs = [];
  for (let i = 1; i < keys.length; i++) {
    const prev = stateByDay[keys[i - 1]] || {};
    const cur  = stateByDay[keys[i]]     || {};
    const from = (prev?.city || "").trim();
    const to   = (cur?.city  || "").trim();
    if (from && to && from !== to) {
      legs.push({ from, to, date: keys[i] }); // YYYY-MM-DD
    }
  }
  return legs;
};
const buildTransportSegments = (stateByDay = {}) =>
  Object.entries(stateByDay)
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .flatMap(([date, state]) => {
      const legacy = Array.isArray(state?.transfers) ? state.transfers : [];
      const flights = normalizeScheduleItems(state?.schedule)
        .map((item) => item?.services?.transport?.flight)
        .filter(Boolean);
      const rail = normalizeScheduleItems(state?.schedule)
        .map((item) => item?.services?.transport?.rail)
        .filter(Boolean);
      return [...legacy, ...flights, ...rail].map((segment, index) => ({
      id: `${date}-${index + 1}`,
      date,
      mode: String(segment?.type || "car"),
      provider: String(segment?.provider || "manual"),
      from: String(segment?.from || "").trim(),
      to: String(segment?.to || "").trim(),
      departure_at: segment?.departure_at || null,
      arrival_at: segment?.arrival_at || null,
      carrier: String(segment?.carrier || "").trim(),
      number: String(segment?.number || "").trim(),
      cabin_class: String(segment?.cabin_class || "").trim(),
      baggage: String(segment?.baggage || "").trim(),
      price: toNum(segment?.price, 0),
      currency: String(segment?.currency || "UZS"),
      per_pax: Boolean(segment?.perPax),
      raw_offer_id: segment?.raw_offer_id || null,
      offer_expires_at: segment?.offer_expires_at || null,
      segments: Array.isArray(segment?.segments) ? segment.segments : [],
      }));
    })
    .filter((segment) => segment.from || segment.to);
/* ---------------- categories / labels (для выпадашек услуг) ---------------- */
const CATEGORY_LABELS = PROVIDER_SERVICE_LABELS;

const GUIDE_ALLOWED = new Set(GUIDE_CATEGORY_IDS);
const TRANSPORT_ALLOWED = new Set(TRANSPORT_CATEGORY_IDS);

// массивы для утилиты подбора
const GUIDE_ALLOWED_ARR = GUIDE_CATEGORY_IDS;
const TRANSPORT_ALLOWED_ARR = TRANSPORT_CATEGORY_IDS;
/* helpers для фильтрации услуг под PAX и город */
const svcSeats = (s) =>
  toNum(s?.raw?.details?.seats ?? s?.details?.seats ?? NaN, NaN);
const svcCity = (s) =>
  (s?.raw?.details?.city_slug ?? s?.details?.city_slug ?? "").toString().trim().toLowerCase();
// модель авто хранится наверху записи услуги; оставим fallback через details
const svcModel = (s) =>
  (s?.raw?.vehicle_model ?? s?.vehicle_model ?? s?.raw?.details?.vehicle_model ?? "")
    .toString()
    .trim();
const fitsPax = (s, pax) => {
  const n = svcSeats(s);
  // Для транспортных услуг вместимость ОБЯЗАТЕЛЬНА, для чисто гидских — игнорируем
  if (TRANSPORT_ALLOWED.has(s?.category)) return Number.isFinite(n) && n >= pax;
  return true;
};
const fitsCity = (s, citySlug) => {
  const cs = (citySlug || "").toString().trim().toLowerCase();
  const v = svcCity(s);
  return !v || !cs ? true : v === cs;
};
const svcRoute = (s) => {
  const details = s?.raw?.details || s?.details || {};
  return {
    from: String(details.origin_city || "").trim().toLowerCase(),
    to: String(details.destination_city || "").trim().toLowerCase(),
  };
};
const fitsRoute = (s, fromCity, toCity) => {
  const from = String(fromCity || "").trim().toLowerCase();
  const to = String(toCity || "").trim().toLowerCase();
  if (!from || !to) return false;
  const route = svcRoute(s);
  if (!route.from && !route.to) return fitsCity(s, fromCity);
  return route.from === from && route.to === to;
};

// Человеческая подпись услуги: добавляем модель и места (pax)
const labelForService = (s) => {
  const title = (s.title || CATEGORY_LABELS[s.category] || "Услуга");
  const model = svcModel(s);
  const seats = svcSeats(s);
  const parts = [title];
  if (model) parts.push(model);
  if (Number.isFinite(seats)) parts.push(`${seats} pax`);
  parts.push(`${Number(s.price || 0).toFixed(2)} ${s.currency || "UZS"}`);
  return parts.join(" — ");
};
/**
 * Проверяет, подходит ли провайдер под условия (есть хоть одна услуга с достаточной вместимостью).
 * kind: 'guide' | 'transport'
 */
const providerMatchesByPaxCity = async ({
  provider,
  kind,
  citySlug,
  fromCity,
  toCity,
  pax,
  ensureServicesLoaded,
  allowedCategories,
}) => {
  if (!provider?.id) return false;
  const list = await ensureServicesLoaded(provider);
  if (!Array.isArray(list) || !list.length) return false;
  const allowedSet = allowedCategories ? new Set(allowedCategories) : (kind === "transport" ? TRANSPORT_ALLOWED : GUIDE_ALLOWED);
  return list.some((s) => {
    // s может быть нормализованной услугой (из normalizeService), а сырые поля лежат в s.raw
    const raw = s?.raw || s;
    const category = raw?.category || s?.category;
    if (!allowedSet.has(category)) return false;
    if (fromCity || toCity) {
      if (!fitsRoute(raw, fromCity, toCity)) return false;
    } else if (!fitsCity(raw, citySlug)) return false;
    return fitsPax(raw, pax);
  });
};

/* ---------------- Day kind (на будущее для entry) ---------------- */
const dkey = (d) => ymd(new Date(d));
const isWeekend = (d) => [0, 6].includes(new Date(d).getDay());
const HOLIDAYS = [];
const isHoliday = (d) => HOLIDAYS.includes(dkey(d));
const dayKind = (d) => (isHoliday(d) ? "hd" : isWeekend(d) ? "we" : "wk");

/* ---------------- ISO-639-1 ---------------- */
const LANGS = [
  ["English","en"],["Русский","ru"],["Oʻzbekcha","uz"],
  ["Deutsch","de"],["Français","fr"],["Español","es"],["Italiano","it"],
  ["中文 (Chinese)","zh"],["العربية (Arabic)","ar"],["Türkçe","tr"],
  ["한국어 (Korean)","ko"],["日本語 (Japanese)","ja"],["Português","pt"],
  ["हिन्दी (Hindi)","hi"],["فارسی (Persian)","fa"],["Bahasa Indonesia","id"],
  ["Українська","uk"],["Polski","pl"],["Češtина","cs"],["Română","ro"],
  ["Ελληνικά","el"],["עברית","he"],["বাংলা","bn"],["ქართული","ka"],
  ["Азәрбајҹан","az"],["Հայերեն","hy"],["Қазақша","kk"],["Кыргызча","ky"],
  ["Қарақалпақ","kaa"],["Монгол","mn"],
];

const TB_PROGRAM_LANGS = ["ru", "en", "uz"];
const emptyProgramI18n = () => ({ ru: "", en: "", uz: "" });
const createEmptyTourDayState = (overrides = {}) => ({
  city: "",
  guide: null,
  transport: null,
  hotel: null,
  guideService: null,
  transportService: null,
  entrySelected: [],
  transfers: [],
  meals: [],
  program_i18n: emptyProgramI18n(),
  schedule: [],
  selectedScheduleId: null,
  _programTab: "ru",
  ...overrides,
});
const normalizeProgramI18n = (value = {}) => ({
  ru: String(value?.ru || ""),
  en: String(value?.en || ""),
  uz: String(value?.uz || ""),
});
const pickProgramText = (program = {}, preferredLang = "ru") => {
  const lang = String(preferredLang || "ru").slice(0, 2).toLowerCase();
  const order = Array.from(new Set([lang, "ru", "en", "uz"]));
  for (const code of order) {
    const text = String(program?.[code] || "").trim();
    if (text) return text;
  }
  return "";
};

const hasProgramText = (program = {}) =>
  TB_PROGRAM_LANGS.some((code) => String(program?.[code] || "").trim());

const firstText = (...vals) => {
  for (const v of vals) {
    const str = String(v ?? "").trim();
    if (str) return str;
  }
  return "";
};

const listText = (items = [], fallback = "") => {
  const arr = (Array.isArray(items) ? items : [])
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  return arr.length ? arr.join(", ") : fallback;
};

const entryNameForLang = (entry, lang = "ru") => {
  const raw = entry?.raw || entry || {};
  if (lang === "en") return firstText(raw.name_en, raw.title_en, raw.name, raw.name_ru, raw.name_uz, entry?.label);
  if (lang === "uz") return firstText(raw.name_uz, raw.title_uz, raw.name, raw.name_ru, raw.name_en, entry?.label);
  return firstText(raw.name_ru, raw.title_ru, raw.name, raw.name_en, raw.name_uz, entry?.label);
};

const mealLabelForLang = (type, lang = "ru") => {
  const key = String(type || "").toLowerCase();
  const dict = {
    ru: { lunch: "обед", dinner: "ужин", gala: "гала-ужин" },
    en: { lunch: "lunch", dinner: "dinner", gala: "gala dinner" },
    uz: { lunch: "tushlik", dinner: "kechki ovqat", gala: "gala-kechki ovqat" },
  };
  return dict[lang]?.[key] || dict.ru[key] || key;
};

const transferTypeForLang = (type, lang = "ru") => {
  const key = String(type || "car").toLowerCase();
  const dict = {
    ru: { car: "комфортабельный автомобиль", train: "поезд", air: "авиаперелёт" },
    en: { car: "comfortable vehicle", train: "train", air: "flight" },
    uz: { car: "qulay avtomobil", train: "poyezd", air: "aviaqatnov" },
  };
  return dict[lang]?.[key] || dict.ru[key] || key;
};

const serviceTitle = (svc) => firstText(
  svc?.title,
  svc?.raw?.title,
  CATEGORY_LABELS[svc?.category],
  CATEGORY_LABELS[svc?.raw?.category]
);

const hotelName = (st) => firstText(st?.hotel?.name, st?.hotel?.label, st?.hotel?.raw?.name, st?.hotel?.raw?.title);
const guideName = (st) => firstText(st?.guide?.name, st?.guide?.label, st?.guide?.raw?.name);
const transportName = (st) => firstText(st?.transport?.name, st?.transport?.label, st?.transport?.raw?.name);
const vehicleText = (st) => firstText(
  svcModel(st?.transportService),
  st?.transportService?.vehicle_model,
  st?.transportService?.raw?.vehicle_model,
  st?.transportService?.raw?.details?.vehicle_model
);

const buildAutoProgramI18n = ({
  dayNumber,
  totalDays,
  date,
  city,
  prevCity,
  nextCity,
  dayData = {},
  pax = 1,
}) => {
  const safeCity = String(city || dayData?.city || "").trim();
  const cityRu = safeCity || "город по маршруту";
  const cityEn = safeCity || "the route city";
  const cityUz = safeCity || "yo'nalish shahri";
  const dayLabel = `D${dayNumber}`;
  const datePart = date ? ` (${date})` : "";
  const isFirst = dayNumber === 1;
  const isLast = dayNumber === totalDays;
  const prev = String(prevCity || "").trim();
  const next = String(nextCity || "").trim();
  const hasTransferIn = prev && safeCity && prev !== safeCity;
  const hasTransferOut = next && safeCity && next !== safeCity;

  const gName = guideName(dayData);
  const gService = serviceTitle(dayData?.guideService);
  const tName = transportName(dayData);
  const tService = serviceTitle(dayData?.transportService);
  const car = vehicleText(dayData);
  const hName = hotelName(dayData);
  const entriesRu = (dayData?.entrySelected || []).map((x) => entryNameForLang(x, "ru")).filter(Boolean);
  const entriesEn = (dayData?.entrySelected || []).map((x) => entryNameForLang(x, "en")).filter(Boolean);
  const entriesUz = (dayData?.entrySelected || []).map((x) => entryNameForLang(x, "uz")).filter(Boolean);
  const mealsRu = (dayData?.meals || []).map((x) => mealLabelForLang(x?.type, "ru")).filter(Boolean);
  const mealsEn = (dayData?.meals || []).map((x) => mealLabelForLang(x?.type, "en")).filter(Boolean);
  const mealsUz = (dayData?.meals || []).map((x) => mealLabelForLang(x?.type, "uz")).filter(Boolean);
  const transfers = Array.isArray(dayData?.transfers) ? dayData.transfers : [];
  const scheduleItems = normalizeScheduleItems(dayData?.schedule);
  const scheduleTitle = (item, language) => {
    const category = item.active_service_category;
    const subtype = item.services?.transport?.subtype;
    const flight = item.services?.transport?.flight;
    const labels = {
      ru: { transfer: "Комфортный трансфер", hotel: "Размещение в отеле", tour: "Знакомство с городом", meal: "Гастрономическая пауза", flight: "Перелёт", intercity: "Междугородний трансфер", hotelTransfer: "Встреча и трансфер в отель" },
      en: { transfer: "Comfortable transfer", hotel: "Hotel check-in", tour: "City discovery", meal: "Dining experience", flight: "Flight", intercity: "Intercity transfer", hotelTransfer: "Meet-and-greet and hotel transfer" },
      uz: { transfer: "Qulay transfer", hotel: "Mehmonxonaga joylashish", tour: "Shahar bilan tanishuv", meal: "Gastronomik tanaffus", flight: "Parvoz", intercity: "Shaharlararo transfer", hotelTransfer: "Kutib olish va mehmonxonaga transfer" },
    }[language];
    if (subtype === "international" || flight?.raw_offer_id) {
      const route = [flight?.from, flight?.to].filter(Boolean).join(" → ");
      return [labels.flight, route].filter(Boolean).join(": ");
    }
    if (subtype === "hotel") return labels.hotelTransfer;
    if (subtype === "intercity") return labels.intercity;
    if (category === "hotel") return item.services?.hotel?.provider_name ? `${labels.hotel}: ${item.services.hotel.provider_name}` : labels.hotel;
    if (category === "tour") return labels.tour;
    if (category === "meal") return labels.meal;
    return labels.transfer;
  };
  const itineraryFor = (language) => scheduleItems.map((item) =>
    `${item.start_time}–${item.end_time} — ${scheduleTitle(item, language)}`
  );

  const transferRu = transfers
    .map((tr) => {
      const from = firstText(tr?.from);
      const to = firstText(tr?.to);
      if (!from && !to) return "";
      return `${from || cityRu} → ${to || cityRu} (${transferTypeForLang(tr?.type, "ru")})`;
    })
    .filter(Boolean);
  const transferEn = transfers
    .map((tr) => {
      const from = firstText(tr?.from);
      const to = firstText(tr?.to);
      if (!from && !to) return "";
      return `${from || cityEn} → ${to || cityEn} (${transferTypeForLang(tr?.type, "en")})`;
    })
    .filter(Boolean);
  const transferUz = transfers
    .map((tr) => {
      const from = firstText(tr?.from);
      const to = firstText(tr?.to);
      if (!from && !to) return "";
      return `${from || cityUz} → ${to || cityUz} (${transferTypeForLang(tr?.type, "uz")})`;
    })
    .filter(Boolean);

  const paxTextRu = Number(pax) > 0 ? `Группа: ${pax} чел.` : "";
  const paxTextEn = Number(pax) > 0 ? `Group size: ${pax} pax.` : "";
  const paxTextUz = Number(pax) > 0 ? `Guruh: ${pax} kishi.` : "";

  const ruLines = [
    `${dayLabel}${datePart}. ${cityRu} — яркое начало путешествия`,
    isFirst
      ? `Первый день мягко вводит гостей в атмосферу ${cityRu}: встреча, продуманная логистика и первые впечатления без спешки после дороги.`
      : hasTransferIn
      ? `После переезда из ${prev} гостей ждёт комфортное знакомство с ${cityRu} и насыщенная программа в удобном темпе.`
      : `Этот день раскрывает характер ${cityRu} через его главные места, живые истории и приятный ритм путешествия.`,
    itineraryFor("ru").length ? `Маршрут дня:\n${itineraryFor("ru").join("\n")}` : "",
    entriesRu.length
      ? `Главные впечатления: ${listText(entriesRu)}. На каждой локации предусмотрено достаточно времени, чтобы увидеть главное, сделать фотографии и почувствовать атмосферу места.`
      : "",
    gName || gService
      ? `Гид поможет увидеть больше, чем обычный турист: добавит контекст, местные истории и детали, которые делают прогулку по-настоящему запоминающейся.`
      : "",
    hName ? `Для отдыха выбран ${hName} — удобная точка, чтобы восстановиться и продолжить путешествие с новыми силами.` : "",
    mealsRu.length ? `В программу включено питание: ${listText(mealsRu)} — приятная пауза и возможность познакомиться с местной кухней.` : "",
    hasTransferOut
      ? `Во второй половине дня — подготовка к дальнейшему маршруту и переезду в ${next}.`
      : isLast
      ? `Финал путешествия оставляет время для любимых мест, покупок и последних фотографий перед спокойным выездом.`
      : `День завершается без спешки: останется время для прогулки, отдыха и собственных открытий. Все ключевые перемещения уже продуманы.`,
  ];

  const enLines = [
    `${dayLabel}${datePart}. ${cityEn} — a memorable day ahead`,
    isFirst
      ? `Meet-and-greet, short orientation briefing and a smooth start of the journey${hName ? ` with accommodation at ${hName}` : ""}.`
      : hasTransferIn
      ? `Transfer from ${prev} to ${cityEn}. Upon arrival, the day continues at a relaxed and well-paced rhythm.`
      : `The day is designed as a refined introduction to ${cityEn}, combining comfort, highlights and a balanced pace.`,
    itineraryFor("en").length ? `Today's journey:\n${itineraryFor("en").join("\n")}` : "",
    gName || gService
      ? `The sightseeing program is arranged${gName ? ` with guide ${gName}` : ""}${gService ? `: ${gService}` : ""}. The route focuses on the city atmosphere, signature locations and clear storytelling without rushing the group.`
      : `The program is planned as a premium city experience: key locations, photo stops, free time and a comfortable travel rhythm.`,
    entriesEn.length
      ? `Included visits: ${listText(entriesEn)}. The timing is planned to keep the experience informative, elegant and comfortable.`
      : "",
    tName || tService || car ? `All key transfers are arranged in advance, keeping the day smooth and effortless.` : "",
    transferEn.length ? `Additional transfers of the day: ${listText(transferEn)}.` : "",
    hName ? `Accommodation/program hotel: ${hName}.` : "",
    mealsEn.length ? `Meals included in the program: ${listText(mealsEn)}.` : "",
    hasTransferOut
      ? `In the second half of the day, preparation for the onward route and transfer to ${next}.`
      : isLast
      ? `Final day of the program: free time for last walks, shopping and relaxed preparation for departure.`
      : `At the end of the day, free time for walking, photos, rest or optional activities according to the group's preference.`,
  ];

  const uzLines = [
    `${dayLabel}${datePart}. ${cityUz} — yorqin taassurotlar kuni`,
    isFirst
      ? `Guruhni kutib olish, qisqa tashkiliy ma'lumot va yo'nalishni qulay boshlash${hName ? `, ${hName} mehmonxonasiga joylashish bilan` : ""}.`
      : hasTransferIn
      ? `${prev} shahridan ${cityUz} shahriga yo'l olish. Yetib kelgach, kun dasturi sokin va qulay ritmda davom etadi.`
      : `Kun ${cityUz} shahri bilan qulay va mazmunli tanishuvga bag'ishlanadi.`,
    itineraryFor("uz").length ? `Kun yo'nalishi:\n${itineraryFor("uz").join("\n")}` : "",
    gName || gService
      ? `Ekskursiya qismi${gName ? ` gid ${gName} bilan` : ""}${gService ? `: ${gService}` : ""} tashkil etiladi. Marshrut shahar muhitini his qilish, asosiy lokatsiyalar va tushunarli hikoya qilishga qaratilgan.`
      : `Kun dasturi premium city experience formatida tuzilgan: asosiy joylar, foto-to'xtashlar, bo'sh vaqt va shoshilmasdan sayohat qilish ritmi.`,
    entriesUz.length
      ? `Dasturga tashriflar kiritilgan: ${listText(entriesUz)}. Vaqt guruh uchun qulay va mazmunli bo'lishi uchun muvozanatli rejalashtiriladi.`
      : "",
    tName || tService || car ? `Barcha asosiy transferlar oldindan rejalashtirilgan, shu sababli kun qulay va shoshilmasdan o'tadi.` : "",
    transferUz.length ? `Kun davomida qo'shimcha transferlar: ${listText(transferUz)}.` : "",
    hName ? `Dastur bo'yicha mehmonxona: ${hName}.` : "",
    mealsUz.length ? `Dastur bo'yicha ovqatlanish: ${listText(mealsUz)}.` : "",
    hasTransferOut
      ? `Kunning ikkinchi yarmida keyingi yo'nalish va ${next} shahriga transferga tayyorgarlik.`
      : isLast
      ? `Dastur yakuni: oxirgi sayrlar, xaridlar va jo'nashga sokin tayyorgarlik uchun bo'sh vaqt.`
      : `Kun yakunida sayr, suratga tushish, dam olish yoki guruh xohishiga ko'ra qo'shimcha faoliyatlar uchun bo'sh vaqt.`,
  ];

  return {
    ru: ruLines.filter(Boolean).join("\n"),
    en: enLines.filter(Boolean).join("\n"),
    uz: uzLines.filter(Boolean).join("\n"),
  };
};

/* ---------------- fetch helpers ---------------- */
// заголовки авторизации (безопасно для SSR)
const authHeaders = () => {
  try {
    if (typeof window === "undefined") return {};
    const tok =
      localStorage.getItem("token") ||
      localStorage.getItem("providerToken") ||
      "";
    return tok ? { Authorization: `Bearer ${tok}` } : {};
  } catch {
    return {};
  }
};

const fetchJSON = async (path, params = {}) => {
  const base =
    API_BASE ||
    (typeof window !== "undefined" ? window.frontend?.API_BASE : "") ||
    "";
  const u = new URL(path, base);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, v);
  });
  const r = await fetch(u.toString(), {
    credentials: "include",
    headers: { ...authHeaders() },
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
};

const fetchJSONLoose = async (path, params = {}) => {
  try {
    return await fetchJSON(path, params);
  } catch {
    return null;               // не падаем на 404/500 — просто идём к следующему варианту
  }
};

// ------ helpers: POST JSON (с куками) и понятными ошибками ------
const postJSON = async (path, body) => {
  const base =
    API_BASE ||
    (typeof window !== "undefined" ? window.frontend?.API_BASE : "") ||
    "";
  const u = new URL(path, base);
  const r = await fetch(u.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...authHeaders() },
    credentials: "include",
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) {
    // Попробуем вытащить полезный текст/JSON
    let details = "";
    try {
      const data = await r.json();
      if (data?.message) details = data.message;
      else if (data?.error) details = data.error;
      else if (Array.isArray(data?.errors)) details = data.errors.join("; ");
      else details = JSON.stringify(data);
    } catch {
      details = await r.text().catch(() => "");
    }
    const msg = [`HTTP ${r.status}`, details].filter(Boolean).join(" ");
    const err = new Error(msg);
    err.status = r.status;
    err.details = details;
    throw err;
  }
  return await r.json().catch(() => ({}));
}

const patchJSON = async (path, body) => {
  const base = API_BASE || (typeof window !== "undefined" ? window.frontend?.API_BASE : "") || "";
  const response = await fetch(new URL(path, base).toString(), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...authHeaders() },
    credentials: "include",
    body: JSON.stringify(body || {}),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
  }
  return response.json().catch(() => ({}));
};

// ------ Bookings API ------
// POST /api/bookings
// body: { provider_id, service_id?, dates:[YYYY-MM-DD], message?, attachments?, currency?, source?, group_id? }
async function createBooking(payload) {
  return await postJSON("/api/bookings", payload);
}

async function createTourPackage(payload) {
  return postJSON("/api/tour-packages", payload);
}

async function updateTourPackage(id, payload) {
  return patchJSON(`/api/tour-packages/${id}`, payload);
}

// ------ Совместимость: бронирования с фоллбеком на /api/requests ------
// Если новый эндпоинт не принимает (400/404/405), пробуем старый формат запросов.
const createBookingCompat = createBooking; // временно без фоллбэка

// --- Hotels (city cascade + hotel brief + supplier offers) ---
// starsFilter: '' | 1..7
async function fetchHotelsByCity(city, starsFilter = "") {
  if (!city) return [];
    // если бэкенд поддерживает фильтр — он применится; если нет — отфильтруем ниже
  const rows = await fetchJSON("/api/hotels/by-city", {
    city, stars: starsFilter || undefined
  });
  // приведение к options для react-select
  return (Array.isArray(rows) ? rows : []).map(h => ({
    value: h.id,
    label: `${h.name}${(h.city || h.location) ? " — " + (h.city || h.location) : ""}`,
    raw: { ...h, city: h.city || h.location }, // на всякий случай приводим city
  }));
}

// матчинг звёзд ('' = любая)
const matchStars = (hotelStars, filter) => {
  if (filter === "" || filter === null || filter === undefined) return true;
  const n = Number(hotelStars), f = Number(filter);
  return Number.isFinite(n) && Number.isFinite(f) ? n === f : false;
};

async function fetchHotelBrief(hotelId) {
  return await fetchJSON(`/api/hotels/${hotelId}/brief`);
}

async function fetchHotelOffers(hotelId, date, residency) {
  const data = await fetchJSON(`/api/hotels/${hotelId}/offers`, { status: "active", date, residency });
  return Array.isArray(data?.items) ? data.items : [];
}

function pickBestHotelOffer(offers = [], usdRate = 0) {
  const candidates = [...offers].filter((offer) => Number(offer.rate_count || 0) > 0);
  const currencies = new Set(candidates.map((offer) => String(offer.currency || "UZS").toUpperCase()));
  const canComparePrice = currencies.size <= 1 || Number(usdRate) > 0;
  const comparablePrice = (offer) => {
    const amount = Number(offer.min_rate || Number.MAX_SAFE_INTEGER);
    return String(offer.currency || "UZS").toUpperCase() === "UZS" && Number(usdRate) > 0 ? amount / Number(usdRate) : amount;
  };
  return candidates
    .sort((a, b) => {
      const stockA = offerAvailabilityRank(a);
      const stockB = offerAvailabilityRank(b);
      if (stockA !== stockB) return stockA - stockB;
      const availabilityA = a.unlimited_allotment || a.has_allotment ? 0 : 1;
      const availabilityB = b.unlimited_allotment || b.has_allotment ? 0 : 1;
      if (availabilityA !== availabilityB) return availabilityA - availabilityB;
      if (canComparePrice) {
        const priceA = comparablePrice(a);
        const priceB = comparablePrice(b);
        if (priceA !== priceB) return priceA - priceB;
      }
      return Number(b.is_direct === true) - Number(a.is_direct === true);
    })[0] || null;
}

function offerAvailabilityRank(offer) {
  if (offer?.availability_known !== true) return 1;
  return Number(offer.available_rooms || 0) > 0 ? 0 : 2;
}

function offerAvailabilityText(offer, t) {
  if (offer?.availability_known !== true) return t("tb.ui.availability_on_request");
  const rooms = Array.isArray(offer.availability_by_room) ? offer.availability_by_room : [];
  const availableRooms = rooms.filter((room) => Number(room?.available || 0) > 0);
  if (!availableRooms.length) return t("tb.ui.no_availability");
  return availableRooms.map((room) => `${room.room_type}: ${Number(room.available)}`).join(" · ");
}

async function fetchHotelQuote(payload) {
  return await postJSON("/api/hotels/quote", payload);
}

function hotelQuoteWarningText(warning, t) {
  const value = String(warning || "");
  if (value === "room_required" || value === "не выбран номер") return t("tb.ui.warning_room_required");
  if (value === "offer_required" || value === "не выбран тариф поставщика") return t("tb.ui.warning_offer_required");
  if (value === "dates_required" || value === "не выбраны даты") return t("tb.ui.warning_dates_required");
  if (value === "quote_failed") return t("tb.ui.warning_quote_failed");
  if (value === "usd_rate_required") return t("tb.ui.warning_usd_rate_required");
  if (value.startsWith("room_not_found:")) return t("tb.ui.warning_room_not_found", { room: value.slice("room_not_found:".length) });
  if (value.startsWith("room_stock_exceeded:")) return t("tb.ui.warning_room_stock_exceeded", { room: value.slice("room_stock_exceeded:".length) });
  if (value.startsWith("stop_sell:")) return t("tb.ui.warning_stop_sell", { room: value.slice("stop_sell:".length) });
  if (value.startsWith("min_stay_not_met:")) return t("tb.ui.warning_min_stay_not_met", { value: value.slice("min_stay_not_met:".length) });
  if (value.startsWith("min_stay:")) {
    const [, room, nights] = value.split(":");
    return t("tb.ui.warning_min_stay", { nights: nights || "?", room: room || "" });
  }
  if (value.startsWith("rate_missing:")) {
    const [, date, room, meal] = value.split(":");
    return t("tb.ui.warning_rate_missing", { room: room || t("tb.rooms"), meal: meal || t("tb.meals"), date: date || "—" });
  }
  if (value.startsWith("unsupported_currency:")) return t("tb.ui.warning_unsupported_currency", { currency: value.split(":")[1] || "" });
  return value || t("tb.ui.warning_check_hotel_rate");
}

const normalizeProvider = (row, kind) => ({
  id: row.id ?? row._id ?? String(Math.random()),
  name: row.name || "—",
  kind,
  phone: row.phone || "",
  email: row.email || "",
  location: row.location || row.city || "",
  price_per_day: toNum(row.price_per_day ?? row.price ?? row.rate_day ?? 0, 0),
  currency: row.currency || "UZS",
  languages: row.languages || [],
  telegram: row.telegram || row.social || row.telegram_handle || "",
  quality_rating: Number(row.quality_rating || 0),
  reliability_rating: Number(row.reliability_rating || 0),
  performance_review_count: Number(row.performance_review_count || 0),
});

let supplierPerformanceCache = null;
let supplierPerformanceRequest = null;
async function loadSupplierPerformance() {
  if (supplierPerformanceCache) return supplierPerformanceCache;
  if (!supplierPerformanceRequest) supplierPerformanceRequest = fetchJSON("/api/tour-packages/supplier-performance")
    .then((data) => new Map((data?.items || []).map((item) => [String(item.provider_id), item])))
    .catch(() => new Map())
    .then((value) => { supplierPerformanceCache = value; return value; });
  return supplierPerformanceRequest;
}

const withSupplierPerformance = (row, performance) => ({
  ...row,
  quality_rating: performance?.quality_rating,
  reliability_rating: performance?.reliability_rating,
  performance_review_count: performance?.review_count,
});

const normalizeService = (row) => {
  const details = row?.details || {};
  const price = Number(details.grossPrice) || Number(row?.price) || 0;
  const currency = details.currency || row?.currency || "UZS";

const realId = row?.id ?? row?._id ?? null; // ← только реальный id
  // источник модели: provider_services.vehicle_model (приоритет),
  // затем детали, если вдруг где-то так сохранили
const vehicleModel =
    row?.vehicle_model ||
    details?.vehicle_model ||
    details?.model ||
    row?.model ||
    null;
  return {
    id: realId,
    title: row?.title || CATEGORY_LABELS[row?.category] || "Услуга",
    category: row?.category || "",
    price: toNum(price, 0),
    currency,
    vehicle_model: vehicleModel,
    raw: row,
  };
};

const matchingServiceRate = (service, dateKey, pax, residentType = "nrs") => {
  const details = service?.raw?.details || service?.details || {};
  const variants = Array.isArray(details.rate_variants) ? details.rate_variants : [];
  const pricingMode = String(details.pricing_mode || "fixed").toLowerCase();
  const date = String(dateKey || "").slice(0, 10);
  const guests = Math.max(1, Number(pax) || 1);
  const matching = variants.filter((variant) => {
    const from = String(variant.valid_from || "").slice(0, 10);
    const to = String(variant.valid_to || "").slice(0, 10);
    const min = Math.max(1, Number(variant.min_guests) || 1);
    const max = Number(variant.max_guests) > 0 ? Number(variant.max_guests) : Infinity;
    const audience = String(variant.resident_type || "all").toLowerCase();
    const hasPrice = pricingMode === "packages"
      ? Number(variant.half_day_price) > 0 && Number(variant.full_day_price) > 0
      : Number(variant.price) > 0;
    return hasPrice && (audience === "all" || audience === residentType) && (!from || date >= from) && (!to || date <= to) && guests >= min && guests <= max;
  }).sort((a, b) => (Number(b.min_guests) || 1) - (Number(a.min_guests) || 1));
  return { variant: matching[0] || null, hasVariants: variants.length > 0 };
};

const serviceUnitPrice = (service, dateKey, pax, residentType = "nrs") => {
  const match = matchingServiceRate(service, dateKey, pax, residentType);
  return toNum(match.variant?.price ?? match.variant?.half_day_price, toNum(service?.price, 0));
};

const serviceRateExplanation = (service, dateKey, pax, residentType, t) => {
  const { variant, hasVariants } = matchingServiceRate(service, dateKey, pax, residentType);
  if (!hasVariants) return "";
  if (!variant) return t("provider_services.workspace.base_price_applied");
  const min = Math.max(1, Number(variant.min_guests) || 1);
  const max = Number(variant.max_guests) > 0 ? Number(variant.max_guests) : null;
  const guests = max ? `${min}–${max}` : `${min}+`;
  const dates = [variant.valid_from, variant.valid_to].filter(Boolean).join(" — ");
  const audience = variant.resident_type === "res" ? t("provider_services.workspace.residents") : variant.resident_type === "nrs" ? t("provider_services.workspace.nonresidents") : t("provider_services.workspace.all_travelers");
  return t("provider_services.workspace.rate_explanation", { guests, dates: dates || t("provider_services.workspace.any_dates"), audience });
};

const serviceListSignature = (services = []) =>
  services
    .map((service) => [
      service.id,
      service.price,
      service.currency,
      service.title,
      service.category,
      service.vehicle_model,
      JSON.stringify(service.raw?.details?.rate_variants || []),
    ].join(":"))
    .sort()
    .join("|");


async function fetchProvidersSmart({ kind, city, date, startTime = "", endTime = "", language, q = "", limit = 30 }) {
  const performance = await loadSupplierPerformance();
  // Пробуем строго /available
  try {
    const j = await fetchJSON("/api/providers/available", {
      type: kind, location: city, date, start_time: startTime, end_time: endTime, language, q, limit,
    });
    const arr = Array.isArray(j?.items) ? j.items : Array.isArray(j) ? j : [];
    // Возвращаем как есть (даже если пусто) — это и есть «нет свободных»
    return arr.map((x) => normalizeProvider(withSupplierPerformance(x, performance.get(String(x.id))), kind));
  } catch (_) {
    // Фоллбек только при сетевой/HTTP ошибке
    try {
      const j = await fetchJSON("/api/providers/search", {
        type: kind, location: city, language, q, limit,
      });
      const arr = Array.isArray(j?.items) ? j.items : Array.isArray(j) ? j : [];
      return arr.map((x) => normalizeProvider(withSupplierPerformance(x, performance.get(String(x.id))), kind));
    } catch {
      return [];
    }
  }
}

async function fetchProviderServices(providerId) {
  if (!providerId) return [];

  // 1) пробуем публичный список (без токена)
  let j = await fetchJSONLoose(`/api/providers/${providerId}/services/public`);
  if (j && !Array.isArray(j)) j = j.items;            // items[] или []
  if (Array.isArray(j) && j.length) return j.map(normalizeService);

    // 2) приватный (если фронт под токеном) — как запасной вариант
  j = await fetchJSONLoose(`/api/providers/${providerId}/services`);
  if (Array.isArray(j) && j.length) return j.map(normalizeService);

  // 3) частая схема — общий список с фильтром по провайдеру
  for (const q of [
    { url: "/api/services", params: { provider_id: providerId } },
    { url: "/api/services", params: { provider: providerId } },
    { url: "/api/provider-services", params: { provider_id: providerId } },
  ]) {
    const r = await fetchJSONLoose(q.url, q.params);
    const arr = Array.isArray(r?.items) ? r.items : (Array.isArray(r) ? r : []);
    if (arr.length) return arr.map(normalizeService);
  }

  // 4) иногда услуги лежат прямо в объекте провайдера (profile.services)
  const p = await fetchJSONLoose(`/api/providers/${providerId}`);
  const embedded = p?.services || p?.profile?.services || [];
  if (Array.isArray(embedded) && embedded.length) return embedded.map(normalizeService);

  return [];
}


const normalizeHotel = (row) => ({
  id: row.id ?? row._id ?? row.hotel_id ?? String(Math.random()),
  name: row.name || row.title || "Hotel",
  city: row.city || row.location || "",
  price: toNum(row.price ?? row.net ?? row.price_per_night ?? 0, 0),
  currency: row.currency || "UZS",
});

async function fetchHotelsSmart({ city, date, q = "", limit = 30 }) {
  const tries = [
    { url: "/api/hotels/search", params: { city, date, name: q, limit } },
    { url: "/api/hotels",        params: { city, q, limit } },
  ];
  for (const t of tries) {
    try {
      const j = await fetchJSON(t.url, t.params);
      const arr = Array.isArray(j?.items) ? j.items : Array.isArray(j) ? j : [];
      if (arr.length) return arr.map((x) => normalizeHotel(x));
    } catch (_) {}
  }
  return [];
}

async function fetchEntryFees({ q = "", city = "", date = "", limit = 50 } = {}) {
  try {
    const j = await fetchJSON("/api/entry-fees", { q, city, date, limit });
    return Array.isArray(j?.items) ? j.items : Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

// ------ admin helper from JWT (локально, без сети) ------
const isAdminFromJwt = () => {
  try {
    const tok = localStorage.getItem("token") || localStorage.getItem("providerToken");
    if (!tok) return false;
    const b64 = tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const base64 = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = decodeURIComponent(
      atob(base64).split("").map(c => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join("")
    );
    const claims = JSON.parse(json);
    const roles = []
      .concat(claims.role || [], claims.roles || [])
      .flatMap(r => String(r).split(","))
      .map(s => s.trim().toLowerCase());
    const perms = []
      .concat(claims.permissions || claims.perms || [])
      .map(x => String(x).toLowerCase());
    return (
      claims.is_admin === true ||
      claims.moderator === true ||
      roles.some(r => ["admin","moderator","super","root"].includes(r)) ||
      perms.some(x => ["moderation","admin:moderation"].includes(x))
    );
  } catch {
    return false;
  }
};


/* ---------------- custom option + tooltip ---------------- */
const ProviderOption = (props) => {
  const { t } = useTranslation();
  const p = props.data?.raw || {};
  const url = p?.id ? `/profile/provider/${p.id}` : null;

  // Не даем react-select закрыть меню, но клики выполняем вручную
  const swallowDown = (e) => { e.preventDefault(); e.stopPropagation(); };
  const openHref = (href) => (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!href) return;
    if (/^https?:/i.test(href)) window.open(href, "_blank", "noopener,noreferrer");
    else window.location.href = href; // tel:, mailto:
  };

  const tgRaw  = (p.telegram || "").trim();
  const tgUser = tgRaw.replace(/^@/,"");
  const tgHref = tgRaw ? (tgRaw.includes("t.me") ? tgRaw : `https://t.me/${tgUser}`) : null;
  const tel = (p.phone || "").replace(/[^\d+]/g, "");

    // ► Портируем тултип в body и позиционируем по rect опции
  const rowRef = useRef(null);
  const [tipOpen, setTipOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const showTip = () => {
    const el = rowRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      top: r.top + r.height / 2,
      left: r.right + 8,
    });
    setTipOpen(true);
  };
  const hideTip = () => setTipOpen(false);

  const Tip = (
    <div
      style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translateY(-50%)", zIndex: 10000 }}
      className="min-w-[260px] max-w-[320px] rounded-lg shadow-lg border bg-white p-3 text-xs leading-5 select-text"
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="font-semibold text-sm mb-1">{p.name || "—"}</div>
      {p.location && <div><b>{t("tb.profile.city")}:</b> {Array.isArray(p.location) ? p.location.join(", ") : p.location}</div>}
      {p.languages?.length ? <div><b>{t("tb.profile.languages")}:</b> {p.languages.join(", ")}</div> : null}
      {p.phone && (
        <div>
          <b>{t("tb.profile.phone")}:</b>{" "}
          <a
            href={tel ? `tel:${tel}` : undefined}
            onMouseDown={swallowDown}
            onPointerDown={swallowDown}
            onClick={openHref(tel ? `tel:${tel}` : "")}
            className="text-blue-600 hover:underline"
          >{p.phone}</a>
        </div>
      )}
      {tgRaw && (
        <div>
          <b>{t("tb.profile.telegram")}:</b>{" "}
          {tgHref ? (
            <a
              href={tgHref}
             target="_blank"
              rel="noopener noreferrer"
              onMouseDown={swallowDown}
              onPointerDown={swallowDown}
              onClick={openHref(tgHref)}
              className="text-blue-600 hover:underline"
            >@{tgUser}</a>
          ) : <span>{tgRaw}</span>}
        </div>
      )}
      {p.email && (
        <div>
          <b>{t("tb.profile.email")}:</b>{" "}
          <a
            href={`mailto:${p.email}`}
            onMouseDown={swallowDown}
            onPointerDown={swallowDown}
            onClick={openHref(`mailto:${p.email}`)}
            className="text-blue-600 hover:underline"
          >{p.email}</a>
        </div>
      )}
      {Number(p.price_per_day) > 0 && (
        <div className="mt-1"><b>{t("tb.profile.price_per_day")}:</b> {p.price_per_day} {p.currency || "UZS"}</div>
      )}
      {p.performance_review_count > 0 && <div className="mt-1"><b>{t("tb.performance.history_score")}:</b> {((p.quality_rating + p.reliability_rating) / 2).toFixed(1)}/5 · {t("tb.performance.review_count", { count: p.performance_review_count })}</div>}
      {url && (
        <div className="mt-2">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            onMouseDown={swallowDown}
            onPointerDown={swallowDown}
            onClick={openHref(url)}
            className="text-blue-600 hover:underline"
          >{t("tb.profile.open_profile")}</a>
        </div>
      )}
    </div>
  );

  return (
    <div
      ref={rowRef}
      onMouseEnter={showTip}
      onFocus={showTip}
      onMouseLeave={hideTip}
      onBlur={hideTip}
      className="rs-option-wrap"
    >
      <SelectComponents.Option {...props} />
      {tipOpen && createPortal(Tip, document.body)}
    </div>
  );
};

 function TemplateButtonWithTip({ tpl, onClick }) {
  const { t, i18n } = useTranslation();
  const btnRef = React.useRef(null);
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState({ top: 0, left: 0 });
    // фиксированная ширина тултипа и «разумная» высота
  const TIP_W = 420;      // px
  const TIP_PAD = 10;     // отступ от кнопки
  const TIP_MAX_VH = 70;  // % высоты окна

  const show = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
        // если справа не помещаемся — показываем слева
    const spaceRight = window.innerWidth - r.right;
    const placeRight = spaceRight > (TIP_W + TIP_PAD + 8);
    const left = placeRight ? (r.right + TIP_PAD)
                            : Math.max(8, r.left - TIP_W - TIP_PAD);
    // зажимаем top в границах окна
    const midY = r.top + r.height / 2;
    const topMin = 8;
    const topMax = window.innerHeight - 8;
    const top = Math.min(topMax, Math.max(topMin, midY));
    setPos({ top, left });
   setOpen(true);
 };
  const hide = () => setOpen(false);

  const route = (Array.isArray(tpl?.days) ? tpl.days : [])
    .map((d) => String(d?.city || "").trim())
    .filter(Boolean)
    .join(" → ");

  const program = (() => {
    const dict = tpl?.program_i18n || {};
    // текущий язык из i18next, если что — падаем на язык браузера, потом en/ru/uz
    const cur = (i18n?.language || navigator.language || 'en').slice(0, 2).toLowerCase();
    const pref = Array.from(new Set([cur, 'en', 'ru', 'uz']));
    for (const k of pref) {
      const v = (dict[k] || '').trim();
      if (v) return v;
    }
    return '';
  })();

  const Tip = (
    <div
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        transform: "translateY(-50%)",
        zIndex: 10000,
        width: TIP_W,
        maxHeight: `${TIP_MAX_VH}vh`,
        overflowY: "auto",
      }}
      className="rounded-lg shadow-lg border bg-white p-3 text-sm leading-5"
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="text-xs text-gray-500 mb-1">{t('tb.route')}</div>
      <div className="font-medium mb-2">{route || "—"}</div>
      {program && (
        <>
          <div className="text-xs text-gray-500 mb-1">{t('tpl.program')}</div>
          <div
            className="text-[13px]"
            style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          >
            {program}
          </div>
        </>
      )}
    </div>
  );

  return (
    <div
      ref={btnRef}
      onMouseEnter={show}
      onFocus={show}
      onMouseLeave={hide}
      onBlur={hide}
      className="inline-block"
    >
      <button
        className="px-3 py-1 rounded border hover:bg-orange-50"
        onClick={onClick}
        title=""                       /* отключаем системный tooltip */
      >
        {tpl.title}
      </button>
      {open && createPortal(Tip, document.body)}
    </div>
  );
}


const HotelOption = (props) => {
  const { t } = useTranslation();
  const h = props.data?.raw;
  const tip = [
    h?.name,
    h?.city ? `${t("tb.ui.city_label")}: ${h.city}` : "",
    typeof h?.price === "number" && h?.price > 0 ? `${t("tb.price_per_night")}: ${h.price} ${h.currency || "UZS"}` : "",
  ].filter(Boolean).join("\n");
  return (
    <div title={tip}>
      <SelectComponents.Option {...props} />
    </div>
  );
};

/* =========================== PAGE =========================== */

export default function TourBuilder() {
  const [searchParams] = useSearchParams();
  const [isAdmin, setIsAdmin] = useState(false);
  const [bookingResult, setBookingResult] = useState(null);
  const [bookingConfirmation, setBookingConfirmation] = useState(null);

  useEffect(() => {
    setIsAdmin(isAdminFromJwt());
  }, []);
  
  const { t, i18n } = useTranslation();
  
  const localeMap = {
    en: enUS,
    ru: ruLocale,
    uz: uzLocale,
  };
  const dpLocale = localeMap[i18n.language?.slice(0,2)] || enUS;
  
  // ⬇️ сколько месяцев показывать
  const [months, setMonths] = useState(
    typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches ? 2 : 1
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = (e) => setMonths(e.matches ? 2 : 1);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  
  const [range, setRange] = useState(EMPTY_RANGE);
  const [collapsedDays, setCollapsedDays] = useState({});
  const [expandedComponents, setExpandedComponents] = useState({});

  const [adt, setAdt] = useState(2);
  const [chd, setChd] = useState(0);
  const [residentType, setResidentType] = useState("nrs");
  const [lang, setLang] = useState("en");
  // фильтр по категории (звёздам) отелей: '' | 1..7
  const [hotelStars, setHotelStars] = useState("");

  const days = useMemo(() => {
    if (!range?.from || !range?.to) return [];
    const res = [];
    let d = startOfDay(range.from);
    const end = startOfDay(range.to);
    while (d <= end) { res.push(new Date(d)); d = addDays(d, 1); } 
    return res;
  }, [range?.from, range?.to]);

   // курс USD (UZS за 1 USD), для конвертации итогов вниз страницы
 const [usdRate, setUsdRate] = useState(Number(import.meta.env.VITE_USD_RATE || 0) || 0);
 const toUSD = (vUZS) => (Number(usdRate) > 0 ? Number(vUZS) / Number(usdRate) : 0);
 const [summaryCurrency, setSummaryCurrency] = useState("UZS");
  const [markupType, setMarkupType] = useState("percent");
  const [markupValue, setMarkupValue] = useState(10);

  const [byDay, setByDay] = useState({});
  const [demoMode, setDemoMode] = useState(false);
  const loadDemoTour = () => {
    const start = addDays(startOfDay(new Date()), 1);
    const demoDays = [start, addDays(start, 1), addDays(start, 2)];
    const cities = ["Tashkent", "Samarkand", "Samarkand"];
    const next = {};
    demoDays.forEach((date, index) => {
      const dateKey = ymd(date);
      const schedule = [
        {
          id: `demo-tour-${index + 1}`,
          start_time: index === 2 ? "09:00" : "10:00",
          end_time: index === 2 ? "12:00" : "13:00",
          title: index === 2 ? "Transfer" : "Tour / program",
          type: index === 2 ? "transport" : "guide",
          active_service_category: index === 2 ? "transfer" : "tour",
          services: index === 2 ? { transport: { subtype: "intercity" } } : { tour: { subtype: "city" } },
        },
        ...(index < 2 ? [{ id: `demo-hotel-${index + 1}`, start_time: "14:00", end_time: "12:00", end_day_offset: 1, title: "Hotel", type: "hotel", active_service_category: "hotel", services: {} }] : []),
      ];
      next[dateKey] = createEmptyTourDayState({ city: cities[index], schedule, selectedScheduleId: schedule[0].id });
    });
    setRange({ from: demoDays[0], to: demoDays[2] });
    setByDay(next);
    setCollapsedDays({});
    setExpandedComponents({});
    setDemoMode(true);
  };
  useEffect(() => {
    if (searchParams.get("demo") === "1") loadDemoTour();
    // The query parameter is only an initial entry point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    setByDay((prev) => {
      const copy = { ...prev };
      days.forEach((d) => {
        const k = ymd(d);
                if (!copy[k]) copy[k] = createEmptyTourDayState();
      });
      Object.keys(copy).forEach((k) => {
        if (!days.find((d) => ymd(d) === k)) delete copy[k];
      });
      return copy;
    });
  }, [days]);

  useEffect(() => {
    const selectedHotels = Object.entries(byDay)
      .filter(([, state]) => state?.hotel?.id)
      .map(([date, state]) => ({ date, hotelId: state.hotel.id }));
    if (!selectedHotels.length) return undefined;

    let cancelled = false;
    Promise.all(selectedHotels.map(async ({ date, hotelId }) => ({
      date,
      hotelId,
      offers: await fetchHotelOffers(
        hotelId,
        date,
        residentType === "res" ? "resident" : "non_resident"
      ).catch(() => []),
    }))).then((results) => {
      if (cancelled) return;
      setByDay((previous) => {
        const next = { ...previous };
        for (const { date, hotelId, offers } of results) {
          const current = next[date];
          if (!current || Number(current.hotel?.id) !== Number(hotelId)) continue;
          const sameOffer = offers.find((offer) => Number(offer.id) === Number(current.hotelOffer?.id));
          next[date] = {
            ...current,
            hotelOffers: offers,
            hotelOffer: sameOffer || pickBestHotelOffer(offers, usdRate),
            hotelRoomsTotal: 0,
            hotelBreakdown: null,
          };
        }
        return next;
      });
    });

    return () => { cancelled = true; };
  }, [residentType]);

    /* ----- cache услуг провайдеров, чтобы не бить API каждый раз ----- */
  const [servicesCache, setServicesCache] = useState({});     // {providerId: Service[]}
  const [servicesLoading, setServicesLoading] = useState({}); // {providerId: bool}
  const serviceRefreshInFlight = useRef(false);

  const selectedServiceProviderKey = useMemo(() => {
    const ids = new Set();
    Object.values(byDay).forEach((state) => {
      if (state?.guide?.id) ids.add(String(state.guide.id));
      if (state?.transport?.id) ids.add(String(state.transport.id));
    });
    return [...ids].sort().join("|");
  }, [byDay]);

  useEffect(() => {
    if (!selectedServiceProviderKey) return undefined;

    let cancelled = false;
    const refreshSelectedServicePrices = async () => {
      if (serviceRefreshInFlight.current) return;
      serviceRefreshInFlight.current = true;
      try {
        const providerIds = selectedServiceProviderKey.split("|").filter(Boolean);
        const refreshedEntries = await Promise.all(
          providerIds.map(async (providerId) => [providerId, await fetchProviderServices(providerId)])
        );
        if (cancelled) return;

        const refreshedByProvider = Object.fromEntries(refreshedEntries);
        setServicesCache((previous) => {
          let changed = false;
          const next = { ...previous };
          refreshedEntries.forEach(([providerId, services]) => {
            if (serviceListSignature(previous[providerId]) !== serviceListSignature(services)) {
              next[providerId] = services;
              changed = true;
            }
          });
          return changed ? next : previous;
        });

        setByDay((previous) => {
          let changed = false;
          const next = { ...previous };
          Object.entries(previous).forEach(([dateKey, state]) => {
            let updatedState = state;
            const selections = [
              ["guide", "guideService"],
              ["transport", "transportService"],
            ];

            selections.forEach(([providerKey, serviceKey]) => {
              const providerId = state?.[providerKey]?.id;
              const selectedService = state?.[serviceKey];
              if (!providerId || !selectedService?.id) return;
              const refreshedService = refreshedByProvider[String(providerId)]?.find(
                (service) => String(service.id) === String(selectedService.id)
              );
              if (!refreshedService) return;
              if (serviceListSignature([selectedService]) === serviceListSignature([refreshedService])) return;
              updatedState = { ...updatedState, [serviceKey]: refreshedService };
              changed = true;
            });

            if (updatedState !== state) next[dateKey] = updatedState;
          });
          return changed ? next : previous;
        });
      } catch (error) {
        console.warn("TourBuilder: failed to refresh provider service prices", error);
      } finally {
        serviceRefreshInFlight.current = false;
      }
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshSelectedServicePrices();
    };
    refreshSelectedServicePrices();
    const intervalId = window.setInterval(refreshSelectedServicePrices, 30_000);
    window.addEventListener("focus", refreshSelectedServicePrices);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshSelectedServicePrices);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [selectedServiceProviderKey]);

  const ensureServicesLoaded = async (provider) => {
    const pid = provider?.id;
        if (!pid) return [];
    if (servicesCache[pid]) return servicesCache[pid];
    if (servicesLoading[pid]) return [];
    setServicesLoading((m) => ({ ...m, [pid]: true }));
    const list = await fetchProviderServices(pid);
    setServicesCache((m) => ({ ...m, [pid]: list }));
    setServicesLoading((m) => ({ ...m, [pid]: false }));
    return list;
  };

    // вспомогательная: выбрать услугу по rules и вернуть НОРМАЛИЗОВАННЫЙ объект из кеша
  const intercityRouteForDay = (dateKey) => {
    const keys = sortedDayKeys(byDay);
    const index = keys.indexOf(dateKey);
    const current = String(byDay[dateKey]?.city || "").trim();
    const previous = index > 0 ? String(byDay[keys[index - 1]]?.city || "").trim() : "";
    const next = index >= 0 && index < keys.length - 1 ? String(byDay[keys[index + 1]]?.city || "").trim() : "";
    if (previous && current && previous.toLowerCase() !== current.toLowerCase()) return { from: previous, to: current };
    if (current && next && current.toLowerCase() !== next.toLowerCase()) return { from: current, to: next };
    return { from: "", to: "" };
  };

  const pickFromCache = (providerId, categoriesArr, citySlug, pax, route = null) => {
    const list = servicesCache[providerId] || [];
    if (!list.length) return null;
    // pickProviderService ожидает "сырые" услуги с details; мы сохранили их в .raw
    const rawPool = list
      .map((x) => x.raw || x)
      .filter((service) => route ? fitsRoute(service, route.from, route.to) : fitsCity(service, citySlug));
    const picked = pickProviderService(rawPool, {
      citySlug,
      pax,
      categories: categoriesArr,
    });
    if (!picked) return null;
    const normalized = list.find((s) => String(s.id) === String(picked.id));
    return normalized || null;
  };
 // проверяем, что выбранная услуга реально принадлежит провайдеру
 const ensureServiceBelongsToProvider = (providerId, serviceId) => {
   if (!providerId || !serviceId) return false;
   const list = servicesCache[String(providerId)] || [];
   return list.some(s => String(s.id) === String(serviceId));
 };
 const generateProgramForDay = (dateKey, { overwrite = true } = {}) => {
   setByDay((prev) => {
     const keys = sortedDayKeys(prev);
     const idx = keys.indexOf(dateKey);
     if (idx < 0) return prev;
     const current = prev[dateKey] || {};
     if (!overwrite && hasProgramText(current.program_i18n || current.program)) return prev;
     const activeLang = TB_PROGRAM_LANGS.includes(String(i18n.language || "ru").slice(0, 2))
       ? String(i18n.language || "ru").slice(0, 2)
       : "ru";
     return {
       ...prev,
       [dateKey]: {
         ...current,
         program_i18n: buildAutoProgramI18n({
           dayNumber: idx + 1,
           totalDays: keys.length,
           date: dateKey,
           city: current.city,
           prevCity: idx > 0 ? prev[keys[idx - 1]]?.city : "",
           nextCity: idx < keys.length - 1 ? prev[keys[idx + 1]]?.city : "",
           dayData: current,
           pax: Math.max(1, toNum(adt, 0) + toNum(chd, 0)),
         }),
         _programTab: activeLang,
       },
     };
   });
 };

 const generateProgramForAllDays = ({ overwrite = true } = {}) => {
   setByDay((prev) => {
     const keys = sortedDayKeys(prev);
     if (!keys.length) return prev;
     const activeLang = TB_PROGRAM_LANGS.includes(String(i18n.language || "ru").slice(0, 2))
       ? String(i18n.language || "ru").slice(0, 2)
       : "ru";
     const next = { ...prev };
     keys.forEach((dateKey, idx) => {
       const current = prev[dateKey] || {};
       if (!overwrite && hasProgramText(current.program_i18n || current.program)) return;
       next[dateKey] = {
         ...current,
         program_i18n: buildAutoProgramI18n({
           dayNumber: idx + 1,
           totalDays: keys.length,
           date: dateKey,
           city: current.city,
           prevCity: idx > 0 ? prev[keys[idx - 1]]?.city : "",
           nextCity: idx < keys.length - 1 ? prev[keys[idx + 1]]?.city : "",
           dayData: current,
           pax: Math.max(1, toNum(adt, 0) + toNum(chd, 0)),
         }),
         _programTab: activeLang,
       };
     });
     return next;
   });
 };

 const getActiveProgramTab = () => {
   const code = String(i18n.language || "ru").slice(0, 2).toLowerCase();
   return TB_PROGRAM_LANGS.includes(code) ? code : "ru";
 };

 const resetDayOptionCaches = () => {
   setEntryQMap({});
   setEntryOptionsMap({});
   setHotelOptionsMap({});
 };

 const addTourDayAtEnd = () => {
   const today = startOfDay(new Date());
   if (!range?.from || !range?.to) {
     const key = ymd(today);
     setRange({ from: today, to: today });
     setByDay({ [key]: createEmptyTourDayState({ _programTab: getActiveProgramTab() }) });
     return;
   }

   const currentTo = startOfDay(range.to);
   const nextDate = addDays(currentTo, 1);
   const nextKey = ymd(nextDate);
   setRange({ from: startOfDay(range.from), to: nextDate });
   setByDay((prev) => ({
     ...prev,
     [nextKey]: prev[nextKey] || createEmptyTourDayState({ _programTab: getActiveProgramTab() }),
   }));
 };

 const insertTourDayAfter = (dateKey) => {
   if (!range?.from || !range?.to) {
     addTourDayAtEnd();
     return;
   }

   const keys = sortedDayKeys(byDay);
   if (!keys.length || !keys.includes(dateKey)) {
     addTourDayAtEnd();
     return;
   }

   const baseDate = parseYmdLocal(dateKey);
   if (!baseDate) return;
   const insertKey = ymd(addDays(baseDate, 1));
   const next = {};

   keys.forEach((key) => {
     const src = byDay[key] || {};
     if (key <= dateKey) {
       next[key] = src;
     } else {
       const d = parseYmdLocal(key);
       if (d) next[ymd(addDays(d, 1))] = src;
     }
   });

   next[insertKey] = createEmptyTourDayState({ _programTab: getActiveProgramTab() });
   setByDay(next);
   setRange({ from: startOfDay(range.from), to: addDays(startOfDay(range.to), 1) });
   resetDayOptionCaches();
 };

 const removeTourDay = (dateKey) => {
   const keys = sortedDayKeys(byDay);
   if (!keys.includes(dateKey)) return;

   const ask = t("tb.delete_day_confirm");
   if (typeof window !== "undefined" && !window.confirm(ask)) return;

   if (keys.length <= 1) {
     setByDay({});
     setRange(EMPTY_RANGE);
     resetDayOptionCaches();
     return;
   }

   const next = {};
   keys.forEach((key) => {
     if (key === dateKey) return;
     const src = byDay[key] || {};
     if (key > dateKey) {
       const d = parseYmdLocal(key);
       if (d) next[ymd(addDays(d, -1))] = src;
     } else {
       next[key] = src;
     }
   });

   setByDay(next);
   setRange({ from: startOfDay(range.from), to: addDays(startOfDay(range.to), -1) });
   resetDayOptionCaches();
 };

  // автоподбор по конкретному дню
  const autoPickForDay = (dateKey) => {
    setByDay((prev) => {
      const st = prev[dateKey] || {};
      const citySlug = st.city || "";
      const pax = Math.max(1, toNum(adt, 0) + toNum(chd, 0));
      let next = { ...st };

      const selectedSchedule = normalizeScheduleItems(st.schedule)
        .find((item) => item.id === st.selectedScheduleId);
      const componentCategory = selectedSchedule?.active_service_category;
      const transportSubtype = selectedSchedule?.services?.transport?.subtype || "";
      const tourSubtype = selectedSchedule?.services?.tour?.subtype || "city";
      const tourType = TOUR_BUILDER_TYPES.find((item) => item.id === tourSubtype) || TOUR_BUILDER_TYPES[0];
      const guideCategories = componentCategory === "tour" ? tourType.guideCategories : [];
      const transportCategories = componentCategory === "tour"
        ? tourType.transportCategories
        : componentCategory === "transfer"
          ? (TRANSPORT_SERVICE_TYPES.find((item) => item.id === transportSubtype)?.categories || [])
          : [];

      if (st.guide && servicesCache[st.guide.id]) {
        const chosen = guideCategories.length
          ? pickFromCache(st.guide.id, guideCategories, citySlug, pax)
          : null;
        if (chosen && (!st.guideService || String(st.guideService.id) !== String(chosen.id))) {
          next.guideService = chosen;
        }
        if (next.guideService && (
          !guideCategories.includes(next.guideService.category)
          || !fitsPax(next.guideService, pax)
          || !fitsCity(next.guideService, citySlug)
        )) {
          next.guideService = null;
        }
      }
      if (st.transport && servicesCache[st.transport.id]) {
        const chosenT = transportCategories.length
          ? pickFromCache(st.transport.id, transportCategories, citySlug, pax)
          : null;
        if (chosenT && (!st.transportService || String(st.transportService.id) !== String(chosenT.id))) {
          next.transportService = chosenT;
        }
        if (next.transportService && (
          !transportCategories.includes(next.transportService.category)
          || !fitsPax(next.transportService, pax)
          || !fitsCity(next.transportService, citySlug)
        )) {
          next.transportService = null;
        }
      }
      return { ...prev, [dateKey]: next };
    });
  };

  /* ----- Entry fees: поиск теперь ПО-ДНЯМ (city+date) ----- */
  const [entryQMap, setEntryQMap] = useState({});            // {dateKey: query}
  const [entryOptionsMap, setEntryOptionsMap] = useState({}); // {dateKey: options[]}

    /* ----- Hotels: предзагрузка списка по городу (per day) ----- */
  const [hotelOptionsMap, setHotelOptionsMap] = useState({}); // {dateKey: options[]}
  const loadHotelOptionsForDay = async (dateKey, city) => {
    const cityNorm = (city || "").trim();
    if (!cityNorm || !dateKey) {
      setHotelOptionsMap((m) => ({ ...m, [dateKey]: [] }));
      return;
    }
    try {
      // Пробуем серверный фильтр, плюс страхуемся клиентским.
      const items = await fetchHotelsByCity(cityNorm, hotelStars);
      const filtered = items.filter(o => matchStars(o?.raw?.stars, hotelStars));
      setHotelOptionsMap((m) => ({ ...m, [dateKey]: filtered }));
    } catch {
      setHotelOptionsMap((m) => ({ ...m, [dateKey]: [] }));
    }
  };

  const hotelCitySignature = Object.entries(byDay)
    .map(([dateKey, day]) => `${dateKey}:${String(day?.city || "").trim().toLowerCase()}`)
    .sort()
    .join("|");

  // Загружаем отели и при восстановлении сохранённого тура, когда город уже заполнен.
  useEffect(() => {
    Object.entries(byDay).forEach(([dateKey, day]) => {
      if (String(day?.city || "").trim()) loadHotelOptionsForDay(dateKey, day.city);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelCitySignature, hotelStars]);

    // при смене фильтра звёзд — обновляем списки по всем дням и сбрасываем неподходящие выборы
  useEffect(() => {
    setByDay((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        const st = next[k] || {};
        if (!st.city) continue;
        loadHotelOptionsForDay(k, st.city);
        if (st.hotel && !matchStars(st.hotel.stars, hotelStars)) {
          next[k] = { ...st, hotel: null, hotelBrief: null, hotelOffers: [], hotelOffer: null, hotelRoomsTotal: 0, hotelBreakdown: null };
        }
      }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelStars]);

  const loadEntryOptionsForDay = async (dateKey, city, q) => {
    if (!city || !dateKey) { setEntryOptionsMap((m) => ({ ...m, [dateKey]: [] })); return; }
    const items = await fetchEntryFees({ q: q || "", city, date: dateKey, limit: 50 });
    const opts = items.map((x) => ({
      value: x.id,
      label: `${x.name_ru || x.name_en || x.name_uz || "—"}${x.city ? " — " + x.city : ""} (${x.currency || "UZS"})`,
      raw: x,
    }));
    setEntryOptionsMap((m) => ({ ...m, [dateKey]: opts }));
  };
   // 🔔 ДЕБАУНС для поиска входных билетов (без хуков внутри JSX)
   const debouncedLoadEntryOptionsRef = useRef(debounce(loadEntryOptionsForDay, 350));
   useEffect(() => {
     // если реализация loadEntryOptionsForDay поменяется, переинициализируем дебаунсер
     debouncedLoadEntryOptionsRef.current = debounce(loadEntryOptionsForDay, 350);
   }, [loadEntryOptionsForDay]);
  
  /* ----- loaders per day (guide / transport / hotel) ----- */
  const makeGuideLoader = (dateKey, allowedCategories = ["city_tour_guide"]) => async (input) => {
  const day = byDay[dateKey] || {};
  if (!dateKey || !day.city) return [];
  const selectedSlot = normalizeScheduleItems(day.schedule).find((item) => item.id === day.selectedScheduleId);
  const rows = await fetchProvidersSmart({
    kind: "guide",
    city: day.city,
    date: dateKey,
    startTime: selectedSlot?.start_time || "",
    endTime: selectedSlot?.end_time || "",
    language: lang,
    q: (input || "").trim(),
    limit: 50,
  });
  // Фильтруем провайдеров по наличию услуги с seats >= PAX (и по городу/категории)
  const pax = Math.max(1, toNum(adt) + toNum(chd));
  const okMask = await Promise.all(
    rows.map((p) =>
      providerMatchesByPaxCity({
        provider: p,
        kind: "guide",
        citySlug: day.city,
        pax,
        ensureServicesLoaded,
        allowedCategories,
      })
    )
  );
  const filtered = rows.filter((_, i) => okMask[i]);
  return filtered.map((p) => ({ value: p.id, label: p.performance_review_count ? `${p.name} · ${((p.quality_rating + p.reliability_rating) / 2).toFixed(1)}/5` : p.name, raw: p }));
};
 

const makeTransportLoader = (dateKey, allowedCategories = TRANSPORT_ALLOWED_ARR) => async (input) => {
  const day = byDay[dateKey] || {};
  if (!dateKey || !day.city) return [];
  const selectedSlot = normalizeScheduleItems(day.schedule).find((item) => item.id === day.selectedScheduleId);
  const isIntercity = selectedSlot?.services?.transport?.subtype === "intercity";
  const route = isIntercity ? intercityRouteForDay(dateKey) : null;
  if (isIntercity && (!route?.from || !route?.to)) return [];
  const providerGroups = await Promise.all(["guide", "transport"].map((kind) => fetchProvidersSmart({
    kind,
    city: day.city,
    date: dateKey,
    startTime: selectedSlot?.start_time || "",
    endTime: selectedSlot?.end_time || "",
    language: lang,
    q: (input || "").trim(),
    limit: 50,
  })));
  const rows = Array.from(
    new Map(providerGroups.flat().map((provider) => [String(provider.id), provider])).values()
  );
  const pax = Math.max(1, toNum(adt) + toNum(chd));
  const okMask = await Promise.all(
    rows.map((p) =>
      providerMatchesByPaxCity({
        provider: p,
        kind: "transport",
        citySlug: day.city,
        fromCity: route?.from,
        toCity: route?.to,
        pax,
        ensureServicesLoaded,
        allowedCategories,
      })
    )
  );
  const filtered = rows.filter((_, i) => okMask[i]);
  return filtered.map((p) => ({ value: p.id, label: p.performance_review_count ? `${p.name} · ${((p.quality_rating + p.reliability_rating) / 2).toFixed(1)}/5` : p.name, raw: p }));
};

  /* ----- totals (entry fees по видам дня) ----- */
  const entryCell = (siteRaw, kind, pax) => {
    const key = `${kind}_${residentType}_${pax}`;
    const v = Number(siteRaw?.[key] ?? 0);
    return Number.isFinite(v) ? v : 0;
  };

  const calcEntryForDay = (dateKey) => {
    const d = new Date(dateKey);
    const kind = dayKind(d);
    const day = byDay[dateKey] || {};
    const sel = day.entrySelected || [];
    let sum = 0;
    for (const opt of sel) {
      const s = opt.raw;
      sum += toNum(adt, 0) * entryCell(s, kind, "adult");
      sum += toNum(chd, 0) * entryCell(s, kind, "child");
    }
    return sum;
  };

    // стоимость питания за день в UZS
  const calcMealsForDay = (dateKey) => {
    const st = byDay[dateKey] || {};
    const pax = Math.max(1, toNum(adt) + toNum(chd));
    const list = Array.isArray(st.meals) ? st.meals : [];
    let sum = 0;
    for (const m of list) {
      const price = toNum(m?.price, 0);
      if (!price) continue;
      const isUSD = String(m?.currency || "UZS").toUpperCase() === "USD";
      const priceUZS =
        isUSD ? (Number(usdRate) > 0 ? price * Number(usdRate) : 0) : price;
      sum += priceUZS * (m?.perPax ? pax : 1);
    }
    return sum;
  };


    const durationHoursForProvider = (state, kind, providerId) => {
    const slots = normalizeScheduleItems(state?.schedule).filter((item) =>
      item.type === kind && String(item.provider_id || "") === String(providerId || "")
    );
    return slots.reduce((sum, item) => {
      const [startHour, startMinute] = String(item.start_time || "").split(":").map(Number);
      const [endHour, endMinute] = String(item.end_time || "").split(":").map(Number);
      const minutes = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
      return sum + (Number.isFinite(minutes) && minutes > 0 ? minutes / 60 : 0);
    }, 0);
  };

  const withServiceSurcharge = (amount, details, dateKey, timeSlots = []) => {
    const surcharge = details?.surcharges || {};
    const nightFrom = String(surcharge.night_from || "22:00");
    const nightTo = String(surcharge.night_to || "06:00");
    const hasNight = timeSlots.some((slot) => {
      const start = String(slot.start_time || "").slice(0, 5);
      const end = String(slot.end_time || "").slice(0, 5);
      return (start && (start >= nightFrom || start < nightTo)) || (end && (end > nightFrom || end <= nightTo));
    });
    const holidayDates = new Set((Array.isArray(surcharge.holiday_dates) ? surcharge.holiday_dates : []).map((date) => String(date).slice(0, 10)));
    const percent = (hasNight ? toNum(surcharge.night_percent, 0) : 0) + (holidayDates.has(String(dateKey).slice(0, 10)) ? toNum(surcharge.holiday_percent, 0) : 0);
    return amount + amount * percent / 100;
  };

  const priceForDuration = (service, durationHours, fallback = 0, dateKey = "", timeSlots = []) => {
    if (!service) return toNum(fallback, 0);
    const details = service?.raw?.details || service?.details || {};
    const mode = String(details.pricing_mode || "fixed").toLowerCase();
    const basePrice = serviceUnitPrice(service, dateKey, Math.max(1, toNum(adt) + toNum(chd)), residentType) || toNum(fallback, 0);
    const hours = Math.max(toNum(details.minimum_hours, 1), toNum(durationHours, 0));
    if (mode === "hourly") return withServiceSurcharge(basePrice * Math.max(hours, 1), details, dateKey, timeSlots);
    if (mode === "packages") {
      const { variant } = matchingServiceRate(service, dateKey, Math.max(1, toNum(adt) + toNum(chd)), residentType);
      const halfHours = Math.max(1, toNum(details.half_day_hours, 4));
      const fullHours = Math.max(halfHours, toNum(details.full_day_hours, 8));
      const halfPrice = toNum(variant?.half_day_price, toNum(details.half_day_price, basePrice));
      const fullPrice = toNum(variant?.full_day_price, toNum(details.full_day_price, halfPrice || basePrice));
      const extraHourPrice = toNum(variant?.extra_hour_price, toNum(details.extra_hour_price, basePrice));
      if (hours <= halfHours) return withServiceSurcharge(halfPrice, details, dateKey, timeSlots);
      if (hours <= fullHours) return withServiceSurcharge(fullPrice, details, dateKey, timeSlots);
      return withServiceSurcharge(fullPrice + (hours - fullHours) * extraHourPrice, details, dateKey, timeSlots);
    }
    return withServiceSurcharge(basePrice, details, dateKey, timeSlots);
  };

  const calcGuideForDay = (dateKey) => {
    const st = byDay[dateKey] || {};
    const hours = durationHoursForProvider(st, "guide", st?.guide?.id);
    const slots = normalizeScheduleItems(st?.schedule).filter((item) => item.type === "guide" && String(item.provider_id || "") === String(st?.guide?.id || ""));
    return priceForDuration(st?.guideService, hours, st?.guide?.price_per_day, dateKey, slots);
  };
  const calcTransportForDay = (dateKey) => {
    const st = byDay[dateKey] || {};
    if (st?.guideService?.category === "city_tour_guide_with_transport" || st?.guideService?.raw?.details?.transport_included) return 0;
    const hours = durationHoursForProvider(st, "transport", st?.transport?.id);
    const slots = normalizeScheduleItems(st?.schedule).filter((item) => item.type === "transport" && String(item.provider_id || "") === String(st?.transport?.id || ""));
    return priceForDuration(st?.transportService, hours, st?.transport?.price_per_day, dateKey, slots);
  };
  
  const moneyToUZS = (amount, currency) => {
    const value = toNum(amount, 0);
    const code = String(currency || "UZS").trim().toUpperCase();
    if (code === "UZS") return value;
    if (code === "USD") return Number(usdRate) > 0 ? value * Number(usdRate) : 0;
    return 0;
  };

  const calcHotelForDay = (dateKey) => {
    const st = byDay[dateKey] || {};
    if (st.hotelBreakdown?.quoteValid === false) return 0;
    const amount = toNum(st.hotelRoomsTotal, toNum(st.hotel?.price, 0));
    const currency = st.hotelBrief?.currency || st.hotel?.currency || "UZS";
    return moneyToUZS(amount, currency);
  };

  
  // стоимость межгородних трансферов за день в UZS
  const calcTransfersForDay = (dateKey) => {
    const st = byDay[dateKey] || {};
    const pax = Math.max(1, toNum(adt) + toNum(chd));
    const flights = normalizeScheduleItems(st.schedule)
      .map((item) => item?.services?.transport?.flight)
      .filter(Boolean);
    const rail = normalizeScheduleItems(st.schedule)
      .map((item) => item?.services?.transport?.rail)
      .filter(Boolean);
    const list = [...(Array.isArray(st.transfers) ? st.transfers : []), ...flights, ...rail];
    let sum = 0;
    for (const tr of list) {
      const price = toNum(tr?.price, 0);
      if (!price) continue;
      const isUSD = String(tr?.currency || "UZS").toUpperCase() === "USD";
      const priceUZS = isUSD ? (Number(usdRate) > 0 ? price * Number(usdRate) : 0) : price;
      sum += priceUZS * (tr?.perPax ? pax : 1);
    }
    return sum;
  };

  const totals = useMemo(() => {
    let guide = 0, transport = 0, hotel = 0, entries = 0, transfers = 0, meals = 0;
    Object.keys(byDay).forEach((k) => {
      guide += calcGuideForDay(k);
      transport += calcTransportForDay(k);
      hotel += calcHotelForDay(k);
      entries += calcEntryForDay(k);
      transfers += calcTransfersForDay(k);
      meals += calcMealsForDay(k);
    });
    const net = guide + transport + hotel + entries + transfers + meals;
    const pax = Math.max(1, toNum(adt, 0) + toNum(chd, 0));
    return { guide, transport, hotel, entries, transfers, meals, net, perPax: net / pax };
  }, [byDay, adt, chd, residentType, usdRate]);
  const commercialTotals = useMemo(() => {
    const net = summaryCurrency === "USD" ? toUSD(totals.net) : totals.net;
    const markup = markupType === "fixed"
      ? Math.max(0, Number(markupValue) || 0)
      : net * Math.max(0, Number(markupValue) || 0) / 100;
    const gross = net + markup;
    const pax = Math.max(1, toNum(adt, 0) + toNum(chd, 0));
    return { net, markup, gross, perPax: gross / pax };
  }, [totals.net, summaryCurrency, usdRate, markupType, markupValue, adt, chd]);
  const builderReadiness = useMemo(() => {
    const states = Object.values(byDay);
    const hasDates = days.length > 0;
    const hasRoute = hasDates && states.length === days.length && states.every((state) => String(state?.city || "").trim());
    const hasComponents = hasRoute && states.every((state) => normalizeScheduleItems(state?.schedule).length > 0);
    const hasServices = states.some((state) => state?.guide?.id || state?.transport?.id || state?.hotel?.id);
    const hasPrice = totals.net > 0;
    const requiredSteps = [
      { key: "dates", done: hasDates },
      { key: "route", done: hasRoute && hasComponents },
      { key: "services", done: hasServices },
      { key: "price", done: hasPrice },
    ];
    const ready = requiredSteps.every((step) => step.done);
    const steps = [...requiredSteps, { key: "send", done: ready }];
    const warnings = [
      ...(demoMode ? ["demo"] : []),
      ...(summaryCurrency === "USD" && Number(usdRate) <= 0 ? ["usd_rate"] : []),
      ...(hasRoute && states.some((state) => !String(state?.program_i18n?.[lang] || state?.program_text || "").trim()) ? ["program"] : []),
    ];
    return { steps, completed: requiredSteps.filter((step) => step.done).length, requiredCount: requiredSteps.length, ready, warnings };
  }, [byDay, days.length, demoMode, lang, summaryCurrency, totals.net, usdRate]);

  const focusOnboardingStep = (key) => {
    const target = key === "dates" ? "tb-step-dates" : key === "price" || key === "send" ? "tb-step-price" : "tb-step-route";
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const buildTourProgram = () =>
    Object.entries(byDay)
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([date, st], idx) => {
        const program_i18n = normalizeProgramI18n(st?.program_i18n || st?.program || {});
        return {
          day: idx + 1,
          date,
          city: String(st?.city || "").trim(),
          program_i18n,
          program_text: pickProgramText(program_i18n, lang || i18n.language || "ru"),
          schedule: normalizeScheduleItems(st?.schedule),
        };
      })
      .filter((row) => row.city || row.program_text);

  const buildTourProgramText = (items = buildTourProgram()) =>
    items
      .map((row) => {
        const head = [`D${row.day}`, row.date, row.city].filter(Boolean).join(" • ");
        return [head, row.program_text].filter(Boolean).join("\n");
      })
      .filter(Boolean)
      .join("\n\n");

  // ===== СБОРКА И ОТПРАВКА ЗАПРОСОВ ПРОВАЙДЕРАМ =====
  // схема: на каждого уникального провайдера (guide/transport) — один запрос с массивом дат.
  const buildBookings = () => {
    const tourProgram = buildTourProgram();
    const tourProgramText = buildTourProgramText(tourProgram);
    const buckets = new Map(); // key = `${kind}:${provider_id}` → { kind, provider_id, service_id?, dates[] }
    for (const [dateKey, st] of Object.entries(byDay)) {
      if (!st?.city) continue;
      const schedule = normalizeScheduleItems(st.schedule);
  // гид → смотрим категорию выбранной услуги
  if (st?.guide?.id) {
    const pid = String(st.guide.id);
    const svc = st?.guideService;
    const svcId = (svc?.raw?.id ?? svc?.id) || null;
    // если у гида выбрана транспортная услуга — считаем это транспортом
    const kindForGuide =
      svc && TRANSPORT_ALLOWED.has(svc.category) ? "transport" : "guide";

    const key = `${kindForGuide}:${pid}:${svcId || "quote"}`;
    if (!buckets.has(key)) {
      buckets.set(key, { kind: kindForGuide, provider_id: pid, service_id: null, dates: [], time_slots: [] });
    }
    const b = buckets.get(key);
    if (svcId && !b.service_id) b.service_id = String(svcId);
    b.dates.push(dateKey);
    b.time_slots.push(...schedule
      .filter((item) => String(item.provider_id || "") === pid && item.type === kindForGuide)
      .map((item) => ({ date: dateKey, start_time: item.start_time, end_time: item.end_time, title: item.title || item.service_title || "" })));
  }
      // транспорт
      if (st?.transport?.id) {
        const pid = String(st.transport.id);
        const svcId = (st?.transportService?.raw?.id ?? st?.transportService?.id) || null; // ← real
        const key = `transport:${pid}:${svcId || "quote"}`;
        if (!buckets.has(key)) buckets.set(key, { kind: "transport", provider_id: pid, service_id: null, dates: [], time_slots: [] });
        const b = buckets.get(key);
        if (svcId && !b.service_id) b.service_id = String(svcId);
        b.dates.push(dateKey);
        b.time_slots.push(...schedule
          .filter((item) => String(item.provider_id || "") === pid && item.type === "transport")
          .map((item) => ({ date: dateKey, start_time: item.start_time, end_time: item.end_time, title: item.title || item.service_title || "" })));
      }
      // отель: котировка уже содержит владельца предложения и точный snapshot
      const hotelQuote = st?.hotelBreakdown?.quoteSnapshot;
      const hotelProviderId = hotelQuote?.hotel?.provider_id;
      if (hotelQuote?.valid === true && hotelProviderId) {
        const pid = String(hotelProviderId);
        const key = `hotel:${pid}`;
        if (!buckets.has(key)) buckets.set(key, { kind: "hotel", provider_id: pid, service_id: null, dates: [] });
        buckets.get(key).dates.push(dateKey);
      }
    }
   // формируем payload'ы
    const payloads = [];
    for (const b of buckets.values()) {
      payloads.push({
        kind: b.kind,
        provider_id: b.provider_id,
        ...(b.service_id ? { service_id: b.service_id } : {}), // ← только если есть реальный id
        dates: [...new Set(b.dates)].sort(),
        time_slots: b.time_slots || [],
        pax_adult: Number(adt) || 0,
        pax_child: Number(chd) || 0,
        language: String(lang || "en"),
     // message – просто информационное поле для менеджеров/провайдеров
        message: `[TourBuilder] ${b.kind} • PAX ${Number(adt)+Number(chd)} • ${residentType.toUpperCase()}`,
        source: "tour_builder",
        // 🔹 Явно прокидываем класс услуги из TB
        tb_kind: String(b.kind || "").toLowerCase(),         // guide | transport | hotel | entry
        // 🔹 Минимальная служебная мета (можно расширять при необходимости)
        tb_meta: {
          class: String(b.kind || "").toLowerCase(),
          // подсказка для бэка/отчётов: даты как есть из TB
          dates: [...new Set(b.dates)].sort()
        },
        tour_program: tourProgram,
        tour_program_text: tourProgramText,
        __needs_group_id: true,
      });
    }
    return payloads;
  };

  const [sending, setSending] = useState(false);
  const bookingSendLockRef = useRef(false);
  
  const handleSendRequests = async () => {
  if (demoMode)
    return alert(t("tb.onboarding.demo_send_blocked"));
  if (!range?.from || !range?.to)
    return alert(t("tb.select_route_dates"));

  const hotelDays = Object.entries(byDay).filter(([, state]) => state?.hotel?.id);
  const invalidHotelDay = hotelDays.find(([, state]) => state?.hotelBreakdown?.quoteValid !== true);
  if (invalidHotelDay) {
    const [date, state] = invalidHotelDay;
    const reason = state?.hotelBreakdown?.warnings?.map((warning) => hotelQuoteWarningText(warning, t)).join("; ") || t("tb.ui.calculation_not_ready");
    return alert(t("tb.err.hotel_not_calculated", { date, reason }));
  }

  const hotelQuoteSnapshots = hotelDays
    .map(([date, state]) => ({ date, ...state?.hotelBreakdown?.quoteSnapshot }))
    .filter((quote) => quote.quote_version);

  const payloads = buildBookings();
  if (!payloads.length)
    return alert(t("tb.err.providers_missing"));

  const routeCities = computeRouteCities(byDay);
  const legs = buildLegsFromByDay(byDay);
  const transportSegments = buildTransportSegments(byDay);
  setBookingConfirmation({ hotelQuoteSnapshots, payloads, routeCities, legs, transportSegments });
};

  const confirmSendRequests = async () => {
  const plan = bookingConfirmation;
  if (!plan || sending || bookingSendLockRef.current) return;
  bookingSendLockRef.current = true;
  const { hotelQuoteSnapshots, payloads, routeCities, legs, transportSegments = [] } = plan;
  setSending(true);

  try {
    let ok = 0,
      fail = 0;
    let groupId =
      crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
    const errs = [];

    const itinerary = buildTourProgram();
    const routeLabel = [routeCities.from, routeCities.to].filter(Boolean).join(" — ");
    const packageTitle = routeLabel || `${t("tb.title")} ${ymd(range.from)} — ${ymd(range.to)}`;
    const validUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    try {
      const tourPackage = await createTourPackage({
        id: groupId,
        title: packageTitle,
        status: "draft",
        currency: summaryCurrency,
        net_total: commercialTotals.net,
        markup_type: markupType,
        markup_value: Number(markupValue) || 0,
        pax_adult: Number(adt) || 0,
        pax_child: Number(chd) || 0,
        start_date: ymd(range.from),
        end_date: ymd(range.to),
        quote_valid_until: validUntil,
        route: routeCities,
        itinerary,
        meta: { resident_type: residentType, language: lang, transport_segments: transportSegments },
      });
      groupId = tourPackage.id || groupId;
    } catch (error) {
      setBookingResult({ status: "error", created: 0, ok: 0, fail: payloads.length, groupId: null, errs: [String(error?.message || error)] });
      return;
    }

    for (const p of payloads) {
      try {
        const belongs =
          p.service_id &&
          ensureServiceBelongsToProvider(p.provider_id, p.service_id);

        const body = {
          provider_id: String(p.provider_id),
          ...(belongs ? { service_id: String(p.service_id) } : {}),
          dates: p.dates,
          time_slots: Array.isArray(p.time_slots) ? p.time_slots : [],
          pax_adult: Number(p.pax_adult) || 0,
          pax_child: Number(p.pax_child) || 0,
          language: p.language || "en",
          message: p.message || "",
          source: "tour_builder",
          type: p.kind,
          tb_kind: p.tb_kind || p.kind,
          ...(p.__needs_group_id ? { group_id: groupId } : {}),
          details: {
            from_city: routeCities.from || "",
            to_city: routeCities.to || "",
            tb_kind: p.tb_kind || p.kind || "",
            pax_adult: Number(p.pax_adult) || 0,
            pax_child: Number(p.pax_child) || 0,
            resident_type: residentType,
            provider_service_id: p.service_id ? Number(p.service_id) : null,
            tour_program: Array.isArray(p.tour_program) ? p.tour_program : [],
            tour_program_text: p.tour_program_text || "",
            time_slots: Array.isArray(p.time_slots) ? p.time_slots : [],
            hotel_quotes: p.kind === "hotel"
              ? hotelQuoteSnapshots.filter((quote) => String(quote?.offer?.provider_id ?? quote?.hotel?.provider_id) === String(p.provider_id))
              : [],
            transport_segments: transportSegments,
          },
          legs,
        };

        delete body.__needs_group_id;
        await createBookingCompat(body);
        ok++;
      } catch (e) {
        console.error("booking failed", e);
        errs.push(String(e?.message || e));
        fail++;
      }
    }

    // вместо alert — открываем красивое модальное окно
    if (ok && !fail) {
      await updateTourPackage(groupId, { status: "request_sent" }).catch(() => {});
      setBookingResult({
        status: "success",
        created: ok,
        ok,
        fail,
        groupId,
        url: `/dashboard/tour-packages/${groupId}`,
        errs,
      });
    } else if (ok && fail) {
      await updateTourPackage(groupId, { status: "request_sent", meta: { partial_creation: true } }).catch(() => {});
      setBookingResult({
        status: "partial",
        created: ok,
        ok,
        fail,
        groupId,
        url: `/dashboard/tour-packages/${groupId}`,
        errs,
      });
    } else {
      await updateTourPackage(groupId, { status: "draft", meta: { creation_failed: true } }).catch(() => {});
      setBookingResult({
        status: "error",
        created: ok,
        ok,
        fail,
        groupId: null,
        errs,
      });
    }
  } finally {
    bookingSendLockRef.current = false;
    setSending(false);
    setBookingConfirmation(null);
  }
};

   // Если PAX увеличился и выбранная (транспорт/гид+транспорт) не тянет — очищаем.
  useEffect(() => {
    const pax = Math.max(1, toNum(adt) + toNum(chd));
    setByDay((prev) => {
      const copy = { ...prev };
      Object.keys(copy).forEach((k) => {
        const st = copy[k] || {};
        if (st.transportService && !fitsPax(st.transportService, pax)) {
          copy[k] = { ...st, transportService: null };
        }
        if (st.guideService && TRANSPORT_ALLOWED.has(st.guideService.category) &&
            !fitsPax(st.guideService, pax)) {
          copy[k] = { ...copy[k], guideService: null };
        }
      });
      return copy;
    });
  }, [adt, chd]);

    // [TPL] локальное состояние шаблонов
  const [tpls, setTpls] = useState(listTemplates());
  const refreshTpls = async () => {
    await syncTemplates();
    setTpls(listTemplates());
  };
    useEffect(() => {
    (async () => {
    await refreshTpls();
    })();
  }, []);

  // [TPL] модал применения
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyTplId, setApplyTplId] = useState("");
  const [applyFrom, setApplyFrom] = useState(""); // 'YYYY-MM-DD'
  // при открытии модалки подставляем сегодня (или текущий from, если он в будущем)
  useEffect(() => {
    if (!applyOpen) return;
    const today = ymd(startOfDay(new Date()));
    const current = range?.from ? ymd(startOfDay(range.from)) : today;
    setApplyFrom(current < today ? today : current);
  }, [applyOpen]);
  // [TPL] раскрытые группы (аккордеон по странам)
  const [openGroups, setOpenGroups] = useState({});
  const toggleGroup = (code) => setOpenGroups((m) => ({ ...m, [code]: !m[code] }));

// [TPL] используем модульные ymd() и addDays()

  function applyTemplateNow() {
    const tpl = getTemplate(applyTplId);
    if (!tpl) return alert(t('tb.err.select_template'));
    if (!applyFrom) return alert(t('tb.err.start_required'));
    if (!tpl.days?.length) return alert(t('tb.err.template_empty'));
    const start = new Date(applyFrom);
    if (isNaN(start)) return alert(t('tb.err.invalid_date'));
       // ❗ не допускаем прошлые даты (сравнение по началу суток)
   const today = startOfDay(new Date());
   if (start < today) {
     alert(t('tb.err.past_forbidden'));
     return;
   }

    // выставляем диапазон под длину шаблона
    const to = addDays(start, tpl.days.length - 1);
   setRange({ from: start, to });

    // предзаполняем byDay: города из шаблона по порядку
   const next = {};
    for (let i=0;i<tpl.days.length;i++){
      const ymdStr = ymd(addDays(start, i));
         // убираем префикс вида "D1 - ", "D2–", "D3:" и т.п.
   const city = String(tpl.days[i].city || "")
     .replace(/^\s*D\d+\s*[-–—:]?\s*/i, "")
     .trim();
     next[ymdStr] = {
       city,
        guide: null, transport: null, hotel: null,
        guideService: null, transportService: null,
        entrySelected: [],
        transfers: [],
        meals: [],
        program_i18n: normalizeProgramI18n(tpl.days[i]?.program_i18n || tpl.program_i18n || {}),
        schedule: normalizeScheduleItems(tpl.days[i]?.schedule),
        _programTab: TB_PROGRAM_LANGS.includes(String(i18n.language || "ru").slice(0, 2))
          ? String(i18n.language || "ru").slice(0, 2)
          : "ru",
      };
    }
    setByDay(next);
       // 🔽 СРАЗУ подтягиваем «Отели» и «Входные билеты» для каждого дня
   (async () => {
     const tasks = [];
     for (let i = 0; i < tpl.days.length; i++) {
       const ymdStr = ymd(addDays(start, i));
       const city = next[ymdStr].city;
       // очистим строку поиска для entry и загрузим варианты
       tasks.push(
         (async () => {
           setEntryQMap(m => ({ ...m, [ymdStr]: "" }));
           await Promise.all([
             loadEntryOptionsForDay(ymdStr, city, ""),
             loadHotelOptionsForDay(ymdStr, city),
           ]);
         })()
       );
     }
     await Promise.all(tasks);
   })();
    setApplyOpen(false);
  }

    // Блокировка прокрутки фона, пока открыта модалка
  useEffect(() => {
    if (!applyOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [applyOpen]);

  // Закрытие модалки по Esc
  useEffect(() => {
    if (!applyOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setApplyOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyOpen]);


  /* ---------------- render ---------------- */
  return (
    <main className="min-h-screen overflow-x-hidden bg-slate-100 px-2 py-3 sm:px-3 lg:px-4 lg:py-4 2xl:px-6">
      <div className="mx-auto w-full max-w-[1680px] space-y-4 bg-white px-3 py-4 sm:px-4 lg:px-5 lg:py-5 2xl:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-950">{t('tb.title')}</h1>
            <p className="mt-1 text-sm text-slate-500">{t("tb.ui.subtitle")}</p>
          </div>
          <div className="flex items-center gap-5 text-sm">
            <div><span className="text-slate-500">{t("tb.ui.days")}</span><strong className="ml-2 text-slate-950">{days.length}</strong></div>
            <div><span className="text-slate-500">PAX</span><strong className="ml-2 text-slate-950">{Math.max(0, toNum(adt) + toNum(chd))}</strong></div>
          </div>
        </div>
        <section className="border border-slate-200 bg-slate-50 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><div className="text-xs font-bold uppercase text-orange-600">{t("tb.onboarding.eyebrow")}</div><h2 className="mt-1 text-base font-bold text-slate-950">{builderReadiness.ready ? t("tb.onboarding.ready_title") : t("tb.onboarding.title")}</h2><p className="mt-1 text-sm text-slate-500">{t("tb.onboarding.hint")}</p></div>
            <button type="button" onClick={loadDemoTour} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800 hover:border-orange-400 hover:bg-orange-50"><Sparkles size={16} />{t("tb.onboarding.demo")}</button>
          </div>
          <div className="mt-4 grid gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 sm:grid-cols-5">
            {builderReadiness.steps.map((step, index) => <button type="button" onClick={() => focusOnboardingStep(step.key)} key={step.key} className={`flex items-center gap-2 bg-white px-3 py-3 text-left text-sm hover:bg-orange-50 ${step.done ? "text-emerald-700" : "text-slate-500"}`}>{step.done ? <Check size={16} className="shrink-0" /> : <Circle size={16} className="shrink-0" />}<span><span className="mr-1 text-xs font-bold text-slate-400">{index + 1}.</span>{t(`tb.onboarding.steps.${step.key}`)}</span></button>)}
          </div>
          {demoMode && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900"><span><strong>{t("tb.onboarding.demo_mode")}</strong> {t("tb.onboarding.demo_hint")}</span><button type="button" onClick={() => setDemoMode(false)} className="h-9 border border-sky-300 bg-white px-3 font-bold text-sky-900 hover:bg-sky-100">{t("tb.onboarding.use_demo")}</button></div>}
          {builderReadiness.warnings.length > 0 && !demoMode && <div className="mt-3 flex flex-wrap gap-2">{builderReadiness.warnings.map((warning) => <span key={warning} className="border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">{t(`tb.onboarding.warnings.${warning}`)}</span>)}</div>}
        </section>
        {/* [TPL] панель шаблонов — аккордеон по странам */}
        <section className="border-y border-slate-200 py-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900">{t('tb.templates')}</h2>
            <Link className="text-sm font-semibold text-slate-600 underline decoration-slate-300 underline-offset-4 hover:text-orange-600" to="/templates">
              {t('tb.templates_open')}
            </Link>
          </div>

          <div className="grid min-w-0 gap-2 xl:grid-cols-2">
            {Object.entries(
              tpls
                .slice()
                .sort((a, b) => a.title.localeCompare(b.title))
                .reduce((acc, t) => {
                  const m = String(t.title || "").match(/^([A-Za-z]{2,4})\s*:/);
                  const key = (m?.[1] || "Other").toUpperCase();
                  (acc[key] ||= []).push(t);
                  return acc;
                }, {})
            )
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([country, list]) => {
                const open = !!openGroups[country];
                return (
                   <div key={country} className="min-w-0 rounded-md border border-slate-200 bg-white">
                    {/* шапка группы (кнопка UZB/...) */}
                    <button
                      type="button"
                      onClick={() => toggleGroup(country)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                    >
                      <span className="inline-flex items-center gap-2 text-sm font-semibold">
                        <span className="inline-flex h-6 shrink-0 items-center rounded-full border px-2">
                          {country}
                        </span>
                         <span className="min-w-0 break-words font-normal text-gray-500">
                          {t('tb.templates_count', { count: list.length })}
                        </span>
                      </span>
                      <span className={`transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
                    </button>

                    {/* содержимое группы */}
                    {open && (
                      <div className="px-3 pb-3 pt-1 flex flex-wrap gap-2">
                       {list.map((tpl) => (
                         <TemplateButtonWithTip
                           key={tpl.id}
                           tpl={tpl}
                           onClick={() => {
                             setApplyTplId(tpl.id);
                             setApplyOpen(true);
                           }}
                         />
                       ))}
                      </div>
                    )}
                  </div>
                );
              })}

            {!tpls.length && (
              <span className="text-sm text-gray-500 xl:col-span-2">
                {t("tb.no_templates")}
              </span>
            )}
          </div>
        </section>

        <div className="sticky bottom-2 z-30 sm:bottom-auto sm:top-16">
          <div className="ml-auto grid w-full grid-cols-2 gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 shadow-lg sm:w-auto sm:min-w-[680px] sm:grid-cols-4 xl:min-w-[760px]">
            <div className="bg-white px-3 py-2"><span className="block text-[11px] text-slate-500">{t("tb.summary.net_cost")}</span><strong className="block truncate text-sm text-slate-950">{commercialTotals.net.toLocaleString(summaryCurrency === "USD" ? "en-US" : "ru-RU", { maximumFractionDigits: 2 })} {summaryCurrency}</strong></div>
            <div className="bg-white px-3 py-2"><span className="block text-[11px] text-slate-500">{t("tb.summary.markup")}</span><strong className="block truncate text-sm text-slate-950">{commercialTotals.markup.toLocaleString(summaryCurrency === "USD" ? "en-US" : "ru-RU", { maximumFractionDigits: 2 })} {summaryCurrency}</strong></div>
            <div className="bg-slate-950 px-3 py-2 text-white"><span className="block text-[11px] text-slate-400">{t("tb.summary.sale_price")}</span><strong className="block truncate text-sm">{commercialTotals.gross.toLocaleString(summaryCurrency === "USD" ? "en-US" : "ru-RU", { maximumFractionDigits: 2 })} {summaryCurrency}</strong></div>
            <div className="bg-orange-600 px-3 py-2 text-white"><span className="block text-[11px] text-orange-100">{t("tb.summary.per_person")}</span><strong className="block truncate text-sm">{commercialTotals.perPax.toLocaleString(summaryCurrency === "USD" ? "en-US" : "ru-RU", { maximumFractionDigits: 2 })} {summaryCurrency}</strong></div>
          </div>
        </div>

        <section id="tb-step-dates" className="scroll-mt-24 grid min-w-0 gap-5 border-b border-slate-200 pb-5 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] xl:grid-cols-[minmax(720px,2.35fr)_minmax(320px,1fr)]">
          <div className="min-w-0">
            <label className="block text-sm font-medium mb-1">{t('tb.dates')}</label>
            <DayPicker
              key={`dp-${i18n.language}`}
              mode="range"
              selected={range?.from || range?.to ? range : undefined}
              onSelect={(r) => setRange(r || EMPTY_RANGE)}
              numberOfMonths={months}
              disabled={{ before: new Date() }}
              className="text-sm"
              locale={dpLocale}
            />
            <p className="text-sm text-gray-600 mt-2">
              {range?.from && range?.to
                ? t('tb.dates_span', {
                    from: ymd(startOfDay(range.from)),
                    to:   ymd(startOfDay(range.to)),
                    days: daysInclusive(range.from, range.to)
                  })
                : t('tb.pick_dates')}
            </p>
          </div>

          <div className="grid content-start gap-4 rounded-md border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-1">
            <div>
              <div className="text-sm font-medium mb-1">PAX</div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm flex items-center gap-2">
                  <span className="w-10">ADT</span>
                  <input type="number" min={0} value={adt} onChange={(e) => setAdt(e.target.value)} className="h-9 w-full border rounded px-2 text-sm" />
                </label>
                <label className="text-sm flex items-center gap-2">
                  <span className="w-10">CHD</span>
                  <input type="number" min={0} value={chd} onChange={(e) => setChd(e.target.value)} className="h-9 w-full border rounded px-2 text-sm" />
                </label>
              </div>
            </div>

            <div>
              <div className="text-sm font-medium mb-1">{t('tb.tariff_for')}</div>
              <label className="inline-flex items-center gap-2 mr-4">
                <input type="radio" checked={residentType === "nrs"} onChange={() => setResidentType("nrs")} />
                <span>{t('tb.nonresidents')}</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="radio" checked={residentType === "res"} onChange={() => setResidentType("res")} />
                <span>{t('tb.residents')}</span>
              </label>
            </div>

            <div>
              <div className="text-sm font-medium mb-1">{t('tb.speaking_lang')}</div>
              <select className="w-full h-9 border rounded px-2 text-sm" value={lang} onChange={(e) => setLang(e.target.value)}>
                {LANGS.map(([name, code]) => <option key={code} value={code}>{name}</option>)}
              </select>
                          </div>

            {/* фильтр: категория (звёзды) отелей */}
            <div>
              <div className="text-sm font-medium mb-1">
                {t('tb.hotel_category')}
              </div>
              <select
                className="w-full h-9 border rounded px-2 text-sm"
                value={hotelStars}
                onChange={(e) => setHotelStars(e.target.value)}
              >
                <option value="">{t('tb.any')}</option>
                {[1,2,3,4,5,6,7].map(n => <option key={n} value={n}>{n}★</option>)}
              </select>
            </div>
          </div>
        </section>

        {/* days */}
        <section id="tb-step-route" className="scroll-mt-24 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-orange-100 bg-orange-50/50 px-3 py-2">
            <div className="text-sm text-gray-700">
              {days.length
                ? t('tb.days_count_hint', { count: days.length })
                : t('tb.no_days_hint')}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="px-3 py-1.5 text-sm border rounded bg-white hover:bg-orange-50"
                onClick={addTourDayAtEnd}
              >
                {t('tb.add_day')}
              </button>
              {!!days.length && (
                <button
                  type="button"
                  className="px-3 py-1.5 text-sm border rounded bg-white hover:bg-orange-50"
                  onClick={() => generateProgramForAllDays({ overwrite: true })}
                >
                  {t('tb.generate_all_program')}
                </button>
              )}
            </div>
          </div>

          {days.map((d, i) => {
            const k = ymd(d);
            const st = byDay[k] || {};
            const cityChosen = Boolean(st.city);
            const selectedSchedule = normalizeScheduleItems(st.schedule).find((item) => item.id === st.selectedScheduleId) || null;
            const dayTotal = calcGuideForDay(k)
              + calcTransportForDay(k)
              + calcHotelForDay(k)
              + calcTransfersForDay(k)
              + calcEntryForDay(k)
              + calcMealsForDay(k);
            const completedSections = [
              cityChosen,
              normalizeScheduleItems(st.schedule).length > 0,
              Boolean(st.guide),
              Boolean(st.transport),
              Boolean(st.hotel),
            ].filter(Boolean).length;
            const collapsed = Boolean(collapsedDays[k]);
            const suggestedServiceCategory = selectedSchedule?.active_service_category
              || (selectedSchedule?.type === "guide" ? "tour"
                : selectedSchedule?.type === "transport" ? "transfer"
                  : selectedSchedule?.type === "hotel" ? "hotel"
                    : selectedSchedule?.type === "meal" ? "meal"
                      : "tour");
            const activeEventService = suggestedServiceCategory;
            const activeTransportSubtype = selectedSchedule?.services?.transport?.subtype || "";
            const activeIntercityMode = selectedSchedule?.services?.transport?.intercity_mode || "provider";
            const activeIntercityRoute = activeTransportSubtype === "intercity" ? intercityRouteForDay(k) : null;
            const activeRail = selectedSchedule?.services?.transport?.rail || {};
            const activeTransportCategories = TRANSPORT_SERVICE_TYPES.find((item) => item.id === activeTransportSubtype)?.categories || [];
            const activeTourSubtype = selectedSchedule?.services?.tour?.subtype || "city";
            const activeTourType = TOUR_BUILDER_TYPES.find((item) => item.id === activeTourSubtype) || TOUR_BUILDER_TYPES[0];
            const activeTourGroup = TOUR_BUILDER_GROUPS.find((item) => item.id === activeTourType.family) || TOUR_BUILDER_GROUPS[0];
            const activeTourOptions = TOUR_BUILDER_TYPES.filter((item) => item.family === activeTourGroup.id);
            const guideComponentCategories = activeTourType.guideCategories;
            const providerTransportCategories = activeEventService === "tour" ? activeTourType.transportCategories : activeTransportCategories;
            const activeGuideService = guideComponentCategories.includes(st.guideService?.category) ? st.guideService : null;
            const activeGuideIncludesTransport = Boolean(activeGuideService && (activeGuideService.category === "city_tour_guide_with_transport" || activeGuideService.raw?.details?.transport_included));
            const activeTransportService = providerTransportCategories.includes(st.transportService?.category)
              && (activeTransportSubtype !== "intercity" || fitsRoute(st.transportService, activeIntercityRoute?.from, activeIntercityRoute?.to))
              ? st.transportService
              : null;
            const selectTransportSubtype = (subtype) => {
              setByDay((previous) => {
                const current = previous[k] || {};
                const currentTransport = selectedSchedule?.services?.transport || {};
                const sameSubtype = currentTransport.subtype === subtype;
                const schedule = normalizeScheduleItems(current.schedule).map((item) => {
                  if (item.id !== selectedSchedule?.id) return item;
                  const transport = sameSubtype
                    ? { ...(item.services?.transport || {}), subtype }
                    : { subtype };
                  return { ...item, services: { ...item.services, transport } };
                });
                return {
                  ...previous,
                  [k]: {
                    ...current,
                    ...(sameSubtype ? {} : { transport: null, transportService: null }),
                    schedule,
                  },
                };
              });
            };
            const selectIntercityMode = (mode) => {
              setByDay((previous) => {
                const current = previous[k] || {};
                const schedule = normalizeScheduleItems(current.schedule).map((item) => {
                  if (item.id !== selectedSchedule?.id) return item;
                  const previousTransport = item.services?.transport || {};
                  const transport = {
                    subtype: "intercity",
                    intercity_mode: mode,
                    ...(mode === "rail" && previousTransport.rail ? { rail: previousTransport.rail } : {}),
                    ...(mode === "air" && previousTransport.flight ? { flight: previousTransport.flight } : {}),
                  };
                  return { ...item, services: { ...item.services, transport } };
                });
                return {
                  ...previous,
                  [k]: { ...current, transport: null, transportService: null, schedule },
                };
              });
            };
            const updateRailSegment = (changes) => {
              setByDay((previous) => {
                const current = previous[k] || {};
                const schedule = normalizeScheduleItems(current.schedule).map((item) => {
                  if (item.id !== selectedSchedule?.id) return item;
                  const currentTransport = item.services?.transport || {};
                  const rail = {
                    type: "rail",
                    provider: "manual",
                    date: k,
                    currency: "UZS",
                    perPax: true,
                    ...(currentTransport.rail || {}),
                    ...changes,
                  };
                  return {
                    ...item,
                    services: {
                      ...item.services,
                      transport: { ...currentTransport, subtype: "intercity", intercity_mode: "rail", rail },
                    },
                  };
                });
                return { ...previous, [k]: { ...current, schedule } };
              });
            };
            const selectTourSubtype = (subtype) => {
              setByDay((previous) => {
                const current = previous[k] || {};
                const nextTourType = TOUR_BUILDER_TYPES.find((item) => item.id === subtype) || TOUR_BUILDER_TYPES[0];
                const schedule = normalizeScheduleItems(current.schedule).map((item) => {
                  if (item.id !== selectedSchedule?.id) return item;
                  return {
                    ...item,
                    services: {
                      ...item.services,
                      tour: { ...(item.services?.tour || {}), subtype },
                      guide: {},
                      transport: nextTourType.guideOnly ? {} : { subtype: "city_tour" },
                      ...(nextTourType.guideOnly ? { attractions: { items: [] } } : {}),
                    },
                  };
                });
                return {
                  ...previous,
                  [k]: {
                    ...current,
                    guide: null,
                    guideService: null,
                    transport: null,
                    transportService: null,
                    ...(nextTourType.guideOnly ? { entrySelected: [] } : {}),
                    schedule,
                  },
                };
              });
            };
            const selectTourFamily = (family) => {
              const firstType = TOUR_BUILDER_TYPES.find((item) => item.family === family);
              if (firstType) selectTourSubtype(firstType.id);
            };
            return (
              <div
                key={k}
                className="space-y-3 rounded-lg border border-slate-200 bg-white p-3"
              >
                <div className="-mx-3 -mt-3 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-t-lg border-b border-slate-200 bg-slate-50 px-3 py-3 lg:grid-cols-[auto_minmax(220px,1fr)_auto_minmax(130px,auto)_minmax(140px,auto)_auto_auto] xl:grid-cols-[auto_minmax(360px,720px)_minmax(0,1fr)_minmax(130px,auto)_minmax(140px,auto)_auto_auto]">
                  <div className="col-start-1 row-start-1 grid h-10 w-10 shrink-0 place-items-center rounded-md bg-slate-950 text-sm font-bold text-white">D{i + 1}</div>
                  <input
                    className="col-start-2 row-start-1 h-10 min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 lg:min-w-[220px]"
                    placeholder={t('tb.city_ph')}
                    value={st.city || ""}
                    onChange={(e) => {
                      const city = (e.target.value || "").trim();
                      setByDay((previous) => Object.fromEntries(Object.entries(previous).map(([dayKey, dayValue]) => {
                        const hasIntercity = normalizeScheduleItems(dayValue.schedule).some((item) => item.services?.transport?.subtype === "intercity");
                        if (dayKey === k) return [dayKey, { ...dayValue, city, guide: null, guideService: null, transport: null, transportService: null, hotel: null, entrySelected: [] }];
                        return [dayKey, hasIntercity ? { ...dayValue, transport: null, transportService: null } : dayValue];
                      })));
                      // обновим опции билетов под новый city
                      setEntryQMap((m) => ({ ...m, [k]: "" }));
                      loadEntryOptionsForDay(k, city, "");
                      // сразу предзагрузим список отелей для селекта
                      loadHotelOptionsForDay(k, city);
                      // при смене города сбросили поставщиков; автоподбор произойдёт после выбора
                    }}
                  />
                  <div className="col-start-1 row-start-2 text-xs font-medium text-slate-500 lg:col-start-auto lg:row-start-auto lg:text-sm">{k}</div>
                  <div className="col-start-2 row-start-2 min-w-0 text-left lg:col-start-auto lg:row-start-auto lg:min-w-[130px] lg:text-right">
                    <div className="text-xs text-slate-500">{t("tb.ui.completed", { count: completedSections })}</div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${completedSections * 20}%` }} /></div>
                  </div>
                  <div className="col-start-3 row-start-1 min-w-0 text-right lg:col-start-auto lg:row-start-auto lg:min-w-[140px]"><div className="text-xs text-slate-500">{t("tb.day_total")}</div><strong className="whitespace-nowrap text-sm text-slate-950">{dayTotal.toLocaleString()} UZS</strong></div>
                  <details className="relative col-start-3 row-start-2 justify-self-end lg:col-start-auto lg:row-start-auto">
                    <summary className="grid h-9 w-9 cursor-pointer list-none place-items-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100" title={t("tb.ui.day_actions")}><MoreHorizontal size={18} /></summary>
                    <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-xl">
                      <button type="button" className="block w-full px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={() => insertTourDayAfter(k)}>{t('tb.insert_day_after')}</button>
                      <button type="button" className="block w-full px-3 py-2 text-left text-sm font-semibold text-rose-600 hover:bg-rose-50" onClick={() => removeTourDay(k)}>{t('tb.delete_day')}</button>
                    </div>
                  </details>
                  <button type="button" aria-expanded={!collapsed} className="col-span-2 col-start-2 row-start-3 justify-self-start rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 lg:col-span-1 lg:col-start-auto lg:row-start-auto" onClick={() => setCollapsedDays((previous) => ({ ...previous, [k]: !previous[k] }))}>{collapsed ? t("tb.ui.expand") : t("tb.ui.collapse")}</button>
                </div>

                {!collapsed && <>
                <TourDayTimeline
                  dayKey={k}
                  items={st.schedule}
                  selectedId={st.selectedScheduleId}
                  expandedId={expandedComponents[k] || null}
                  onExpandedChange={(expandedId) =>
                    setExpandedComponents((previous) => ({ ...previous, [k]: expandedId }))
                  }
                  onSelect={(selectedScheduleId) =>
                    setByDay((previous) => ({
                      ...previous,
                      [k]: { ...previous[k], selectedScheduleId },
                    }))
                  }
                  onChange={(schedule) =>
                    setByDay((previous) => ({
                      ...previous,
                      [k]: { ...previous[k], schedule },
                    }))
                  }
                />

                {selectedSchedule && expandedComponents[k] === selectedSchedule.id && <>
                {selectedSchedule ? (<>
                <div className="grid gap-3 border border-orange-200 bg-orange-50/30 p-3 xl:grid-cols-3">
                  {/* Guide */}
                  {activeEventService === "tour" && <>
                  {activeEventService === "tour" && <div className="rounded-md border border-slate-200 bg-white p-3 xl:col-span-3">
                    <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase text-slate-500"><MapPin size={15} /> {t("tb.ui.program_type")}</div>
                    <div className="grid gap-2 md:grid-cols-3">
                      {TOUR_BUILDER_GROUPS.map((group) => (
                        <button
                          key={group.id}
                          type="button"
                          onClick={() => selectTourFamily(group.id)}
                          className={`rounded-md border p-3 text-left ${activeTourGroup.id === group.id ? "border-slate-950 bg-slate-950 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"}`}
                        >
                          <strong className="block text-sm">{t(`tb.program_groups.${group.id}.label`, { defaultValue: group.label })}</strong>
                          <span className={`mt-0.5 block text-xs ${activeTourGroup.id === group.id ? "text-slate-300" : "text-slate-500"}`}>{t(`tb.program_groups.${group.id}.description`, { defaultValue: group.description })}</span>
                        </button>
                      ))}
                    </div>
                    <div className="mt-4 border-t border-slate-200 pt-3">
                      <div className="mb-2 text-xs font-bold uppercase text-slate-500">{t(`tb.program_groups.${activeTourGroup.id}.label`, { defaultValue: activeTourGroup.label })}: {t("tb.ui.choose_component_services")}</div>
                      <div className="flex flex-wrap gap-2">
                        {activeTourOptions.map((type) => (
                          <button
                            key={type.id}
                            type="button"
                            onClick={() => selectTourSubtype(type.id)}
                            className={`rounded-md border px-3 py-2 text-sm font-semibold ${activeTourType.id === type.id ? "border-blue-600 bg-blue-50 text-blue-800 ring-1 ring-blue-600" : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"}`}
                          >
                            {t(`tb.timeline.tour_types.${type.id}`, { defaultValue: type.label })}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>}
                  {!cityChosen && <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-900 xl:col-span-3"><MapPin size={17} /> {t("tb.ui.city_required")}</div>}
                  <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
                      <div className="grid h-8 w-8 place-items-center rounded-md bg-violet-100 text-violet-700"><UserRound size={17} /></div>
                      <div><div className="text-sm font-bold text-slate-950">1. {t('tb.guide')}</div><div className="text-xs text-slate-500">{t("tb.ui.choose_component_services")}</div></div>
                    </div>
                    <div className="p-4">
                    <label className="mb-1.5 block text-xs font-bold uppercase text-slate-500">{t("tb.ui.supplier")}</label>
                    <AsyncSelect
                        key={`guide-${k}-${activeEventService}-${activeTourType.id}-${st.city}-${lang}-${st.selectedScheduleId || "none"}-${selectedSchedule?.start_time || ""}-${selectedSchedule?.end_time || ""}`}        // ⬅️ форс-ремаунт при смене условий
                        isDisabled={!cityChosen}
                        cacheOptions={false}                         // ⬅️ убираем кеш для надежности
                        defaultOptions
                        loadOptions={makeGuideLoader(k, guideComponentCategories)}
                        filterOption={() => true}
                        components={{ Option: ProviderOption }}
                        placeholder={cityChosen ? t('tb.pick_guide') : t('tb.pick_city_first')}
                        noOptionsMessage={() => (cityChosen ? t('tb.no_providers') : t('tb.pick_city_first'))}
                        value={st.guide ? { value: st.guide.id, label: st.guide.name, raw: st.guide } : null}
                        onChange={async (opt) => {
                          const guide = opt?.raw || null;
                          setByDay((p) => {
                            const current = p[k] || {};
                            const schedule = normalizeScheduleItems(current.schedule).map((item) =>
                              item.id === current.selectedScheduleId
                                ? { ...item, services: { ...item.services, guide: { provider_id: guide?.id || null, provider_name: guide?.name || "", service_id: null, service_title: "" } } }
                                : item
                            );
                            return { ...p, [k]: { ...current, guide, guideService: null, schedule } };
                          });
                          const list = await ensureServicesLoaded(guide);
                          const pax = Math.max(1, toNum(adt) + toNum(chd));
                          const citySlug = (byDay[k]?.city || "").trim();
                          const picked = pickFromCache(guide.id, guideComponentCategories, citySlug, pax);
                          if (picked) {
                            const includesTransport = picked.category === "city_tour_guide_with_transport" || picked.raw?.details?.transport_included;
                            setByDay((p) => {
                              const current = p[k] || {};
                              const schedule = normalizeScheduleItems(current.schedule).map((item) =>
                                item.id === current.selectedScheduleId
                                  ? { ...item, services: { ...item.services, guide: { ...(item.services?.guide || {}), provider_id: guide.id, provider_name: guide.name || "", service_id: picked.id, service_title: picked.title || CATEGORY_LABELS[picked.category] || "Услуга гида", transport_included: Boolean(includesTransport) }, ...(includesTransport ? { transport: {} } : {}) } }
                                  : item
                              );
                              return { ...p, [k]: { ...current, guideService: picked, ...(includesTransport ? { transport: null, transportService: null } : {}), schedule } };
                            });
                          }
                        }}
                        classNamePrefix="rs"
                        menuPortalTarget={document.body}
                        styles={RS_STYLES}
                        />
                                        {/* выпадашка услуг гида */}
                    <select
                      className="mt-3 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-50"
                      disabled={!st.guide}
                      value={activeGuideService?.id || ""}
                      onChange={(e) => {
                        const selId = e.target.value;
                        const list = servicesCache[st.guide?.id] || [];
                        const pax = Math.max(1, toNum(adt) + toNum(chd));
                        const citySlug = (byDay[k]?.city || "").trim();
                        // показываем обычные услуги гида + гид+транспорт, но только если вместимость >= PAX
                        const allowed = list.filter(s =>
                          guideComponentCategories.includes(s.category) &&
                          s.price > 0 &&
                          fitsPax(s, pax) &&
                          fitsCity(s, citySlug)
                        );
                        const chosen = allowed.find(s => String(s.id) === selId) || null;
                        const includesTransport = chosen?.category === "city_tour_guide_with_transport" || chosen?.raw?.details?.transport_included;
                        setByDay((p) => {
                          const current = p[k] || {};
                          const schedule = normalizeScheduleItems(current.schedule).map((item) =>
                            item.id === current.selectedScheduleId
                              ? { ...item, services: { ...item.services, guide: { ...(item.services?.guide || {}), provider_id: current.guide?.id || null, provider_name: current.guide?.name || "", service_id: chosen?.id || null, service_title: chosen?.title || "", transport_included: Boolean(includesTransport) }, ...(includesTransport ? { transport: {} } : {}) } }
                              : item
                          );
                          return { ...p, [k]: { ...current, guideService: chosen, ...(includesTransport ? { transport: null, transportService: null } : {}), schedule } };
                        });
                      }}
                    >
                      <option value="">{t('tb.pick_guide_service_ph')}</option>
                      {(servicesCache[st.guide?.id] || [])
                        .filter(s => {
                          const pax = Math.max(1, toNum(adt) + toNum(chd));
                          const citySlug = (byDay[k]?.city || "").trim();
                          return guideComponentCategories.includes(s.category) && s.price > 0 && fitsPax(s, pax) && fitsCity(s, citySlug);
                        })
                        .sort((a,b) => a.price - b.price)
                        .map(s => {
                          const seats = svcSeats(s); // берёт из s.raw.details.seats
                          const vm = s.vehicle_model || s?.raw?.vehicle_model || s?.raw?.details?.vehicle_model || s?.raw?.details?.model;
                          const transportIncluded = s.category === "city_tour_guide_with_transport" || s?.raw?.details?.transport_included;
                           const base = t(`provider_services.items.${s.category}`, { defaultValue: s.title || CATEGORY_LABELS[s.category] || "Service" });
                          const effectivePrice = serviceUnitPrice(s, k, Math.max(1, toNum(adt) + toNum(chd)), residentType);
                          const parts = [base, transportIncluded ? t("provider_services_filters.transport_included") : t("provider_services_filters.guide_only"), seats ? `${seats} pax` : null, vm, `${effectivePrice.toFixed(2)} ${s.currency}`]
                            .filter(Boolean)
                            .join(" — ");
                          return (
                            <option key={s.id} value={s.id}>{parts}</option>
                          );
                        })}
                    </select>
                    <div className="mt-3 flex flex-wrap items-start justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
                      <span className="min-w-0 flex-1 break-words">{activeGuideService ? `${t(`provider_services.items.${activeGuideService.category}`, { defaultValue: t("tb.ui.selected_service") })} · ${(activeGuideService.category === "city_tour_guide_with_transport" || activeGuideService.raw?.details?.transport_included) ? t("provider_services_filters.transport_included") : t("provider_services_filters.guide_only")}` : t("tb.ui.service_not_selected")}</span>
                      <strong className="shrink-0 whitespace-nowrap text-sm text-slate-950">{activeGuideService ? calcGuideForDay(k).toFixed(2) : "0.00"} {activeGuideService?.currency || st.guide?.currency || "UZS"}</strong>
                    </div>
                    {activeGuideService && serviceRateExplanation(activeGuideService, k, Math.max(1, toNum(adt) + toNum(chd)), residentType, t) && <div className="mt-2 text-xs font-medium text-emerald-700">{serviceRateExplanation(activeGuideService, k, Math.max(1, toNum(adt) + toNum(chd)), residentType, t)}</div>}
                    </div>
                  </div>
                  
                  {/* если услуг нет: */}
                  {st.guide && (servicesCache[st.guide.id]?.length === 0) && (
                    <div className="text-xs text-amber-600 mt-1">
                      {t('tb.no_services_for_guide')}
                    </div>
                  )}
                  </>}

                  {/* Transport */}
                   {(activeEventService === "transfer" || (activeEventService === "tour" && !activeTourType.guideOnly && !activeGuideIncludesTransport)) && <>
                  <div className={`overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm ${activeEventService === "transfer" ? "xl:col-span-3" : ""}`}>
                    <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
                      <div className="grid h-8 w-8 place-items-center rounded-md bg-blue-100 text-blue-700"><BusFront size={17} /></div>
                      <div><div className="text-sm font-bold text-slate-950">{activeEventService === "tour" ? "2. " : ""}{t("tb.transport")}</div><div className="text-xs text-slate-500">{t("tb.ui.choose_transport")}</div></div>
                    </div>
                    <div className="p-4">
                    {activeEventService === "transfer" && (
                    <div className="mb-3">
                      <div className="mb-2 text-xs font-bold uppercase text-slate-500">{t("tb.ui.transport_type")}</div>
                      <div className="flex flex-wrap gap-2">
                        {TRANSPORT_SERVICE_TYPES.map((type) => (
                          <button
                            key={type.id}
                            type="button"
                            onClick={() => selectTransportSubtype(type.id)}
                            className={`rounded-md border px-3 py-2 text-sm font-semibold ${activeTransportSubtype === type.id ? "border-slate-950 bg-slate-950 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"}`}
                          >
                            {t(`tb.timeline.transport_types.${type.id}`, { defaultValue: type.label })}
                          </button>
                        ))}
                      </div>
                    </div>
                    )}
                    {activeEventService === "transfer" && activeTransportSubtype === "intercity" && (
                      <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                        <div className="mb-2 text-xs font-bold uppercase text-slate-500">{t("tb.ui.intercity_method")}</div>
                        <div className="grid gap-2 sm:grid-cols-3">
                          {[
                            { id: "provider", label: t("tb.ui.transport_supplier"), hint: t("tb.ui.transport_supplier_hint") },
                            { id: "rail", label: t("tb.ui.rail_transport"), hint: t("tb.ui.rail_hint") },
                            { id: "air", label: t("tb.ui.air_transport"), hint: t("tb.ui.air_hint") },
                          ].map((mode) => (
                            <button
                              key={mode.id}
                              type="button"
                              onClick={() => selectIntercityMode(mode.id)}
                              className={`rounded-md border p-3 text-left transition ${activeIntercityMode === mode.id ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600" : "border-slate-300 bg-white hover:border-slate-500"}`}
                            >
                              <strong className="block text-sm text-slate-950">{mode.label}</strong>
                              <span className="mt-0.5 block text-xs text-slate-500">{mode.hint}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {activeEventService === "transfer" && activeTransportSubtype === "international" && (
                      <TransportSegmentEditor
                        value={{
                          type: "air",
                          ...(selectedSchedule?.services?.transport?.flight || {}),
                        }}
                        date={k}
                        adults={Math.max(1, toNum(adt, 1))}
                        children={Math.max(0, toNum(chd, 0))}
                        lang={lang}
                        lockType="air"
                        onChange={(flight) => {
                          const scheduleId = selectedSchedule.id;
                          setByDay((previous) => {
                            const current = previous[k] || {};
                            const departureTime = timeFromFlightDateTime(flight.departure_at);
                            const arrivalTime = timeFromFlightDateTime(flight.arrival_at);
                            const schedule = normalizeScheduleItems(current.schedule).map((item) => {
                              if (item.id !== scheduleId) return item;
                              return {
                                    ...item,
                                    ...(departureTime ? { start_time: departureTime } : {}),
                                    ...(arrivalTime ? { end_time: arrivalTime } : {}),
                                    services: {
                                      ...item.services,
                                      transport: {
                                        ...(item.services?.transport || {}),
                                        subtype: "international",
                                        provider_id: null,
                                        provider_name: "",
                                        service_id: null,
                                        service_title: flight.raw_offer_id ? "Авиабилет" : "",
                                        flight: { ...flight, type: "air" },
                                      },
                                    },
                                  };
                            });
                            return { ...previous, [k]: { ...current, transport: null, transportService: null, schedule } };
                          });
                        }}
                        onRemove={() => {
                          const scheduleId = selectedSchedule.id;
                          setByDay((previous) => {
                            const current = previous[k] || {};
                            const schedule = normalizeScheduleItems(current.schedule).map((item) => {
                              if (item.id !== scheduleId) return item;
                              const transport = { ...(item.services?.transport || {}) };
                              delete transport.flight;
                              return { ...item, services: { ...item.services, transport } };
                            });
                            return { ...previous, [k]: { ...current, schedule } };
                          });
                        }}
                      />
                    )}
                    {activeEventService === "transfer" && activeTransportSubtype === "intercity" && activeIntercityMode === "air" && (
                      <TransportSegmentEditor
                        value={{
                          type: "air",
                          ...(selectedSchedule?.services?.transport?.flight || {}),
                        }}
                        date={k}
                        adults={Math.max(1, toNum(adt, 1))}
                        children={Math.max(0, toNum(chd, 0))}
                        lang={lang}
                        lockType="air"
                        onChange={(flight) => {
                          const scheduleId = selectedSchedule.id;
                          setByDay((previous) => {
                            const current = previous[k] || {};
                            const departureTime = timeFromFlightDateTime(flight.departure_at);
                            const arrivalTime = timeFromFlightDateTime(flight.arrival_at);
                            const schedule = normalizeScheduleItems(current.schedule).map((item) => {
                              if (item.id !== scheduleId) return item;
                              return {
                                ...item,
                                ...(departureTime ? { start_time: departureTime } : {}),
                                ...(arrivalTime ? { end_time: arrivalTime } : {}),
                                services: {
                                  ...item.services,
                                  transport: {
                                    ...(item.services?.transport || {}),
                                    subtype: "intercity",
                                    intercity_mode: "air",
                                    provider_id: null,
                                    provider_name: "",
                                    service_id: null,
                                    service_title: flight.raw_offer_id ? t("tb.ui.air_transport") : "",
                                    flight: { ...flight, type: "air" },
                                  },
                                },
                              };
                            });
                            return { ...previous, [k]: { ...current, transport: null, transportService: null, schedule } };
                          });
                        }}
                        onRemove={() => {
                          const scheduleId = selectedSchedule.id;
                          setByDay((previous) => {
                            const current = previous[k] || {};
                            const schedule = normalizeScheduleItems(current.schedule).map((item) => {
                              if (item.id !== scheduleId) return item;
                              const transport = { ...(item.services?.transport || {}) };
                              delete transport.flight;
                              return { ...item, services: { ...item.services, transport } };
                            });
                            return { ...previous, [k]: { ...current, schedule } };
                          });
                        }}
                      />
                    )}
                    {activeEventService === "transfer" && activeTransportSubtype === "intercity" && activeIntercityMode === "rail" && (
                      <div className="overflow-hidden rounded-md border border-amber-200 bg-amber-50/40">
                        <div className="border-b border-amber-200 bg-white px-4 py-3">
                          <strong className="block text-sm text-slate-950">{t("tb.ui.rail_transport")}</strong>
                          <span className="text-xs text-slate-500">{t("tb.ui.rail_hint")}</span>
                        </div>
                        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
                          <label className="block">
                            <span className="mb-1.5 block text-xs font-bold uppercase text-slate-500">{t("tb.ui.from")}</span>
                            <input
                              value={activeRail.from || ""}
                              onChange={(event) => updateRailSegment({ from: event.target.value })}
                              placeholder={t("tb.ui.example_city_from")}
                              className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1.5 block text-xs font-bold uppercase text-slate-500">{t("tb.ui.to")}</span>
                            <input
                              value={activeRail.to || ""}
                              onChange={(event) => updateRailSegment({ to: event.target.value })}
                              placeholder={t("tb.ui.example_city_to")}
                              className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1.5 block text-xs font-bold uppercase text-slate-500">{t("tb.ui.train_number")}</span>
                            <input
                              value={activeRail.number || ""}
                              onChange={(event) => updateRailSegment({ number: event.target.value })}
                              placeholder={t("tb.ui.example_train_number")}
                              className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                            />
                          </label>
                          <div className="grid grid-cols-[minmax(0,1fr)_92px] gap-2">
                            <label className="block">
                              <span className="mb-1.5 block text-xs font-bold uppercase text-slate-500">{t("tb.ui.price_per_person")}</span>
                              <input
                                type="number"
                                min="0"
                                step="1000"
                                value={activeRail.price ?? ""}
                                onChange={(event) => updateRailSegment({ price: Math.max(0, toNum(event.target.value, 0)) })}
                                placeholder="0"
                                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                              />
                            </label>
                            <label className="block">
                              <span className="mb-1.5 block text-xs font-bold uppercase text-slate-500">{t("tb.currency")}</span>
                              <select
                                value={activeRail.currency || "UZS"}
                                onChange={(event) => updateRailSegment({ currency: event.target.value })}
                                className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold"
                              >
                                <option value="UZS">UZS</option>
                                <option value="USD">USD</option>
                              </select>
                            </label>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-amber-200 bg-white px-4 py-3">
                          <span className="text-sm text-slate-600">{Math.max(1, toNum(adt) + toNum(chd))} {t("tb.ui.people_short")} × {toNum(activeRail.price, 0).toLocaleString()} {activeRail.currency || "UZS"}</span>
                          <div className="text-right">
                            <span className="block text-xs font-bold uppercase text-slate-500">{t("tb.ui.group_total")}</span>
                            <strong className="text-lg text-slate-950">{(toNum(activeRail.price, 0) * Math.max(1, toNum(adt) + toNum(chd))).toLocaleString("ru-RU")} {activeRail.currency || "UZS"}</strong>
                          </div>
                        </div>
                      </div>
                    )}
                    {(activeEventService === "tour" || (activeTransportSubtype && activeTransportSubtype !== "international" && !(activeTransportSubtype === "intercity" && ["rail", "air"].includes(activeIntercityMode)))) && <>
                    {activeTransportSubtype === "intercity" && (
                      <div className={`mb-3 rounded-md border px-3 py-2 text-sm ${activeIntercityRoute?.from && activeIntercityRoute?.to ? "border-sky-200 bg-sky-50 text-sky-900" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                        {activeIntercityRoute?.from && activeIntercityRoute?.to
                          ? <>{t("tb.ui.route")}: <strong>{activeIntercityRoute.from} → {activeIntercityRoute.to}</strong></>
                          : t("tb.ui.route_required")}
                      </div>
                    )}
                    <label className="mb-1.5 block text-xs font-bold uppercase text-slate-500">{t("tb.ui.supplier")}</label>
                    <AsyncSelect
                        key={`transport-${k}-${activeEventService === "tour" ? "city-tour" : activeTransportSubtype}-${st.city}-${activeIntercityRoute?.from || ""}-${activeIntercityRoute?.to || ""}-${lang}-${st.selectedScheduleId || "none"}-${selectedSchedule?.start_time || ""}-${selectedSchedule?.end_time || ""}`}
                        isDisabled={!cityChosen || (activeEventService === "transfer" && !activeTransportSubtype) || (activeTransportSubtype === "intercity" && (!activeIntercityRoute?.from || !activeIntercityRoute?.to))}
                        cacheOptions={false}                         // ⬅️ отключаем кеш
                        defaultOptions
                        loadOptions={makeTransportLoader(k, providerTransportCategories)}
                        filterOption={() => true}
                        components={{ Option: ProviderOption }}
                        placeholder={cityChosen ? t('tb.pick_transport') : t('tb.pick_city_first')}
                        noOptionsMessage={() => (cityChosen ? t('tb.no_providers') : t('tb.pick_city_first'))}
                        value={st.transport ? { value: st.transport.id, label: st.transport.name, raw: st.transport } : null}
                        onChange={async (opt) => {
                          const transport = opt?.raw || null;            // <-- объявляем переменную
                          setByDay((p) => {
                            const current = p[k] || {};
                            const schedule = normalizeScheduleItems(current.schedule).map((item) =>
                              item.id === current.selectedScheduleId
                                ? { ...item, services: { ...item.services, transport: { ...(item.services?.transport || {}), subtype: activeEventService === "tour" ? "city_tour" : activeTransportSubtype, provider_id: transport?.id || null, provider_name: transport?.name || "", service_id: null, service_title: "" } } }
                                : item
                            );
                            return { ...p, [k]: { ...current, transport, transportService: null, schedule } };
                          });
                          if (transport) {
                            await ensureServicesLoaded(transport); // прогреем кеш
                            const pax = Math.max(1, toNum(adt) + toNum(chd));
                            const citySlug = (byDay[k]?.city || "").trim();
                            const picked = pickFromCache(transport.id, providerTransportCategories, citySlug, pax, activeTransportSubtype === "intercity" ? activeIntercityRoute : null);
                            if (picked) {
                              setByDay((p) => {
                                const current = p[k] || {};
                                const schedule = normalizeScheduleItems(current.schedule).map((item) =>
                                  item.id === current.selectedScheduleId
                                    ? { ...item, services: { ...item.services, transport: { ...(item.services?.transport || {}), provider_id: transport.id, provider_name: transport.name || "", service_id: picked.id, service_title: picked.title || CATEGORY_LABELS[picked.category] || "Транспорт" } } }
                                    : item
                                );
                                return { ...p, [k]: { ...current, transportService: picked, schedule } };
                              });
                            }
                          } 
                        }}
                        classNamePrefix="rs"
                         menuPortalTarget={document.body}
                         styles={RS_STYLES}
                        />
                                        {/* выпадашка услуг транспорта */}
                    <select
                      className="mt-3 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-50"
                      disabled={!st.transport}
                      value={activeTransportService?.id || ""}
                      onChange={(e) => {
                        const selId = e.target.value;
                        const list = servicesCache[st.transport?.id] || [];
                        const pax = Math.max(1, toNum(adt) + toNum(chd));
                        const citySlug = (byDay[k]?.city || "").trim();
                        const allowedSet = new Set(providerTransportCategories);
                        const allowed = list.filter(
                          s =>
                            allowedSet.has(s.category) &&
                            s.price > 0 &&
                            fitsPax(s, pax) &&
                            (activeTransportSubtype === "intercity" ? fitsRoute(s, activeIntercityRoute?.from, activeIntercityRoute?.to) : fitsCity(s, citySlug))
                        );
                        const chosen = allowed.find(s => String(s.id) === selId) || null;
                        setByDay((p) => {
                          const current = p[k] || {};
                          const schedule = normalizeScheduleItems(current.schedule).map((item) =>
                            item.id === current.selectedScheduleId
                              ? { ...item, services: { ...item.services, transport: { ...(item.services?.transport || {}), provider_id: current.transport?.id || null, provider_name: current.transport?.name || "", service_id: chosen?.id || null, service_title: chosen?.title || "" } } }
                              : item
                          );
                          return { ...p, [k]: { ...current, transportService: chosen, schedule } };
                        });
                      }}
                    >
                      <option value="">{t('tb.pick_transport_service_ph')}</option>
                      {(servicesCache[st.transport?.id] || [])
                        .filter(s => {
                          const pax = Math.max(1, toNum(adt) + toNum(chd));
                          const citySlug = (byDay[k]?.city || "").trim();
                          return (
                            providerTransportCategories.includes(s.category) &&
                            s.price > 0 &&
                            fitsPax(s, pax) &&
                            (activeTransportSubtype === "intercity" ? fitsRoute(s, activeIntercityRoute?.from, activeIntercityRoute?.to) : fitsCity(s, citySlug))
                          );
                        })
                        .sort((a,b) => a.price - b.price)
                        .map(s => {
                          const seats = svcSeats(s);
                          const vm = s.vehicle_model || s?.raw?.vehicle_model || s?.raw?.details?.vehicle_model || s?.raw?.details?.model;
                           const base = t(`provider_services.items.${s.category}`, { defaultValue: s.title || CATEGORY_LABELS[s.category] || "Service" });
                          const effectivePrice = serviceUnitPrice(s, k, Math.max(1, toNum(adt) + toNum(chd)), residentType);
                          const parts = [base, seats ? `${seats} pax` : null, vm, `${effectivePrice.toFixed(2)} ${s.currency}`]
                            .filter(Boolean)
                            .join(" — ");
                          return (
                            <option key={s.id} value={s.id}>{parts}</option>
                          );
                        })}
                    </select>
                    <div className="mt-3 flex flex-wrap items-start justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
                      <span className="min-w-0 flex-1 break-words">{activeTransportService ? t(`provider_services.items.${activeTransportService.category}`, { defaultValue: t("tb.ui.selected_service") }) : t("tb.ui.service_not_selected")}</span>
                      <strong className="shrink-0 whitespace-nowrap text-sm text-slate-950">{activeTransportService ? calcTransportForDay(k).toFixed(2) : "0.00"} {activeTransportService?.currency || st.transport?.currency || "UZS"}</strong>
                    </div>
                    {activeTransportService && serviceRateExplanation(activeTransportService, k, Math.max(1, toNum(adt) + toNum(chd)), residentType, t) && <div className="mt-2 text-xs font-medium text-emerald-700">{serviceRateExplanation(activeTransportService, k, Math.max(1, toNum(adt) + toNum(chd)), residentType, t)}</div>}
                    </>}
                    </div>
                  </div>
                  {/* если услуг нет: */}
                  {st.transport && (servicesCache[st.transport.id]?.length === 0) && (
                    <div className="text-xs text-amber-600 mt-1">
                      {t('tb.no_services_for_transport')}
                    </div>
                  )}
                  </>}
                  {/* Hotel */}
                  {activeEventService === "hotel" && (
                  <div className="min-w-0 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm xl:col-span-3">
                    <div className="flex min-w-0 items-center gap-3 border-b border-slate-200 px-4 py-3">
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-cyan-100 text-cyan-700"><BedDouble size={17} /></div>
                      <div className="min-w-0"><div className="break-words text-sm font-bold text-slate-950">{t('tb.hotel')}</div><div className="break-words text-xs text-slate-500">{t("tb.rooms_and_meals")}</div></div>
                    </div>
                    <div className="min-w-0 p-4">
                      <AsyncSelect
                      key={`hotel-${k}-${st.city}`}              /* форс-ремоунт при смене города */
                      isDisabled={!cityChosen}
                      cacheOptions={false}
                      maxMenuHeight={320}         /* ⬅️ ограничение высоты меню + скролл */
                      /* используем предзагруженные варианты из предзагрузки по городу */
                      defaultOptions={hotelOptionsMap[k] || []}
                      loadOptions={(input, cb) => {
                        const all = hotelOptionsMap[k] || [];
                        const q = (input || '').trim().toLowerCase();
                        cb(q ? all.filter(o => o.label.toLowerCase().includes(q)) : all);
                      }}
                      components={{ Option: HotelOption }}
                      placeholder={cityChosen ? t('tb.pick_hotel') : t('tb.pick_city_first')}
                      noOptionsMessage={() => (cityChosen ? t('tb.no_hotels') : t('tb.pick_city_first'))}
                      value={st.hotel ? { value: st.hotel.id, label: `${st.hotel.name}${(st.hotel.city || st.hotel.location) ? " — " + (st.hotel.city || st.hotel.location) : ""}`, raw: st.hotel } : null}
                      onChange={async (opt) => {
                         const hotel = opt?.raw || null;
                         // сбрасываем прежние данные отеля
                         setByDay((p) => ({
                           ...p,
                           [k]: (() => {
                             const current = p[k] || {};
                             const schedule = normalizeScheduleItems(current.schedule).map((item) =>
                               item.id === current.selectedScheduleId
                                 ? { ...item, services: { ...item.services, hotel: { provider_id: hotel?.id || null, provider_name: hotel?.name || "" } } }
                                 : item
                             );
                             return {
                             ...current,
                             hotel,
                             hotelBrief: null,
                             hotelOffers: [],
                             hotelOffer: null,
                             hotelRoomsTotal: 0,
                             hotelLoading: !!hotel,
                             schedule,
                           }; })()
                         }));
                         if (!hotel) return;
                         try {
                           const [brief, offers] = await Promise.all([
                             fetchHotelBrief(hotel.id),
                             fetchHotelOffers(
                               hotel.id,
                               k,
                               residentType === "res" ? "resident" : "non_resident"
                             ).catch(() => []),
                           ]);
                           setByDay((p) => ({
                             ...p,
                             [k]: { 
                               ...p[k],
                               hotelBrief: brief,
                               hotelOffers: offers,
                               hotelOffer: pickBestHotelOffer(offers, usdRate),
                               hotelLoading: false
                             }
                           }));
                         } catch {
                           setByDay((p) => ({ ...p, [k]: { ...p[k], hotelLoading: false } }));
                         }
                       }}
                      classNamePrefix="rs"
                      menuPortalTarget={document.body}
                      styles={RS_STYLES}
                    />

                    {/* ▼ ФОРМА ВЫБОРА НОМЕРОВ + моментальный расчёт */}
                    {st.hotelLoading && <div className="text-xs text-gray-500 mt-2">{t('tb.loading_hotel')}</div>}
                      {st.hotel && st.hotelBrief && Array.isArray(st.hotelOffers) && st.hotelOffers.length > 0 ? (
                        <div className="mt-3 min-w-0">
                          <span className="mb-1.5 block text-xs font-bold uppercase text-slate-500">{t("tb.ui.supplier_and_tariff")}</span>
                          <select
                            className="h-9 w-full rounded border px-2 text-sm"
                            value={st.hotelOffer?.id || ""}
                            onChange={(event) => {
                              const offer = st.hotelOffers.find((item) => Number(item.id) === Number(event.target.value)) || null;
                              setByDay((p) => ({ ...p, [k]: { ...p[k], hotelOffer: offer, hotelRoomsTotal: 0, hotelBreakdown: null } }));
                            }}
                          >
                            {st.hotelOffers.map((offer) => (
                              <option key={offer.id} value={offer.id}>
                                {offer.is_direct ? t("tb.ui.hotel_direct") : offer.provider_name}
                                {offer.min_rate ? ` — ${t("tb.ui.from_price")} ${Number(offer.min_rate).toLocaleString("ru-RU")} ${offer.currency}` : ""}
                                {` — ${offerAvailabilityText(offer, t)}`}
                              </option>
                            ))}
                          </select>
                          {st.hotelOffer ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {st.hotelOffer.is_direct ? <span className="rounded-full bg-sky-50 px-2 py-1 text-[11px] font-bold text-sky-700 ring-1 ring-sky-200">{t("tb.ui.direct_hotel")}</span> : null}
                              {Number(st.hotelOffer.id) === Number(pickBestHotelOffer(st.hotelOffers, usdRate)?.id) ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200">{t("tb.ui.best_price")}</span> : null}
                              <span className={`rounded-full px-2 py-1 text-[11px] font-bold ring-1 ${st.hotelOffer.availability_known && Number(st.hotelOffer.available_rooms || 0) <= 0 ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200"}`}>{offerAvailabilityText(st.hotelOffer, t)}</span>
                              {st.hotelOffer.unlimited_allotment ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200">{t("tb.ui.free_sale")}</span> : st.hotelOffer.has_allotment ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200">{t("tb.ui.allotment", { count: st.hotelOffer.max_allotment })}</span> : <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700 ring-1 ring-amber-200">{t("tb.ui.on_request")}</span>}
                              {st.hotelOffer.fully_refundable === true ? <span className="rounded-full bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200">{t("tb.ui.refundable")}</span> : st.hotelOffer.fully_refundable === false ? <span className="rounded-full bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700 ring-1 ring-rose-200">{t("tb.ui.nonrefundable")}</span> : null}
                              {Number(st.hotelOffer.min_stay || 1) > 1 ? <span className="rounded-full bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200">{t("tb.ui.min_nights", { count: st.hotelOffer.min_stay })}</span> : null}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {st.hotel && st.hotelBrief && st.hotelOffer ? (
                        <HotelRoomPicker
                          hotelBrief={st.hotelBrief}
                          offer={st.hotelOffer || null}
                          // для конструктора «по дню» ночёвка ровно одна: передаем текущую дату
                          nightDates={[k]}                              // ['YYYY-MM-DD']
                          residentFlag={residentType === "res"}        // true/false
                          adt={toNum(adt, 0)}
                          chd={toNum(chd, 0)}
                          paxCount={Math.max(1, toNum(adt) + toNum(chd))}
                          usdRate={usdRate}
                          onBreakdown={(b) =>
                             setByDay((p) => ({ ...p, [k]: { ...p[k], hotelBreakdown: b } }))
                           }
                          onTotalChange={(sum) =>
                            setByDay((p) => ({ ...p, [k]: { ...p[k], hotelRoomsTotal: sum } }))
                          }
                        />
                      ) : st.hotel && st.hotelBrief && !st.hotelLoading ? (
                        <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                          {t("tb.ui.no_hotel_offer")}
                        </div>
                      ) : null}
           
                    {/* Валюта отображения: итог всегда в UZS; базовую валюту отеля показываем справочно */}
                     <div className="mt-3 break-words text-xs text-slate-600">
                       {t('tb.price_per_night')}:{" "}
                       <b style={{ color: BRAND.primary }}>
                         {toNum(st.hotelRoomsTotal, toNum(st.hotel?.price, 0)).toFixed(2)} {st.hotelOffer?.currency || st.hotelBrief?.currency || st.hotel?.currency || "UZS"}
                       </b>
                       {(() => {
                         const baseCur = st.hotelOffer?.currency || st.hotelBrief?.currency || st.hotel?.currency;
                         return baseCur && baseCur.toUpperCase() !== 'UZS'
                           ? <span className="ml-1 text-[11px] text-gray-500">
                               ({calcHotelForDay(k).toFixed(2)} UZS)
                             </span>
                           : null;
                       })()}
                     </div>

                    {st.hotelBreakdown?.quoteValid === false ? (
                      <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-800">
                        {t("tb.ui.calculation_unavailable")}: {st.hotelBreakdown.warnings?.map((warning) => hotelQuoteWarningText(warning, t)).join("; ") || t("tb.ui.warning_check_hotel_rate")}.
                      </div>
                    ) : null}
 
                    {/* Разбивка по отелю за ночь: номера / доп. места / тур. сбор */}
                    {!!st.hotelBreakdown && (
                      <div className="mt-2 min-w-0 break-words text-xs text-slate-700">
                        {st.hotelBreakdown.quoteSnapshot?.offer ? (
                          <div className="mb-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-emerald-800">
                            {t("tb.ui.quote_locked")}: <b>{st.hotelBreakdown.quoteSnapshot.offer.provider_name}</b> · {t("tb.ui.offer_number", { number: st.hotelBreakdown.quoteSnapshot.offer.id })} · {t("tb.ui.quote_version", { version: st.hotelBreakdown.quoteSnapshot.quote_version })}
                          </div>
                        ) : null}
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                          <span>
                                {t('tb.rooms')}:{' '}
                                <b>{Number(st.hotelBreakdown.rooms || 0).toFixed(2)} {st.hotelBreakdown.currency || "UZS"}</b>
                          </span>
                          <span>
                                {t('tb.extra_beds_short')}:{' '}
                                <b>{Number(st.hotelBreakdown.extraBeds || 0).toFixed(2)} {st.hotelBreakdown.currency || "UZS"}</b>
                          </span>
                          <span>
                                {t('tb.tourism_fee_short')}:{' '}
                                <b>{Number(st.hotelBreakdown.tourismFee || 0).toFixed(2)} {st.hotelBreakdown.currency || "UZS"}</b>
                          </span>
                              {st.hotelBreakdown.vatIncluded ? (
                                <span>
                                  {t('tb.vat')}:{' '}
                                  <b>{t('tb.vat_included')}</b>
                                </span>
                              ) : (
                                <span>
                                  {t('tb.vat')}:{' '}
                                  <b>{Number(st.hotelBreakdown.vat || 0).toFixed(2)} {st.hotelBreakdown.currency || "UZS"}</b>
                                </span>
                              )}
                        </div>
                      </div>
                    )}

                    {/*   <div className="text-xs text-gray-600 mt-1">
                      {t('tb.price_per_night')}: <b style={{ color: BRAND.primary }}>{toNum(st.hotelRoomsTotal, toNum(st.hotel?.price, 0)).toFixed(2)}</b> {st.hotel?.currency || st.hotelBrief?.currency || "UZS"}
                    </div>*/}
                    </div>
                  </div>
                  )}
                  
                  {/* Entry fees */}
                  {activeEventService === "tour" && !activeTourType.guideOnly && !activeTourType.hideAttractions && (
                    <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
                      <div className="grid h-8 w-8 place-items-center rounded-md bg-amber-100 text-amber-700"><Landmark size={17} /></div>
                      <div><div className="text-sm font-bold text-slate-950">3. {t("tb.ui.attractions")}</div><div className="text-xs text-slate-500">{t("tb.ui.attractions_hint")}</div></div>
                    </div>
                    <div className="p-4">
                    <input
                      className="mb-3 h-10 w-full rounded-md border border-slate-300 px-3 text-sm disabled:bg-slate-50"
                      placeholder={cityChosen ? t('tb.entry_ph') : t('tb.pick_city_first')}
                      value={entryQMap[k] || ""}
                      disabled={!cityChosen}
                      onChange={(e) => {
                       const q = e.target.value;
                       setEntryQMap((m) => ({ ...m, [k]: q }));
                        // 🔔 используем заранее созданный debouncer
                        debouncedLoadEntryOptionsRef.current(k, st.city, q);
                      }}
                    />
                    <AsyncSelect
                      isMulti
                      isDisabled={!cityChosen}
                      cacheOptions
                      defaultOptions={entryOptionsMap[k] || []}
                      loadOptions={(input, cb) => cb(entryOptionsMap[k] || [])}
                      value={st.entrySelected || []}
                      onChange={(vals) => setByDay((p) => {
                        const current = p[k] || {};
                        const selected = vals || [];
                        const schedule = normalizeScheduleItems(current.schedule).map((item) =>
                          item.id === current.selectedScheduleId
                            ? { ...item, services: { ...item.services, attractions: { items: selected.map((entry) => ({ id: entry.value, title: entry.label })) } } }
                            : item
                        );
                        return { ...p, [k]: { ...current, entrySelected: selected, schedule } };
                      })}
                      placeholder={cityChosen ? t('tb.pick_sites') : t('tb.pick_city_first')}
                      noOptionsMessage={() => (cityChosen ? t('tb.nothing_found') : t('tb.pick_city_first'))}
                      menuPortalTarget={document.body}
                      styles={RS_STYLES}
                    />
                   <div className="mt-3 flex flex-wrap items-start justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
                     <span className="min-w-0 flex-1 break-words">{(st.entrySelected || []).length ? t("tb.ui.selected_attractions", { count: (st.entrySelected || []).length }) : t("tb.ui.no_attractions")}</span>
                     <strong className="shrink-0 whitespace-nowrap text-sm text-slate-950">{calcEntryForDay(k).toFixed(2)} UZS</strong>
                   </div>
                   </div>
                  </div>
                  )}
                </div>

                                {/* Meals */}
                {activeEventService === "meal" && (
                <div className="rounded-md bg-slate-50 p-3">
                  <label
                    className="block text-sm font-medium mb-1"
                    style={{ color: BRAND.primary, borderBottom: `1px solid ${BRAND.accent}66`, paddingBottom: 2 }}
                  >
                    {t('tb.meals')}
                  </label>

                  {/* список позиций питания */}
                  <div className="space-y-2">
                    {(st.meals || [])
                      .map((ml, idx) => ({ ml, idx }))
                      .filter(({ ml }) => !ml.schedule_id || ml.schedule_id === selectedSchedule?.id)
                      .map(({ ml, idx }) => (
                      <div key={idx} className="grid md:grid-cols-12 gap-2 items-center">
                        {/* тип питания */}
                        <select
                          className="md:col-span-3 border rounded px-2 py-2 text-sm"
                          value={ml.type || "lunch"}
                          onChange={(e) =>
                            setByDay((p) => {
                              const arr = [...(p[k].meals || [])];
                              arr[idx] = { ...arr[idx], type: e.target.value };
                              return { ...p, [k]: { ...p[k], meals: arr } };
                            })
                          }
                        >
                          {MEAL_TYPES.map(mt => (
                            <option key={mt.id} value={mt.id}>{t(`tb.meal_types.${mt.id}`)}</option>
                          ))}
                        </select>

                        {/* цена */}
                        <input
                          type="number"
                          min={0}
                          className="md:col-span-2 border rounded px-2 py-2 text-sm"
                          placeholder={t('tb.meal_price_ph')}
                          value={ml.price ?? 0}
                          onChange={(e) =>
                            setByDay((p) => {
                              const arr = [...(p[k].meals || [])];
                              arr[idx] = { ...arr[idx], price: Number(e.target.value) || 0 };
                              return { ...p, [k]: { ...p[k], meals: arr } };
                            })
                          }
                        />

                        {/* валюта (переиспользуем ключи как в трансфере для единообразия) */}
                        <select
                          className="md:col-span-1 border rounded px-2 py-2 text-sm"
                          value={ml.currency || "UZS"}
                          onChange={(e) =>
                            setByDay((p) => {
                              const arr = [...(p[k].meals || [])];
                              arr[idx] = { ...arr[idx], currency: e.target.value };
                              return { ...p, [k]: { ...p[k], meals: arr } };
                            })
                          }
                        >
                          <option value="UZS">{t('tb.currencyintercities.uzs')}</option>
                          <option value="USD">{t('tb.currencyintercities.usd')}</option>
                        </select>

                        {/* / pax */}
                        <label className="md:col-span-2 inline-flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={!!ml.perPax}
                            onChange={(e) =>
                              setByDay((p) => {
                                const arr = [...(p[k].meals || [])];
                                arr[idx] = { ...arr[idx], perPax: e.target.checked };
                                return { ...p, [k]: { ...p[k], meals: arr } };
                              })
                            }
                          />
                          <span>{t('tb.per_pax')}</span>
                        </label>

                        {/* удалить */}
                        <button
                          type="button"
                          className="md:col-span-1 text-xs px-2 py-2 rounded border"
                          style={{ borderColor: `${BRAND.accent}88` }}
                          onClick={() =>
                            setByDay((p) => {
                              const arr = [...(p[k].meals || [])];
                              arr.splice(idx, 1);
                              return { ...p, [k]: { ...p[k], meals: arr } };
                            })
                          }
                        >
                          {t('tb.remove')}
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="mt-2">
                    <button
                      type="button"
                      className="text-sm px-3 py-1 rounded border"
                      style={{ color: BRAND.primary, borderColor: BRAND.accent }}
                      onClick={() =>
                        setByDay((p) => ({
                          ...p,
                          [k]: (() => {
                            const current = p[k] || {};
                            const meal = { id: `meal-${Date.now()}`, type: "lunch", price: 0, currency: "UZS", perPax: true, schedule_id: current.selectedScheduleId || null };
                            const meals = [...(current.meals || []), meal];
                            const schedule = normalizeScheduleItems(current.schedule).map((item) =>
                              item.id === current.selectedScheduleId
                                ? { ...item, services: { ...item.services, meal: { items: meals.filter((row) => row.schedule_id === item.id).map((row) => ({ id: row.id, type: row.type })) } } }
                                : item
                            );
                            return { ...current, meals, schedule };
                          })()
                        }))
                      }
                    >
                      + {t('tb.add_meal')}
                    </button>
                    <div className="text-xs text-gray-600 mt-1">
                      {t('tb.meals_day_sum')}: <b style={{ color: BRAND.primary }}>{calcMealsForDay(k).toFixed(2)} UZS</b>
                    </div>
                  </div>
                </div>
                )}

                </>
                ) : (
                  <button
                    type="button"
                    className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-slate-500 hover:border-orange-300 hover:text-orange-700"
                    onClick={() => document.querySelector(`[data-tour-event-day="${k}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                  >
                    {t("tb.ui.select_component")}
                  </button>
                )}

                </>}

                </>}

                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <span>{t('tb.guide')} <strong className="text-slate-900">{calcGuideForDay(k).toLocaleString("ru-RU")}</strong></span>
                  <span>{t('tb.transport')} <strong className="text-slate-900">{(calcTransportForDay(k) + calcTransfersForDay(k)).toLocaleString("ru-RU")}</strong></span>
                  <span>{t('tb.hotel_short')} <strong className="text-slate-900">{calcHotelForDay(k).toLocaleString("ru-RU")}</strong></span>
                  <span>{t('tb.totals.entry')} <strong className="text-slate-900">{calcEntryForDay(k).toLocaleString("ru-RU")}</strong></span>
                  <span>{t('tb.meals')} <strong className="text-slate-900">{calcMealsForDay(k).toLocaleString("ru-RU")}</strong></span>
                  <span className="ml-auto text-sm font-bold text-slate-950">{dayTotal.toLocaleString("ru-RU")} UZS</span>
                </div>

                {/* Программа дня завершает карточку дня. */}
                <details className="group rounded-lg border border-slate-200 bg-white">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-semibold text-slate-800">
                    <span>{t('tb.day_program')}</span>
                    <span className="text-xs font-medium text-slate-500 group-open:hidden">{t("tb.ui.open_description")}</span>
                    <span className="hidden text-xs font-medium text-slate-500 group-open:inline">{t("tb.ui.collapse")}</span>
                  </summary>
                  <div className="border-t border-slate-200 p-3">
                    <div className="mb-2 flex flex-wrap justify-end gap-1">
                      <button type="button" className="rounded border bg-white px-2 py-1 text-xs hover:bg-orange-50" onClick={() => generateProgramForDay(k, { overwrite: true })}>
                        {t('tb.generate_day_program')}
                      </button>
                      <button type="button" className="rounded border bg-white px-2 py-1 text-xs hover:bg-orange-50" onClick={() => generateProgramForAllDays({ overwrite: true })}>
                        {t('tb.generate_all_program')}
                      </button>
                      {TB_PROGRAM_LANGS.map((code) => {
                        const active = (st._programTab || String(i18n.language || 'ru').slice(0, 2) || 'ru') === code;
                        return (
                          <button key={code} type="button" className={`rounded border px-2 py-1 text-xs ${active ? "border-orange-300 bg-orange-50" : "bg-white"}`} onClick={() => setByDay((p) => ({ ...p, [k]: { ...p[k], _programTab: code } }))}>
                            {code.toUpperCase()}
                          </button>
                        );
                      })}
                    </div>
                    {(() => {
                      const activeLangRaw = st._programTab || String(i18n.language || 'ru').slice(0, 2) || 'ru';
                      const activeLang = TB_PROGRAM_LANGS.includes(activeLangRaw) ? activeLangRaw : 'ru';
                      return (
                        <textarea
                          className="min-h-[90px] w-full rounded border bg-white px-3 py-2 text-sm"
                          placeholder={t('tb.day_program_ph')}
                          value={st.program_i18n?.[activeLang] || ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            setByDay((p) => ({
                              ...p,
                              [k]: {
                                ...p[k],
                                program_i18n: { ...emptyProgramI18n(), ...(p[k]?.program_i18n || {}), [activeLang]: value },
                                _programTab: activeLang,
                              },
                            }));
                          }}
                        />
                      );
                    })()}
                  </div>
                </details>
              </div>
            );
          })}
        </section>
              {/* глобальные эффекты автоподбора на смену PAX и загрузку услуг */}
      <EffectAutoPick
        days={days}
        byDay={byDay}
        adt={adt}
        chd={chd}
        servicesCache={servicesCache}
        onRecalc={autoPickForDay}
      />
      <section className="mb-8 mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="grid xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="p-5 sm:p-6">
            <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-950">{t("tb.summary.title")}</h2>
                <p className="mt-1 text-sm text-slate-500">{t("tb.summary.subtitle")}</p>
              </div>
              <div className="flex rounded-md bg-slate-100 p-1" aria-label={t("tb.summary.currency")}>
                {["UZS", "USD"].map((currency) => (
                  <button
                    key={currency}
                    type="button"
                    onClick={() => setSummaryCurrency(currency)}
                    className={`h-8 min-w-14 rounded px-3 text-xs font-bold transition ${summaryCurrency === currency ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                  >
                    {currency}
                  </button>
                ))}
              </div>
            </div>

            {summaryCurrency === "USD" && (
              <div className="mt-5 flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{t("tb.summary.exchange_rate")}</div>
                  <div className="text-xs text-slate-500">{t("tb.summary.exchange_rate_hint")}</div>
                </div>
                <div className="flex items-center gap-2">
                  <input type="number" min="0" step="0.01" className="h-9 w-36 rounded border border-slate-300 bg-white px-3 text-right text-sm font-semibold" placeholder="12600" value={usdRate} onChange={(e) => setUsdRate(Number(e.target.value) || 0)} />
                  <span className="text-xs font-bold text-slate-500">UZS</span>
                </div>
              </div>
            )}

            <div className="mt-5 grid gap-x-8 sm:grid-cols-2">
              {[
                { label: t("tb.totals.guide"), value: totals.guide, Icon: UserRound },
                { label: t("tb.totals.transport"), value: totals.transport + totals.transfers, Icon: BusFront },
                { label: t("tb.totals.hotels"), value: totals.hotel, Icon: BedDouble },
                { label: t("tb.meals"), value: totals.meals, Icon: Utensils },
                { label: t("tb.totals.entry"), value: totals.entries, Icon: Landmark },
              ].map(({ label, value, Icon }) => {
                const amount = summaryCurrency === "USD" ? toUSD(value) : value;
                return (
                  <div key={label} className="flex min-h-14 items-center justify-between gap-3 border-b border-slate-100 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-orange-50 text-orange-600"><Icon size={16} /></span>
                      <span className="truncate text-sm font-medium text-slate-600">{label}</span>
                    </div>
                    <span className="whitespace-nowrap text-sm font-bold text-slate-950">{summaryCurrency === "USD" ? amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(amount).toLocaleString("ru-RU")} {summaryCurrency}</span>
                  </div>
                );
              })}
            </div>
            {summaryCurrency === "USD" && Number(usdRate) <= 0 && <p className="mt-3 text-xs font-medium text-amber-700">{t("tb.usd_enter_valid_rate")}</p>}
          </div>

          <aside id="tb-step-price" className="scroll-mt-24 flex flex-col justify-between bg-slate-950 p-5 text-white sm:p-6">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase text-orange-400"><ReceiptText size={16} />{t("tb.summary.sale_price")}</div>
              <div className="mt-3 text-3xl font-bold">
                {summaryCurrency === "USD" ? commercialTotals.gross.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(commercialTotals.gross).toLocaleString("ru-RU")} <span className="text-base text-slate-400">{summaryCurrency}</span>
              </div>
              <div className="mt-5 space-y-3 border-t border-slate-800 pt-4 text-sm">
                <div className="flex items-start justify-between gap-3"><span className="min-w-0 break-words text-slate-400">{t("tb.summary.net_cost")}</span><strong className="shrink-0 whitespace-nowrap">{commercialTotals.net.toLocaleString(summaryCurrency === "USD" ? "en-US" : "ru-RU", { maximumFractionDigits: 2 })} {summaryCurrency}</strong></div>
                <div className="flex items-start justify-between gap-3"><span className="min-w-0 break-words text-slate-400">{t("tb.summary.markup")}</span><strong className="shrink-0 whitespace-nowrap">{commercialTotals.markup.toLocaleString(summaryCurrency === "USD" ? "en-US" : "ru-RU", { maximumFractionDigits: 2 })} {summaryCurrency}</strong></div>
              </div>
              <div className="mt-4 grid grid-cols-[minmax(0,110px)_minmax(0,1fr)] gap-2">
                <select value={markupType} onChange={(event) => setMarkupType(event.target.value)} className="h-10 rounded border border-slate-700 bg-slate-900 px-2 text-sm text-white">
                  <option value="percent">%</option>
                  <option value="fixed">{summaryCurrency}</option>
                </select>
                <input type="number" min="0" step={markupType === "percent" ? "0.1" : "1"} value={markupValue} onChange={(event) => setMarkupValue(Math.max(0, Number(event.target.value) || 0))} aria-label={t("tb.summary.markup")} className="h-10 min-w-0 rounded border border-slate-700 bg-slate-900 px-3 text-right text-sm font-bold text-white" />
              </div>
              <div className="mt-5 flex items-start justify-between gap-3 border-t border-slate-800 pt-4 text-sm">
                <span className="min-w-0 break-words text-slate-400">{t("tb.summary.per_person")}</span>
                <strong className="shrink-0 whitespace-nowrap">{summaryCurrency === "USD" ? commercialTotals.perPax.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(commercialTotals.perPax).toLocaleString("ru-RU")} {summaryCurrency}</strong>
              </div>
            </div>
            <div className="mt-8">
              {!builderReadiness.ready && <div className="mb-3 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-100">{t("tb.onboarding.missing", { count: builderReadiness.requiredCount - builderReadiness.completed })}</div>}
              <button type="button" onClick={handleSendRequests} disabled={sending || !builderReadiness.ready || demoMode || (summaryCurrency === "USD" && Number(usdRate) <= 0)} className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-orange-600 px-4 font-bold text-white transition hover:bg-orange-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400" title={demoMode ? t("tb.onboarding.demo_send_blocked") : builderReadiness.ready ? t("tourBuilder.book") : t("tb.onboarding.complete_first")}>
                {demoMode ? t("tb.onboarding.demo_cta") : sending ? t("tourBuilder.booking_in_progress") : t("tourBuilder.book")}
                {!sending && <ArrowRight size={18} />}
              </button>
              <p className="mt-3 text-xs leading-5 text-slate-400">{t("tb.summary.booking_hint")}</p>
            </div>
          </aside>
        </div>
      </section>
      </div>
            {/* [TPL] Модал применения шаблона */}
      {applyOpen && (
        <div
          className="fixed inset-0 z-[12000] bg-black/30 flex items-center justify-center"
          onClick={() => setApplyOpen(false)}
        >
          <div className="bg-white rounded-xl shadow-xl border w-[92vw] max-w-md p-4" onClick={(e)=>e.stopPropagation()}>
            <div className="text-lg font-semibold mb-2">{t('tb.tpl_apply_title')}</div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm mb-1">{t('tb.tpl_select')}</label>
                <select className="w-full h-10 border rounded px-2"
                        value={applyTplId}
                        onChange={e=>setApplyTplId(e.target.value)}>
                  <option value="">{t('tb.tpl_select_placeholder')}</option>
                  {tpls.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1">{t('tb.tpl_start_date')}</label>
               <input
                 type="date"
                 className="w-full h-10 border rounded px-2"
                 value={applyFrom}
                 min={ymd(startOfDay(new Date()))}     // ❗ запрет прошлых дат
                 onChange={(e) => setApplyFrom(e.target.value)}
                 onBlur={(e) => {                      // подстрахуемся при ручном вводе
                   const min = ymd(startOfDay(new Date()));
                   if (e.target.value && e.target.value < min) setApplyFrom(min);
                 }}
               />
                <div className="mt-1 text-xs text-gray-500">
                  {t('tb.tpl_start_hint')}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="px-3 py-2 border rounded" onClick={()=>setApplyOpen(false)}>{t('tb.tpl_btn_cancel')}</button>
              <button className="px-3 py-2 rounded bg-orange-500 text-white" onClick={applyTemplateNow}>{t('tb.tpl_btn_apply')}</button>
            </div>
          </div>
        </div>
      )}
            {/* Модал результата создания бронирований */}
      <HotelQuoteConfirmModal
        open={!!bookingConfirmation}
        quotes={bookingConfirmation?.hotelQuoteSnapshots || []}
        requestCount={bookingConfirmation?.payloads?.length || 0}
        tourEndDate={range?.to ? ymd(range.to) : ""}
        sending={sending}
        onClose={() => !sending && setBookingConfirmation(null)}
        onConfirm={confirmSendRequests}
      />
      <BookingResultModal
        open={!!bookingResult}
        result={bookingResult}
        onClose={() => setBookingResult(null)}
      />
    </main>
  );
}


/* --- выносим небольшой эффект, чтобы не засорять основной компонент --- */
function EffectAutoPick({ days, byDay, adt, chd, servicesCache, onRecalc }) {
  useEffect(() => {
    const pax = Math.max(1, Number(adt) + Number(chd));
    // при изменении PAX или при появлении услуг в кешах — пробегаемся по дням
    for (const d of days) {
      const k = ymd(d);
      const st = byDay[k] || {};
      if (!st.city) continue;
      // пересчитываем только если для выбранного провайдера уже подгружены услуги
      const readyGuide = st.guide && servicesCache[st.guide.id];
      const readyTransport = st.transport && servicesCache[st.transport.id];
      if (readyGuide || readyTransport) onRecalc(k);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adt, chd, servicesCache, days.map((d) => ymd(d)).join("|")]);
  return null;
}

function HotelRoomPicker({ hotelBrief, offer, nightDates, residentFlag, paxCount = 1, usdRate = 0, onTotalChange, onBreakdown }) {
    // локализация внутри дочернего компонента
  const { t } = useTranslation();
  const MEALS = ["RO","BB","HB","FB","AI","UAI"];
  const availableMeals = useMemo(() => {
    const fromOffer = Array.isArray(offer?.meal_plans) ? offer.meal_plans.filter((mealPlan) => MEALS.includes(mealPlan)) : [];
    return fromOffer.length ? fromOffer : MEALS;
  }, [offer]);
  const [meal, setMeal] = useState("BB");
  // Количество выбирается по тарифному варианту, а физический остаток общий для типа номера.
  const [qty, setQty] = useState({});
  const [extraBeds, setExtraBeds] = useState(0); // кол-во доп. мест на эту ночь
  const [quoteLoading, setQuoteLoading] = useState(false);
  const quoteSequence = useRef(0);
  const onTotalChangeRef = useRef(onTotalChange);
  const onBreakdownRef = useRef(onBreakdown);
  const nightDatesKey = (Array.isArray(nightDates) ? nightDates : []).join(",");
  const quoteNightDates = useMemo(() => nightDatesKey.split(",").filter(Boolean), [nightDatesKey]);

  useEffect(() => { onTotalChangeRef.current = onTotalChange; }, [onTotalChange]);
  useEffect(() => { onBreakdownRef.current = onBreakdown; }, [onBreakdown]);

  useEffect(() => {
    // обнуляем при смене отеля
    setQty({});
    setMeal(availableMeals.includes("BB") ? "BB" : availableMeals[0] || "BB");
    setExtraBeds(0);
  }, [hotelBrief?.id, offer?.id, availableMeals]);

  // Room categories and meal plans come only from the selected supplier offer.
  const roomOptions = useMemo(() => {
    const options = Array.isArray(offer?.rate_options)
      ? offer.rate_options.filter((option) => !option?.meal_plan || option.meal_plan === meal)
      : [];
    if (options.length) {
      const unique = new Map();
      options.forEach((option) => {
        const type = String(option?.room_type || "").trim();
        const occupancy = String(option?.occupancy_code || "ROOM").trim().toUpperCase();
        if (!type) return;
        const key = `${type}::${occupancy}`;
        if (!unique.has(key)) unique.set(key, { key, type, occupancy, guests: Number(option?.guest_count || 1) });
      });
      return [...unique.values()];
    }
    return (Array.isArray(offer?.room_types) ? offer.room_types : [])
      .filter(Boolean)
      .map((type) => ({ key: `${type}::ROOM`, type, occupancy: "ROOM", guests: 1 }));
  }, [offer, meal]);

  
  // --- универсальные геттеры числовых полей из брифа ---
  // ищем по цепочке ключей на любом уровне вложенности (1-2 уровня хватит для брифа)
  const getByPath = (obj, path) =>
  path.split(".").reduce((o,k)=> (o && o[k] != null ? o[k] : undefined), obj);

  const pickNumeric = (obj, candidates) => {
    for (const c of candidates) {
      const v = c.includes(".") ? getByPath(obj, c) : obj?.[c];
      const n = Number(v);
      if (Number.isFinite(n) && n) return n;
    }
    // один уровень fallback
    for (const v of Object.values(obj || {})) {
      if (v && typeof v === "object") {
        for (const c of candidates) {
          const n = Number(c.includes(".") ? getByPath(v, c) : v?.[c]);
          if (Number.isFinite(n) && n) return n;
        }
      }
    }
    return 0;
  };

  // The backend is the pricing authority. Keep the returned payload as the
  // immutable quote candidate that will be attached to booking details.
  useEffect(() => {
    const selectedRooms = roomOptions.some((option) => Number(qty[option.key]) > 0);
    if (!hotelBrief?.id || !offer?.id || !selectedRooms || !quoteNightDates.length) {
      onTotalChangeRef.current?.(0);
      onBreakdownRef.current?.({
        rooms: 0, extraBeds: 0, tourismFee: 0, vat: 0,
        vatIncluded: false, nights: quoteNightDates.length, pax: paxCount,
        currency: String(hotelBrief?.currency || "UZS").toUpperCase(),
        quoteValid: false,
        warnings: [!offer?.id ? "offer_required" : !selectedRooms ? "room_required" : "dates_required"]
      });
      return undefined;
    }

    const sequence = ++quoteSequence.current;
    const timer = setTimeout(async () => {
      setQuoteLoading(true);
      try {
        const quote = await fetchHotelQuote({
          hotel_id: hotelBrief.id,
          offer_id: offer.id,
          dates: quoteNightDates,
          residency: residentFlag ? "resident" : "non_resident",
          meal_plan: meal,
          rooms: Object.entries(qty).filter(([key]) => roomOptions.some((item) => item.key === key)).map(([key, quantity]) => {
            const option = roomOptions.find((item) => item.key === key);
            return { type: option?.type || key.split("::")[0], occupancy_code: option?.occupancy || "ROOM", quantity };
          }),
          extra_beds: extraBeds,
          pax: paxCount,
          fx: { usd_uzs: Number(usdRate) || 0 },
        });
        if (sequence !== quoteSequence.current) return;
        const totals = quote?.totals || {};
        onTotalChangeRef.current?.(quote?.valid ? Number(totals.total || 0) : 0);
        onBreakdownRef.current?.({
          rooms: Number(totals.rooms || 0),
          extraBeds: Number(totals.extra_beds || 0),
          tourismFee: Number(totals.tourism_fee || 0),
          vat: Number(totals.vat || 0),
          vatIncluded: quote?.tax_details?.vat_included === true,
          nights: Number(quote?.nights || 0),
          pax: paxCount,
          currency: quote?.currency || "UZS",
          quoteValid: quote?.valid === true,
          warnings: Array.isArray(quote?.warnings) ? quote.warnings : [],
          quoteSnapshot: quote,
        });
      } catch (error) {
        if (sequence !== quoteSequence.current) return;
        onTotalChangeRef.current?.(0);
        onBreakdownRef.current?.({
          rooms: 0, extraBeds: 0, tourismFee: 0, vat: 0,
          vatIncluded: false, nights: quoteNightDates.length, pax: paxCount,
          currency: String(hotelBrief?.currency || "UZS").toUpperCase(),
          quoteValid: false,
          warnings: [error?.message || "quote_failed"]
        });
      } finally {
        if (sequence === quoteSequence.current) setQuoteLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [qty, meal, roomOptions, quoteNightDates, residentFlag, extraBeds, paxCount, hotelBrief?.id, hotelBrief?.currency, offer?.id, usdRate]);

  return (
    <div className="mt-3 min-w-0 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
        <div className="min-w-0 break-words text-sm font-semibold text-slate-900">{t('tb.rooms_and_meals')}</div>
        <select className="h-9 min-w-20 rounded-md border border-slate-300 bg-white px-2 text-sm" value={meal} onChange={(e) => setMeal(e.target.value)}>
          {availableMeals.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <div className="text-xs text-gray-500">({residentFlag ? t('tb.residents') : t('tb.nonresidents')})</div>
        {quoteLoading ? <div className="text-xs font-medium text-blue-600">{t("tb.ui.calculating")}</div> : null}
      </div>

        {/* Доп. место и подсказка по тур. сбору */}
      <div className="mb-2 grid gap-2 lg:grid-cols-2">
        <label className="grid min-w-0 grid-cols-[minmax(0,1fr)_72px] items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
          <span className="min-w-0 break-words text-sm leading-tight">{t('tb.extra_beds_qty')}</span>
          <input
            type="number"
            min={0}
            className="h-9 w-full min-w-0 rounded border border-slate-300 px-2 text-sm"
            value={extraBeds}
            onChange={(e) => setExtraBeds(Math.max(0, Number(e.target.value) || 0))}
          />
        </label>
        
          <div className="flex min-w-0 items-center break-words rounded-md border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-600">
          {(() => {
            const feeRes = pickNumeric(hotelBrief, [
              "taxes.touristTax.residentPerNight",
              "tourism_fee_resident",
              "tourism_fee_res",
              "tourist_fee_resident",
              "resident_tourist_fee",
              "tourism_tax_resident",
              "resident_city_tax"
            ]);
            const feeNrs = pickNumeric(hotelBrief, [
              "taxes.touristTax.nonResidentPerNight",
              "tourism_fee_nonresident",
              "tourism_fee_nrs",
              "tourist_fee_nonresident",
              "nonresident_tourist_fee",
              "tourism_tax_nonresident",
              "nonresident_city_tax"
            ]);
            const haveFee = feeRes > 0 || feeNrs > 0;
            return haveFee
              ? t("tb.tourism_fee_hint", { res: feeRes.toFixed(0), nrs: feeNrs.toFixed(0) })
              : t("tb.tourism_fee_absent");
          })()}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {roomOptions.map((option) => {
          const upperLimit = 99;
          return (
            <label key={option.key} className="grid min-w-0 grid-cols-[minmax(0,1fr)_72px] items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
              <span className="min-w-0 break-words text-sm leading-tight"><b>{option.type}</b>{option.occupancy !== "ROOM" ? ` · ${option.occupancy}` : ""}<span className="ml-1 text-xs text-gray-500">{t("tb.ui.up_to_guests", { count: option.guests })}</span></span>
              <input
                type="number"
                min={0}
                max={upperLimit}
                className="h-9 w-full min-w-0 rounded border border-slate-300 px-2 text-sm"
                value={qty[option.key] ?? 0}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(Number(e.target.value || 0), upperLimit));
                  setQty((p) => ({ ...p, [option.key]: v }));
                }}
              />
            </label>
          );
        })}
        {!roomOptions.length && (
          <div className="text-xs text-amber-600">
            {t("tb.ui.no_room_categories")}
          </div>
        )}
      </div>
    </div>
  );
}
