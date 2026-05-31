// frontend/src/pages/HotelDetails.jsx
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getHotel, listInspections } from "../api/hotels";

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

const SCORE_LABELS = {
  quiet_level: "Тишина",
  quietness: "Тишина",
  silence: "Тишина",
  family_score: "Семьи",
  families: "Семьи",
  infra_score: "Инфраструктура",
  infrastructure: "Инфраструктура",
  nightlife_score: "Ночная жизнь",
  nightlife: "Ночная жизнь",
  activity_score: "Активности",
  activities: "Активности",
  wellness_score: "Wellness",
  wellness: "Wellness",
  business_score: "Бизнес",
  business: "Бизнес",
  value_score: "Цена/качество",
  value: "Цена/качество",
  price_value: "Цена/качество",
  access_score: "Доступность",
  accessibility: "Доступность",
  food: "Питание",
  service: "Сервис",
  rooms: "Номера",
  cleanliness: "Чистота",
  beach: "Пляж",
  pool: "Бассейн",
  kids: "Для детей",
};

function tryParseJSON(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  if (typeof v !== "string") return null;
  try {
    const parsed = JSON.parse(v);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function arr(v) {
  if (Array.isArray(v)) return v;
  const parsed = tryParseJSON(v);
  return Array.isArray(parsed) ? parsed : [];
}

function obj(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) return v;
  const parsed = tryParseJSON(v);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function compactText(v, fallback = "—") {
  const s = String(v || "").trim();
  return s || fallback;
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function normalizeMedia(m) {
  if (!m) return null;
  if (typeof m === "string") return { url: m, thumbnail_url: m, type: guessMediaType(m), section_key: "hotel" };
  const url = m.url || m.secure_url || m.thumbnail_url || m.src || m.path;
  if (!url) return null;
  const thumb = m.thumbnail_url || m.thumb_url || m.preview_url || url;
  return {
    ...m,
    url,
    thumbnail_url: thumb,
    type: m.type || m.media_type || m.resource_type || guessMediaType(url),
    section_key: m.section_key || m.section || m.zone || "hotel",
  };
}

function guessMediaType(url = "") {
  const s = String(url).toLowerCase().split("?")[0];
  if (/\.(mp4|webm|mov|m4v)$/.test(s)) return "video";
  return "image";
}

function getHotelImages(hotel) {
  const raw = hotel?.images || hotel?.photos || hotel?.gallery;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(normalizeMedia).filter(Boolean);
  const parsed = tryParseJSON(raw);
  if (Array.isArray(parsed)) return parsed.map(normalizeMedia).filter(Boolean);
  return [normalizeMedia(raw)].filter(Boolean);
}

function getInspectionMedia(inspections = []) {
  return inspections.flatMap((item) => arr(item?.section_media).map(normalizeMedia).filter(Boolean).map((m) => ({
    ...m,
    inspection_id: item.id,
    inspection_title: item.title,
  })));
}

function statusValue(item) {
  return String(item?.status || item?.moderation_status || "approved").toLowerCase();
}

function isPublished(item) {
  return ["approved", "published", "active"].includes(statusValue(item));
}

function statusBadge(item) {
  const s = statusValue(item);
  if (s === "pending") return { text: "На модерации", cls: "bg-amber-50 text-amber-700 ring-amber-100", icon: "⏳" };
  if (s === "rejected") return { text: "Отклонено", cls: "bg-red-50 text-red-700 ring-red-100", icon: "⛔" };
  if (s === "hidden") return { text: "Скрыто", cls: "bg-slate-100 text-slate-700 ring-slate-200", icon: "🙈" };
  return { text: "Опубликовано", cls: "bg-emerald-50 text-emerald-700 ring-emerald-100", icon: "✅" };
}

function optionLabel(list, key) {
  const item = list.find((x) => x.key === key);
  return item ? `${item.icon} ${item.label}` : key;
}

function summarizeKeys(inspections, field, options, limit = 8) {
  const map = new Map();
  for (const item of inspections) {
    for (const key of arr(item?.[field])) map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, n]) => ({ key, n, label: optionLabel(options, key) }));
}

function getAggregatedStats(hotel, inspections = []) {
  const attrs = obj(hotel?.attrs);
  const aggregated = obj(attrs.aggregated_from_inspections);
  const aggregatedScores = obj(aggregated.scores);
  const aggregatedValues = Object.values(aggregatedScores).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  const fromAttrs = aggregatedValues.length ? aggregatedValues.reduce((a, b) => a + b, 0) / aggregatedValues.length : null;
  const direct = inspections.map((x) => Number(x.recommendation_score)).filter((n) => Number.isFinite(n) && n > 0);
  const score = direct.length ? direct.reduce((a, b) => a + b, 0) / direct.length : fromAttrs;
  const mediaCount = inspections.reduce((s, x) => s + arr(x.section_media).length, 0);
  return {
    count: inspections.length || Number(aggregated.n || 0),
    score,
    amenities: Array.isArray(aggregated.amenities) ? aggregated.amenities : [],
    mediaCount,
  };
}

function collectScoreRows(hotel, inspections = []) {
  const collected = new Map();
  const push = (scores) => {
    const parsed = obj(scores);
    for (const [key, raw] of Object.entries(parsed)) {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) continue;
      const prev = collected.get(key) || { sum: 0, count: 0 };
      collected.set(key, { sum: prev.sum + n, count: prev.count + 1 });
    }
  };
  const attrs = obj(hotel?.attrs);
  push(obj(attrs.aggregated_from_inspections).scores);
  inspections.forEach((item) => push(item.scores));
  return [...collected.entries()]
    .map(([key, v]) => ({ key, label: SCORE_LABELS[key] || key, value: v.sum / v.count }))
    .filter((x) => Number.isFinite(x.value))
    .sort((a, b) => a.label.localeCompare(b.label, "ru"));
}

