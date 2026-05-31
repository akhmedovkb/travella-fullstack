// frontend/src/pages/HotelDetails.jsx
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet } from "../api";
import { listInspections } from "../api/hotels";

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
  quietness: "Тишина",
  silence: "Тишина",
  infrastructure: "Инфраструктура",
  food: "Питание",
  service: "Сервис",
  rooms: "Номера",
  cleanliness: "Чистота",
  beach: "Пляж",
  pool: "Бассейн",
  kids: "Для детей",
  families: "Семьи",
  nightlife: "Ночная жизнь",
  activities: "Активности",
  wellness: "Wellness",
  business: "Бизнес",
  value: "Цена/качество",
  price_value: "Цена/качество",
  accessibility: "Доступность",
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

function compactText(v, fallback = "—") {
  const s = String(v || "").trim();
  return s || fallback;
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString("ru-RU");
}

function statusValue(item) {
  return String(item?.status || item?.moderation_status || "approved").toLowerCase();
}

function isPublished(item) {
  const s = statusValue(item);
  return ["approved", "published", "active"].includes(s);
}

function statusBadge(item) {
  const s = statusValue(item);
  if (s === "pending") return { text: "На модерации", cls: "bg-amber-50 text-amber-700 ring-amber-100", icon: "⏳" };
  if (s === "rejected") return { text: "Отклонено", cls: "bg-red-50 text-red-700 ring-red-100", icon: "⛔" };
  if (s === "hidden") return { text: "Скрыто", cls: "bg-slate-100 text-slate-600 ring-slate-200", icon: "🙈" };
  return { text: "Опубликовано", cls: "bg-emerald-50 text-emerald-700 ring-emerald-100", icon: "✅" };
}

function optionLabel(list, key) {
  const item = list.find((x) => x.key === key);
  return item ? `${item.icon} ${item.label}` : key;
}

function getHotelImages(hotel) {
  const raw = hotel?.images || hotel?.photos || hotel?.gallery;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(normalizeMedia).filter(Boolean);
  const parsed = tryParseJSON(raw);
  if (Array.isArray(parsed)) return parsed.map(normalizeMedia).filter(Boolean);
  return [normalizeMedia(raw)].filter(Boolean);
}

function normalizeMedia(m) {
  if (!m) return null;
  if (typeof m === "string") return { url: m, type: guessMediaType(m), section_key: "hotel" };
  const url = m.url || m.secure_url || m.thumbnail_url || m.src || m.path;
  if (!url) return null;
  return {
    ...m,
    url,
    thumbnail_url: m.thumbnail_url || m.thumb_url || m.preview_url || url,
    type: m.type || m.resource_type || guessMediaType(url),
    section_key: m.section_key || m.section || m.zone || "hotel",
  };
}

function guessMediaType(url = "") {
  const s = String(url).toLowerCase().split("?")[0];
  if (/\.(mp4|webm|mov|m4v)$/.test(s)) return "video";
  return "image";
}

function getInspectionMedia(inspections = []) {
  return inspections.flatMap((item) => {
    const media = arr(item?.section_media).map(normalizeMedia).filter(Boolean);
    return media.map((m) => ({ ...m, inspection_id: item.id, inspection_title: item.title }));
  });
}

function getAggregatedStats(hotel, inspections = []) {
  const attrs = tryParseJSON(hotel?.attrs) || {};
  const aggregated = attrs.aggregated_from_inspections || {};
  const scores = aggregated.scores || {};
  const scoreValues = Object.values(scores).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  const scoreFromAttrs = scoreValues.length ? scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length : null;
  const directScores = inspections.map((x) => Number(x.recommendation_score)).filter((n) => Number.isFinite(n) && n > 0);
  const score = directScores.length ? directScores.reduce((a, b) => a + b, 0) / directScores.length : scoreFromAttrs;
  const mediaCount = inspections.reduce((s, x) => s + arr(x.section_media).length, 0);
  return {
    count: inspections.length || Number(aggregated.n || 0),
    score,
    amenities: Array.isArray(aggregated.amenities) ? aggregated.amenities : [],
    scores,
    mediaCount,
  };
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

function collectScoreRows(hotel, inspections = []) {
  const collected = new Map();
  const pushScores = (scores) => {
    if (!scores || typeof scores !== "object") return;
    for (const [key, raw] of Object.entries(scores)) {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) continue;
      const prev = collected.get(key) || { sum: 0, count: 0 };
      collected.set(key, { sum: prev.sum + n, count: prev.count + 1 });
    }
  };

  const attrs = tryParseJSON(hotel?.attrs) || {};
  pushScores(attrs?.aggregated_from_inspections?.scores);
  for (const item of inspections) pushScores(tryParseJSON(item.scores) || item.scores);

  return [...collected.entries()]
    .map(([key, v]) => ({ key, label: SCORE_LABELS[key] || key, value: v.sum / v.count }))
    .filter((x) => Number.isFinite(x.value))
    .sort((a, b) => a.label.localeCompare(b.label, "ru"));
}

