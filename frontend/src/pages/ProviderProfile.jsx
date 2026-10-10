// frontend/src/pages/ProviderProfile.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { apiGet } from "../api";
import { useTranslation } from "react-i18next";
import RatingStars from "../components/RatingStars";
import ReviewForm from "../components/ReviewForm";
import { getProviderReviews, addProviderReview } from "../api/reviews";
import { tSuccess, tError } from "../shared/toast";
// локали для DayPicker
import { enUS, ru, uz } from "date-fns/locale";



// >>> NEW: calendar deps
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import axios from "axios";
// начало сегодняшнего дня (локально)
const getStartOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};


// helpers
const first = (...vals) => {
  for (const v of vals) {
    if (v === 0) return 0;
    if (v !== undefined && v !== null && String(v).trim?.() !== "") return v;
  }
  return null;
};
const maybeParse = (x) => {
  if (!x) return null;
  if (typeof x === "object") return x;
  if (typeof x === "string") {
    const s = x.trim();
    if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
      try { return JSON.parse(s); } catch { return null; }
    }
  }
  return null;
};
const makeAbsolute = (u) => {
  if (!u) return null;
  const s = String(u).trim();
  if (/^(data:|https?:|blob:)/i.test(s)) return s;
  if (s.startsWith("//")) return `${window.location.protocol}${s}`;
  const base = (import.meta.env.VITE_API_BASE_URL || window.location.origin || "").replace(/\/+$/,"");
  return `${base}/${s.replace(/^\/+/, "")}`;
};
const firstImageFrom = (val) => {
  if (!val) return null;
  if (typeof val === "string") {
    const s = val.trim();
    const parsed = maybeParse(s);
    if (parsed) return firstImageFrom(parsed);
    if (/^(data:|https?:|blob:)/i.test(s)) return s;
    if (/^\/?(storage|uploads|files|images)\b/i.test(s)) return makeAbsolute(s);
    if (s.includes(",") || s.includes("|")) {
      const candidate = s.split(/[,\|]/).map((x) => x.trim()).find(Boolean);
      return firstImageFrom(candidate);
    }
    return makeAbsolute(s);
  }
  if (Array.isArray(val)) {
    for (const item of val) {
      const found = firstImageFrom(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof val === "object") {
    const hit = first(
      val.url, val.src, val.image, val.photo, val.logo,
      Array.isArray(val.images) ? val.images[0] : val.images,
      Array.isArray(val.photos) ? val.photos[0] : val.photos,
      Array.isArray(val.gallery) ? val.gallery[0] : val.gallery
    );
    return firstImageFrom(hit);
  }
  return null;
};

const formatRegion = (value) => {
  if (!value) return "";
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean).join(", ");
  if (typeof value === "object") return [value.city, value.region, value.country].map((item) => String(item || "").trim()).filter(Boolean).join(", ");
  const raw = String(value).trim();
  const parsed = maybeParse(raw);
  if (parsed) return formatRegion(parsed);
  const pgArray = raw.match(/^\{(.+)\}$/);
  return pgArray ? pgArray[1].split(",").map((item) => item.replace(/^"|"$/g, "").trim()).filter(Boolean).join(", ") : raw;
};
const telegramContact = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return { href: raw, label: raw.replace(/^https?:\/\/(www\.)?/i, "") };
  const username = raw.replace(/^@/, "").replace(/^t\.me\//i, "").trim();
  return !username || /\s/.test(username) ? { href: null, label: raw } : { href: `https://t.me/${username}`, label: `@${username}` };
};
// загрузка профиля провайдера (перебор возможных эндпоинтов)
async function fetchProviderProfile(providerId) {
  const endpoints = [
    `/api/providers/${providerId}`, `/api/provider/${providerId}`,
    `/api/companies/${providerId}`, `/api/company/${providerId}`,
    `/api/agencies/${providerId}`,  `/api/agency/${providerId}`,
    `/api/users/${providerId}`,     `/api/user/${providerId}`,
  ];
  for (const url of endpoints) {
    try {
      const res = await apiGet(url);
      const obj = (res && (res.data || res.item || res.profile || res.provider || res.company)) || res;
      if (obj && (obj.id || obj.name || obj.title)) return obj;
    } catch {}
  }
  return null;
}

// i18n helper
const tr = (t) => (key, fallback) => t(key, { defaultValue: fallback });

// Маппинг типа поставщика (строки/коды)
function providerTypeKey(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  const byCode = { "1":"agent","2":"guide","3":"transport","4":"hotel" };
  if (byCode[s]) return byCode[s];
  const direct = {
    agent:"agent","travel_agent":"agent","travelagent":"agent","тур агент":"agent","турагент":"agent","tour_agent":"agent",
    guide:"guide","tour_guide":"guide","tourguide":"guide","гид":"guide","экскурсовод":"guide",
    transport:"transport","transfer":"transport","car":"transport","driver":"transport","taxi":"transport","авто":"transport","транспорт":"transport","трансфер":"transport",
    hotel:"hotel","guesthouse":"hotel","accommodation":"hotel","otel":"hotel","отель":"hotel",
  };
  if (direct[s]) return direct[s];
  if (/guide|гид|экскур/.test(s)) return "guide";
  if (/hotel|guest|accom|otel|отел/.test(s)) return "hotel";
  if (/trans|taxi|driver|car|bus|авто|трансфер|транспорт/.test(s)) return "transport";
  if (/agent|agency|travel|тур|агент/.test(s)) return "agent";
  return null;
}
function providerTypeLabel(raw, t) {
  const key = providerTypeKey(raw);
  if (!key) return raw || "";
  const _ = tr(t);
  const fallback = { agent: "Турагент", guide: "Гид", transport: "Транспорт", hotel: "Отель" }[key];
  return _(`provider.types.${key}`, fallback);
}

// === Languages dictionaries (display only) ===
const LANGUAGE_OPTIONS = [
  { value: "uz", label: "O‘zbekcha" },
  { value: "ru", label: "Русский" },
  { value: "en", label: "English" },
  { value: "tr", label: "Türkçe" },
  { value: "de", label: "Deutsch" },
  { value: "ar", label: "العربية" },
  { value: "fr", label: "Français" },
  { value: "es", label: "Español" },
  { value: "it", label: "Italiano" },
];

const LEVEL_OPTIONS = [
  { value: "basic",        label: "A2 — Basic" },
  { value: "intermediate", label: "B1/B2 — Intermediate" },
  { value: "advanced",     label: "C1/C2 — Advanced" },
  { value: "native",       label: "Native" },
];

// рядом с LANGUAGE_OPTIONS / LEVEL_OPTIONS
const normalizeLangCode = (c) =>
  String(c || "").toLowerCase().split(/[_-]/)[0];

const normalizeLevel = (s) => {
  const x = String(s || "").toLowerCase().trim();
  if (!x) return "";
  if (/native|родной/.test(x)) return "native";
  if (/^(c1|c2)|adv/.test(x)) return "advanced";
  if (/^(b1|b2)|inter/.test(x)) return "intermediate";
  if (/^(a1|a2)|basic|elem|pre/.test(x)) return "basic";
  return x; // оставляем как есть, вдруг кастом
};

const getLangLabel = (code, uiLang = "en") => {
  const c = normalizeLangCode(code);
  try {
    if (typeof Intl !== "undefined" && Intl.DisplayNames) {
      const dn = new Intl.DisplayNames([uiLang], { type: "language" });
      const name = dn.of(c);
      if (name && name !== c) return name[0].toUpperCase() + name.slice(1);
    }
  } catch {}
  // фолбэк на ручной список, если что-то пойдёт не так
  return LANGUAGE_OPTIONS.find(o => o.value === c)?.label || c;
};

const getLevelLabel = (lvl) => {
  const v = normalizeLevel(lvl);
  return LEVEL_OPTIONS.find(o => o.value === v)?.label || (lvl ? String(lvl).toUpperCase() : "");
};



// ===== Local helpers for dates (no TZ shift) =====
const ymdToDateLocal = (s) => {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0,10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};
const dateToYMD = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const da = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${da}`;
};

// ====== Inline modal for booking ======
function BookingModal({ open, onClose, onSubmit, selectedYmd = [] }) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState([]);

  useEffect(() => {
    if (!open) {
      setMessage("");
      setFiles([]);
    }
  }, [open]);

  const handleFiles = (e) => {
    setFiles(Array.from(e.target.files || []));
  };

  const submit = async () => {
    try {
      const attachments = [];
      for (const f of files) {
        const dataUrl = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(f);
        });
        attachments.push({ name: f.name, type: f.type || "application/octet-stream", dataUrl });
      }
      await onSubmit({ message, attachments });
    } catch (e) {
      console.error(e);
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[3000] bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
        <div className="p-4 border-b font-semibold">
          {t("booking.modal_title", { defaultValue: "Бронирование" })}
        </div>
        <div className="p-4 space-y-3">
          <div className="text-sm text-gray-600">
            {t("booking.selected_dates", { defaultValue: "Выбранные даты" })}:{" "}
            <b>{selectedYmd.join(", ") || "—"}</b>
          </div>
          <div>
            <label className="text-sm text-gray-700 block mb-1">
              {t("booking.message_label", { defaultValue: "Сообщение" })}
            </label>
            <textarea
              className="w-full border rounded-md p-2 min-h-[96px]"
              placeholder={t("booking.message_ph", { defaultValue: "Опишите детали запроса..." })}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm text-gray-700 block mb-1">
              {t("booking.attachments_label", { defaultValue: "Вложения (PDF, Word, Excel, PPT, изображения и т.д.)" })}
            </label>
            <input type="file" multiple onChange={handleFiles} />
          </div>
        </div>
        <div className="p-4 border-t flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md border hover:bg-gray-50"
          >
            {t("common.cancel", { defaultValue: "Отмена" })}
          </button>
          <button
            onClick={submit}
            className="px-4 py-2 rounded-md bg-orange-500 hover:bg-orange-600 text-white"
          >
            {t("booking.send", { defaultValue: "Отправить бронь" })}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProviderProfile() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const pid = Number(id);
  const { t, i18n } = useTranslation();
  const serviceIdParam = params.get("service");
  const serviceId = serviceIdParam ? Number(serviceIdParam) : null;

  const [prov, setProv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reviewsAgg, setReviewsAgg] = useState({ count: 0, avg: 0 });
  const [reviews, setReviews] = useState([]);
  const [authorProvTypes, setAuthorProvTypes] = useState({});
  const [activeTab, setActiveTab] = useState(serviceId ? "availability" : "profile");

  // >>> NEW: calendar state
  const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [bookedYMD, setBookedYMD] = useState([]);   // includes blocked + booked
  const [selectedYMD, setSelectedYMD] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const startOfToday = useMemo(() => getStartOfToday(), []);

  // уже занятые как Date[]
const busyDates = useMemo(
  () => bookedYMD.map(ymdToDateLocal).filter(Boolean),
  [bookedYMD]
);

// матчер для прошедших
const pastMatcher = useMemo(() => ({ before: startOfToday }), [startOfToday]);

// итоговый disabled для кликов: прошлые + занятые
const disabledDays = useMemo(() => [pastMatcher, ...busyDates], [pastMatcher, busyDates]);

// выбранные
const selectedDates = useMemo(
  () => selectedYMD.map(ymdToDateLocal).filter(Boolean),
  [selectedYMD]
);

const dpLocale = useMemo(() => {
  const lang = (i18n.language || "en").split("-")[0];
  if (lang === "ru") return ru;
  if (lang === "uz") return uz;
  return enUS; // по умолчанию — English
}, [i18n.language]);

// хотим, чтобы Пн был первым для ru/uz
const weekStartsOn = useMemo(() => {
  const lang = (i18n.language || "en").split("-")[0];
  return lang === "ru" || lang === "uz" ? 1 : 0;
}, [i18n.language]);



  // tokens
  const token =
    localStorage.getItem("clientToken") ||
    localStorage.getItem("token") ||
    localStorage.getItem("providerToken") ||
    "";

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const p = await fetchProviderProfile(pid);
        if (alive) setProv(p || null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [pid]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await getProviderReviews(pid);
        if (!alive) return;
        setReviewsAgg({
          count: Number(data?.stats?.count || data?.count || 0),
          avg: Number(data?.stats?.avg || data?.avg || 0)
        });
        setReviews(Array.isArray(data?.items) ? data.items : []);
      } catch {
        if (!alive) return;
        setReviewsAgg({ count: 0, avg: 0 });
        setReviews([]);
      }
    })();
    return () => { alive = false; };
  }, [pid]);

  useEffect(() => {
    let cancelled = false;

    // собираем уникальные id провайдеров-авторов
    const ids = Array.from(
      new Set(
        (reviews || [])
          .filter(r => r?.author?.role === "provider" && Number(r?.author?.id))
          .map(r => Number(r.author.id))
      )
    );

    if (!ids.length) return;

    (async () => {
      const map = {};
      for (const aid of ids) {
        try {
          const p = await fetchProviderProfile(aid);
          const d = maybeParse(p?.details) || p?.details || {};
          const rawType =
            p?.type ??
            p?.provider_type ??
            p?.category ??
            d?.type ?? d?.provider_type ?? d?.category;

          map[aid] = providerTypeLabel(rawType, t) || t("roles.provider", { defaultValue: "Поставщик" });
        } catch {
          // молча
        }
      }
      if (!cancelled) {
        setAuthorProvTypes(prev => ({ ...prev, ...map }));
      }
    })();

    return () => { cancelled = true; };
  }, [reviews, t]);

  const details = useMemo(() => {
    const d = maybeParse(prov?.details) || prov?.details || {};
    const contacts = prov?.contacts || {};
    const socials  = prov?.socials  || {};

    const name     = first(prov?.display_name, prov?.name, prov?.title, prov?.brand, prov?.company_name);
    const about    = first(d?.about, d?.description, prov?.about, prov?.description);
    const city     = first(d?.city, prov?.city, contacts?.city, prov?.location?.city);
    const country  = first(d?.country, prov?.country, contacts?.country, prov?.location?.country);
    const phone    = first(prov?.phone, prov?.phone_number, prov?.phoneNumber, contacts?.phone, d?.phone, prov?.whatsapp, prov?.whatsApp);
    const email    = first(prov?.email, contacts?.email, d?.email);
    const telegram = first(prov?.telegram, prov?.tg, contacts?.telegram, socials?.telegram, d?.telegram, prov?.social);
    const website  = first(prov?.website, contacts?.website, d?.website, prov?.site, socials?.site);

    const logo     = firstImageFrom(first(
      prov?.logo, d?.logo, prov?.photo, d?.photo, prov?.image, d?.image, prov?.avatar, d?.avatar, prov?.images, d?.images
    ));
    const cover    = firstImageFrom(first(prov?.cover, d?.cover, prov?.banner, d?.banner, prov?.images, d?.images));

    const type     = first(
      prov?.type, d?.type, prov?.provider_type, d?.provider_type,
      prov?.type_name, d?.type_name, prov?.category, d?.category,
      prov?.role, d?.role, prov?.kind, d?.kind, prov?.providerType
    );

    const region   = first(prov?.region, d?.region, prov?.location, d?.location);
    const address  = first(d?.address, prov?.address, contacts?.address);

    return { name, about, city, country, phone, email, telegram, website, logo, cover, type, region, address };
  }, [prov]);

  // Языки поставщика (нормализация + дедуп + сортировка по уровню)
const langs = useMemo(() => {
  const d = maybeParse(prov?.details) || prov?.details || {};
  let raw = first(
  prov?.languages, d?.languages,
  prov?.langs, d?.langs,
  prov?.language, d?.language,
  // новые фолбэки:
  prov?.languages_text, d?.languages_text,
  prov?.language_text, d?.language_text,
  prov?.lang, d?.lang,
  prov?.lang_list, d?.lang_list
);

  // === 1) парсинг из разных форматов -> массив {code, level}
  let arr = [];
  if (!raw) arr = [];
  else if (typeof raw === "string") {
    arr = raw
      .split(/[,\|]/)
      .map(s => ({ code: s.trim().toLowerCase(), level: "" }))
      .filter(x => x.code);
  } else if (Array.isArray(raw)) {
    arr = raw
      .map(x => {
        if (!x) return null;
        if (typeof x === "string") return { code: x.trim().toLowerCase(), level: "" };
        if (typeof x === "object") return {
          code: String(x.code || x.lang || x.language || x.value || "").toLowerCase(),
          level: String(x.level || x.proficiency || x.cefr || "").toLowerCase(),
        };
        return null;
      })
      .filter(Boolean);
  } else if (typeof raw === "object") {
    // напр. { en: "advanced", ru: "native" }
    arr = Object.entries(raw).map(([k, v]) => ({
      code: String(k).toLowerCase(),
      level: String(v || "").toLowerCase(),
    }));
  }

  // сразу после формирования arr:
arr = arr
  .map(it => (it ? { ...it, code: normalizeLangCode(it.code), level: normalizeLevel(it.level) } : null))
  .filter(it => it && it.code);


  // === 2) дедуп по коду: оставляем лучший уровень
  const rank = { native: 3, advanced: 2, intermediate: 1, basic: 0 };
  const bestByCode = new Map();
  for (const it of arr) {
    if (!it?.code) continue;
    const prev = bestByCode.get(it.code);
    const better =
      !prev || (rank[it.level] ?? -1) > (rank[prev.level] ?? -1)
        ? it
        : prev;
    bestByCode.set(it.code, { code: better.code, level: better.level || "" });
  }
  const uniq = Array.from(bestByCode.values());

  // === 3) сортировка: по уровню (desc), затем по коду (asc)
  uniq.sort((a, b) => {
    const rd = (rank[b.level] ?? -1) - (rank[a.level] ?? -1);
    return rd !== 0 ? rd : a.code.localeCompare(b.code);
  });

  return uniq;
}, [prov]);


  const canReview = useMemo(() => {
    const isClient = !!localStorage.getItem("clientToken");
    const isProvider = !!(localStorage.getItem("token") || localStorage.getItem("providerToken"));
    const myProvId = Number(localStorage.getItem("provider_id") || localStorage.getItem("id") || NaN);
    return (isClient || isProvider) && !(isProvider && myProvId === pid);
  }, [pid]);

  // === Reviews submit (unchanged) ===
  const submitReview = async ({ rating, text }) => {
    try {
      await addProviderReview(pid, { rating, text });
      const data = await getProviderReviews(pid);
      setReviewsAgg({
        count: Number(data?.stats?.count ?? data?.count ?? 0),
        avg: Number(data?.stats?.avg ?? data?.avg ?? 0),
      });
      setReviews(Array.isArray(data?.items) ? data.items : []);
      return true;
    } catch (e) {
      const already =
        e?.code === "review_already_exists" ||
        e?.response?.status === 409 ||
        e?.response?.data?.error === "review_already_exists";
      if (already) {
        tSuccess(t("reviews.already_left", { defaultValue: "Вы уже оставляли на него отзыв" }));
        return false;
      }
      console.error(e);
      throw e;
    }
  };

    // ===== CALENDAR: load public busy days =====
  const provTypeKey = providerTypeKey(details?.type || prov?.type);
  const canBook = ["guide", "transport"].includes(String(provTypeKey || ""));

  const loadCalendar = async () => {
    setCalendarLoading(true);
    try {
      // публичный эндпоинт: занятые (бронь) + ручные блокировки
      const { data } = await axios.get(
        `${API_BASE}/api/providers/${pid}/calendar`
      );

      // поддержим разные формы ответа
      // 1) { blocked: [YYYY-MM-DD], booked: [YYYY-MM-DD] }
      // 2) [YYYY-MM-DD]
      // 3) [{date:"YYYY-MM-DD"}]
      let ymd = [];
      if (Array.isArray(data)) {
        ymd = data.map((v) => (typeof v === "string" ? v : v?.date || v?.day)).filter(Boolean);
      } else if (data && typeof data === "object") {
        const blocked = Array.isArray(data.blocked) ? data.blocked : [];
        const booked  = Array.isArray(data.booked)  ? data.booked  : [];
        ymd = [...blocked, ...booked].map((v) => (typeof v === "string" ? v : v?.date || v?.day)).filter(Boolean);
      }
      // уникализируем
      setBookedYMD(Array.from(new Set(ymd)));
    } catch (e) {
      console.error("calendar load error", e);
      tError(t("calendar.load_error", { defaultValue: "Не удалось загрузить занятые даты" }));
      setBookedYMD([]);
    } finally {
      setCalendarLoading(false);
    }
  };

  useEffect(() => {
    if (canBook) loadCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canBook, pid]);

 const toggleDay = (day) => {
  // не даём выбрать прошлое
  if (day < startOfToday) return;

  const ymd = dateToYMD(day);
  // если день занят — игнор
  if (bookedYMD.includes(ymd)) return;

  setSelectedYMD((prev) =>
    prev.includes(ymd) ? prev.filter((x) => x !== ymd) : [...prev, ymd]
  );
};


  const openBookingModal = () => {
    if (!selectedYMD.length) {
      tError(t("booking.no_dates", { defaultValue: "Выберите хотя бы одну свободную дату" }));
      return;
    }
    if (!token) {
      tError(t("booking.need_auth", { defaultValue: "Авторизуйтесь, чтобы забронировать" }));
      return;
    }
    setModalOpen(true);
  };

  const submitBooking = async ({ message, attachments }) => {
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const payload = {
        provider_id: pid,
        dates: selectedYMD.slice().sort(),
        message: message || null,
        attachments: attachments || [],
      };
      if (serviceId) payload.service_id = serviceId;

      const { data } = await axios.post(`${API_BASE}/api/bookings`, payload, { headers });
      tSuccess(t("booking.sent", { defaultValue: "Заявка на бронирование отправлена" }));
      setModalOpen(false);
      setSelectedYMD([]);
      // обновим календарь, чтобы занятые даты стали серыми
      await loadCalendar();
      return data;
    } catch (e) {
      console.error(e);
      const msg = e?.response?.data?.message || t("booking.error", { defaultValue: "Не удалось отправить бронь" });
      tError(msg);
      throw e;
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-4 md:p-6">
        <div className="animate-pulse h-32 bg-gray-100 rounded-xl" />
      </div>
    );
  }

  if (!prov) return <div className="mx-auto max-w-5xl p-4"><div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm"><h1 className="text-xl font-bold text-slate-950">Поставщик не найден</h1><p className="mt-2 text-sm text-slate-500">Проверьте ссылку или вернитесь в каталог.</p><a href="/" className="mt-4 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white">В каталог</a></div></div>;

  const regionLabel = formatRegion(details.region);
  const telegram = telegramContact(details.telegram);
  const tabs = [["profile", "О профиле"], ["reviews", `Отзывы (${reviewsAgg.count || 0})`], ...(canBook ? [["availability", "Свободные даты"]] : [])];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-3 px-3 py-3 sm:px-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200">{details.logo ? <img src={details.logo} alt={details.name || ""} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-sm font-semibold text-slate-400">Нет фото</div>}</div>
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><h1 className="truncate text-xl font-black text-slate-950">{details.name || "Поставщик"}</h1><div className="flex items-center gap-2 text-sm text-slate-500"><RatingStars value={reviewsAgg.avg} size={16} /><span className="font-bold text-slate-700">{(reviewsAgg.avg || 0).toFixed(1)}</span><span>· {t("reviews.count", { count: reviewsAgg.count || 0 })}</span></div></div>
            <div className="mt-2 flex flex-wrap gap-2 text-sm">{details.type ? <span className="rounded-md bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">{providerTypeLabel(details.type, t)}</span> : null}{regionLabel ? <span className="rounded-md bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">{regionLabel}</span> : null}{details.address ? <span className="rounded-md bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">{details.address}</span> : null}</div>
          </div>
        </div>
      </section>
      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm" aria-label="Разделы публичного профиля">{tabs.map(([key, label]) => <button key={key} type="button" onClick={() => setActiveTab(key)} className={`h-9 shrink-0 rounded-lg px-4 text-sm font-bold transition ${activeTab === key ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`} aria-current={activeTab === key ? "page" : undefined}>{label}</button>)}</nav>

      {activeTab === "profile" && <section className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="font-black text-slate-950">Контакты</h2><div className="mt-3 grid gap-2 sm:grid-cols-2">
          {details.phone ? <a href={`tel:${String(details.phone).replace(/\s+/g, "")}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-800 hover:border-orange-300">Телефон<br /><span className="font-medium text-blue-700">{details.phone}</span></a> : null}
          {telegram ? <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-800">Telegram<br />{telegram.href ? <a href={telegram.href} target="_blank" rel="noreferrer" className="font-medium text-blue-700">{telegram.label}</a> : <span className="font-medium text-slate-600">{telegram.label}</span>}</div> : null}
          {details.email ? <a href={`mailto:${details.email}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-800 hover:border-orange-300">Email<br /><span className="font-medium text-blue-700">{details.email}</span></a> : null}
          {details.website ? <a href={makeAbsolute(details.website)} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-800 hover:border-orange-300">Сайт<br /><span className="font-medium text-blue-700">Открыть сайт</span></a> : null}
          {!details.phone && !telegram && !details.email && !details.website ? <div className="text-sm text-slate-500">Контакты не указаны.</div> : null}
        </div>{details.about ? <div className="mt-4 border-t border-slate-200 pt-3"><h2 className="font-black text-slate-950">О поставщике</h2><p className="mt-1 whitespace-pre-line text-sm leading-6 text-slate-600">{details.about}</p></div> : null}</div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="font-black text-slate-950">Языки</h2>{langs.length ? <div className="mt-3 flex flex-wrap gap-2">{langs.map((lang) => <span key={`${lang.code}-${lang.level || "na"}`} className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">{getLangLabel(lang.code, i18n.language)}{lang.level ? ` · ${getLevelLabel(lang.level)}` : ""}</span>)}</div> : <p className="mt-3 text-sm text-slate-500">Не указаны.</p>}<div className="mt-4 border-t border-slate-200 pt-3 text-sm text-slate-600">{regionLabel ? <div><b className="text-slate-900">Регион:</b> {regionLabel}</div> : null}{details.address ? <div className="mt-1"><b className="text-slate-900">Адрес:</b> {details.address}</div> : null}</div></div>
      </section>}

      {activeTab === "reviews" && <section className="grid gap-3 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between gap-3"><h2 className="font-black text-slate-950">Отзывы</h2><div className="flex items-center gap-2 text-sm text-slate-500"><RatingStars value={reviewsAgg.avg} size={16} /><span>{(reviewsAgg.avg || 0).toFixed(1)} / 5</span></div></div>{!reviews.length ? <p className="mt-3 text-sm text-slate-500">Пока нет отзывов.</p> : <ul className="mt-3 max-h-[430px] space-y-2 overflow-y-auto pr-1">{reviews.map((review) => { const avatar=firstImageFrom(review.author?.avatar_url); return <li key={review.id} className="rounded-lg border border-slate-200 p-3"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-2">{avatar ? <img src={avatar} alt="" className="h-9 w-9 rounded-full border object-cover" /> : <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-400">{String(review.author?.name || "А").slice(0,1)}</div>}<div className="min-w-0"><div className="truncate text-sm font-bold text-slate-800">{review.author?.name || "Аноним"} <span className="font-normal text-slate-400">({review.author?.role === "provider" ? authorProvTypes[review.author.id] || "Поставщик" : "Клиент"})</span></div><div className="text-xs text-slate-400">{new Date(review.created_at || Date.now()).toLocaleString()}</div></div></div><RatingStars value={review.rating || 0} size={15} /></div>{review.text ? <p className="mt-2 whitespace-pre-line text-sm leading-5 text-slate-700">{review.text}</p> : null}</li>})}</ul>}</div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="font-black text-slate-950">Оставить отзыв</h2>{canReview ? <div className="mt-3"><ReviewForm onSubmit={submitReview} submitLabel={t("reviews.send", { defaultValue: "Отправить" })} /></div> : <p className="mt-3 text-sm leading-5 text-slate-500">Войдите как клиент или поставщик, чтобы оставить отзыв.</p>}</div>
      </section>}

      {activeTab === "availability" && canBook && <section id="book" className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-[auto_1fr]">
        <div className={calendarLoading ? "pointer-events-none opacity-60" : ""}><DayPicker locale={dpLocale} weekStartsOn={weekStartsOn} mode="multiple" onDayClick={toggleDay} selected={selectedDates} disabled={disabledDays} modifiers={{ past: pastMatcher, busy: busyDates }} modifiersStyles={{ selected:{backgroundColor:"#f97316",color:"#fff"},busy:{backgroundColor:"#d1d5db",color:"#fff",opacity:1},past:{color:"#9ca3af",background:"transparent"} }} /></div>
        <div className="flex flex-col justify-center border-t border-slate-200 pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0"><h2 className="text-lg font-black text-slate-950">Свободные даты</h2><p className="mt-1 text-sm leading-5 text-slate-500">Выберите доступные даты и отправьте заявку поставщику.</p><div className="mt-4 flex gap-3 text-sm text-slate-600"><span><i className="mr-1 inline-block h-3 w-3 rounded-sm bg-gray-300" />Занято</span><span><i className="mr-1 inline-block h-3 w-3 rounded-sm bg-orange-500" />Выбрано</span></div><div className="mt-5 rounded-lg bg-slate-50 p-3 text-sm">Выбрано дат: <b>{selectedYMD.length}</b></div><button type="button" onClick={openBookingModal} disabled={!selectedYMD.length} className="mt-3 h-11 rounded-lg bg-orange-500 px-4 font-bold text-white hover:bg-orange-600 disabled:opacity-50">Отправить заявку</button>{!token ? <p className="mt-2 text-xs text-slate-500">Для отправки заявки необходимо войти.</p> : null}</div>
      </section>}
      <BookingModal open={modalOpen} onClose={() => setModalOpen(false)} onSubmit={submitBooking} selectedYmd={selectedYMD} />
    </div>
  );
}