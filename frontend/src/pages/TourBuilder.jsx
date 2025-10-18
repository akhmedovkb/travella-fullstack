// frontend/src/pages/TourBuilder.jsx

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { listTemplates, getTemplate, syncTemplates } from "../store/templates"; // [TPL]
import AsyncSelect from "react-select/async";
import { components as SelectComponents } from "react-select";
import { useTranslation } from "react-i18next";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { pickProviderService } from "../utils/pickProviderService";
import { enUS, ru as ruLocale, uz as uzLocale } from "date-fns/locale";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

/* ---------------- brand colors ---------------- */
const BRAND = {
  primary: "#FF5722",  // ключевой акцент
  accent:  "#FFAD7A",  // бордеры/hover
  sand:    "#FFEAD2",  // фон карточек дня
  gray:    "#F1F1F1",  // фон блоков итогов
};

/* ---------------- intercity transfer types ---------------- */
 const TRANSFER_TYPES = [
  { id: "car" },   // подписи берём из i18n: tb.transfer_types.*
  { id: "train" },
  { id: "air" },
 ];

/* ---------------- per-day meals ---------------- */
const MEAL_TYPES = [
  { id: "lunch" },  // tb.meal_types.lunch
  { id: "dinner" }, // tb.meal_types.dinner
  { id: "gala" },   // tb.meal_types.gala
];

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

/* ---------------- categories / labels (для выпадашек услуг) ---------------- */
const CATEGORY_LABELS = {
  // guide
  city_tour_guide: "Тур по городу",
  mountain_tour_guide: "Тур в горы",
  desert_tour_guide: "Пустынный тур",
  safari_tour_guide: "Сафари-тур",
  meet: "Встреча",
  seeoff: "Провод",
  translation: "Перевод",
  // transport
  city_tour_transport: "Тур по городу",
  mountain_tour_transport: "Тур в горы",
  desert_tour_transport: "Пустынный тур",
  safari_tour_transport: "Сафари-тур",
  one_way_transfer: "Трансфер в одну сторону",
  dinner_transfer: "Трансфер на ужин",
  border_transfer: "Междугородний/погран. трансфер",
};

const GUIDE_ALLOWED = new Set(["city_tour_guide","mountain_tour_guide","desert_tour_guide","safari_tour_guide","meet","seeoff","translation"]);
const TRANSPORT_ALLOWED = new Set(["city_tour_transport","mountain_tour_transport","desert_tour_transport","safari_tour_transport","one_way_transfer","dinner_transfer","border_transfer"]);

// массивы для утилиты подбора
const GUIDE_ALLOWED_ARR = ["city_tour_guide","mountain_tour_guide","desert_tour_guide","safari_tour_guide","meet","seeoff","translation"];
const TRANSPORT_ALLOWED_ARR = ["city_tour_transport","mountain_tour_transport","desert_tour_transport","safari_tour_transport","one_way_transfer","dinner_transfer","border_transfer"];
/* helpers для фильтрации услуг под PAX и город */
const svcSeats = (s) =>
  toNum(s?.raw?.details?.seats ?? s?.details?.seats ?? NaN, NaN);
const svcCity = (s) =>
  (s?.raw?.details?.city_slug ?? s?.details?.city_slug ?? "").toString().trim().toLowerCase();
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

/**
 * Проверяет, подходит ли провайдер под условия (есть хоть одна услуга с достаточной вместимостью).
 * kind: 'guide' | 'transport'
 */
