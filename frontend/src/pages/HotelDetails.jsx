// frontend/src/pages/HotelDetails.jsx
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet } from "../api";
import { listInspections } from "../api/hotels";
import ImageCarousel from "../components/ImageCarousel";

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

function Star({ filled }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" className={filled ? "text-amber-500" : "text-gray-300"} fill="currentColor" aria-hidden="true">
      <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.62L12 2 9.19 8.62 2 9.24l5.46 4.73L5.82 21z" />
    </svg>
  );
}

function Stars({ value = 0, max = 7 }) {
  const n = Math.max(0, Math.min(max, Number(value) || 0));
  return (
    <div className="flex items-center gap-1" title={`${n} ★`}>
      {Array.from({ length: max }).map((_, i) => <Star key={i} filled={i < n} />)}
      <span className="ml-2 text-sm font-bold text-gray-500">{n > 0 ? `${n}★` : "—"}</span>
    </div>
  );
}

function InfoRow({ label, children }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-slate-100 py-3 last:border-b-0">
      <div className="text-sm font-bold text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-900">{children ?? "—"}</div>
    </div>
  );
}

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

function label(list, key) {
  const item = list.find((x) => x.key === key);
  return item ? `${item.icon} ${item.label}` : key;
}

function getAggregatedStats(hotel, inspections = []) {
  const attrs = tryParseJSON(hotel?.attrs) || {};
  const aggregated = attrs.aggregated_from_inspections || {};
  const scores = aggregated.scores || {};
  const values = Object.values(scores).map(Number).filter((n) => Number.isFinite(n));
  const scoreFromAttrs = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const directScores = inspections
    .map((x) => Number(x.recommendation_score))
    .filter((n) => Number.isFinite(n) && n > 0);
  const score = directScores.length ? directScores.reduce((a, b) => a + b, 0) / directScores.length : scoreFromAttrs;
  return {
    count: inspections.length || Number(aggregated.n || 0),
    score,
    amenities: Array.isArray(aggregated.amenities) ? aggregated.amenities : [],
  };
}

function summarizeKeys(inspections, field, options, limit = 5) {
  const map = new Map();
  for (const item of inspections) for (const key of arr(item?.[field])) map.set(key, (map.get(key) || 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, n]) => ({ key, n, label: label(options, key) }));
}

