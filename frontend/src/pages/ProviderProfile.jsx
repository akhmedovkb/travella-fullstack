// frontend/src/pages/ProviderProfile.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
const { t, i18n } = useTranslation();
import { apiGet } from "../api";
import RatingStars from "../components/RatingStars";
import ReviewForm from "../components/ReviewForm";
import { getProviderReviews, addProviderReview } from "../api/reviews";
import { tSuccess, tError } from "../shared/toast";
// локали для DayPicker
import { enUS, ru, uz } from "date-fns/locale";
const { t, i18n } = useTranslation();


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

const getLangLabel = (code) => {
  const c = normalizeLangCode(code);
  return LANGUAGE_OPTIONS.find(o => o.value === c)?.label || code;
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
  const { t } = useTranslation();
  const serviceIdParam = params.get("service");
  const serviceId = serviceIdParam ? Number(serviceIdParam) : null;

  const [prov, setProv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reviewsAgg, setReviewsAgg] = useState({ count: 0, avg: 0 });
  const [reviews, setReviews] = useState([]);
  const [authorProvTypes, setAuthorProvTypes] = useState({});

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

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6">
      <div className="bg-white rounded-xl border shadow overflow-hidden mb-6">
        {details.cover && (
          <div className="h-40 sm:h-56 w-full overflow-hidden">
            <img src={details.cover} alt="" className="w-full h-full object-cover" />
          </div>
        )}
        <div className="p-4 md:p-6 flex items-start gap-4">
          {/* BIG logo/photo */}
          <div className="shrink-0">
            <div className="w-32 h-32 md:w-48 md:h-48 rounded-xl bg-gray-100 overflow-hidden flex items-center justify-center ring-1 ring-black/5">
              {details.logo ? (
                <img src={details.logo} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs text-gray-400 px-2">Нет фото</span>
              )}
            </div>
          </div>

          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl md:text-2xl font-semibold">
                {t("marketplace.supplier", { defaultValue: "Поставщик" })}: {details.name || "-"}
              </h1>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <RatingStars value={reviewsAgg.avg} size={16} />
                <span className="font-medium">{(reviewsAgg.avg || 0).toFixed(1)} / 5</span>
                <span className="opacity-70">· {t("reviews.count", { count: reviewsAgg.count ?? 0 })}</span>
              </div>
            </div>

            <div className="mt-1 text-gray-600 flex flex-wrap gap-x-4 gap-y-1">
              {details.type   && <span>{t("provider.type", { defaultValue: "Тип поставщика" })}: <b>{providerTypeLabel(details.type, t)}</b></span>}
              {details.region && <span>{t("provider.region", { defaultValue: "Регион поставщика" })}: <b>{details.region}</b></span>}
              {details.phone  && (
                <span>
                  {t("marketplace.phone", { defaultValue: "Телефон" })}:{" "}
                  <a className="underline" href={`tel:${String(details.phone).replace(/\s+/g, "")}`}>{details.phone}</a>
                </span>
              )}
              {details.telegram && (
                <span>
                  {t("marketplace.telegram", { defaultValue: "Телеграм" })}:{" "}
                  {String(details.telegram).startsWith("@")
                    ? <a className="underline break-all" href={`https://t.me/${String(details.telegram).slice(1)}`} target="_blank" rel="noreferrer">{details.telegram}</a>
                    : /^https?:\/\//.test(String(details.telegram))
                      ? <a className="underline break-all" href={details.telegram} target="_blank" rel="noreferrer">{details.telegram}</a>
                      : <span>{details.telegram}</span>}
                </span>
              )}
              {details.address && <span>{t("marketplace.address", { defaultValue: "Адрес" })}: <b>{details.address}</b></span>}
            </div>

            {details.about && (
              <div className="mt-3">
                <div className="text-gray-500 text-sm mb-1">{t("common.about", { defaultValue: "О компании" })}</div>
                <div className="whitespace-pre-line">{details.about}</div>
              </div>
            )}
                      {/* Языки */}
          {langs.length ? (
            <div className="mt-3">
              <div className="text-gray-500 text-sm mb-1">
                {t("provider.languages", { defaultValue: "Языки" })}
              </div>
              <ul className="list-disc ml-5 text-sm">
                {langs.map((l, i) => (
                  <li key={`${l.code}-${l.level || "na"}`}>
                    {getLangLabel(l.code)}
                    {l.level ? ` — ${getLevelLabel(l.level)}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          </div>
        </div>
      </div>

      {/* Отзывы */}
      <div className="bg-white rounded-xl border shadow p-4 md:p-6 mb-6">
        <div className="text-lg font-semibold mb-3">{t("reviews.list", { defaultValue: "Отзывы" })}</div>
        {!reviews.length ? (
          <div className="text-gray-500">{t("reviews.empty", { defaultValue: "Пока нет отзывов." })}</div>
        ) : (
          <ul className="space-y-4">
            {reviews.map((r) => {
              const avatar =
                firstImageFrom(r.author?.avatar_url) ||
                "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36'><rect width='100%' height='100%' fill='%23f3f4f6'/><text x='50%' y='58%' text-anchor='middle' fill='%239ca3af' font-family='Arial' font-size='10'>Нет фото</text></svg>";
              return (
                <li key={r.id} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <img src={avatar} alt="" className="w-9 h-9 rounded-full object-cover border" />
                      <div className="min-w-0">
                        <div className="text-sm text-gray-700 truncate">
                          {r.author?.name || t("common.anonymous", { defaultValue: "Аноним" })}{" "}
                          <span className="text-gray-400">
                            (
                            {r.author?.role === "provider"
                              ? (authorProvTypes[r.author.id] || t("roles.provider", { defaultValue: "Поставщик" }))
                              : t("roles.client",   { defaultValue: "Клиент" })
                            }
                            )
                          </span>
                        </div>
                        <div className="text-xs text-gray-400">
                          {new Date(r.created_at || Date.now()).toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <RatingStars value={r.rating || 0} size={16} />
                  </div>
                  {r.text && <div className="mt-2 whitespace-pre-line">{r.text}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ===== NEW: Публичный календарь бронирования (только гид/транспорт) ===== */}
      {canBook && (
        <div id="book" className="bg-white rounded-xl border shadow p-4 md:p-6">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <h2 className="text-lg font-semibold">
              {t("calendar.title_public", { defaultValue: "Календарь занятости" })}
            </h2>
            <div className="text-sm text-gray-600">
              <span className="inline-block w-3 h-3 bg-gray-300 rounded-sm align-middle mr-1" />{" "}
              {t("calendar.busy", { defaultValue: "занято" })}
              <span className="mx-2">·</span>
              <span className="inline-block w-3 h-3 bg-orange-500 rounded-sm align-middle mr-1" />{" "}
              {t("calendar.selected", { defaultValue: "выбрано" })}
            </div>
          </div>

          <DayPicker
              locale={dpLocale}
              weekStartsOn={weekStartsOn}
              mode="multiple"
              onDayClick={toggleDay}
              selected={selectedDates}
              disabled={disabledDays}
              modifiers={{ past: pastMatcher, busy: busyDates }}
              modifiersClassNames={{
                selected: "bg-orange-500 text-white",
                busy: "bg-gray-300 text-white",
                past: "text-gray-400 cursor-not-allowed",
              }}
              modifiersStyles={{
                selected: { backgroundColor: "#f97316", color: "#fff" }, // оранжевый
                busy: { backgroundColor: "#d1d5db", color: "#fff", opacity: 1 }, // серый кружок без побледнения
                past: { color: "#9ca3af", background: "transparent" }, // бледный текст, без фона
              }}
              className={calendarLoading ? "opacity-60 pointer-events-none" : ""}
            />


          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={openBookingModal}
              className="px-4 py-2 rounded-md bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50"
              disabled={!selectedYMD.length}
            >
              {t("actions.book", { defaultValue: "Бронировать" })}
            </button>
            {!!selectedYMD.length && (
              <div className="text-sm text-gray-600">
                {t("calendar.selected_dates", { defaultValue: "Выбрано дат" })}: <b>{selectedYMD.length}</b>
              </div>
            )}
          </div>

          {!token && (
            <div className="mt-2 text-sm text-gray-500">
              {t("booking.need_auth_hint", { defaultValue: "Чтобы отправить бронь, войдите в систему." })}
            </div>
          )}

          <BookingModal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            onSubmit={submitBooking}
            selectedYmd={selectedYMD}
          />
        </div>
      )}

      {canReview && (
        <div className="bg-white rounded-xl border shadow p-4 md:p-6 mt-6">
          <div className="text-lg font-semibold mb-3">{t("reviews.leave", { defaultValue: "Оставить отзыв" })}</div>
          <ReviewForm onSubmit={submitReview} submitLabel={t("reviews.send", { defaultValue: "Отправить" })} />
        </div>
      )}
    </div>
  );
}
