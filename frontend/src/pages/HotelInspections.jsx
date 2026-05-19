// frontend/src/pages/HotelInspections.jsx
import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useSearchParams, useNavigate } from "react-router-dom";
import { getHotel, listInspections, likeInspection, createInspection } from "../api/hotels";
import { apiGet } from "../api";
import { useTranslation } from "react-i18next";
import { tSuccess } from "../shared/toast";

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const YT_RX =
  /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;

function getYoutubeId(u = "") {
  const m = String(u).trim().match(YT_RX);
  return m ? m[1] : null;
}
function isYoutubeUrl(u = "") {
  return !!getYoutubeId(u);
}

const SCORE_FIELDS = [
  { key: "quiet_level", labelKey: "hotels.scores.quiet_level", fallback: "Тишина" },
  { key: "family_score", labelKey: "hotels.scores.family_score", fallback: "Семьи" },
  { key: "infra_score", labelKey: "hotels.scores.infra_score", fallback: "Инфраструктура" },
  { key: "nightlife_score", labelKey: "hotels.scores.nightlife_score", fallback: "Ночная жизнь" },
  { key: "activity_score", labelKey: "hotels.scores.activity_score", fallback: "Активности" },
  { key: "wellness_score", labelKey: "hotels.scores.wellness_score", fallback: "Wellness" },
  { key: "business_score", labelKey: "hotels.scores.business_score", fallback: "Бизнес" },
  { key: "value_score", labelKey: "hotels.scores.value_score", fallback: "Цена/качество" },
  { key: "access_score", labelKey: "hotels.scores.access_score", fallback: "Доступность" },
];

const AMENITIES = [
  { key: "crib", labelKey: "hotels.amenities.crib", fallback: "Детская кроватка" },
  { key: "kids_pool", labelKey: "hotels.amenities.kids_pool", fallback: "Детский бассейн" },
  { key: "kids_club", labelKey: "hotels.amenities.kids_club", fallback: "Детский клуб" },
  { key: "kitchenette", labelKey: "hotels.amenities.kitchenette", fallback: "Кухонный уголок" },
  { key: "gym", labelKey: "hotels.amenities.gym", fallback: "Зал" },
  { key: "spa", labelKey: "hotels.amenities.spa", fallback: "SPA" },
  { key: "pool_indoor", labelKey: "hotels.amenities.pool_indoor", fallback: "Крытый бассейн" },
  { key: "pool_outdoor", labelKey: "hotels.amenities.pool_outdoor", fallback: "Открытый бассейн" },
  { key: "parking", labelKey: "hotels.amenities.parking", fallback: "Парковка" },
  { key: "bar", labelKey: "hotels.amenities.bar", fallback: "Бар" },
  { key: "elevator", labelKey: "hotels.amenities.elevator", fallback: "Лифт" },
  { key: "soundproof_rooms", labelKey: "hotels.amenities.soundproof_rooms", fallback: "Звукоизоляция" },
  { key: "laundry", labelKey: "hotels.amenities.laundry", fallback: "Прачечная" },
  { key: "late_checkin", labelKey: "hotels.amenities.late_checkin", fallback: "Поздний заезд" },
];

const NEARBY_FIELDS = [
  { key: "metro_m", labelKey: "hotels.nearby.metro_m", fallback: "Метро, м" },
  { key: "supermarket_m", labelKey: "hotels.nearby.supermarket_m", fallback: "Супермаркет, м" },
  { key: "pharmacy_m", labelKey: "hotels.nearby.pharmacy_m", fallback: "Аптека, м" },
  { key: "park_m", labelKey: "hotels.nearby.park_m", fallback: "Парк, м" },
];

const MEDIA_SECTIONS = [
  { key: "room", icon: "🏨", label: "Номера", hints: ["Standard DBL", "Family Room", "санузел", "балкон", "вид из номера"] },
  { key: "food", icon: "🍽", label: "Питание", hints: ["завтрак", "ресторан", "бар", "перекусы", "детское меню"] },
  { key: "beach", icon: "🏖", label: "Пляж", hints: ["песок", "море", "лежаки", "пирс", "волны", "погода"] },
  { key: "pool", icon: "🏊", label: "Бассейн", hints: ["взрослый", "детский", "подогрев", "горки", "pool bar"] },
  { key: "territory", icon: "🌴", label: "Территория", hints: ["зелень", "дорожки", "подсветка", "чистота"] },
  { key: "kids", icon: "👶", label: "Для детей", hints: ["детский клуб", "площадка", "анимация", "питание"] },
  { key: "entertainment", icon: "🎭", label: "Развлечения", hints: ["шоу", "дискотека", "спорт", "живая музыка"] },
  { key: "service", icon: "🛎", label: "Сервис", hints: ["ресепшен", "уборка", "заселение", "персонал"] },
  { key: "location", icon: "📍", label: "Локация", hints: ["магазины", "рестораны", "транспорт", "аэропорт"] },
  { key: "spa", icon: "🧖", label: "SPA", hints: ["хаммам", "массаж", "сауна"] },
  { key: "sport", icon: "🏋", label: "Спорт", hints: ["зал", "теннис", "водный спорт"] },
  { key: "view", icon: "🌅", label: "Виды", hints: ["sea view", "pool view", "garden view"] },
  { key: "warning", icon: "⚠️", label: "Минусы/предупреждения", hints: ["стройка", "шум", "старый ремонт", "очереди"] },
];