function Stars({ value = 0, max = 5 }) {
  const n = Math.max(0, Math.min(max, Math.round(Number(value) || 0)));
  return (
    <div className="flex items-center gap-1" title={`${n} ★`}>
      {Array.from({ length: max }).map((_, i) => (
        <svg key={i} width="18" height="18" viewBox="0 0 24 24" className={i < n ? "text-amber-500" : "text-slate-300"} fill="currentColor" aria-hidden="true">
          <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.62L12 2 9.19 8.62 2 9.24l5.46 4.73L5.82 21z" />
        </svg>
      ))}
      <span className="ml-2 text-sm font-black text-slate-500">{n > 0 ? `${n}★` : "—"}</span>
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
      <div className="flex min-h-[220px] items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50 text-center text-sm font-bold text-slate-400">
        Фото/видео пока не прикреплены
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-black text-slate-950">{title}</div>
        <div className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-600">{idx + 1} / {items.length}</div>
      </div>

      <div className={`relative overflow-hidden rounded-2xl bg-slate-100 ${compact ? "h-52" : "h-[260px] md:h-[360px]"}`}>
        {active?.type === "video" ? (
          <video src={active.url} controls className="h-full w-full object-cover" />
        ) : (
          <img src={active?.url} alt="" className="h-full w-full object-cover" />
        )}

        {items.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => setIdx((v) => (v - 1 + items.length) % items.length)}
              className="absolute left-3 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-lg font-black text-slate-800 shadow ring-1 ring-slate-200 hover:bg-white"
              aria-label="Предыдущее медиа"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => setIdx((v) => (v + 1) % items.length)}
              className="absolute right-3 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-lg font-black text-slate-800 shadow ring-1 ring-slate-200 hover:bg-white"
              aria-label="Следующее медиа"
            >
              ›
            </button>
          </>
        )}

        <div className="absolute bottom-3 left-3 rounded-full bg-white/90 px-3 py-1 text-xs font-black text-slate-700 shadow-sm">
          {active?.type === "video" ? "🎬 Видео" : "🖼 Фото"}
          {active?.section_key ? ` · ${active.section_key}` : ""}
        </div>
      </div>

      {items.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {items.map((m, i) => (
            <button
              key={`${m.url}-${i}`}
              type="button"
              onClick={() => setIdx(i)}
              className={`relative h-16 w-20 shrink-0 overflow-hidden rounded-xl ring-2 transition ${i === idx ? "ring-orange-500" : "ring-transparent hover:ring-slate-200"}`}
            >
              {m.type === "video" ? (
                <div className="flex h-full w-full items-center justify-center bg-slate-900 text-white">▶</div>
              ) : (
                <img src={m.thumbnail_url || m.url} alt="" className="h-full w-full object-cover" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-black tracking-[-0.04em] text-slate-950">{value}</div>
      {hint && <div className="mt-1 text-xs font-bold text-slate-500">{hint}</div>}
    </div>
  );
}

function InfoRow({ label, children }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-slate-100 py-3 last:border-b-0">
      <div className="text-sm font-bold text-slate-500">{label}</div>
      <div className="min-w-0 text-sm font-semibold text-slate-900">{children ?? "—"}</div>
    </div>
  );
}

function InspectionCard({ item }) {
  const media = arr(item?.section_media).map(normalizeMedia).filter(Boolean);
  const badge = statusBadge(item);
  const score = Number(item?.recommendation_score);
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex gap-4">
        <div className="h-24 w-28 shrink-0 overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-slate-200">
          {media[0] ? (
            media[0].type === "video" ? <div className="flex h-full w-full items-center justify-center bg-slate-900 text-white">▶</div> : <img src={media[0].thumbnail_url || media[0].url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xl">🏨</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ring-1 ${badge.cls}`}>{badge.icon} {badge.text}</span>
            {media.length > 0 && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-black text-blue-700 ring-1 ring-blue-100">Медиа: {media.length}</span>}
          </div>
          <div className="truncate text-base font-black tracking-[-0.02em] text-slate-950">{compactText(item?.title, "Живой обзор отеля")}</div>
          <div className="mt-1 text-xs font-bold text-slate-500">{compactText(item?.author_name || item?.provider_name || item?.author, "Автор")} · {formatDate(item?.created_at || item?.visit_date)}</div>
          <div className="mt-2 line-clamp-2 text-sm font-medium leading-6 text-slate-600">{compactText(item?.review || item?.pros || item?.summary, "Короткий обзор будет доступен после публикации.")}</div>
        </div>
        <div className="hidden shrink-0 items-center justify-center rounded-2xl bg-orange-50 px-4 text-center ring-1 ring-orange-100 sm:flex">
          <div>
            <div className="text-2xl font-black text-slate-950">{Number.isFinite(score) ? score.toFixed(1) : "—"}</div>
            <div className="text-[11px] font-black text-slate-400">из 5</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChipList({ title, items, empty, tone = "blue" }) {
  const toneCls = tone === "amber" ? "bg-amber-50 text-amber-700 ring-amber-100" : "bg-blue-50 text-blue-700 ring-blue-100";
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-black text-slate-950">{title}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.length ? items.map((x) => (
          <span key={x.key} className={`rounded-full px-3 py-1.5 text-xs font-black ring-1 ${toneCls}`}>{x.label} · {x.n}</span>
        )) : <span className="text-sm font-bold text-slate-400">{empty}</span>}
      </div>
    </div>
  );
}

function ScoresBlock({ rows }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black text-slate-950">Оценки по деталям</div>
          <div className="text-xs font-bold text-slate-400">Средние значения по опубликованным инспекциям</div>
        </div>
      </div>
      {rows.length ? (
        <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
          {rows.map((row) => {
            const value = Math.max(0, Math.min(5, Number(row.value) || 0));
            return (
              <div key={row.key}>
                <div className="mb-1 flex items-center justify-between gap-3 text-sm font-bold">
                  <span className="text-slate-700">{row.label}</span>
                  <span className="text-slate-950">{value.toFixed(value % 1 ? 1 : 0)}/5</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-orange-500" style={{ width: `${(value / 5) * 100}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl bg-slate-50 p-5 text-sm font-bold text-slate-400">Пока нет детализированных оценок.</div>
      )}
    </div>
  );
}

function PassportPanel({ hotel, inspections, media }) {
  const stats = getAggregatedStats(hotel, inspections);
  const score = Number.isFinite(stats.score) ? stats.score.toFixed(1) : "—";
  const audience = summarizeKeys(inspections, "audience_keys", AUDIENCE_OPTIONS, 4);
  const cons = summarizeKeys(inspections, "con_keys", CON_OPTIONS, 4);
  return (
    <aside className="space-y-4 lg:sticky lg:top-24">
      <div className="rounded-3xl border border-orange-100 bg-gradient-to-br from-orange-50 via-white to-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-orange-600">Hotel Passport</div>
            <div className="mt-1 text-sm font-bold text-slate-600">Инспекции и живые обзоры</div>
          </div>
          <div className="rounded-2xl bg-white px-4 py-3 text-center shadow-sm ring-1 ring-orange-100">
            <div className="text-3xl font-black text-slate-950">{score}</div>
            <div className="text-[11px] font-black text-slate-400">из 5</div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <StatMini label="Инспекций" value={stats.count} />
          <StatMini label="Удобств" value={stats.amenities.length} />
          <StatMini label="Медиа" value={media.length} />
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Кому подходит</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {audience.length ? audience.map((x) => <span key={x.key} className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-700 ring-1 ring-blue-100">{x.label} · {x.n}</span>) : <span className="text-sm font-bold text-slate-400">Пока нет данных</span>}
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Предупреждения</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {cons.length ? cons.map((x) => <span key={x.key} className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-black text-amber-700 ring-1 ring-amber-100">{x.label} · {x.n}</span>) : <span className="text-sm font-bold text-emerald-700">✅ Критичных предупреждений нет</span>}
        </div>
      </div>

      <div className="rounded-3xl border border-orange-100 bg-orange-50/60 p-5 shadow-sm">
        <div className="text-sm font-black text-slate-950">Инспекции проходят модерацию</div>
        <p className="mt-2 text-sm font-medium leading-6 text-slate-600">На странице отеля отображаются только одобренные инспекции. Новые обзоры сначала проверяются администратором.</p>
      </div>
    </aside>
  );
}

function StatMini({ label, value }) {
  return (
    <div className="rounded-2xl bg-white p-3 ring-1 ring-orange-100">
      <div className="text-[11px] font-black text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-black text-slate-950">{value}</div>
    </div>
  );
}


function MyInspectionPanel({ inspection, hotelId }) {
  if (!inspection) {
    return (
      <div className="rounded-3xl border border-dashed border-orange-200 bg-orange-50/50 p-4">
        <div className="text-sm font-black text-slate-950">У вас ещё нет обзора этого отеля</div>
        <div className="mt-1 text-xs font-bold leading-5 text-slate-500">Оставьте инспекцию — после проверки админом она станет публичной в Hotel Passport.</div>
        <Link to={`/hotels/${hotelId}/inspections?new=1`} className="mt-3 inline-flex rounded-xl bg-orange-500 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-orange-600">➕ Оставить обзор</Link>
      </div>
    );
  }

  const status = String(inspection.moderation_status || inspection.status || "pending").toLowerCase();
  const cfg = {
    pending: ["⏳", "Ваш обзор на модерации", "Видите только вы и админ. После одобрения обзор станет публичным.", "bg-amber-50 text-amber-900 ring-amber-100"],
    approved: ["✅", "Ваш обзор опубликован", "Обзор виден в Hotel Passport.", "bg-emerald-50 text-emerald-900 ring-emerald-100"],
    published: ["✅", "Ваш обзор опубликован", "Обзор виден в Hotel Passport.", "bg-emerald-50 text-emerald-900 ring-emerald-100"],
    rejected: ["⛔", "Ваш обзор отклонён", inspection.rejection_reason ? `Причина: ${inspection.rejection_reason}` : "Исправьте обзор и отправьте повторно.", "bg-red-50 text-red-900 ring-red-100"],
    hidden: ["🙈", "Ваш обзор скрыт", "Обзор не публикуется в общей ленте.", "bg-slate-100 text-slate-800 ring-slate-200"],
    draft: ["📝", "Ваш обзор в черновике", "Можно продолжить заполнение и отправить на модерацию.", "bg-slate-50 text-slate-800 ring-slate-200"],
  }[status] || ["🧾", "Ваш обзор найден", "Откройте инспекции, чтобы посмотреть детали.", "bg-slate-50 text-slate-800 ring-slate-200"];

  return (
    <div className={`rounded-3xl p-4 ring-1 ${cfg[3]}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-black">{cfg[0]} {cfg[1]}</div>
          <div className="mt-1 text-xs font-bold leading-5 opacity-80">{cfg[2]}</div>
        </div>
        <Link to={`/hotels/${hotelId}/inspections?edit=${inspection.id}`} className="shrink-0 rounded-xl bg-white px-4 py-2 text-sm font-black text-slate-900 shadow-sm ring-1 ring-black/5 hover:bg-slate-50">✏️ Редактировать</Link>
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
          apiGet(`/api/hotels/${encodeURIComponent(hotelId)}`, true),
          listInspections(hotelId, { sort: "top" }).catch(() => ({ items: [] })),
        ]);
        if (!alive) return;
        setHotel(hotelData || null);
        const loaded = Array.isArray(inspectionData?.items) ? inspectionData.items : [];
        setInspections(loaded.filter(isPublished));
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
        <div className="animate-pulse space-y-5">
          <div className="h-72 rounded-[2rem] bg-white shadow-sm" />
          <div className="grid gap-5 lg:grid-cols-[1fr_360px]"><div className="h-96 rounded-[2rem] bg-white" /><div className="h-96 rounded-[2rem] bg-white" /></div>
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
  const latest = inspections.slice(0, 4);
  const scoreLabel = Number.isFinite(stats.score) ? stats.score.toFixed(1) : "—";
  const myInspection = hotel.my_inspection || hotel.myInspection || null;

  return (
    <div className="bg-slate-50/70">
      <div className="mx-auto max-w-7xl px-4 py-5 md:px-6 md:py-8">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm font-bold text-slate-500">
          <Link to="/hotels" className="rounded-full bg-white px-3 py-1.5 text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50">← Назад</Link>
          <span>/</span>
          <span>Hotel Passport</span>
          <span>/</span>
          <span className="text-slate-900">{hotel.name}</span>
        </div>

        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-0 lg:grid-cols-[420px_1fr]">
            <div className="relative min-h-[280px] bg-slate-100 lg:min-h-[360px]">
              {gallery[0] ? (
                gallery[0].type === "video" ? <video src={gallery[0].url} controls className="h-full w-full object-cover" /> : <img src={gallery[0].url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full min-h-[280px] items-center justify-center text-5xl">🏨</div>
              )}
              <div className="absolute bottom-4 left-4 rounded-full bg-white/95 px-3 py-1.5 text-sm font-black text-slate-800 shadow-sm ring-1 ring-slate-200">🖼 {gallery.length || 0} медиа</div>
            </div>

            <div className="p-5 md:p-7">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <div className="inline-flex rounded-full bg-orange-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-orange-600 ring-1 ring-orange-100">Hotel Passport</div>
                  <h1 className="mt-3 text-3xl font-black leading-tight tracking-[-0.04em] text-slate-950 md:text-4xl">{hotel.name}</h1>
                  <div className="mt-2 text-sm font-bold text-slate-500">📍 {[hotel.city || hotel.location, hotel.country].filter(Boolean).join(", ") || "Локация не указана"}</div>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Stars value={hotel.stars} max={5} />
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-black text-slate-700">Passport score: {scoreLabel}/5</span>
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  <Link to={`/hotels/${hotel.id}/inspections`} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-50">🏨 Инспекции</Link>
                  {myInspection ? (
                    <Link to={`/hotels/${hotel.id}/inspections?edit=${myInspection.id}`} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-black">✏️ Редактировать обзор</Link>
                  ) : (
                    <Link to={`/hotels/${hotel.id}/inspections?new=1`} className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-orange-600">➕ Оставить обзор</Link>
                  )}
                </div>
              </div>

              <div className="mt-6">
                <MyInspectionPanel inspection={myInspection} hotelId={hotel.id} />
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-3">
                <StatCard label="Инспекций" value={stats.count} hint="одобренные" />
                <StatCard label="Удобств" value={stats.amenities.length} hint="по обзорам" />
                <StatCard label="Медиа" value={gallery.length} hint="фото/видео" />
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">Адрес</div>
                  <div className="mt-1 text-sm font-bold leading-6 text-slate-900">{fullAddress || "—"}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">Контакт</div>
                  <div className="mt-1 text-sm font-bold leading-6 text-slate-900">
                    {contacts.phone ? <a href={`tel:${contacts.phone}`} className="text-blue-700 hover:underline">{contacts.phone}</a> : contacts.email ? <a href={`mailto:${contacts.email}`} className="text-blue-700 hover:underline">{contacts.email}</a> : contacts.note || "—"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_360px]">
          <main className="space-y-5 min-w-0">
            <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black tracking-[-0.03em] text-slate-950">Последние инспекции</h2>
                  <p className="mt-1 text-sm font-bold text-slate-500">На странице показываются только опубликованные инспекции.</p>
                </div>
                <Link to={`/hotels/${hotel.id}/inspections`} className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-black text-orange-700 hover:bg-orange-100">Все инспекции →</Link>
              </div>
              <div className="grid gap-3">
                {latest.length ? latest.map((item) => <InspectionCard key={item.id} item={item} />) : (
                  <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                    <div className="text-4xl">🏨</div>
                    <div className="mt-3 text-lg font-black text-slate-950">Пока нет опубликованных инспекций</div>
                    <div className="mt-1 text-sm font-bold text-slate-500">Первая инспекция появится здесь после модерации.</div>
                  </div>
                )}
              </div>
            </section>

            <MediaCarousel media={gallery} title="Галерея отеля и инспекций" />

            <ScoresBlock rows={scoreRows} />

            <div className="grid gap-5 md:grid-cols-2">
              <ChipList title="Кому подходит" items={audience} empty="Пока нет данных от инспекций." />
              <ChipList title="Предупреждения" items={cons} empty="Критичных предупреждений нет." tone="amber" />
            </div>
          </main>

          <PassportPanel hotel={hotel} inspections={inspections} media={gallery} />
        </div>

        <section className="mt-5 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-black tracking-[-0.03em] text-slate-950">Детали отеля</h2>
          <div className="mt-4 grid gap-x-8 md:grid-cols-2">
            <InfoRow label="Название">{hotel.name}</InfoRow>
            <InfoRow label="Страна">{hotel.country}</InfoRow>
            <InfoRow label="Город">{hotel.city || hotel.location}</InfoRow>
            <InfoRow label="Адрес">{fullAddress}</InfoRow>
            <InfoRow label="Категория">{hotel.stars ? `${hotel.stars}★` : "—"}</InfoRow>
            <InfoRow label="Телефон">{contacts.phone}</InfoRow>
            <InfoRow label="Email">{contacts.email}</InfoRow>
            <InfoRow label="Сайт">{contacts.website}</InfoRow>
          </div>
        </section>
      </div>
    </div>
  );
}
