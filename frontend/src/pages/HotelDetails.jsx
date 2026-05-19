// frontend/src/pages/HotelDetails.jsx
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet } from "../api";
import ImageCarousel from "../components/ImageCarousel";

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
    const obj = JSON.parse(v);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

function getAggregatedStats(hotel) {
  const attrs = tryParseJSON(hotel?.attrs) || {};
  const aggregated = attrs.aggregated_from_inspections || {};
  const scores = aggregated.scores || {};
  const values = Object.values(scores).map(Number).filter((n) => Number.isFinite(n));
  const score = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  return {
    count: Number(aggregated.n || 0),
    score,
    amenities: Array.isArray(aggregated.amenities) ? aggregated.amenities : [],
  };
}

function PassportScore({ hotel }) {
  const stats = getAggregatedStats(hotel);
  const hasScore = Number.isFinite(stats.score);

  return (
    <div className="rounded-3xl border border-orange-100 bg-gradient-to-br from-orange-50 to-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.16em] text-orange-600">Hotel Passport</div>
          <div className="mt-1 text-sm font-bold text-slate-600">Инспекции и живые обзоры</div>
        </div>
        <div className="rounded-2xl bg-white px-3 py-2 text-right shadow-sm ring-1 ring-orange-100">
          <div className="text-2xl font-black text-slate-950">{hasScore ? stats.score.toFixed(1) : "—"}</div>
          <div className="text-[11px] font-black text-slate-400">из 5</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-bold">
        <div className="rounded-2xl bg-white p-3 ring-1 ring-orange-100">
          <div className="text-slate-400">Инспекций</div>
          <div className="mt-1 text-lg font-black text-slate-950">{stats.count}</div>
        </div>
        <div className="rounded-2xl bg-white p-3 ring-1 ring-orange-100">
          <div className="text-slate-400">Удобств</div>
          <div className="mt-1 text-lg font-black text-slate-950">{stats.amenities.length}</div>
        </div>
      </div>

      {!stats.count && (
        <div className="mt-3 rounded-2xl bg-white/70 p-3 text-xs font-semibold leading-5 text-slate-500 ring-1 ring-orange-100">
          По этому отелю пока нет инспекций. Можно добавить первую и помочь другим агентам и туристам.
        </div>
      )}
    </div>
  );
}

export default function HotelDetails() {
  const { hotelId } = useParams();
  const [hotel, setHotel] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const data = await apiGet(`/api/hotels/${encodeURIComponent(hotelId)}`, false);
        if (!alive) return;
        setHotel(data || null);
      } catch {
        if (alive) setHotel(null);
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
          <div className="space-y-3">
            <div className="h-4 rounded bg-slate-100" />
            <div className="h-4 rounded bg-slate-100" />
            <div className="h-4 rounded bg-slate-100" />
          </div>
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

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex rounded-full bg-orange-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-orange-600 ring-1 ring-orange-100">
                Hotel card
              </div>
              <h1 className="mt-3 text-2xl font-black tracking-[-0.03em] text-slate-950">{hotel.name}</h1>
              <div className="mt-1 text-sm font-semibold text-slate-500">
                {[hotel.city || hotel.location, hotel.country].filter(Boolean).join(", ") || "—"}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link to={`/hotels/${hotel.id}/inspections`} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-50">
                🏨 Смотреть инспекции
              </Link>
              <Link to={`/hotels/${hotel.id}/inspections?new=1`} className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-black text-white transition hover:bg-orange-600">
                ➕ Оставить инспекцию
              </Link>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-[360px_1fr_300px]">
          <div>
            <ImageCarousel images={images} />
            <div className="mt-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
              <Stars value={hotel.stars} />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white p-3">
            <InfoRow label="Адрес">{fullAddress || "—"}</InfoRow>
            <InfoRow label="Контакт">
              {contacts.phone || contacts.email || contacts.website || contacts.note ? (
                <div className="space-y-1">
                  {contacts.phone && <div>Телефон: <a href={`tel:${contacts.phone}`} className="text-blue-600 hover:underline">{contacts.phone}</a></div>}
                  {contacts.email && <div>E-mail: <a href={`mailto:${contacts.email}`} className="text-blue-600 hover:underline">{contacts.email}</a></div>}
                  {contacts.website && (
                    <div>
                      Сайт:{" "}
                      <a href={/^https?:\/\//i.test(contacts.website) ? contacts.website : `https://${contacts.website}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                        {contacts.website}
                      </a>
                    </div>
                  )}
                  {contacts.note && <div className="text-slate-700">{contacts.note}</div>}
                </div>
              ) : "—"}
            </InfoRow>
          </div>

          <PassportScore hotel={hotel} />
        </div>
      </div>
    </div>
  );
}