const AUDIENCE_OPTIONS = [
  { key: "youth", icon: "🎉", label: "Молодёжь" },
  { key: "families", icon: "👨‍👩‍👧", label: "Семьи с детьми" },
  { key: "couples", icon: "💑", label: "Пары" },
  { key: "seniors", icon: "👴", label: "Пенсионеры" },
  { key: "business", icon: "💼", label: "Бизнес" },
  { key: "solo", icon: "🎒", label: "Solo travel" },
  { key: "luxury", icon: "💎", label: "Люкс" },
  { key: "budget", icon: "💸", label: "Бюджет" },
  { key: "quiet", icon: "🧘", label: "Тихий отдых" },
  { key: "active", icon: "🏄", label: "Активный отдых" },
];

const CON_OPTIONS = [
  { key: "noise", icon: "🔊", label: "Шумно" },
  { key: "old_renovation", icon: "🧱", label: "Старый ремонт" },
  { key: "weak_wifi", icon: "📶", label: "Слабый Wi-Fi" },
  { key: "queues", icon: "🚶", label: "Очереди" },
  { key: "few_sunbeds", icon: "🪑", label: "Мало лежаков" },
  { key: "construction", icon: "🏗", label: "Стройка рядом" },
  { key: "far_sea", icon: "🚶‍♂️", label: "Далеко море" },
  { key: "monotone_food", icon: "🍽", label: "Однообразная еда" },
  { key: "small_beach", icon: "🏖", label: "Маленький пляж" },
  { key: "crowded", icon: "👥", label: "Перегружен" },
];

const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

function optionLabel(list, key) {
  return list.find((x) => x.key === key)?.label || key;
}
function optionIcon(list, key) {
  return list.find((x) => x.key === key)?.icon || "•";
}
function sectionMeta(key) {
  return MEDIA_SECTIONS.find((x) => x.key === key) || MEDIA_SECTIONS[0];
}
function toggleInArray(setter, key) {
  setter((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
}

function AuthorLink({ item }) {
  const { t } = useTranslation();
  const providerId = toInt(item?.author_provider_id) ?? toInt(item?.provider_id) ?? null;
  const readyUrl = item?.author_profile_url || item?.profile_url || null;
  const [name, setName] = useState(
    item?.author_name || item?.authorName || item?.provider_name || t("hotels.inspections.author_fallback", "провайдер")
  );
  const url = readyUrl || (providerId ? `/profile/provider/${providerId}` : null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!providerId) return;
      const tryUrls = [`/api/providers/${providerId}`, `/api/provider/${providerId}`, `/api/companies/${providerId}`, `/api/company/${providerId}`];
      for (const u of tryUrls) {
        try {
          const res = await apiGet(u);
          const profile = res?.provider || res?.company || res?.data || res?.item || res || null;
          const label = profile?.display_name || profile?.company_name || profile?.brand || profile?.name || profile?.title || null;
          if (label && alive) {
            setName(label);
            break;
          }
        } catch {
          // пробуем следующий endpoint
        }
      }
    })();
    return () => { alive = false; };
  }, [providerId]);

  const authorTypeLabel = item?.author_type === "client" ? "клиент" : "поставщик";

  return (
    <div className="text-sm text-gray-500">
      {t("hotels.inspections.author", "Автор")}:{" "}
      {url ? (
        <Link to={url} className="text-blue-700 hover:underline" onClick={(e) => e.stopPropagation()}>
          {name}
        </Link>
      ) : name}
      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
        {authorTypeLabel}
      </span>
    </div>
  );
}