function Stars({ value = 0, max = 5 }) {
  const n = Math.max(0, Math.min(max, Math.round(Number(value) || 0)));
  return (
    <div className="flex min-w-0 items-center gap-1" title={`${n} ★`}>
      {Array.from({ length: max }).map((_, i) => (
        <svg key={i} width="18" height="18" viewBox="0 0 24 24" className={i < n ? "shrink-0 text-amber-500" : "shrink-0 text-slate-300"} fill="currentColor" aria-hidden="true">
          <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.62L12 2 9.19 8.62 2 9.24l5.46 4.73L5.82 21z" />
        </svg>
      ))}
      <span className="ml-2 truncate text-sm font-black text-slate-500">{n > 0 ? `${n}★` : "—"}</span>
    </div>
  );
}

function MediaCarousel({ media = [], title = "Фото и видео", compact = false }) {
  const items = media.map(normalizeMedia).filter(Boolean);
  const [idx, setIdx] = useState(0);
  const active = items[idx] || null;

  useEffect(() => {
    if (idx > items.length - 1) setIdx(0);
  }, [idx, items.length]);

  if (!items.length) {
    return (
      <div className="flex min-h-[220px] items-center justify-center rounded-[2rem] border border-dashed border-slate-200 bg-white p-6 text-center text-sm font-bold text-slate-400 shadow-sm">
        Фото/видео пока не прикреплены
      </div>
    );
  }

  return (
    <section className="min-w-0 rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="truncate text-lg font-black tracking-[-0.03em] text-slate-950">{title}</h2>
        <div className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-600">{idx + 1} / {items.length}</div>
      </div>
      <div className={`relative overflow-hidden rounded-3xl bg-slate-100 ${compact ? "h-52" : "h-[260px] md:h-[380px]"}`}>
        {active?.type === "video" || active?.media_type === "video" ? (
          <video src={active.url} poster={active.thumbnail_url} controls playsInline preload="metadata" className="h-full w-full bg-slate-950 object-contain" />
        ) : (
          <img src={active?.thumbnail_url || active?.url} alt={active?.caption || ""} className="h-full w-full object-cover" />
        )}
        {items.length > 1 && (
          <>
            <button type="button" onClick={() => setIdx((v) => (v - 1 + items.length) % items.length)} className="absolute left-3 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-lg font-black text-slate-800 shadow ring-1 ring-slate-200 hover:bg-white" aria-label="Предыдущее медиа">‹</button>
            <button type="button" onClick={() => setIdx((v) => (v + 1) % items.length)} className="absolute right-3 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-lg font-black text-slate-800 shadow ring-1 ring-slate-200 hover:bg-white" aria-label="Следующее медиа">›</button>
          </>
        )}
      </div>
      {items.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {items.map((m, i) => (
            <button key={m.id || m.url || i} type="button" onClick={() => setIdx(i)} className={`relative h-16 w-24 shrink-0 overflow-hidden rounded-2xl border bg-slate-100 ${i === idx ? "border-orange-400 ring-2 ring-orange-100" : "border-slate-200"}`}>
              {(m.type === "video" || m.media_type === "video") && <span className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/35 text-white">▶</span>}
              <img src={m.thumbnail_url || m.url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function StatCard({ label, value, hint }) {
  return (
    <div className="min-w-0 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-black tracking-[-0.04em] text-slate-950">{value ?? "—"}</div>
      {hint && <div className="mt-1 text-xs font-bold text-slate-400">{hint}</div>}
    </div>
  );
}

function InfoRow({ label, children }) {
  return (
    <div className="grid min-w-0 grid-cols-[130px_minmax(0,1fr)] gap-3 border-b border-slate-100 py-3 last:border-b-0">
      <div className="text-sm font-bold text-slate-500">{label}</div>
      <div className="min-w-0 break-words text-sm font-semibold text-slate-900">{children || "—"}</div>
    </div>
  );
}

function MyInspectionPanel({ inspection, hotelId }) {
  if (!inspection) return null;
  const badge = statusBadge(inspection);
  return (
    <div className={`rounded-3xl p-4 ring-1 ${badge.cls}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-black shadow-sm ring-1 ring-white/60">{badge.icon} {badge.text}</div>
          <div className="mt-2 text-sm font-black text-slate-950">Ваш обзор этого отеля</div>
          <div className="mt-1 text-xs font-semibold text-slate-600">
            {statusValue(inspection) === "pending" ? "После проверки админом обзор станет публичным." : statusValue(inspection) === "rejected" ? (inspection.rejection_reason || "Проверьте замечания модератора и отправьте заново.") : "Обзор уже виден в Hotel Passport."}
          </div>
        </div>
        <Link to={`/hotels/${hotelId}/inspections?edit=${inspection.id}`} className="shrink-0 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-black">✏️ Редактировать</Link>
      </div>
    </div>
  );
}

function InspectionCard({ item }) {
  const badge = statusBadge(item);
  const media = arr(item.section_media).map(normalizeMedia).filter(Boolean);
  const cover = media[0];
  return (
    <article className="min-w-0 overflow-hidden rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid min-w-0 gap-4 md:grid-cols-[160px_minmax(0,1fr)_80px] md:items-start">
        <div className="h-32 overflow-hidden rounded-2xl bg-slate-100">
          {cover ? <img src={cover.thumbnail_url || cover.url} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-3xl">🏨</div>}
        </div>
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-black ring-1 ${badge.cls}`}>{badge.icon} {badge.text}</span>
            {media.length > 0 && <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-black text-blue-700 ring-1 ring-blue-100">Медиа: {media.length}</span>}
          </div>
          <h3 className="line-clamp-2 break-words text-lg font-black leading-snug tracking-[-0.03em] text-slate-950">{compactText(item.title, "Живой обзор отеля")}</h3>
          <div className="mt-1 text-sm font-black text-slate-500">{compactText(item.author_name, "Travella")} · {formatDate(item.created_at)}</div>
          <p className="mt-2 line-clamp-3 break-words text-sm font-semibold leading-6 text-slate-600">{compactText(item.review || item.pros, "Описание пока не заполнено")}</p>
        </div>
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-xl font-black text-slate-950 ring-1 ring-orange-100 md:ml-auto">
          {item.recommendation_score || "—"}<span className="text-xs text-slate-400">/5</span>
        </div>
      </div>
    </article>
  );
}

function ScoresBlock({ rows }) {
  if (!rows.length) return null;
  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-black tracking-[-0.03em] text-slate-950">Оценки по деталям</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {rows.map((row) => {
          const value = Math.max(0, Math.min(5, Number(row.value) || 0));
          return (
            <div key={row.key} className="min-w-0">
              <div className="mb-1 flex justify-between gap-3 text-sm font-black text-slate-700"><span className="truncate">{row.label}</span><span>{value.toFixed(1)}/5</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-orange-500" style={{ width: `${value * 20}%` }} /></div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ChipList({ title, items, empty, tone = "blue" }) {
  const toneClass = tone === "amber" ? "bg-amber-50 text-amber-700 ring-amber-100" : "bg-blue-50 text-blue-700 ring-blue-100";
  return (
    <section className="min-w-0 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black tracking-[-0.03em] text-slate-950">{title}</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.length ? items.map((x) => <span key={x.key} className={`rounded-full px-3 py-1.5 text-xs font-black ring-1 ${toneClass}`}>{x.label} · {x.n}</span>) : <span className="text-sm font-semibold text-slate-400">{empty}</span>}
      </div>
    </section>
  );
}

function PassportPanel({ inspections, media, stats, audience, cons }) {
  const scoreLabel = Number.isFinite(stats.score) ? stats.score.toFixed(1) : "—";
  return (
    <aside className="min-w-0 space-y-5 lg:sticky lg:top-24 lg:self-start">
      <section className="rounded-[2rem] border border-orange-100 bg-gradient-to-br from-orange-50 via-white to-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-orange-600">Hotel Passport</div>
            <div className="mt-1 text-sm font-bold text-slate-600">Инспекции и живые обзоры</div>
          </div>
          <div className="shrink-0 rounded-3xl bg-white px-4 py-3 text-center shadow-sm ring-1 ring-orange-100"><div className="text-3xl font-black text-slate-950">{scoreLabel}</div><div className="text-xs font-black text-slate-400">из 5</div></div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2">
          <StatMini label="Инспекций" value={stats.count} />
          <StatMini label="Удобств" value={stats.amenities.length} />
          <StatMini label="Медиа" value={media.length} />
        </div>
      </section>
      <ChipList title="Кому подходит" items={audience.slice(0, 6)} empty="Пока нет данных." />
      <ChipList title="Предупреждения" items={cons.slice(0, 6)} empty="Критичных предупреждений нет." tone="amber" />
      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black tracking-[-0.03em] text-slate-950">Последние медиа</h2>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {media.slice(0, 8).map((m, i) => <img key={m.id || m.url || i} src={m.thumbnail_url || m.url} alt="" className="h-16 w-full rounded-2xl object-cover" />)}
          {!media.length && <div className="col-span-4 rounded-2xl bg-slate-50 p-4 text-center text-sm font-semibold text-slate-400">Пока нет медиа</div>}
        </div>
      </section>
    </aside>
  );
}

function StatMini({ label, value }) {
  return <div className="rounded-2xl bg-white p-3 ring-1 ring-orange-100"><div className="text-xs font-black text-slate-400">{label}</div><div className="mt-1 text-xl font-black text-slate-950">{value ?? "—"}</div></div>;
}

export default function HotelDetails() {
  const { t } = useTranslation();
  const { hotelId } = useParams();
  const [hotel, setHotel] = useState(null);
  const [inspections, setInspections] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [hotelData, inspectionData] = await Promise.all([
          getHotel(hotelId),
          listInspections(hotelId, { sort: "top" }).catch(() => ({ items: [] })),
        ]);
        if (!alive) return;
        setHotel(hotelData || null);
        const all = Array.isArray(inspectionData?.items) ? inspectionData.items : [];
        setInspections(all.filter(isPublished));
      } catch {
        if (alive) {
          setHotel(null);
          setInspections([]);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [hotelId]);

  const contacts = useMemo(() => {
    if (!hotel) return {};
    const src = (typeof hotel.contact === "object" && hotel.contact) || obj(hotel.contact);
    const result = {};
    if (typeof hotel.contact === "string" && !Object.keys(src).length) result.note = hotel.contact;
    else Object.assign(result, src);
    result.phone = result.phone || result.tel || result.phoneNumber;
    result.email = result.email || result.mail;
    result.website = result.website || result.site || result.url;
    return result;
  }, [hotel]);

  const hotelImages = useMemo(() => getHotelImages(hotel), [hotel]);
  const inspectionMedia = useMemo(() => getInspectionMedia(inspections), [inspections]);
  const gallery = useMemo(() => [...hotelImages, ...inspectionMedia], [hotelImages, inspectionMedia]);
  const stats = useMemo(() => getAggregatedStats(hotel, inspections), [hotel, inspections]);
  const scoreRows = useMemo(() => collectScoreRows(hotel, inspections), [hotel, inspections]);
  const audience = useMemo(() => summarizeKeys(inspections, "audience_keys", AUDIENCE_OPTIONS, 10), [inspections]);
  const cons = useMemo(() => summarizeKeys(inspections, "con_keys", CON_OPTIONS, 10), [inspections]);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl p-4 md:p-6">
        <div className="animate-pulse space-y-5"><div className="h-80 rounded-[2rem] bg-white shadow-sm" /><div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]"><div className="h-96 rounded-[2rem] bg-white" /><div className="h-96 rounded-[2rem] bg-white" /></div></div>
      </div>
    );
  }

  if (!hotel) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><div className="text-lg font-black text-slate-950">Отель не найден</div><Link to="/hotels" className="mt-3 inline-block font-bold text-orange-600 underline">← К списку отелей</Link></div>
      </div>
    );
  }

  const fullAddress = [hotel.address, hotel.city || hotel.location, hotel.country].filter(Boolean).join(", ");
  const latest = inspections.slice(0, 4);
  const myInspection = hotel.my_inspection || hotel.myInspection || null;

  return (
    <div className="min-h-screen bg-slate-50/70">
      <div className="mx-auto max-w-7xl px-4 py-5 md:px-6 md:py-8">
        <div className="mb-4 flex min-w-0 flex-wrap items-center gap-2 text-sm font-bold text-slate-500">
          <Link to="/hotels" className="rounded-full bg-white px-3 py-1.5 text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50">← Назад</Link><span>/</span><span>Hotel Passport</span><span>/</span><span className="min-w-0 truncate text-slate-900">{hotel.name}</span>
        </div>

        <section className="min-w-0 overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
          <div className="grid min-w-0 gap-0 lg:grid-cols-[420px_minmax(0,1fr)]">
            <div className="relative min-h-[280px] bg-slate-100 lg:min-h-[380px]">
              {gallery[0] ? (gallery[0].type === "video" || gallery[0].media_type === "video" ? <video src={gallery[0].url} controls className="h-full w-full object-cover" /> : <img src={gallery[0].thumbnail_url || gallery[0].url} alt="" className="h-full w-full object-cover" />) : <div className="flex h-full min-h-[280px] items-center justify-center text-5xl">🏨</div>}
              <div className="absolute bottom-4 left-4 rounded-full bg-white/95 px-3 py-1.5 text-sm font-black text-slate-800 shadow-sm ring-1 ring-slate-200">🖼 {gallery.length || 0} медиа</div>
            </div>
            <div className="min-w-0 p-5 md:p-7">
              <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <div className="inline-flex rounded-full bg-orange-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-orange-600 ring-1 ring-orange-100">Hotel Passport</div>
                  <h1 className="mt-3 break-words text-3xl font-black leading-tight tracking-[-0.04em] text-slate-950 md:text-4xl">{hotel.name}</h1>
                  <div className="mt-2 break-words text-sm font-bold text-slate-500">📍 {[hotel.city || hotel.location, hotel.country].filter(Boolean).join(", ") || "Локация не указана"}</div>
                  <div className="mt-4 flex min-w-0 flex-wrap items-center gap-3"><Stars value={hotel.stars} max={5} /><span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-black text-slate-700">Passport score: {Number.isFinite(stats.score) ? stats.score.toFixed(1) : "—"}/5</span></div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Link to={`/hotels/${hotel.id}/inspections`} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-50">🏨 Инспекции</Link>
                  {myInspection ? <Link to={`/hotels/${hotel.id}/inspections?edit=${myInspection.id}`} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-black">✏️ Редактировать обзор</Link> : <Link to={`/hotels/${hotel.id}/inspections?new=1`} className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-orange-600">➕ Оставить обзор</Link>}
                </div>
              </div>
              <div className="mt-6"><MyInspectionPanel inspection={myInspection} hotelId={hotel.id} /></div>
              <div className="mt-6 grid gap-3 sm:grid-cols-3"><StatCard label="Инспекций" value={stats.count} hint="одобренные" /><StatCard label="Удобств" value={stats.amenities.length} hint="по обзорам" /><StatCard label="Медиа" value={gallery.length} hint="фото/видео" /></div>
              <div className="mt-5 grid gap-3 md:grid-cols-2"><InfoBox label="Адрес" value={fullAddress} /><InfoBox label="Контакт" value={contacts.phone || contacts.email || contacts.note} link={contacts.phone ? `tel:${contacts.phone}` : contacts.email ? `mailto:${contacts.email}` : null} /></div>
            </div>
          </div>
        </section>

        <div className="mt-5 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <main className="min-w-0 space-y-5">
            <section className="min-w-0 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><h2 className="text-xl font-black tracking-[-0.03em] text-slate-950">Последние инспекции</h2><p className="mt-1 text-sm font-bold text-slate-500">На странице показываются только опубликованные инспекции.</p></div><Link to={`/hotels/${hotel.id}/inspections`} className="shrink-0 rounded-xl border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-black text-orange-700 hover:bg-orange-100">Все инспекции →</Link></div>
              <div className="grid min-w-0 gap-3">{latest.length ? latest.map((item) => <InspectionCard key={item.id} item={item} />) : <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center"><div className="text-4xl">🏨</div><div className="mt-3 text-lg font-black text-slate-950">Пока нет опубликованных инспекций</div><div className="mt-1 text-sm font-bold text-slate-500">Первая инспекция появится здесь после модерации.</div></div>}</div>
            </section>
            <MediaCarousel media={gallery} title="Галерея отеля и инспекций" />
            <ScoresBlock rows={scoreRows} />
            <div className="grid min-w-0 gap-5 md:grid-cols-2"><ChipList title="Кому подходит" items={audience} empty="Пока нет данных от инспекций." /><ChipList title="Предупреждения" items={cons} empty="Критичных предупреждений нет." tone="amber" /></div>
          </main>
          <PassportPanel inspections={inspections} media={gallery} stats={stats} audience={audience} cons={cons} />
        </div>

        <section className="mt-5 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-black tracking-[-0.03em] text-slate-950">Детали отеля</h2>
          <div className="mt-4 grid gap-x-8 md:grid-cols-2"><InfoRow label="Название">{hotel.name}</InfoRow><InfoRow label="Страна">{hotel.country}</InfoRow><InfoRow label="Город">{hotel.city || hotel.location}</InfoRow><InfoRow label="Адрес">{fullAddress}</InfoRow><InfoRow label="Категория">{hotel.stars ? `${hotel.stars}★` : "—"}</InfoRow><InfoRow label="Телефон">{contacts.phone}</InfoRow><InfoRow label="Email">{contacts.email}</InfoRow><InfoRow label="Сайт">{contacts.website}</InfoRow></div>
        </section>
      </div>
    </div>
  );
}

function InfoBox({ label, value, link }) {
  const body = <div className="mt-1 break-words text-sm font-bold leading-6 text-slate-900">{value || "—"}</div>;
  return <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50/70 p-4"><div className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">{label}</div>{link ? <a href={link} className="text-blue-700 hover:underline">{body}</a> : body}</div>;
}