const providerMatchesByPaxCity = async ({
  provider,
  kind,
  citySlug,
  pax,
  ensureServicesLoaded,
}) => {
  if (!provider?.id) return false;
  const list = await ensureServicesLoaded(provider);
  if (!Array.isArray(list) || !list.length) return false;
  const allowedSet = kind === "transport" ? TRANSPORT_ALLOWED : GUIDE_ALLOWED;
  return list.some((s) => {
    // s может быть нормализованной услугой (из normalizeService), а сырые поля лежат в s.raw
    const raw = s?.raw || s;
    const category = raw?.category || s?.category;
    if (!allowedSet.has(category)) return false;
    if (!fitsCity(raw, citySlug)) return false;
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

// ------ Bookings API ------
// POST /api/bookings
// body: { provider_id, service_id?, dates:[YYYY-MM-DD], message?, attachments?, currency?, source?, group_id? }
async function createBooking(payload) {
  return await postJSON("/api/bookings", payload);
}

// ------ Совместимость: бронирования с фоллбеком на /api/requests ------
// Если новый эндпоинт не принимает (400/404/405), пробуем старый формат запросов.
async function createBookingCompat(payload) {
  try {
    return await createBooking(payload);
  } catch (e) {
    if (e?.status === 400 || e?.status === 404 || e?.status === 405) {
     // /api/requests — только совместимые поля
     const legacy = {
       provider_id: payload.provider_id,
       ...(payload.service_id ? { service_id: payload.service_id } : {}),
       dates: payload.dates,
       pax_adult: Number(payload.pax_adult) || 0,
       pax_child: Number(payload.pax_child) || 0,
       language: payload.language || "en",
       message: payload.message || "",
       source: payload.source || "tour_builder",
     };
      return await postJSON("/api/requests", legacy);
    }
    throw e;
  }
}

// --- Hotels (каскад по городу + бриф + сезоны) ---
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

// Берём первое положительное число из списка значений
const pickPos = (...vals) => {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
};

// матчинг звёзд ('' = любая)
const matchStars = (hotelStars, filter) => {
  if (filter === "" || filter === null || filter === undefined) return true;
  const n = Number(hotelStars), f = Number(filter);
  return Number.isFinite(n) && Number.isFinite(f) ? n === f : false;
};

// helpers
const toBool = (v) =>
  v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true";

// вместо: async function fetchHotelBrief(hotelId) { return await fetchJSON(`/api/hotels/${hotelId}/brief`); }
async function fetchHotelBrief(hotelId) {
  // параллельно тянем короткий бриф и полный профиль
  const [briefRaw, fullRaw] = await Promise.all([
    fetchJSONLoose(`/api/hotels/${hotelId}/brief`),
    fetchJSONLoose(`/api/hotels/${hotelId}`),
  ]);

  const brief = briefRaw || {};
  const full  = fullRaw  || {};

  // валюта — из brief, иначе из полного профиля, иначе UZS
  const currency = brief.currency ?? full.currency ?? "UZS";

  // Доп. место (шт/ночь): из brief → full → (если вдруг положили в taxes)
  const extra_bed_cost = pickPos(
    brief.extra_bed_cost,
    brief.extra_bed_price,
    full.extra_bed_cost,
    full.extra_bed_price,
    full?.taxes?.extra_bed_price
  );

  // Туристический сбор (чел/ночь): резидент/нерезидент — из brief → full → taxes.touristTax
  const tourism_fee_resident = pickPos(
    brief.tourism_fee_resident,
    brief.tourism_fee_res,
    full.tourism_fee_resident,
    full.tourism_fee_res,
    full?.taxes?.touristTax?.residentPerNight
  );

  const tourism_fee_nonresident = pickPos(
    brief.tourism_fee_nonresident,
    brief.tourism_fee_nrs,
    full.tourism_fee_nonresident,
    full.tourism_fee_nrs,
    full?.taxes?.touristTax?.nonResidentPerNight
  );
  
  // НДС: флаг включённости и ставка (в %)
  const vatIncluded = toBool(
    (brief?.vat_included ?? brief?.vatIncluded ?? brief?.taxes?.vatIncluded ??
     full?.vat_included  ?? full?.vatIncluded  ?? full?.taxes?.vatIncluded)
  );
  const vatRate = Number(
    brief?.vat_rate ?? brief?.vatRate ?? brief?.taxes?.vatRate ??
    full?.vat_rate  ?? full?.vatRate  ?? full?.taxes?.vatRate ?? 0
  ) || 0;

  // возвращаем бриф, дополненный нужными полями
  return {
    ...full,           // на случай, если в brief чего-то нет (например, rooms)
    ...brief,          // а brief приоритетнее по отображаемым данным
    currency,
    extra_bed_cost,
    tourism_fee_resident,
    tourism_fee_nonresident,
    vatIncluded,
    vatRate,
  };
}



async function fetchHotelSeasons(hotelId) {
  // [{ id, label:'low'|'high', start_date:'YYYY-MM-DD', end_date:'YYYY-MM-DD' }, ...]
  return await fetchJSON(`/api/hotels/${hotelId}/seasons`);
}

// Определить сезон на конкретную дату (если попали в high-интервал — high, иначе low)
function resolveSeasonLabel(ymd, seasons) {
  if (!Array.isArray(seasons) || seasons.length === 0) return "low";
  for (const s of seasons) {
    if (!s?.start_date || !s?.end_date) continue;
    if (ymd >= s.start_date && ymd <= s.end_date) {
      return (s.label === "high" ? "high" : "low");
    }
  }
  return "low";
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
});

const normalizeService = (row) => {
  const details = row?.details || {};
  const price = Number(details.grossPrice) || Number(row?.price) || 0;
  const currency = details.currency || row?.currency || "UZS";

  const realId = row?.id ?? row?._id ?? null; // ← только реальный id

  return {
    id: realId,
    title: row?.title || CATEGORY_LABELS[row?.category] || "Услуга",
    category: row?.category || "",
    price: toNum(price, 0),
    currency,
    raw: row,
  };
};


async function fetchProvidersSmart({ kind, city, date, language, q = "", limit = 30 }) {
  // Пробуем строго /available
  try {
    const j = await fetchJSON("/api/providers/available", {
      type: kind, location: city, date, language, q, limit,
    });
    const arr = Array.isArray(j?.items) ? j.items : Array.isArray(j) ? j : [];
    // Возвращаем как есть (даже если пусто) — это и есть «нет свободных»
    return arr.map((x) => normalizeProvider(x, kind));
  } catch (_) {
    // Фоллбек только при сетевой/HTTP ошибке
    try {
      const j = await fetchJSON("/api/providers/search", {
        type: kind, location: city, language, q, limit,
      });
      const arr = Array.isArray(j?.items) ? j.items : Array.isArray(j) ? j : [];
      return arr.map((x) => normalizeProvider(x, kind));
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
  const h = props.data?.raw;
  const tip = [
    h?.name,
    h?.city ? `Город: ${h.city}` : "",
    typeof h?.price === "number" && h?.price > 0 ? `Цена/ночь: ${h.price} ${h.currency || "UZS"}` : "",
  ].filter(Boolean).join("\n");
  return (
    <div title={tip}>
      <SelectComponents.Option {...props} />
    </div>
  );
};

/* =========================== PAGE =========================== */

export default function TourBuilder() {
  const [isAdmin, setIsAdmin] = useState(false);
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

  const [byDay, setByDay] = useState({});
  useEffect(() => {
    setByDay((prev) => {
      const copy = { ...prev };
      days.forEach((d) => {
        const k = ymd(d);
                if (!copy[k]) copy[k] = {
          city: "",
          guide: null, transport: null, hotel: null,
          guideService: null, transportService: null,   // ⬅️ выбранные услуги
          entrySelected: [],
          transfers: [],
          meals: [],                  
        };
      });
      Object.keys(copy).forEach((k) => {
        if (!days.find((d) => ymd(d) === k)) delete copy[k];
      });
      return copy;
    });
  }, [days]);

    /* ----- cache услуг провайдеров, чтобы не бить API каждый раз ----- */
  const [servicesCache, setServicesCache] = useState({});     // {providerId: Service[]}
  const [servicesLoading, setServicesLoading] = useState({}); // {providerId: bool}
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
  const pickFromCache = (providerId, categoriesArr, citySlug, pax) => {
    const list = servicesCache[providerId] || [];
    if (!list.length) return null;
    // pickProviderService ожидает "сырые" услуги с details; мы сохранили их в .raw
    const rawPool = list.map((x) => x.raw || x);
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
  // автоподбор по конкретному дню
  const autoPickForDay = (dateKey) => {
    setByDay((prev) => {
      const st = prev[dateKey] || {};
      const citySlug = st.city || "";
      const pax = Math.max(1, toNum(adt, 0) + toNum(chd, 0));
      let next = { ...st };

            if (st.guide && servicesCache[st.guide.id]) {
        // если транспорт не выбран — допускаем услуги “гид+транспорт”
        const cats = st.transport ? GUIDE_ALLOWED_ARR : [...GUIDE_ALLOWED_ARR, ...TRANSPORT_ALLOWED_ARR];
        const chosen = pickFromCache(st.guide.id, cats, citySlug, pax);
        if (chosen && (!st.guideService || String(st.guideService.id) !== String(chosen.id))) {
          next.guideService = chosen;
        }
            // если выбранная ранее услуга не подходит под pax/город — очищаем
        if (next.guideService && (!fitsPax(next.guideService, pax) || !fitsCity(next.guideService, citySlug))) {
          next.guideService = null;
        }
      }
      if (st.transport && servicesCache[st.transport.id]) {
        const chosenT = pickFromCache(st.transport.id, TRANSPORT_ALLOWED_ARR, citySlug, pax);
        if (chosenT && (!st.transportService || String(st.transportService.id) !== String(chosenT.id))) {
          next.transportService = chosenT;
        }
                if (next.transportService && (!fitsPax(next.transportService, pax) || !fitsCity(next.transportService, citySlug))) {
          next.transportService = null;
        }
      }
      if (next === st) return prev; // без изменений
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
    // пробуем серверный фильтр, плюс страхуемся клиентским
    const items = await fetchHotelsByCity(cityNorm, hotelStars); // → [{value,label,raw}]
    const filtered = items.filter(o => matchStars(o?.raw?.stars, hotelStars));
    setHotelOptionsMap((m) => ({ ...m, [dateKey]: filtered }));
  };

    // при смене фильтра звёзд — обновляем списки по всем дням и сбрасываем неподходящие выборы
  useEffect(() => {
    setByDay((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        const st = next[k] || {};
        if (!st.city) continue;
        loadHotelOptionsForDay(k, st.city);
        if (st.hotel && !matchStars(st.hotel.stars, hotelStars)) {
          next[k] = { ...st, hotel: null, hotelBrief: null, hotelSeasons: [], hotelRoomsTotal: 0, hotelBreakdown: null };
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

  /* ----- loaders per day (guide / transport / hotel) ----- */
  const makeGuideLoader = (dateKey) => async (input) => {
  const day = byDay[dateKey] || {};
  if (!dateKey || !day.city) return [];
  const rows = await fetchProvidersSmart({
    kind: "guide",
    city: day.city,
    date: dateKey,
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
      })
    )
  );
  const filtered = rows.filter((_, i) => okMask[i]);
  return filtered.map((p) => ({ value: p.id, label: p.name, raw: p }));
};
 

const makeTransportLoader = (dateKey) => async (input) => {
  const day = byDay[dateKey] || {};
  if (!dateKey || !day.city) return [];
  const rows = await fetchProvidersSmart({
    kind: "transport",
    city: day.city,
    date: dateKey,
    language: lang,
    q: (input || "").trim(),
    limit: 50,
  });
  const pax = Math.max(1, toNum(adt) + toNum(chd));
  const okMask = await Promise.all(
    rows.map((p) =>
      providerMatchesByPaxCity({
        provider: p,
        kind: "transport",
        citySlug: day.city,
        pax,
        ensureServicesLoaded,
      })
    )
  );
  const filtered = rows.filter((_, i) => okMask[i]);
  return filtered.map((p) => ({ value: p.id, label: p.name, raw: p }));
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


    const calcGuideForDay = (dateKey) => {
    const st = byDay[dateKey] || {};
    // приоритет: выбранная услуга гида -> ставка провайдера
    return toNum(st?.guideService?.price, toNum(st?.guide?.price_per_day, 0));
  };
  const calcTransportForDay = (dateKey) => {
    const st = byDay[dateKey] || {};
    return toNum(st?.transportService?.price, toNum(st?.transport?.price_per_day, 0));
  };
  
  const calcHotelForDay = (dateKey) => {
  const st = byDay[dateKey] || {};
  // если выбрали номера — берём сумму из пикера; иначе fallback на простое поле price
  return toNum(st.hotelRoomsTotal, toNum(st.hotel?.price, 0));
};

  
  // стоимость межгородних трансферов за день в UZS
  const calcTransfersForDay = (dateKey) => {
    const st = byDay[dateKey] || {};
    const pax = Math.max(1, toNum(adt) + toNum(chd));
    const list = Array.isArray(st.transfers) ? st.transfers : [];
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
  // ===== СБОРКА И ОТПРАВКА ЗАПРОСОВ ПРОВАЙДЕРАМ =====
  // схема: на каждого уникального провайдера (guide/transport) — один запрос с массивом дат.
  const buildBookings = () => {
    const buckets = new Map(); // key = `${kind}:${provider_id}` → { kind, provider_id, service_id?, dates[] }
    for (const [dateKey, st] of Object.entries(byDay)) {
      if (!st?.city) continue;
      // гид
      if (st?.guide?.id) {
        const pid = String(st.guide.id);
        const key = `guide:${pid}`;
        const svcId = (st?.guideService?.raw?.id ?? st?.guideService?.id) || null; // ← real
        if (!buckets.has(key)) buckets.set(key, { kind: "guide", provider_id: pid, service_id: null, dates: [] });
        const b = buckets.get(key);
        if (svcId && !b.service_id) b.service_id = String(svcId);
        b.dates.push(dateKey);
      }
      // транспорт
      if (st?.transport?.id) {
        const pid = String(st.transport.id);
        const key = `transport:${pid}`;
        const svcId = (st?.transportService?.raw?.id ?? st?.transportService?.id) || null; // ← real
        if (!buckets.has(key)) buckets.set(key, { kind: "transport", provider_id: pid, service_id: null, dates: [] });
        const b = buckets.get(key);
        if (svcId && !b.service_id) b.service_id = String(svcId);
        b.dates.push(dateKey);
      }
    }
   // формируем payload'ы
    const payloads = [];
    for (const b of buckets.values()) {
      payloads.push({
        provider_id: b.provider_id,
        ...(b.service_id ? { service_id: b.service_id } : {}), // ← только если есть реальный id
        dates: [...new Set(b.dates)].sort(),
        pax_adult: Number(adt) || 0,
        pax_child: Number(chd) || 0,
        language: String(lang || "en"),
     // message – просто информационное поле для менеджеров/провайдеров
        message: `[TourBuilder] ${b.kind} • PAX ${Number(adt)+Number(chd)} • ${residentType.toUpperCase()}`,
        source: "tour_builder",
        __needs_group_id: true,
      });
    }
    return payloads;
  };

  const [sending, setSending] = useState(false);
  const handleSendRequests = async () => {
    if (!range?.from || !range?.to) return alert("Выберите даты маршрута.");
    const payloads = buildBookings();
    if (!payloads.length) return alert("Не выбраны провайдеры (гид/транспорт).");
    setSending(true);
    try {
      let ok = 0, fail = 0;
      // общий group_id для всей пачки
      const groupId = (crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
      const errs = [];
      for (const p of payloads) {
        try {
        // формируем финальное тело для /api/bookings
      const body = {
       provider_id: String(p.provider_id),
       // service_id только если валиден и принадлежит провайдеру
       ...(p.service_id && Number.isFinite(Number(p.service_id))
         ? { service_id: Number(p.service_id) }
         : {}),
       dates: p.dates,
       pax_adult: Number(p.pax_adult) || 0,
       pax_child: Number(p.pax_child) || 0,
       language: p.language || "en",
       message: p.message || "",
       source: "tour_builder",
       ...(p.__needs_group_id ? { group_id: groupId } : {}),
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
       if (ok && !fail) {
         alert(`Бронирований создано: ${ok}.\nОткройте пакет: /dashboard/bookings?group_id=${groupId}`);
       } else if (ok && fail) {
        alert(`Часть броней создана: ${ok}, ошибок: ${fail}.\n${errs.slice(0,3).join("\n")}`);
      } else {
        alert(`Не удалось создать бронирования.\n${(errs[0]||"Проверьте API /api/bookings и /api/requests.")}`);
      }
    } finally {
      setSending(false);
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
    <div className="p-4 md:p-6 overflow-x-hidden">
      <div className="max-w-6xl mx-auto bg-white rounded-xl shadow border p-4 md:p-6 space-y-6">
        <h1 className="text-2xl font-bold">{t('tb.title')}</h1>
        {/* [TPL] панель шаблонов — аккордеон по странам */}
        <div className="flex items-start gap-3">
          <div className="text-sm text-gray-700 mt-2 shrink-0">{t('tb.templates')}:</div>

          <div className="flex-1 space-y-2">
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
                  <div key={country} className="border rounded-lg bg-white">
                    {/* шапка группы (кнопка UZB/...) */}
                    <button
                      type="button"
                      onClick={() => toggleGroup(country)}
                      className="w-full flex items-center justify-between px-3 py-2"
                    >
                      <span className="inline-flex items-center gap-2 text-sm font-semibold">
                        <span className="inline-flex h-6 px-2 items-center rounded-full border">
                          {country}
                        </span>
                        <span className="text-gray-500 font-normal">
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
              <span className="text-sm text-gray-500">
                Нет шаблонов. Создайте в /templates
              </span>
            )}
          </div>

          {/* Ссылка на страницу управления шаблонами */}
          <Link className="ml-auto text-sm underline mt-2 shrink-0" to="/templates">
            {t('tb.templates_open')}
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-3 min-w-0">
          <div className="md:col-span-2 min-w-0">
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

          <div className="space-y-3">
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
                {t('tb.hotel_category', { defaultValue: 'Категория отелей' })}
              </div>
              <select
                className="w-full h-9 border rounded px-2 text-sm"
                value={hotelStars}
                onChange={(e) => setHotelStars(e.target.value)}
              >
                <option value="">{t('tb.any', { defaultValue: 'Любая' })}</option>
                {[1,2,3,4,5,6,7].map(n => <option key={n} value={n}>{n}★</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* days */}
        <div className="space-y-6">
          {days.map((d, i) => {
            const k = ymd(d);
            const st = byDay[k] || {};
            const cityChosen = Boolean(st.city);
            return (
              <div
                key={k}
                className="border rounded-lg p-3 space-y-3"
                style={{
                  background: BRAND.sand,
                  borderColor: `${BRAND.accent}55`,
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="font-semibold" style={{ color: BRAND.primary }}>
                    D{i + 1}
                  </div>
                  <input
                    className="border rounded px-3 py-2 min-w-[220px] flex-1"
                    placeholder={t('tb.city_ph')}
                    value={st.city || ""}
                    onChange={(e) => {
                      const city = (e.target.value || "").trim();
                      setByDay((p) => ({ ...p, [k]: { ...p[k], city, guide: null, transport: null, hotel: null, entrySelected: [] } }));
                      // обновим опции билетов под новый city
                      setEntryQMap((m) => ({ ...m, [k]: "" }));
                      loadEntryOptionsForDay(k, city, "");
                      // сразу предзагрузим список отелей для селекта
                      loadHotelOptionsForDay(k, city);
                      // при смене города сбросили поставщиков; автоподбор произойдёт после выбора
                    }}
                  />
                  <div className="text-sm" style={{ color: BRAND.primary }}>
                    {k}
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-3">
                  {/* Guide */}
                  <div className="border rounded p-2">
                    <label
                      className="block text-sm font-medium mb-1"
                      style={{ color: BRAND.primary, borderBottom: `1px solid ${BRAND.accent}66`, paddingBottom: 2 }}
                    >
                      {t('tb.guide')}
                    </label>
                    <AsyncSelect
                        key={`guide-${k}-${st.city}-${lang}`}        // ⬅️ форс-ремаунт при смене условий
                        isDisabled={!cityChosen}
                        cacheOptions={false}                         // ⬅️ убираем кеш для надежности
                        defaultOptions
                        loadOptions={makeGuideLoader(k)}
                        filterOption={() => true}
                        components={{ Option: ProviderOption }}
                        placeholder={cityChosen ? t('tb.pick_guide') : t('tb.pick_city_first')}
                        noOptionsMessage={() => (cityChosen ? t('tb.no_providers') : t('tb.pick_city_first'))}
                        value={st.guide ? { value: st.guide.id, label: st.guide.name, raw: st.guide } : null}
                        onChange={async (opt) => {
                          const guide = opt?.raw || null;
                          setByDay((p) => ({ ...p, [k]: { ...p[k], guide, guideService: null } }));
                          const list = await ensureServicesLoaded(guide);
                          const pax = Math.max(1, toNum(adt) + toNum(chd));
                          const citySlug = (byDay[k]?.city || "").trim();
                          const cats = (byDay[k]?.transport)
                            ? GUIDE_ALLOWED_ARR
                            : [...GUIDE_ALLOWED_ARR, ...TRANSPORT_ALLOWED_ARR];
                          const picked = pickFromCache(guide.id, cats, citySlug, pax);
                          if (picked) {
                            setByDay((p) => ({ ...p, [k]: { ...p[k], guideService: picked } }));
                          }
                        }}
                        classNamePrefix="rs"
                        menuPortalTarget={document.body}
                        styles={RS_STYLES}
                        />
                                        {/* выпадашка услуг гида */}
                    <select
                      className="mt-2 w-full h-9 border rounded px-2 text-sm disabled:bg-gray-50"
                      disabled={!st.guide}
                      value={st.guideService?.id || ""}
                      onChange={(e) => {
                        const selId = e.target.value;
                        const list = servicesCache[st.guide?.id] || [];
                        const pax = Math.max(1, toNum(adt) + toNum(chd));
                        // показываем обычные услуги гида + гид+транспорт, но только если вместимость >= PAX
                        const allowed = list
                          .filter(s =>
                            s.price > 0 &&
                            (GUIDE_ALLOWED.has(s.category) ||
                             (!st.transport && TRANSPORT_ALLOWED.has(s.category) && fitsPax(s, pax)))
                          );
                        const chosen = allowed.find(s => String(s.id) === selId) || null;
                        setByDay((p) => ({ ...p, [k]: { ...p[k], guideService: chosen } }));
                      }}
                    >
                      <option value="">{t('tb.pick_guide_service_ph')}</option>
                      {(servicesCache[st.guide?.id] || [])
                        .filter(s => {
                          const pax = Math.max(1, toNum(adt) + toNum(chd));
                          if (GUIDE_ALLOWED.has(s.category)) return s.price > 0;
                          if (TRANSPORT_ALLOWED.has(s.category)) {
                            // «гид+транспорт» показываем только если НЕ выбран отдельный транспорт
                            return !st.transport && s.price > 0 && fitsPax(s, pax);
                          }
                          return false;
                        })
                        .sort((a,b) => a.price - b.price)
                        .map(s => (
                          <option key={s.id} value={s.id}>
                            {(s.title || CATEGORY_LABELS[s.category] || "Услуга")} — {s.price.toFixed(2)} {s.currency}
                          </option>
                        ))}
                    </select>
                    <div className="text-xs text-gray-600 mt-1">
                      {t('tb.price_per_day')}: <b style={{ color: BRAND.primary }}>{calcGuideForDay(k).toFixed(2)}</b> {(st.guideService?.currency || st.guide?.currency || "UZS")}
                    </div>
                  </div>
                  
                  {/* если услуг нет: */}
                  {st.guide && (servicesCache[st.guide.id]?.length === 0) && (
                    <div className="text-xs text-amber-600 mt-1">
                      {t('tb.no_services_for_guide')}
                    </div>
                  )}

                  {/* Transport */}
                  <div className="border rounded p-2">
                    <label
                      className="block text-sm font-medium mb-1"
                      style={{ color: BRAND.primary, borderBottom: `1px solid ${BRAND.accent}66`, paddingBottom: 2 }}
                    >
                      {t('tb.transport')}
                    </label>
                    <AsyncSelect
                        key={`transport-${k}-${st.city}-${lang}`}   // ⬅️ важный ключ
                        isDisabled={!cityChosen}
                        cacheOptions={false}                         // ⬅️ отключаем кеш
                        defaultOptions
                        loadOptions={makeTransportLoader(k)}
                        filterOption={() => true}
                        components={{ Option: ProviderOption }}
                        placeholder={cityChosen ? t('tb.pick_transport') : t('tb.pick_city_first')}
                        noOptionsMessage={() => (cityChosen ? t('tb.no_providers') : t('tb.pick_city_first'))}
                        value={st.transport ? { value: st.transport.id, label: st.transport.name, raw: st.transport } : null}
                        onChange={async (opt) => {
                          const transport = opt?.raw || null;            // <-- объявляем переменную
                          setByDay((p) => ({ ...p, [k]: { ...p[k], transport, transportService: null } }));
                          if (transport) {
                            await ensureServicesLoaded(transport); // прогреем кеш
                            const pax = Math.max(1, toNum(adt) + toNum(chd));
                            const citySlug = (byDay[k]?.city || "").trim();
                            const picked = pickFromCache(transport.id, TRANSPORT_ALLOWED_ARR, citySlug, pax);
                            if (picked) {
                              setByDay((p) => ({ ...p, [k]: { ...p[k], transportService: picked } }));
                            }
                          } 
                        }}
                        classNamePrefix="rs"
                         menuPortalTarget={document.body}
                         styles={RS_STYLES}
                        />
                                        {/* выпадашка услуг транспорта */}
                    <select
                      className="mt-2 w-full h-9 border rounded px-2 text-sm disabled:bg-gray-50"
                      disabled={!st.transport}
                      value={st.transportService?.id || ""}
                      onChange={(e) => {
                        const selId = e.target.value;
                        const list = servicesCache[st.transport?.id] || [];
                        const pax = Math.max(1, toNum(adt) + toNum(chd));
                        const allowed = list.filter(
                          s => TRANSPORT_ALLOWED.has(s.category) && s.price > 0 && fitsPax(s, pax)
                        );
                        const chosen = allowed.find(s => String(s.id) === selId) || null;
                        setByDay((p) => ({ ...p, [k]: { ...p[k], transportService: chosen } }));
                      }}
                    >
                      <option value="">{t('tb.pick_transport_service_ph')}</option>
                      {(servicesCache[st.transport?.id] || [])
                        .filter(s => TRANSPORT_ALLOWED.has(s.category) && s.price > 0 && fitsPax(s, Math.max(1, toNum(adt) + toNum(chd))))
                        .sort((a,b) => a.price - b.price)
                        .map(s => (
                          <option key={s.id} value={s.id}>
                            {(s.title || CATEGORY_LABELS[s.category] || "Услуга")} — {s.price.toFixed(2)} {s.currency}
                          </option>
                        ))}
                    </select>
                    <div className="text-xs text-gray-600 mt-1">
                     {t('tb.price_per_day')}: <b style={{ color: BRAND.primary }}>{calcTransportForDay(k).toFixed(2)}</b> {(st.transportService?.currency || st.transport?.currency || "UZS")}
                    </div>
                  </div>
                  {/* если услуг нет: */}
                  {st.transport && (servicesCache[st.transport.id]?.length === 0) && (
                    <div className="text-xs text-amber-600 mt-1">
                      {t('tb.no_services_for_transport')}
                    </div>
                  )}
                  {/* Hotel */}
                  <div className="border rounded p-2">
                     <label
                      className="block text-sm font-medium mb-1"
                      style={{ color: BRAND.primary, borderBottom: `1px solid ${BRAND.accent}66`, paddingBottom: 2 }}
                     >
                      {t('tb.hotel')}
                     </label>
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
                           [k]: { 
                             ...p[k],
                             hotel,
                             hotelBrief: null,
                             hotelSeasons: [],
                             hotelRoomsTotal: 0,
                             hotelLoading: !!hotel
                           }
                         }));
                         if (!hotel) return;
                         try {
                           const [brief, seasons] = await Promise.all([
                             fetchHotelBrief(hotel.id).catch(() => null),
                             fetchHotelSeasons(hotel.id).catch(() => []),
                           ]);
                           setByDay((p) => ({
                             ...p,
                             [k]: { 
                               ...p[k],
                               hotelBrief: brief,
                               hotelSeasons: Array.isArray(seasons) ? seasons : [],
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
                      {st.hotel && st.hotelBrief && (
                        <HotelRoomPicker
                          hotelBrief={st.hotelBrief}
                          seasons={st.hotelSeasons || []}
                          // для конструктора «по дню» ночёвка ровно одна: передаем текущую дату
                          nightDates={[k]}                              // ['YYYY-MM-DD']
                          residentFlag={residentType === "res"}        // true/false
                          adt={toNum(adt, 0)}
                          chd={toNum(chd, 0)}
                          paxCount={Math.max(1, toNum(adt) + toNum(chd))}
                          onBreakdown={(b) =>
                             setByDay((p) => ({ ...p, [k]: { ...p[k], hotelBreakdown: b } }))
                           }
                          onTotalChange={(sum) =>
                            setByDay((p) => ({ ...p, [k]: { ...p[k], hotelRoomsTotal: sum } }))
                          }
                        />
                      )}

                    {/* Разбивка по отелю за ночь: номера / доп. места / тур. сбор */}
                    {!!st.hotelBreakdown && (
                      <div className="text-xs text-gray-700 mt-2">
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                          <span>
                                {t('tb.rooms')}:{' '}
                                <b>{Number(st.hotelBreakdown.rooms || 0).toFixed(2)} UZS</b>
                          </span>
                          <span>
                                {t('tb.extra_beds_short')}:{' '}
                                <b>{Number(st.hotelBreakdown.extraBeds || 0).toFixed(2)} UZS</b>
                          </span>
                          <span>
                                {t('tb.tourism_fee_short')}:{' '}
                                <b>{Number(st.hotelBreakdown.tourismFee || 0).toFixed(2)} UZS</b>
                          </span>
                              {st.hotelBreakdown.vatIncluded ? (
                                <span>
                                  {t('tb.vat')}:{' '}
                                  <b>{t('tb.vat_included')}</b>
                                </span>
                              ) : (
                                <span>
                                  {t('tb.vat')}:{' '}
                                  <b>{Number(st.hotelBreakdown.vat || 0).toFixed(2)} UZS</b>
                                </span>
                              )}
                        </div>
                      </div>
                    )}

                    <div className="text-xs text-gray-600 mt-1">
                      {t('tb.price_per_night')}: <b style={{ color: BRAND.primary }}>{toNum(st.hotelRoomsTotal, toNum(st.hotel?.price, 0)).toFixed(2)}</b> {st.hotel?.currency || st.hotelBrief?.currency || "UZS"}
                    </div>
                  </div>
                  
                  {/* Entry fees */}
                    <div className="border rounded p-2">
                    <label
                      className="block text-sm font-medium mb-1"
                      style={{ color: BRAND.primary, borderBottom: `1px solid ${BRAND.accent}66`, paddingBottom: 2 }}
                    >
                      {t('tb.entry_fees')}
                    </label>
                    <input
                      className="w-full border rounded px-3 py-2 mb-2"
                      placeholder={cityChosen ? t('tb.entry_ph') : t('tb.pick_city_first')}
                      value={entryQMap[k] || ""}
                      disabled={!cityChosen}
                      onChange={async (e) => {
                        const q = e.target.value;
                        setEntryQMap((m) => ({ ...m, [k]: q }));
                        await loadEntryOptionsForDay(k, st.city, q);
                      }}
                    />
                    <AsyncSelect
                      isMulti
                      isDisabled={!cityChosen}
                      cacheOptions
                      defaultOptions={entryOptionsMap[k] || []}
                      loadOptions={(input, cb) => cb(entryOptionsMap[k] || [])}
                      value={st.entrySelected || []}
                      onChange={(vals) => setByDay((p) => ({ ...p, [k]: { ...p[k], entrySelected: vals || [] } }))}
                      placeholder={cityChosen ? t('tb.pick_sites') : t('tb.pick_city_first')}
                      noOptionsMessage={() => (cityChosen ? t('tb.nothing_found') : t('tb.pick_city_first'))}
                      menuPortalTarget={document.body}
                      styles={RS_STYLES}
                    />
                   <div className="text-xs text-gray-600 mt-1">
                     {t('tb.calc_day_hint', { amount: calcEntryForDay(k).toFixed(2) })}
                   </div>
                  </div>
                </div>

                  {/* Intercity transfers */}
                  <div className="border rounded p-2 md:col-span-2">
                    <label
                      className="block text-sm font-medium mb-1"
                      style={{ color: BRAND.primary, borderBottom: `1px solid ${BRAND.accent}66`, paddingBottom: 2 }}
                    >
                      {t('tb.transfers')}
                    </label>

                    {/* список трансферов */}
                    <div className="space-y-2">
                      {(st.transfers || []).map((tr, idx) => (
                        <div key={idx} className="grid md:grid-cols-12 gap-2 items-center">
                          {/* From / To */}
                          <input
                            className="md:col-span-3 border rounded px-2 py-2 text-sm"
                            placeholder={t('tb.transfer_from_ph')}
                            value={tr.from || ""}
                            onChange={(e) =>
                              setByDay((p) => {
                                const arr = [...(p[k].transfers || [])];
                                arr[idx] = { ...arr[idx], from: e.target.value };
                                return { ...p, [k]: { ...p[k], transfers: arr } };
                              })
                            }
                          />
                          <span className="hidden md:block text-center md:col-span-1">→</span>
                          <input
                            className="md:col-span-3 border rounded px-2 py-2 text-sm"
                            placeholder={t('tb.transfer_to_ph')}
                            value={tr.to || ""}
                            onChange={(e) =>
                              setByDay((p) => {
                                const arr = [...(p[k].transfers || [])];
                                arr[idx] = { ...arr[idx], to: e.target.value };
                                return { ...p, [k]: { ...p[k], transfers: arr } };
                              })
                            }
                          />
                          {/* type */}
                          <select
                            className="md:col-span-2 border rounded px-2 py-2 text-sm"
                            value={tr.type || "car"}
                            onChange={(e) =>
                              setByDay((p) => {
                                const arr = [...(p[k].transfers || [])];
                                arr[idx] = { ...arr[idx], type: e.target.value };
                                return { ...p, [k]: { ...p[k], transfers: arr } };
                              })
                            }
                          >
                             {TRANSFER_TYPES.map(tt => (
                               <option key={tt.id} value={tt.id}>{t(`tb.transfer_types.${tt.id}`)}</option>
                             ))}
                          </select>
                          {/* price */}
                          <input
                            type="number"
                            min={0}
                            className="md:col-span-2 border rounded px-2 py-2 text-sm"
                            placeholder={t('tb.transfer_price_ph')}
                            value={tr.price ?? 0}
                            onChange={(e) =>
                              setByDay((p) => {
                                const arr = [...(p[k].transfers || [])];
                                arr[idx] = { ...arr[idx], price: Number(e.target.value) || 0 };
                                return { ...p, [k]: { ...p[k], transfers: arr } };
                              })
                            }
                          />
                          <select
                            className="md:col-span-1 border rounded px-2 py-2 text-sm"
                            value={tr.currency || "UZS"}
                            onChange={(e) =>
                              setByDay((p) => {
                                const arr = [...(p[k].transfers || [])];
                                arr[idx] = { ...arr[idx], currency: e.target.value };
                                return { ...p, [k]: { ...p[k], transfers: arr } };
                              })
                            }
                          >
                          <option value="UZS">{t('tb.currencyintercities.uzs')}</option>
                         <option value="USD">{t('tb.currencyintercities.usd')}</option>
                          </select>
                          <label className="md:col-span-2 inline-flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={!!tr.perPax}
                              onChange={(e) =>
                                setByDay((p) => {
                                  const arr = [...(p[k].transfers || [])];
                                  arr[idx] = { ...arr[idx], perPax: e.target.checked };
                                  return { ...p, [k]: { ...p[k], transfers: arr } };
                                })
                              }
                            />
                            <span>{t('tb.per_pax')}</span>
                          </label>
                          <button
                            className="md:col-span-1 text-xs px-2 py-2 rounded border"
                            style={{ borderColor: `${BRAND.accent}88` }}
                            onClick={() =>
                              setByDay((p) => {
                                const arr = [...(p[k].transfers || [])];
                                arr.splice(idx, 1);
                                return { ...p, [k]: { ...p[k], transfers: arr } };
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
                        className="text-sm px-3 py-1 rounded border"
                        style={{ color: BRAND.primary, borderColor: BRAND.accent }}
                        onClick={() =>
                         setByDay((p) => ({
                            ...p,
                            [k]: {
                              ...p[k],
                              transfers: [
                                ...(p[k].transfers || []),
                                { from: st.city || "", to: "", type: "car", price: 0, currency: "UZS", perPax: false },
                              ],
                            },
                          }))
                        }
                      >
                        + {t('tb.add_transfer')}
                      </button>
                      <div className="text-xs text-gray-600 mt-1">
                        {t('tb.transfers_day_sum')}: <b style={{ color: BRAND.primary }}>{calcTransfersForDay(k).toFixed(2)} UZS</b>
                      </div>
                    </div>
                  </div>

                                {/* Meals */}
                <div className="border rounded p-2 md:col-span-2">
                  <label
                    className="block text-sm font-medium mb-1"
                    style={{ color: BRAND.primary, borderBottom: `1px solid ${BRAND.accent}66`, paddingBottom: 2 }}
                  >
                    {t('tb.meals')}
                  </label>

                  {/* список позиций питания */}
                  <div className="space-y-2">
                    {(st.meals || []).map((ml, idx) => (
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
                      className="text-sm px-3 py-1 rounded border"
                      style={{ color: BRAND.primary, borderColor: BRAND.accent }}
                      onClick={() =>
                        setByDay((p) => ({
                          ...p,
                          [k]: { ...(p[k] || {}), meals: [ ...(p[k]?.meals || []), { type: "lunch", price: 0, currency: "UZS", perPax: true } ] }
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

                <div className="text-sm text-gray-700">
                  {t('tb.day_total')}: {t('tb.guide')} {calcGuideForDay(k).toFixed(2)} + {t('tb.transport')} {calcTransportForDay(k).toFixed(2)} + {t('tb.hotel_short')} {calcHotelForDay(k).toFixed(2)} + Transfer {calcTransfersForDay(k).toFixed(2)} + Entry {calcEntryForDay(k).toFixed(2)} + {t('tb.meals')} {calcMealsForDay(k).toFixed(2)} =
                  {" "}
                  <b style={{ color: BRAND.primary }}>
                    {(calcGuideForDay(k)
                      + calcTransportForDay(k)
                      + calcHotelForDay(k)
                      + calcTransfersForDay(k)
                      + calcEntryForDay(k)
                      + calcMealsForDay(k)
                    ).toFixed(2)} UZS
                  </b>
                </div>
              </div>
            );
          })}
        </div>
              {/* глобальные эффекты автоподбора на смену PAX и загрузку услуг */}
      <EffectAutoPick
        days={days}
        byDay={byDay}
        adt={adt}
        chd={chd}
        servicesCache={servicesCache}
        onRecalc={autoPickForDay}
      />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3 text-sm">
          <div className="rounded p-3 border" style={{ background: BRAND.gray, borderColor: `${BRAND.accent}55` }}>
            <div className="font-medium mb-1" style={{ color: BRAND.primary }}>{t('tb.totals.guide')}</div><div>{totals.guide.toFixed(2)} UZS</div>
          </div>
          <div className="rounded p-3 border" style={{ background: BRAND.gray, borderColor: `${BRAND.accent}55` }}>
            <div className="font-medium mb-1" style={{ color: BRAND.primary }}>{t('tb.totals.transport')}</div><div>{totals.transport.toFixed(2)} UZS</div>
          </div>
          <div className="rounded p-3 border" style={{ background: BRAND.gray, borderColor: `${BRAND.accent}55` }}>
            <div className="font-medium mb-1" style={{ color: BRAND.primary }}>{t('tb.totals.hotels')}</div><div>{totals.hotel.toFixed(2)} UZS</div>
          </div>
          <div className="rounded p-3 border" style={{ background: BRAND.gray, borderColor: `${BRAND.accent}55` }}>
            <div className="font-medium mb-1" style={{ color: BRAND.primary }}>{t('tb.totals.transfers')}</div><div>{totals.transfers.toFixed(2)} UZS</div>
          </div>
          <div className="rounded p-3 border" style={{ background: BRAND.gray, borderColor: `${BRAND.accent}55` }}>
            <div className="font-medium mb-1" style={{ color: BRAND.primary }}>{t('tb.meals')}</div>
            <div>{totals.meals.toFixed(2)} UZS</div>
          </div>
          <div className="rounded p-3 border" style={{ background: BRAND.gray, borderColor: `${BRAND.accent}55` }}>
            <div className="font-medium mb-1" style={{ color: BRAND.primary }}>{t('tb.totals.entry')}</div><div>{totals.entries.toFixed(2)} UZS</div>
          </div>
          <div className="rounded p-3 border" style={{ background: BRAND.gray, borderColor: `${BRAND.accent}55` }}>
            <div className="font-semibold" style={{ color: BRAND.primary }}>{t('tb.totals.total')}</div>
            <div className="flex justify-between"><span>NET</span><span style={{ color: BRAND.primary, fontWeight: 700 }}>{totals.net.toFixed(2)} UZS</span></div>
            <div className="flex justify-between mt-1"><span>/ pax</span><span>{totals.perPax.toFixed(2)} UZS</span></div>
          </div>
        </div>
              {/* ===== Курс и итоги в USD ===== */}
      <div className="mt-3 p-3 border rounded-lg bg-white">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium">
            USD rate (UZS for 1 USD)
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            className="h-9 w-52 border rounded px-2 text-sm"
            placeholder="например, 12600"
            value={usdRate}
            onChange={(e) => setUsdRate(Number(e.target.value) || 0)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3 text-sm">
        <div className="rounded p-3 border" style={{ background: BRAND.gray, borderColor: `${BRAND.accent}55` }}>
          <div className="font-medium mb-1" style={{ color: BRAND.primary }}>{t('tb.totals.guide')} (USD)</div>
          <div>{toUSD(totals.guide).toFixed(2)} USD</div>
        </div>
        <div className="rounded p-3 border" style={{ background: BRAND.gray, borderColor: `${BRAND.accent}55` }}>
          <div className="font-medium mb-1" style={{ color: BRAND.primary }}>{t('tb.totals.transport')} (USD)</div>
          <div>{toUSD(totals.transport).toFixed(2)} USD</div>
        </div>
        <div className="rounded p-3 border" style={{ background: BRAND.gray, borderColor: `${BRAND.accent}55` }}>
          <div className="font-medium mb-1" style={{ color: BRAND.primary }}>{t('tb.totals.hotels')} (USD)</div>
          <div>{toUSD(totals.hotel).toFixed(2)} USD</div>
        </div>
        <div className="rounded p-3 border" style={{ background: BRAND.gray, borderColor: `${BRAND.accent}55` }}>
          <div className="font-medium mb-1" style={{ color: BRAND.primary }}>{t('tb.totals.transfers')} (USD)</div>
          <div>{toUSD(totals.transfers).toFixed(2)} USD</div>
        </div>
        <div className="rounded p-3 border" style={{ background: BRAND.gray, borderColor: `${BRAND.accent}55` }}>
          <div className="font-medium mb-1" style={{ color: BRAND.primary }}>{t('tb.meals')} (USD)</div>
          <div>{toUSD(totals.meals).toFixed(2)} USD</div>
        </div>
        <div className="rounded p-3 border" style={{ background: BRAND.gray, borderColor: `${BRAND.accent}55` }}>
          <div className="font-medium mb-1" style={{ color: BRAND.primary }}>{t('tb.totals.entry')} (USD)</div>
          <div>{toUSD(totals.entries).toFixed(2)} USD</div>
        </div>
        <div className="rounded p-3 border" style={{ background: BRAND.gray, borderColor: `${BRAND.accent}55` }}>
          <div className="font-semibold" style={{ color: BRAND.primary }}>Total (USD)</div>
          <div className="flex justify-between">
            <span>NET</span>
            <span style={{ color: BRAND.primary, fontWeight: 700 }}>{toUSD(totals.net).toFixed(2)} USD</span>
          </div>
          <div className="flex justify-between mt-1">
            <span>/ pax</span>
            <span>{toUSD(totals.perPax).toFixed(2)} USD</span>
          </div>
          {Number(usdRate) <= 0 && (
            <div className="text-xs text-amber-600 mt-2">
              {t('tb.usd_enter_valid_rate')}
            </div>
          )}
        </div>
      </div>
      {/* ===== Кнопка «Бронировать» → создаём ЗАПРОСЫ поставщикам ===== */}
      <div className="max-w-6xl mx-auto mt-4 mb-8">
        <button
          type="button"
          onClick={handleSendRequests}
          disabled={sending}
          className="px-4 py-2 rounded-lg text-white"
          style={{ background: sending ? '#D1D5DB' : BRAND.primary }}
          title="Создать бронирования поставщикам по выбранным дням"
        >
          {sending ? "Создаю..." : "Бронировать"}
        </button>
        <div className="text-xs text-gray-500 mt-1">
          Кнопка создаёт бронирования провайдерам (гид/транспорт) по всем выбранным дням. Уведомления приходят провайдерам (если настроено на бэке).
        </div>
      </div>
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
    </div>
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

function HotelRoomPicker({ hotelBrief, seasons, nightDates, residentFlag, paxCount = 1, onTotalChange, onBreakdown }) {
    // локализация внутри дочернего компонента
  const { t } = useTranslation();
  const MEALS = ["BB","HB","FB","AI","UAI"];
  const [meal, setMeal] = useState("BB");
  // карта количеств по типам: { 'Double': 2, 'Triple': 1, ... }
  const [qty, setQty] = useState({});
  const [extraBeds, setExtraBeds] = useState(0); // кол-во доп. мест на эту ночь

  useEffect(() => {
    // обнуляем при смене отеля
    setQty({});
    setMeal("BB");
    setExtraBeds(0);
  }, [hotelBrief?.id]);

  // список типов из брифа
  const roomTypes = useMemo(() => {
    const arr = Array.isArray(hotelBrief?.rooms) ? hotelBrief.rooms : [];
    // уникальные имена типов (в брифе они приходят как { type, count, prices:{low/high...} })
    const names = Array.from(new Set(arr.map(r => r.type).filter(Boolean)));
    return names;
  }, [hotelBrief]);

  // быстрый доступ к объекту по type
  const mapByType = useMemo(() => {
    const m = new Map();
    (hotelBrief?.rooms || []).forEach(r => m.set(r.type, r));
    return m;
  }, [hotelBrief]);

  
  // --- универсальные геттеры числовых полей из брифа ---
  const toNumSafe = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
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

  // пересчёт тотала при каждом изменении
  useEffect(() => {
    let sum = 0;
    let roomsSubtotal = 0;
    const personKey = residentFlag ? "resident" : "nonResident";
    const nights = Array.isArray(nightDates) ? nightDates.length : 0;
    for (const ymd of (nightDates || [])) {
      const season = resolveSeasonLabel(ymd, seasons); // 'low' | 'high'
      for (const [type, n] of Object.entries(qty)) {
        const count = Number(n) || 0;
        if (!count) continue;
        const row = mapByType.get(type);
        const price = Number(
          row?.prices?.[season]?.[personKey]?.[meal] ?? 0
        );
        roomsSubtotal += count * price;
      }
    }
    sum += roomsSubtotal;
      
    
        // 1) Доп. место (за чел/ночь)
    const extraBedUnit = pickNumeric(hotelBrief, [
     "extra_bed_cost", "extra_bed_price", "extra_bed",
      "extra_bed_uzs", "extra_bed_per_night", "extraBed",
      "extra_bed_amount"
    ]);
    const extraBedsTotal = Math.max(0, Number(extraBeds) || 0) * extraBedUnit * nights;
    sum += extraBedsTotal;

    // 2) Туристический сбор (за чел/ночь)
    const feeResident = pickNumeric(hotelBrief, [
      "taxes.touristTax.residentPerNight",
      "tourism_fee_resident", "tourism_fee_res", "tourist_fee_resident",
      "resident_tourist_fee", "tourism_tax_resident", "resident_city_tax"
    ]);
    const feeNonResident = pickNumeric(hotelBrief, [
      "taxes.touristTax.nonResidentPerNight",
      "tourism_fee_nonresident", "tourism_fee_nrs", "tourist_fee_nonresident",
      "nonresident_tourist_fee", "tourism_tax_nonresident", "nonresident_city_tax"
    ]);

    const feePerPerson = residentFlag ? feeResident : feeNonResident;
    const tourismFeeTotal = Math.max(0, Number(paxCount) || 0) * feePerPerson * nights;
    sum += tourismFeeTotal;
    // 3) НДС (если не включён в цены)
    const vatIncluded = toBool(hotelBrief?.vatIncluded ?? hotelBrief?.vat_included);
    const vatRate = Number(hotelBrief?.vatRate ?? hotelBrief?.vat_rate ?? 0) || 0;
    const vatBase = roomsSubtotal + extraBedsTotal; // турсбор не облагаем
    const vat = (!vatIncluded && vatRate > 0) ? Math.round(vatBase * (vatRate / 100)) : 0;
    sum += vat;

    onTotalChange?.(sum);
    onBreakdown?.({
      rooms: roomsSubtotal,
      extraBeds: extraBedsTotal,
      tourismFee: tourismFeeTotal,
      vat,
      vatIncluded,
      nights,
      pax: paxCount
    });
  }, [qty, meal, nightDates, seasons, residentFlag, mapByType, extraBeds, paxCount, hotelBrief, onTotalChange, onBreakdown]);

  return (
    <div className="mt-3 border rounded p-2">
      <div className="flex items-center gap-3 mb-2">
        <div className="text-sm font-medium">{t('tb.rooms_and_meals')}</div>
        <select className="h-8 border rounded px-2 text-sm" value={meal} onChange={(e) => setMeal(e.target.value)}>
          {MEALS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <div className="text-xs text-gray-500">({residentFlag ? t('tb.residents') : t('tb.nonresidents')})</div>
      </div>

        {/* Доп. место и подсказка по тур. сбору */}
      <div className="grid sm:grid-cols-2 gap-2 mb-2">
        <label className="flex items-center justify-between border rounded px-2 py-1">
          <span className="text-sm">{t('tb.extra_beds_qty') || 'Доп. место (шт)'}</span>
          <input
            type="number"
            min={0}
            className="h-8 w-20 border rounded px-2 text-sm"
            value={extraBeds}
            onChange={(e) => setExtraBeds(Math.max(0, Number(e.target.value) || 0))}
          />
        </label>
        
          <div className="text-xs text-gray-600 flex items-center px-2">
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

      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
        {roomTypes.map((type) => {
          const max = Number(mapByType.get(type)?.count ?? 0);
          return (
            <label key={type} className="flex items-center justify-between border rounded px-2 py-1">
              <span className="text-sm">{type}{max ? ` (≤ ${max})` : ""}</span>
              <input
                type="number"
                min={0}
                max={Math.max(0, max)}
                className="h-8 w-20 border rounded px-2 text-sm"
                value={qty[type] ?? 0}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(Number(e.target.value || 0), Math.max(0, max)));
                  setQty((p) => ({ ...p, [type]: v }));
                }}
              />
            </label>
          );
        })}
        {!roomTypes.length && (
          <div className="text-xs text-amber-600">
            Для отеля не найден номерной фонд. Заполните на странице админ-формы отеля.
          </div>
        )}
      </div>
    </div>
  );
}