function SectionMediaGrid({ items = [] }) {
  const grouped = useMemo(() => {
    const out = {};
    for (const m of items || []) {
      const key = m.section_key || "room";
      if (!out[key]) out[key] = [];
      out[key].push(m);
    }
    return out;
  }, [items]);

  if (!items.length) return null;

  return (
    <div className="mt-4 space-y-4">
      {Object.entries(grouped).map(([key, list]) => {
        const meta = sectionMeta(key);
        return (
          <div key={key}>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-orange-50 px-3 py-1 text-xs font-black text-orange-700 ring-1 ring-orange-100">
              <span>{meta.icon}</span>
              <span>{meta.label}</span>
              <span className="text-orange-500">{list.length}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {list.map((m) => {
                const src = m.thumbnail_url || m.url;
                return (
                  <a key={m.id || m.url} href={m.url} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-xl border bg-white">
                    {m.media_type === "video" ? (
                      <div className="relative h-32 bg-slate-900">
                        {src ? <img src={src} alt="" className="h-full w-full object-cover opacity-80" /> : null}
                        <div className="absolute inset-0 flex items-center justify-center text-3xl text-white">▶</div>
                      </div>
                    ) : (
                      <img src={src} alt="" className="h-32 w-full object-cover transition group-hover:scale-[1.02]" />
                    )}
                    {(m.caption || (Array.isArray(m.tags) && m.tags.length > 0)) && (
                      <div className="p-2 text-[11px] font-semibold text-slate-700">
                        {m.caption && <div className="line-clamp-2">{m.caption}</div>}
                        {Array.isArray(m.tags) && m.tags.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-slate-500">
                            {m.tags.slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}
                          </div>
                        )}
                      </div>
                    )}
                  </a>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Card({ item, onLike }) {
  const { t } = useTranslation();
  const legacyMedia = Array.isArray(item.media) ? item.media : [];
  const sectionMedia = Array.isArray(item.section_media) ? item.section_media : [];
  const audience = Array.isArray(item.audience_keys) ? item.audience_keys : [];
  const cons = Array.isArray(item.con_keys) ? item.con_keys : [];

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          {(item.hotel_name || item.hotel_city) && (
            <Link
              to={`/hotels/${item.hotel_id}`}
              className="mb-2 inline-flex rounded-full bg-orange-50 px-3 py-1 text-xs font-black text-orange-700 ring-1 ring-orange-100 hover:bg-orange-100"
            >
              🏨 {[item.hotel_name, item.hotel_city].filter(Boolean).join(" · ")}
            </Link>
          )}
          <AuthorLink item={item} />
          {item.title && <div className="mt-1 text-lg font-black text-slate-950">{item.title}</div>}
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-bold">
          {item.recommendation_score ? <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700 ring-1 ring-emerald-100">⭐ {item.recommendation_score}/5</span> : null}
          {item.travel_month ? <span className="rounded-full bg-sky-50 px-3 py-1 text-sky-700 ring-1 ring-sky-100">{MONTHS[item.travel_month - 1]}</span> : null}
          {item.visit_type ? <span className="rounded-full bg-violet-50 px-3 py-1 text-violet-700 ring-1 ring-violet-100">{item.visit_type}</span> : null}
        </div>
      </div>

      <div className="mt-3 whitespace-pre-wrap leading-6 text-slate-800">{item.review}</div>

      <div className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
        {item.pros && <InfoBlock title={t("common.pros", "Плюсы")} text={item.pros} />}
        {item.cons && <InfoBlock title={t("common.cons", "Минусы")} text={item.cons} />}
        {item.features && <InfoBlock title={t("common.features", "Фишки")} text={item.features} />}
      </div>

      {audience.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-slate-400">Кому подходит</div>
          <div className="flex flex-wrap gap-2">
            {audience.map((key) => (
              <span key={key} className="rounded-full bg-slate-50 px-3 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">
                {optionIcon(AUDIENCE_OPTIONS, key)} {optionLabel(AUDIENCE_OPTIONS, key)}
              </span>
            ))}
          </div>
        </div>
      )}

      {cons.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-slate-400">Частые предупреждения</div>
          <div className="flex flex-wrap gap-2">
            {cons.map((key) => (
              <span key={key} className="rounded-full bg-rose-50 px-3 py-1 text-xs font-bold text-rose-700 ring-1 ring-rose-100">
                {optionIcon(CON_OPTIONS, key)} {optionLabel(CON_OPTIONS, key)}
              </span>
            ))}
          </div>
        </div>
      )}

      <SectionMediaGrid items={sectionMedia} />

      {legacyMedia.length > 0 && (
        <div className="mt-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {legacyMedia.filter(isYoutubeUrl).map((u, i) => {
              const vid = getYoutubeId(u);
              return (
                <div key={`yt-${i}`} className="aspect-video w-full overflow-hidden rounded-xl border">
                  <iframe
                    src={`https://www.youtube.com/embed/${vid}`}
                    title={`YouTube video ${vid}`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    className="h-full w-full"
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            {legacyMedia.filter((src) => !isYoutubeUrl(src)).map((src, i) => (
              <img key={`img-${i}`} src={src} alt="" className="h-28 w-full rounded-xl border object-cover" />
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button onClick={() => onLike(item)} className="rounded-xl bg-blue-600 px-3 py-1.5 text-sm font-bold text-white">
          👍 {item.likes ?? 0}
        </button>
        {item.liked_by_me ? <span className="text-xs font-bold text-blue-700">Вы отметили как полезное</span> : null}
      </div>
    </div>
  );
}

function InfoBlock({ title, text }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
      <div className="font-black text-slate-900">{title}</div>
      <div className="mt-1 whitespace-pre-wrap text-slate-700">{text}</div>
    </div>
  );
}

function NewInspectionForm({ hotelId, onCancel, onCreated }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("review");
  const [title, setTitle] = useState("");
  const [review, setReview] = useState("");
  const [pros, setPros] = useState("");
  const [cons, setCons] = useState("");
  const [features, setFeatures] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [scores, setScores] = useState({});
  const [amenities, setAmenities] = useState([]);
  const [nearby, setNearby] = useState({});
  const [audienceKeys, setAudienceKeys] = useState([]);
  const [conKeys, setConKeys] = useState([]);
  const [travelMonth, setTravelMonth] = useState("");
  const [tripType, setTripType] = useState("");
  const [visitType, setVisitType] = useState("");
  const [recommendationScore, setRecommendationScore] = useState(5);
  const [sectionMedia, setSectionMedia] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const tabs = [
    { key: "review", label: "Обзор", icon: "✍️" },
    { key: "media", label: "Фото и видео", icon: "📸" },
    { key: "scores", label: "Оценки", icon: "⭐" },
    { key: "extras", label: "Дополнительно", icon: "🧩" },
  ];

  const toggleAmenity = (k) => setAmenities((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  const addFilesForSection = (sectionKey, files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    setSectionMedia((prev) => [
      ...prev,
      ...list.map((file) => ({
        id: `${Date.now()}-${Math.random()}`,
        file,
        section_key: sectionKey,
        preview: URL.createObjectURL(file),
        caption: "",
        tagsText: "",
        media_type: file.type?.startsWith("video/") ? "video" : "photo",
      })),
    ]);
  };

  const updateMedia = (id, patch) => setSectionMedia((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const removeMedia = (id) => setSectionMedia((prev) => prev.filter((m) => m.id !== id));

  const clamp = (v, lo, hi) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return undefined;
    return Math.min(hi, Math.max(lo, n));
  };

  const normalizeScores = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, clamp(v, 0, 5)]).filter(([, v]) => v !== undefined));
  const normalizeNearby = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, Math.max(0, parseInt(v, 10) || 0)]).filter(([, v]) => Number.isFinite(v)));
  const nonEmpty = (v) => Array.isArray(v) ? (v.length ? v : undefined) : v && typeof v === "object" ? (Object.keys(v).length ? v : undefined) : v || undefined;

  const goToFirstErrorTab = () => {
    if (!review.trim()) {
      setActiveTab("review");
      return true;
    }
    return false;
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (goToFirstErrorTab()) {
      setError(t("errors.write_review", "Напишите общий отзыв"));
      return;
    }
    setSaving(true);
    try {
      const legacyMedia = [];
      const id = getYoutubeId(videoUrl);
      if (id) legacyMedia.push(`https://www.youtube.com/watch?v=${id}`);

      const payload = {
        title: title.trim() || undefined,
        review: review.trim(),
        pros: nonEmpty(pros),
        cons: nonEmpty(cons),
        features: nonEmpty(features),
        media: legacyMedia,
        scores: nonEmpty(normalizeScores(scores)),
        amenities: nonEmpty(amenities),
        nearby: nonEmpty(normalizeNearby(nearby)),
        audience_keys: audienceKeys,
        con_keys: conKeys,
        travel_month: travelMonth ? Number(travelMonth) : undefined,
        trip_type: tripType || undefined,
        visit_type: visitType || undefined,
        recommendation_score: recommendationScore ? Number(recommendationScore) : undefined,
      };

      if (sectionMedia.length > 0) {
        const fd = new FormData();
        Object.entries(payload).forEach(([key, value]) => {
          if (value === undefined || value === null) return;
          fd.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
        });
        fd.append("mediaMeta", JSON.stringify(sectionMedia.map((m, idx) => ({
          section_key: m.section_key,
          caption: m.caption,
          tags: String(m.tagsText || "").split(",").map((x) => x.trim()).filter(Boolean),
          sort_order: idx,
        }))));
        sectionMedia.forEach((m) => fd.append("files", m.file));
        await createInspection(hotelId, fd);
      } else {
        await createInspection(hotelId, payload);
      }

      onCreated?.();
    } catch (e) {
      const st = e?.status || e?.response?.status;
      const code = e?.code || e?.data?.error || e?.response?.data?.error;
      if (st === 401 || st === 403) setError(t("errors.only_authorized", "Нужно войти как клиент или поставщик"));
      else if (st === 409 && code === "already_inspected") setError(t("errors.already_inspected", "Вы уже оставляли инспекцию этого отеля"));
      else if (code === "r2_upload_failed") setError("Ошибка загрузки в R2 storage");
      else setError(t("errors.save_failed", "Не удалось сохранить"));
    } finally {
      setSaving(false);
    }
  };

  const mediaCount = sectionMedia.length;
  const filledScores = Object.values(scores).filter((v) => Number(v) > 0).length;

  return (
    <form onSubmit={submit} className="w-full overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-gradient-to-br from-white via-white to-orange-50/40 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex rounded-full bg-orange-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-orange-600 ring-1 ring-orange-100">
              Hotel Passport
            </div>
            <h2 className="mt-2 text-2xl font-black tracking-[-0.03em] text-slate-950">{t("hotels.inspections.new.title", "Новая инспекция")}</h2>
            <p className="mt-1 max-w-2xl text-sm font-medium leading-6 text-slate-500">Фото, видео, оценки и заметки разделены по шагам, чтобы обзор было проще заполнить и читать.</p>
          </div>

          <div className="grid grid-cols-3 gap-2 self-start text-xs font-bold text-slate-600">
            <div className="rounded-2xl bg-white px-3 py-2 text-center ring-1 ring-slate-200">
              <div className="text-slate-400">Медиа</div>
              <div className="mt-1 text-lg font-black text-slate-950">{mediaCount}</div>
            </div>
            <div className="rounded-2xl bg-white px-3 py-2 text-center ring-1 ring-slate-200">
              <div className="text-slate-400">Оценки</div>
              <div className="mt-1 text-lg font-black text-slate-950">{filledScores}</div>
            </div>
            <div className="rounded-2xl bg-white px-3 py-2 text-center ring-1 ring-slate-200">
              <div className="text-slate-400">Выбрано</div>
              <div className="mt-1 text-lg font-black text-slate-950">{audienceKeys.length + conKeys.length}</div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-2xl px-4 py-2 text-sm font-black transition ${activeTab === tab.key ? "bg-slate-950 text-white shadow-sm" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"}`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-5">
        {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{error}</div>}

        {activeTab === "review" && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <label className="md:col-span-2">
                <div className="mb-1 text-sm font-semibold text-slate-600">Заголовок</div>
                <input className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-50" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например: Хороший семейный отель, но слабый Wi-Fi" />
              </label>
              <label>
                <div className="mb-1 text-sm font-semibold text-slate-600">Месяц поездки</div>
                <select className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-50" value={travelMonth} onChange={(e) => setTravelMonth(e.target.value)}>
                  <option value="">Не указано</option>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </label>
              <label>
                <div className="mb-1 text-sm font-semibold text-slate-600">Рекомендация</div>
                <select className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-50" value={recommendationScore} onChange={(e) => setRecommendationScore(e.target.value)}>
                  <option value="1">⭐ Не рекомендую</option>
                  <option value="2">⭐⭐ Сомнительно</option>
                  <option value="3">⭐⭐⭐ Нормально</option>
                  <option value="4">⭐⭐⭐⭐ Рекомендую</option>
                  <option value="5">⭐⭐⭐⭐⭐ Обязательно вернусь</option>
                </select>
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label>
                <div className="mb-1 text-sm font-semibold text-slate-600">Тип визита</div>
                <select className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-50" value={visitType} onChange={(e) => setVisitType(e.target.value)}>
                  <option value="">Не указано</option>
                  <option value="stayed">Жил в отеле</option>
                  <option value="inspection">Осмотр / inspection</option>
                  <option value="fam_trip">Рекламный тур</option>
                </select>
              </label>
              <label>
                <div className="mb-1 text-sm font-semibold text-slate-600">Тип поездки</div>
                <select className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-50" value={tripType} onChange={(e) => setTripType(e.target.value)}>
                  <option value="">Не указано</option>
                  <option value="family">Семья</option>
                  <option value="couple">Пара</option>
                  <option value="honeymoon">Медовый месяц</option>
                  <option value="business">Бизнес</option>
                  <option value="solo">Solo</option>
                  <option value="agent_inspection">Инфотур / рекламник</option>
                </select>
              </label>
            </div>

            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-600">{t("hotels.inspections.new.review_label", "Общий отзыв")} *</label>
              <textarea className="min-h-[130px] w-full rounded-xl border border-slate-200 px-3 py-2 outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-50" value={review} onChange={(e) => setReview(e.target.value)} />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <TextAreaBlock label={t("hotels.inspections.new.pros", "Плюсы")} value={pros} onChange={setPros} />
              <TextAreaBlock label={t("hotels.inspections.new.cons", "Минусы")} value={cons} onChange={setCons} />
              <TextAreaBlock label={t("hotels.inspections.new.features", "Фишки/советы")} value={features} onChange={setFeatures} />
            </div>

            <CheckGroup title="Кому подходит этот отель" options={AUDIENCE_OPTIONS} value={audienceKeys} onToggle={(k) => toggleInArray(setAudienceKeys, k)} />
            <CheckGroup title="Минусы / предупреждения" options={CON_OPTIONS} value={conKeys} onToggle={(k) => toggleInArray(setConKeys, k)} danger />
          </div>
        )}

        {activeTab === "media" && (
          <div>
            <div className="mb-4 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
              <div className="text-base font-black text-slate-950">Фото и видео по зонам отеля</div>
              <div className="mt-1 text-sm font-medium text-slate-500">Загружайте материалы отдельно по зонам: номера, питание, пляж, бассейн, SPA и минусы. Так инспекция будет полезнее.</div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {MEDIA_SECTIONS.map((section) => (
                <div key={section.key} className="rounded-2xl border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-black text-slate-900">{section.icon} {section.label}</div>
                      <div className="mt-1 text-xs text-slate-500">{section.hints.join(" · ")}</div>
                    </div>
                    <label className="shrink-0 cursor-pointer rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white">
                      Загрузить
                      <input type="file" multiple accept="image/*,video/*" className="sr-only" onChange={(e) => { addFilesForSection(section.key, e.target.files); e.target.value = ""; }} />
                    </label>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {sectionMedia.filter((m) => m.section_key === section.key).map((m) => (
                      <div key={m.id} className="rounded-xl border bg-slate-50 p-2">
                        {m.media_type === "video" ? <video src={m.preview} className="h-28 w-full rounded-lg object-cover" controls /> : <img src={m.preview} alt="" className="h-28 w-full rounded-lg object-cover" />}
                        <input className="mt-2 w-full rounded-lg border px-2 py-1 text-xs" value={m.caption} onChange={(e) => updateMedia(m.id, { caption: e.target.value })} placeholder="Подпись: Standard DBL, завтрак, песок..." />
                        <input className="mt-1 w-full rounded-lg border px-2 py-1 text-xs" value={m.tagsText} onChange={(e) => updateMedia(m.id, { tagsText: e.target.value })} placeholder="Теги через запятую" />
                        <button type="button" onClick={() => removeMedia(m.id)} className="mt-1 text-xs font-bold text-rose-600">Удалить</button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "scores" && (
          <div>
            <div className="mb-4 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
              <div className="text-base font-black text-slate-950">Оценки (0–5)</div>
              <div className="mt-1 text-sm font-medium text-slate-500">Оценки помогают быстро понять, кому реально подходит отель.</div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {SCORE_FIELDS.map((f) => (
                <label key={f.key} className="block rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
                  <div className="mb-1 flex items-center justify-between gap-3 text-sm font-semibold text-slate-600">
                    <span>{t(f.labelKey, f.fallback)}</span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-black text-slate-700 ring-1 ring-slate-200">{scores[f.key] ?? 0}</span>
                  </div>
                  <input type="range" min="0" max="5" step="0.5" value={scores[f.key] ?? 0} onChange={(e) => setScores((s) => ({ ...s, [f.key]: Number(e.target.value) }))} className="w-full" />
                </label>
              ))}
            </div>
          </div>
        )}

        {activeTab === "extras" && (
          <div className="space-y-5">
            <div>
              <div className="text-base font-black text-slate-950">{t("hotels.inspections.new.amenities_title", "Удобства")}</div>
              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">
                {AMENITIES.map((a) => (
                  <label key={a.key} className="inline-flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-100">
                    <input type="checkbox" checked={amenities.includes(a.key)} onChange={() => toggleAmenity(a.key)} />
                    <span>{t(a.labelKey, a.fallback)}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <div className="text-base font-black text-slate-950">{t("hotels.inspections.new.nearby_title", "Рядом (дистанции)")}</div>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                {NEARBY_FIELDS.map((n) => (
                  <label key={n.key} className="block">
                    <div className="mb-1 text-sm font-semibold text-slate-600">{t(n.labelKey, n.fallback)}</div>
                    <input type="number" min="0" step="10" value={nearby[n.key] ?? ""} onChange={(e) => setNearby((v) => ({ ...v, [n.key]: e.target.value === "" ? null : Number(e.target.value) }))} className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-50" placeholder="м" />
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-600">{t("hotels.inspections.new.video_label", "Видео (ссылка на YouTube)")}</label>
              <input type="url" inputMode="url" placeholder="https://youtu.be/…" className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-50" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} />
              {!!videoUrl && !isYoutubeUrl(videoUrl) && <div className="mt-1 text-xs font-bold text-rose-700">{t("hotels.inspections.new.video_invalid", "Похоже, это не ссылка на YouTube")}</div>}
            </div>
          </div>
        )}
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white/95 p-4 backdrop-blur">
        <div className="text-xs font-semibold text-slate-500">
          Минимум: общий отзыв. Остальное можно заполнить для более полезного Hotel Passport.
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2 font-bold text-slate-700 hover:bg-slate-50">{t("common.cancel", "Отмена")}</button>
          <button type="submit" disabled={saving} className={`rounded-xl px-5 py-2 font-bold text-white ${saving ? "bg-gray-400" : "bg-orange-600 hover:bg-orange-700"}`}>
            {saving ? t("hotels.inspections.new.saving", "Сохранение…") : t("hotels.inspections.new.save", "Сохранить")}
          </button>
        </div>
      </div>
    </form>
  );
}

function TextAreaBlock({ label, value, onChange }) {
  return (
    <label>
      <div className="mb-1 text-sm font-semibold text-slate-600">{label}</div>
      <textarea className="min-h-[90px] w-full rounded-xl border px-3 py-2" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function CheckGroup({ title, options, value, onToggle, danger = false }) {
  return (
    <div className="mt-5">
      <div className="text-base font-black text-slate-950">{title}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => {
          const active = value.includes(o.key);
          return (
            <button key={o.key} type="button" onClick={() => onToggle(o.key)} className={`rounded-full px-3 py-1.5 text-xs font-bold ring-1 ${active ? (danger ? "bg-rose-600 text-white ring-rose-600" : "bg-slate-900 text-white ring-slate-900") : "bg-white text-slate-700 ring-slate-200"}`}>
              {o.icon} {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function HotelInspections() {
  const { t } = useTranslation();
  const { hotelId } = useParams();
  const globalMode = !hotelId;
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const isNew = search.get("new") === "1";
  const [hotel, setHotel] = useState(null);
  const [items, setItems] = useState([]);
  const [sort, setSort] = useState("top");
  const [cityFilter, setCityFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [audienceFilter, setAudienceFilter] = useState("");

  useEffect(() => {
    if (globalMode) {
      setHotel({ name: "Hotel Passport" });
      return;
    }

    (async () => {
      try {
        setHotel(await getHotel(hotelId));
      } catch {
        setHotel(null);
      }
    })();
  }, [hotelId, globalMode]);

  const load = async () => {
    try {
      let res;

      if (globalMode) {
        res = await apiGet(`/api/hotels/inspections?sort=${sort}`);
      } else {
        res = await listInspections(hotelId, { sort });
      }

      const norm = (res.items || []).map((x) => ({
        ...x,
        media: Array.isArray(x.media) ? x.media : typeof x.media === "string" ? JSON.parse(x.media || "[]") : [],
        section_media: Array.isArray(x.section_media) ? x.section_media : [],
        audience_keys: Array.isArray(x.audience_keys) ? x.audience_keys : [],
        con_keys: Array.isArray(x.con_keys) ? x.con_keys : [],
      }));

      setItems(norm);
    } catch {
      setItems([]);
    }
  };

  useEffect(() => {
    if (!isNew) load();
  }, [hotelId, sort, isNew, globalMode]);

  const cityOptions = useMemo(() => {
    const set = new Set();
    items.forEach((item) => {
      const city = String(item.hotel_city || item.city || "").trim();
      if (city) set.add(city);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const visibleItems = useMemo(() => {
    return items.filter((item) => {
      if (cityFilter) {
        const city = String(item.hotel_city || item.city || "").toLowerCase();
        if (city !== cityFilter.toLowerCase()) return false;
      }

      if (monthFilter) {
        if (Number(item.travel_month) !== Number(monthFilter)) return false;
      }

      if (audienceFilter) {
        const audience = Array.isArray(item.audience_keys) ? item.audience_keys : [];
        if (!audience.includes(audienceFilter)) return false;
      }

      return true;
    });
  }, [items, cityFilter, monthFilter, audienceFilter]);

  const passportStats = useMemo(() => {
    const rated = items
      .map((item) => Number(item.recommendation_score))
      .filter((n) => Number.isFinite(n) && n > 0);

    const avg = rated.length
      ? (rated.reduce((sum, n) => sum + n, 0) / rated.length).toFixed(1)
      : null;

    const audienceCount = {};
    items.forEach((item) => {
      (Array.isArray(item.audience_keys) ? item.audience_keys : []).forEach((key) => {
        audienceCount[key] = (audienceCount[key] || 0) + 1;
      });
    });

    const topAudienceKey = Object.entries(audienceCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    const latestMonth = items
      .map((item) => Number(item.travel_month))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= 12)
      .sort((a, b) => b - a)[0] || null;

    const mediaCount = items.reduce((sum, item) => {
      const sectionMedia = Array.isArray(item.section_media) ? item.section_media.length : 0;
      const legacyMedia = Array.isArray(item.media) ? item.media.length : 0;
      return sum + sectionMedia + legacyMedia;
    }, 0);

    return {
      avg,
      topAudience: topAudienceKey ? `${optionIcon(AUDIENCE_OPTIONS, topAudienceKey)} ${optionLabel(AUDIENCE_OPTIONS, topAudienceKey)}` : "—",
      latestVisit: latestMonth ? MONTHS[latestMonth - 1] : "—",
      mediaCount,
    };
  }, [items]);

  const resetFilters = () => {
    setCityFilter("");
    setMonthFilter("");
    setAudienceFilter("");
  };

  const onLike = async (item) => {
    try {
      const res = await likeInspection(item.id);
      setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, likes: res?.likes ?? x.likes, liked_by_me: res?.liked ?? x.liked_by_me } : x)));
    } catch {}
  };

  const handleCreated = () => {
    tSuccess(t("hotels.inspections.created_toast", "Инспекция добавлена"));
    navigate(`/hotels/${hotelId}/inspections`);
  };

  return (
    <div className="mx-auto max-w-6xl p-4">
      <div className="mb-5 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-gradient-to-br from-white via-white to-orange-50/60 p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="inline-flex rounded-full bg-orange-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-orange-600 ring-1 ring-orange-100">
                HOTEL PASSPORT
              </div>

              <div className="mt-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                {globalMode ? "Все инспекции отелей" : t("hotels.inspections.hotel_label", "Отель")}
              </div>

              <div className="mt-1 truncate text-3xl font-black tracking-[-0.04em] text-slate-950">
                {hotel?.name || "…"}
              </div>

              {(hotel?.city || hotel?.country) && (
                <div className="mt-1 text-sm font-semibold text-slate-500">
                  {[hotel?.city, hotel?.country].filter(Boolean).join(", ")}
                </div>
              )}

              {!isNew && (
                <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-slate-600">
                  <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">
                    🏨 {items.length} инспекций
                  </span>
                  <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">
                    ⭐ {passportStats.avg ? `${passportStats.avg}/5` : "нет рейтинга"}
                  </span>
                  <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">
                    📸 {passportStats.mediaCount} медиа
                  </span>
                </div>
              )}
            </div>

            {!isNew && (
              <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4 lg:w-auto">
                <div className="rounded-2xl border border-orange-100 bg-white/90 p-3 shadow-sm">
                  <div className="text-[11px] font-black uppercase tracking-[0.12em] text-orange-500">
                    Инспекций
                  </div>
                  <div className="mt-2 text-2xl font-black text-slate-950">
                    {items.length}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm">
                  <div className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
                    Рейтинг
                  </div>
                  <div className="mt-2 text-2xl font-black text-slate-950">
                    {passportStats.avg ? passportStats.avg : "—"}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm">
                  <div className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
                    Аудитория
                  </div>
                  <div className="mt-2 truncate text-sm font-black text-slate-950">
                    {passportStats.topAudience}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm">
                  <div className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
                    Последний визит
                  </div>
                  <div className="mt-2 truncate text-sm font-black text-slate-950">
                    {passportStats.latestVisit}
                  </div>
                </div>
              </div>
            )}

            {isNew && !globalMode && (
              <div className="flex shrink-0 flex-wrap items-start gap-2 pt-1">
                <Link
                  to={`/hotels/${hotelId}/inspections`}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                >
                  ← К инспекциям
                </Link>

                <Link
                  to={`/hotels/${hotelId}`}
                  className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-orange-600"
                >
                  🏨 К отелю
                </Link>
              </div>
            )}
          </div>
        </div>

        {!isNew && (
          <div className="p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-50"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="top">{t("hotels.inspections.sort.topOption", "Сначала с большим числом лайков")}</option>
                  <option value="new">{t("hotels.inspections.sort.newOption", "Сначала новые")}</option>
                </select>

                {globalMode && (
                  <select
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-50"
                    value={cityFilter}
                    onChange={(e) => setCityFilter(e.target.value)}
                  >
                    <option value="">Все города</option>
                    {cityOptions.map((city) => <option key={city} value={city}>{city}</option>)}
                  </select>
                )}

                <select
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-50"
                  value={monthFilter}
                  onChange={(e) => setMonthFilter(e.target.value)}
                >
                  <option value="">Все месяцы</option>
                  {MONTHS.map((month, idx) => <option key={month} value={idx + 1}>{month}</option>)}
                </select>

                <select
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-50"
                  value={audienceFilter}
                  onChange={(e) => setAudienceFilter(e.target.value)}
                >
                  <option value="">Для кого подходит</option>
                  {AUDIENCE_OPTIONS.map((item) => <option key={item.key} value={item.key}>{item.icon} {item.label}</option>)}
                </select>

                <button
                  type="button"
                  onClick={resetFilters}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
                >
                  Сбросить
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {!globalMode && (
                  <Link
                    to={`/hotels/${hotelId}/inspections?new=1`}
                    className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-orange-600"
                  >
                    ➕ Добавить обзор
                  </Link>
                )}

                {globalMode && (
                  <Link
                    to="/hotels"
                    className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-orange-600"
                  >
                    ➕ Выбрать отель
                  </Link>
                )}

                {!globalMode && (
                  <Link
                    to={`/hotels/${hotelId}`}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                  >
                    Назад к отелю
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {isNew ? (
        <div className="px-6 -mt-2">
          <NewInspectionForm
            hotelId={hotelId}
            onCancel={() => navigate(`/hotels/${hotelId}/inspections`)}
            onCreated={handleCreated}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {visibleItems.map((it) => <Card key={it.id} item={it} onLike={onLike} />)}

          {visibleItems.length === 0 && (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-3xl ring-1 ring-orange-100">
                🏨
              </div>

              <div className="mt-5 text-2xl font-black text-slate-950">
                {items.length > 0 ? "По фильтрам ничего не найдено" : t("hotels.inspections.empty", "Инспекций пока нет")}
              </div>

              <div className="mx-auto mt-2 max-w-xl text-sm font-medium text-slate-500">
                {items.length > 0
                  ? "Сбросьте фильтры или выберите другие значения."
                  : globalMode
                    ? "Пока никто не оставил обзор отеля. Выберите отель и добавьте первую инспекцию."
                    : "Первый обзор поможет туристам, агентам и поставщикам лучше понять реальное состояние этого отеля."}
              </div>

              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {items.length > 0 ? (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="rounded-xl border border-slate-200 px-5 py-3 font-bold text-slate-700 transition hover:bg-slate-50"
                  >
                    Сбросить фильтры
                  </button>
                ) : globalMode ? (
                  <Link
                    to="/hotels"
                    className="rounded-xl bg-orange-500 px-6 py-3 font-bold text-white transition hover:bg-orange-600"
                  >
                    ➕ Выбрать отель
                  </Link>
                ) : (
                  <Link
                    to={`/hotels/${hotelId}/inspections?new=1`}
                    className="rounded-xl bg-orange-500 px-6 py-3 font-bold text-white transition hover:bg-orange-600"
                  >
                    ➕ Добавить обзор
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
