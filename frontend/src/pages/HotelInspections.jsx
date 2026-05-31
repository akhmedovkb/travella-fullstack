// frontend/src/pages/HotelInspections.jsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  createInspection,
  createInspectionComment,
  deleteInspection,
  moderateInspection,
  moderateInspectionComment,
  reportInspection,
  reportInspectionComment,
  updateInspection,
  getHotel,
  likeInspection,
  listAllInspections,
  listInspectionComments,
  listInspections,
} from "../api/hotels";
import { apiGet } from "../api";
import { useTranslation } from "react-i18next";
import { tSuccess } from "../shared/toast";

const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const MEDIA_SECTIONS = [
  { key: "room", icon: "🏨", label: "Номера", short: "Номера", hints: ["Standard DBL", "Family Room", "санузел", "балкон", "вид"] },
  { key: "food", icon: "🍽", label: "Питание", short: "Питание", hints: ["завтрак", "ресторан", "бар", "перекусы", "детское меню"] },
  { key: "beach", icon: "🏖", label: "Пляж", short: "Пляж", hints: ["песок", "море", "лежаки", "пирс", "погода"] },
  { key: "pool", icon: "🏊", label: "Бассейн", short: "Бассейн", hints: ["взрослый", "детский", "подогрев", "горки"] },
  { key: "territory", icon: "🌴", label: "Территория", short: "Территория", hints: ["зелень", "дорожки", "чистота"] },
  { key: "kids", icon: "👶", label: "Для детей", short: "Дети", hints: ["детский клуб", "площадка", "анимация"] },
  { key: "entertainment", icon: "🎭", label: "Развлечения", short: "Шоу", hints: ["шоу", "дискотека", "спорт"] },
  { key: "service", icon: "🛎", label: "Сервис", short: "Сервис", hints: ["ресепшен", "уборка", "персонал"] },
  { key: "location", icon: "📍", label: "Локация", short: "Локация", hints: ["магазины", "транспорт", "аэропорт"] },
  { key: "spa", icon: "🧖", label: "SPA", short: "SPA", hints: ["хаммам", "массаж", "сауна"] },
  { key: "sport", icon: "🏋", label: "Спорт", short: "Спорт", hints: ["зал", "теннис", "водный спорт"] },
  { key: "view", icon: "🌅", label: "Виды", short: "Виды", hints: ["sea view", "pool view", "garden view"] },
  { key: "warning", icon: "⚠️", label: "Минусы/предупреждения", short: "Минусы", hints: ["стройка", "шум", "очереди"] },
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
  { key: "weak_wifi", icon: "📶", label: "Слабый Wi‑Fi" },
  { key: "queues", icon: "🚶", label: "Очереди" },
  { key: "few_sunbeds", icon: "🪑", label: "Мало лежаков" },
  { key: "construction", icon: "🏗", label: "Стройка рядом" },
  { key: "far_sea", icon: "🚶‍♂️", label: "Далеко море" },
  { key: "monotone_food", icon: "🍽", label: "Однообразная еда" },
  { key: "small_beach", icon: "🏖", label: "Маленький пляж" },
  { key: "crowded", icon: "👥", label: "Перегружен" },
];

const VISIT_TYPES = [
  { key: "stayed", icon: "🛏", label: "Жил в отеле" },
  { key: "agent_inspection", icon: "🧳", label: "Инспекция агента" },
  { key: "fam_trip", icon: "✈️", label: "Рекламный тур" },
  { key: "site_visit", icon: "👀", label: "Осмотр отеля" },
  { key: "client_review", icon: "💬", label: "Клиентский отзыв" },
  { key: "other", icon: "📌", label: "Другое" },
];

const SCORE_FIELDS = [
  { key: "quiet_level", label: "Тишина" },
  { key: "family_score", label: "Семьи" },
  { key: "infra_score", label: "Инфраструктура" },
  { key: "nightlife_score", label: "Ночная жизнь" },
  { key: "activity_score", label: "Активности" },
  { key: "wellness_score", label: "Wellness" },
  { key: "business_score", label: "Бизнес" },
  { key: "value_score", label: "Цена/качество" },
  { key: "access_score", label: "Доступность" },
];

const AMENITIES = [
  { key: "crib", label: "Детская кроватка" },
  { key: "kids_pool", label: "Детский бассейн" },
  { key: "kids_club", label: "Детский клуб" },
  { key: "kitchenette", label: "Кухонный уголок" },
  { key: "gym", label: "Зал" },
  { key: "spa", label: "SPA" },
  { key: "pool_indoor", label: "Крытый бассейн" },
  { key: "pool_outdoor", label: "Открытый бассейн" },
  { key: "parking", label: "Парковка" },
  { key: "bar", label: "Бар" },
  { key: "elevator", label: "Лифт" },
  { key: "soundproof_rooms", label: "Звукоизоляция" },
  { key: "laundry", label: "Прачечная" },
  { key: "late_checkin", label: "Поздний заезд" },
];

const NEARBY_FIELDS = [
  { key: "metro_m", label: "Метро, м" },
  { key: "supermarket_m", label: "Супермаркет, м" },
  { key: "pharmacy_m", label: "Аптека, м" },
  { key: "park_m", label: "Парк, м" },
];