function PassportScore({ hotel, inspections = [] }) {
  const stats = getAggregatedStats(hotel, inspections);
  const hasScore = Number.isFinite(stats.score);
  const scoreLabel = hasScore ? stats.score.toFixed(1) : "—";
  const audience = summarizeKeys(inspections, "audience_keys", AUDIENCE_OPTIONS, 6);
  const cons = summarizeKeys(inspections, "con_keys", CON_OPTIONS, 6);
  const media = inspections.flatMap((x) => arr(x.section_media)).slice(0, 8);

  return (
    <div className="h-full rounded-3xl border border-orange-100 bg-gradient-to-br from-orange-50 via-white to-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.16em] text-orange-600">Hotel Passport</div>
          <div className="mt-1 text-sm font-bold text-slate-600">Инспекции и живые обзоры</div>
        </div>
        <div className="rounded-2xl bg-white px-3 py-2 text-right shadow-sm ring-1 ring-orange-100">
          <div className="text-2xl font-black text-slate-950">{scoreLabel}</div>
          <div className="text-[11px] font-black text-slate-400">из 5</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-xs font-bold">
        <div className="rounded-2xl bg-white p-3 ring-1 ring-orange-100"><div className="text-slate-400">Инспекций</div><div className="mt-1 text-lg font-black text-slate-950">{stats.count}</div></div>
        <div className="rounded-2xl bg-white p-3 ring-1 ring-orange-100"><div className="text-slate-400">Удобств</div><div className="mt-1 text-lg font-black text-slate-950">{stats.amenities.length}</div></div>
        <div className="rounded-2xl bg-white p-3 ring-1 ring-orange-100"><div className="text-slate-400">Медиа</div><div className="mt-1 text-lg font-black text-slate-950">{inspections.reduce((s, x) => s + arr(x.section_media).length, 0)}</div></div>
      </div>

      <div className="mt-3 rounded-2xl bg-white/80 p-3 ring-1 ring-orange-100">
        <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Кому подходит</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {audience.length ? audience.map((x) => <span key={x.key} className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-black text-blue-700">{x.label} · {x.n}</span>) : <span className="text-xs font-semibold text-slate-400">Пока нет данных</span>}
        </div>
      </div>

      <div className="mt-3 rounded-2xl bg-white/80 p-3 ring-1 ring-orange-100">
        <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Предупреждения</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {cons.length ? cons.map((x) => <span key={x.key} className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-700">{x.label} · {x.n}</span>) : <span className="text-xs font-semibold text-slate-400">Критичных предупреждений нет</span>}
        </div>
      </div>

      <div className="mt-3 rounded-2xl bg-white/80 p-3 ring-1 ring-orange-100">
        <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Последние медиа</div>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {media.length ? media.map((m) => <img key={m.id || m.url} src={m.thumbnail_url || m.url} alt="" className="h-12 w-full rounded-xl object-cover" />) : <span className="col-span-4 text-xs font-semibold text-slate-400">Пока нет фото/видео</span>}
        </div>
      </div>
    </div>
  );
}

export default function HotelDetails() {
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
          apiGet(`/api/hotels/${encodeURIComponent(hotelId)}`, false),
          listInspections(hotelId, { sort: "top" }).catch(() => ({ items: [] })),
        ]);
        if (!alive) return;
        setHotel(hotelData || null);
        setInspections(Array.isArray(inspectionData?.items) ? inspectionData.items : []);
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
    const src = (typeof hotel.contact === "object" && hotel.contact) || tryParseJSON(hotel.contact) || {};
    const result = {};
    if (typeof hotel.contact === "string" && !Object.keys(src).length) result.note = hotel.contact;
    else Object.assign(result, src);
    result.phone = result.phone || result.tel || result.phoneNumber;
    result.email = result.email || result.mail;
    result.website = result.website || result.site || result.url;
    return result;
  }, [hotel]);

  const images = useMemo(() => {
    const raw = hotel?.images;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    const parsed = tryParseJSON(raw);
    if (Array.isArray(parsed)) return parsed;
    return [raw];
  }, [hotel]);

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl p-6">
        <div className="animate-pulse rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 h-6 w-64 rounded bg-slate-200" />
          <div className="mb-6 h-48 rounded-2xl bg-slate-100" />
          <div className="space-y-3"><div className="h-4 rounded bg-slate-100" /><div className="h-4 rounded bg-slate-100" /><div className="h-4 rounded bg-slate-100" /></div>
        </div>
      </div>
    );
  }

  if (!hotel) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-lg font-black text-slate-950">Отель не найден</div>
          <Link to="/hotels" className="mt-3 inline-block font-bold text-orange-600 underline">← К списку отелей</Link>
        </div>
      </div>
    );
  }

  const fullAddress = [hotel.address, hotel.city || hotel.location, hotel.country].filter(Boolean).join(", ");
  const latest = inspections.slice(0, 3);

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-gradient-to-br from-white via-white to-orange-50/50 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="inline-flex rounded-full bg-orange-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-orange-600 ring-1 ring-orange-100">Hotel Passport</div>
              <h1 className="mt-3 truncate text-3xl font-black tracking-[-0.04em] text-slate-950">{hotel.name}</h1>
              <div className="mt-1 text-sm font-semibold text-slate-500">{[hotel.city || hotel.location, hotel.country].filter(Boolean).join(", ") || "—"}</div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link to={`/hotels/${hotel.id}/inspections`} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-50">🏨 Инспекции</Link>
              <Link to={`/hotels/${hotel.id}/inspections?new=1`} className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-black text-white transition hover:bg-orange-600">➕ Оставить</Link>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-[360px_1fr_340px]">
          <div>
            <ImageCarousel images={images} />
            <div className="mt-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100"><Stars value={hotel.stars} /></div>
          </div>

          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-100 bg-white p-3">
              <InfoRow label="Адрес">{fullAddress || "—"}</InfoRow>
              <InfoRow label="Контакт">
                {contacts.phone || contacts.email || contacts.website || contacts.note ? (
                  <div className="space-y-1">
                    {contacts.phone && <div>Телефон: <a href={`tel:${contacts.phone}`} className="text-blue-600 hover:underline">{contacts.phone}</a></div>}
                    {contacts.email && <div>E-mail: <a href={`mailto:${contacts.email}`} className="text-blue-600 hover:underline">{contacts.email}</a></div>}
                    {contacts.website && <div>Сайт: <a href={/^https?:\/\//i.test(contacts.website) ? contacts.website : `https://${contacts.website}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{contacts.website}</a></div>}
                    {contacts.note && <div className="text-slate-700">{contacts.note}</div>}
                  </div>
                ) : "—"}
              </InfoRow>
            </div>

            <div className="rounded-3xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div><div className="text-sm font-black text-slate-950">Последние инспекции</div><div className="text-xs font-bold text-slate-400">Короткий срез живых обзоров</div></div>
                <Link to={`/hotels/${hotel.id}/inspections`} className="text-sm font-black text-orange-600 hover:underline">Все →</Link>
              </div>
              <div className="mt-3 space-y-2">
                {latest.length ? latest.map((item) => (
                  <Link key={item.id} to={`/hotels/${hotel.id}/inspections`} className="block rounded-2xl bg-white p-3 ring-1 ring-slate-100 hover:bg-orange-50/40">
                    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-sm font-black text-slate-900">{item.title || "Живой обзор"}</div><div className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-500">{item.review || item.pros || "Открыть обзор"}</div></div><div className="shrink-0 rounded-xl bg-orange-50 px-2 py-1 text-xs font-black text-orange-600">{item.recommendation_score || "—"}/5</div></div>
                  </Link>
                )) : <div className="rounded-2xl bg-white p-3 text-sm font-semibold text-slate-400 ring-1 ring-slate-100">По этому отелю пока нет инспекций.</div>}
              </div>
            </div>
          </div>

          <PassportScore hotel={hotel} inspections={inspections} />
        </div>
      </div>
    </div>
  );
}