const MAX_INSPECTION_FILES = 13;
const MAX_INSPECTION_TOTAL_BYTES = 45 * 1024 * 1024;
const MAX_INSPECTION_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_INSPECTION_VIDEO_BYTES = 25 * 1024 * 1024;

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return "0 MB";
  const mb = n / (1024 * 1024);
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function validateInspectionFiles(files = []) {
  const list = Array.from(files || []);
  if (list.length > MAX_INSPECTION_FILES) {
    return `Можно загрузить максимум ${MAX_INSPECTION_FILES} файлов.`;
  }

  const total = list.reduce((sum, file) => sum + Number(file?.size || 0), 0);
  if (total > MAX_INSPECTION_TOTAL_BYTES) {
    return `Слишком большой общий объём медиа: ${formatBytes(total)}. Максимум: ${formatBytes(MAX_INSPECTION_TOTAL_BYTES)}. Уменьшите фото/видео или загрузите меньше файлов.`;
  }

  for (const file of list) {
    const size = Number(file?.size || 0);
    const type = String(file?.type || "").toLowerCase();
    const name = file?.name || "файл";

    if (type.startsWith("image/") && size > MAX_INSPECTION_IMAGE_BYTES) {
      return `Фото “${name}” слишком большое: ${formatBytes(size)}. Максимум для фото: ${formatBytes(MAX_INSPECTION_IMAGE_BYTES)}.`;
    }

    if (type.startsWith("video/") && size > MAX_INSPECTION_VIDEO_BYTES) {
      return `Видео “${name}” слишком большое: ${formatBytes(size)}. Максимум для видео: ${formatBytes(MAX_INSPECTION_VIDEO_BYTES)}.`;
    }
  }

  return "";
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function arr(v) {
  if (Array.isArray(v)) return v;
  if (!v) return [];
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function obj(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

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
function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function avgScore(scores = {}) {
  const values = Object.values(obj(scores)).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
function getBestMedia(item) {
  const media = arr(item?.section_media);
  const legacy = arr(item?.media).map((url) => ({ url, thumbnail_url: url, media_type: "photo", section_key: "room" }));
  const all = [...media, ...legacy].filter((m) => m?.url || m?.thumbnail_url);
  return all[0] || null;
}
function parseFilterFromSearch(params) {
  return {
    sort: params.get("sort") || "top",
    city: params.get("city") || "",
    month: params.get("month") || "",
    audience: params.get("audience") || "",
    visit_type: params.get("visit_type") || "",
    min_score: params.get("min_score") || "",
    has_media: params.get("has_media") === "1",
  };
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

  const type = item?.author_type === "client" ? "клиент" : "поставщик";
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-500">
      <span>Автор:</span>
      {url ? (
        <Link to={url} className="text-blue-700 hover:underline" onClick={(e) => e.stopPropagation()}>{name}</Link>
      ) : <span>{name}</span>}
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-600">{type}</span>
    </div>
  );
}

function TrustBadge({ visitType, authorType }) {
  const meta = VISIT_TYPES.find((x) => x.key === visitType) || (authorType === "client" ? VISIT_TYPES[4] : VISIT_TYPES[1]);
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-100">
      <span>{meta.icon}</span>
      <span>{meta.label}</span>
    </span>
  );
}

function InspectionStatusBadge({ status, moderationStatus, rejectionReason }) {
  const s = String(status || moderationStatus || "approved").toLowerCase();
  const map = {
    pending: ["⏳", "На модерации", "bg-amber-50 text-amber-700 ring-amber-100"],
    draft: ["📝", "Черновик", "bg-slate-50 text-slate-600 ring-slate-200"],
    approved: ["✅", "Опубликовано", "bg-emerald-50 text-emerald-700 ring-emerald-100"],
    published: ["✅", "Опубликовано", "bg-emerald-50 text-emerald-700 ring-emerald-100"],
    rejected: ["⛔", rejectionReason || "Отклонено", "bg-red-50 text-red-700 ring-red-100"],
    hidden: ["🙈", "Скрыто", "bg-slate-100 text-slate-700 ring-slate-200"],
    deleted: ["🗑", "Удалено", "bg-red-50 text-red-700 ring-red-100"],
  };
  const [icon, label, cls] = map[s] || map.approved;
  return <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-black ring-1 ${cls}`}>{icon} {label}</span>;
}

function VerifiedVisitBadge({ item }) {
  if (!item?.verified_visit && !arr(item?.proof_media).length) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-[11px] font-black text-blue-700 ring-1 ring-blue-100">
      🛡 Проверенный визит
    </span>
  );
}

function Chip({ active, children, onClick, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-black ring-1 transition ${
        active
          ? "bg-orange-500 text-white ring-orange-500 shadow-sm"
          : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
      } ${className}`}
    >
      {children}
    </button>
  );
}

function SectionMediaTabs({ items = [] }) {
  const normalized = arr(items);
  const grouped = useMemo(() => {
    const out = {};
    for (const m of normalized) {
      const key = m.section_key || "room";
      if (!out[key]) out[key] = [];
      out[key].push(m);
    }
    return out;
  }, [normalized]);
  const keys = Object.keys(grouped);
  const [active, setActive] = useState(keys[0] || "room");

  useEffect(() => {
    if (keys.length && !keys.includes(active)) setActive(keys[0]);
  }, [active, keys]);

  if (!keys.length) return null;
  const activeList = grouped[active] || [];

  return (
    <div className="mt-4 rounded-3xl border border-slate-100 bg-slate-50/70 p-3">
      <div className="flex gap-2 overflow-x-auto pb-2">
        {keys.map((key) => {
          const meta = sectionMeta(key);
          return (
            <Chip key={key} active={active === key} onClick={() => setActive(key)} className="shrink-0">
              {meta.icon} {meta.short || meta.label} <span className="opacity-70">{grouped[key].length}</span>
            </Chip>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {activeList.map((m) => {
          const src = m.thumbnail_url || m.url;
          return (
            <a key={m.id || m.url} href={m.url} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-2xl border border-white bg-white shadow-sm">
              {m.media_type === "video" ? (
                <div className="relative h-36 bg-slate-900">
                  {src ? <img src={src} alt="" className="h-full w-full object-cover opacity-80 transition group-hover:scale-[1.03]" /> : null}
                  <div className="absolute inset-0 flex items-center justify-center text-4xl text-white">▶</div>
                </div>
              ) : (
                <img src={src} alt="" className="h-36 w-full object-cover transition group-hover:scale-[1.03]" />
              )}
              {(m.caption || arr(m.tags).length > 0) && (
                <div className="p-2 text-xs font-semibold text-slate-600">
                  {m.caption && <div className="line-clamp-2">{m.caption}</div>}
                  {arr(m.tags).length > 0 && <div className="mt-1 truncate text-[11px] text-slate-400">#{arr(m.tags).join(" #")}</div>}
                </div>
              )}
            </a>
          );
        })}
      </div>
    </div>
  );
}

function ScoreBars({ scores }) {
  const parsed = obj(scores);
  const filled = SCORE_FIELDS.filter((f) => Number(parsed[f.key]) > 0);
  if (!filled.length) return null;
  return (
    <div className="mt-4 rounded-3xl border border-slate-100 bg-white p-4">
      <div className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-slate-400">Оценки по деталям</div>
      <div className="grid gap-3 md:grid-cols-2">
        {filled.map((f) => {
          const value = Math.max(1, Math.min(5, Number(parsed[f.key]) || 0));
          return (
            <div key={f.key}>
              <div className="mb-1 flex justify-between text-xs font-black text-slate-600"><span>{f.label}</span><span>{value}/5</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-orange-400" style={{ width: `${value * 20}%` }} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CommentsPanel({ inspectionId, initialCount = 0 }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const count = items.length || Number(initialCount || 0);

  useEffect(() => {
    let alive = true;
    if (!open) return () => { alive = false; };
    (async () => {
      setLoading(true);
      try {
        const data = await listInspectionComments(inspectionId);
        if (alive) setItems(arr(data?.items));
      } catch {
        if (alive) setItems([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [open, inspectionId]);

  async function submit() {
    const body = text.trim();
    if (body.length < 2 || submitting) return;
    setSubmitting(true);
    try {
      const res = await createInspectionComment(inspectionId, body);
      if (res?.item) setItems((prev) => [...prev, res.item]);
      setText("");
      tSuccess("Комментарий добавлен");
    } catch (e) {
      alert(e?.message || "Не удалось добавить комментарий");
    } finally {
      setSubmitting(false);
    }
  }

  async function reportComment(commentId) {
    const reason = window.prompt("Почему жалуетесь на комментарий?", "Некорректный комментарий");
    if (!reason) return;
    try {
      await reportInspectionComment(commentId, { reason: "comment_report", text: reason });
      tSuccess("Жалоба отправлена на модерацию");
    } catch (e) {
      alert(e?.message || "Не удалось отправить жалобу");
    }
  }

  async function hideComment(commentId) {
    if (!window.confirm("Скрыть комментарий?")) return;
    try {
      await moderateInspectionComment(commentId, { status: "hidden" });
      setItems((prev) => prev.filter((x) => x.id !== commentId));
      tSuccess("Комментарий скрыт");
    } catch (e) {
      alert(e?.message || "Не удалось скрыть комментарий");
    }
  }

  return (
    <div className="mt-4 rounded-3xl border border-slate-100 bg-slate-50/70 p-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <span className="text-sm font-black text-slate-800">💬 Комментарии</span>
        <span className="rounded-full bg-white px-2 py-1 text-xs font-black text-slate-500 ring-1 ring-slate-200">{count}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {loading ? <div className="text-sm font-semibold text-slate-400">Загружаем комментарии…</div> : null}
          {!loading && items.length === 0 ? <div className="text-sm font-semibold text-slate-400">Комментариев пока нет.</div> : null}
          {items.map((c) => (
            <div key={c.id} className="rounded-2xl bg-white p-3 ring-1 ring-slate-100">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-black text-slate-800">{c.author_name || "Travella"}</div>
                <div className="text-[11px] font-bold text-slate-400">{formatDate(c.created_at)}</div>
              </div>
              <div className="mt-1 whitespace-pre-wrap text-sm font-medium leading-5 text-slate-600">{c.text}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => reportComment(c.id)} className="text-[11px] font-black text-amber-600 hover:underline">Пожаловаться</button>
                {c.can_moderate && <button type="button" onClick={() => hideComment(c.id)} className="text-[11px] font-black text-red-600 hover:underline">Скрыть</button>}
              </div>
            </div>
          ))}
          <div className="flex flex-col gap-2 md:flex-row">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Добавить комментарий к обзору…"
              className="min-h-[44px] flex-1 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
            />
            <button type="button" onClick={submit} disabled={submitting || text.trim().length < 2} className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-black text-white disabled:opacity-50">
              Отправить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function InspectionCard({ item, onLiked, onEdit, onDeleted, onModerated, onReported }) {
  const hero = getBestMedia(item);
  const score = Number(item?.recommendation_score || avgScore(item?.scores) || 0);
  const audience = arr(item?.audience_keys);
  const cons = arr(item?.con_keys);
  const month = toInt(item?.travel_month);
  const canManage = Boolean(item?.can_manage);
  const canModerate = Boolean(item?.can_moderate);

  return (
    <article className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="relative bg-slate-100">
        {hero ? (
          hero.media_type === "video" ? (
            <a href={hero.url} target="_blank" rel="noreferrer" className="block">
              <img src={hero.thumbnail_url || hero.url} alt="" className="h-64 w-full object-cover" />
              <div className="absolute inset-0 flex items-center justify-center bg-black/10 text-5xl text-white">▶</div>
            </a>
          ) : <img src={hero.thumbnail_url || hero.url} alt="" className="h-64 w-full object-cover" />
        ) : (
          <div className="flex h-48 items-center justify-center bg-gradient-to-br from-orange-50 to-slate-100 text-6xl">🏨</div>
        )}
        <div className="absolute left-3 top-3 flex flex-wrap gap-2">
          <TrustBadge visitType={item.visit_type} authorType={item.author_type} />
          <VerifiedVisitBadge item={item} />
          <InspectionStatusBadge status={item.status} moderationStatus={item.moderation_status} rejectionReason={item.rejection_reason} />
          {month ? <span className="rounded-full bg-white/95 px-3 py-1 text-[11px] font-black text-slate-700 ring-1 ring-white/80">{MONTHS[month - 1]}</span> : null}
        </div>
        <div className="absolute bottom-3 right-3 rounded-2xl bg-white/95 px-4 py-2 text-right shadow-sm ring-1 ring-white/80">
          <div className="text-2xl font-black text-slate-950">{score ? score.toFixed(1) : "—"}</div>
          <div className="text-[11px] font-black text-slate-400">рекомендация</div>
        </div>
      </div>

      <div className="p-4 md:p-5">
        {item.hotel_name ? (
          <Link to={`/hotels/${item.hotel_id}`} className="text-sm font-black text-orange-600 hover:underline">
            {item.hotel_name}{item.hotel_city ? ` · ${item.hotel_city}` : ""}
          </Link>
        ) : null}
        <h2 className="mt-1 text-xl font-black tracking-[-0.03em] text-slate-950">
          {item.title || "Живой обзор отеля"}
        </h2>
        <div className="mt-2"><AuthorLink item={item} /></div>
        <div className="mt-1 text-xs font-bold text-slate-400">{formatDate(item.created_at)}</div>

        {audience.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-slate-400">Кому подходит</div>
            <div className="flex flex-wrap gap-2">
              {audience.map((key) => <span key={key} className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700 ring-1 ring-blue-100">{optionIcon(AUDIENCE_OPTIONS, key)} {optionLabel(AUDIENCE_OPTIONS, key)}</span>)}
            </div>
          </div>
        )}

        {item.review && <p className="mt-4 whitespace-pre-wrap text-sm font-medium leading-6 text-slate-700">{item.review}</p>}

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {item.pros && (
            <div className="rounded-2xl bg-emerald-50 p-3 ring-1 ring-emerald-100">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700">Плюсы</div>
              <div className="mt-1 whitespace-pre-wrap text-sm font-semibold leading-5 text-emerald-950">{item.pros}</div>
            </div>
          )}
          {(item.cons || cons.length > 0) && (
            <div className="rounded-2xl bg-amber-50 p-3 ring-1 ring-amber-100">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-amber-700">Минусы / предупреждения</div>
              {item.cons && <div className="mt-1 whitespace-pre-wrap text-sm font-semibold leading-5 text-amber-950">{item.cons}</div>}
              {cons.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{cons.map((key) => <span key={key} className="rounded-full bg-white px-2 py-1 text-[11px] font-black text-amber-700 ring-1 ring-amber-100">{optionIcon(CON_OPTIONS, key)} {optionLabel(CON_OPTIONS, key)}</span>)}</div>}
            </div>
          )}
        </div>

        <SectionMediaTabs items={item.section_media} />
        <ScoreBars scores={item.scores} />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onLiked(item)}
              className={`rounded-2xl px-4 py-2 text-sm font-black ring-1 transition ${item.liked_by_me ? "bg-rose-50 text-rose-600 ring-rose-100" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"}`}
            >
              ❤️ Полезно · {Number(item.likes || 0)}
            </button>
            <button type="button" onClick={() => onReported(item)} className="rounded-2xl bg-amber-50 px-4 py-2 text-sm font-black text-amber-700 ring-1 ring-amber-100 hover:bg-amber-100">⚠️ Пожаловаться</button>
            {canManage && <button type="button" onClick={() => onEdit(item)} className="rounded-2xl bg-blue-50 px-4 py-2 text-sm font-black text-blue-700 ring-1 ring-blue-100 hover:bg-blue-100">✏️ Редактировать</button>}
            {canManage && <button type="button" onClick={() => onDeleted(item)} className="rounded-2xl bg-red-50 px-4 py-2 text-sm font-black text-red-700 ring-1 ring-red-100 hover:bg-red-100">🗑 Скрыть</button>}
            {canModerate && <button type="button" onClick={() => onModerated(item, "approved")} className="rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700 ring-1 ring-emerald-100 hover:bg-emerald-100">✅ Одобрить</button>}
            {canModerate && <button type="button" onClick={() => onModerated(item, "rejected")} className="rounded-2xl bg-slate-50 px-4 py-2 text-sm font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">⛔ Отклонить</button>}
          </div>
          <div className="text-xs font-bold text-slate-400">Медиа: {arr(item.section_media).length}</div>
        </div>

        <CommentsPanel inspectionId={item.id} initialCount={item.comment_count} />
      </div>
    </article>
  );
}

function PassportSummary({ hotel, items = [] }) {
  const audiences = useMemo(() => {
    const map = new Map();
    for (const item of items) for (const key of arr(item.audience_keys)) map.set(key, (map.get(key) || 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [items]);
  const cons = useMemo(() => {
    const map = new Map();
    for (const item of items) for (const key of arr(item.con_keys)) map.set(key, (map.get(key) || 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [items]);
  const mediaCount = items.reduce((sum, item) => sum + arr(item.section_media).length, 0);
  const average = (() => {
    const values = items.map((i) => Number(i.recommendation_score || avgScore(i.scores))).filter((n) => Number.isFinite(n) && n > 0);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  })();

  return (
    <div className="rounded-[28px] border border-orange-100 bg-gradient-to-br from-orange-50 via-white to-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex rounded-full bg-white px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-orange-600 ring-1 ring-orange-100">Hotel Passport Summary</div>
          <h1 className="mt-3 text-2xl font-black tracking-[-0.04em] text-slate-950">{hotel?.name || "Инспекции отелей"}</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">{hotel ? [hotel.city || hotel.location, hotel.country].filter(Boolean).join(", ") : "Живая лента обзоров от поставщиков и клиентов Travella"}</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-2xl bg-white p-3 ring-1 ring-orange-100"><div className="text-2xl font-black text-slate-950">{items.length}</div><div className="text-[11px] font-black text-slate-400">обзоров</div></div>
          <div className="rounded-2xl bg-white p-3 ring-1 ring-orange-100"><div className="text-2xl font-black text-slate-950">{average ? average.toFixed(1) : "—"}</div><div className="text-[11px] font-black text-slate-400">средняя</div></div>
          <div className="rounded-2xl bg-white p-3 ring-1 ring-orange-100"><div className="text-2xl font-black text-slate-950">{mediaCount}</div><div className="text-[11px] font-black text-slate-400">медиа</div></div>
        </div>
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-orange-100">
          <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Подходит</div>
          <div className="mt-2 flex flex-wrap gap-2">{audiences.length ? audiences.map(([key, n]) => <span key={key} className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">{optionIcon(AUDIENCE_OPTIONS, key)} {optionLabel(AUDIENCE_OPTIONS, key)} · {n}</span>) : <span className="text-sm font-semibold text-slate-400">Нет данных</span>}</div>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-orange-100">
          <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Главные предупреждения</div>
          <div className="mt-2 flex flex-wrap gap-2">{cons.length ? cons.map(([key, n]) => <span key={key} className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700">{optionIcon(CON_OPTIONS, key)} {optionLabel(CON_OPTIONS, key)} · {n}</span>) : <span className="text-sm font-semibold text-slate-400">Нет критичных предупреждений</span>}</div>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-orange-100">
          <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Последние медиа</div>
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {items.flatMap((i) => arr(i.section_media)).slice(0, 8).map((m) => <img key={m.id || m.url} src={m.thumbnail_url || m.url} alt="" className="h-12 w-full rounded-xl object-cover" />)}
            {!mediaCount ? <span className="col-span-4 text-sm font-semibold text-slate-400">Пока нет фото/видео</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function Filters({ filters, setFilters, hotelMode }) {
  const update = (patch) => setFilters((prev) => ({ ...prev, ...patch }));
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-black text-slate-900">Фильтры обзоров</div>
        <button type="button" onClick={() => setFilters({ sort: "top", city: "", month: "", audience: "", visit_type: "", min_score: "", has_media: false })} className="text-xs font-black text-orange-600 hover:underline">Сбросить</button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-6">
        {!hotelMode && <input value={filters.city} onChange={(e) => update({ city: e.target.value })} placeholder="Город" className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-orange-300" />}
        <select value={filters.sort} onChange={(e) => update({ sort: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-orange-300">
          <option value="top">Сначала полезные</option><option value="new">Сначала новые</option><option value="score">По оценке</option>
        </select>
        <select value={filters.month} onChange={(e) => update({ month: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-orange-300">
          <option value="">Любой месяц</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select value={filters.audience} onChange={(e) => update({ audience: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-orange-300">
          <option value="">Любая аудитория</option>{AUDIENCE_OPTIONS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
        <select value={filters.visit_type} onChange={(e) => update({ visit_type: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-orange-300">
          <option value="">Любой тип визита</option>{VISIT_TYPES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
        <select value={filters.min_score} onChange={(e) => update({ min_score: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-orange-300">
          <option value="">Любая оценка</option><option value="5">5+</option><option value="4">4+</option><option value="3">3+</option>
        </select>
      </div>
      <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-full bg-slate-50 px-3 py-2 text-xs font-black text-slate-600 ring-1 ring-slate-200">
        <input type="checkbox" checked={filters.has_media} onChange={(e) => update({ has_media: e.target.checked })} /> Только с фото/видео
      </label>
    </div>
  );
}


function EditInspectionPanel({ item, onClose, onSaved }) {
  const [title, setTitle] = useState(item?.title || "");
  const [review, setReview] = useState(item?.review || "");
  const [pros, setPros] = useState(item?.pros || "");
  const [cons, setCons] = useState(item?.cons || "");
  const [features, setFeatures] = useState(item?.features || "");
  const [recommendationScore, setRecommendationScore] = useState(Number(item?.recommendation_score || 5));
  const [travelMonth, setTravelMonth] = useState(item?.travel_month || "");
  const [visitType, setVisitType] = useState(item?.visit_type || "agent_inspection");
  const [audienceKeys, setAudienceKeys] = useState(arr(item?.audience_keys));
  const [conKeys, setConKeys] = useState(arr(item?.con_keys));
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!item?.id || saving) return;
    setSaving(true);
    try {
      await updateInspection(item.id, {
        title,
        review,
        pros,
        cons,
        features,
        recommendation_score: recommendationScore,
        travel_month: travelMonth || null,
        visit_type: visitType,
        audience_keys: audienceKeys,
        con_keys: conKeys,
      });
      tSuccess("Инспекция обновлена и отправлена на модерацию");
      onSaved?.();
      onClose?.();
    } catch (e) {
      alert(e?.message || "Не удалось сохранить инспекцию");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-3 md:items-center">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-[28px] bg-white p-4 shadow-2xl md:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex rounded-full bg-orange-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-orange-600 ring-1 ring-orange-100">Редактирование инспекции</div>
            <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-slate-950">Обновить обзор отеля</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">После сохранения обзор снова попадёт на модерацию.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-black text-slate-700">Закрыть</button>
        </div>
        <div className="mt-5 grid gap-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm font-semibold outline-none focus:border-orange-300" placeholder="Заголовок" />
          <textarea value={review} onChange={(e) => setReview(e.target.value)} className="min-h-[120px] rounded-2xl border border-slate-200 px-3 py-3 text-sm font-semibold outline-none focus:border-orange-300" placeholder="Основной обзор" />
          <div className="grid gap-3 md:grid-cols-2">
            <textarea value={pros} onChange={(e) => setPros(e.target.value)} className="min-h-[90px] rounded-2xl border border-slate-200 px-3 py-3 text-sm font-semibold outline-none focus:border-orange-300" placeholder="Плюсы" />
            <textarea value={cons} onChange={(e) => setCons(e.target.value)} className="min-h-[90px] rounded-2xl border border-slate-200 px-3 py-3 text-sm font-semibold outline-none focus:border-orange-300" placeholder="Минусы / предупреждения" />
          </div>
          <textarea value={features} onChange={(e) => setFeatures(e.target.value)} className="min-h-[80px] rounded-2xl border border-slate-200 px-3 py-3 text-sm font-semibold outline-none focus:border-orange-300" placeholder="Особенности" />
          <div className="grid gap-3 md:grid-cols-3">
            <select value={visitType} onChange={(e) => setVisitType(e.target.value)} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm font-semibold">{VISIT_TYPES.map((x) => <option key={x.key} value={x.key}>{x.icon} {x.label}</option>)}</select>
            <select value={travelMonth} onChange={(e) => setTravelMonth(e.target.value)} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm font-semibold"><option value="">Месяц поездки</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
            <label className="rounded-2xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-500">Рекомендация: {recommendationScore}/5<input type="range" min="1" max="5" value={recommendationScore} onChange={(e) => setRecommendationScore(Number(e.target.value))} className="mt-2 w-full" /></label>
          </div>
          <div><div className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-slate-400">Кому подходит</div><div className="flex flex-wrap gap-2">{AUDIENCE_OPTIONS.map((x) => <Chip key={x.key} active={audienceKeys.includes(x.key)} onClick={() => toggleInArray(setAudienceKeys, x.key)}>{x.icon} {x.label}</Chip>)}</div></div>
          <div><div className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-slate-400">Предупреждения</div><div className="flex flex-wrap gap-2">{CON_OPTIONS.map((x) => <Chip key={x.key} active={conKeys.includes(x.key)} onClick={() => toggleInArray(setConKeys, x.key)}>{x.icon} {x.label}</Chip>)}</div></div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-4">
          <button type="button" onClick={onClose} className="rounded-2xl bg-slate-100 px-5 py-3 text-sm font-black text-slate-700">Отмена</button>
          <button type="button" onClick={save} disabled={saving} className="rounded-2xl bg-orange-500 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{saving ? "Сохраняем…" : "Сохранить"}</button>
        </div>
      </div>
    </div>
  );
}

function AddInspectionWizard({ hotel, hotelId, onCreated }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [review, setReview] = useState("");
  const [pros, setPros] = useState("");
  const [cons, setCons] = useState("");
  const [features, setFeatures] = useState("");
  const [visitType, setVisitType] = useState("agent_inspection");
  const [travelMonth, setTravelMonth] = useState("");
  const [travelDate, setTravelDate] = useState("");
  const [recommendationScore, setRecommendationScore] = useState(5);
  const [audienceKeys, setAudienceKeys] = useState([]);
  const [conKeys, setConKeys] = useState([]);
  const [scores, setScores] = useState({});
  const [amenities, setAmenities] = useState([]);
  const [nearby, setNearby] = useState({});
  const [files, setFiles] = useState([]);
  const [mediaMeta, setMediaMeta] = useState([]);

  const stepReady = useMemo(() => {
    if (step === 1) return title.trim().length >= 3 && review.trim().length >= 20 && visitType;
    if (step === 2) return audienceKeys.length > 0;
    return true;
  }, [step, title, review, visitType, audienceKeys.length]);

  function onFilesChange(e) {
    const picked = Array.from(e.target.files || []);
    const nextFiles = [...files, ...picked].slice(0, MAX_INSPECTION_FILES);
    const validationError = validateInspectionFiles(nextFiles);

    if (validationError) {
      alert(validationError);
      e.target.value = "";
      return;
    }

    setFiles(nextFiles);
    setMediaMeta((prev) => [
      ...prev,
      ...picked.map((file) => ({
        section_key: "room",
        caption: file.name,
        tags: [],
      })),
    ].slice(0, MAX_INSPECTION_FILES));
    e.target.value = "";
  }
  function updateMediaMeta(i, patch) {
    setMediaMeta((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }

  async function submit() {
    if (!hotelId || submitting) return;

    const validationError = validateInspectionFiles(files);
    if (validationError) {
      alert(validationError);
      return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("title", title);
      fd.append("review", review);
      fd.append("pros", pros);
      fd.append("cons", cons);
      fd.append("features", features);
      fd.append("visit_type", visitType);
      if (travelMonth) fd.append("travel_month", String(travelMonth));
      fd.append("recommendation_score", String(recommendationScore));
      fd.append("audience_keys", JSON.stringify(audienceKeys));
      fd.append("con_keys", JSON.stringify(conKeys));
      fd.append("scores", JSON.stringify(scores));
      fd.append("amenities", JSON.stringify(amenities));
      fd.append("nearby", JSON.stringify(nearby));
      fd.append("mediaMeta", JSON.stringify(mediaMeta));
      files.forEach((file) => fd.append("files", file));
      await createInspection(hotelId, fd);
      tSuccess("Инспекция отправлена на модерацию");
      setOpen(false);
      setStep(1);
      onCreated?.();
    } catch (e) {
      if (e?.code === "already_inspected") alert("Вы уже оставляли инспекцию по этому отелю.");
      else if (e?.code === "network_upload_failed") alert(e.message);
      else alert(e?.message || "Не удалось создать инспекцию");
    } finally {
      setSubmitting(false);
    }
  }

  if (!hotelId) return null;

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
      {!open ? (
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-black text-slate-950">Добавить инспекцию</div>
            <div className="text-sm font-semibold text-slate-500">Пошаговая форма: впечатление, аудитория, медиа, оценки, предпросмотр.</div>
          </div>
          <button type="button" onClick={() => setOpen(true)} className="rounded-2xl bg-orange-500 px-5 py-3 text-sm font-black text-white transition hover:bg-orange-600">➕ Оставить обзор</button>
        </div>
      ) : (
        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-black text-slate-950">Новая инспекция: {hotel?.name || `#${hotelId}`}</div>
              <div className="text-xs font-bold text-slate-400">Шаг {step} из 5</div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-600">Закрыть</button>
          </div>
          <div className="mb-5 grid grid-cols-5 gap-2">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" onClick={() => setStep(n)} className={`h-2 rounded-full ${step >= n ? "bg-orange-500" : "bg-slate-200"}`} aria-label={`Шаг ${n}`} />)}</div>

          {step === 1 && (
            <div className="grid gap-3">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Заголовок обзора" className="rounded-2xl border border-slate-200 px-3 py-3 text-sm font-semibold outline-none focus:border-orange-300" />
              <select value={visitType} onChange={(e) => setVisitType(e.target.value)} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm font-semibold outline-none focus:border-orange-300">{VISIT_TYPES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
              <div className="grid gap-2">
                <label className="text-sm font-black text-slate-700">
                  Дата поездки / инспекции
                </label>
              
                <input
                  type="date"
                  value={travelDate || ""}
                  onChange={(e) => {
                    const v = e.target.value;
              
                    setTravelDate(v);
              
                    if (v) {
                      const month = new Date(v).getMonth() + 1;
                      setTravelMonth(month);
                    } else {
                      setTravelMonth("");
                    }
                  }}
                  className="rounded-2xl border border-slate-200 px-3 py-3 text-sm font-semibold outline-none focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                />
              </div>
              <textarea value={review} onChange={(e) => setReview(e.target.value)} placeholder="Общее впечатление: что важно знать агенту или туристу?" className="min-h-[120px] rounded-2xl border border-slate-200 px-3 py-3 text-sm font-semibold outline-none focus:border-orange-300" />
              <div className="grid gap-3 md:grid-cols-2"><textarea value={pros} onChange={(e) => setPros(e.target.value)} placeholder="Главные плюсы" className="min-h-[90px] rounded-2xl border border-emerald-100 bg-emerald-50/40 px-3 py-3 text-sm font-semibold outline-none" /><textarea value={cons} onChange={(e) => setCons(e.target.value)} placeholder="Минусы / предупреждения" className="min-h-[90px] rounded-2xl border border-amber-100 bg-amber-50/40 px-3 py-3 text-sm font-semibold outline-none" /></div>
              <textarea value={features} onChange={(e) => setFeatures(e.target.value)} placeholder="Особенности: фишки, нюансы, кому продавать осторожно" className="min-h-[80px] rounded-2xl border border-slate-200 px-3 py-3 text-sm font-semibold outline-none focus:border-orange-300" />
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-5">
              <div><div className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-slate-400">Кому подходит</div><div className="flex flex-wrap gap-2">{AUDIENCE_OPTIONS.map((x) => <Chip key={x.key} active={audienceKeys.includes(x.key)} onClick={() => toggleInArray(setAudienceKeys, x.key)}>{x.icon} {x.label}</Chip>)}</div></div>
              <div><div className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-slate-400">Предупреждения</div><div className="flex flex-wrap gap-2">{CON_OPTIONS.map((x) => <Chip key={x.key} active={conKeys.includes(x.key)} onClick={() => toggleInArray(setConKeys, x.key)}>{x.icon} {x.label}</Chip>)}</div></div>
            </div>
          )}

          {step === 3 && (
            <div className="grid gap-4">
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-orange-200 bg-orange-50/50 p-6 text-center">
                <span className="text-3xl">📷</span><span className="mt-2 text-sm font-black text-slate-800">Загрузить фото/видео по зонам отеля</span><span className="mt-1 text-xs font-bold text-slate-400">До 13 файлов, каждый файл можно подписать и отнести к секции</span>
                <input type="file" accept="image/*,video/*" multiple onChange={onFilesChange} className="hidden" />
              </label>
              {files.length > 0 && <div className="grid gap-2">{files.map((file, i) => <div key={`${file.name}-${i}`} className="grid gap-2 rounded-2xl border border-slate-100 bg-slate-50 p-3 md:grid-cols-[1fr_180px_1fr]"><div className="truncate text-sm font-black text-slate-800">{file.name}</div><select value={mediaMeta[i]?.section_key || "room"} onChange={(e) => updateMediaMeta(i, { section_key: e.target.value })} className="rounded-xl border border-slate-200 px-2 py-2 text-sm font-semibold">{MEDIA_SECTIONS.map((s) => <option key={s.key} value={s.key}>{s.icon} {s.label}</option>)}</select><input value={mediaMeta[i]?.caption || ""} onChange={(e) => updateMediaMeta(i, { caption: e.target.value })} placeholder="Подпись" className="rounded-xl border border-slate-200 px-2 py-2 text-sm font-semibold" /></div>)}</div>}
            </div>
          )}

          {step === 4 && (
            <div className="grid gap-5">
              <div><div className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-slate-400">Рекомендация</div><input type="range" min="1" max="5" value={recommendationScore} onChange={(e) => setRecommendationScore(Number(e.target.value))} className="w-full" /><div className="mt-1 text-sm font-black text-orange-600">{recommendationScore}/5</div></div>
              <div className="grid gap-3 md:grid-cols-3">{SCORE_FIELDS.map((f) => <label key={f.key} className="rounded-2xl border border-slate-100 p-3"><span className="text-xs font-black text-slate-500">{f.label}</span><select value={scores[f.key] || ""} onChange={(e) => setScores((prev) => ({ ...prev, [f.key]: e.target.value ? Number(e.target.value) : undefined }))} className="mt-2 w-full rounded-xl border border-slate-200 px-2 py-2 text-sm font-semibold"><option value="">—</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select></label>)}</div>
              <div><div className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-slate-400">Удобства</div><div className="flex flex-wrap gap-2">{AMENITIES.map((x) => <Chip key={x.key} active={amenities.includes(x.key)} onClick={() => toggleInArray(setAmenities, x.key)}>{x.label}</Chip>)}</div></div>
              <div className="grid gap-3 md:grid-cols-4">{NEARBY_FIELDS.map((f) => <input key={f.key} value={nearby[f.key] || ""} onChange={(e) => setNearby((prev) => ({ ...prev, [f.key]: e.target.value }))} placeholder={f.label} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold" />)}</div>
            </div>
          )}

          {step === 5 && (
            <div className="rounded-3xl border border-slate-100 bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Предпросмотр</div>
              <h3 className="mt-2 text-xl font-black text-slate-950">{title || "Живой обзор отеля"}</h3>
              <div className="mt-2 flex flex-wrap gap-2"><TrustBadge visitType={visitType} authorType="provider" />{travelMonth && <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-600">{MONTHS[Number(travelMonth) - 1]}</span>}<span className="rounded-full bg-white px-3 py-1 text-xs font-black text-orange-600">{recommendationScore}/5</span></div>
              {review && <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-700">{review}</p>}
              <div className="mt-3 text-sm font-bold text-slate-500">Аудитория: {audienceKeys.map((k) => optionLabel(AUDIENCE_OPTIONS, k)).join(", ") || "—"}</div>
              <div className="mt-1 text-sm font-bold text-slate-500">Медиа: {files.length}</div>
            </div>
          )}

          <div className="mt-5 flex flex-wrap justify-between gap-3 border-t border-slate-100 pt-4">
            <button type="button" onClick={() => step > 1 ? setStep(step - 1) : setOpen(false)} className="rounded-2xl bg-slate-100 px-5 py-3 text-sm font-black text-slate-700">Назад</button>
            {step < 5 ? <button type="button" onClick={() => stepReady ? setStep(step + 1) : alert(step === 1 ? "Заполните заголовок и обзор минимум 20 символов" : "Выберите хотя бы одну аудиторию") } className={`rounded-2xl px-5 py-3 text-sm font-black text-white ${stepReady ? "bg-slate-950" : "bg-slate-400"}`}>Дальше</button> : <button type="button" onClick={submit} disabled={submitting} className="rounded-2xl bg-orange-500 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{submitting ? "Сохраняем…" : "Опубликовать инспекцию"}</button>}
          </div>
        </div>
      )}
      {!hotel && hotelId ? <button type="button" onClick={() => navigate(`/hotels/${hotelId}`)} className="mt-3 text-xs font-black text-orange-600 hover:underline">Открыть карточку отеля</button> : null}
    </div>
  );
}

export default function HotelInspections() {
  const { hotelId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [hotel, setHotel] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(() => parseFilterFromSearch(searchParams));
  const [reloadKey, setReloadKey] = useState(0);
  const [editingItem, setEditingItem] = useState(null);
  const hotelMode = Boolean(hotelId);

  useEffect(() => {
    const next = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value === "" || value === false || value == null) return;
      next.set(key, value === true ? "1" : String(value));
    });
    setSearchParams(next, { replace: true });
  }, [filters, setSearchParams]);

  useEffect(() => {
    let alive = true;
    if (!hotelId) { setHotel(null); return () => { alive = false; }; }
    (async () => {
      try {
        const data = await getHotel(hotelId);
        if (alive) setHotel(data || null);
      } catch {
        if (alive) setHotel(null);
      }
    })();
    return () => { alive = false; };
  }, [hotelId]);

  async function load() {
    setLoading(true);
    try {
      const data = hotelMode ? await listInspections(hotelId, filters) : await listAllInspections(filters);
      setItems(arr(data?.items));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId, filters.sort, filters.city, filters.month, filters.audience, filters.visit_type, filters.min_score, filters.has_media, reloadKey]);

  async function onLiked(item) {
    try {
      const res = await likeInspection(item.id);
      setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, likes: res.likes, liked_by_me: res.liked } : x));
    } catch (e) {
      alert(e?.message || "Не удалось поставить отметку");
    }
  }

  async function onDeleted(item) {
    if (!window.confirm("Скрыть эту инспекцию?")) return;
    try {
      await deleteInspection(item.id);
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      tSuccess("Инспекция скрыта");
    } catch (e) {
      alert(e?.message || "Не удалось скрыть инспекцию");
    }
  }

  async function onReported(item) {
    const reason = window.prompt("Причина жалобы на инспекцию", "Некорректная или устаревшая информация");
    if (!reason) return;
    try {
      await reportInspection(item.id, { reason: "inspection_report", text: reason });
      tSuccess("Жалоба отправлена на модерацию");
    } catch (e) {
      alert(e?.message || "Не удалось отправить жалобу");
    }
  }

  async function onModerated(item, status) {
    const reason = status === "rejected" ? window.prompt("Причина отклонения", "Нужно уточнить данные") : "";
    try {
      const res = await moderateInspection(item.id, { status, reason, verified_visit: status === "approved" });
      setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, ...(res?.item || {}), status, moderation_status: status } : x));
      tSuccess(status === "approved" ? "Инспекция одобрена" : "Статус инспекции обновлён");
    } catch (e) {
      alert(e?.message || "Не удалось обновить статус");
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Link to="/hotels" className="rounded-2xl bg-white px-4 py-2 text-sm font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">← Отели</Link>
          {hotelId ? <Link to={`/hotels/${hotelId}`} className="rounded-2xl bg-white px-4 py-2 text-sm font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">Карточка отеля</Link> : null}
        </div>
      </div>

      {editingItem && <EditInspectionPanel item={editingItem} onClose={() => setEditingItem(null)} onSaved={() => setReloadKey((v) => v + 1)} />}
      <PassportSummary hotel={hotel} items={items} />
      <AddInspectionWizard hotel={hotel} hotelId={hotelId} onCreated={() => setReloadKey((v) => v + 1)} />
      <Filters filters={filters} setFilters={setFilters} hotelMode={hotelMode} />

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-96 animate-pulse rounded-[28px] bg-slate-100" />)}
        </div>
      ) : items.length ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {items.map((item) => <InspectionCard key={item.id} item={item} onLiked={onLiked} onEdit={setEditingItem} onDeleted={onDeleted} onModerated={onModerated} onReported={onReported} />)}
        </div>
      ) : (
        <div className="rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="text-4xl">🏨</div>
          <div className="mt-3 text-lg font-black text-slate-950">Инспекций пока нет</div>
          <div className="mt-1 text-sm font-semibold text-slate-500">Снимите фильтры или добавьте первый живой обзор по этому отелю.</div>
        </div>
      )}
    </div>
  );
}
